import { create } from 'zustand'
import { supabase } from '../../lib/supabaseClient'

// Meteors (Level Upgrade) and DragonBalls (Quality Upgrade + weapon sockets later),
// per CLAUDE.md. Deliberately NOT wired into usePersistGameState's autosave: the
// quality_upgrade/level_upgrade/grant_currency_reward Postgres functions already
// mutate these server-side (grant_currency_reward via an atomic increment, the
// upgrade functions via a deduction in the same transaction as the item write),
// so the client only ever reads them (on load, and from each RPC call's
// response) — it must never write them back via the generic player-update
// autosave, or a stale local value could clobber a server-side change that
// happened moments earlier.
interface CurrencyState {
  meteors: number
  dragonballs: number
  hydrate: (saved: { meteors: number; dragonballs: number }) => void
  setMeteors: (value: number) => void
  setDragonballs: (value: number) => void
  // Kill-drop grant (see combatResolver.rollBonusCurrencyDrops) — an atomic
  // server-side increment, safe to call even while a Forge upgrade might be
  // deducting from the same balance concurrently (see the migration's own
  // comment). No-ops the RPC call itself when both amounts are 0, since combat
  // calls this after every kill regardless of whether anything actually rolled.
  grantCurrencyReward: (characterId: string, meteorsGained: number, dragonballsGained: number) => Promise<void>
}

export const useCurrencyStore = create<CurrencyState>((set) => ({
  meteors: 0,
  dragonballs: 0,
  hydrate: (saved) => set({ meteors: saved.meteors, dragonballs: saved.dragonballs }),
  setMeteors: (value) => set({ meteors: value }),
  setDragonballs: (value) => set({ dragonballs: value }),

  grantCurrencyReward: async (characterId, meteorsGained, dragonballsGained) => {
    if (meteorsGained <= 0 && dragonballsGained <= 0) {
      return
    }

    const { data, error } = await supabase.rpc('grant_currency_reward', {
      character_id: characterId,
      meteors_gained: meteorsGained,
      dragonballs_gained: dragonballsGained,
    })

    if (error) {
      console.error('Grant currency reward call failed', error)
      return
    }

    const result = data as { ok: boolean; meteors?: number; dragonballs?: number }
    if (result.ok && typeof result.meteors === 'number' && typeof result.dragonballs === 'number') {
      set({ meteors: result.meteors, dragonballs: result.dragonballs })
    }
  },
}))
