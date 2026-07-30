-- Server-authoritative combat resolution (see CLAUDE.md's Loot section) — a new
-- Edge Function (supabase/functions/resolve-combat) becomes the sole grantor of
-- gold/EXP/item-drops/Meteor/DragonBall/arrow-consumption for combat, replacing
-- the direct client-side inserts/increments that made item drops (and, less
-- obviously, arrow-stack counts) forgeable by a modified client. The client can
-- no longer be trusted to supply monster stats, so this table is the server's
-- own independent copy of zoneData.ts's ENEMY_TYPES (64 rows) — regenerate this
-- insert if zoneData.ts's monster stats ever change, the same "must stay in
-- sync" relationship forgeCosts.ts's preview functions already have with their
-- SQL counterparts.

create table if not exists public.enemy_types (
  id text primary key,
  display_name text not null,
  level integer not null,
  max_hp integer not null,
  gold_reward integer not null,
  exp_reward integer not null,
  attack_damage integer not null
);

alter table public.enemy_types enable row level security;

create policy "Anyone can view enemy types"
  on public.enemy_types for select
  using (true);

grant select on public.enemy_types to anon, authenticated;

insert into public.enemy_types (id, display_name, level, max_hp, gold_reward, exp_reward, attack_damage) values
  ('quailwing', 'Quailwing', 1, 24, 2, 5, 4),
  ('crested-cockerel', 'Crested Cockerel', 3, 32, 2, 6, 5),
  ('mourning-dove', 'Mourning Dove', 7, 48, 3, 7, 7),
  ('azure-coo', 'Azure Coo', 10, 64, 4, 8, 10),
  ('redbreast', 'Redbreast', 12, 72, 4, 9, 11),
  ('bramble-fowl', 'Bramble Fowl', 15, 80, 4, 10, 12),
  ('palewisp', 'Palewisp', 17, 96, 5, 11, 14),
  ('warshade', 'Warshade', 20, 104, 5, 13, 16),
  ('restless-shade', 'Restless Shade', 22, 120, 5, 14, 18),
  ('gravewight', 'Gravewight', 23, 120, 5, 14, 18),
  ('grim-specter', 'Grim Specter', 25, 136, 6, 15, 20),
  ('wingfang-serpent', 'Wingfang Serpent', 27, 144, 6, 16, 22),
  ('cinderscale', 'Cinderscale', 30, 160, 7, 18, 24),
  ('brushrunner', 'Brushrunner', 32, 176, 7, 19, 26),
  ('thornreaver', 'Thornreaver', 35, 192, 7, 20, 29),
  ('emberpaw', 'Emberpaw', 37, 208, 8, 22, 31),
  ('woodkin', 'Woodkin', 40, 232, 8, 23, 35),
  ('cinderwisp', 'Cinderwisp', 42, 240, 8, 25, 36),
  ('woodkin-sovereign', 'Woodkin Sovereign', 45, 264, 9, 27, 40),
  ('ridgeback-simian', 'Ridgeback Simian', 47, 280, 9, 28, 42),
  ('cunning-simian', 'Cunning Simian', 50, 304, 10, 30, 46),
  ('boulder-ape', 'Boulder Ape', 52, 320, 10, 31, 48),
  ('bellowing-brute', 'Bellowing Brute', 55, 344, 10, 34, 52),
  ('stormfist', 'Stormfist', 57, 360, 11, 35, 54),
  ('frostpelt', 'Frostpelt', 60, 392, 11, 37, 59),
  ('coilkin', 'Coilkin', 62, 408, 11, 39, 61),
  ('venomkin', 'Venomkin', 65, 432, 12, 41, 65),
  ('dunecrawler', 'Dunecrawler', 67, 456, 12, 43, 68),
  ('duststalker', 'Duststalker', 70, 480, 13, 46, 72),
  ('cragbeast', 'Cragbeast', 72, 504, 13, 47, 76),
  ('boulderback-golem', 'Boulderback Golem', 75, 536, 13, 50, 80),
  ('stonewarden', 'Stonewarden', 80, 584, 14, 55, 88),
  ('bladewraith', 'Bladewraith', 82, 608, 14, 56, 91),
  ('edgeborn', 'Edgeborn', 85, 640, 15, 59, 96),
  ('wingkin', 'Wingkin', 87, 664, 15, 61, 100),
  ('wingkin-sovereign', 'Wingkin Sovereign', 90, 704, 16, 64, 106),
  ('hawklord', 'Hawklord', 92, 728, 16, 66, 109),
  ('silverwing', 'Silverwing', 95, 760, 16, 70, 114),
  ('cutpurse', 'Cutpurse', 97, 784, 17, 72, 118),
  ('footpad', 'Footpad', 100, 824, 17, 75, 124),
  ('cryptwing', 'Cryptwing', 102, 848, 17, 77, 127),
  ('crimson-wing', 'Crimson Wing', 107, 912, 18, 83, 137),
  ('crimson-sovereign', 'Crimson Sovereign', 110, 960, 19, 86, 144),
  ('ironhorn', 'Ironhorn', 112, 984, 19, 89, 148),
  ('ironhorn-fiend', 'Ironhorn Fiend', 115, 1024, 19, 92, 154),
  ('scarlet-fiend', 'Scarlet Fiend', 117, 1056, 20, 95, 158),
  ('verdant-fiend', 'Verdant Fiend', 120, 1096, 20, 99, 164),
  ('ratling-flinger', 'Ratling Flinger', 105, 888, 18, 81, 133),
  ('gilded-wraith', 'Gilded Wraith', 108, 928, 18, 84, 139),
  ('shivshade', 'Shivshade', 110, 960, 19, 86, 144),
  ('swiftgnaw', 'Swiftgnaw', 112, 984, 19, 89, 148),
  ('azurewing', 'Azurewing', 115, 1024, 19, 92, 154),
  ('nightfiend', 'Nightfiend', 117, 1056, 20, 95, 158),
  ('bullhorn-warden', 'Bullhorn Warden', 120, 1096, 20, 99, 164),
  ('rime-serpent', 'Rime Serpent', 120, 1096, 20, 99, 164),
  ('rime-fiend', 'Rime Fiend', 121, 1112, 20, 100, 167),
  ('serpent-herald', 'Serpent Herald', 122, 1128, 20, 101, 169),
  ('fiend-herald', 'Fiend Herald', 123, 1144, 20, 102, 172),
  ('serpent-warden', 'Serpent Warden', 124, 1160, 21, 104, 174),
  ('fiend-warden', 'Fiend Warden', 125, 1176, 21, 105, 176),
  ('serpent-sovereign', 'Serpent Sovereign', 126, 1192, 21, 106, 179),
  ('fiend-sovereign', 'Fiend Sovereign', 127, 1208, 21, 108, 181),
  ('frostcoil', 'Frostcoil', 128, 1224, 21, 109, 184),
  ('frostblade-fiend', 'Frostblade Fiend', 129, 1232, 21, 110, 185)
on conflict (id) do update set
  display_name = excluded.display_name,
  level = excluded.level,
  max_hp = excluded.max_hp,
  gold_reward = excluded.gold_reward,
  exp_reward = excluded.exp_reward,
  attack_damage = excluded.attack_damage;

-- Server clock only — never trusted from the client. Elapsed time for a
-- resolve-combat call is now() - combat_last_resolved_at, capped per call
-- (RESOLVE_WINDOW_CAP_MS in the Edge Function) the same way the offline
-- simulator already caps its own away-time window at 2 hours. Reset whenever
-- selected_monster_id/current_zone changes so a stale window can't resolve
-- against a monster the character just switched away from.
alter table public.characters
  add column if not exists combat_last_resolved_at timestamptz not null default now();

-- Loot Holding (confirmed with the user, 2026-07-30) — where a server-resolved
-- drop lands when Inventory is full, since there's no interactive moment left
-- to ask "what do you want to discard" once resolution happens in the
-- background. One row per pending drop (not collapsed into a fungible count
-- like warehouse_items) so a drop preserves whatever quality/tier it actually
-- rolled at, once rare-drop bonuses exist. Capped at 100 slots, enforced by the
-- Edge Function, not here.
create table if not exists public.loot_holding (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters (id) on delete cascade,
  template_id uuid not null references public.item_templates (id),
  quality_tier text not null default 'normal',
  created_at timestamptz not null default now()
);

alter table public.loot_holding enable row level security;

create policy "Characters can view their own loot holding"
  on public.loot_holding for select
  using (exists (select 1 from public.characters c where c.id = loot_holding.character_id and c.account_id = auth.uid()));

-- No client insert/update grant at all — only the Edge Function's service-role
-- client populates this table. Deleting (claiming into Inventory) still needs
-- to go through claim_loot_holding below (it also has to insert the real
-- item_instances row in the same transaction), so there's no direct client
-- delete grant either.
grant select on public.loot_holding to authenticated;

-- claim_loot_holding: moves one pending drop out of Loot Holding and into a
-- real Inventory item_instances row (Normal quality/level 1 defaults, or
-- whatever quality_tier the drop actually rolled at) — the one loot_holding
-- mutation that's fine to leave client-triggered, since claiming doesn't
-- create value, it only moves an already-granted reward the player is
-- entitled to, and the inventory-full check happens the same way any other
-- gear grant already does (client-side cap check before calling this).
create or replace function public.claim_loot_holding(holding_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character_id uuid;
  v_account_id uuid;
  v_template_id uuid;
  v_quality_tier text;
  v_item jsonb;
begin
  select character_id, template_id, quality_tier
  into v_character_id, v_template_id, v_quality_tier
  from public.loot_holding
  where id = holding_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select account_id into v_account_id from public.characters where id = v_character_id;

  if v_account_id is null or v_account_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;

  insert into public.item_instances (template_id, owner_id, quality_tier)
  values (v_template_id, v_character_id, v_quality_tier)
  returning to_jsonb(item_instances.*) into v_item;

  delete from public.loot_holding where id = holding_id;

  return jsonb_build_object('ok', true, 'item', v_item);
end;
$$;

revoke all on function public.claim_loot_holding(uuid) from public;
grant execute on function public.claim_loot_holding(uuid) to authenticated;
