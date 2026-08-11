-- Security fix: `characters`/`item_instances`/`potion_stacks` all had table
-- grants to `authenticated` that were broader than their RLS policies
-- accounted for — RLS only ever checked row ownership, never which columns
-- or values were being written. A player could open devtools and use the
-- page's own already-authenticated Supabase client to set their own gold/
-- level directly, fabricate an Ascended+12+socketed item for free via a raw
-- INSERT, or grant themselves infinite potions — all reachable with a single
-- REST call under their own real session, no auth bypass needed. This
-- migration narrows every one of those grants to column-level (Postgres
-- `grant update (col1, col2, ...)`), closing the gap while leaving every
-- legitimate write path intact:
--   - `characters`: only session/cosmetic columns (zone, monster selection,
--     equip slots, last_active_at) stay directly writable; gold/level/exp/
--     class/every currency column now require the service_role
--     (resolve-combat) or a SECURITY DEFINER RPC, same as every other
--     currency-mutating system in this project already works.
--   - `item_instances`: direct client INSERT is revoked entirely. The one
--     remaining legitimate direct-insert path (Shop purchases) moves to the
--     new `shop_buy_item` RPC below, which validates cost/level/class
--     server-side and always creates a Normal-tier, uncomposed, unsocketed
--     item (matching what the old client insert always produced anyway).
--   - `potion_stacks`: direct client INSERT/UPDATE is revoked entirely,
--     replaced by the new `shop_buy_potion` RPC.
-- Also fixes a real, separate correctness bug found while tracing this:
-- `resolvePendingDrop`'s "discard an existing item to make room" flow called
-- a raw `item_instances` delete that was never actually granted to
-- `authenticated` at all (no `delete` grant exists anywhere in this
-- project's migration history) — so that discard button has always failed
-- silently. `shop_buy_item` below folds the discard into the same
-- SECURITY DEFINER transaction, fixing it for real.
begin;

-- 1. `characters` — narrow INSERT (character creation) and UPDATE (autosave/
--    equip) to column allowlists. Every column left out (gold/level/exp/
--    class/comet_count/fallen_star_count/etc.) now falls back to its table
--    default on insert, and can only change via service_role or a
--    SECURITY DEFINER RPC on update — Postgres rejects the whole statement
--    if a caller attempts to touch a column they don't have grant for, so
--    every client call site that used to send those fields has to stop
--    sending them (see the accompanying client changes).
revoke insert, update on public.characters from authenticated;

grant insert (account_id, slot_index, class, name) on public.characters to authenticated;

grant update (
  current_zone,
  selected_monster_id,
  equipped_weapon_id,
  equipped_ring_id,
  equipped_necklace_id,
  equipped_boots_id,
  equipped_hat_id,
  equipped_coat_id,
  equipped_quiver_id,
  last_active_at
) on public.characters to authenticated;

-- 2. Equip-slot ownership guard. Column-level grants alone don't stop a
--    player from writing *someone else's* item id into their own
--    equipped_weapon_id (still a permitted column above, correctly, since
--    equipping is a legitimate client-driven action) — resolve-combat reads
--    stats off whatever id sits in these columns with no ownership check of
--    its own (service-role, bypasses RLS), so a stolen id would silently
--    feed real combat math. This trigger fires on every UPDATE regardless of
--    which grant/RPC performed it, so it's a single point of enforcement.
create or replace function public.validate_equipped_item_ownership()
returns trigger
language plpgsql
as $$
begin
  if new.equipped_weapon_id is not null and new.equipped_weapon_id is distinct from old.equipped_weapon_id
     and not exists (select 1 from public.item_instances where id = new.equipped_weapon_id and owner_id = new.id) then
    raise exception 'equipped_weapon_id does not belong to this character';
  end if;
  if new.equipped_ring_id is not null and new.equipped_ring_id is distinct from old.equipped_ring_id
     and not exists (select 1 from public.item_instances where id = new.equipped_ring_id and owner_id = new.id) then
    raise exception 'equipped_ring_id does not belong to this character';
  end if;
  if new.equipped_necklace_id is not null and new.equipped_necklace_id is distinct from old.equipped_necklace_id
     and not exists (select 1 from public.item_instances where id = new.equipped_necklace_id and owner_id = new.id) then
    raise exception 'equipped_necklace_id does not belong to this character';
  end if;
  if new.equipped_boots_id is not null and new.equipped_boots_id is distinct from old.equipped_boots_id
     and not exists (select 1 from public.item_instances where id = new.equipped_boots_id and owner_id = new.id) then
    raise exception 'equipped_boots_id does not belong to this character';
  end if;
  if new.equipped_hat_id is not null and new.equipped_hat_id is distinct from old.equipped_hat_id
     and not exists (select 1 from public.item_instances where id = new.equipped_hat_id and owner_id = new.id) then
    raise exception 'equipped_hat_id does not belong to this character';
  end if;
  if new.equipped_coat_id is not null and new.equipped_coat_id is distinct from old.equipped_coat_id
     and not exists (select 1 from public.item_instances where id = new.equipped_coat_id and owner_id = new.id) then
    raise exception 'equipped_coat_id does not belong to this character';
  end if;
  if new.equipped_quiver_id is not null and new.equipped_quiver_id is distinct from old.equipped_quiver_id
     and not exists (select 1 from public.item_instances where id = new.equipped_quiver_id and owner_id = new.id) then
    raise exception 'equipped_quiver_id does not belong to this character';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_equipped_item_ownership_trigger on public.characters;
create trigger validate_equipped_item_ownership_trigger
  before update on public.characters
  for each row
  execute function public.validate_equipped_item_ownership();

-- 3. `item_instances` — revoke direct client INSERT entirely. Every
--    legitimate creation path already goes through service_role
--    (resolve-combat) or a SECURITY DEFINER RPC except Shop purchases and
--    starter-item granting at character creation, both replaced below.
revoke insert on public.item_instances from authenticated;

-- 4. `potion_stacks` — revoke direct client INSERT/UPDATE entirely. Only
--    legitimate write path (Shop potion purchase) replaced below; usePotion/
--    deleteStack already only ever DELETE, unaffected.
revoke insert, update on public.potion_stacks from authenticated;

-- 5. Shared inventory-room helper — the same "gear + stones + gems + potion
--    stacks + loose/scroll currency" formula draw_lucky_ticket already
--    computes inline, factored out so the two new RPCs below don't drift
--    from it independently.
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
  where owner_id = p_character_id and location <> 'bank' and not (id = any(v_equipped_ids));

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

-- 6. Starter-item grant (Hunter's Quiver + Lucky Bow), moved server-side —
--    the client used to INSERT these two rows directly right after character
--    creation (see useCharacterRosterStore.ts's grantStarterQuiver/
--    grantStarterBow), which only worked because of the now-revoked blanket
--    INSERT grant. Idempotent: refuses to grant twice (checked by
--    item_family, not just "class is hunter") so this can't be replayed to
--    farm free starter items.
create or replace function public.grant_starter_items(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_class text;
  v_already_granted boolean;
  v_quiver_id uuid;
  v_bow_id uuid;
  v_template record;
begin
  select account_id, class into v_account_id, v_class from public.characters where id = p_character_id for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_class <> 'hunter' then
    return jsonb_build_object('ok', true, 'granted', false);
  end if;

  select exists (
    select 1 from public.item_instances ii
    join public.item_templates it on it.id = ii.template_id
    where ii.owner_id = p_character_id and it.item_family in ('quiver', 'lucky-bow')
  ) into v_already_granted;

  if v_already_granted then
    return jsonb_build_object('ok', true, 'granted', false, 'error', 'already_granted');
  end if;

  select id, required_level into v_template from public.item_templates where name = 'Hunter''s Quiver';
  if found then
    insert into public.item_instances (template_id, owner_id, level, durability)
    values (v_template.id, p_character_id, v_template.required_level, 0)
    returning id into v_quiver_id;
  end if;

  select id, required_level, slot_type into v_template from public.item_templates where name = 'Lucky Bow';
  if found then
    insert into public.item_instances (template_id, owner_id, level, durability)
    values (v_template.id, p_character_id, v_template.required_level, coalesce(public.compute_max_durability(v_template.slot_type, v_template.required_level), 0))
    returning id into v_bow_id;
  end if;

  update public.characters
  set equipped_quiver_id = coalesce(v_quiver_id, equipped_quiver_id),
      equipped_weapon_id = coalesce(v_bow_id, equipped_weapon_id)
  where id = p_character_id;

  return jsonb_build_object('ok', true, 'granted', true, 'quiver_id', v_quiver_id, 'weapon_id', v_bow_id);
end;
$$;

revoke all on function public.grant_starter_items(uuid) from public;
grant execute on function public.grant_starter_items(uuid) to authenticated;

-- 7. Shop gear/weapon/armor/jeweller purchase — replaces the old client-side
--    "spendGold locally, then raw-insert item_instances" flow
--    (useInventoryStore.ts's grantItemDrop). Validates level/class/cost
--    server-side (none of which the old flow checked at the DB layer at
--    all), and always creates a Normal-tier, uncomposed, unsocketed item —
--    matching exactly what the old insert always produced, so this closes
--    the fabrication hole without changing what a legitimate purchase
--    yields. Optional discard params let the client resolve the existing
--    "inventory full, pick something to discard" modal in the same
--    transaction as the purchase (see this migration's header note about
--    the previously-broken discard delete).
create or replace function public.shop_buy_item(
  p_character_id uuid,
  p_template_id uuid,
  p_discard_item_id uuid default null,
  p_discard_potion_stack_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_class text;
  v_level integer;
  v_gold integer;
  v_price integer;
  v_required_level integer;
  v_required_class text;
  v_slot_type text;
  v_new_gold integer;
  v_occupied integer;
  v_equipped_ids uuid[];
  v_new_item public.item_instances%rowtype;
begin
  select account_id, class, level, gold,
         array_remove(array[equipped_weapon_id, equipped_ring_id, equipped_necklace_id, equipped_boots_id, equipped_hat_id, equipped_coat_id, equipped_quiver_id], null)
  into v_account_id, v_class, v_level, v_gold, v_equipped_ids
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select price, required_level, required_class, slot_type
  into v_price, v_required_level, v_required_class, v_slot_type
  from public.item_templates
  where id = p_template_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'template_not_found');
  end if;

  if v_required_class is not null and v_required_class <> v_class then
    return jsonb_build_object('ok', false, 'error', 'wrong_class');
  end if;

  if v_level < v_required_level then
    return jsonb_build_object('ok', false, 'error', 'level_too_low', 'required_level', v_required_level);
  end if;

  if v_gold < v_price then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'cost', v_price, 'gold', v_gold);
  end if;

  -- Discard (if the client is resolving a prior 'inventory_full' response)
  -- happens before the room re-check below, so freeing a slot here actually
  -- lets the purchase proceed. Ownership-scoped and excludes equipped items,
  -- same guard the old (never-actually-granted) client delete intended.
  if p_discard_item_id is not null then
    delete from public.item_instances
    where id = p_discard_item_id
      and owner_id = p_character_id
      and not (id = any (v_equipped_ids));
  end if;
  if p_discard_potion_stack_id is not null then
    delete from public.potion_stacks where id = p_discard_potion_stack_id and character_id = p_character_id;
  end if;

  v_occupied := public.occupied_inventory_slots(p_character_id);
  if v_occupied >= 40 then
    return jsonb_build_object('ok', false, 'error', 'inventory_full', 'template_id', p_template_id);
  end if;

  update public.characters set gold = gold - v_price where id = p_character_id
  returning gold into v_new_gold;

  insert into public.item_instances (template_id, owner_id, level, durability)
  values (p_template_id, p_character_id, v_required_level, coalesce(public.compute_max_durability(v_slot_type, v_required_level), 0))
  returning * into v_new_item;

  return jsonb_build_object('ok', true, 'item', to_jsonb(v_new_item), 'gold', v_new_gold);
end;
$$;

revoke all on function public.shop_buy_item(uuid, uuid, uuid, uuid) from public;
grant execute on function public.shop_buy_item(uuid, uuid, uuid, uuid) to authenticated;

-- 8. Shop potion purchase — replaces usePotionStore.buyPotions' direct
--    potion_stacks insert/update. Potion price/stackSize/requiredLevel have
--    no DB-side catalog (potionTypes.ts is a client-only constant, same as
--    every other "shared constant mirrored into SQL" pattern in this
--    project) — this table is a straight mirror and must stay in sync with
--    src/game/items/potionTypes.ts if that file ever changes.
create or replace function public.potion_type_info(p_potion_type text)
returns table (price integer, stack_size integer, required_level integer)
language plpgsql
as $$
begin
  return query select * from (values
    ('sprigroot_tonic', 3, 20, 1),
    ('verdant_balm', 6, 20, 20),
    ('emberleaf_draught', 12, 20, 40),
    ('ironbark_elixir', 20, 20, 60),
    ('stormroot_brew', 35, 20, 80),
    ('duskflame_panacea', 55, 20, 95),
    ('skyfire_elixir', 85, 20, 110),
    ('wyrmheart_draught', 130, 20, 125),
    ('mossglow_tonic', 3, 20, 1),
    ('whisperleaf_draught', 6, 20, 20),
    ('moonpetal_elixir', 12, 20, 40),
    ('starlight_brew', 20, 20, 60),
    ('emberwind_panacea', 35, 20, 80),
    ('nightbloom_draught', 55, 20, 95),
    ('voidglass_elixir', 85, 20, 110),
    ('astral_draught', 130, 20, 125)
  ) as t(potion_type, price, stack_size, required_level)
  where t.potion_type = p_potion_type;
end;
$$;

revoke all on function public.potion_type_info(text) from public;

create or replace function public.shop_buy_potion(p_character_id uuid, p_potion_type text, p_quantity integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_level integer;
  v_gold integer;
  v_info record;
  v_cost integer;
  v_new_gold integer;
  v_remaining integer;
  v_stack record;
  v_add integer;
  v_new_stacks_needed integer := 0;
  v_occupied integer;
begin
  if p_quantity is null or p_quantity <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  end if;

  select account_id, level, gold into v_account_id, v_level, v_gold
  from public.characters
  where id = p_character_id
  for update;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select * into v_info from public.potion_type_info(p_potion_type);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_potion_type');
  end if;

  if v_level < v_info.required_level then
    return jsonb_build_object('ok', false, 'error', 'level_too_low', 'required_level', v_info.required_level);
  end if;

  v_cost := v_info.price * p_quantity;
  if v_gold < v_cost then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'cost', v_cost, 'gold', v_gold);
  end if;

  -- Mirrors usePotionStore.buyPotions: top up existing non-full stacks of
  -- this type first, only then figure out how many brand-new stack rows
  -- (each occupying its own inventory slot) the remainder would need.
  v_remaining := p_quantity;
  for v_stack in
    select id, count from public.potion_stacks
    where character_id = p_character_id and potion_type = p_potion_type and count < v_info.stack_size
    for update
  loop
    exit when v_remaining <= 0;
    v_add := least(v_info.stack_size - v_stack.count, v_remaining);
    update public.potion_stacks set count = count + v_add where id = v_stack.id;
    v_remaining := v_remaining - v_add;
  end loop;

  if v_remaining > 0 then
    v_new_stacks_needed := ceil(v_remaining::numeric / v_info.stack_size);
    v_occupied := public.occupied_inventory_slots(p_character_id);
    if v_occupied + v_new_stacks_needed > 40 then
      return jsonb_build_object('ok', false, 'error', 'inventory_full');
    end if;

    while v_remaining > 0 loop
      v_add := least(v_info.stack_size, v_remaining);
      insert into public.potion_stacks (character_id, potion_type, count) values (p_character_id, p_potion_type, v_add);
      v_remaining := v_remaining - v_add;
    end loop;
  end if;

  update public.characters set gold = gold - v_cost where id = p_character_id
  returning gold into v_new_gold;

  return jsonb_build_object('ok', true, 'gold', v_new_gold);
end;
$$;

revoke all on function public.shop_buy_potion(uuid, text, integer) from public;
grant execute on function public.shop_buy_potion(uuid, text, integer) to authenticated;

-- 9. Consuming a potion (usePotionStore.usePotion) also directly UPDATEd
--    potion_stacks.count — the same now-revoked grant. Small, ownership-
--    checked decrement; refuses to go below 0 rather than relying on the
--    client to only call this when count > 0.
create or replace function public.use_potion_stack(p_stack_id uuid, p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_character_id uuid;
  v_account_id uuid;
  v_count integer;
  v_new_count integer;
begin
  select character_id, count into v_owner_character_id, v_count
  from public.potion_stacks
  where id = p_stack_id
  for update;

  if not found or v_owner_character_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if v_count <= 0 then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;

  update public.potion_stacks set count = count - 1 where id = p_stack_id
  returning count into v_new_count;

  return jsonb_build_object('ok', true, 'count', v_new_count);
end;
$$;

revoke all on function public.use_potion_stack(uuid, uuid) from public;
grant execute on function public.use_potion_stack(uuid, uuid) to authenticated;

commit;
