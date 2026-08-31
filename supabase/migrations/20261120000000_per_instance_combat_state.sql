-- Per-instance Hunting combat resolution (see CLAUDE.combat-and-loot.md) —
-- replaces resolve-combat's old closed-form "expected kills = elapsedMs /
-- blended-average cycle time" reward model with a real per-monster-instance
-- discrete-event walk. Root cause of the old model: it used a blended-average
-- monster HP (assumes ~5% rare chance) rather than tracking whether the
-- specific instance being fought is actually rare, so a genuinely longer real
-- rare fight could cross two whole-kill thresholds (2 toasts for one fight)
-- or credit a kill before the real one finished — reported by the user.
--
-- These 5 new characters columns mirror useCombatStore.ts's own client-side
-- instance state (currentHp/isRareInstance/currentMonsterSpawnedAt/
-- respawnReadyAt) as the new server-side source of truth for reward
-- crediting. No `max_hp` column needed — derivable from enemy_types.max_hp +
-- current_monster_is_rare, same as the client derives it.
begin;

alter table public.characters
  add column if not exists current_monster_id text,
  add column if not exists current_monster_hp numeric,
  add column if not exists current_monster_is_rare boolean not null default false,
  add column if not exists current_monster_spawned_at timestamptz,
  add column if not exists current_monster_respawn_at timestamptz;

-- resolve_combat_gather_state needs no change — it already does
-- `select to_jsonb(c) ... from characters c`, a full-row snapshot, so these
-- new columns land in its response automatically.

-- Signature change (new trailing p_monster_instance_state param) — explicit
-- drop first, see CLAUDE.md's own gotcha (create-or-replace with a different
-- signature creates a second, ambiguous overload instead of replacing it).
drop function if exists public.resolve_combat_apply_results(
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb, numeric
);

-- Full body otherwise copied verbatim from
-- 20261110020000_drop_durability_roll.sql (the function's current latest
-- definition) — only the new trailing p_monster_instance_state param and its
-- update-block addition are new. p_kills_delta goes back to meaning a plain
-- whole-integer per-call increment (the walk now tracks partial progress via
-- current_monster_hp instead of a fractional running kill-count total).
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
  p_current_mp numeric default null,
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
    current_mp = coalesce(p_current_mp, current_mp),
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
  returning gold, comet_count, fallen_star_count, comet_scroll_count
  into v_gold, v_comets, v_fallen_stars, v_comet_scrolls;

  return jsonb_build_object(
    'gold', v_gold,
    'comet_count', v_comets,
    'fallen_star_count', v_fallen_stars,
    'comet_scroll_count', v_comet_scrolls,
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
