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
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'

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
    <div className="ascension-page-bg flex min-h-screen items-center justify-center p-6 text-slate-100">
      <div className="w-full max-w-md">
        <h1 className="font-heading text-gradient-steel text-center text-2xl font-black tracking-[0.15em] uppercase">
          Choose your character
        </h1>
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
                const isDeleting = deletingSlot === slotIndex

                return (
                  <AscensionCard key={slotIndex} title={slot.name}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-heading text-gradient-steel text-sm font-black tracking-[0.1em] uppercase">
                        Level {slot.level}
                      </span>
                      <span className="text-heading-label">
                        {slot.lastActiveIdleMode === 'mining' ? 'Mining' : 'Hunting'}
                      </span>
                    </div>

                    {!isDeleting ? (
                      <div className="mt-3 flex items-center gap-2">
                        <div className="w-9 shrink-0" aria-hidden="true" />
                        <Button variant="primary" onClick={() => setActiveCharacterId(slot.id)} className="flex-1">
                          Play
                        </Button>
                        <button
                          type="button"
                          onClick={() => startDeleting(slotIndex)}
                          aria-label={`Delete ${slot.name}`}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-700 text-rose-300 transition hover:border-rose-500 hover:bg-rose-500/10"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-slate-400">
                          Type <span className="font-semibold text-slate-200">{slot.name}</span> to confirm deletion.
                          This cannot be undone.
                        </p>
                        <div className="select-frame rounded-lg">
                          <input
                            type="text"
                            value={deleteConfirmText}
                            onChange={(event) => setDeleteConfirmText(event.target.value)}
                            className="w-full bg-transparent px-3 py-2 text-base text-slate-200 focus:outline-none"
                            placeholder={slot.name}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="danger"
                            disabled={deleteConfirmText !== slot.name || deleting}
                            onClick={() => handleDelete(slot.id, slotIndex)}
                            className="flex-1"
                          >
                            Delete Character
                          </Button>
                          <Button variant="secondary" onClick={cancelDeleting}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </AscensionCard>
                )
              }

              const isExpanded = expandedSlot === slotIndex

              return (
                <AscensionCard key={slotIndex}>
                  <p className="text-heading-label">Empty Slot</p>

                  {!isExpanded ? (
                    <Button variant="secondary" onClick={() => startCreating(slotIndex)} className="mt-3 w-full">
                      Create Character
                    </Button>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <div className="select-frame rounded-lg">
                        <input
                          type="text"
                          value={nameInput}
                          onChange={(event) => {
                            setNameInput(event.target.value)
                            setCreateError(null)
                          }}
                          placeholder="Name"
                          className="w-full bg-transparent px-3 py-2 text-base text-slate-200 focus:outline-none"
                        />
                      </div>
                      <p className="text-xs text-slate-500">
                        Capital letter first, lowercase the rest (e.g. "Aragorn"). Must be unique.
                      </p>

                      {CLASS_ORDER.map((classId) => {
                        const classDef = CLASS_DEFINITIONS[classId]
                        const isUnlocked = unlockedClasses.includes(classId)
                        const disabled = !isUnlocked || !isNameValid || creating

                        if (!isUnlocked) {
                          return (
                            <div key={classId} className="ascension-chip-frame">
                              <button
                                type="button"
                                disabled
                                className="ascension-chip-inner w-full cursor-not-allowed px-3 py-2 text-left text-sm text-slate-600"
                              >
                                <span className="font-medium">{classDef.displayName}</span>
                                <span className="block text-xs text-slate-600">
                                  Unlocks after a Hunter reaches level {CLASS_UNLOCK_LEVEL_PLACEHOLDER} (placeholder)
                                </span>
                              </button>
                            </div>
                          )
                        }

                        return (
                          <div key={classId} className="ascension-chip-frame is-interactive">
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => handleCreate(slotIndex, classId)}
                              className="ascension-chip-inner w-full px-3 py-2 text-left text-sm text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <span className="font-medium">{classDef.displayName}</span>
                            </button>
                          </div>
                        )
                      })}

                      {createError && <p className="text-xs text-red-400">{createError}</p>}

                      <Button variant="secondary" onClick={cancelCreating} className="w-full">
                        Cancel
                      </Button>
                    </div>
                  )}
                </AscensionCard>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
