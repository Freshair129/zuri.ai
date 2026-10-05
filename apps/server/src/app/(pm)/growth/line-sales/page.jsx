'use client'

// @req FR-278 — place the executive LINE OA sales view in the active Business scope.
// @spec SEC-001
// @tested tests/unit/marketing/line-sales-dashboard-ui.test.js

import { useScope } from '@/context/ScopeContext'
import LineSalesExecutiveDashboard from '@/modules/marketing/components/LineSalesExecutiveDashboard'

export default function LineSalesPage() {
  const scope = useScope()
  const businessId = scope.shell.activeBusinessId
  return <LineSalesExecutiveDashboard key={businessId || 'no-business'} businessId={businessId} />
}
