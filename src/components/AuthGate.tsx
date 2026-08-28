import type { ReactNode } from 'react'
import { useAuthStore } from '../lib/useAuthStore'
import LoginForm from './LoginForm'
import ResetPasswordForm from './ResetPasswordForm'

export default function AuthGate({ children }: { children: ReactNode }) {
  const session = useAuthStore((state) => state.session)
  const loading = useAuthStore((state) => state.loading)
  const passwordRecovery = useAuthStore((state) => state.passwordRecovery)

  if (loading) {
    return (
      <div className="ascension-page-bg flex min-h-screen items-center justify-center">
        <p className="font-heading text-heading-label ascension-glow-pulse text-base">Loading…</p>
      </div>
    )
  }

  // A recovery-link session must go through the "choose a new password" form
  // before anything else, even though Supabase has already signed it in.
  if (passwordRecovery) {
    return <ResetPasswordForm />
  }

  if (!session) {
    return <LoginForm />
  }

  return <>{children}</>
}
