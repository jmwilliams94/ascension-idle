interface ToggleRowProps {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}

export default function ToggleRow({ label, checked, onChange }: ToggleRowProps) {
  return (
    <label className="flex items-center justify-between gap-4 text-sm text-slate-300">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-sky-500' : 'bg-slate-700'
        }`}
      >
        {/* Explicit left-0.5/top-0.5 base position (not just top, relying on
            the browser's implicit "static position" fallback for the missing
            left) — that fallback depends on whether the button has any
            default padding, which is exactly what was pushing the knob
            outside the pill. translate-x now only carries the on/off delta,
            not the base inset, so both states stay symmetric (2px each
            side). */}
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  )
}
