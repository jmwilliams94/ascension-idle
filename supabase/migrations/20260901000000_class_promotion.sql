-- Class Promotion (2026-09-01, requested by the user) — cosmetic-only title
-- progression, separate from combat/stats entirely. getAttributesForLevel's
-- curve already grants level-appropriate attributes unconditionally; this
-- does not change that (confirmed with the user: real Conquer doesn't gate
-- stats on promotion either).
--
-- Naming note: "promotion tier" already means something else in this
-- codebase (the unstored PROMOTION_TIER_ANCHORS EXP-pacing curve in
-- expCurve.ts/resolve-combat). The new stored column here is
-- `promotion_level` specifically to avoid that collision.
--
-- Data-driven via `promotion_tiers` so the other 3 classes (Trojan/Taoist/
-- Warrior — pending real reference data from the user) are a pure seed-row
-- addition later, no code changes. items_required/award_items are jsonb
-- arrays of {kind: 'item'|'currency', name, quantity} — 'currency' names are
-- one of 'gold'|'comet'|'fallen_star', mapping to the matching `characters`
-- column; 'item' names reference `item_templates.name`. skills_unlocked is
-- inert flavor text only (no ability/skill system exists yet, explicitly
-- deferred per CLAUDE.md) — stored for a future system to read, nothing
-- mechanical happens with it today.
--
-- Hunter is seeded with its 5 real tiers (15/40/70/100/110 — no level-120
-- promotion; matches both the real source game's actual promotion cap and
-- this project's own note that the level-120 attribute anchor is unsourced
-- extrapolation, not real data). All item/title names below are placeholder
-- text pulled directly from a reference screenshot, explicitly pending a
-- later rename pass by the user (this game's existing gear catalog is 100%
-- invented naming, not copied from the source game) — the mechanism is what
-- matters here, not the strings. base_stats for the two new gear items is
-- also PLACEHOLDER ('{}'), since the screenshot gave no stat numbers.
begin;

-- 1. Schema
alter table public.characters
  add column if not exists promotion_level integer not null default 0;

create table if not exists public.promotion_tiers (
  id uuid primary key default gen_random_uuid(),
  class text not null,
  level integer not null,
  title text not null,
  items_required jsonb not null default '[]'::jsonb,
  award_items jsonb not null default '[]'::jsonb,
  skills_unlocked text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (class, level)
);

alter table public.promotion_tiers enable row level security;

drop policy if exists "promotion_tiers_select_all" on public.promotion_tiers;
create policy "promotion_tiers_select_all"
  on public.promotion_tiers for select
  using (true);

-- New-table grant gotcha (CLAUDE.md) — RLS alone doesn't grant access.
grant select on public.promotion_tiers to anon, authenticated;
grant all on public.promotion_tiers to service_role;

-- 2. Seed: 6 new standalone item_templates rows for Hunter. Non-null
-- item_family on purpose (even the two real gear items) — the level-
-- appropriate kill-drop picker (pickLevelAppropriateTemplate in
-- useInventoryStore.ts, mirrored server-side) excludes by item_family
-- membership in NON_DROPPABLE_FAMILIES, and treats a null item_family as ''
-- which is NOT excluded by that check. Both new families are added to
-- NON_DROPPABLE_FAMILIES client-side and in resolve-combat's mirror.
insert into public.item_templates (name, slot_type, item_family, required_class, required_level, base_stats, price)
select v.name, v.slot_type, v.item_family, 'hunter', v.required_level, '{}'::jsonb, 0
from (values
  ('Deerskin Coat', 'coat',   'promotion-gear',     15),
  ('Horn Bow',      'weapon', 'promotion-gear',     40),
  ('Euxenite Ore',  'promotion-material', 'promotion-material', 40),
  ('Emerald',       'promotion-material', 'promotion-material', 70),
  ('Rainbow Gem',   'promotion-material', 'promotion-material', 100),
  ('Moon Box',      'promotion-material', 'promotion-material', 110)
) as v(name, slot_type, item_family, required_level)
where not exists (select 1 from public.item_templates where name = v.name);

-- 3. Seed: Hunter's 5 promotion tiers. Tier 70's award list ("Senior Fly,
-- Arrow Rain" in the source data) is both Archer skill names, not items —
-- award_items is empty there, both go to skills_unlocked instead. Tier 100's
-- cost ("Meteor") and tier 110's award ("Dragon Ball") are this game's own
-- pre-rename names for Comet/Fallen Star (see CLAUDE.progression.md) —
-- wired as real currency, not new items.
insert into public.promotion_tiers (class, level, title, items_required, award_items, skills_unlocked)
values
  ('hunter', 15,  'Archer',        '[]'::jsonb,
     '[{"kind":"item","name":"Deerskin Coat","quantity":1}]'::jsonb,
     array['Primary Fly']),
  ('hunter', 40,  'Eagle Archer',  '[{"kind":"item","name":"Euxenite Ore","quantity":5}]'::jsonb,
     '[{"kind":"item","name":"Horn Bow","quantity":1}]'::jsonb,
     array[]::text[]),
  ('hunter', 70,  'Tiger Archer',  '[{"kind":"item","name":"Emerald","quantity":1}]'::jsonb,
     '[]'::jsonb,
     array['Senior Fly', 'Arrow Rain']),
  ('hunter', 100, 'Dragon Archer', '[{"kind":"currency","name":"comet","quantity":1}]'::jsonb,
     '[{"kind":"item","name":"Rainbow Gem","quantity":1}]'::jsonb,
     array[]::text[]),
  ('hunter', 110, 'Archer Master', '[{"kind":"item","name":"Moon Box","quantity":1}]'::jsonb,
     '[{"kind":"currency","name":"fallen_star","quantity":1}]'::jsonb,
     array[]::text[])
on conflict (class, level) do nothing;

-- 4. RPC. Guaranteed success once level + affordability are met (no RNG,
-- matches Master Forge's guaranteed-upgrade idiom) — cost is only ever
-- consumed after every requirement in the tier has already been confirmed
-- affordable and award room has been confirmed available, so there's no
-- partial-completion window (same all-or-nothing discipline as every other
-- Forge RPC / ensure_loose_currency).
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
  i integer;
begin
  select account_id, class, level, promotion_level, gold, comet_count, fallen_star_count,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
           null
         )
  into v_account_id, v_class, v_char_level, v_promotion_level, v_gold, v_comet_count, v_fallen_star_count,
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
  -- attempt's own item-kind cost consumption will free up (same net-delta
  -- discipline as ensure_loose_currency's own room-check fix, not the
  -- naive gross check that's been a recurring bug in this codebase).
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
    'fallen_star_count', v_fallen_star_count
  );
end;
$$;

revoke all on function public.promote_character(uuid) from public;
grant execute on function public.promote_character(uuid) to authenticated;

-- 5. Mirror the new non-droppable families into pick_drop_template's own
-- exclusion list (supabase/migrations/20260821060000_consolidate_resolve_combat.sql)
-- — this is the actual server-side counterpart of client-side
-- NON_DROPPABLE_FAMILIES (useInventoryStore.ts's pickLevelAppropriateTemplate
-- is prediction-only; pick_drop_template is what resolve-combat really calls
-- to grant a drop). Signature is unchanged, so plain create-or-replace is
-- safe (no overload risk, per CLAUDE.md's function-signature-change gotcha).
create or replace function public.pick_drop_template(p_class text, p_level integer)
returns jsonb
language plpgsql
as $$
declare
  v_family text;
  v_result jsonb;
begin
  select item_family into v_family
  from public.item_templates
  where item_family is not null
    and item_family not in ('sword', 'quiver', 'lucky-bow', 'money-bag', 'gem-bag', 'promotion-gear', 'promotion-material')
    and (required_class is null or required_class = p_class)
  group by item_family
  order by random()
  limit 1;

  if v_family is null then
    return null;
  end if;

  select jsonb_build_object('id', id, 'required_level', required_level, 'slot_type', slot_type)
  into v_result
  from public.item_templates
  where item_family = v_family
    and (required_class is null or required_class = p_class)
  order by abs(required_level - p_level)
  limit 1;

  return v_result;
end;
$$;

revoke all on function public.pick_drop_template(text, integer) from public;
grant execute on function public.pick_drop_template(text, integer) to service_role;

commit;
