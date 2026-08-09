-- Cosmetic rename only — ids/stats unchanged. Keeps the server-side
-- enemy_types mirror in sync with the client's zoneData.ts (see CLAUDE.md's
-- "must stay in sync" note on that table), even though nothing currently
-- reads enemy_types.name for display (the client always shows its own local
-- displayName; resolve-combat only reads stat columns off this table).
update public.enemy_types set name = 'Hollow Sentinel' where id = 'ratling-flinger';
update public.enemy_types set name = 'Mosswarden' where id = 'swiftgnaw';
