import { useEffect, useState } from 'react'
import {
  useBugReportStore,
  type BugReport,
  type BugReportCurrencyReward,
  type BugReportStatus,
} from '../game/bugReports/useBugReportStore'
import { mailCurrencyLabel } from '../game/marketplace/listableCurrency'
import type { MailCurrencyType } from '../game/marketplace/useMailStore'
import { useIsAdmin } from '../lib/adminConfig'
import ReportReplyThread from './ReportReplyThread'

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

const STATUS_LABELS: Record<BugReportStatus, string> = { open: 'Open', fixed: 'Fixed', rewarded: 'Rewarded' }
const STATUS_STYLES: Record<BugReportStatus, string> = {
  open: 'border-amber-500 bg-amber-500/10 text-amber-300',
  fixed: 'border-emerald-500 bg-emerald-500/10 text-emerald-300',
  rewarded: 'border-purple-500 bg-purple-500/10 text-purple-300',
}

function StatusBadge({ status }: { status: BugReportStatus }) {
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

function describeSubmitError(error?: string): string {
  switch (error) {
    case 'description_required':
      return 'Please describe the bug first.'
    case 'too_many_open_reports':
      return "You've got a lot of open reports already — try again once some are resolved."
    default:
      return 'Something went wrong.'
  }
}

// Bug Reports (2026-08-21, requested by the user). Two views sharing one
// tab: every player gets a submit form + their own report history
// (MyReportsSection); the admin account additionally gets a queue of every
// report across every account (AdminQueueSection, gated by useIsAdmin() —
// real enforcement is server-side in resolve_bug_report, see
// supabase/migrations/20260821010000_todo_and_bug_reports.sql). Closing a
// report out (Fixed/Rewarded) can attach a currency-only reward, reusing the
// same "pick a currency + amount, Add, repeat" interaction AdminMailSection
// already established for Admin Mail — kept as a separate, deliberately
// smaller copy here (no item/gear reward option at all) rather than sharing
// a component, consistent with this project's own "small deliberate
// duplication over a shared abstraction for structurally different UI"
// precedent (see navIcons.ts's own doc comment).
export default function BugReportPanel({ characterId }: { characterId: string }) {
  const isAdmin = useIsAdmin()
  const [view, setView] = useState<'mine' | 'admin'>('mine')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Bug Reports</h2>
          <p className="text-sm text-slate-400">Found something broken? Let us know.</p>
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
              My Reports
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

      {view === 'mine' && <MyReportsSection characterId={characterId} />}
      {view === 'admin' && isAdmin && <AdminQueueSection />}
    </div>
  )
}

function MyReportsSection({ characterId }: { characterId: string }) {
  const myReports = useBugReportStore((state) => state.myReports)
  const myReportsLoaded = useBugReportStore((state) => state.myReportsLoaded)
  const busy = useBugReportStore((state) => state.busy)
  const loadMyReports = useBugReportStore((state) => state.loadMyReports)
  const submitReport = useBugReportStore((state) => state.submitReport)
  const markSeen = useBugReportStore((state) => state.markSeen)

  const [description, setDescription] = useState('')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void loadMyReports(characterId)
  }, [characterId, loadMyReports])

  // Marks any already-resolved-but-unseen reports as seen once the list has
  // actually loaded — mirrors Mail's own claimed_at-is-null "unread"
  // convention (see useBugReportStore.ts), just with no nav badge consuming
  // it today.
  useEffect(() => {
    if (myReportsLoaded) {
      void markSeen(characterId)
    }
  }, [myReportsLoaded, characterId, markSeen])

  const handleSubmit = async () => {
    const trimmed = description.trim()
    if (!trimmed) {
      return
    }
    setResult(null)
    const response = await submitReport(characterId, trimmed)
    if (response.ok) {
      setDescription('')
      setResult({ ok: true, text: 'Report submitted — thanks!' })
    } else {
      setResult({ ok: false, text: describeSubmitError(response.error) })
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">Report a Bug</p>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value.slice(0, DESCRIPTION_MAX_LENGTH))}
          rows={3}
          placeholder="What happened? The more detail the better."
          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-base text-slate-200"
        />
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-slate-600">
            {description.length}/{DESCRIPTION_MAX_LENGTH}
          </p>
          <button
            type="button"
            disabled={!description.trim() || busy}
            onClick={() => void handleSubmit()}
            className="rounded-lg border border-sky-500 bg-sky-500/10 px-4 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Submitting…' : 'Submit'}
          </button>
        </div>
        {result && <p className={`text-xs ${result.ok ? 'text-emerald-400' : 'text-amber-400'}`}>{result.text}</p>}
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Your Reports</p>
        {myReports.length === 0 ? (
          <p className="text-sm text-slate-500">You haven't reported anything yet.</p>
        ) : (
          <div className="space-y-2">
            {myReports.map((report) => (
              <MyReportRow key={report.id} report={report} characterId={characterId} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Expandable so the player can open the reply thread on their own report —
// mirrors AdminReportRow's own expand/collapse shape below, just with a
// player-authored ReportReplyThread instead of the resolve controls.
function MyReportRow({ report, characterId }: { report: BugReport; characterId: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div>
          <p className="whitespace-pre-wrap text-slate-200">{report.description}</p>
          <p className="mt-1 text-[11px] text-slate-500">{report.character_name}</p>
          <p className="text-[11px] text-slate-500">{new Date(report.created_at).toLocaleString()}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={report.status} />
          <span className="text-xs text-slate-500">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>
      {report.admin_comment && (
        <p className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-xs text-slate-400">
          “{report.admin_comment}”
        </p>
      )}
      {expanded && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <ReportReplyThread parentType="bug" parentId={report.id} viewerRole="player" characterId={characterId} />
        </div>
      )}
    </div>
  )
}

function AdminQueueSection() {
  const allReports = useBugReportStore((state) => state.allReports)
  const allReportsLoaded = useBugReportStore((state) => state.allReportsLoaded)
  const loadAllReports = useBugReportStore((state) => state.loadAllReports)

  useEffect(() => {
    void loadAllReports()
  }, [loadAllReports])

  const openReports = allReports
    .filter((report) => report.status === 'open')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const resolvedReports = allReports
    .filter((report) => report.status !== 'open')
    .sort((a, b) => (b.resolved_at ?? '').localeCompare(a.resolved_at ?? ''))

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Open ({openReports.length})</p>
        {openReports.length === 0 ? (
          <p className="text-sm text-slate-500">{allReportsLoaded ? 'Nothing open right now.' : 'Loading…'}</p>
        ) : (
          <div className="space-y-2">
            {openReports.map((report) => (
              <AdminReportRow key={report.id} report={report} />
            ))}
          </div>
        )}
      </div>

      {resolvedReports.length > 0 && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Resolved History</p>
          <div className="space-y-2">
            {resolvedReports.map((report) => (
              <ResolvedReportRow key={report.id} report={report} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ResolvedReportRow({ report }: { report: BugReport }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm opacity-80">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div>
          <p className="whitespace-pre-wrap text-slate-300">{report.description}</p>
          <p className="mt-1 text-[11px] text-slate-500">{report.character_name}</p>
          <p className="text-[11px] text-slate-500">{new Date(report.created_at).toLocaleString()}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={report.status} />
          <span className="text-xs text-slate-500">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>
      {report.admin_comment && <p className="mt-2 text-xs text-slate-400">“{report.admin_comment}”</p>}
      {expanded && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <ReportReplyThread parentType="bug" parentId={report.id} viewerRole="admin" />
        </div>
      )}
    </div>
  )
}

function AdminReportRow({ report }: { report: BugReport }) {
  const resolveReport = useBugReportStore((state) => state.resolveReport)
  const busy = useBugReportStore((state) => state.busy)
  const [expanded, setExpanded] = useState(false)
  const [comment, setComment] = useState('')
  const [rewards, setRewards] = useState<BugReportCurrencyReward[]>([])
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

  const handleResolve = async (status: 'fixed' | 'rewarded') => {
    if (!comment.trim()) {
      setResult({ ok: false, text: 'Add a comment first.' })
      return
    }
    setResult(null)
    const response = await resolveReport(report.id, status, comment.trim(), rewards)
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
          <p className="whitespace-pre-wrap text-slate-200">{report.description}</p>
          <p className="mt-1 text-[11px] text-slate-500">{report.character_name}</p>
          <p className="text-[11px] text-slate-500">{new Date(report.created_at).toLocaleString()}</p>
        </div>
        <span className="shrink-0 text-xs text-slate-500">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Conversation</p>
            <ReportReplyThread parentType="bug" parentId={report.id} viewerRole="admin" />
          </div>

          <p className="text-xs uppercase tracking-wide text-slate-500">Close This Out</p>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value.slice(0, COMMENT_MAX_LENGTH))}
            rows={2}
            placeholder="Comment shown to the player"
            className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-base text-slate-200"
          />

          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Add Currency Reward (optional)</p>
            <div className="flex items-center gap-2">
              <select
                value={currencyType}
                onChange={(event) => setCurrencyType(event.target.value as MailCurrencyType)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
              >
                {MAIL_CURRENCY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {mailCurrencyLabel(type)}
                  </option>
                ))}
              </select>
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
                    <button type="button" onClick={() => removeReward(index)} className="text-slate-500 hover:text-slate-300">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleResolve('fixed')}
              className="rounded-lg border border-emerald-600 bg-emerald-500/10 px-4 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Close as Fixed
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleResolve('rewarded')}
              className="rounded-lg border border-purple-500 bg-purple-500/10 px-4 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Close as Rewarded
            </button>
          </div>

          {result && <p className="text-xs text-amber-400">{result.text}</p>}
        </div>
      )}
    </div>
  )
}
