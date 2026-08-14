# Visual Design System

> Part of the split `CLAUDE.md` docs — see [`CLAUDE.md`](CLAUDE.md) for git/versioning workflow and cross-cutting gotchas.

**Gold/steel "Ascension" theme (2026-08-14, confirmed app-wide)** — supersedes the earlier plain-typography/no-gradients look entirely. Cinzel serif headings, gradient gold (`#fff3a1→#d4af37→#997a15`) and steel (`#ffffff→#c0d1e3→#7a8b9e`) text, thin gradient-bordered "ribbon" cards, gold-gradient CTA buttons with a hover glow.

- **Shared primitives, `src/components/ui/`** — use these for any new UI, don't hand-roll card/button/select markup:
  - `AscensionCard` — the gradient-frame card. `title` prop renders a floating ribbon (pulsing gold stars + steel-gradient Cinzel heading); omit it for a plain frame with no ribbon.
  - `Button` — `variant: 'primary' | 'secondary' | 'danger'`. `primary` = gold CTA (the one positive action of a panel — Buy/Confirm/Claim/Fight-style). `secondary` = steel outline (Cancel/Back/neutral). `danger` = red outline (Delete/destructive). No width is set — pass `className="w-full"` etc. yourself.
  - `Select` — wraps a native `<select>` in the same chrome with a custom arrow overlay; preserves per-`<option>` inline `style` colors (e.g. level-diff coloring) unchanged.
- **CSS tokens/classes, `src/index.css`** — `.ascension-card-frame`/`.ascension-card-inner`/`.ascension-card-ribbon` (the card chrome the component wraps), `.text-gradient-gold`/`.text-gradient-steel`, `.btn-gold`, `.text-heading-label` (small-caps Cinzel field label), `.ascension-glow-pulse` (breathing gold glow, `currentColor`-based like the pre-existing `.accent-glow`).
- **Active/selected toggle state** (tab selectors, sub-tab pickers — not a `Button`, since `Button` has no notion of a selected state): gold accent (`border-amber-400 bg-amber-500/10 text-amber-300`), not the app's old sky-500 accent. Every top-level page's nav (`TabNav.tsx`/`MobileBottomNav.tsx`) and in-page sub-tab pickers (Achievements' Character/Account/Pets, Marketplace's Browse/My Listings/Mail, etc.) follow this.
- **Page-level framing**: `GameShell.tsx`'s `<section>` wrapping whichever tab is active carries the gradient-frame chrome itself (`.ascension-card-frame`/`.ascension-card-inner`, no ribbon) — every page's own `AscensionCard`s nest inside that outer frame.
- **Guardrail — never repaint gameplay-data color coding with this system**: item quality-tier colors, level-diff colors, HP bars, rarity glows (`.super-quality-glow`), tier ember effects, and other established semantic accents (emerald = Fighting/positive state, purple = Ascension Points currency, rose = destructive) are a separate, untouched system. Gold/steel is UI chrome only.
- Full rollout history/reasoning: memory `feedback_ui_visual_style.md` (also records why this reverses an earlier "no gradients" preference — execution/coherence mattered, not gradients-per-se).
