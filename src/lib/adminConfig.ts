import { useAuthStore } from './useAuthStore'

// Admin Mail (2026-08-13, requested by the user) — this is a cosmetic gate
// only, deciding whether the Settings "Admin" tab renders at all. The real
// enforcement lives server-side in admin_send_mail/admin_lookup_character
// (supabase/migrations/20260813100000_admin_mail.sql), which independently
// compare auth.uid() against this same hardcoded email — a non-admin caller
// hitting either RPC directly still gets rejected regardless of what this
// hook returns.
const ADMIN_EMAIL = 'jmwilliams94@icloud.com'

export function useIsAdmin(): boolean {
  return useAuthStore((state) => state.session?.user.email === ADMIN_EMAIL)
}
