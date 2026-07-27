import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

interface AuthState {
  session: Session | null
  // True until the initial session check resolves, so the gate can show a
  // loading state instead of flashing the login form for logged-in users.
  loading: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => {
  supabase.auth.getSession().then(({ data }) => {
    set({ session: data.session, loading: false })
  })

  supabase.auth.onAuthStateChange((_event, session) => {
    set({ session, loading: false })
  })

  return {
    session: null,
    loading: true,
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
  }
})
