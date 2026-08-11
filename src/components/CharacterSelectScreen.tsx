import { useEffect, useState } from 'react'
import { useAuthStore } from '../lib/useAuthStore'
import { usePlayerRecordStore } from '../lib/usePlayerRecordStore'
import {
  useCharacterRosterStore,
  MAX_CHARACTER_SLOTS,
  CHARACTER_NAME_PATTERN,
} from '../lib/useCharacterRosterStore'
import { useActiveCharacterStore } from '../lib/useActiveCharacterStore'
import { CLASS_DEFINITIONS, CLASS_ORDER, type ClassId } from '../game/stats/classes'

// PLACEHOLDER unlock threshold — real max level is unresolved per CLAUDE.md.
const CLASS_UNLOCK_LEVEL_PLACEHOLDER = 100

function describeCreateError(error: 'duplicate_name' | 'invalid_name' | 'unknown'): string {
  switch (error) {
    case 'duplicate_name':
      return 'That name is already taken.'
    case 'invalid_name':
      return 'Names must start with a capital letter, followed by lowercase letters only.'
    default:
      return 'Something went wrong creating that character.'
  }
}

export default function CharacterSelectScreen() {
  const session = useAuthStore((state) => state.session)
  const accountId = session?.user.id

  const slots = useCharacterRosterStore((state) => state.slots)
  const rosterLoaded = useCharacterRosterStore((state) => state.loaded)
  const loadRoster = useCharacterRosterStore((state) => state.loadRoster)
  const createCharacter = useCharacterRosterStore((state) => state.createCharacter)
  const deleteCharacter = useCharacterRosterStore((state) => state.deleteCharacter)

  const unlockedClasses = usePlayerRecordStore((state) => state.unlockedClasses)

  const setActiveCharacterId = useActiveCharacterStore((state) => state.setActiveCharacterId)

  const [expandedSlot, setExpandedSlot] = useState<number | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const [deletingSlot, setDeletingSlot] = useState<number | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (accountId) {
      loadRoster(accountId)
    }
  }, [accountId, loadRoster])

  if (!accountId) {
    return null
  }

  const isNameValid = CHARACTER_NAME_PATTERN.test(nameInput)

  const startCreating = (slotIndex: number) => {
    setExpandedSlot(slotIndex)
    setNameInput('')
    setCreateError(null)
  }

  const cancelCreating = () => {
    setExpandedSlot(null)
    setNameInput('')
    setCreateError(null)
  }

  const handleCreate = async (slotIndex: number, classId: ClassId) => {
    if (!isNameValid) {
      return
    }

    setCreating(true)
    setCreateError(null)
    const result = await createCharacter(accountId, slotIndex, classId, nameInput)
    setCreating(false)

    if (!result.ok) {
      setCreateError(describeCreateError(result.error))
      return
    }

    setExpandedSlot(null)
    setActiveCharacterId(result.id)
  }

  const startDeleting = (slotIndex: number) => {
    setDeletingSlot(slotIndex)
    setDeleteConfirmText('')
  }

  const cancelDeleting = () => {
    setDeletingSlot(null)
    setDeleteConfirmText('')
  }

  const handleDelete = async (characterId: string, slotIndex: number) => {
    setDeleting(true)
    await deleteCharacter(characterId, slotIndex)
    setDeleting(false)
    cancelDeleting()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_#1e293b,_#020617_70%)] p-6 text-slate-100">
      <div className="w-full max-w-md">
        <h1 className="text-center text-2xl font-semibold text-white">Choose your character</h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          Up to {MAX_CHARACTER_SLOTS} character slots per account.
        </p>

        {!rosterLoaded ? (
          <p className="mt-8 text-center text-sm text-slate-500">Loading…</p>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-3">
            {slots.map((slot, index) => {
              const slotIndex = index + 1

              if (slot) {
                const classDef = slot.classId ? CLASS_DEFINITIONS[slot.classId as ClassId] : undefined
                const isDeleting = deletingSlot === slotIndex

                return (
                  <div key={slotIndex} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                    <p className="text-sm font-medium text-slate-200">{slot.name}</p>
                    <p className="text-xs text-slate-500">
                      {classDef?.displayName ?? slot.classId ?? 'Unknown class'} · Level {slot.level}
                    </p>

                    {!isDeleting ? (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveCharacterId(slot.id)}
                          className="flex-1 rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/20"
                        >
                          Play
                        </button>
                        <button
                          type="button"
                          onClick={() => startDeleting(slotIndex)}
                          className="rounded-lg border border-red-900 px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10"
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-slate-400">
                          Type <span className="font-semibold text-slate-200">{slot.name}</span> to confirm deletion.
                          This cannot be undone.
                        </p>
                        <input
                          type="text"
                          value={deleteConfirmText}
                          onChange={(event) => setDeleteConfirmText(event.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-200 focus:border-red-500 focus:outline-none"
                          placeholder={slot.name}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={deleteConfirmText !== slot.name || deleting}
                            onClick={() => handleDelete(slot.id, slotIndex)}
                            className="flex-1 rounded-lg border border-red-600 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Delete Character
                          </button>
                          <button
                            type="button"
                            onClick={cancelDeleting}
                            className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-500 hover:border-slate-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
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
                      onClick={() => startCreating(slotIndex)}
                      className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 hover:border-slate-500"
                    >
                      Create Character
                    </button>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <input
                        type="text"
                        value={nameInput}
                        onChange={(event) => {
                          setNameInput(event.target.value)
                          setCreateError(null)
                        }}
                        placeholder="Name"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-200 focus:border-sky-500 focus:outline-none"
                      />
                      <p className="text-xs text-slate-500">
                        Capital letter first, lowercase the rest (e.g. "Aragorn"). Must be unique.
                      </p>

                      {CLASS_ORDER.map((classId) => {
                        const classDef = CLASS_DEFINITIONS[classId]
                        const isUnlocked = unlockedClasses.includes(classId)

                        return (
                          <button
                            key={classId}
                            type="button"
                            disabled={!isUnlocked || !isNameValid || creating}
                            onClick={() => handleCreate(slotIndex, classId)}
                            className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                              isUnlocked
                                ? 'border-sky-500 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40'
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

                      {createError && <p className="text-xs text-red-400">{createError}</p>}

                      <button
                        type="button"
                        onClick={cancelCreating}
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
