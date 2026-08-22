-- Fixes a real regression (reported by the user: buying a Pickaxe from the
-- Shop "did nothing", then "something went wrong" once error surfacing was
-- added) -- occupied_inventory_slots still referenced characters.equipped_pickaxe_id
-- in its equipped-ids exclusion array, but that column was dropped in
-- 20260930030000_pickaxe_as_normal_weapon.sql. Every call to this function
-- since then raised "column c.equipped_pickaxe_id does not exist", which
-- silently broke it for EVERY caller, not just Pickaxe purchases -- both
-- shop_buy_item and shop_buy_potion call it for their room check, so this
-- broke the Shop's Weapons/Armor/Jeweller purchases AND potion purchases
-- app-wide the moment that migration applied. Fix: drop the dead column
-- reference. Body otherwise an unchanged copy of the latest version
-- (20260928000000_pickaxe_shop_purchase.sql).
create or replace function public.occupied_inventory_slots(p_character_id uuid)
returns integer
language plpgsql
as $$
declare
  v_gear_count integer;
  v_stone_count integer;
  v_gem_count integer;
  v_potion_count integer;
  v_composition_stones jsonb;
  v_gems jsonb;
  v_comet_count integer;
  v_fallen_star_count integer;
  v_comet_scroll_count integer;
  v_fallen_star_scroll_count integer;
  v_equipped_ids uuid[];
begin
  select composition_stones, gems, comet_count, fallen_star_count, comet_scroll_count, fallen_star_scroll_count,
         array_remove(
           array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id,
                 equipped_hat_id, equipped_coat_id, equipped_quiver_id],
           null
         )
  into v_composition_stones, v_gems, v_comet_count, v_fallen_star_count, v_comet_scroll_count, v_fallen_star_scroll_count,
       v_equipped_ids
  from public.characters
  where id = p_character_id;

  select count(*) into v_gear_count
  from public.item_instances
  where owner_id = p_character_id and location <> 'bank' and not (id = any(v_equipped_ids))
    and id not in (select item_id from public.marketplace_listings where status = 'active' and item_id is not null)
    and id not in (select item_id from public.mail where item_id is not null and claimed_at is null);

  select coalesce(sum((value)::integer), 0) into v_stone_count
  from jsonb_each_text(coalesce(v_composition_stones, '{}'::jsonb));

  select coalesce(sum((value)::integer), 0) into v_gem_count
  from jsonb_each_text(coalesce(v_gems, '{}'::jsonb));

  select count(*) into v_potion_count
  from public.potion_stacks where character_id = p_character_id and count > 0;

  return v_gear_count + v_stone_count + v_gem_count + v_potion_count
    + coalesce(v_comet_count, 0) + coalesce(v_fallen_star_count, 0)
    + coalesce(v_comet_scroll_count, 0) + coalesce(v_fallen_star_scroll_count, 0);
end;
$$;

revoke all on function public.occupied_inventory_slots(uuid) from public;
