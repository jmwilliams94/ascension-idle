-- Quiver (and anything else with no durability concept -- Money Bag, Gem
-- Bag, Comet Box, Skill items, Pickaxe) has always stored a real numeric 0 in
-- item_instances.durability at creation, purely because every one of the
-- ~10 item-creation RPCs (grant_starter_items, claim_loot_holding, sell_item,
-- draw_lucky_ticket(_bulk), withdraw_gear_composition, admin_send_mail,
-- claim_kill_count_reward, shop_buy_item(_bulk), promote_character) coalesces
-- compute_max_durability()'s null return down to 0 -- the column was NOT
-- NULL. That 0 is never actually read by anything: client itemHasDurability()
-- and every "is this item broken" tile/tooltip check already gate on the
-- item's own slot_type having a durability concept at all (see
-- src/game/items/equipmentBonus.ts), and Zone Boss's quiver_required check
-- only looks at whether equipped_quiver_id is set, not its durability. But a
-- raw DB read of a Quiver row shows "durability: 0", which reads exactly
-- like a genuinely-broken item and caused a real misdiagnosis (Switchee's
-- Quiver, 2026-11-17) before the mistake was caught by tracing every
-- consumer. Fixed once at the column level with a trigger, instead of
-- patching every creation RPC individually -- this guarantees the invariant
-- for any future item-creation path too, not just the ones audited today.
begin;

alter table public.item_instances alter column durability drop not null;

create or replace function public.enforce_item_no_durability_concept()
returns trigger
language plpgsql
as $$
declare
  v_slot_type text;
  v_required_level integer;
begin
  select slot_type, required_level into v_slot_type, v_required_level
  from public.item_templates where id = new.template_id;

  if public.compute_max_durability(v_slot_type, coalesce(v_required_level, 1)) is null then
    new.durability := null;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_item_no_durability_concept() from public;

drop trigger if exists item_instances_no_durability_concept on public.item_instances;
create trigger item_instances_no_durability_concept
before insert or update of durability, template_id on public.item_instances
for each row
execute function public.enforce_item_no_durability_concept();

-- Backfill: null out every existing row whose item type has no durability
-- concept (currently sitting at the stray 0 every creation path left behind).
update public.item_instances ii
set durability = null
from public.item_templates it
where it.id = ii.template_id
  and public.compute_max_durability(it.slot_type, coalesce(it.required_level, 1)) is null
  and ii.durability is distinct from null;

commit;
