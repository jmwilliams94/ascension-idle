import { useEffect, useState } from 'react'
import { useAuthStore } from '../lib/useAuthStore'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import { useCharacterRosterStore, MAX_CHARACTER_SLOTS } from '../lib/useCharacterRosterStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { CLASS_DEFINITIONS, CLASS_ORDER, type ClassId } from '../game/stats/classes'

// PLACEHOLDER unlock threshold — real max level is unresolved per CLAUDE.md.
const CLASS_UNLOCK_LEVEL_PLACEHOLDER = 100

export default function CharacterSelectScreen() {
  const session = useAuthStore((state) => state.session)
  const accountId = session?.user.id

  const slots = useCharacterRosterStore((state) => state.slots)
  const rosterLoaded = useCharacterRosterStore((state) => state.loaded)
  const loadRoster = useCharacterRosterStore((state) => state.loadRoster)
  const createCharacter = useCharacterRosterStore((state) => state.createCharacter)

  const unlockedClasses = usePlayerRecordStore((state) => state.unlockedClasses)

  const setActiveCharacterId = useActiveCharacterStore((state) => state.setActiveCharacterId)

  const [expandedSlot, setExpandedSlot] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (accountId) {
      loadRoster(accountId)
    }
  }, [accountId, loadRoster])

  if (!accountId) {
    return null
  }

  const handleCreate = async (slotIndex: number, classId: ClassId) => {
    setCreating(true)
    const characterId = await createCharacter(accountId, slotIndex, classId)
    setCreating(false)
    setExpandedSlot(null)

    if (characterId) {
      setActiveCharacterId(characterId)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_#1e293b,_#020617_70%)] p-6 text-slate-100">
      <div className="w-full max-w-2xl">
        <h1 className="text-center text-2xl font-semibold text-white">Choose your character</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          Up to {MAX_CHARACTER_SLOTS} character slots per account.
        </p>

        {!rosterLoaded ? (
          <p className="mt-8 text-center text-sm text-slate-500">Loading…</p>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {slots.map((slot, index) => {
              const slotIndex = index + 1

              if (slot) {
                const classDef = slot.classId ? CLASS_DEFINITIONS[slot.classId as ClassId] : undefined

                return (
                  <div key={slotIndex} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                    <p className="text-sm font-medium text-slate-200">
                      {classDef?.displayName ?? slot.classId ?? 'Unknown class'}
                    </p>
                    <p className="text-xs text-slate-500">Level {slot.level}</p>
                    <button
                      type="button"
                      onClick={() => setActiveCharacterId(slot.id)}
                      className="mt-3 w-full rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/20"
                    >
                      Play
                    </button>
                  </div>
                )
              }

              const isExpanded = expandedSlot === slotIndex

              return (
                <div key={slotIndex} className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-4">
                  <p className="text-sm font-medium text-slate-500">Empty slot</p>

                  {!isExpanded ? (
                    <button
                      type="button"
                      onClick={() => setExpandedSlot(slotIndex)}
                      className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 hover:border-slate-500"
                    >
                      Create Character
                    </button>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {CLASS_ORDER.map((classId) => {
                        const classDef = CLASS_DEFINITIONS[classId]
                        const isUnlocked = unlockedClasses.includes(classId)

                        return (
                          <button
                            key={classId}
                            type="button"
                            disabled={!isUnlocked || creating}
                            onClick={() => handleCreate(slotIndex, classId)}
                            className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                              isUnlocked
                                ? 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
                                : 'cursor-not-allowed border-slate-800 text-slate-600'
                            }`}
                          >
                            <span className="font-medium">{classDef.displayName}</span>
                            {!isUnlocked && (
                              <span className="block text-xs text-slate-600">
                                Unlocks after a Hunter reaches level {CLASS_UNLOCK_LEVEL_PLACEHOLDER} (placeholder)
                              </span>
                            )}
                          </button>
                        )
                      })}

                      <button
                        type="button"
                        onClick={() => setExpandedSlot(null)}
                        className="w-full rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-500 hover:border-slate-600"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
