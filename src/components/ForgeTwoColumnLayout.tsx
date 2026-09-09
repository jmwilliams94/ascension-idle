import type { ReactNode } from 'react'
import { Button } from './ui/Button'
import { useTutorialStore } from '../game/tutorial/useTutorialStore'
import { TUTORIAL_STEP_IDS } from '../game/tutorial/tutorialSteps'

interface ForgeTwoColumnLayoutProps {
  // Optional (2026-09-05) — ForgeStandardPanel omits it since GameShell's own
  // persistent large "FORGE" page-identity heading (TAB_TITLES['forge'],
  // wraps every Forge sub-panel) already says the exact same word for that
  // one panel. Every other sub-panel (Master Forge, Composition, Salvage,
  // Sockets, Enchantress) still passes its own distinct title — those aren't
  // redundant, so they're untouched.
  title?: string
  onBack: () => void
  inventory: ReactNode
  children: ReactNode
}

// Shared shell for every Forge sub-panel — a Back button + title row, then
// that panel's own controls (upgrade slot(s), buttons, previews), single
// column. The `inventory` prop (each sub-panel's own InventoryPanel embed)
// only renders below `lg` now (2026-09-09 desktop UI overhaul) — at `lg`+
// the 40-slot grid lives once, persistently, in GameShell's right column
// instead of once per Forge sub-panel (see useForgeDropTargetStore.ts for
// how each sub-panel still wires its own drop handling to that shared grid).
// Kept as its own prop rather than folded away, since mobile still needs a
// real Inventory grid rendered somewhere inside this same DragDropProvider.
//
// Stacked-order fix (2026-08-13, reported by the user — "the inventory is
// sitting at the top of every one of the forge pages"): controls render
// first, Inventory (mobile-only) below — matches what you want to see/act
// on first.
export default function ForgeTwoColumnLayout({ title, onBack, inventory, children }: ForgeTwoColumnLayoutProps) {
  // First-login tutorial (admin-only for now) — after the Quality Upgrade
  // step, the tutorial needs the player back on ForgeHub (see ForgePanel.tsx)
  // before it can spotlight the Sockets tile, since that tile doesn't exist
  // in the DOM while a sub-panel like this one is open.
  const isTutorialBackStep = useTutorialStore((state) => state.isStepActive(TUTORIAL_STEP_IDS.forgeBackToHub))
  const advanceTutorial = useTutorialStore((state) => state.advance)

  return (
    // break-inside-avoid (2026-09-09) — GameShell now wraps the active tab's
    // content in a CSS multi-column layout on desktop (two equal columns,
    // overflow into column two); every Forge sub-panel is one tightly-
    // coupled interactive unit (upgrade/material/socket slots side by side)
    // that must never get visually cut in half at a column break, so it
    // stays a single unsplittable block — see GameShell.tsx's own comment on
    // that container for the tradeoff this implies (a panel like this one
    // simply renders in column one, with column two left empty next to it).
    <div className="space-y-4 break-inside-avoid">
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          data-tutorial-id="forge-back"
          onClick={() => {
            onBack()
            if (isTutorialBackStep) {
              advanceTutorial()
            }
          }}
        >
          ← Forge
        </Button>
        {title && <h2 className="font-heading text-gradient-steel text-sm font-black uppercase tracking-[0.15em]">{title}</h2>}
      </div>

      <div className="flex flex-col items-center gap-6">{children}</div>
      <div className="lg:hidden">{inventory}</div>
    </div>
  )
}
