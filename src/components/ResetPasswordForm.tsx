import { useState, type FormEvent } from 'react'
import { useAuthStore } from '../lib/useAuthStore'

export default function ResetPasswordForm() {
  const updatePassword = useAuthStore((state) => state.updatePassword)
  const signOut = useAuthStore((state) => state.signOut)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    const errorMessage = await updatePassword(password)
    setSubmitting(false)

    if (errorMessage) {
      setError(errorMessage)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_#1e293b,_#020617_70%)] px-4 text-slate-100">
      <div className="w-full max-w-sm space-y-6 rounded-3xl border border-slate-800/80 bg-slate-900/70 p-8 shadow-xl shadow-slate-950/30">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Ascension Idle</p>
          <h1 className="text-xl font-semibold text-white">Choose a new password</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-password" className="block text-sm text-slate-400">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm text-slate-400">
              Confirm new password
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {submitting ? 'Please wait…' : 'Update password'}
          </button>
        </form>

        <button type="button" onClick={() => signOut()} className="text-sm text-slate-400 hover:text-slate-200">
          Cancel and sign out
        </button>
      </div>
    </div>
  )
}
