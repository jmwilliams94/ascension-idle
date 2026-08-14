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

// The "What's New" modal shows a fixed-size recap, not literally everything missed —
// a player returning after a long absence could otherwise be shown hundreds of
// version entries in one long scroll (changelog.json bumps almost every commit),
// which reads like a chain of popups even though it's technically one modal.
// Capped at the most recent N entries, newest first, regardless of how far behind
// last_seen_version actually is.
export const WHATS_NEW_MAX_ENTRIES = 5

export function changelogEntriesForWhatsNew(): ChangelogEntry[] {
  return changelogNewestFirst().slice(0, WHATS_NEW_MAX_ENTRIES)
}
