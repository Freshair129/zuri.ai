'use client'

// @req FR-044, FR-081 — Production Login surface for Zuri entry journey.
// @spec ADR-015, SDD-022, SDD-024, SEC-015 — EntryShell owns entry presentation with real credential auth.
// @tested tests/unit/entry-surfaces.test.js, tests/unit/fr046-api-ui-contract.test.js, tests/unit/auth-api.test.js
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { User, Lock, Eye, EyeOff, X, CheckCircle, AlertCircle } from 'lucide-react'
import EntryShell from '@/components/layouts/EntryShell'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Forgot password modal states
  const [showForgotModal, setShowForgotModal] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotStatus, setForgotStatus] = useState(null) // { type: 'success'|'error', text: string }

  const handleLoginSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        setError(data.error === 'INVALID_CREDENTIALS' ? 'Invalid username or password.' : (data.error || 'Authentication failed.'))
        setLoading(false)
        return
      }

      router.push(data.redirect || '/businesses')
    } catch {
      setError('Connection error. Please try again.')
      setLoading(false)
    }
  }

  const handleForgotSubmit = async (e) => {
    e.preventDefault()
    setForgotStatus(null)
    setForgotLoading(true)

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrUsername: forgotEmail }),
      })

      const data = await res.json()

      if (!res.ok) {
        setForgotStatus({ type: 'error', text: data.error || 'Request failed. Please try again.' })
      } else {
        setForgotStatus({
          type: 'success',
          text: 'If an account exists with that email/username, password reset instructions have been generated.',
        })
      }
    } catch {
      setForgotStatus({ type: 'error', text: 'Network error. Please try again.' })
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <EntryShell>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2" aria-label="Zuri">
          <span className="text-lg font-bold tracking-[0.24em]">ZURI</span>
          <span className="h-2 w-2 rounded-full" style={{ background: 'var(--action-primary, #E8820C)' }} aria-hidden="true" />
        </div>
        <span
          className="rounded-[var(--radius-sm)] bg-amber-50 dark:bg-amber-950/40 px-2 py-1 text-[10px] font-bold tracking-[0.14em]"
          style={{ color: 'var(--action-primary-active, #B86A08)' }}
        >
          SECURE AUTH
        </span>
      </div>

      <div className="mt-6">
        <h1 className="text-2xl font-bold tracking-tight">Sign in to Zuri</h1>
        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
          Enter your username and password or continue with Gmail.
        </p>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-md bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form action="/api/auth/login" method="post" onSubmit={handleLoginSubmit} className="mt-5 space-y-4">
        <div>
          <label htmlFor="username" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Username or Email
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <User className="h-4 w-4" />
            </div>
            <input
              id="username"
              name="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="name@example.com or username"
              className="w-full rounded-md border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-[#E8820C] focus:outline-none focus:ring-1 focus:ring-[#E8820C] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="password" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Password
            </label>
            <button
              type="button"
              onClick={() => {
                setForgotStatus(null)
                setForgotEmail(username)
                setShowForgotModal(true)
              }}
              className="text-xs font-medium text-[#E8820C] hover:underline focus:outline-none"
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Lock className="h-4 w-4" />
            </div>
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-slate-300 bg-white py-2.5 pl-9 pr-10 text-sm placeholder:text-slate-400 focus:border-[#E8820C] focus:outline-none focus:ring-1 focus:ring-[#E8820C] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 focus:outline-none"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="btn btn-primary inline-flex min-h-11 w-full items-center justify-center font-medium shadow-sm transition-colors disabled:opacity-60"
        >
          {loading ? 'Authenticating...' : 'Sign in'}
        </button>
      </form>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-slate-200 dark:border-slate-800" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-2 text-slate-500 dark:bg-slate-900 dark:text-slate-400">Or continue with</span>
        </div>
      </div>

      <form action="/api/auth/login" method="post">
        <button
          type="submit"
          className="inline-flex min-h-11 w-full items-center justify-center gap-3 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#E8820C] focus:ring-offset-2 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          Login with Gmail.com
        </button>
      </form>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Reset Password</h2>
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                className="rounded-md p-1 text-slate-400 hover:text-slate-600 focus:outline-none"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Enter your account email or username to receive password reset instructions.
            </p>

            {forgotStatus && (
              <div
                className={`mt-4 flex items-center gap-2 rounded-md p-3 text-xs ${
                  forgotStatus.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                    : 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                }`}
              >
                {forgotStatus.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                <span>{forgotStatus.text}</span>
              </div>
            )}

            <form onSubmit={handleForgotSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="forgot-email" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Email or Username
                </label>
                <input
                  id="forgot-email"
                  type="text"
                  required
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="name@example.com or username"
                  className="w-full rounded-md border border-slate-300 bg-white py-2 px-3 text-sm placeholder:text-slate-400 focus:border-[#E8820C] focus:outline-none focus:ring-1 focus:ring-[#E8820C] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForgotModal(false)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="btn btn-primary px-4 py-2 text-xs font-medium shadow-sm transition-colors disabled:opacity-60"
                >
                  {forgotLoading ? 'Processing...' : 'Send Reset Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </EntryShell>
  )
}


