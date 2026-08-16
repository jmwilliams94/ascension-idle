-- Follow-up to the Class Promotion feature (requested by the user), before
-- any of it ships: several of the standalone promotion items turned out to
-- duplicate or belong to other systems, and titles get one more rename pass.
--
-- Deleted (never granted to a real player yet, safe to remove outright):
--   Doeskin Mantle -> tier 15 award now grants the REAL existing level-15
--     Hunter coat, 'Fawnhide Coat' (already in the gear catalog), instead of
--     a duplicate standalone item.
--   Antler Bow -> tier 40 award now grants the REAL existing level-45 Hunter
--     bow, 'Ram''s Horn Bow', instead of a duplicate standalone item.
--   Opaline Gem -> tier 100 award now grants 1 Tempered Iris Gem (the real
--     Gem system, characters.gems) instead of a standalone item — see the
--     new kind='gem' branch in promote_character below.
--
-- Kept, but their acquisition path is reassigned to a different system
-- (still exist as item_templates rows, just not promotion-exclusive):
--   Umbrite Ore -> intended as a future Mining drop (Idling tab). No
--     acquisition path exists yet — tier 40 is simply unobtainable until
--     Mining ships. Not a bug, a known/accepted gap.
--   Jade Shard -> now a real flat per-kill drop (1/300, PLACEHOLDER rate)
--     from exactly 3 specific monsters (frostpelt/venomkin/dunecrawler,
--     levels 60/65/67) — see combatResolver.ts/resolve-combat/index.ts for
--     the actual roll (same independent-per-kill-roll shape as Comet/Fallen
--     Star, just monster-id-scoped and item-granting instead of currency).
--   Moon Box -> re-added (was renamed away to 'Lunar Coffer' in the previous
--     migration; that rename is reverted here since the user referred to it
--     by its original name) as a Lucky Lad reward — see the next migration,
--     20260901030000_moonbox_lucky_reward.sql.
--
-- Titles: replaced "Warden" with "Hunter" as the base noun throughout, per
-- the user's explicit list — Novice Hunter (start) -> Hunter (15) -> Falcon
-- Hunter (40) -> Panther Hunter (70) -> Wyrm Hunter (100) -> Grand Hunter
-- (110). Level 15 itself wasn't in the user's list but follows the same
-- substitution and matches the real game's own convention of the tier-15
-- title equaling the base class name.
begin;

-- Doeskin Mantle / Antler Bow / Opaline Gem never got instantiated (no real
-- players yet) — plain delete, no item_instances cleanup needed, but a
-- defensive delete-instances-first costs nothing if that assumption is ever
-- wrong.
delete from public.item_instances where template_id in (
  select id from public.item_templates where name in ('Doeskin Mantle', 'Antler Bow', 'Opaline Gem')
);
delete from public.item_templates where name in ('Doeskin Mantle', 'Antler Bow', 'Opaline Gem');

-- Revert the previous migration's Moon Box -> Lunar Coffer rename — the user
-- referred to it by its original name when assigning it a real acquisition
-- path (Lucky Lad), so keep that name. Tier 110's items_required jsonb was
-- updated to say "Lunar Coffer" by that same earlier migration, so it needs
-- updating back to "Moon Box" too (below, alongside the title rename) or
-- promote_character would look up a template name that no longer exists.
update public.item_templates set name = 'Moon Box' where name = 'Lunar Coffer';

-- Jade Shard: real item now, monster-specific flat-chance drop (not the
-- generic level-appropriate-family picker — 'promotion-material' stays in
-- NON_DROPPABLE_FAMILIES/pick_drop_template's exclusion list so the generic
-- picker never selects it; only the bespoke per-kill roll in
-- resolve-combat/index.ts and combatResolver.ts grants it).
insert into public.item_templates (name, slot_type, item_family, required_class, required_level, base_stats, price)
select 'Jade Shard', 'promotion-material', 'promotion-material', null, 65, '{}'::jsonb, 0
where not exists (select 1 from public.item_templates where name = 'Jade Shard');

update public.promotion_tiers set
  title = 'Hunter',
  award_items = '[{"kind":"item","name":"Fawnhide Coat","quantity":1}]'::jsonb
where class = 'hunter' and level = 15;

update public.promotion_tiers set
  title = 'Falcon Hunter',
  award_items = '[{"kind":"item","name":"Ram''s Horn Bow","quantity":1}]'::jsonb
where class = 'hunter' and level = 40;

update public.promotion_tiers set
  title = 'Panther Hunter'
where class = 'hunter' and level = 70;

update public.promotion_tiers set
  title = 'Wyrm Hunter',
  award_items = '[{"kind":"gem","name":"iris_tempered","quantity":1}]'::jsonb
where class = 'hunter' and level = 100;

update public.promotion_tiers set
  title = 'Grand Hunter',
  items_required = '[{"kind":"item","name":"Moon Box","quantity":1}]'::jsonb
where class = 'hunter' and level = 110;

-- promote_character: full-body copy of the previous migration's version,
-- adding gems read/write (v_gems, selected alongside gold/comet/fallen_star,
-- written via the same read-modify-write jsonb_set idiom draw_lucky_ticket
-- already uses for gem grants) plus a new kind='gem' branch in the
-- award-granting loop. 'name' for a gem award is a gemStorageKey-format
-- string ("<gemId>_<tier>", e.g. "iris_tempered" — see gemCatalog.ts).
-- Same 1-arg signature — create or replace is safe.
create or replace function public.promote_character(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_class text;
  v_char_level integer;
  v_promotion_level integer;
  v_gold integer;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_gems jsonb;
  v_equipped_ids uuid[];
  v_tier record;
  v_item jsonb;
  v_kind text;
  v_name text;
  v_qty integer;
  v_template_id uuid;
  v_owned_count integer;
  v_ensure_result jsonb;
  v_occupied integer;
  v_gear_count integer;
  v_stone_count integer;
  v_potion_count integer;
  v_freed_by_cost integer;
  v_award_room_needed integer;
  v_new_item public.item_instances%rowtype;
  v_granted_items jsonb := '[]'::jsonb;
  v_consumed jsonb := '[]'::jsonb;
  v_required_level integer;
  v_slot_type text;
  v_max_durability numeric;
  v_ids uuid[];
  v_gem_owned integer;
  i integer;
begin
  select account_id, class, level, promotion_level, gold, comet_count, fallen_star_count, gems,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
           null
         )
  into v_account_id, v_class, v_char_level, v_promotion_level, v_gold, v_comet_count, v_fallen_star_count, v_gems,
       v_equipped_ids
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select * into v_tier
  from public.promotion_tiers
  where class = v_class and level > v_promotion_level
  order by level asc
  limit 1;

  if v_tier is null then
    return jsonb_build_object('ok', false, 'error', 'no_further_promotion');
  end if;

  if v_char_level < v_tier.level then
    return jsonb_build_object('ok', false, 'error', 'level_too_low', 'required_level', v_tier.level);
  end if;

  -- Pass 1: affordability only, no mutation yet.
  for v_item in select * from jsonb_array_elements(v_tier.items_required)
  loop
    v_kind := v_item ->> 'kind';
    v_name := v_item ->> 'name';
    v_qty := (v_item ->> 'quantity')::integer;

    if v_kind = 'currency' then
      if v_name = 'gold' then
        if v_gold < v_qty then
          return jsonb_build_object('ok', false, 'error', 'cannot_afford', 'missing', v_name, 'needed', v_qty, 'owned', v_gold);
        end if;
      elsif v_name in ('comet', 'fallen_star') then
        v_ensure_result := public.ensure_loose_currency(p_character_id, v_name, v_qty);
        if not (v_ensure_result ->> 'ok')::boolean then
          return jsonb_build_object('ok', false, 'error', 'not_enough_room_to_unbundle');
        end if;

        if v_name = 'comet' then
          select comet_count into v_comet_count from public.characters where id = p_character_id;
          if v_comet_count < v_qty then
            return jsonb_build_object('ok', false, 'error', 'cannot_afford', 'missing', v_name, 'needed', v_qty, 'owned', v_comet_count);
          end if;
        else
          select fallen_star_count into v_fallen_star_count from public.characters where id = p_character_id;
          if v_fallen_star_count < v_qty then
            return jsonb_build_object('ok', false, 'error', 'cannot_afford', 'missing', v_name, 'needed', v_qty, 'owned', v_fallen_star_count);
          end if;
        end if;
      end if;
    elsif v_kind = 'item' then
      select id into v_template_id from public.item_templates where name = v_name;
      if v_template_id is null then
        return jsonb_build_object('ok', false, 'error', 'template_missing', 'missing', v_name);
      end if;

      select count(*) into v_owned_count
      from public.item_instances
      where owner_id = p_character_id
        and template_id = v_template_id
        and location <> 'bank'
        and not (id = any(v_equipped_ids));

      if v_owned_count < v_qty then
        return jsonb_build_object('ok', false, 'error', 'cannot_afford', 'missing', v_name, 'needed', v_qty, 'owned', v_owned_count);
      end if;
    end if;
  end loop;

  -- Room check for item-kind award_items, net of the slots this same
  -- attempt's own item-kind cost consumption will free up.
  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id and location <> 'bank' and not (id = any(v_equipped_ids));

  select coalesce(sum((value)::integer), 0) into v_stone_count
  from public.characters, jsonb_each_text(composition_stones)
  where id = p_character_id;

  select count(*) into v_potion_count
  from public.potion_stacks ps
  where ps.character_id = p_character_id and ps.count > 0;

  v_occupied := v_gear_count + v_stone_count + v_potion_count + v_comet_count + v_fallen_star_count;

  select coalesce(sum((value ->> 'quantity')::integer), 0) into v_freed_by_cost
  from jsonb_array_elements(v_tier.items_required)
  where value ->> 'kind' = 'item';

  select coalesce(sum((value ->> 'quantity')::integer), 0) into v_award_room_needed
  from jsonb_array_elements(v_tier.award_items)
  where value ->> 'kind' = 'item';

  if (v_occupied - v_freed_by_cost + v_award_room_needed) > 40 then
    return jsonb_build_object('ok', false, 'error', 'not_enough_room');
  end if;

  -- Pass 2: consume items_required.
  for v_item in select * from jsonb_array_elements(v_tier.items_required)
  loop
    v_kind := v_item ->> 'kind';
    v_name := v_item ->> 'name';
    v_qty := (v_item ->> 'quantity')::integer;

    if v_kind = 'currency' then
      if v_name = 'gold' then
        update public.characters set gold = gold - v_qty where id = p_character_id returning gold into v_gold;
      elsif v_name = 'comet' then
        update public.characters set comet_count = comet_count - v_qty where id = p_character_id returning comet_count into v_comet_count;
      elsif v_name = 'fallen_star' then
        update public.characters set fallen_star_count = fallen_star_count - v_qty where id = p_character_id returning fallen_star_count into v_fallen_star_count;
      end if;
      v_consumed := v_consumed || jsonb_build_array(jsonb_build_object('kind', 'currency', 'name', v_name, 'quantity', v_qty));
    elsif v_kind = 'item' then
      select id into v_template_id from public.item_templates where name = v_name;

      select array_agg(id) into v_ids from (
        select id from public.item_instances
        where owner_id = p_character_id and template_id = v_template_id
          and location <> 'bank' and not (id = any(v_equipped_ids))
        order by created_at asc
        limit v_qty
      ) as t;

      delete from public.item_instances where id = any(v_ids);
      v_consumed := v_consumed || jsonb_build_array(jsonb_build_object('kind', 'item', 'name', v_name, 'quantity', v_qty, 'item_ids', to_jsonb(v_ids)));
    end if;
  end loop;

  -- Grant award_items.
  for v_item in select * from jsonb_array_elements(v_tier.award_items)
  loop
    v_kind := v_item ->> 'kind';
    v_name := v_item ->> 'name';
    v_qty := (v_item ->> 'quantity')::integer;

    if v_kind = 'currency' then
      if v_name = 'gold' then
        update public.characters set gold = gold + v_qty where id = p_character_id returning gold into v_gold;
      elsif v_name = 'comet' then
        update public.characters set comet_count = comet_count + v_qty where id = p_character_id returning comet_count into v_comet_count;
      elsif v_name = 'fallen_star' then
        update public.characters set fallen_star_count = fallen_star_count + v_qty where id = p_character_id returning fallen_star_count into v_fallen_star_count;
      end if;
    elsif v_kind = 'gem' then
      v_gem_owned := coalesce((v_gems ->> v_name)::integer, 0);
      v_gems := jsonb_set(coalesce(v_gems, '{}'::jsonb), array[v_name], to_jsonb(v_gem_owned + v_qty));
      update public.characters set gems = v_gems where id = p_character_id;
    elsif v_kind = 'item' then
      select id, required_level, slot_type into v_template_id, v_required_level, v_slot_type
      from public.item_templates where name = v_name;

      -- compute_max_durability returns null for a slot_type it doesn't
      -- recognize (e.g. 'promotion-material') — coalesce to 0, matching the
      -- Quiver precedent (no durability). Gear slot_types ('coat'/'weapon')
      -- get a real value, so a freshly-granted item never renders with the
      -- broken badge.
      v_max_durability := coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0);

      for i in 1..v_qty loop
        insert into public.item_instances (template_id, owner_id, quality_tier, level, sockets, durability)
        values (v_template_id, p_character_id, 'normal', v_required_level, '[]'::jsonb, v_max_durability)
        returning * into v_new_item;
        v_granted_items := v_granted_items || jsonb_build_array(to_jsonb(v_new_item));
      end loop;
    end if;
  end loop;

  update public.characters set promotion_level = v_tier.level where id = p_character_id;

  return jsonb_build_object(
    'ok', true,
    'title', v_tier.title,
    'promotion_level', v_tier.level,
    'skills_unlocked', v_tier.skills_unlocked,
    'consumed', v_consumed,
    'granted_items', v_granted_items,
    'gold', v_gold,
    'comet_count', v_comet_count,
    'fallen_star_count', v_fallen_star_count,
    'gems', v_gems
  );
end;
$$;

revoke all on function public.promote_character(uuid) from public;
grant execute on function public.promote_character(uuid) to authenticated;

commit;
