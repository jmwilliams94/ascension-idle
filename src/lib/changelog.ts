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

export function changelogEntriesAfter(version: string): ChangelogEntry[] {
  return changelogNewestFirst().filter((entry) => compareVersions(entry.version, version) > 0)
}
