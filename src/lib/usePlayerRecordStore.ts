import { create } from 'zustand'
import { changelogEntriesAfter, type ChangelogEntry } from './changelog'
import { compareVersions } from './semver'
import { supabase } from './supabaseClient'
import { APP_VERSION } from '../version'
import { CLASS_DEFINITIONS, type ClassId } from '../game/stats/classes'
import { useCharacterStore } from '../game/stats/useCharacterStore'
import { useProgressionStore } from '../game/stats/useProgressionStore'
import { useZoneStore } from '../game/zones/useZoneStore'

interface PlayerRow {
  last_seen_version: string | null
  class: string | null
  level: number
  gold: number
  exp: number
  current_zone: string
}

interface PlayerRecordState {
  // False until loadPlayerRecord's initial fetch (and any hydration) has finished —
  // autosave must not start before this, or it could overwrite a saved row with
  // whatever defaults the local stores happened to start with.
  loaded: boolean
  // Entries to show in the "What's New" modal. Null means nothing to show (either
  // not loaded yet, already up to date, or already dismissed this session).
  whatsNewEntries: ChangelogEntry[] | null
  loadPlayerRecord: (userId: string) => Promise<void>
  dismissWhatsNew: (userId: string) => Promise<void>
  saveNow: (userId: string) => Promise<void>
}

export const usePlayerRecordStore = create<PlayerRecordState>((set, get) => ({
  loaded: false,
  whatsNewEntries: null,

  loadPlayerRecord: async (userId) => {
    const { data, error } = await supabase
      .from('players')
      .select('last_seen_version, class, level, gold, exp, current_zone')
      .eq('id', userId)
      .maybeSingle<PlayerRow>()

    if (error) {
      console.error('Failed to load player record', error)
      return
    }

    if (!data) {
      // Genuinely new player — create their row from the (already-default) local
      // state instead of resetting anything, and skip the What's New popup.
      const character = useCharacterStore.getState()
      const progression = useProgressionStore.getState()
      const zone = useZoneStore.getState()

      const { error: insertError } = await supabase.from('players').insert({
        id: userId,
        last_seen_version: APP_VERSION,
        class: character.selectedClassId,
        level: progression.level,
        gold: progression.gold,
        exp: progression.exp,
        current_zone: zone.currentZoneName,
      })

      if (insertError) {
        console.error('Failed to create new player record', insertError)
      }

      set({ loaded: true, whatsNewEntries: null })
      return
    }

    // Existing player — hydrate local state from the saved row instead of defaults.
    if (data.class && data.class in CLASS_DEFINITIONS) {
      useCharacterStore.getState().selectClass(data.class as ClassId)
    }
    useProgressionStore.getState().hydrate({ level: data.level, gold: data.gold, exp: data.exp })
    useZoneStore.getState().setCurrentZoneName(data.current_zone)

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

  saveNow: async (userId) => {
    if (!get().loaded) {
      return
    }

    const character = useCharacterStore.getState()
    const progression = useProgressionStore.getState()
    const zone = useZoneStore.getState()

    const { error } = await supabase
      .from('players')
      .update({
        class: character.selectedClassId,
        level: progression.level,
        gold: progression.gold,
        exp: progression.exp,
        current_zone: zone.currentZoneName,
      })
      .eq('id', userId)

    if (error) {
      console.error('Failed to save player record', error)
    }
  },
}))
