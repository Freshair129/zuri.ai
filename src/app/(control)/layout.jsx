import PlatformControlGuard from '@/components/layouts/PlatformControlGuard'
import PlatformControlShell from '@/components/layouts/PlatformControlShell'

// @req FR-105 — `/control/**` stays entirely outside the BusinessShell group.
// @spec ADR-048 D1-D2
// @tested tests/unit/platform-control-route-contract.test.js

export default function PlatformControlLayout({ children }) {
  return (
    <PlatformControlGuard>
      <PlatformControlShell>{children}</PlatformControlShell>
    </PlatformControlGuard>
  )
}
