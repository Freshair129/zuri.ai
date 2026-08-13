// @req FR-044 — Login is a credential-free demo transition into Business Routing.
// @spec ADR-015, SDD-022 — no authentication, session, token, or credential handling in this slice.
// @tested tests/unit/entry-surfaces.test.js
import EntryShell from '@/components/layouts/EntryShell'
// @req FR-046 — local demo entry creates an explicit server-owned session cookie.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js, tests/e2e/fr046-entry-contract.spec.js

export default function LoginPage() {
  return (
    <EntryShell>
      <p className="text-xs font-semibold" style={{ color: 'var(--action-primary)' }}>
        Demo entry
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">Sign in to Zuri</h1>
      <p className="mt-2 text-sm leading-6 text-muted">This local demo skips credentials and continues to Business Routing.</p>
      <form action="/api/session/demo" method="post">
        <button type="submit" className="btn btn-primary mt-6 inline-flex w-full justify-center">
          Continue with demo login
        </button>
      </form>
    </EntryShell>
  )
}
