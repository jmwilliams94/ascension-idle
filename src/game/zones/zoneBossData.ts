// Zone Boss (2026-11-13) — display-only data for the 8 rotating bosses, one
// per zone. The balance formula (max_hp/physical_defense/magic_defense)
// lives only in SQL (zone_boss_catalog(), ensure_world_boss_spawn — see the
// zone_boss_rotation migration) and is stored on the spawn row itself, so
// this file never needs the numbers, only what to show for whichever
// boss_id the current spawn carries.
import type { ZoneId } from './zoneData'

export type ZoneBossId =
  | 'mourncrow'
  | 'emberroot'
  | 'thundermane'
  | 'karthos'
  | 'skytalon'
  | 'nyxharrow'
  | 'twistpath-warden'
  | 'glacius'

export interface ZoneBossDef {
  id: ZoneBossId
  displayName: string
  zoneId: ZoneId
  // Which defense stat this boss specializes in (round(base * 3.5) vs the
  // other side's round(base * 1.3), see the migration) — display-only here,
  // shown as flavor text so a player knows what kind of gear does well.
  defenseProfile: 'physical' | 'magical'
  portraitUrl: string
}

export const ZONE_BOSSES: Record<ZoneBossId, ZoneBossDef> = {
  mourncrow: {
    id: 'mourncrow',
    displayName: 'Mourncrow',
    zoneId: 'windhollow',
    defenseProfile: 'magical',
    portraitUrl: `${import.meta.env.BASE_URL}bosses/mourncrow.png`,
  },
  emberroot: {
    id: 'emberroot',
    displayName: 'Emberroot',
    zoneId: 'cinderleaf',
    defenseProfile: 'physical',
    portraitUrl: `${import.meta.env.BASE_URL}bosses/emberroot.png`,
  },
  thundermane: {
    id: 'thundermane',
    displayName: 'Thundermane',
    zoneId: 'stormvale',
    defenseProfile: 'magical',
    portraitUrl: `${import.meta.env.BASE_URL}bosses/thundermane.png`,
  },
  karthos: {
    id: 'karthos',
    displayName: 'Karthos',
    zoneId: 'sunscar-wastes',
    defenseProfile: 'physical',
    portraitUrl: `${import.meta.env.BASE_URL}bosses/karthos.png`,
  },
  skytalon: {
    id: 'skytalon',
    displayName: 'Skytalon',
    zoneId: 'talon-isle',
    defenseProfile: 'physical',
    portraitUrl: `${import.meta.env.BASE_URL}bosses/skytalon.png`,
  },
  nyxharrow: {
    id: 'nyxharrow',
    displayName: 'Nyxharrow',
    zoneId: 'duskspire-keep',
    defenseProfile: 'magical',
    portraitUrl: `${import.meta.env.BASE_URL}bosses/nyxharrow.png`,
  },
  'twistpath-warden': {
    id: 'twistpath-warden',
    displayName: 'Twistpath Warden',
    zoneId: 'twistpath-ruins',
    defenseProfile: 'physical',
    portraitUrl: `${import.meta.env.BASE_URL}bosses/twistpath-warden.png`,
  },
  glacius: {
    id: 'glacius',
    displayName: 'Glacius',
    zoneId: 'rimehollow',
    defenseProfile: 'magical',
    portraitUrl: `${import.meta.env.BASE_URL}bosses/glacius.png`,
  },
}

export const ZONE_BOSS_ORDER: ZoneBossId[] = [
  'mourncrow',
  'emberroot',
  'thundermane',
  'karthos',
  'skytalon',
  'nyxharrow',
  'twistpath-warden',
  'glacius',
]

// Fallback for a spawn row whose boss_id doesn't match any known def (should
// never happen post-migration, but keeps rendering safe rather than crashing
// if the DB and client ever drift).
export const DEFAULT_ZONE_BOSS: ZoneBossDef = ZONE_BOSSES.mourncrow

export function zoneBossForId(bossId: string | null | undefined): ZoneBossDef {
  if (bossId && bossId in ZONE_BOSSES) return ZONE_BOSSES[bossId as ZoneBossId]
  return DEFAULT_ZONE_BOSS
}
