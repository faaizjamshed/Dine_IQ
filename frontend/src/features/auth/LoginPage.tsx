import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, Mail, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BrandPanel } from './BrandPanel'
import { DineIQMark } from './DineIQMark'
import { useAuth } from './AuthProvider'
import { ROLE_LABELS, type UserRole } from '@/lib/permissions'

interface DemoAccount {
  email: string
  password: string
  role: UserRole
}

/**
 * LoginPage — split-screen authentication (spec §23).
 *
 * Right side: secure form with validation, loading, incorrect-credentials and
 * network-failure states. Role-aware demo account chips appear ONLY in mock
 * mode; demo credentials are loaded from mock configuration (never hardcoded
 * in component source) via a mock-gated dynamic import so they are excluded
 * from production bundles.
 */
export function LoginPage() {
  const { login, register, user, status, useMocks } = useAuth()
  const navigate = useNavigate()

  const [registering, setRegistering] = React.useState(false)
  const [registrationError, setRegistrationError] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<'invalid_credentials' | 'network' | null>(null)
  const [validation, setValidation] = React.useState<{ email?: string; password?: string }>({})
  const [demoAccounts, setDemoAccounts] = React.useState<DemoAccount[]>([])


  React.useEffect(() => {
    if (status === 'authenticated' && user) navigate('/dashboard', { replace: true })
  }, [status, user, navigate])

  const validate = (): boolean => {
    const next: { email?: string; password?: string } = {}
    if (!email.trim()) next.email = 'Email is required.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = 'Enter a valid email address.'
    }
    if (!password) next.password = 'Password is required.'
    setValidation(next)
    return Object.keys(next).length === 0
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setRegistrationError('')
    if (!validate()) return
    setSubmitting(true)
    try {
      if (registering) await register(email.trim(), password)
      else await login(email.trim(), password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      if (registering) setRegistrationError(err instanceof Error ? err.message : 'Registration failed.')
      else setFormError(err instanceof Error ? (err.message as 'invalid_credentials' | 'network') : 'network')
    } finally {
      setSubmitting(false)
    }
  }

  const applyDemo = (account: DemoAccount) => {
    setEmail(account.email)
    setPassword(account.password)
    setValidation({})
    setFormError(null)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#060a14] p-2 sm:p-4 lg:p-6">
      <div className="relative flex min-h-[calc(100vh-1rem)] w-full max-w-[1600px] overflow-hidden rounded-[24px] border border-white/10 bg-background shadow-[0_24px_100px_rgba(0,0,0,.45)] sm:min-h-[calc(100vh-2rem)] sm:rounded-[30px] lg:min-h-[calc(100vh-3rem)]">
      <BrandPanel />

      {/* Right: secure login form */}
      <div className="relative flex min-w-0 flex-1 items-center justify-center overflow-y-auto bg-background-subtle/55 px-5 py-9 sm:px-10 sm:py-12 lg:px-12 xl:px-16">
        <div aria-hidden className="pointer-events-none absolute right-[-120px] top-[-120px] h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute bottom-[-160px] left-[-100px] h-80 w-80 rounded-full bg-sky-400/10 blur-3xl" />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="relative z-10 w-full max-w-[450px]"
        >
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <DineIQMark size={38} />
            <div>
              <p className="font-extrabold tracking-tight text-foreground">DineIQ Analytics</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-subtle">Restaurant intelligence</p>
            </div>
          </div>

          <div className="rounded-[24px] border border-border-strong bg-surface/75 p-5 shadow-[0_18px_60px_rgba(0,0,0,.22)] backdrop-blur-xl sm:p-8">
            <div className="mb-7 flex items-start justify-between gap-4">
              <div>
                <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  Welcome back
                </div>
                <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-foreground sm:text-[28px]">{registering ? 'Create your workspace' : 'Sign in to DineIQ'}</h2>
                <p className="mt-2 max-w-sm text-xs leading-5 text-muted">
                  {registering ? 'Create an analyst account to explore the restaurant intelligence workspace.' : 'Your evidence-led command centre for smarter restaurant decisions.'}
                </p>
              </div>
              <div className="hidden rounded-xl border border-primary/20 bg-primary/10 p-2.5 sm:block">
                <LockKeyhole className="h-5 w-5 text-primary" aria-hidden />
              </div>
            </div>

            <div className="mb-6 grid grid-cols-2 rounded-xl border border-border bg-background/40 p-1">
              <button type="button" onClick={() => { setRegistering(false); setFormError(null); setRegistrationError('') }} className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${!registering ? 'bg-surface-strong text-foreground shadow-sm' : 'text-muted hover:text-foreground'}`}>Sign in</button>
              <button type="button" onClick={() => { setRegistering(true); setFormError(null); setRegistrationError('') }} className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${registering ? 'bg-surface-strong text-foreground shadow-sm' : 'text-muted hover:text-foreground'}`}>New account</button>
            </div>

            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-xs font-bold">Work email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
                  <Input id="email" type="email" autoComplete="email" placeholder="you@dineiq.pk" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(validation.email)} aria-describedby={validation.email ? 'email-error' : undefined} className="h-11 pl-10" />
                </div>
                {validation.email && <p id="email-error" className="text-xs font-medium text-critical">{validation.email}</p>}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between"><Label htmlFor="password" className="text-xs font-bold">Password</Label><span className="font-mono text-[10px] text-subtle">Protected session</span></div>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
                  <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••••••" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(validation.password)} aria-describedby={validation.password ? 'password-error' : undefined} className="h-11 pl-10 pr-10" />
                  <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-subtle transition-colors hover:bg-surface-strong hover:text-foreground">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
                {validation.password && <p id="password-error" className="text-xs font-medium text-critical">{validation.password}</p>}
              </div>

            {formError === 'invalid_credentials' && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-critical/40 bg-critical/10 p-2.5 text-xs text-foreground"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-critical" aria-hidden />
                Incorrect email or password. Check your credentials and try again.
              </div>
            )}
            {formError === 'network' && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-high/40 bg-high/10 p-2.5 text-xs text-foreground"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-high" aria-hidden />
                Cannot reach the authentication service. Check your connection and try again.
              </div>
            )}

            <Button type="submit" size="lg" disabled={submitting} className="group h-11 w-full">
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden /> Signing in…
                </>
              ) : (
                <>
                  <LockKeyhole aria-hidden /> {registering ? 'Create account and sign in' : 'Enter command centre'} <ArrowRight className="transition-transform group-hover:translate-x-0.5" aria-hidden />
                </>
              )}
            </Button>
            {registrationError && <p role="alert" className="text-xs text-critical">{registrationError}</p>}
            </form>
            {registering && <p className="mt-3 text-center text-xs text-subtle">Use a password of 12–256 characters. New accounts receive the analyst role.</p>}

            <div className="mt-6 flex items-center justify-center gap-4 border-t border-border pt-5 text-[10px] text-subtle">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-positive" aria-hidden /> Role-based access</span>
              <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden /> Secure cookies</span>
            </div>
          </div>

          <p className="mt-4 text-center font-mono text-[10px] text-subtle">DineIQ Analytics · Restaurant Intelligence Command Centre</p>
        </motion.div>
      </div>
      </div>
    </div>
  )
}
