'use client'

import PosWorkspace from '@/modules/commerce/components/PosWorkspace'
import { useScope } from '@/context/ScopeContext'

// @req FR-183 — POS checkout over existing Commerce orders/payments and the
// Inventory append-only ledger.
// @spec ADR-065; BR-001; BR-002; SEC-001
// @tested tests/integration/fr183-pos.test.js

export default function PosPage() {
  const scope = useScope()
  const businessId = scope.shell.activeBusiness?.id || null
  return <PosWorkspace key={businessId || 'no-business'} businessId={businessId} />
}
