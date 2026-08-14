import changelogData from '../../changelog.json'
import { compareVersions } from './semver'

export interface ChangelogEntry {
  version: string
  date: string
  changes: string[]
}

export const CHANGELOG: ChangelogEntry[] = changelogData as ChangelogEntry[]

export function changelogNewestFirst(): ChangelogEntry[] {
  return [...CHANGELOG].sort((a, b) => compareVersions(b.version, a.version))
}

// The "What's New" modal shows every version the player actually missed
// (strictly newer than their last_seen_version), not a fixed-size recap —
// truncating would silently hide real changes. Entries at/past this count
// get collapsed by default in the UI (see WhatsNewModal) so a long absence
// doesn't force a long scroll before the player can continue.
export const WHATS_NEW_COLLAPSE_THRESHOLD = 3

export function changelogEntriesForWhatsNew(lastSeenVersion: string): ChangelogEntry[] {
  return changelogNewestFirst().filter((entry) => compareVersions(entry.version, lastSeenVersion) > 0)
}
