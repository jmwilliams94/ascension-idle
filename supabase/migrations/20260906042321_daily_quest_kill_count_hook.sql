-- Hooks the Kill Count daily quest into resolve_combat_apply_results -- the
-- single authoritative kill-recording path for both live and offline
-- resolution (see 20261228000000_daily_quests.sql). Full body copied
-- verbatim from 20261209020000_mp_potion_auto_use_offline.sql, with one line
-- added right after the existing character_monster_kills/account_monster_
-- kills upsert block: a per-monster daily-quest progress bump, matched
-- against whichever monster this call's p_kills_delta belongs to. Same
-- signature, same revoke/grant (service_role only, not SECURITY DEFINER --
-- called by resolve-combat's service-role client).
begin;

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
  p_max_mp numeric default null,
  p_mp_potions_consumed jsonb default '[]'::jsonb
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
  v_potion jsonb;
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

    -- Daily Quest hook: only actually bumps progress if this character has an
    -- unclaimed kill_count quest targeting this exact monster_id today.
    perform public.bump_daily_quest_progress(p_character_id, 'kill_count', p_monster_id, p_kills_delta);
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

  if jsonb_array_length(p_mp_potions_consumed) > 0 then
    for v_potion in select * from jsonb_array_elements(p_mp_potions_consumed)
    loop
      update public.potion_stacks
      set count = greatest(0, count - (v_potion ->> 'count')::integer)
      where id = (v_potion ->> 'stack_id')::uuid and character_id = p_character_id;
    end loop;
  end if;

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
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb, numeric, jsonb, numeric, jsonb
) from public;
grant execute on function public.resolve_combat_apply_results(
  uuid, uuid, text, text, numeric, integer, integer, integer, integer, integer, integer, jsonb, boolean, jsonb, jsonb, numeric, jsonb, numeric, jsonb
) to service_role;

commit;
