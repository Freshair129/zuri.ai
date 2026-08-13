// @req FR-044 — Landing is the first entry surface and has one path into Login.
// @spec ADR-015, SDD-022 — Landing belongs to EntryShell, before Business Routing.
// @tested tests/unit/entry-surfaces.test.js
import Link from 'next/link'
import EntryShell from '@/components/layouts/EntryShell'

export default function LandingPage() {
  return (
    <EntryShell>
      <p className="text-xs font-semibold" style={{ color: 'var(--action-primary)' }}>
        Zuri v2
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">Welcome to Zuri</h1>
      <p className="mt-2 text-sm leading-6 text-muted">Enter the workspace to choose a Business and continue.</p>
      <Link href="/login" className="btn btn-primary mt-6 inline-flex w-full justify-center">
        Sign in
      </Link>
    </EntryShell>
  )
}
