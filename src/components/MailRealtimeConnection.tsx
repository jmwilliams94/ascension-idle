import { useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useMailStore } from '../game/marketplace/useMailStore'
import { useTabActivityStore } from '../lib/useTabActivityStore'

// Non-visual, mounted unconditionally in GameShell alongside CombatEngine/
// GlobalActivityConnection (2026-08-13, requested by the user) — pushes new
// Mail live to an already-logged-in player instead of requiring a reload or
// character switch to see it (nav badges derive reactively from
// useMailStore, so they update the instant this fires). Mirrors
// GlobalActivityConnection.tsx's own Postgres Changes pattern, scoped to
// just this character's own mail via a `character_id=eq.<id>` filter
// (requires `mail` in the supabase_realtime publication — see
// 20260813130000_mail_realtime.sql). Re-runs the full loadMail() on either
// INSERT (new mail arrived) or UPDATE (claimed elsewhere, e.g. another tab/
// device) rather than patching the event payload in by hand — the mail list
// is small, and this reuses loadMail's existing item-hydration step for
// free instead of duplicating it here.
export default function MailRealtimeConnection({ characterId }: { characterId: string | undefined }) {
  const loadMail = useMailStore((state) => state.loadMail)

  useEffect(() => {
    if (!characterId) {
      return undefined
    }

    const channel = supabase
      .channel(`mail-${characterId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mail', filter: `character_id=eq.${characterId}` },
        () => {
          void loadMail(characterId)
          useTabActivityStore.getState().markPending()
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mail', filter: `character_id=eq.${characterId}` },
        () => void loadMail(characterId),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [characterId, loadMail])

  return null
}
