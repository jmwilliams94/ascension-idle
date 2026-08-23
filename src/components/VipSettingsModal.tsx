import { useVipSettingsModalStore } from '../game/vip/useVipSettingsModalStore'
import { useVipAutomationStore, type LiquidationPriority, type SalvageTier } from '../game/vip/useVipAutomationStore'
import { Button } from './ui/Button'

const SALVAGE_TIER_OPTIONS: { value: SalvageTier; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'tempered', label: 'Tempered' },
  { value: 'infused', label: 'Infused' },
  { value: 'radiant', label: 'Radiant' },
  { value: 'ascended', label: 'Ascended' },
]

const BANK_LEVEL_OPTIONS = Array.from({ length: 12 }, (_, index) => index + 1)

function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border p-0 transition ${
        checked ? 'border-amber-500 bg-amber-500/80' : 'border-slate-700 bg-slate-800'
      }`}
      aria-label={label}
    >
      {/* Anchored with an explicit left-0.5, not left as an implicit static
          position — a bare <button> keeps the browser's default padding
          unless zeroed (see p-0 above), which throws off an unanchored
          absolute + translate-x child. translate-x then layers on top of
          this fixed anchor for the "on" position instead of assuming 0. */}
      <span
        className={`absolute left-0.5 top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[20px]' : ''}`}
      />
    </button>
  )
}

// VIP settings overlay (v1.108.0) — opened by clicking VipStatusHud's HUD
// badge. Every toggle here is a pure convenience wrapper around actions the
// player can already do manually (Shop Sell, Salvage, Bank's "Bank"
// liquidate-to-points action) — see VipAutomationEngine.tsx for the actual
// automation loop these settings drive.
export default function VipSettingsModal() {
  const open = useVipSettingsModalStore((state) => state.open)
  const closeModal = useVipSettingsModalStore((state) => state.closeModal)
  const settings = useVipAutomationStore((state) => state.settings)
  const updateSettings = useVipAutomationStore((state) => state.updateSettings)

  if (!open) {
    return null
  }

  const setPriority = (priority: LiquidationPriority) => void updateSettings({ priority })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={closeModal}>
      <div
        className="w-full max-w-md space-y-5 rounded-2xl border border-amber-500/40 bg-slate-900 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold text-amber-300">👑 VIP Automations</h2>
          <button type="button" onClick={closeModal} className="text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-100">Auto-Sell Ore</p>
              <ToggleSwitch checked={settings.autoSellOre} onChange={(checked) => void updateSettings({ autoSellOre: checked })} label="Auto-Sell Ore" />
            </div>
            <p className="text-[11px] text-slate-500">Sells Ore for gold as it's mined, so it never fills up your Inventory.</p>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-100">Auto-Salvage Quality Gear</p>
              <ToggleSwitch
                checked={settings.autoSalvage.enabled}
                onChange={(checked) => void updateSettings({ autoSalvage: { ...settings.autoSalvage, enabled: checked } })}
                label="Auto-Salvage Quality Gear"
              />
            </div>
            <p className="text-[11px] text-slate-500">Salvages dropped gear at or above the chosen quality for Ascension Points.</p>
            {settings.autoSalvage.enabled && (
              <label className="flex items-center gap-2 text-xs text-slate-400">
                Minimum quality:
                <select
                  value={settings.autoSalvage.minTier}
                  onChange={(event) =>
                    void updateSettings({ autoSalvage: { ...settings.autoSalvage, minTier: event.target.value as SalvageTier } })
                  }
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                >
                  {SALVAGE_TIER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-100">Auto-Bank +N Gear</p>
              <ToggleSwitch
                checked={settings.autoBank.enabled}
                onChange={(checked) => void updateSettings({ autoBank: { ...settings.autoBank, enabled: checked } })}
                label="Auto-Bank +N Gear"
              />
            </div>
            <p className="text-[11px] text-slate-500">
              Liquidates gear at or above the chosen Composition level into that slot's Gear Points pool. This destroys the item
              — same as the Bank tab's manual "Bank" action, not physical storage.
            </p>
            {settings.autoBank.enabled && (
              <label className="flex items-center gap-2 text-xs text-slate-400">
                Minimum Composition level:
                <select
                  value={settings.autoBank.minLevel}
                  onChange={(event) => void updateSettings({ autoBank: { ...settings.autoBank, minLevel: Number(event.target.value) } })}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                >
                  {BANK_LEVEL_OPTIONS.map((level) => (
                    <option key={level} value={level}>
                      +{level}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {settings.autoSalvage.enabled && settings.autoBank.enabled && (
            <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-sm font-medium text-slate-100">When an item qualifies for both</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPriority('bank_first')}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                    settings.priority === 'bank_first'
                      ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                      : 'border-slate-700 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  Bank before Salvage
                </button>
                <button
                  type="button"
                  onClick={() => setPriority('salvage_first')}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                    settings.priority === 'salvage_first'
                      ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                      : 'border-slate-700 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  Salvage before Bank
                </button>
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-600">🔒 Lock an item (Equipment tab) to protect it from every auto-liquidation rule above.</p>
        </div>

        <Button variant="secondary" className="w-full" onClick={closeModal}>
          Done
        </Button>
      </div>
    </div>
  )
}
