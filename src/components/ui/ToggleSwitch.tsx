// Promoted out of VipSettingsModal.tsx (2026-08-28, its sole consumer until
// NotificationsSettingsPanel.tsx became a second) -- unchanged in behavior.
export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border p-0 transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'border-slate-300 bg-slate-300/80' : 'border-slate-700 bg-slate-800'
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
