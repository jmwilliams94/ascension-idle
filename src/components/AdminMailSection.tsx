import { useState } from 'react'
import { formatItemDisplayName, QUALITY_COLORS } from '../game/items/equipmentBonus'
import { useItemTemplatesStore, type ItemTemplate } from '../game/items/useItemTemplatesStore'
import { mailCurrencyLabel } from '../game/marketplace/listableCurrency'
import type { MailCurrencyType } from '../game/marketplace/useMailStore'
import { useAdminMailStore, type AdminMailReward } from '../game/admin/useAdminMailStore'

const MAIL_CURRENCY_TYPES: MailCurrencyType[] = [
  'comet',
  'comet_scroll',
  'fallen_star',
  'fallen_star_scroll',
  'lottery_ticket',
  'ascension_points',
]

const QUALITY_TIER_OPTIONS = Object.keys(QUALITY_COLORS)
const SUBJECT_MAX_LENGTH = 100
const MESSAGE_MAX_LENGTH = 500

function describeReward(reward: AdminMailReward, templates: ItemTemplate[]): string {
  if (reward.kind === 'currency') {
    return `${reward.amount}× ${mailCurrencyLabel(reward.currencyType)}`
  }
  const template = templates.find((t) => t.id === reward.templateId)
  return formatItemDisplayName(template?.name ?? 'Unknown item', reward.qualityTier, reward.compositionLevel)
}

function describeSendError(error?: string): string {
  switch (error) {
    case 'not_admin':
      return 'Not authorized.'
    case 'subject_required':
      return 'Subject is required.'
    case 'message_required':
      return 'Message is required.'
    case 'no_rewards':
      return 'Add at least one reward first.'
    case 'character_not_found':
      return "That character name wasn't found."
    default:
      return 'Something went wrong.'
  }
}

// Admin Mail composer (2026-08-13, requested by the user) — only rendered
// inside SettingsModal when useIsAdmin() is true (see that hook's own doc
// comment for why that's a cosmetic gate, not the real enforcement). Sends
// through admin_send_mail (supabase/migrations/20260813100000_admin_mail.sql),
// delivered to the recipient's existing Market -> Mail sub-tab as one
// "From: GM Switchee" card (see MarketplacePanel.tsx's MailTab).
export default function AdminMailSection() {
  const templates = useItemTemplatesStore((state) => state.templates)
  const sendMail = useAdminMailStore((state) => state.sendMail)
  const lookupCharacter = useAdminMailStore((state) => state.lookupCharacter)
  const busy = useAdminMailStore((state) => state.busy)

  const [targetName, setTargetName] = useState('')
  const [sendToAll, setSendToAll] = useState(false)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupResult, setLookupResult] = useState<{ ok: boolean; label: string } | null>(null)

  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  const [currencyType, setCurrencyType] = useState<MailCurrencyType>('comet')
  const [currencyAmount, setCurrencyAmount] = useState(1)

  const [itemFilter, setItemFilter] = useState('')
  const [itemTemplateId, setItemTemplateId] = useState('')
  const [itemQuality, setItemQuality] = useState('normal')
  const [itemComposition, setItemComposition] = useState(0)

  const [rewards, setRewards] = useState<AdminMailReward[]>([])
  const [confirmingAll, setConfirmingAll] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const filteredTemplates = (
    itemFilter.trim() ? templates.filter((t) => t.name.toLowerCase().includes(itemFilter.trim().toLowerCase())) : templates
  )
    .slice()
    .sort((a, b) => a.slot_type.localeCompare(b.slot_type) || a.required_level - b.required_level)

  const handleLookup = async () => {
    if (!targetName.trim()) {
      return
    }
    setLookupBusy(true)
    const found = await lookupCharacter(targetName.trim())
    setLookupBusy(false)
    setLookupResult(
      found.ok ? { ok: true, label: `Found: ${found.name} (${found.class}, Lv ${found.level})` } : { ok: false, label: 'Not found.' },
    )
  }

  const addCurrency = () => {
    if (currencyAmount <= 0) {
      return
    }
    setRewards((current) => [...current, { kind: 'currency', currencyType, amount: currencyAmount }])
    setCurrencyAmount(1)
  }

  const addItem = () => {
    if (!itemTemplateId) {
      return
    }
    setRewards((current) => [
      ...current,
      { kind: 'item', templateId: itemTemplateId, qualityTier: itemQuality, compositionLevel: itemComposition },
    ])
    setItemTemplateId('')
    setItemComposition(0)
  }

  const removeReward = (index: number) => {
    setRewards((current) => current.filter((_, candidateIndex) => candidateIndex !== index))
  }

  // Rewards are optional (2026-08-13, requested by the user) — a Subject +
  // Message with no rewards sends a plain message-only mail (see
  // 20260813120000_mail_optional_rewards.sql).
  const canSend = subject.trim().length > 0 && message.trim().length > 0 && (sendToAll || targetName.trim().length > 0)

  const handleSend = async () => {
    if (sendToAll && !confirmingAll) {
      setConfirmingAll(true)
      return
    }

    setConfirmingAll(false)
    setResult(null)
    const response = await sendMail(sendToAll ? 'all' : targetName.trim(), subject.trim(), message.trim(), rewards)

    if (response.ok) {
      setResult({ ok: true, text: `Sent to ${response.recipient_count} character${response.recipient_count === 1 ? '' : 's'}.` })
      setSubject('')
      setMessage('')
      setRewards([])
      setTargetName('')
      setSendToAll(false)
      setLookupResult(null)
    } else {
      setResult({ ok: false, text: describeSendError(response.error) })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Recipient</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={targetName}
            disabled={sendToAll}
            onChange={(event) => {
              setTargetName(event.target.value)
              setLookupResult(null)
            }}
            placeholder="Character name"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 disabled:opacity-40"
          />
          <button
            type="button"
            disabled={sendToAll || !targetName.trim() || lookupBusy}
            onClick={() => void handleLookup()}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {lookupBusy ? 'Looking…' : 'Look Up'}
          </button>
        </div>
        {lookupResult && (
          <p className={`mt-1 text-xs ${lookupResult.ok ? 'text-emerald-400' : 'text-amber-400'}`}>{lookupResult.label}</p>
        )}
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={sendToAll}
            onChange={(event) => {
              setSendToAll(event.target.checked)
              setConfirmingAll(false)
            }}
          />
          Send to ALL characters
        </label>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-slate-500">Subject</p>
          <p className="text-[10px] text-slate-600">
            {subject.length}/{SUBJECT_MAX_LENGTH}
          </p>
        </div>
        <input
          type="text"
          value={subject}
          onChange={(event) => setSubject(event.target.value.slice(0, SUBJECT_MAX_LENGTH))}
          placeholder="Shown in the mail list"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-slate-500">Message</p>
          <p className="text-[10px] text-slate-600">
            {message.length}/{MESSAGE_MAX_LENGTH}
          </p>
        </div>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value.slice(0, MESSAGE_MAX_LENGTH))}
          rows={3}
          placeholder="Message shown on the mail card"
          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
        />
      </div>

      <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">Add Currency</p>
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
            className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
          />
          <button
            type="button"
            onClick={addCurrency}
            className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20"
          >
            Add
          </button>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">Add Item</p>
        <input
          type="text"
          value={itemFilter}
          onChange={(event) => setItemFilter(event.target.value)}
          placeholder="Filter by name…"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
        />
        <select
          value={itemTemplateId}
          onChange={(event) => setItemTemplateId(event.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
        >
          <option value="">Select an item…</option>
          {filteredTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} (Lv {template.required_level} {template.slot_type})
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <select
            value={itemQuality}
            onChange={(event) => setItemQuality(event.target.value)}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
          >
            {QUALITY_TIER_OPTIONS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            max={12}
            value={itemComposition}
            onChange={(event) => setItemComposition(Math.min(12, Math.max(0, Number(event.target.value))))}
            title="Composition level (+N)"
            className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
          />
          <button
            type="button"
            disabled={!itemTemplateId}
            onClick={addItem}
            className="rounded-lg border border-sky-500 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>

      {rewards.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-slate-500">Rewards ({rewards.length})</p>
          {rewards.map((reward, index) => (
            <div
              key={index}
              className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200"
            >
              <span>{describeReward(reward, templates)}</span>
              <button type="button" onClick={() => removeReward(index)} className="text-slate-500 hover:text-slate-300">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canSend || busy}
          onClick={() => void handleSend()}
          className={`rounded-lg border px-4 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
            confirmingAll
              ? 'border-amber-500 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
              : 'border-emerald-600 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
          }`}
        >
          {busy ? 'Sending…' : confirmingAll ? 'Confirm — Send to ALL characters?' : 'Send'}
        </button>
        {confirmingAll && (
          <button
            type="button"
            onClick={() => setConfirmingAll(false)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500"
          >
            Cancel
          </button>
        )}
      </div>

      {result && <p className={`text-xs ${result.ok ? 'text-emerald-400' : 'text-amber-400'}`}>{result.text}</p>}
    </div>
  )
}
