import { useState } from 'react'
import { AscensionCard } from '../ui/AscensionCard'
import { Button } from '../ui/Button'
import { usePvpDuelStore, opponentIdFor, zoneFor, requiredActionFor } from '../../game/pvp/usePvpDuelStore'
import { BOARD_SIZE, ZONE_SIZE, MAX_ZONE_ORIGIN } from '../../game/pvp/pvpConstants'
import PvpTurnTimer from './PvpTurnTimer'
import PvpDamageToast from './PvpDamageToast'

// Phase 2 duel UI — see CLAUDE.md's plan nifty-riding-journal. Single
// composed panel (deliberately not split into separate Zone/Guess-picker
// files as the plan's file list originally sketched) — both pickers share
// the same 9x9 grid rendering and there wasn't enough independent logic in
// each to earn its own file for a first pass; can still be split out later
// if either grows.
//
// Both players hide simultaneously (2026-08-31 mechanic change) — there's
// no fixed "attacker/defender," just whoever's turn it is and whether their
// own zone is currently set (see requiredActionFor). The board only ever
// shows ONE zone at a time, whichever is relevant to what's happening right
// now: my own pending/placed zone while it's my turn to hide, the
// opponent's zone (with their eliminated tiles crossed out) while it's my
// turn to guess, or just my own standing zone as a passive reference while
// waiting on the opponent.

function cellIndex(x: number, y: number): string {
  return `${x},${y}`
}

export default function PvpDuelBoard({ characterId }: { characterId: string }) {
  const duel = usePvpDuelStore((state) => state.duel)
  const busy = usePvpDuelStore((state) => state.busy)
  const placeZone = usePvpDuelStore((state) => state.placeZone)
  const guess = usePvpDuelStore((state) => state.guess)

  // Tagged with the turnNumber it was picked during, rather than reset via a
  // separate effect on turnNumber change — a fresh turn (opponent moved, or
  // our own submit landed) means the duel's turnNumber no longer matches, so
  // stale local selections read back as null below without ever calling
  // setState from inside an effect body.
  const [pendingSelection, setPendingSelection] = useState<{ turnNumber: number; zone: { x: number; y: number } | null; tile: number | null } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const pendingZone = duel && pendingSelection?.turnNumber === duel.turnNumber ? pendingSelection.zone : null
  const pendingTile = duel && pendingSelection?.turnNumber === duel.turnNumber ? pendingSelection.tile : null

  if (!duel) {
    return (
      <AscensionCard title="PvP Duel">
        <p className="text-sm text-slate-400">No active duel right now.</p>
      </AscensionCard>
    )
  }

  const isPlayerA = duel.playerACharacterId === characterId
  const myHp = isPlayerA ? duel.playerAHp : duel.playerBHp
  const myMaxHp = isPlayerA ? duel.playerAMaxHp : duel.playerBMaxHp
  const opponentId = opponentIdFor(duel, characterId)
  const opponentHp = isPlayerA ? duel.playerBHp : duel.playerAHp
  const opponentMaxHp = isPlayerA ? duel.playerBMaxHp : duel.playerAMaxHp
  const myName = (isPlayerA ? duel.playerAName : duel.playerBName) ?? 'You'
  const opponentName = (isPlayerA ? duel.playerBName : duel.playerAName) ?? 'Opponent'

  if (duel.status !== 'active') {
    const wonText =
      duel.winnerCharacterId === characterId ? 'Victory!' : duel.winnerCharacterId ? 'Defeated' : 'Duel Over'
    return (
      <AscensionCard title="PvP Duel">
        <div className="relative space-y-2 text-center">
          {/* The killing blow's own toast is queued the instant that HP
              drop lands (usePvpDuelStore.setDuel), before this "duel over"
              branch ever renders — still shown here so it isn't lost. */}
          <PvpDamageToast />
          <p className="font-heading text-lg font-bold uppercase tracking-wide text-gradient-steel">{wonText}</p>
          {duel.status === 'forfeited' && <p className="text-sm text-slate-400">Ended by timeout forfeit.</p>}
          <p className="text-sm text-slate-400">
            {myName} vs {opponentName}
          </p>
        </div>
      </AscensionCard>
    )
  }

  const isMyTurn = duel.currentTurnCharacterId === characterId
  const myRequiredAction = requiredActionFor(duel, characterId)
  const myZone = zoneFor(duel, characterId)
  const opponentZone = zoneFor(duel, opponentId)

  const handleGridClick = (x: number, y: number) => {
    if (!isMyTurn) return
    setActionError(null)

    if (myRequiredAction === 'place_zone') {
      if (!pendingZone) {
        // Clicked cell becomes the zone's center, not its top-left corner —
        // clamped so the whole 3x3 stays on the board (a click near an edge
        // naturally shifts the zone inward rather than being off-center).
        const centerOffset = Math.floor(ZONE_SIZE / 2)
        setPendingSelection({
          turnNumber: duel.turnNumber,
          zone: {
            x: Math.min(Math.max(x - centerOffset, 0), MAX_ZONE_ORIGIN),
            y: Math.min(Math.max(y - centerOffset, 0), MAX_ZONE_ORIGIN),
          },
          tile: null,
        })
        return
      }
      const relX = x - pendingZone.x
      const relY = y - pendingZone.y
      if (relX >= 0 && relX < ZONE_SIZE && relY >= 0 && relY < ZONE_SIZE) {
        setPendingSelection({ turnNumber: duel.turnNumber, zone: pendingZone, tile: relY * ZONE_SIZE + relX })
      }
      return
    }

    // myRequiredAction === 'guess' — always targets the opponent's zone.
    if (opponentZone.zoneX === null || opponentZone.zoneY === null) return
    const relX = x - opponentZone.zoneX
    const relY = y - opponentZone.zoneY
    if (relX < 0 || relX >= ZONE_SIZE || relY < 0 || relY >= ZONE_SIZE) return
    const tile = relY * ZONE_SIZE + relX
    if (opponentZone.eliminatedTiles.includes(tile)) return
    void guess(characterId, tile).then((result) => {
      if (!result.ok) setActionError(result.detail ?? result.error ?? 'action_failed')
    })
  }

  const confirmZone = () => {
    if (!pendingZone || pendingTile === null) return
    setActionError(null)
    void placeZone(characterId, pendingZone.x, pendingZone.y, pendingTile).then((result) => {
      if (!result.ok) setActionError(result.detail ?? result.error ?? 'action_failed')
    })
  }

  // Which zone the board actually shows right now: my in-progress pick while
  // I'm hiding, the opponent's zone while I'm guessing, or my own standing
  // zone as a passive reference while it's their turn.
  const showZoneHighlight =
    isMyTurn && myRequiredAction === 'place_zone'
      ? pendingZone
      : isMyTurn && myRequiredAction === 'guess'
        ? opponentZone.zoneX !== null && opponentZone.zoneY !== null
          ? { x: opponentZone.zoneX, y: opponentZone.zoneY }
          : null
        : myZone.zoneX !== null && myZone.zoneY !== null
          ? { x: myZone.zoneX, y: myZone.zoneY }
          : null

  const eliminatedForHighlight = isMyTurn && myRequiredAction === 'guess' ? opponentZone.eliminatedTiles : myZone.eliminatedTiles

  let statusLine: string
  if (isMyTurn && myRequiredAction === 'place_zone') {
    statusLine = pendingZone ? 'Pick your hiding tile inside the zone' : 'Pick a 3x3 zone to hide in'
  } else if (isMyTurn && myRequiredAction === 'guess') {
    statusLine = 'Guess a tile inside their zone'
  } else {
    statusLine = `Waiting for ${opponentName}...`
  }

  return (
    <AscensionCard title="PvP Duel">
      <div className="relative space-y-3">
        <PvpDamageToast />
        <div className="flex items-center justify-between text-sm">
          <div className="flex-1">
            <div className="text-heading-label">{myName}</div>
            <HpBar current={myHp} max={myMaxHp} />
          </div>
          <div className="px-3 font-heading text-xs uppercase tracking-widest text-slate-500">vs</div>
          <div className="flex-1 text-right">
            <div className="text-heading-label">{opponentName}</div>
            <HpBar current={opponentHp} max={opponentMaxHp} align="right" />
          </div>
        </div>

        <p className={`text-center text-sm ${isMyTurn ? 'text-amber-300' : 'text-slate-400'}`}>{statusLine}</p>

        {duel.turnDeadline && <PvpTurnTimer deadline={duel.turnDeadline} />}

        <div
          className="mx-auto grid gap-1"
          style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`, maxWidth: '360px' }}
        >
          {Array.from({ length: BOARD_SIZE }).map((_, y) =>
            Array.from({ length: BOARD_SIZE }).map((_, x) => {
              const inZone =
                showZoneHighlight !== null &&
                x >= showZoneHighlight.x &&
                x < showZoneHighlight.x + ZONE_SIZE &&
                y >= showZoneHighlight.y &&
                y < showZoneHighlight.y + ZONE_SIZE

              const relTile = inZone ? (y - (showZoneHighlight as { x: number; y: number }).y) * ZONE_SIZE + (x - (showZoneHighlight as { x: number; y: number }).x) : -1
              const isEliminated = inZone && eliminatedForHighlight.includes(relTile)
              const isPendingSecretTile = isMyTurn && myRequiredAction === 'place_zone' && pendingZone && pendingTile === relTile && inZone

              const clickable =
                isMyTurn &&
                ((myRequiredAction === 'place_zone') || (myRequiredAction === 'guess' && inZone && !isEliminated))

              return (
                <button
                  key={cellIndex(x, y)}
                  type="button"
                  disabled={!clickable || busy}
                  onClick={() => handleGridClick(x, y)}
                  className={`aspect-square rounded-sm border text-[10px] transition ${
                    isPendingSecretTile
                      ? 'border-amber-400 bg-amber-400/40'
                      : isEliminated
                        ? 'border-slate-800 bg-slate-900/80 text-rose-500'
                        : inZone
                          ? 'border-amber-500/60 bg-amber-500/10'
                          : 'border-slate-800 bg-slate-900/40'
                  } ${clickable ? 'cursor-pointer hover:border-amber-400' : 'cursor-default'}`}
                >
                  {isEliminated ? '✕' : ''}
                </button>
              )
            }),
          )}
        </div>

        {isMyTurn && myRequiredAction === 'place_zone' && pendingZone && (
          <div className="flex items-center justify-center gap-2">
            <Button variant="secondary" onClick={() => setPendingSelection(null)}>
              Reposition Zone
            </Button>
            <Button onClick={confirmZone} disabled={pendingTile === null || busy}>
              Confirm Hiding Spot
            </Button>
          </div>
        )}

        {actionError && <p className="text-center text-xs text-rose-400">{actionError}</p>}
      </div>
    </AscensionCard>
  )
}

function HpBar({ current, max, align = 'left' }: { current: number; max: number; align?: 'left' | 'right' }) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0
  return (
    <div className={align === 'right' ? 'flex flex-col items-end' : ''}>
      <div className="h-2 w-full max-w-[140px] overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-rose-500 transition-[width]" style={{ width: `${fraction * 100}%` }} />
      </div>
      <span className="text-xs text-slate-400">
        {current} / {max}
      </span>
    </div>
  )
}
