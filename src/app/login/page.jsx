'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// @req FR-044 — the entry journey keeps Login outside the BusinessShell.
// @spec ADR-015, SDD-022 — EntryShell owns only the minimal pre-routing surfaces.
// @tested tests/unit/entry-surfaces.test.js
import EntryShell from '@/components/layouts/EntryShell'
// @req FR-046 — owner entry creates an explicit server-owned session cookie.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js, tests/unit/fr046-auth-route.test.js, tests/e2e/fr046-entry-contract.spec.js
import { LOGIN_ERROR_NETWORK, loginErrorMessage } from '@/modules/identity/login-error-copy'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const result = await response.json()
      if (!response.ok) {
        // Only a 401 is a credential failure. A 503 AUTH_UNAVAILABLE means the
        // server cannot mint a session at all, and saying "wrong password" there
        // sends the operator hunting the wrong thing.
        setError(loginErrorMessage(response.status, result))
        return
      }
      router.replace(result.redirect || '/businesses')
      router.refresh()
    } catch {
      setError(LOGIN_ERROR_NETWORK)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <EntryShell>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2" aria-label="Zuri">
          <span className="text-lg font-bold tracking-[0.24em]">ZURI</span>
          <span className="h-2 w-2" style={{ background: 'var(--action-primary)' }} aria-hidden="true" />
        </div>
        <span className="rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] px-2 py-1 text-[10px] font-bold tracking-[0.14em]" style={{ color: 'var(--action-primary-active)' }}>
          ETOHGROUP
        </span>
      </div>

      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--action-primary)' }}>
          Console Sign In
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Sign in to Zuri</h1>
        <p className="mt-2 text-sm leading-6 text-muted">Use your Zuri account credentials to access your workspace and integrations.</p>
      </div>

      <form action="/api/auth/login" method="post" onSubmit={submit} className="mt-6 space-y-4">
        <label className="block text-xs font-semibold" htmlFor="username">
          Email or account code
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="mt-1.5 min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal outline-none focus:border-[var(--action-primary)]"
          />
        </label>
        <label className="block text-xs font-semibold" htmlFor="password">
          Password
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1.5 min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal outline-none focus:border-[var(--action-primary)]"
          />
        </label>

        {error ? <p role="alert" className="text-xs text-[var(--danger)]">{error}</p> : null}

        <button type="submit" disabled={submitting} className="btn btn-primary inline-flex min-h-11 w-full justify-center disabled:cursor-not-allowed disabled:opacity-60">
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-muted">EtohGroup Enterprise Operating System</p>
    </EntryShell>
  )
}
