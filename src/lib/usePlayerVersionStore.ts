import { create } from 'zustand'
import { changelogEntriesAfter, type ChangelogEntry } from './changelog'
import { compareVersions } from './semver'
import { supabase } from './supabaseClient'
import { APP_VERSION } from '../version'

interface PlayerVersionState {
  // Entries to show in the "What's New" modal. Null means nothing to show (either
  // not loaded yet, already up to date, or already dismissed this session).
  whatsNewEntries: ChangelogEntry[] | null
  loadPlayerVersionInfo: (userId: string) => Promise<void>
  dismissWhatsNew: (userId: string) => Promise<void>
}

export const usePlayerVersionStore = create<PlayerVersionState>((set) => ({
  whatsNewEntries: null,

  loadPlayerVersionInfo: async (userId) => {
    const { data, error } = await supabase
      .from('players')
      .select('last_seen_version')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error('Failed to load player version info', error)
      return
    }

    const lastSeenVersion = data?.last_seen_version as string | null | undefined

    if (!lastSeenVersion) {
      // First-ever login (or a row with no recorded version yet) — silently record
      // the current version with no popup.
      await supabase.from('players').upsert({ id: userId, last_seen_version: APP_VERSION })
      set({ whatsNewEntries: null })
      return
    }

    if (compareVersions(lastSeenVersion, APP_VERSION) < 0) {
      set({ whatsNewEntries: changelogEntriesAfter(lastSeenVersion) })
    } else {
      set({ whatsNewEntries: null })
    }
  },

  dismissWhatsNew: async (userId) => {
    set({ whatsNewEntries: null })

    const { error } = await supabase
      .from('players')
      .update({ last_seen_version: APP_VERSION })
      .eq('id', userId)

    if (error) {
      console.error('Failed to record last seen version', error)
    }
  },
}))
