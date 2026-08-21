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
          ETOHGROUP
        </span>
      </div>

      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--action-primary)' }}>
          Console Sign In
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Sign in to Zuri</h1>
        <p className="mt-2 text-sm leading-6 text-muted">Sign in as EtohGroup Business Owner to access your workspace and integrations.</p>
      </div>

      <form action="/api/session/demo" method="post" className="mt-6">
        <button type="submit" className="btn btn-primary inline-flex min-h-11 w-full justify-center">
          Sign In as Owner (demo access)
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-muted">EtohGroup Enterprise Operating System</p>
    </EntryShell>
  )
}
