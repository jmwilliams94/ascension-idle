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
- **Character-level** (`characters` table): `class`, `level`, `exp`, `name`, `gold` (personal wallet, distinct from the account's shared bank, default **5,000** for newly created characters — placeholder amount, unresolved per CLAUDE.md), `meteors`, `dragonballs`, `equipped_item_id`, `equipped_arrow_stack_id`, `current_zone`. Items (`item_instances.owner_id`) belong to a specific character, not the account — a character's inventory/equipment/forge progress doesn't carry over to a sibling character on the same account.
- **Character creation**: only Hunter is selectable today. Twin-soul/Wuxia/Juggernaut show locked with a placeholder condition ("Unlocks after a Hunter reaches level 100") — placeholder threshold, real max level unresolved per CLAUDE.md. Only the *display* of this lock is implemented; there's no mechanism yet that actually adds to `unlocked_classes` when a Hunter hits that level — that's a separate future step. Class is chosen once at creation and fixed thereafter — `StatsPanel`'s old dev-only live class-switch buttons were removed (now that `CharacterSelectScreen` is the real class picker, a second way to change class live was confusing/redundant); `StatsPanel` shows the character's class read-only.
- **Character select layout**: `CharacterSelectScreen`'s slots render as a single column (not a 2-column grid) — one card per row, each showing name/class/level with Play/Delete actions.
- **Character naming (confirmed, implemented)**: every character is named at creation time. Format is exactly one leading capital letter followed by lowercase letters only (`^[A-Z][a-z]*$` — e.g. "Aragorn"), enforced both client-side (`CHARACTER_NAME_PATTERN` in `useCharacterRosterStore.ts`, immediate UX feedback) and server-side via a DB CHECK constraint (`characters_name_format_check`) — the DB is the real source of truth. Names must be unique **across every account**, not just within one, enforced via a DB UNIQUE constraint (`characters_name_unique`). `createCharacter` maps Postgres error codes 23505 (unique_violation → "That name is already taken") and 23514 (check_violation → bad format) to user-facing messages.
- **Character deletion (confirmed, implemented)**: from `CharacterSelectScreen`, each filled slot has a "Delete" action that requires typing the character's exact name to confirm before the delete fires (`characters` row deleted outright — cascades to that character's `item_instances`/`arrow_stacks` via `on delete cascade`). Requires a DELETE RLS policy + `grant delete` on `characters` (`account_id = auth.uid()`), which didn't exist before this feature.
- **Login flow**: after auth, a character-select screen (`CharacterSelectScreen`) shows all 5 slots before any gameplay is reachable — `GameShell` (the actual game UI) only renders once a character is chosen. Switching characters mid-session (a "Switch Character" button) just clears the active character, returning to select, without signing out.
- Active-character selection persists across a page refresh via `localStorage`, keyed per account id (`greybox-last-character:<accountId>` — see `useActiveCharacterStore.ts`) so it can't leak between accounts on a shared browser. Resumed once per fresh page load only — signing out and back in within the same tab (no refresh) or clicking "Switch Character" both intentionally return to character select rather than re-resuming. A stored id that no longer resolves to a real, owned character (deleted, wrong account, etc.) self-heals back to character select instead of soft-locking.

### Classes

4 classes, with confirmed real-game mapping: Hunter = Archer (ranged), Twin-soul = Trojan (dual-wield melee), Wuxia = Taoist (mystic backsword — Taoist's real signature weapon is genuinely called the "Backsword," so no change needed there), Juggernaut = Warrior (heavy tank).

- No abilities are implemented yet — planned but deferred until we reach that stage of development.
- Hunter has a quiver/ammo mechanic (arrow tiers, must equip arrows to fight). **Implemented as real multi-stack inventory**, not a flat per-type counter: arrows live in their own `arrow_stacks` table (`id`, `character_id`, `arrow_type`, `count`), each stack a discrete row capped at its type's `stackSize` (Iron 500, Lucky 50, Speed 5000 — placeholder sizes, unresolved per CLAUDE.md). A stack is the actual purchasable unit — the Shop's single "Buy" button per arrow type always buys one full stack at once (`stackSize` arrows for `stackSize × price` gold; no partial/per-arrow purchase option), topping up an existing non-full stack of that type before creating a new one (`useArrowStore.buyArrows`). Equipping targets a **specific stack**, not just a type (`characters.equipped_arrow_stack_id`) — depleting the equipped stack never touches any other stack of the same type sitting in inventory; equip/switch happens from the Inventory panel (a per-stack "Equip" button), not the Shop. Depleted (0-count) stacks are left in the DB rather than deleted (avoids insert/delete-diffing in the debounced autosave) and simply hidden from the Inventory view. Three placeholder arrow types (`src/game/items/arrowTypes.ts`, no real reference data): Iron (1 gold, no effect), Lucky (3 gold, +2% gear drop chance while equipped — placeholder, not yet wired into the actual drop roll), Speed (3 gold, +10% attack speed while equipped — placeholder, not yet wired into derivedStats). Buying arrows is a direct client-side gold spend (same trust model as gold/exp generally — not a `SECURITY DEFINER` function like the Forge upgrades, since arrow purchases don't involve a roll or a materials-vs-outcome integrity concern). A Hunter with no equipped stack or a depleted one cannot attack at all (manual or auto-attack) — gated in `IsometricScene.attemptAttack()` via `useArrowStore.consumeArrow()`, with a bottom-left HUD readout (`ArrowCounterHud`) that flashes on a blocked attempt. Other classes are unaffected.
- **Bottom-nav overlay pattern (confirmed, all five panels)**: `BottomNav`'s five buttons (Zone, Equipment, Forge, Market, Shop) each open their panel as an absolutely-positioned overlay on top of `GameCanvas` via the shared `useOverlayStore` (`activeOverlay: OverlayId | null`, one open at a time) and shared `OverlayPanel` chrome component (title bar + close X) — `BottomNav` itself always stays visible/usable underneath. Each button is a toggle (`useOverlayStore.toggle`): clicking the already-open overlay's button again closes it, same as the X. `ZoneOverlay`/`EquipmentOverlay`/`ForgeOverlay`/`MarketplaceOverlay`/`ShopOverlay` are thin wrappers pairing `OverlayPanel` with the corresponding `*Panel` content component. None of these five have any presence in the side HUD (`SideHud.tsx`, rendered in `GameShell`'s aside), which shows Stats and Inventory, both always visible, neither a manually-selectable tab. Non-Hunter classes see "Nothing available yet" in the shop.
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

- **Implemented**: a single fixed 40-cell grid (`INVENTORY_SLOT_CAP` in `useInventoryStore.ts`), always rendering all 40 cells regardless of how many are occupied — empty cells render dimmed/unclickable (`InventorySlot`, a deliberately dumb/presentational per-cell component keyed by a stable `slotId`, so the upcoming Forge drag-and-drop step can target a specific cell directly). Rendered via `SideHud.tsx`, always visible in the aside alongside Stats (not tied to any overlay being open). The real scaling-by-level model (cap growing from 30 up to 40 via bag item upgrades, maxing around character level 67) is **not built yet** — every character is currently treated as already at the max 40 — unresolved per CLAUDE.md, exact intermediate tier breakpoints still need a follow-up pass if we replicate it precisely later.
- **A Hunter arrow stack occupies a slot exactly like a gear item does** — both `arrow_stacks` (count > 0 only) and `item_instances` share the same 40-cell grid and the same cap (`occupiedSlotCount` in `useInventoryStore.ts`, which reaches into `useArrowStore` to count visible stacks). Arrow slots show a small count/stackSize badge (e.g. "3/50") in the corner instead of the quality-tinted border gear uses (arrows have no quality tier). Forge's own drag-and-drop only ever cares about gear, but arrows still live in the same visual grid rather than a separate list — clicking either kind of slot opens the same detail card below the grid (arrow: type + count + Equip; gear: name/quality/level/stats + Equip).
- Filled cells show a quality-tinted border/background (`getQualityColor`, matching Forge/Equipment) for gear, or a neutral border + count badge for arrows; clicking one selects it and opens a detail card below the grid (implemented as an inline detail card rather than a floating tooltip, consistent with ForgePanel's existing selected-item pattern) — empty cells aren't clickable.
- **Full-inventory behavior (implemented)**: `useInventoryStore.rollDropForKill` takes an `interactive` flag (default `true`, since every kill today happens through live, actively-played combat — the AFK/offline simulation described in Core Loop doesn't exist yet, see Persistence). If the combined item+arrow-stack slot count is at the 40 cap: when not interactive, the gear drop is silently wasted, no prompt (reserved for when the AFK system is eventually built and can call this with `interactive=false`); when interactive, the drop is held as `pendingFullDrop` and `InventoryFullModal` (mounted unconditionally in `GameShell`) asks the player to discard an existing gear item **or arrow stack** to make room, or discard the new drop instead — never auto-resolved. Discarding an arrow stack here (`useArrowStore.deleteStack`) actually deletes the row, unlike normal depletion which leaves a hidden 0-count stack behind.
- Hover tooltips (as opposed to the click-to-select detail card above) are not yet implemented; slot/level-requirement fields shown in a future tooltip are still open per the original Diablo/PoE-style ambition.

### Equipment / Hero page

Paper-doll layout with class-specific slot arrangement, quality-glowing equipped item tiles, tap-to-unequip, hover tooltips, and total stats (ATK/DEF/HP/attack speed) shown at the top. Confirmed, no changes needed to this ambition — see below for what's actually implemented so far.

- **Implemented (`EquipmentPanel.tsx`/`EquipmentSlot.tsx`)**: a CSS-grid paper-doll (`gridTemplateColumns: '30% 40% 30%'`, named `gridTemplateAreas`) around a central character placeholder (no art — a plain bordered box with a silhouette emoji, per this step's explicit scope). Slot positions: Headgear top-left (above the character), Boots left-middle, a 3-slot accessory column on the right (Necklace/Ring/Earring), and a bottom row of 3 (Weapon, then two generic Armor placeholders). Only **Weapon** is functional (reflects `equipped_item_id`, the existing single-slot shortcut) — clicking it toggles a detail card below the doll with name/quality/level/stats and an Unequip button (equip itself happens from the Inventory grid, same as before this step). Every other slot (`locked` prop on `EquipmentSlot`) is a non-interactive, greyed-out placeholder showing a faint icon hinting at its type (🪖/👢/📿/💍/🧿/🛡️×2) — there's no schema, no items, and no per-class slot-assignment finalization behind any of them yet (see Gear slots above). `EquipmentOverlay`'s title bar shows the character's level alongside "Equipment" (`Lv. {level} — Equipment`), reading `useProgressionStore`.
- Hover tooltips beyond the native `title` attribute (used for both the Weapon slot and the locked placeholders) are not built — the richer Diablo/PoE-style tooltip described above is still aspirational.

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
- **Email confirmation redirect fix**: `signUp()` now passes an explicit `emailRedirectTo` (derived at call time as `${window.location.origin}${import.meta.env.BASE_URL}`, so it's correct for both local dev and the deployed GitHub Pages URL without hardcoding a domain) — without it, Supabase falls back to whatever "Site URL" is configured in the dashboard's Auth settings, and if that's stale/unset the confirmation button lands on an unreachable page (the account still gets confirmed server-side regardless, so signing in afterward works either way). Supabase also silently ignores an `emailRedirectTo` that isn't present in the dashboard's Auth → URL Configuration → Redirect URLs allow-list and falls back to the broken Site URL anyway — that allow-list must include the app's actual URL(s) for this fix to take effect.

### Explicitly cut — do not implement

- The old monster queue/summon-batch system.
- The 500ms kill delay between queue targets.
- The old zone-page UI layout (hero-left/enemy-right/queue-strip).
