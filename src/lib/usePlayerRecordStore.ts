import { create } from 'zustand'
import { changelogEntriesAfter, type ChangelogEntry } from './changelog'
import { compareVersions } from './semver'
import { supabase } from './supabaseClient'
import { APP_VERSION } from '../version'

// Account-level only — class/level/gold/exp/zone/equipped/meteors/dragonballs all
// moved to the characters table (see useCharacterRecordStore) as part of the
// character-slots restructure. This store now only concerns itself with things that
// apply to the whole account, not any one character.
interface PlayerRow {
  last_seen_version: string | null
  bank_gold: number
  unlocked_classes: string[]
}

interface PlayerRecordState {
  // False until loadPlayerRecord's initial fetch has finished.
  loaded: boolean
  // Entries to show in the "What's New" modal. Null means nothing to show (either
  // not loaded yet, already up to date, or already dismissed this session).
  whatsNewEntries: ChangelogEntry[] | null
  // Shared account-wide bank — schema/read only this step, no deposit/withdraw UI yet.
  bankGold: number
  // Account-wide class-unlock milestones (e.g. a Hunter reaching max level), not
  // per-character. Only 'hunter' by default until a real unlock mechanic exists.
  unlockedClasses: string[]
  loadPlayerRecord: (userId: string) => Promise<void>
  dismissWhatsNew: (userId: string) => Promise<void>
}

export const usePlayerRecordStore = create<PlayerRecordState>((set) => ({
  loaded: false,
  whatsNewEntries: null,
  bankGold: 0,
  unlockedClasses: ['hunter'],

  loadPlayerRecord: async (userId) => {
    const { data, error } = await supabase
      .from('players')
      .select('last_seen_version, bank_gold, unlocked_classes')
      .eq('id', userId)
      .maybeSingle<PlayerRow>()

    if (error) {
      console.error('Failed to load player record', error)
      return
    }

    if (!data) {
      // Genuinely new account — create their row with defaults, skip the What's New popup.
      const { error: insertError } = await supabase.from('players').insert({
        id: userId,
        last_seen_version: APP_VERSION,
      })

      if (insertError) {
        console.error('Failed to create new player record', insertError)
      }

      set({ loaded: true, whatsNewEntries: null, bankGold: 0, unlockedClasses: ['hunter'] })
      return
    }

    set({ bankGold: data.bank_gold, unlockedClasses: data.unlocked_classes })

    if (!data.last_seen_version) {
      // Row predates version tracking (or somehow has none) — record it silently.
      await supabase.from('players').update({ last_seen_version: APP_VERSION }).eq('id', userId)
      set({ loaded: true, whatsNewEntries: null })
      return
    }

    const whatsNewEntries =
      compareVersions(data.last_seen_version, APP_VERSION) < 0 ? changelogEntriesAfter(data.last_seen_version) : null

    set({ loaded: true, whatsNewEntries })
  },

  dismissWhatsNew: async (userId) => {
    set({ whatsNewEntries: null })

    const { error } = await supabase.from('players').update({ last_seen_version: APP_VERSION }).eq('id', userId)

    if (error) {
      console.error('Failed to record last seen version', error)
    }
  },
}))
