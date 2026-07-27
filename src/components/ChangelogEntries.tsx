import type { ChangelogEntry } from '../lib/changelog'

export default function ChangelogEntries({ entries }: { entries: ChangelogEntry[] }) {
  return (
    <div className="space-y-5">
      {entries.map((entry) => (
        <div key={entry.version}>
          <p className="text-sm font-semibold text-white">
            v{entry.version} <span className="font-normal text-slate-500">— {entry.date}</span>
          </p>
          <ul className="mt-1 space-y-1 text-sm text-slate-400">
            {entry.changes.map((change) => (
              <li key={change}>• {change}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
