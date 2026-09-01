-- Two compounding MP bugs, both reported by the user as "mana rubber-banding
-- / not draining at all" (still happening after the 20261130010000 delta
-- fix, which only addressed a *different* concurrent-write race):
--
-- 1. Potion overfill: use_potion_stack's MP restore
--    (`current_mp = current_mp + v_restore_amount`, 20261112000000) has no
--    ceiling at the character's real max MP. Drinking almost any potion
--    before the pool is fully empty pushes current_mp above max (routine,
--    not an edge case -- e.g. +200 from a Moonpetal Elixir on a 250-max pool
--    already sitting at 90% lands at 275). resolve-combat's own *read* side
--    already clamps this for gating math (`Math.min(current_mp ?? maxMp,
--    maxMp)`), so it was never an exploit -- but the *write* it persists
--    back (current_mp minus this call's real spend) still starts from the
--    unclamped, overfull baseline. The client clamps for display
--    (syncPlayerMp), so the bar reads "100%" the whole time current_mp
--    stays above max -- real spend keeps landing but produces no visible
--    movement ("not consuming at all") until enough of it accumulates to
--    finally drag the true value back under max. Meanwhile the client's own
--    *local* per-attack prediction (useCombatStore.runTick) has no ceiling
--    baked in from the stale-overfull server value, so it visibly ticks
--    down between resolves -- and then snaps back up to the clamped 100%
--    the moment the next resolve response lands, reading as "rubber-
--    banding."
--
-- 2. NULL-current_mp on first-ever spend: current_mp starts NULL (a null
--    column means "presumed full," see rescale_mp_potions.sql) and is only
--    ever populated by this function's own write, once a character's first
--    MP-costing resolve call happens. But `greatest(0, current_mp -
--    p_mp_spent)` with current_mp still NULL evaluates to `greatest(0,
--    NULL)` -- Postgres's GREATEST/LEAST ignore NULL arguments rather than
--    propagating them, so this returned 0, not `maxMp - p_mp_spent` like the
--    read side (`current_mp ?? maxMp`) assumes. A brand-new Wuxia's very
--    first real attack permanently zeroed their MP pool instead of properly
--    initializing it -- and since 0 is a real (non-null) value, no further
--    resolve call could ever recover it (mpAffordableAttackMs computes to 0
--    forever, so the skill can never land another hit) without an MP potion
--    topping it back up from scratch.
--
-- Fix: resolve-combat now also passes p_max_mp (computed server-side from
-- real attributes, same as always) alongside p_mp_spent. current_mp is
-- coalesced against it (treating NULL as "presumed full," matching the read
-- side and the documented column convention) *before* subtracting, and the
-- result is clamped to it *after* subtracting -- fixing both the NULL-init
-- case and any accumulated potion overfill in one write, self-correcting on
-- this character's very next MP-costing resolve call with no backfill
-- needed. use_potion_stack itself is left as an unclamped add (computing a
-- real max MP there would mean duplicating the whole attribute/derived-
-- stats interpolation table into SQL just for this) -- an overfill from it
-- is now only ever a *transient* window until the next resolve tick, not a
-- permanent one.
begin;

-- Signature change (added p_max_mp) -- explicit drop first, see CLAUDE.md's
-- own gotcha (create-or-replace with a different argument list creates an
-- ambiguous overload rather than a replacement).
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
  p_monster_instance_state jsonb default null,
  p_max_mp numeric default null
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
  -- confirmed to fit at roll time -- see resolve-combat's own room-check),
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

  -- Currency drops: offline mode only (loot_holding routing) -- live mode
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
    -- Delta off a NULL-coalesced ("presumed full," matching the read side
    -- and the documented column convention) starting value, then clamped to
    -- p_max_mp -- see this migration's own header for the two bugs this
    -- closes (NULL-init zeroing, and unclamped potion-restore overfill).
    current_mp = case
      when p_mp_spent is null then current_mp
      else least(greatest(0, coalesce(current_mp, p_max_mp) - p_mp_spent), p_max_mp)
    end,
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
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb, numeric, jsonb, numeric
) from public;
grant execute on function public.resolve_combat_apply_results(
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb, numeric, jsonb, numeric
) to service_role;

commit;
