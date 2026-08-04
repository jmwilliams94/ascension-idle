import { useState, type ReactNode } from 'react'
import { changelogNewestFirst } from '../lib/changelog'
import ChangelogEntries from './ChangelogEntries'
import DisplaySettingsSection from './DisplaySettingsSection'
import ItemEffectGallery from './ItemEffectGallery'
import IconResolutionPreview from './IconResolutionPreview'

interface SettingsSection {
  id: string
  label: string
  content: ReactNode
}

// Add more sections here later (audio, etc.) — the modal itself doesn't need to
// change, just this list.
const SECTIONS: SettingsSection[] = [
  {
    id: 'display',
    label: 'Display',
    content: <DisplaySettingsSection />,
  },
  {
    id: 'effects',
    label: 'Item Effects',
    content: <ItemEffectGallery />,
  },
  {
    id: 'icon-res',
    label: 'Icon Res Test',
    content: <IconResolutionPreview />,
  },
  {
    id: 'changelog',
    label: 'Changelog',
    content: <ChangelogEntries entries={changelogNewestFirst()} />,
  },
]

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [activeSectionId, setActiveSectionId] = useState(SECTIONS[0].id)
  const activeSection = SECTIONS.find((section) => section.id === activeSectionId) ?? SECTIONS[0]

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
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSectionId(section.id)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                section.id === activeSectionId
                  ? 'bg-sky-500/10 text-sky-300'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              {section.label}
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
