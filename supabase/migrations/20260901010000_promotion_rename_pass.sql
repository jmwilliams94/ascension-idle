-- Renames the placeholder Hunter Promotion names (lifted directly from a
-- reference screenshot in the previous migration) to this game's own
-- invented-naming convention — same "similar shape, different actual words"
-- treatment the rest of the gear catalog already uses (e.g. real Conquer
-- "Vicious Fly" -> this game's "Sapling Bow" chain). Confirmed with the
-- user: rename every Promotion name (titles, item awards/costs, skill
-- flavor text), and every character's starting (pre-promotion) title is
-- "Novice <ClassName>" — not the earlier "Intern" placeholder.
--
-- Title ladder: Archer/Eagle Archer/Tiger Archer/Dragon Archer/Archer Master
-- -> Warden/Falcon Warden/Panther Warden/Wyrm Warden/Grand Warden (same
-- animal-escalation-then-"Master"-equivalent shape).
--
-- Items renamed (none of these collide with an existing item_templates.name
-- in the real gear catalog, e.g. the actual "Fawnhide Coat"/"Ram's Horn Bow"
-- chain entries — checked deliberately, since a same-named standalone item
-- would be confusing):
--   Deerskin Coat -> Doeskin Mantle       (award, tier 15)
--   Horn Bow      -> Antler Bow           (award, tier 40)
--   Euxenite Ore  -> Umbrite Ore          (cost, tier 40)
--   Emerald       -> Jade Shard           (cost, tier 70)
--   Rainbow Gem   -> Opaline Gem          (award, tier 100)
--   Moon Box      -> Lunar Coffer         (cost, tier 110)
--
-- Skills renamed (inert flavor text only, no skill system exists):
--   Primary Fly -> Swift Volley (tier 15)
--   Senior Fly  -> Storm Volley, Arrow Rain -> Arrow Tempest (tier 70)
begin;

update public.item_templates set name = 'Doeskin Mantle' where name = 'Deerskin Coat';
update public.item_templates set name = 'Antler Bow'     where name = 'Horn Bow';
update public.item_templates set name = 'Umbrite Ore'    where name = 'Euxenite Ore';
update public.item_templates set name = 'Jade Shard'     where name = 'Emerald';
update public.item_templates set name = 'Opaline Gem'    where name = 'Rainbow Gem';
update public.item_templates set name = 'Lunar Coffer'   where name = 'Moon Box';

update public.promotion_tiers set
  title = 'Warden',
  items_required = '[]'::jsonb,
  award_items = '[{"kind":"item","name":"Doeskin Mantle","quantity":1}]'::jsonb,
  skills_unlocked = array['Swift Volley']
where class = 'hunter' and level = 15;

update public.promotion_tiers set
  title = 'Falcon Warden',
  items_required = '[{"kind":"item","name":"Umbrite Ore","quantity":5}]'::jsonb,
  award_items = '[{"kind":"item","name":"Antler Bow","quantity":1}]'::jsonb,
  skills_unlocked = array[]::text[]
where class = 'hunter' and level = 40;

update public.promotion_tiers set
  title = 'Panther Warden',
  items_required = '[{"kind":"item","name":"Jade Shard","quantity":1}]'::jsonb,
  award_items = '[]'::jsonb,
  skills_unlocked = array['Storm Volley', 'Arrow Tempest']
where class = 'hunter' and level = 70;

update public.promotion_tiers set
  title = 'Wyrm Warden',
  items_required = '[{"kind":"currency","name":"comet","quantity":1}]'::jsonb,
  award_items = '[{"kind":"item","name":"Opaline Gem","quantity":1}]'::jsonb,
  skills_unlocked = array[]::text[]
where class = 'hunter' and level = 100;

update public.promotion_tiers set
  title = 'Grand Warden',
  items_required = '[{"kind":"item","name":"Lunar Coffer","quantity":1}]'::jsonb,
  award_items = '[{"kind":"currency","name":"fallen_star","quantity":1}]'::jsonb,
  skills_unlocked = array[]::text[]
where class = 'hunter' and level = 110;

commit;
