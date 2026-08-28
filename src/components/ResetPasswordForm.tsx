import { useState, type FormEvent } from 'react'
import { useAuthStore } from '../lib/useAuthStore'
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'

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
    <div className="ascension-page-bg flex min-h-screen flex-col items-center justify-center px-4 py-10 text-slate-100">
      <h1 className="font-heading mb-6 flex items-center gap-2.5 text-2xl font-black tracking-[0.15em] uppercase sm:mb-8 sm:text-3xl">
        <span className="ascension-glow-pulse text-base text-amber-400 sm:text-lg">✦</span>
        <span className="text-gradient-steel">ASCENSION</span>
        <span className="text-gradient-gold">IDLE</span>
        <span className="ascension-glow-pulse text-base text-amber-400 sm:text-lg">✦</span>
      </h1>

      <AscensionCard title="Choose a New Password" className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-password" className="text-heading-label">
              New password
            </label>
            <div className="select-frame mt-1.5 rounded-lg">
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full bg-transparent px-3 py-2 text-base text-slate-100 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="confirm-password" className="text-heading-label">
              Confirm new password
            </label>
            <div className="select-frame mt-1.5 rounded-lg">
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full bg-transparent px-3 py-2 text-base text-slate-100 focus:outline-none"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Please Wait…' : 'Update Password'}
          </Button>
        </form>

        <div className="ascension-card-header-line mt-6 mb-4" />

        <button
          type="button"
          onClick={() => signOut()}
          className="w-full text-center text-sm text-slate-400 transition hover:text-amber-300"
        >
          Cancel and sign out
        </button>
      </AscensionCard>
    </div>
  )
}
