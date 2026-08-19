-- Announces pet obtains via global_announcements, same pattern as the
-- existing armor_socket/socket_dry_streak_end/lucky_* rows (see
-- 20260808050000_global_announcements.sql). Previously
-- resolve_combat_apply_results (20260821060000_consolidate_resolve_combat.sql)
-- granted the account_pets row silently -- no announcement went out.
--
-- Monster display name is looked up from enemy_types.display_name (the same
-- table PetToast.tsx's client-side "You obtained the <name> pet!" text is
-- ultimately sourced from via ENEMY_TYPES, kept in sync with this table --
-- see 20260813060000_rename_twistpath_monsters.sql for precedent reading
-- this column from plpgsql). `if found` after the ON CONFLICT DO NOTHING
-- insert guards against announcing a no-op on the (should-be-impossible,
-- since the client already checks !petAlreadyUnlocked before setting
-- p_pet_obtained) case of a duplicate grant.
--
-- Same signature as the existing resolve_combat_apply_results -- no
-- parameter list change, so create or replace is safe without a drop first.
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
  p_currency_drops jsonb default '[]'::jsonb
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
    if p_mode = 'live' then
      insert into public.item_instances (template_id, owner_id, level, quality_tier, composition_level, durability)
      values (
        (v_drop ->> 'template_id')::uuid,
        p_character_id,
        (v_drop ->> 'required_level')::integer,
        v_drop ->> 'quality_tier',
        (v_drop ->> 'composition_level')::integer,
        coalesce((v_drop ->> 'max_durability')::numeric, 0)
      )
      returning * into v_new_item;
      v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
    else
      insert into public.loot_holding (character_id, template_id, quality_tier, composition_level)
      values (
        p_character_id,
        (v_drop ->> 'template_id')::uuid,
        v_drop ->> 'quality_tier',
        (v_drop ->> 'composition_level')::integer
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
    comet_scroll_count = comet_scroll_count + p_comet_scroll_delta
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

commit;
