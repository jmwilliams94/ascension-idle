-- Gear Score Snapshot & Cross-Character Claim (requested by the user).
--
-- Problem 1: Gear Score used to read live off whatever's currently equipped
-- (characters.equipped_*_id -> item_instances). Since Pickaxe shares the
-- Main Hand weapon slot, equipping one to mine un-equipped the character's
-- real weapon, visibly dropping their score for no real reason.
--
-- Problem 2: Bank Storage is account-wide, so the same physical item can be
-- walked across all 5 of an account's characters and re-equipped each time
-- -- nothing stopped one gear set from inflating every character's live
-- score in turn.
--
-- Fix: equipping a scored piece of gear (weapon/ring/necklace/boots/hat/coat
-- -- Quiver/Pickaxe are never scored) snapshots a FROZEN copy of its
-- scoring-relevant fields onto that character (character_gear_snapshots).
-- Gear Score sums the snapshot, not live equipped state -- taking gear off
-- never drops the score by itself; only equipping something else in that
-- slot, or someone else successfully claiming the same item, changes it. An
-- item can only be snapshotted by one character at a time -- claiming it
-- elsewhere prompts a transfer confirmation (client-side), which on accept
-- removes it from the previous claimant's snapshot.

create table public.character_gear_snapshots (
  character_id uuid not null references public.characters (id) on delete cascade,
  slot text not null check (slot in ('weapon', 'ring', 'necklace', 'boots', 'hat', 'coat')),
  item_id uuid not null references public.item_instances (id) on delete cascade,
  template_id uuid not null references public.item_templates (id),
  quality_tier text not null,
  level integer not null default 1,
  composition_level integer not null default 0,
  durability numeric not null default 0,
  sockets jsonb not null default '[]'::jsonb,
  enchant jsonb,
  updated_at timestamptz not null default now(),
  primary key (character_id, slot)
);

-- No client grants at all -- every touchpoint is a SECURITY DEFINER RPC
-- below, same "no direct client insert/update, RPC-mediated only" precedent
-- character_stats uses.
alter table public.character_gear_snapshots enable row level security;

-- Claims (or transfers) the snapshot for one scored slot. Refuses items that
-- aren't actually owned by/equipped-eligible for this character, and
-- refuses Pickaxe (never scored). If another character currently holds the
-- claim on this exact item, refuses with 'already_claimed' unless
-- p_force is set, in which case the other character's claim is removed and
-- this one takes over.
create or replace function public.claim_gear_snapshot(
  p_character_id uuid,
  p_slot text,
  p_item_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_owner_id uuid;
  v_template_id uuid;
  v_quality_tier text;
  v_level integer;
  v_composition_level integer;
  v_durability numeric;
  v_sockets jsonb;
  v_enchant jsonb;
  v_slot_type text;
  v_item_family text;
  v_conflict_character_id uuid;
  v_conflict_character_name text;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  if p_slot not in ('weapon', 'ring', 'necklace', 'boots', 'hat', 'coat') then
    return jsonb_build_object('ok', false, 'error', 'invalid_slot');
  end if;

  select owner_id, template_id, quality_tier, level, composition_level, durability, coalesce(sockets, '[]'::jsonb), enchant
  into v_owner_id, v_template_id, v_quality_tier, v_level, v_composition_level, v_durability, v_sockets, v_enchant
  from public.item_instances
  where id = p_item_id
  for update;

  if v_owner_id is null or v_owner_id <> p_character_id then
    return jsonb_build_object('ok', false, 'error', 'not_item_owner');
  end if;

  select slot_type, item_family into v_slot_type, v_item_family from public.item_templates where id = v_template_id;

  if v_slot_type is distinct from p_slot then
    return jsonb_build_object('ok', false, 'error', 'slot_mismatch');
  end if;
  if v_item_family = 'pickaxe' then
    return jsonb_build_object('ok', false, 'error', 'not_scored');
  end if;

  select cgs.character_id, c.name into v_conflict_character_id, v_conflict_character_name
  from public.character_gear_snapshots cgs
  join public.characters c on c.id = cgs.character_id
  where cgs.item_id = p_item_id and cgs.character_id <> p_character_id
  limit 1;

  if v_conflict_character_id is not null and not p_force then
    return jsonb_build_object('ok', false, 'error', 'already_claimed', 'claimed_by_character_name', v_conflict_character_name);
  end if;

  if v_conflict_character_id is not null and p_force then
    delete from public.character_gear_snapshots where character_id = v_conflict_character_id and item_id = p_item_id;
  end if;

  insert into public.character_gear_snapshots (character_id, slot, item_id, template_id, quality_tier, level, composition_level, durability, sockets, enchant)
  values (p_character_id, p_slot, p_item_id, v_template_id, v_quality_tier, v_level, v_composition_level, v_durability, v_sockets, v_enchant)
  on conflict (character_id, slot) do update
    set item_id = excluded.item_id, template_id = excluded.template_id, quality_tier = excluded.quality_tier,
        level = excluded.level, composition_level = excluded.composition_level, durability = excluded.durability,
        sockets = excluded.sockets, enchant = excluded.enchant, updated_at = now();

  return jsonb_build_object('ok', true, 'transferred_from', v_conflict_character_name);
end;
$$;

revoke all on function public.claim_gear_snapshot(uuid, text, uuid, boolean) from public;
grant execute on function public.claim_gear_snapshot(uuid, text, uuid, boolean) to authenticated;

-- Returns the caller's own character's 6 snapshot rows, keyed by slot --
-- used to hydrate the client's own Gear Score display without granting any
-- direct table access.
create or replace function public.get_my_gear_snapshots(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_result jsonb;
begin
  select account_id into v_account_id from public.characters where id = p_character_id;
  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  select coalesce(jsonb_object_agg(slot, jsonb_build_object(
    'item_id', item_id, 'template_id', template_id, 'quality_tier', quality_tier,
    'level', level, 'composition_level', composition_level, 'sockets', sockets, 'enchant', enchant
  )), '{}'::jsonb)
  into v_result
  from public.character_gear_snapshots
  where character_id = p_character_id;

  return jsonb_build_object('ok', true, 'snapshots', v_result);
end;
$$;

revoke all on function public.get_my_gear_snapshots(uuid) from public;
grant execute on function public.get_my_gear_snapshots(uuid) to authenticated;

-- get_character_gear_score now sums the frozen snapshot instead of joining
-- live equipped_*_id -> item_instances. Same signature, safe create-or-replace.
create or replace function public.get_character_gear_score(p_character_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    public.compute_item_gear_score(quality_tier, sockets, enchant, composition_level)
  ), 0)::integer
  from public.character_gear_snapshots
  where character_id = p_character_id;
$$;

revoke all on function public.get_character_gear_score(uuid) from public;
grant execute on function public.get_character_gear_score(uuid) to authenticated;

-- view_character_loadout's 6 scored slots now come from character_gear_snapshots
-- (the frozen record) instead of a live item_instances join -- "the view
-- equipment can be the snapshot," per the user. Quiver stays live (never
-- scored, unaffected).
create or replace function public.view_character_loadout(p_character_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
  v_level integer;
  v_class text;
  v_equipment jsonb;
begin
  select c.id, c.name, c.level, c.class,
    jsonb_build_object(
      'weapon', case when ws.item_id is not null then jsonb_build_object(
        'item_id', ws.item_id, 'template_id', ws.template_id, 'quality_tier', ws.quality_tier,
        'level', ws.level, 'composition_level', ws.composition_level,
        'sockets', ws.sockets, 'durability', ws.durability, 'enchant', ws.enchant
      ) end,
      'ring', case when rs.item_id is not null then jsonb_build_object(
        'item_id', rs.item_id, 'template_id', rs.template_id, 'quality_tier', rs.quality_tier,
        'level', rs.level, 'composition_level', rs.composition_level,
        'sockets', rs.sockets, 'durability', rs.durability, 'enchant', rs.enchant
      ) end,
      'necklace', case when ns.item_id is not null then jsonb_build_object(
        'item_id', ns.item_id, 'template_id', ns.template_id, 'quality_tier', ns.quality_tier,
        'level', ns.level, 'composition_level', ns.composition_level,
        'sockets', ns.sockets, 'durability', ns.durability, 'enchant', ns.enchant
      ) end,
      'boots', case when bs.item_id is not null then jsonb_build_object(
        'item_id', bs.item_id, 'template_id', bs.template_id, 'quality_tier', bs.quality_tier,
        'level', bs.level, 'composition_level', bs.composition_level,
        'sockets', bs.sockets, 'durability', bs.durability, 'enchant', bs.enchant
      ) end,
      'hat', case when hs.item_id is not null then jsonb_build_object(
        'item_id', hs.item_id, 'template_id', hs.template_id, 'quality_tier', hs.quality_tier,
        'level', hs.level, 'composition_level', hs.composition_level,
        'sockets', hs.sockets, 'durability', hs.durability, 'enchant', hs.enchant
      ) end,
      'coat', case when cs.item_id is not null then jsonb_build_object(
        'item_id', cs.item_id, 'template_id', cs.template_id, 'quality_tier', cs.quality_tier,
        'level', cs.level, 'composition_level', cs.composition_level,
        'sockets', cs.sockets, 'durability', cs.durability, 'enchant', cs.enchant
      ) end,
      'quiver', case when qi.id is not null then jsonb_build_object(
        'item_id', qi.id, 'template_id', qi.template_id, 'quality_tier', qi.quality_tier,
        'level', qi.level, 'composition_level', qi.composition_level,
        'sockets', coalesce(qi.sockets, '[]'::jsonb), 'durability', qi.durability, 'enchant', qi.enchant
      ) end
    )
  into v_id, v_name, v_level, v_class, v_equipment
  from public.characters c
  left join public.character_gear_snapshots ws on ws.character_id = c.id and ws.slot = 'weapon'
  left join public.character_gear_snapshots rs on rs.character_id = c.id and rs.slot = 'ring'
  left join public.character_gear_snapshots ns on ns.character_id = c.id and ns.slot = 'necklace'
  left join public.character_gear_snapshots bs on bs.character_id = c.id and bs.slot = 'boots'
  left join public.character_gear_snapshots hs on hs.character_id = c.id and hs.slot = 'hat'
  left join public.character_gear_snapshots cs on cs.character_id = c.id and cs.slot = 'coat'
  left join public.item_instances qi on qi.id = c.equipped_quiver_id
  where c.name = trim(p_character_name);

  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'character', jsonb_build_object('name', v_name, 'level', v_level, 'class', v_class),
    'equipment', v_equipment,
    'gear_score', public.get_character_gear_score(v_id)
  );
end;
$$;

revoke all on function public.view_character_loadout(text) from public;
grant execute on function public.view_character_loadout(text) to authenticated;

-- Seed existing characters' snapshots from their current live-equipped gear
-- so nobody's score drops to 0 the day this ships. Weapon slot skips a
-- currently-equipped Pickaxe (never scored).
insert into public.character_gear_snapshots (character_id, slot, item_id, template_id, quality_tier, level, composition_level, durability, sockets, enchant)
select c.id, 'weapon', ii.id, ii.template_id, ii.quality_tier, ii.level, ii.composition_level, ii.durability, coalesce(ii.sockets, '[]'::jsonb), ii.enchant
from public.characters c
join public.item_instances ii on ii.id = c.equipped_weapon_id
join public.item_templates it on it.id = ii.template_id
where it.item_family <> 'pickaxe'
on conflict (character_id, slot) do nothing;

insert into public.character_gear_snapshots (character_id, slot, item_id, template_id, quality_tier, level, composition_level, durability, sockets, enchant)
select c.id, 'ring', ii.id, ii.template_id, ii.quality_tier, ii.level, ii.composition_level, ii.durability, coalesce(ii.sockets, '[]'::jsonb), ii.enchant
from public.characters c
join public.item_instances ii on ii.id = c.equipped_ring_id
on conflict (character_id, slot) do nothing;

insert into public.character_gear_snapshots (character_id, slot, item_id, template_id, quality_tier, level, composition_level, durability, sockets, enchant)
select c.id, 'necklace', ii.id, ii.template_id, ii.quality_tier, ii.level, ii.composition_level, ii.durability, coalesce(ii.sockets, '[]'::jsonb), ii.enchant
from public.characters c
join public.item_instances ii on ii.id = c.equipped_necklace_id
on conflict (character_id, slot) do nothing;

insert into public.character_gear_snapshots (character_id, slot, item_id, template_id, quality_tier, level, composition_level, durability, sockets, enchant)
select c.id, 'boots', ii.id, ii.template_id, ii.quality_tier, ii.level, ii.composition_level, ii.durability, coalesce(ii.sockets, '[]'::jsonb), ii.enchant
from public.characters c
join public.item_instances ii on ii.id = c.equipped_boots_id
on conflict (character_id, slot) do nothing;

insert into public.character_gear_snapshots (character_id, slot, item_id, template_id, quality_tier, level, composition_level, durability, sockets, enchant)
select c.id, 'hat', ii.id, ii.template_id, ii.quality_tier, ii.level, ii.composition_level, ii.durability, coalesce(ii.sockets, '[]'::jsonb), ii.enchant
from public.characters c
join public.item_instances ii on ii.id = c.equipped_hat_id
on conflict (character_id, slot) do nothing;

insert into public.character_gear_snapshots (character_id, slot, item_id, template_id, quality_tier, level, composition_level, durability, sockets, enchant)
select c.id, 'coat', ii.id, ii.template_id, ii.quality_tier, ii.level, ii.composition_level, ii.durability, coalesce(ii.sockets, '[]'::jsonb), ii.enchant
from public.characters c
join public.item_instances ii on ii.id = c.equipped_coat_id
on conflict (character_id, slot) do nothing;
