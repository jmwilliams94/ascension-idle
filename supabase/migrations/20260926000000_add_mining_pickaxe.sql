-- Mining mechanic, step 1 of 3 (schema + catalogs — see CLAUDE.md's Mining
-- design once written up, and the plan this was built from). Pickaxe is a
-- full gear-like item (item_templates/item_instances, reuses Composition's
-- +N system unchanged) but its own tier progression (Normal -> Tempered ->
-- Infused -> Radiant -> Ascended) is a template-chain walk like Level
-- Upgrade, NOT the normal quality_tier/Fallen-Star Quality Upgrade path —
-- the cost model here is flat gems + gold, always guaranteed success, priced
-- nothing like Forge's RNG/Comet convention. item_instances.quality_tier
-- stays 'normal' for a Pickaxe's whole lifetime (tier progress lives in
-- which template it points at instead) so QUALITY_STAT_MULTIPLIER never
-- double-scales the flat physical_attack table below.
begin;

insert into public.item_templates (name, slot_type, item_family, base_stats, required_level, required_class, price)
select * from (values
  ('Pickaxe', 'pickaxe', 'pickaxe', '{"physical_attack":50}'::jsonb, 1, null::text, 0),
  ('Tempered Pickaxe', 'pickaxe', 'pickaxe', '{"physical_attack":100}'::jsonb, 2, null::text, 0),
  ('Infused Pickaxe', 'pickaxe', 'pickaxe', '{"physical_attack":150}'::jsonb, 3, null::text, 0),
  ('Radiant Pickaxe', 'pickaxe', 'pickaxe', '{"physical_attack":200}'::jsonb, 4, null::text, 0),
  ('Ascended Pickaxe', 'pickaxe', 'pickaxe', '{"physical_attack":250}'::jsonb, 5, null::text, 0)
) as v(name, slot_type, item_family, base_stats, required_level, required_class, price)
where not exists (select 1 from public.item_templates where name = v.name and item_family = 'pickaxe');

-- Mining state — deliberately its own columns/resolve-tracking rather than
-- reusing Hunting's, even though the two modes can never both be active at
-- once (see the mutual-exclusivity note in the design plan) — cleaner to
-- keep the two mechanics' server state separate than overload Hunting's
-- columns for an unrelated mechanic.
alter table public.characters
  add column if not exists equipped_pickaxe_id uuid references public.item_instances (id) on delete set null,
  add column if not exists pickaxe_ascended_gem_type text check (pickaxe_ascended_gem_type in ('drake', 'ember', 'bastion', 'iris')),
  add column if not exists selected_mine_id text,
  add column if not exists mining_last_resolved_at timestamptz not null default now(),
  add column if not exists last_active_idle_mode text not null default 'hunting' check (last_active_idle_mode in ('hunting', 'mining'));

-- Guaranteed-success tier-up, paid in gems (from characters.gems, same
-- gemStorageKey format the rest of the gem system uses) + flat gold — NOT
-- the Forge quality_upgrade/master_forge_upgrade path. Auto-grants a starter
-- Normal Pickaxe + equips it on first call if the character doesn't have one
-- yet, so there's no separate "buy your first pickaxe" step (unlike the
-- Quiver, which is a Shop purchase).
create or replace function public.pickaxe_tier_upgrade(character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_equipped_pickaxe_id uuid;
  v_current_template_id uuid;
  v_current_name text;
  v_current_required_level integer;
  v_next_template_id uuid;
  v_next_name text;
  v_next_required_level integer;
  v_gems jsonb;
  v_gold integer;
  v_gold_cost integer;
  v_gem_keys text[];
  v_gem_amount integer;
  v_key text;
  v_gem_owned integer;
  v_ascended_gem_type text;
  i integer;
begin
  select account_id, equipped_pickaxe_id, gems, gold, pickaxe_ascended_gem_type
  into v_account_id, v_equipped_pickaxe_id, v_gems, v_gold, v_ascended_gem_type
  from public.characters
  where id = character_id
  for update;

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'character_not_found');
  end if;
  if v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  -- Lazy-grant a starter Pickaxe the first time this is ever called for a
  -- character that doesn't have one yet — free, no Shop purchase needed.
  if v_equipped_pickaxe_id is null then
    select id into v_current_template_id from public.item_templates
    where item_family = 'pickaxe' order by required_level asc limit 1;

    insert into public.item_instances (template_id, owner_id, quality_tier, level, location)
    values (v_current_template_id, character_id, 'normal', 1, 'inventory')
    returning id into v_equipped_pickaxe_id;

    update public.characters set equipped_pickaxe_id = v_equipped_pickaxe_id where id = character_id;
  end if;

  select ii.template_id, it.name, it.required_level
  into v_current_template_id, v_current_name, v_current_required_level
  from public.item_instances ii
  join public.item_templates it on it.id = ii.template_id
  where ii.id = v_equipped_pickaxe_id
  for update of ii;

  select id, name, required_level into v_next_template_id, v_next_name, v_next_required_level
  from public.item_templates
  where item_family = 'pickaxe' and required_level > v_current_required_level
  order by required_level asc
  limit 1;

  if v_next_template_id is null then
    return jsonb_build_object('ok', false, 'error', 'already_max_tier', 'template_id', v_current_template_id, 'name', v_current_name);
  end if;

  -- Cost table keyed by the tier being upgraded INTO (v_next_name) — flat
  -- gems (all 4 coded types: drake/ember/bastion/iris — the other 4 designed
  -- gem types have no data-layer code yet) + gold. Ascended has no gold cost
  -- specified by design — placeholder 0, easy to add later.
  case v_next_name
    when 'Tempered Pickaxe' then
      v_gem_amount := 5; v_gold_cost := 100000;
      v_gem_keys := array['drake_normal', 'ember_normal', 'bastion_normal', 'iris_normal'];
    when 'Infused Pickaxe' then
      v_gem_amount := 1; v_gold_cost := 250000;
      v_gem_keys := array['drake_tempered', 'ember_tempered', 'bastion_tempered', 'iris_tempered'];
    when 'Radiant Pickaxe' then
      v_gem_amount := 5; v_gold_cost := 500000;
      v_gem_keys := array['drake_tempered', 'ember_tempered', 'bastion_tempered', 'iris_tempered'];
    when 'Ascended Pickaxe' then
      -- Rolled once, uniformly, the first time a character reaches this
      -- branch with no roll on record yet — never re-rolled after.
      if v_ascended_gem_type is null then
        v_ascended_gem_type := (array['drake', 'ember', 'bastion', 'iris'])[floor(random() * 4)::int + 1];
        update public.characters set pickaxe_ascended_gem_type = v_ascended_gem_type where id = character_id;
      end if;
      v_gem_amount := 1; v_gold_cost := 0;
      v_gem_keys := array[v_ascended_gem_type || '_ascended'];
    else
      return jsonb_build_object('ok', false, 'error', 'unknown_next_tier');
  end case;

  -- Validate affordability upfront (all gems + gold) before spending anything
  -- — same "refuse the whole attempt" shape as composition_feed/bless_item.
  if v_gold < v_gold_cost then
    return jsonb_build_object('ok', false, 'error', 'not_enough_gold', 'gold_cost', v_gold_cost, 'gold', v_gold);
  end if;
  for i in 1..array_length(v_gem_keys, 1) loop
    v_key := v_gem_keys[i];
    v_gem_owned := coalesce((v_gems ->> v_key)::integer, 0);
    if v_gem_owned < v_gem_amount then
      return jsonb_build_object('ok', false, 'error', 'not_enough_gems', 'gem_key', v_key, 'needed', v_gem_amount, 'owned', v_gem_owned);
    end if;
  end loop;

  for i in 1..array_length(v_gem_keys, 1) loop
    v_key := v_gem_keys[i];
    v_gem_owned := coalesce((v_gems ->> v_key)::integer, 0);
    v_gems := jsonb_set(v_gems, array[v_key], to_jsonb(v_gem_owned - v_gem_amount));
  end loop;

  update public.characters
  set gems = v_gems, gold = gold - v_gold_cost
  where id = character_id
  returning gold into v_gold;

  update public.item_instances
  set template_id = v_next_template_id, level = v_next_required_level
  where id = v_equipped_pickaxe_id;

  return jsonb_build_object(
    'ok', true,
    'template_id', v_next_template_id,
    'name', v_next_name,
    'gold_spent', v_gold_cost,
    'gold_remaining', v_gold,
    'gems', v_gems,
    'ascended_gem_type', v_ascended_gem_type
  );
end;
$$;

revoke all on function public.pickaxe_tier_upgrade(uuid) from public;
grant execute on function public.pickaxe_tier_upgrade(uuid) to authenticated;

commit;
