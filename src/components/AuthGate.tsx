import type { ReactNode } from 'react'
import { useAuthStore } from '../lib/useAuthStore'
import LoginForm from './LoginForm'

export default function AuthGate({ children }: { children: ReactNode }) {
  const session = useAuthStore((state) => state.session)
  const loading = useAuthStore((state) => state.loading)

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_#1e293b,_#020617_70%)] text-slate-400">
        Loading…
      </div>
    )
  }

  if (!session) {
    return <LoginForm />
  }

  return <>{children}</>
}
