import { useState, type FormEvent } from 'react'
import { useAuthStore } from '../lib/useAuthStore'

type Mode = 'sign-in' | 'sign-up' | 'reset-request'

export default function LoginForm() {
  const signIn = useAuthStore((state) => state.signIn)
  const signUp = useAuthStore((state) => state.signUp)
  const requestPasswordReset = useAuthStore((state) => state.requestPasswordReset)

  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setInfo(null)
    setSubmitting(true)

    if (mode === 'reset-request') {
      const errorMessage = await requestPasswordReset(email)
      setSubmitting(false)

      if (errorMessage) {
        setError(errorMessage)
        return
      }

      setInfo('If an account exists for that email, a password reset link is on its way.')
      return
    }

    const errorMessage = mode === 'sign-in' ? await signIn(email, password) : await signUp(email, password)

    setSubmitting(false)

    if (errorMessage) {
      setError(errorMessage)
      return
    }

    if (mode === 'sign-up') {
      setInfo('Check your email to confirm your account, then sign in.')
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setInfo(null)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_#1e293b,_#020617_70%)] px-4 text-slate-100">
      <div className="w-full max-w-sm space-y-6 rounded-3xl border border-slate-800/80 bg-slate-900/70 p-8 shadow-xl shadow-slate-950/30">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Ascension Idle</p>
          <h1 className="text-xl font-semibold text-white">
            {mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Create an account' : 'Reset your password'}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm text-slate-400">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          {mode !== 'reset-request' && (
            <div>
              <label htmlFor="password" className="block text-sm text-slate-400">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
          )}

          {mode === 'sign-in' && (
            <button
              type="button"
              onClick={() => switchMode('reset-request')}
              className="text-sm text-slate-400 hover:text-slate-200"
            >
              Forgot your password?
            </button>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
          {info && <p className="text-sm text-emerald-400">{info}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {submitting
              ? 'Please wait…'
              : mode === 'sign-in'
                ? 'Sign in'
                : mode === 'sign-up'
                  ? 'Sign up'
                  : 'Send reset link'}
          </button>
        </form>

        {mode === 'reset-request' ? (
          <button type="button" onClick={() => switchMode('sign-in')} className="text-sm text-slate-400 hover:text-slate-200">
            Back to sign in
          </button>
        ) : (
          <button
            type="button"
            onClick={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            {mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
          </button>
        )}
      </div>
    </div>
  )
}
