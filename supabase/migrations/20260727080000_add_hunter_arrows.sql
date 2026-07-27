-- Hunter arrow/ammo system (CLAUDE.md's Classes section: "Hunter has a quiver/ammo
-- mechanic... must equip arrows to fight"). Arrow types, prices, and effects are all
-- placeholders — no real reference data yet. Only meaningful for Hunter, but harmless
-- and unused for other classes, so it's fine to exist on every character row.
alter table public.characters
  add column if not exists arrows jsonb not null default '{"iron": 0, "lucky": 0, "speed": 0}'::jsonb,
  add column if not exists equipped_arrow_type text;

alter table public.characters
  add constraint characters_equipped_arrow_type_check
    check (equipped_arrow_type is null or equipped_arrow_type in ('iron', 'lucky', 'speed'));
