import { useState } from 'react'
import InventoryPanel from './InventoryPanel'
import BankGrid from './BankGrid'
import BankSquares from './BankSquares'
import { AscensionCard } from './ui/AscensionCard'
import { useCharacterRecordStore } from '../lib/useCharacterRecordStore'

type BankView = 'inventory' | 'storage'

// Bank tab rework (2026-08-03, confirmed with the user) — replaces the old
// always-both-visible Storage-grid-stacked-above-Inventory layout with two
// toggle buttons (the character's own name vs. "Account") switching a single
// main area between the Inventory grid and the Storage grid. Since the two
// are never shown at the same time anymore, drag-and-drop between them is no
// longer possible (or needed) — depositing/withdrawing now goes entirely
// through InventoryPanel's enableBankDeposit click popover (Deposit/Bank
// buttons) and BankGrid's own click-to-withdraw popover, no
// DragDropProvider/data-drop-zone wiring left in this file at all.
// BankSquares (the right column) is always rendered regardless of which
// side the toggle is on — it shows account-wide totals independent of
// whether the main area is currently showing Inventory or Storage.
export default function BankPanel({ characterId }: { characterId: string }) {
  const characterName = useCharacterRecordStore((state) => state.characterName)
  const [view, setView] = useState<BankView>('inventory')

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:max-w-xs">
        <button
          type="button"
          onClick={() => setView('inventory')}
          className={`rounded-xl border px-4 py-2 text-sm font-medium ${
            view === 'inventory' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          {characterName || 'Character'}
        </button>
        <button
          type="button"
          onClick={() => setView('storage')}
          className={`rounded-xl border px-4 py-2 text-sm font-medium ${
            view === 'storage' ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          Account
        </button>
      </div>

      {/* min-w-0 on both columns: grid items default to min-width:auto
          (content-based), so without it a wide unwrapped row inside
          BankSquares grows the whole grid track — and the whole page —
          wider than the viewport instead of actually wrapping. */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          {view === 'inventory' ? (
            <AscensionCard>
              <InventoryPanel columns={5} enableBankDeposit />
            </AscensionCard>
          ) : (
            <BankGrid characterId={characterId} />
          )}
        </div>

        <div className="min-w-0">
          {/* Reported by a user as "I withdrew 40 Comets and have no idea
              what happened to them" — they were almost certainly still on
              the Account/Storage toggle (which never shows currency at all,
              only banked gear) when a withdrawal landed in their Character
              Inventory instead. Auto-switching to the Character view right
              when something new lands there makes the result impossible to
              miss, on top of the clearer toast wording below. */}
          <BankSquares characterId={characterId} onWithdrawLandedInInventory={() => setView('inventory')} />
        </div>
      </div>
    </div>
  )
}
