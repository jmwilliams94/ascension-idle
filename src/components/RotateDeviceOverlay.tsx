// Pure-CSS visibility (see .rotate-device-overlay in index.css) — always
// mounted, hidden by default, shown only on a touch device in landscape.
// Blocks the game underneath rather than letting it reflow sideways, since
// a real orientation *lock* isn't achievable everywhere (see index.css's
// comment on this class for the platform breakdown).
export default function RotateDeviceOverlay() {
  return (
    <div className="rotate-device-overlay ascension-page-bg fixed inset-0 z-[100] flex-col items-center justify-center gap-4 p-6 text-center text-slate-100">
      <span className="text-5xl" aria-hidden="true">
        📱
      </span>
      <p className="font-heading text-gradient-steel text-lg font-black uppercase tracking-[0.15em]">Rotate Your Device</p>
      <p className="max-w-xs text-sm text-slate-400">Ascension Idle is designed for portrait mode. Turn your device back upright to continue.</p>
    </div>
  )
}
