import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useCurrencyStore } from '../game/stats/useCurrencyStore'
import { VIP_TOKEN_ICON_SRC } from '../game/items/forgeCosts'
import { Button } from './ui/Button'

// Real-money VIP Token purchase (Stripe Checkout, $1.99 AUD) -- a second
// acquisition path alongside the existing Lucky Lad drop. Delivered via Mail
// with a thank-you note, not a direct characters.vip_token_count credit --
// see supabase/functions/stripe-checkout and stripe-webhook, and migration
// 20261213000000_stripe_vip_token_purchase.sql. This is VIP's only
// always-reachable entry point (VipStatusHud's badge, which opens
// VipSettingsModal, only renders once a character already has vip_expires_at
// set -- i.e. only after a token's been used at least once).
export default function VipShopPanel({ characterId }: { characterId: string }) {
  const vipTokens = useCurrencyStore((state) => state.vipTokens)
  const [status, setStatus] = useState<'idle' | 'redirecting' | 'error'>('idle')

  const handleBuy = async () => {
    setStatus('redirecting')
    const origin = `${window.location.origin}${import.meta.env.BASE_URL}`

    const { data, error } = await supabase.functions.invoke<{ ok: boolean; url?: string; error?: string }>('stripe-checkout', {
      body: { character_id: characterId, success_url: origin, cancel_url: origin },
    })

    if (error || !data?.ok || !data.url) {
      console.error('stripe-checkout call failed', error ?? data?.error)
      setStatus('error')
      return
    }

    window.location.href = data.url
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <img src={VIP_TOKEN_ICON_SRC} alt="VIP Token" className="h-10 w-10 object-contain" />
        <div>
          <p className="text-sm font-medium text-slate-100">VIP Tokens owned</p>
          <p className="text-xs text-slate-400">{vipTokens} -- each one extends VIP status by 30 days when used.</p>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <p className="text-sm font-medium text-slate-100">Buy a VIP Token</p>
        <p className="text-[11px] text-slate-300">
          $1.99 AUD, via Stripe Checkout. Delivered to your Mail (Market tab) once payment completes -- claim it there like any other
          reward.
        </p>
        <Button className="w-full" onClick={() => void handleBuy()} disabled={status === 'redirecting'}>
          {status === 'redirecting' ? 'Redirecting to Stripe…' : 'Buy VIP Token -- $1.99 AUD'}
        </Button>
        {status === 'error' && <p className="text-[11px] text-rose-400">Something went wrong starting checkout -- please try again.</p>}
      </div>
    </div>
  )
}
