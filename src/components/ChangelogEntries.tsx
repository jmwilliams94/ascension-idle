import type { ChangelogEntry } from '../lib/changelog'

function ChangelogEntryBody({ entry }: { entry: ChangelogEntry }) {
  return (
    <ul className="mt-1 space-y-1 text-sm text-slate-400">
      {entry.changes.map((change) => (
        <li key={change}>• {change}</li>
      ))}
    </ul>
  )
}

interface ChangelogEntriesProps {
  entries: ChangelogEntry[]
  // When the list is at least this long, every entry after the first is
  // collapsed behind a <details> toggle instead of shown open — keeps a
  // player who's been away a while from having to scroll past a wall of
  // old changes just to dismiss the "what's new" popup.
  collapseThreshold?: number
}

export default function ChangelogEntries({ entries, collapseThreshold }: ChangelogEntriesProps) {
  const shouldCollapse = collapseThreshold !== undefined && entries.length >= collapseThreshold

  return (
    <div className="space-y-5">
      {entries.map((entry, index) => {
        const versionHeading = (
          <p className="text-sm font-semibold text-white">
            v{entry.version} <span className="font-normal text-slate-500">— {entry.date}</span>
          </p>
        )

        if (shouldCollapse && index > 0) {
          return (
            <details key={entry.version}>
              <summary className="cursor-pointer text-sm font-semibold text-white marker:text-slate-500">
                v{entry.version} <span className="font-normal text-slate-500">— {entry.date}</span>
              </summary>
              <ChangelogEntryBody entry={entry} />
            </details>
          )
        }

        return (
          <div key={entry.version}>
            {versionHeading}
            <ChangelogEntryBody entry={entry} />
          </div>
        )
      })}
    </div>
  )
}
