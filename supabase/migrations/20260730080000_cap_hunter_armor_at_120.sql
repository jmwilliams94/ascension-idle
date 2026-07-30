-- Hunter Coats and Hats should stop at level 120 (confirmed with the user,
-- 2026-07-30) — both chains currently run to 130 (Glacial Coat 121-125 /
-- Sunforged Coat 126-130; Wrenfeather Hat 121-125 / Vigor Hat 126-130),
-- matching the Bows' own cap by copy-paste rather than a deliberate choice.
--
-- item_instances.template_id has no ON DELETE CASCADE/SET NULL (see
-- 20260727020000_add_items_and_equipped_item.sql), so directly deleting these
-- templates would fail outright while anyone owns one of them (confirmed: the
-- user currently has a Glacial Coat equipped). Re-point any existing
-- instance/warehouse-token/loot-holding row referencing a doomed template to
-- its family's new top-of-chain template first (Emberplate Coat / Cinderplume
-- Hat, both level 120) — preserves the item rather than destroying it — then
-- delete the now-unreferenced level 121-130 rows.

do $$
declare
  v_top_coat uuid;
  v_top_hat uuid;
begin
  select id into v_top_coat from public.item_templates where name = 'Emberplate Coat' and required_level = 120;
  select id into v_top_hat from public.item_templates where name = 'Cinderplume Hat' and required_level = 120;

  if v_top_coat is null or v_top_hat is null then
    raise exception 'Could not find Emberplate Coat / Cinderplume Hat at level 120 — aborting to avoid nulling template_id';
  end if;

  update public.item_instances ii
  set template_id = v_top_coat, level = 120
  from public.item_templates it
  where ii.template_id = it.id and it.item_family = 'coat' and it.required_level > 120;

  update public.item_instances ii
  set template_id = v_top_hat, level = 120
  from public.item_templates it
  where ii.template_id = it.id and it.item_family = 'hat' and it.required_level > 120;

  update public.warehouse_items wi
  set template_id = v_top_coat
  from public.item_templates it
  where wi.template_id = it.id and it.item_family = 'coat' and it.required_level > 120;

  update public.warehouse_items wi
  set template_id = v_top_hat
  from public.item_templates it
  where wi.template_id = it.id and it.item_family = 'hat' and it.required_level > 120;

  update public.loot_holding lh
  set template_id = v_top_coat
  from public.item_templates it
  where lh.template_id = it.id and it.item_family = 'coat' and it.required_level > 120;

  update public.loot_holding lh
  set template_id = v_top_hat
  from public.item_templates it
  where lh.template_id = it.id and it.item_family = 'hat' and it.required_level > 120;
end $$;

delete from public.item_templates where item_family = 'coat' and required_level > 120;
delete from public.item_templates where item_family = 'hat' and required_level > 120;
