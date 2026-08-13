// @req FR-044 — Login is a credential-free demo transition into Business Routing.
// @spec ADR-015, SDD-022 — no authentication, session, token, or credential handling in this slice.
// @tested tests/unit/entry-surfaces.test.js
import Link from 'next/link'
import EntryShell from '@/components/layouts/EntryShell'

export default function LoginPage() {
  return (
    <EntryShell>
      <p className="text-xs font-semibold" style={{ color: 'var(--action-primary)' }}>
        Demo entry
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">Sign in to Zuri</h1>
      <p className="mt-2 text-sm leading-6 text-muted">This local demo skips credentials and continues to Business Routing.</p>
      <Link href="/businesses" className="btn btn-primary mt-6 inline-flex w-full justify-center">
        Continue with demo login
      </Link>
    </EntryShell>
  )
}
