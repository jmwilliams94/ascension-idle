-- Fixes a data-loss race between resolve-combat and use_potion_stack, both of
-- which write characters.current_mp. use_potion_stack's write was already a
-- correct atomic increment (current_mp = current_mp + restore), but
-- resolve_combat_apply_results applied its own p_current_mp as a blanket
-- absolute overwrite (`current_mp = coalesce(p_current_mp, current_mp)`) —
-- unlike every other reward field in this function, which are all applied as
-- deltas specifically so concurrent writes compose correctly.
--
-- resolve-combat (the edge function) reads characters.current_mp once, early
-- in the call, then spends the rest of the call simulating combat before
-- writing back a new absolute value it computed from that now-stale snapshot.
-- If a potion is drunk while that call is still in flight, use_potion_stack's
-- increment lands on the row first, then resolve-combat's stale absolute
-- write clobbers it — silently discarding the heal (real DB data loss, not
-- just a display glitch) while the potion itself is still consumed. Reported
-- by the user as the MP bar visibly filling on a potion drink, then
-- "rubber-banding" back down a moment later as the in-flight resolve-combat
-- call's response reconciles the client to the clobbered value. Reproduced in
-- isolation against a scratch temp table before this fix, replaying the two
-- functions' exact write expressions in sequence — confirmed the increment
-- is unconditionally lost.
--
-- Fix: resolve-combat now passes p_mp_spent (how much MP THIS call consumed,
-- a delta) instead of p_current_mp (an absolute resulting value), applied
-- here as `current_mp = greatest(0, current_mp - p_mp_spent)` against
-- whatever the row holds at write time — so it composes correctly with a
-- concurrent potion increment regardless of which write lands first, exactly
-- like every other field this function already applies as a delta.
begin;

-- Signature change (p_current_mp -> p_mp_spent) — explicit drop first, see
-- CLAUDE.md's own gotcha (create-or-replace with a different signature, or
-- even just a renamed parameter, either creates an ambiguous overload or is
-- outright rejected by Postgres).
drop function if exists public.resolve_combat_apply_results(
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb, numeric, jsonb
);

create or replace function public.resolve_combat_apply_results(
  p_character_id uuid,
  p_account_id uuid,
  p_monster_id text,
  p_mode text,
  p_kills_delta numeric,
  p_gold_delta integer,
  p_exp integer,
  p_level integer,
  p_comet_delta integer,
  p_fallen_star_delta integer,
  p_comet_scroll_delta integer default 0,
  p_durability_updates jsonb default '[]'::jsonb,
  p_pet_obtained boolean default false,
  p_item_drops jsonb default '[]'::jsonb,
  p_currency_drops jsonb default '[]'::jsonb,
  p_mp_spent numeric default null,
  p_monster_instance_state jsonb default null
)
returns jsonb
language plpgsql
as $$
declare
  v_character_kills numeric;
  v_account_kills numeric;
  v_gold integer;
  v_comets integer;
  v_fallen_stars integer;
  v_comet_scrolls integer;
  v_current_mp numeric;
  v_drop jsonb;
  v_currency jsonb;
  v_granted_items jsonb := '[]'::jsonb;
  v_new_item public.item_instances%rowtype;
  v_character_name text;
  v_monster_name text;
  v_max_durability numeric;
  v_rolled_durability numeric;
begin
  if p_kills_delta > 0 then
    insert into public.character_monster_kills (character_id, monster_id, kills)
    values (p_character_id, p_monster_id, p_kills_delta)
    on conflict (character_id, monster_id)
    do update set kills = public.character_monster_kills.kills + excluded.kills
    returning kills into v_character_kills;

    insert into public.account_monster_kills (account_id, monster_id, kills)
    values (p_account_id, p_monster_id, p_kills_delta)
    on conflict (account_id, monster_id)
    do update set kills = public.account_monster_kills.kills + excluded.kills
    returning kills into v_account_kills;
  end if;

  if p_pet_obtained then
    insert into public.account_pets (account_id, monster_id)
    values (p_account_id, p_monster_id)
    on conflict do nothing;

    if found then
      select name into v_character_name from public.characters where id = p_character_id;
      select display_name into v_monster_name from public.enemy_types where id = p_monster_id;

      insert into public.global_announcements (kind, character_name, message)
      values (
        'pet_obtained',
        v_character_name,
        v_character_name || ' obtained the ' || coalesce(v_monster_name, 'Unknown') || ' pet!'
      );
    end if;
  end if;

  if jsonb_array_length(p_durability_updates) > 0 then
    update public.item_instances ii
    set durability = (u ->> 'durability')::numeric
    from jsonb_array_elements(p_durability_updates) as u
    where ii.id = (u ->> 'id')::uuid and ii.owner_id = p_character_id;
  end if;

  -- Item drops: live mode grants straight into item_instances (already
  -- confirmed to fit at roll time — see resolve-combat's own room-check),
  -- offline mode always routes to loot_holding regardless of room.
  for v_drop in select * from jsonb_array_elements(p_item_drops)
  loop
    v_max_durability := coalesce((v_drop ->> 'max_durability')::numeric, 0);
    v_rolled_durability := case
      when v_max_durability > 0 then (1 + floor(random() * v_max_durability))
      else 0
    end;

    if p_mode = 'live' then
      insert into public.item_instances (template_id, owner_id, level, quality_tier, composition_level, durability)
      values (
        (v_drop ->> 'template_id')::uuid,
        p_character_id,
        (v_drop ->> 'required_level')::integer,
        v_drop ->> 'quality_tier',
        (v_drop ->> 'composition_level')::integer,
        v_rolled_durability
      )
      returning * into v_new_item;
      v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
    else
      insert into public.loot_holding (character_id, template_id, quality_tier, composition_level, durability)
      values (
        p_character_id,
        (v_drop ->> 'template_id')::uuid,
        v_drop ->> 'quality_tier',
        (v_drop ->> 'composition_level')::integer,
        v_rolled_durability
      );
    end if;
  end loop;

  -- Currency drops: offline mode only (loot_holding routing) — live mode
  -- currency drops are plain deltas via p_comet_delta/p_fallen_star_delta.
  for v_currency in select * from jsonb_array_elements(p_currency_drops)
  loop
    insert into public.loot_holding (character_id, currency_type)
    values (p_character_id, v_currency ->> 'currency_type');
  end loop;

  update public.characters
  set
    gold = gold + p_gold_delta,
    exp = p_exp,
    level = p_level,
    comet_count = comet_count + p_comet_delta,
    fallen_star_count = fallen_star_count + p_fallen_star_delta,
    comet_scroll_count = comet_scroll_count + p_comet_scroll_delta,
    -- Delta, not absolute (see this migration's header) — composes correctly
    -- with a concurrent use_potion_stack increment regardless of write order.
    current_mp = case when p_mp_spent is null then current_mp
                      else greatest(0, current_mp - p_mp_spent) end,
    current_monster_id = case when p_monster_instance_state is null then current_monster_id
                              else p_monster_instance_state ->> 'monster_id' end,
    current_monster_hp = case when p_monster_instance_state is null then current_monster_hp
                              else (p_monster_instance_state ->> 'hp')::numeric end,
    current_monster_is_rare = case when p_monster_instance_state is null then current_monster_is_rare
                              else (p_monster_instance_state ->> 'is_rare')::boolean end,
    current_monster_spawned_at = case when p_monster_instance_state is null then current_monster_spawned_at
                              else (p_monster_instance_state ->> 'spawned_at')::timestamptz end,
    current_monster_respawn_at = case when p_monster_instance_state is null then current_monster_respawn_at
                              else (p_monster_instance_state ->> 'respawn_at')::timestamptz end
  where id = p_character_id
  returning gold, comet_count, fallen_star_count, comet_scroll_count, current_mp
  into v_gold, v_comets, v_fallen_stars, v_comet_scrolls, v_current_mp;

  return jsonb_build_object(
    'gold', v_gold,
    'comet_count', v_comets,
    'fallen_star_count', v_fallen_stars,
    'comet_scroll_count', v_comet_scrolls,
    'current_mp', v_current_mp,
    'character_kills', v_character_kills,
    'account_kills', v_account_kills,
    'granted_items', v_granted_items
  );
end;
$$;

revoke all on function public.resolve_combat_apply_results(
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb, numeric, jsonb
) from public;
grant execute on function public.resolve_combat_apply_results(
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb, numeric, jsonb
) to service_role;

commit;
