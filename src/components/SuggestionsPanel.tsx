import { useEffect, useState } from 'react'
import {
  useSuggestionStore,
  type Suggestion,
  type SuggestionCurrencyReward,
  type SuggestionStatus,
} from '../game/suggestions/useSuggestionStore'
import { mailCurrencyLabel } from '../game/marketplace/listableCurrency'
import type { MailCurrencyType } from '../game/marketplace/useMailStore'
import { useIsAdmin } from '../lib/adminConfig'
import ReportReplyThread from './ReportReplyThread'
import { Button } from './ui/Button'
import { Select } from './ui/Select'

const DESCRIPTION_MAX_LENGTH = 2000
const COMMENT_MAX_LENGTH = 1000

const MAIL_CURRENCY_TYPES: MailCurrencyType[] = [
  'comet',
  'comet_scroll',
  'fallen_star',
  'fallen_star_scroll',
  'lottery_ticket',
  'ascension_points',
]

const STATUS_LABELS: Record<SuggestionStatus, string> = { open: 'Open', implemented: 'Implemented', rejected: 'Rejected' }
const STATUS_STYLES: Record<SuggestionStatus, string> = {
  open: 'border-amber-500 bg-amber-500/10 text-amber-300',
  implemented: 'border-emerald-500 bg-emerald-500/10 text-emerald-300',
  rejected: 'border-rose-500 bg-rose-500/10 text-rose-300',
}

function StatusBadge({ status }: { status: SuggestionStatus }) {
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

function describeSubmitError(error?: string): string {
  switch (error) {
    case 'description_required':
      return 'Please describe your suggestion first.'
    case 'too_many_open_suggestions':
      return "You've got a lot of open suggestions already — try again once some are reviewed."
    default:
      return 'Something went wrong.'
  }
}

// Suggestions (2026-08-21, requested by the user) -- replaces the earlier
// To-Do board. Same shape as BugReportPanel.tsx: every player gets a submit
// form + their own suggestion history; the admin account additionally gets
// a queue of every suggestion across every account, closing one out as
// Implemented or Rejected with a comment and an optional currency-only
// reward (no gear, same restriction as Bug Reports) delivered through the
// existing Mail system.
export default function SuggestionsPanel({ characterId }: { characterId: string }) {
  const isAdmin = useIsAdmin()
  const [view, setView] = useState<'mine' | 'admin'>('mine')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Suggestions</h2>
          <p className="text-sm text-slate-400">Got an idea to make the game better? Let us know.</p>
        </div>
        {isAdmin && (
          <div className="flex gap-1.5 rounded-lg border border-slate-800 bg-slate-950/40 p-1">
            <button
              type="button"
              onClick={() => setView('mine')}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                view === 'mine' ? 'bg-sky-500/10 text-sky-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              My Suggestions
            </button>
            <button
              type="button"
              onClick={() => setView('admin')}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                view === 'admin' ? 'bg-sky-500/10 text-sky-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Admin Queue
            </button>
          </div>
        )}
      </div>

      {view === 'mine' && <MySuggestionsSection characterId={characterId} />}
      {view === 'admin' && isAdmin && <AdminQueueSection />}
    </div>
  )
}

function MySuggestionsSection({ characterId }: { characterId: string }) {
  const mySuggestions = useSuggestionStore((state) => state.mySuggestions)
  const mySuggestionsLoaded = useSuggestionStore((state) => state.mySuggestionsLoaded)
  const busy = useSuggestionStore((state) => state.busy)
  const loadMySuggestions = useSuggestionStore((state) => state.loadMySuggestions)
  const submitSuggestion = useSuggestionStore((state) => state.submitSuggestion)
  const markSeen = useSuggestionStore((state) => state.markSeen)

  const [description, setDescription] = useState('')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void loadMySuggestions(characterId)
  }, [characterId, loadMySuggestions])

  useEffect(() => {
    if (mySuggestionsLoaded) {
      void markSeen(characterId)
    }
  }, [mySuggestionsLoaded, characterId, markSeen])

  const handleSubmit = async () => {
    const trimmed = description.trim()
    if (!trimmed) {
      return
    }
    setResult(null)
    const response = await submitSuggestion(characterId, trimmed)
    if (response.ok) {
      setDescription('')
      setResult({ ok: true, text: 'Suggestion submitted — thanks!' })
    } else {
      setResult({ ok: false, text: describeSubmitError(response.error) })
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        <p className="text-xs uppercase tracking-wide text-slate-300">Suggest Something</p>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value.slice(0, DESCRIPTION_MAX_LENGTH))}
          rows={3}
          placeholder="What would make the game better?"
          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-base text-slate-200"
        />
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-slate-600">
            {description.length}/{DESCRIPTION_MAX_LENGTH}
          </p>
          <Button variant="primary" disabled={!description.trim() || busy} onClick={() => void handleSubmit()}>
            {busy ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
        {result && <p className={`text-xs ${result.ok ? 'text-emerald-400' : 'text-amber-400'}`}>{result.text}</p>}
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-slate-300">Your Suggestions</p>
        {mySuggestions.length === 0 ? (
          <p className="text-sm text-slate-300">You haven't suggested anything yet.</p>
        ) : (
          <div className="space-y-2">
            {mySuggestions.map((suggestion) => (
              <MySuggestionRow key={suggestion.id} suggestion={suggestion} characterId={characterId} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Expandable so the player can open the reply thread on their own
// suggestion — mirrors AdminSuggestionRow's own expand/collapse shape
// below, just with a player-authored ReportReplyThread instead of the
// resolve controls.
function MySuggestionRow({ suggestion, characterId }: { suggestion: Suggestion; characterId: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div>
          <p className="whitespace-pre-wrap text-slate-200">{suggestion.description}</p>
          <p className="mt-1 text-[11px] text-slate-300">{suggestion.character_name}</p>
          <p className="text-[11px] text-slate-300">{new Date(suggestion.created_at).toLocaleString()}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={suggestion.status} />
          <span className="text-xs text-slate-300">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>
      {suggestion.admin_comment && (
        <p className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-400">
          “{suggestion.admin_comment}”
        </p>
      )}
      {expanded && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <ReportReplyThread parentType="suggestion" parentId={suggestion.id} viewerRole="player" characterId={characterId} />
        </div>
      )}
    </div>
  )
}

function AdminQueueSection() {
  const allSuggestions = useSuggestionStore((state) => state.allSuggestions)
  const allSuggestionsLoaded = useSuggestionStore((state) => state.allSuggestionsLoaded)
  const loadAllSuggestions = useSuggestionStore((state) => state.loadAllSuggestions)

  useEffect(() => {
    void loadAllSuggestions()
  }, [loadAllSuggestions])

  const openSuggestions = allSuggestions
    .filter((suggestion) => suggestion.status === 'open')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const resolvedSuggestions = allSuggestions
    .filter((suggestion) => suggestion.status !== 'open')
    .sort((a, b) => (b.resolved_at ?? '').localeCompare(a.resolved_at ?? ''))

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-slate-300">Open ({openSuggestions.length})</p>
        {openSuggestions.length === 0 ? (
          <p className="text-sm text-slate-300">{allSuggestionsLoaded ? 'Nothing open right now.' : 'Loading…'}</p>
        ) : (
          <div className="space-y-2">
            {openSuggestions.map((suggestion) => (
              <AdminSuggestionRow key={suggestion.id} suggestion={suggestion} />
            ))}
          </div>
        )}
      </div>

      {resolvedSuggestions.length > 0 && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-300">Resolved History</p>
          <div className="space-y-2">
            {resolvedSuggestions.map((suggestion) => (
              <ResolvedSuggestionRow key={suggestion.id} suggestion={suggestion} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ResolvedSuggestionRow({ suggestion }: { suggestion: Suggestion }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm opacity-80">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div>
          <p className="whitespace-pre-wrap text-slate-300">{suggestion.description}</p>
          <p className="mt-1 text-[11px] text-slate-300">{suggestion.character_name}</p>
          <p className="text-[11px] text-slate-300">{new Date(suggestion.created_at).toLocaleString()}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={suggestion.status} />
          <span className="text-xs text-slate-300">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>
      {suggestion.admin_comment && <p className="mt-2 text-xs text-slate-400">“{suggestion.admin_comment}”</p>}
      {expanded && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <ReportReplyThread parentType="suggestion" parentId={suggestion.id} viewerRole="admin" />
        </div>
      )}
    </div>
  )
}

function AdminSuggestionRow({ suggestion }: { suggestion: Suggestion }) {
  const resolveSuggestion = useSuggestionStore((state) => state.resolveSuggestion)
  const busy = useSuggestionStore((state) => state.busy)
  const [expanded, setExpanded] = useState(false)
  const [comment, setComment] = useState('')
  const [rewards, setRewards] = useState<SuggestionCurrencyReward[]>([])
  const [currencyType, setCurrencyType] = useState<MailCurrencyType>('comet')
  const [currencyAmount, setCurrencyAmount] = useState(1)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const addCurrency = () => {
    if (currencyAmount <= 0) {
      return
    }
    setRewards((current) => [...current, { currencyType, amount: currencyAmount }])
    setCurrencyAmount(1)
  }

  const removeReward = (index: number) => {
    setRewards((current) => current.filter((_, candidateIndex) => candidateIndex !== index))
  }

  const handleResolve = async (status: 'implemented' | 'rejected') => {
    if (!comment.trim()) {
      setResult({ ok: false, text: 'Add a comment first.' })
      return
    }
    setResult(null)
    const response = await resolveSuggestion(suggestion.id, status, comment.trim(), rewards)
    if (response.ok) {
      setExpanded(false)
      setComment('')
      setRewards([])
    } else {
      setResult({ ok: false, text: 'Something went wrong.' })
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div>
          <p className="whitespace-pre-wrap text-slate-200">{suggestion.description}</p>
          <p className="mt-1 text-[11px] text-slate-300">{suggestion.character_name}</p>
          <p className="text-[11px] text-slate-300">{new Date(suggestion.created_at).toLocaleString()}</p>
        </div>
        <span className="shrink-0 text-xs text-slate-300">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-300">Conversation</p>
            <ReportReplyThread parentType="suggestion" parentId={suggestion.id} viewerRole="admin" />
          </div>

          <p className="text-xs uppercase tracking-wide text-slate-300">Close This Out</p>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value.slice(0, COMMENT_MAX_LENGTH))}
            rows={2}
            placeholder="Comment shown to the player"
            className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-base text-slate-200"
          />

          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-300">Add Currency Reward (optional)</p>
            <div className="flex items-center gap-2">
              <Select value={currencyType} onChange={(event) => setCurrencyType(event.target.value as MailCurrencyType)} className="flex-1">
                {MAIL_CURRENCY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {mailCurrencyLabel(type)}
                  </option>
                ))}
              </Select>
              <input
                type="number"
                min={1}
                value={currencyAmount}
                onChange={(event) => setCurrencyAmount(Math.max(1, Number(event.target.value)))}
                className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-base text-slate-200"
              />
              <button
                type="button"
                onClick={addCurrency}
                className="shrink-0 rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20"
              >
                Add
              </button>
            </div>
            {rewards.length > 0 && (
              <div className="space-y-1">
                {rewards.map((reward, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200"
                  >
                    <span>
                      {reward.amount}× {mailCurrencyLabel(reward.currencyType)}
                    </span>
                    <button type="button" onClick={() => removeReward(index)} className="text-slate-300 hover:text-slate-100">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void handleResolve('implemented')}>
              Mark Implemented
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void handleResolve('rejected')}>
              Mark Rejected
            </Button>
          </div>

          {result && <p className="text-xs text-amber-400">{result.text}</p>}
        </div>
      )}
    </div>
  )
}
