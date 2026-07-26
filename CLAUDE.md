# Greybox Idle

## Git workflow

- Commits should always be followed by a push to `main`, unless explicitly told otherwise.

## Game design (source of truth)

This section is the confirmed design source of truth for Greybox Idle. Anything marked "placeholder" is a stand-in value that must be replaced with real reference data (primarily from Conquer Online) before it's treated as final; anything not marked placeholder is confirmed and should not be changed without discussion.

### Core loop

Hybrid action/idle RPG. While actively playing, the player moves on an isometric grid and fights manually using basic attacks and (later) abilities. While away, rewards are calculated as if the player were fighting at a simulated kill rate based on their character's DPS against the last zone/monster they were fighting, capped at a maximum offline duration, with a summary shown on return.

### Classes

4 classes: Hunter (ranged), Twin-soul (dual-wield melee), Wuxia (mystic backsword), Juggernaut (heavy tank).

- Base stats, gear slot names, and unlock levels are placeholders — need real Conquer Online reference data.
- No abilities are implemented yet — planned but deferred until we reach that stage of development.
- Hunter has a quiver/ammo mechanic (arrow tiers, must equip arrows to fight).

### Combat

Manual grid-based combat when actively playing (no queue, no auto-target). Floating combat text on hit.

- Damage formula is a placeholder needing real reference or proper design.
- Rare monsters: 5% chance per monster, 2× HP, 5× gold/EXP, distinct visual treatment (TBD).

### Zones

Zones are real explorable maps populated with enemies placed throughout — not a summon/queue system.

- 7 zones exist conceptually; names need finalizing (working direction: similar theme to original names but not copies).
- All economy numbers (gold/kill, EXP/kill, monster HP, gear level per zone) are placeholders needing real reference data.

### Progression

- Promotion tiers at levels 1, 15, 40, 70, 100, 110, 120 — confirmed, keep as-is.
- Currencies: Gold, Meteors, Dragonballs — confirmed names, keep as-is.
- EXP curve formula and meteor/dragonball drop rates are placeholders needing real reference data.

### Loot

- Gear/meteor/dragonball drop rates are placeholders needing real reference data.
- Rare-monster status affects the existing roll rather than being a separate roll.

### Gear system

Quality tiers, in order: Normal → Refined → Unique → Elite → Super — confirmed tier names, keep as-is.

- Drop weights, stat multipliers, tier colors, the stat-scaling formula, and level caps are all placeholders needing real reference data.
- Gear naming chains (e.g. "Wooden Bow → Eternal Bow +10") are placeholder flavor text, not yet finalized.

Three separate item-progression systems — do not conflate:

1. **Quality tier** — Normal through Super, as above.
2. **Composition** — a separate "+N" enhancement stat (+1 to +4 confirmed so far, likely extends further).
   - Progression: +0→+1 costs 2 base stones; each subsequent tier (+1→+2, +2→+3, +3→+4) costs 2 items/stones already at the previous tier.
   - Stones are a fungible stacked currency.
   - Real gear can also be fed in as fuel — only its composition_level counts, all other stats/quality/enchants are discarded, and the fed item is destroyed.
   - Rare monster drops can occasionally roll in with non-zero composition already applied straight from the loot table.
3. **Level Upgrade** — a distinct system from Composition, raising item level (placeholder cap 130 weapons/120 armor, needs real reference), paid for with Meteors, with a success chance that can fail and consume materials.

### Sockets

- Max 2 per item. Not present on drop — unlocked via a chance proc when performing a Quality or Level Upgrade (rates currently placeholder, need real reference or deliberate design).
- Once a socket exists, gems can be inserted (gems are their own tradable items before insertion).
- Socketing is permanent/destructive — an existing gem cannot be extracted, only overwritten by a new gem, which destroys the old one's effect.
- 8 gem types (Dragon, Moon, Violet, Kylin, Fury, Tortoise, Phoenix, Rainbow) per Conquer Online reference, each in normal/refined/super quality, granting a randomized enchant value on insertion (e.g. health, up to a max per real reference — confirm exact cap).

### Inventory

- Slot cap is a placeholder needing real reference data.
- If the bag is full: while AFK, drops are simply wasted; while actively playing, the player is prompted to drop an existing item to make room instead.
- Items display as square icons with quality-colored borders; hover tooltips show name, quality, slot, level, stats, and level requirement (Diablo/PoE-style).

### Equipment / Hero page

Paper-doll layout with class-specific slot arrangement, quality-glowing equipped item tiles, tap-to-unequip, hover tooltips, and total stats (ATK/DEF/HP/attack speed) shown at the top. Confirmed, no changes needed.

### Forge

Two upgrade paths: Level Upgrade (via Meteors) and Quality Upgrade (via Meteors + Dragonballs), each with a success chance that reduces with item level/tier and consumes materials on failure.

- All specific costs and success percentages are placeholders needing real reference data.
- Drag-and-drop before/after preview is a planned but unbuilt UI feature.

### Persistence

To be designed from scratch against Supabase — do not port the old debounced-autosave/last-tick-time approach without discussion first.

### Explicitly cut — do not implement

- The old monster queue/summon-batch system.
- The 500ms kill delay between queue targets.
- The old zone-page UI layout (hero-left/enemy-right/queue-strip).
