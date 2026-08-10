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
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_#1e293b,_#020617_70%)] text-slate-400">
        Loading…
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
