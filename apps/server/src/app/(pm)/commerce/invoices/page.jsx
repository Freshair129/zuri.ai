'use client'

import BillingWorkspace from '@/modules/commerce/components/BillingWorkspace'
import { useScope } from '@/context/ScopeContext'

// @req FR-186 — Business-scoped billing configuration and durable document
// preview/issuance are exposed in the Commerce Billing tab.
// @spec ADR-065; BR-001; BR-002; SEC-001
// @tested tests/integration/fr186-billing.test.js

export default function InvoicesPage() {
  const scope = useScope()
  const businessId = scope.shell.activeBusiness?.id || null
  return <BillingWorkspace key={businessId || 'no-business'} businessId={businessId} />
}
