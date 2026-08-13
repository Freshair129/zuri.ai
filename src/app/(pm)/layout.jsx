'use client'

import AppShell from '@/components/layouts/AppShell'
import BusinessShellGuard from '@/components/layouts/BusinessShellGuard'

// @req FR-044 — BusinessShell owns only guarded PM/domain routes.
// @spec ADR-015, SDD-022 — EntryShell and BusinessRoutingShell stay outside
// this route-group layout; ProjectResourceShell remains nested below it.
// @tested tests/unit/entry-routing-boundary.test.js, tests/unit/business-shell-guard.test.js

export default function ProjectManagerLayout({ children }) {
  return (
    <BusinessShellGuard>
      <AppShell>{children}</AppShell>
    </BusinessShellGuard>
  )
}
