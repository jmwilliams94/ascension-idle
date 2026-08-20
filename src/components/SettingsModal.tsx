import { lazy, Suspense, useState, type ReactNode } from 'react'
import { changelogNewestFirst } from '../lib/changelog'
import { useIsAdmin } from '../lib/adminConfig'
import { useBugReportStore, countOpenBugReports } from '../game/bugReports/useBugReportStore'
import { useSuggestionStore, countOpenSuggestions } from '../game/suggestions/useSuggestionStore'
import AdminMailSection from './AdminMailSection'
import ChangelogEntries from './ChangelogEntries'
import ItemEffectGallery from './ItemEffectGallery'
import PlanPanel from './PlanPanel'
import SuggestionsPanel from './SuggestionsPanel'
import BugReportPanel from './BugReportPanel'

// Lazy -- three/@react-three/fiber/drei/postprocessing alone push the main
// bundle's single chunk past vite-plugin-pwa's 2MB Workbox precache limit
// (build fails outright, not just a size warning) if imported eagerly here.
// Code-splitting this behind the tab click keeps that weight out of every
// player's initial load and out of the precache manifest entirely -- it's a
// dev/debug tool, not gameplay UI, so no one should pay for it unless they
// open it.
const RenderingTestPanel = lazy(() => import('./RenderingTestPanel'))

interface SettingsSection {
  id: string
  label: string
  content: ReactNode
  badge?: number
}

// Plans/Suggestions/Bug Reports (2026-08-21, requested by the user) live
// here rather than as their own top-level TabNav/MobileBottomNav tabs — all
// three are meta/support pages, not gameplay pages, same shelf as
// Changelog/Item Effects/Admin. Plans re-adds the original To-Do board
// (dropped when Suggestions was first introduced) with one addition:
// admin-only drag-and-drop reordering (see PlanPanel.tsx). Unlike Admin,
// all three are visible to every player (not isAdmin-gated) — Suggestions/
// Bug Reports each internally show an extra admin-only "Admin Queue" toggle
// (see those components); Plans shows its add/remove/drag controls the
// same cosmetic isAdmin-gated way.
export default function SettingsModal({ characterId, onClose }: { characterId: string; onClose: () => void }) {
  const isAdmin = useIsAdmin()
  // Admin-only badges (2026-08-21) — count of still-open reports/suggestions
  // across every account, mirroring the badge treatment TabNav.tsx/
  // MobileBottomNav.tsx already use for Achievements/Mail. Relies on
  // GameShell eager-loading allReports/allSuggestions for the admin account
  // only (see that file) so this is accurate without having to open the
  // section first.
  const allBugReports = useBugReportStore((state) => state.allReports)
  const bugsBadge = isAdmin ? countOpenBugReports(allBugReports) : undefined
  const allSuggestions = useSuggestionStore((state) => state.allSuggestions)
  const suggestionsBadge = isAdmin ? countOpenSuggestions(allSuggestions) : undefined

  // Display section (monster name/health/item-drop-text toggles) removed
  // 2026-08-13 (confirmed with the user, "obsolete") — those three flags
  // were never actually read anywhere outside the settings store itself, so
  // the whole section (plus useDisplaySettingsStore.ts and the now-unused
  // ToggleRow.tsx) was deleted rather than left as dead UI.
  const sections: SettingsSection[] = [
    { id: 'effects', label: 'Item Effects', content: <ItemEffectGallery /> },
    { id: 'changelog', label: 'Changelog', content: <ChangelogEntries entries={changelogNewestFirst()} /> },
    { id: 'plans', label: 'Plans', content: <PlanPanel /> },
    {
      id: 'suggestions',
      label: 'Suggestions',
      content: <SuggestionsPanel characterId={characterId} />,
      badge: suggestionsBadge,
    },
    { id: 'bugs', label: 'Bug Reports', content: <BugReportPanel characterId={characterId} />, badge: bugsBadge },
    // Rendering (2026-08-20, requested by the user) -- dev/debug tab for
    // testing GLB model loading, not gameplay UI. See RenderingTestPanel.tsx.
    {
      id: 'rendering',
      label: 'Rendering',
      content: (
        <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
          <RenderingTestPanel />
        </Suspense>
      ),
    },
    // Admin tab (2026-08-13, requested by the user) — only ever shown for the
    // hardcoded admin account (see useIsAdmin's own doc comment); real
    // enforcement lives server-side in the RPCs it calls, this is cosmetic.
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', content: <AdminMailSection /> }] : []),
  ]

  const [activeSectionId, setActiveSectionId] = useState(sections[0].id)
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <nav className="w-40 shrink-0 space-y-1 border-r border-slate-800 bg-slate-950/60 p-3">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSectionId(section.id)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                section.id === activeSectionId
                  ? 'bg-sky-500/10 text-sky-300'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <span>{section.label}</span>
              {Boolean(section.badge) && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-slate-950">
                  {section.badge! > 99 ? '99+' : section.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Settings</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="text-slate-400 hover:text-slate-200"
            >
              ✕
            </button>
          </div>

          {activeSection.content}
        </div>
      </div>
    </div>
  )
}
