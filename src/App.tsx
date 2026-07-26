import GameCanvas from './components/GameCanvas'

function App() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1e293b,_#020617_70%)] text-slate-100">
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Greybox Idle v1</p>
            <h1 className="text-xl font-semibold text-white">Isometric movement demo</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[1.6fr_0.7fr]">
        <section className="rounded-3xl border border-slate-800/80 bg-slate-900/70 p-4 shadow-xl shadow-slate-950/30">
          <GameCanvas />
        </section>

        <aside className="space-y-4 rounded-3xl border border-slate-800/80 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/20">
          <div>
            <h2 className="text-lg font-semibold text-white">World HUD</h2>
            <p className="mt-2 text-sm text-slate-400">
              Placeholder panel for future inventory, abilities, and status panels.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <p className="text-sm font-medium text-slate-200">Current focus</p>
            <p className="mt-2 text-sm text-slate-400">
              The game viewport is intentionally isolated from the React chrome so it can be expanded later.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <p className="text-sm font-medium text-slate-200">Next steps</p>
            <ul className="mt-2 space-y-2 text-sm text-slate-400">
              <li>• Add units and interactable tiles</li>
              <li>• Expand the HUD and inventory</li>
              <li>• Introduce richer tile visuals</li>
            </ul>
          </div>
        </aside>
      </main>
    </div>
  )
}

export default App
