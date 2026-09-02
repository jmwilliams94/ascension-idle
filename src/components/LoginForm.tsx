import { useRef, useState, type FormEvent } from 'react'
import { useAuthStore } from '../lib/useAuthStore'
import { AscensionCard } from './ui/AscensionCard'
import { Button } from './ui/Button'
import LegalModal from './legal/LegalModal'
import Turnstile, { type TurnstileHandle } from './ui/Turnstile'

type Mode = 'sign-in' | 'sign-up' | 'reset-request'

const MODE_TITLE: Record<Mode, string> = {
  'sign-in': 'Sign In',
  'sign-up': 'Create Account',
  'reset-request': 'Reset Password',
}

const MODE_SUBMIT_LABEL: Record<Mode, string> = {
  'sign-in': 'Sign In',
  'sign-up': 'Sign Up',
  'reset-request': 'Send Reset Link',
}

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
  const [legalDoc, setLegalDoc] = useState<'privacy' | 'terms' | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  // Sticky, unlike captchaToken itself -- a mid-form Turnstile expiry (rare,
  // ~5min token lifetime) shouldn't yank the password field back to disabled
  // and dump whatever the user already typed. No Turnstile configured at all
  // (VITE_TURNSTILE_SITE_KEY unset) means Turnstile's onVerify never fires,
  // so this stays false and the field would stay disabled forever -- guarded
  // by the `hasVerified || !turnstileConfigured` check below instead.
  const [hasVerified, setHasVerified] = useState(false)
  const turnstileConfigured = Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY)
  const turnstileRef = useRef<TurnstileHandle>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setInfo(null)

    // Turnstile only ships if VITE_TURNSTILE_SITE_KEY is set (Turnstile renders
    // nothing without it) -- don't block submission on a token that will never arrive.
    if (import.meta.env.VITE_TURNSTILE_SITE_KEY && !captchaToken) {
      setError('Please complete the verification check.')
      return
    }

    setSubmitting(true)
    const tokenForSubmit = captchaToken ?? undefined

    if (mode === 'reset-request') {
      const errorMessage = await requestPasswordReset(email, tokenForSubmit)
      setSubmitting(false)
      turnstileRef.current?.reset()
      setCaptchaToken(null)

      if (errorMessage) {
        setError(errorMessage)
        return
      }

      setInfo('If an account exists for that email, a password reset link is on its way.')
      return
    }

    const errorMessage =
      mode === 'sign-in' ? await signIn(email, password, tokenForSubmit) : await signUp(email, password, tokenForSubmit)

    setSubmitting(false)
    turnstileRef.current?.reset()
    setCaptchaToken(null)

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
    <div className="ascension-page-bg flex min-h-screen flex-col items-center justify-center px-4 py-10 text-slate-100">
      <h1 className="font-heading mb-6 flex items-center gap-2.5 text-2xl font-black tracking-[0.15em] uppercase sm:mb-8 sm:text-3xl">
        <span className="ascension-glow-pulse text-base text-amber-400 sm:text-lg">✦</span>
        <span className="text-gradient-steel">ASCENSION</span>
        <span className="text-gradient-gold">IDLE</span>
        <span className="ascension-glow-pulse text-base text-amber-400 sm:text-lg">✦</span>
      </h1>

      <AscensionCard title={MODE_TITLE[mode]} className="w-full max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="text-heading-label">
              Email
            </label>
            <div className="select-frame mt-1.5 rounded-lg">
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full bg-transparent px-3 py-2 text-base text-slate-100 focus:outline-none"
              />
            </div>
          </div>

          {mode !== 'reset-request' && (
            <div>
              <label htmlFor="password" className="text-heading-label">
                Password
              </label>
              <div className="select-frame mt-1.5 rounded-lg">
                <input
                  id="password"
                  type="password"
                  // 'off' (not 'current-password') -- the field starts disabled until
                  // Turnstile verifies, then flips to enabled. Safari/1Password notice a
                  // newly-fillable password field at that moment and re-offer the native
                  // autofill sheet a second time, which looks like the page refreshing
                  // (its light backdrop flashes over this dark UI). Turning off the
                  // suggestion entirely means the user fills it manually (typing, or
                  // 1Password's own share-sheet/keyboard-accessory fill) instead.
                  autoComplete={mode === 'sign-in' ? 'off' : 'new-password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  // Disabled until Turnstile verifies (bug fix, reported by the
                  // user -- 1Password autofilling the password field while
                  // Turnstile was still mid-verify appeared to be knocking the
                  // widget over, leaving it blank with no token). Most password
                  // managers, 1Password included, skip a disabled field
                  // entirely rather than queuing the fill for later, so this
                  // closes off that race regardless of the exact mechanism.
                  disabled={turnstileConfigured && !hasVerified}
                  className="w-full bg-transparent px-3 py-2 text-base text-slate-100 focus:outline-none disabled:opacity-50"
                />
              </div>
              {turnstileConfigured && !hasVerified && (
                <p className="mt-1 text-xs text-slate-400">Waiting for verification check…</p>
              )}
            </div>
          )}

          {mode === 'sign-in' && (
            <button
              type="button"
              onClick={() => switchMode('reset-request')}
              className="text-sm text-slate-400 transition hover:text-amber-300"
            >
              Forgot your password?
            </button>
          )}

          <Turnstile
            ref={turnstileRef}
            onVerify={(token) => {
              setCaptchaToken(token)
              setHasVerified(true)
            }}
            onExpire={() => setCaptchaToken(null)}
          />

          {error && <p className="text-sm text-red-400">{error}</p>}
          {info && <p className="text-sm text-emerald-400">{info}</p>}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Please Wait…' : MODE_SUBMIT_LABEL[mode]}
          </Button>
        </form>

        <div className="ascension-card-header-line mt-6 mb-4" />

        {mode === 'reset-request' ? (
          <button
            type="button"
            onClick={() => switchMode('sign-in')}
            className="w-full text-center text-sm text-slate-400 transition hover:text-amber-300"
          >
            Back to sign in
          </button>
        ) : (
          <button
            type="button"
            onClick={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
            className="w-full text-center text-sm text-slate-400 transition hover:text-amber-300"
          >
            {mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
          </button>
        )}
      </AscensionCard>

      <div className="mt-6 flex items-center gap-3 text-xs text-slate-400">
        <button type="button" onClick={() => setLegalDoc('privacy')} className="transition hover:text-amber-300">
          Privacy Policy
        </button>
        <span className="text-slate-700">·</span>
        <button type="button" onClick={() => setLegalDoc('terms')} className="transition hover:text-amber-300">
          Terms &amp; Conditions
        </button>
      </div>

      {legalDoc && <LegalModal initialDoc={legalDoc} onClose={() => setLegalDoc(null)} />}
    </div>
  )
}
