-- Kill Count achievement tier-6 reward (claim_kill_count_reward via
-- pick_infused_reward_template) and Lucky Lad's Ascended-random reward
-- (draw_lucky_ticket's gear_ascended_random kind via
-- pick_ascended_reward_template) could roll Ore/Pickaxe/promotion-gear/
-- promotion-material as their "random class-appropriate family" pick --
-- neither function's exclusion list was ever updated to match
-- pick_drop_template's, which got this same fix when the Ore catalog was
-- added (20260926010000_add_mining_ore_catalog.sql). Produced e.g. "Infused
-- Iron Ore (Rank 1)" for a real player (Vegemite, venomkin tier-6 claim) and
-- an "Infused Lunar Chest" on the admin test account (Switchee) -- both
-- confirmed via character_monster_kills.claimed_tier_index = 6 correlating
-- with the item_instances row's created_at (quality_tier = 'infused' is a
-- literal only ever written by claim_kill_count_reward's tier-6 branch).
-- See CLAUDE.achievements-and-pets.md's "gear only" rule.
begin;

-- 1. Root cause: bring both functions' exclusion lists in line with
--    pick_drop_template's. Same signatures, plain create-or-replace is safe.
create or replace function public.pick_infused_reward_template(p_character_class text, p_monster_level integer)
returns uuid language plpgsql as $$
declare v_family text; v_template_id uuid;
begin
  select item_family into v_family from public.item_templates
  where (required_class is null or required_class = p_character_class)
    and item_family not in ('sword', 'quiver', 'lucky-bow', 'money-bag', 'gem-bag', 'promotion-gear', 'promotion-material', 'pickaxe', 'ore')
  group by item_family order by random() limit 1;
  if v_family is null then return null; end if;
  select id into v_template_id from public.item_templates
  where item_family = v_family
  order by abs(required_level - p_monster_level) asc limit 1;
  return v_template_id;
end; $$;

create or replace function public.pick_ascended_reward_template(p_character_class text)
returns uuid
language plpgsql
as $$
declare
  v_family text;
  v_template_id uuid;
begin
  select item_family into v_family
  from public.item_templates
  where (required_class is null or required_class = p_character_class)
    and item_family not in ('sword', 'quiver', 'lucky-bow', 'money-bag', 'gem-bag', 'promotion-gear', 'promotion-material', 'pickaxe', 'ore')
    and required_level between 15 and 70
  group by item_family
  order by random()
  limit 1;

  if v_family is null then
    return null;
  end if;

  select id into v_template_id
  from public.item_templates
  where item_family = v_family
    and required_level between 15 and 70
  order by random()
  limit 1;

  return v_template_id;
end;
$$;

-- 2. Data fix: the two already-granted bad rows. Re-roll each through the
--    now-fixed pick_infused_reward_template and convert the instance in
--    place (same id, so it doesn't move slot/location) rather than
--    deleting+remailing.
do $$
declare
  v_template_id uuid;
  v_slot_type text;
  v_required_level integer;
begin
  -- Vegemite (b2e8fb7a-8eff-4507-8fc5-f872244e5bbc), venomkin tier-6 claim
  -- (monster level 65), wuxia class.
  v_template_id := public.pick_infused_reward_template('wuxia', 65);
  if v_template_id is not null then
    select slot_type, required_level into v_slot_type, v_required_level
    from public.item_templates where id = v_template_id;

    update public.item_instances
    set template_id = v_template_id,
        level = v_required_level,
        durability = coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0)
    where id = '2201de42-1c7a-4883-ac19-24377b8e9ac9';
  end if;

  -- Switchee (4bd099d2-3906-4d29-b303-ac7eb4c85077), admin test account,
  -- hunter class, level 130.
  v_template_id := public.pick_infused_reward_template('hunter', 130);
  if v_template_id is not null then
    select slot_type, required_level into v_slot_type, v_required_level
    from public.item_templates where id = v_template_id;

    update public.item_instances
    set template_id = v_template_id,
        level = v_required_level,
        durability = coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0)
    where id = '0bf6b517-75e3-4d14-92f0-eb7a58e65c8c';
  end if;
end $$;

commit;
