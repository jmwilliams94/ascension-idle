import { useEffect, useState } from 'react'
import { useAuthStore } from '../lib/useAuthStore'
import { useNotificationStore } from '../lib/useNotificationStore'
import { supabase } from '../lib/supabaseClient'
import { ToggleSwitch } from './ui/ToggleSwitch'

// iOS Safari only supports Web Push once the PWA is running standalone (Home
// Screen installed, iOS 16.4+) -- requesting permission outside that context
// silently never resolves the way it would elsewhere, so this UA check gates
// the toggle behind an explicit "install first" message instead of showing a
// control that looks broken. See CLAUDE.pwa-and-mobile.md's Push
// Notifications section.
function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export default function NotificationsSettingsPanel() {
  const accountId = useAuthStore((state) => state.session?.user.id)
  const permission = useNotificationStore((state) => state.permission)
  const subscribed = useNotificationStore((state) => state.subscribed)
  const busy = useNotificationStore((state) => state.busy)
  const supported = useNotificationStore((state) => state.supported)
  const isStandalone = useNotificationStore((state) => state.isStandalone)
  const refresh = useNotificationStore((state) => state.refresh)
  const enable = useNotificationStore((state) => state.enable)
  const disable = useNotificationStore((state) => state.disable)
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [testErrorDetail, setTestErrorDetail] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const needsInstallFirst = isIOS() && !isStandalone

  const handleToggle = async (checked: boolean) => {
    if (!accountId) {
      return
    }
    setErrorMessage(null)
    const result = checked ? await enable(accountId) : await disable(accountId)
    if (!result.ok && result.error) {
      if (result.error === 'permission_denied') {
        setErrorMessage('Notifications were blocked -- check your browser/OS settings to allow them for this site.')
      } else if (result.error === 'push_service_blocked') {
        // Allowing the browser's own Notification permission prompt isn't
        // enough -- Brave (and possibly other Chromium forks) separately
        // blocks the underlying push service by default, silently failing
        // subscribe() even after that prompt was granted.
        setErrorMessage(
          "Your browser blocked the push service. If you're using Brave, go to brave://settings/privacy and enable " +
            '"Use Google services for push messaging", then try again.',
        )
      } else {
        setErrorMessage(`Something went wrong${result.detail ? `: ${result.detail}` : '.'} Please try again.`)
      }
    }
  }

  const handleTestSend = async () => {
    if (!accountId) {
      return
    }
    setTestState('sending')
    setTestErrorDetail(null)
    const { data, error } = await supabase.functions.invoke<{
      ok: boolean
      error?: string
      sent?: number
      failures?: { statusCode?: number; message: string }[]
    }>('send-push', {
      body: { account_id: accountId, title: 'Ascension Idle', body: 'Test notification -- this is what a push looks like.' },
    })
    if (error || !data?.ok) {
      setTestState('error')
      // send-push returns per-subscription failure detail (statusCode +
      // message from the push service) in its response body -- surfaced
      // here since this project has no way to tail Edge Function logs from
      // the CLI used to deploy it. A non-2xx response (401/403/404/500) is
      // reported via `error` instead, with the JSON body only reachable
      // through error.context (a raw Response) rather than `data`.
      let detail = data?.error ?? data?.failures?.map((f) => `${f.statusCode ?? '?'}: ${f.message}`).join('; ')
      if (!detail && error && 'context' in error && error.context instanceof Response) {
        try {
          const body = await error.context.clone().json()
          detail = body?.error ?? JSON.stringify(body)
        } catch {
          detail = error.message
        }
      }
      setTestErrorDetail(detail ?? (error ? String(error.message ?? error) : null))
      return
    }
    setTestState('sent')
  }

  return (
    <div className="space-y-4">
      <h3 className="font-heading text-base font-semibold text-amber-200">Notifications</h3>

      {!supported ? (
        <p className="text-sm text-slate-400">Your browser doesn't support push notifications.</p>
      ) : needsInstallFirst ? (
        <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-sm font-medium text-slate-100">Add to Home Screen to enable notifications</p>
          <p className="text-[11px] text-slate-500">
            iOS only allows push notifications for installed apps. Tap Share → "Add to Home Screen", then open Ascension Idle from
            there to turn this on.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-100">Push Notifications</p>
              <ToggleSwitch checked={subscribed} onChange={(checked) => void handleToggle(checked)} label="Push Notifications" disabled={busy || !accountId} />
            </div>
            <p className="text-[11px] text-slate-500">
              Get notified on this device even when Ascension Idle isn't open. Nothing is wired up to send a real alert yet -- this
              just turns the pipeline on.
            </p>
            {permission === 'denied' && (
              <p className="text-[11px] text-red-400">
                Notifications are blocked for this site at the browser/OS level -- re-enable them there first.
              </p>
            )}
            {errorMessage && <p className="text-[11px] text-red-400">{errorMessage}</p>}
          </div>

          {subscribed && (
            <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
              <p className="text-sm font-medium text-slate-100">Send test notification</p>
              <p className="text-[11px] text-slate-500">Confirms the full pipeline works end-to-end on this device.</p>
              <button
                type="button"
                onClick={() => void handleTestSend()}
                disabled={testState === 'sending'}
                className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {testState === 'sending' ? 'Sending…' : 'Send test notification'}
              </button>
              {testState === 'sent' && <p className="text-[11px] text-emerald-400">Sent! Check your notifications.</p>}
              {testState === 'error' && (
                <p className="text-[11px] text-red-400">
                  Failed to send{testErrorDetail ? `: ${testErrorDetail}` : ' -- try again in a moment.'}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
