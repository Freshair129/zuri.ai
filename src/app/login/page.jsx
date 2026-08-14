// @req FR-044 — Login is a credential-free demo transition into Business Routing.
// @spec ADR-015, SDD-022 — no authentication, session, token, or credential handling in this slice.
// @tested tests/unit/entry-surfaces.test.js, tests/unit/fr046-api-ui-contract.test.js
import EntryShell from '@/components/layouts/EntryShell'
// @req FR-046 — local demo entry creates an explicit server-owned session cookie.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js, tests/e2e/fr046-entry-contract.spec.js

export default function LoginPage() {
  return (
    <EntryShell>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2" aria-label="Zuri">
          <span className="text-lg font-bold tracking-[0.24em]">ZURI</span>
          <span className="h-2 w-2" style={{ background: 'var(--action-primary)' }} aria-hidden="true" />
        </div>
        <span className="rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] px-2 py-1 text-[10px] font-bold tracking-[0.14em]" style={{ color: 'var(--action-primary-active)' }}>
          DEMO
        </span>
      </div>

      <div className="mt-8">
        <p className="text-xs font-semibold" style={{ color: 'var(--action-primary)' }}>
          LOCAL ENTRY
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Sign in to Zuri</h1>
        <p className="mt-2 text-sm leading-6 text-muted">Use the preview form below. This demo does not connect to an authentication provider.</p>
      </div>

      <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
        Values entered here stay in the browser and are never submitted or saved.
      </div>

      <form action="/api/session/demo" method="post" autoComplete="off" className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold">Email</span>
          <input type="email" autoComplete="off" inputMode="email" className="input min-h-11" placeholder="you@example.com" aria-label="Email" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold">Password</span>
          <input type="password" autoComplete="off" className="input min-h-11" placeholder="••••••••" aria-label="Password" />
        </label>
        <button type="submit" className="btn btn-primary mt-2 inline-flex min-h-11 w-full justify-center">
          Continue with demo login
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-muted">No account setup is required for this preview.</p>
    </EntryShell>
  )
}
