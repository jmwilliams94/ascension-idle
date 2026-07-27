# Greybox Idle

## Git workflow

- Commits should always be followed by a push to `main`, unless explicitly told otherwise.

## Versioning & changelog

`package.json`'s `version` field is the single source of truth — `src/version.ts` reads it at build time via Vite's `define` config (see `vite.config.ts`), so bump `package.json` only.

After completing each feature step, as part of the same commit (before pushing):

- Bump the **patch** version by default (e.g. 1.0.0 → 1.0.1) for typical feature/fix work.
- Bump the **minor** version instead (e.g. 1.0.x → 1.1.0) when the step is a significant new system, not a small addition. Use judgment, and call out the choice in the commit message and changelog entry so it's easy to review.
- Never bump the **major** version without being explicitly told to.
- Add a corresponding entry to `changelog.json` in plain, player-facing language (e.g. "Added combat" — not "Refactored GameCanvas component").

## Game design (source of truth)

This section is the confirmed design source of truth for Greybox Idle. Anything marked "placeholder" is a stand-in value that must be replaced with real reference data (primarily from Conquer Online) before it's treated as final; anything not marked placeholder is confirmed and should not be changed without discussion.

### Core loop

Hybrid action/idle RPG. While actively playing, the player moves on an isometric grid and fights manually using basic attacks and (later) abilities. While away, rewards are calculated as if the player were fighting at a simulated kill rate based on their character's DPS against the last zone/monster they were fighting, capped at a maximum offline duration, with a summary shown on return.

### Accounts & Characters

Confirmed and implemented: one Supabase account (`auth.users`/`players`) can have up to **5 characters** (`characters` table, `slot_index` 1-5). This replaced an earlier one-character-per-account model — see the migration gotcha note under Persistence if touching this again.

- **Account-level** (`players` table): `last_seen_version` (versioning), `bank_gold` (shared account-wide bank — schema only, no deposit/withdraw UI yet, nothing else touches it), `unlocked_classes` (text array, default `['hunter']` — account-wide class-unlock milestones, not per-character).
- **Character-level** (`characters` table): `class`, `level`, `exp`, `gold` (personal wallet, distinct from the account's shared bank), `meteors`, `dragonballs`, `equipped_item_id`, `current_zone`. Items (`item_instances.owner_id`) belong to a specific character, not the account — a character's inventory/equipment/forge progress doesn't carry over to a sibling character on the same account.
- **Character creation**: only Hunter is selectable today. Twin-soul/Wuxia/Juggernaut show locked with a placeholder condition ("Unlocks after a Hunter reaches level 100") — placeholder threshold, real max level unresolved per CLAUDE.md. Only the *display* of this lock is implemented; there's no mechanism yet that actually adds to `unlocked_classes` when a Hunter hits that level — that's a separate future step.
- **Login flow**: after auth, a character-select screen (`CharacterSelectScreen`) shows all 5 slots before any gameplay is reachable — `GameShell` (the actual game UI) only renders once a character is chosen. Switching characters mid-session (a "Switch Character" button) just clears the active character, returning to select, without signing out.
- Active-character selection is **in-memory only** (not persisted) — a page refresh currently returns to character select rather than resuming the last-played character. Flagged as a reasonable follow-up, not something this step was asked to solve.

### Classes

4 classes, with confirmed real-game mapping: Hunter = Archer (ranged), Twin-soul = Trojan (dual-wield melee), Wuxia = Taoist (mystic backsword — Taoist's real signature weapon is genuinely called the "Backsword," so no change needed there), Juggernaut = Warrior (heavy tank).

- No abilities are implemented yet — planned but deferred until we reach that stage of development.
- Hunter has a quiver/ammo mechanic (arrow tiers, must equip arrows to fight).
- Gear unlock levels are still placeholders — need real reference data.

**Stats — attribute-point system** (confirmed, replaces flat ATK/DEF/HP/Speed per class):

- Characters have four attribute points: Strength, Agility, Vitality, Spirit.
- Vitality → +24 HP per point. Strength/Agility/Spirit → +3 HP per point each. Spirit → +5 MP per point.
- Physical attack scales off Strength. Magic attack scales off Spirit.
- Attack speed is **not** stat-driven — it's fixed by the equipped weapon type's innate frequency.
- Agility governs accuracy/dodge, not damage.
- Class starting attributes: Warrior (Juggernaut) and Trojan (Twin-soul) = Str 5, Agi 2, Vit 3, Spi 0. Taoist (Wuxia) = Str 0, Agi 2, Vit 3, Spi 5. Archer (Hunter) starting attributes are **unresolved — needs sourcing**.

**Gear slots** (confirmed, replaces placeholder list): Headgear, Body armor, Shield (Warrior/Juggernaut only), Boots, Earrings, Necklace, Ring, Heavy Ring, Bracelet, Bag, Riding Crop, plus class-specific one-handed weapons (Sword, Backsword, Blade, Hook, Whip, Axe, Hammer, Club, Scepter, Dagger, Arrows) and two-handed weapons (Bow, Glaive, Poleaxe, Spear, Wand, Halberd), plus special slots: Talisman, Garment, Dragon Soul, Martial Soul. Exact per-class slot assignment is still **unresolved — needs a follow-up finalization pass**.

### Combat

Manual grid-based combat when actively playing (no queue, no auto-target). Floating combat text on hit.

- Damage formula is **unresolved — needs deliberate design, not sourced**. Real-game reference points to draw inspiration from (not to copy exactly): Magic Attack +1% damage per point, Magic Defense -1% incoming damage per point, and a later-patch "minimum damage" floor (Attack-minus-Defense vs. a class-specific % of Attack, whichever is higher).
- Rare monsters: 5% chance per monster, 2× HP, 5× gold/EXP, distinct visual treatment (TBD).

### Zones

Zones are real explorable maps populated with enemies placed throughout — not a summon/queue system.

- 7 zones exist conceptually; final zone names are **unresolved — needs deliberate design, not sourced** (working direction: similar theme to original names but not copies).
- Zone-by-zone gold/EXP-per-kill tables and monster HP scaling by zone/level are **unresolved — needs deliberate design, not sourced**. Gear level per zone is still a placeholder.
- First zone implemented as a placeholder: **Twincross Outskirts** (`src/game/zones/twincrossOutskirts.ts`), our renamed take on the original starting zone, with a placeholder low-level roster (Mudrat, Brushfowl, Fernvale Dove) spread across the full 100×100 grid per the quadrant convention below — flat HP/gold/EXP per type, not real economy data; spawn density/spacing is also a placeholder.
- **Zone layout convention (confirmed)**: each zone's map is quartered by enemy type — one type predominantly populates each quadrant, leaving room for a 4th type (or other use) per zone. Twincross Outskirts currently fills 3 of its 4 quadrants (NW/NE/SW); SE is intentionally reserved.
- **Future idea, not built**: a paid, time-limited instanced map (up to the full 100×100 grid) dedicated to a single monster type for manual farming — e.g. spend 1000 Gold for 1 hour of an all-Mudrat instance, separate from the shared zone. Flag this for later design/scoping, not part of the current zone system.

### Progression

- Promotion tiers at levels 1, 15, 40, 70, 100, 110, 120 — confirmed, keep as-is.
- Currencies: Gold, Meteors, Dragonballs — confirmed names. **Corrected**: Meteors and Dragonballs are separate, parallel currencies, not used together for the same upgrade. Meteors = Level Upgrade currency only. Dragonballs = Quality Upgrade currency **and** weapon-socket currency.
- EXP curve/leveling formula and meteor/dragonball drop rates are **unresolved — needs deliberate design, not sourced** (no reliable real-game data found).

### Loot

- Gear/meteor/dragonball drop-rate percentages are **unresolved — needs deliberate design, not sourced**.
- Rare-monster status affects the existing roll rather than being a separate roll.
- **Known limitation, not fixed yet**: item drops are granted via a direct client-side `insert` into `item_instances` (the 10% roll happens in the browser, not server-side), since combat itself is fully client-authoritative right now with no server that could independently verify a kill happened. A player could currently forge themselves items by calling the insert directly. Revisit if/when server-side combat validation or anti-cheat becomes a priority — not in scope for the current client-driven combat model.

### Gear system

Quality tiers, in order: Normal → Refined → Unique → Elite → Super — confirmed tier names, matches real game, no change.

- Real battle-power weighting is available as a reference for relative stat multipliers, use this instead of inventing new ones: Refined = 1, Unique = 2, Elite = 3, Super = 4 (Normal = 0 baseline).
- Drop weights are **unresolved — needs deliberate design, not sourced**. Tier colors have a placeholder implementation (`QUALITY_COLORS` in `src/game/items/equipmentBonus.ts`: Normal=gray, Refined=blue, Unique=purple, Elite=orange, Super=red) — no official color chart was found in research, flagged as such in code.
- Level caps: real-game data is low-confidence (historically ~130, with conflicting later references to 140+) — treat our cap as a **deliberate design choice**, not a sourced fact. 130 weapons / 120 armor remains a reasonable placeholder to keep using unless we decide otherwise.
- Gear naming chains (e.g. "Wooden Bow → Eternal Bow +10") are placeholder flavor text, not yet finalized.
- First minimal gear-drop implementation exists: `item_templates` (static reference data) and `item_instances` (owned copies, `owner_id` references a specific `characters` row — see Accounts & Characters) tables, seeded with a single placeholder item ("Wooden Sword", flat `physical_attack` only). Drop chance on kill is a flat 10% placeholder, unresolved per CLAUDE.md. `quality_tier`/`composition_level`/`sockets`/`enchant` columns already exist on `item_instances` (inert this step) so the systems below don't need a schema rework when built. Equip state is a single-slot shortcut (`characters.equipped_item_id`, weapon only) — it'll need to become a multi-slot shape once other gear slots exist.
- Displayed item names are quality-prefixed above Normal (e.g. "Refined Wooden Sword") — display-layer only (`formatItemDisplayName` in `equipmentBonus.ts`), `item_templates.name` itself is never renamed.
- Dropped items show a quality-colored floating name near the death tile (within 1 tile, or 2 if all 9 nearby spots already have a label showing) — purely cosmetic feedback, not a "walk over to pick up" mechanic; the item is still granted directly to the player's inventory the same way it always has been. Toggle: Settings > Display > "Show item drop text".
- **Security constraint for item-mutating systems (established with Quality/Level Upgrade, applies equally to Composition/Sockets later)**: `item_instances` has **no client-side UPDATE policy or grant** (dropped in `20260727030000_drop_item_instances_update_policy.sql`). Any system that mutates `quality_tier`/`level`/`composition_level`/`sockets`/`enchant` must do so via a `SECURITY DEFINER` Postgres function that verifies ownership (since the character-slots restructure, that means joining `item_instances.owner_id` → `characters.id` → `characters.account_id = auth.uid()`, not a direct `owner_id = auth.uid()` check), checks/deducts cost from the owning **character's** currency, and applies the change all in one transaction. Composition/Sockets (not yet built) must follow the same `quality_upgrade`/`level_upgrade` pattern (see below).

Three separate item-progression systems — do not conflate:

1. **Quality tier** — Normal through Super, as above. **Implemented**: `quality_upgrade(item_id)` Postgres function (migrations `20260727050000_add_quality_level_upgrade.sql`, cost scaling in `20260727060000_scale_upgrade_costs.sql`) — cost scales with current tier (1/2/3/4 DragonBalls for Normal/Refined/Unique/Elite), flat 70% success chance, both placeholders unresolved per CLAUDE.md. Cost is spent regardless of outcome. The Forge UI previews the real next-upgrade cost (`previewQualityUpgradeCost` in `src/game/items/forgeCosts.ts` — must stay in sync with the SQL formula, preview-only).
2. **Composition** — a separate "+N" enhancement stat, distinct from Quality tier and Level Upgrade. **Not yet implemented** — schema room (`composition_level`, `sockets`) already exists on `item_instances`.
   - Real point-cost curve (confirmed as default, replaces the earlier simplified "always exactly 2 of previous tier" description, unless told otherwise): exponential, not flat doubling — e.g. +1→+2 needs 20 points, a +3 stone is worth 120 points, +5→+6 needs 2,160 points.
   - Stones are a fungible stacked currency.
   - Real gear can also be fed in as fuel — only its composition_level/points count, all other stats/quality/enchants are discarded, and the fed item is destroyed.
   - Rare monster drops can occasionally roll in with non-zero composition already applied straight from the loot table.
   - "Quick Compose" (spend to instantly resolve, success chance = current points ÷ points required) exists in the real game — optional feature to consider later, not required for MVP.
3. **Level Upgrade** — a distinct system from Composition, raising item level, paid for with Meteors, with a success chance that can fail and consume materials. Level cap: see Gear system note above. **Implemented**: `level_upgrade(item_id)` Postgres function (same migrations as above) — cost scales as `1 + floor(current_level / 5)` Meteors, flat 80% success chance, cap 130, all placeholders unresolved per CLAUDE.md. Cost is spent regardless of outcome. The Forge UI previews the real next-upgrade cost (`previewLevelUpgradeCost` in `forgeCosts.ts` — must stay in sync with the SQL formula). `characters.meteors`/`characters.dragonballs` are the two currencies, per-character (both start at 0; no drop mechanic yet — test by setting values manually via the Supabase table editor). These currencies are deliberately **not** part of the generic autosave — the upgrade functions write them server-side, and the client only ever reads them (on load and from each function's response), to avoid a stale local value clobbering a server-side deduction.

### Sockets

Finalized, asymmetric by item type:

- **Weapons**: guaranteed unlock via Dragonballs, no RNG. 1 Dragonball for the first socket, 5 Dragonballs for the second. Max 2 sockets.
- **Armor**: RNG-based unlock — a chance (placeholder ~1/100) to gain a socket as a side effect when performing a Quality or Level Upgrade. Max 2 sockets. (We're keeping this simpler RNG-based armor system rather than adopting the real game's separate guaranteed-DB + pity-drill armor mechanic — weapons and armor are intentionally asymmetric here.)
- Once a socket exists, gems can be inserted (gems are their own tradable items before insertion).
- Socketing is permanent/destructive — an existing gem cannot be extracted, only overwritten by a new gem, which destroys the old one's effect.

**Gem system** (fully resolved, use exactly as follows — 8 gem types, each in Normal/Refined/Super quality):

| Gem | Effect | Normal | Refined | Super |
|---|---|---|---|---|
| Dragon | Physical attack | +5% | +10% | +15% |
| Phoenix | Magic attack | +5% | +10% | +15% |
| Fury | Hit accuracy | +5% | +10% | +15% |
| Tortoise | Damage reduction | +2% | +4% | +6% |
| Violet | Weapon proficiency (skill-crit) | +30% | +50% | +100% |
| Kylin | Weapon durability | +50% | +100% | +200% |
| Moon | Skill EXP gain | +15% | +30% | +50% |
| Rainbow | Character EXP gain | +10% | +15% | +25% |

Gem upgrade costs: 15 Normal gems + 10,000 gold → 1 Refined gem. 15 Refined gems + 800,000 gold → 1 Super gem. (Tortoise has a special cross-type recipe in the real game — needs a follow-up detail check before implementing.)

### Inventory

- Slot cap: use the real scaling model as default rather than a flat number — cap grows via bag item upgrades, from 30 up to 40 slots, maxing around character level 67. Exact intermediate tier breakpoints are **unresolved — needs a follow-up detail pass** if we want to replicate them precisely.
- If the bag is full: while AFK, drops are simply wasted; while actively playing, the player is prompted to drop an existing item to make room instead.
- Items display as square icons with quality-colored borders; hover tooltips show name, quality, slot, level, stats, and level requirement (Diablo/PoE-style).

### Equipment / Hero page

Paper-doll layout with class-specific slot arrangement, quality-glowing equipped item tiles, tap-to-unequip, hover tooltips, and total stats (ATK/DEF/HP/attack speed) shown at the top. Confirmed, no changes needed.

### Forge

Two upgrade paths: Level Upgrade (via Meteors only) and Quality Upgrade (via Dragonballs only — see corrected currency split under Progression), each with a success chance that reduces with item level/tier and consumes materials on failure.

- Specific costs and success percentages for both paths are **unresolved — needs deliberate design, not sourced**.
- Drag-and-drop before/after preview is a planned but unbuilt UI feature.

### Persistence

Confirmed and implemented (base progress only — no promotion tiers, gear, or AFK simulation persisted yet):

- Split across two tables since the character-slots restructure (see Accounts & Characters above): `players` holds account-level fields only (`last_seen_version`, `bank_gold`, `unlocked_classes`); `characters` holds one row per character (`class`, `level`, `gold`, `exp`, `current_zone`, `meteors`, `dragonballs`, `equipped_item_id`). `usePlayerRecordStore` handles the former (keyed by `userId`); `useCharacterRecordStore` handles the latter (keyed by the active `characterId`). Migrations in `supabase/migrations/`.
- On login, the player row is fetched (account-level state + the What's New check). A genuinely new account (no row yet) gets one created from defaults rather than erroring. Selecting/creating a character then fetches that character's row and hydrates local state (class, level, gold, EXP, zone, equipped item) — nothing character-specific loads until a character is actually chosen.
- Save strategy is a combination, not a single trigger: a ~2s debounce after any gold/EXP/level/class/zone/equipped-item change on the **active character**, an immediate bypass-the-debounce save on level-up specifically, and a best-effort safety-net save on `visibilitychange` (tab hidden) + `beforeunload`. Meteors/dragonballs are excluded from this — see the Gear system section.
- This intentionally does **not** replicate the old debounced-autosave/last-tick-time approach from a prior iteration of this project — it's a fresh design built around the current stores (`usePlayerRecordStore`, `useCharacterRecordStore`, `usePersistGameState`).
- **Migration gotcha (learned the hard way on `item_templates`/`item_instances`)**: creating a table via raw SQL migration does **not** automatically grant `anon`/`authenticated` roles table-level access — RLS policies only govern row-level access on top of that. The Supabase Table Editor UI auto-grants; a SQL migration must do it explicitly (`grant select on public.foo to anon, authenticated;` etc.) or every request 403s with `permission denied for table foo` regardless of how correct the RLS policies are. Always include explicit `GRANT` statements for new tables going forward.

### Explicitly cut — do not implement

- The old monster queue/summon-batch system.
- The 500ms kill delay between queue targets.
- The old zone-page UI layout (hero-left/enemy-right/queue-strip).
