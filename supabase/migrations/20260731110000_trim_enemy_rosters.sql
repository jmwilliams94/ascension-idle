-- Trims every zone's monster roster down to 5 enemies (confirmed with the
-- user, 2026-07-31) -- was up to 11 in Windhollow, 64 total across 8 zones,
-- down to 40. Keeps are evenly spaced by level within each zone, and always
-- keep that zone's own first/last monster, so cross-zone level jumps are
-- completely unaffected -- only the spacing *within* a zone changes. See
-- CLAUDE.md's Zones section for the full keep-list/gap table and the
-- reasoning for why no HP/gold/EXP values needed adjusting (they're
-- hand-placed per monster, not interpolated between neighbors, and the
-- existing white/green/red/black EXP-multiplier system already compensates
-- for a wider level gap between whichever monster a player is actually
-- fighting and their own level).
--
-- This is the server-side mirror of src/game/zones/zoneData.ts's own trim
-- (ENEMY_TYPES/ZONES[...].monsterOrder) -- must stay in sync, same
-- "regenerate this table's data if zoneData.ts ever changes" convention
-- documented in CLAUDE.md's Loot section.
--
-- Safe for any character whose selected_monster_id already points at one of
-- these ids: selected_monster_id has no FK to enemy_types (a plain text
-- column), and useZoneStore.ts's hydrate/resolveMonsterId already treats an
-- unrecognized saved monster id as "nothing selected yet" rather than
-- crashing (the same fallback built for the pre-rebuild placeholder ids) --
-- no separate data migration needed for existing characters.
begin;

delete from public.enemy_types where id in (
  'crested-cockerel', 'azure-coo', 'bramble-fowl', 'palewisp', 'restless-shade', 'gravewight',
  'cinderscale', 'emberpaw', 'cinderwisp',
  'cunning-simian', 'stormfist', 'coilkin',
  'duststalker', 'bladewraith',
  'cutpurse',
  'ironhorn', 'scarlet-fiend',
  'shivshade', 'azurewing',
  'rime-fiend', 'fiend-herald', 'fiend-warden', 'serpent-sovereign', 'frostcoil'
);

commit;
