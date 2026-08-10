import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

interface AuthState {
  session: Session | null
  // True until the initial session check resolves, so the gate can show a
  // loading state instead of flashing the login form for logged-in users.
  loading: boolean
  // True once Supabase fires a PASSWORD_RECOVERY event (the user landed back
  // here via a reset-password email link). Gates AuthGate into showing the
  // "choose a new password" form instead of the normal game, even though a
  // session now exists.
  passwordRecovery: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<string | null>
  updatePassword: (newPassword: string) => Promise<string | null>
}

export const useAuthStore = create<AuthState>((set) => {
  supabase.auth.getSession().then(({ data }) => {
    set({ session: data.session, loading: false })
  })

  supabase.auth.onAuthStateChange((event, session) => {
    set({ session, loading: false, ...(event === 'PASSWORD_RECOVERY' ? { passwordRecovery: true } : {}) })
  })

  return {
    session: null,
    loading: true,
    passwordRecovery: false,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return error?.message ?? null
    },
    signUp: async (email, password) => {
      // Without an explicit emailRedirectTo, Supabase sends the confirmation link to
      // whatever "Site URL" is configured in the dashboard's Auth settings — if that's
      // stale/unset, the confirm button lands on an unreachable page (the account
      // still gets confirmed server-side, so signing in afterward works regardless).
      // Deriving it from window.location keeps this correct for both local dev and
      // the deployed GitHub Pages URL without hardcoding a domain.
      const emailRedirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`
      const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo } })
      return error?.message ?? null
    },
    signOut: async () => {
      await supabase.auth.signOut()
    },
    requestPasswordReset: async (email) => {
      // Same reasoning as signUp's emailRedirectTo above — must be set explicitly or
      // the reset link falls back to the dashboard's possibly-stale Site URL.
      const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
      return error?.message ?? null
    },
    updatePassword: async (newPassword) => {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (!error) {
        set({ passwordRecovery: false })
      }
      return error?.message ?? null
    },
  }
})
