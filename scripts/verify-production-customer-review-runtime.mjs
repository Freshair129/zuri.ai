#!/usr/bin/env node
// Run with: npx vite-node --config vitest.config.js scripts/verify-production-customer-review-runtime.mjs
// The Vite runtime supplies the repository's @/* alias for server modules.
//
// @req FR-076, FR-078 — prove the production application viewer and private
// review adapter compose without returning raw PII.
// @spec ADR-033 D8, CDC-SG-CUSTOMER-DATA-001 v0.3.0B.

import prisma from '@/lib/db'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { listCustomerImportReviewQueue } from '@/modules/crm/customer-import-review-service'

const BOSS_ID = 'c82690eb-84e8-48a8-8a28-fe3d839c2276'
const SMARTGIFT_BUSINESS_ID = '834fa869-62f3-431c-a287-e9a95e91175b'

if (!process.env.ZURI_CUSTOMER_REVIEW_DATABASE_URL) {
  throw new Error('ZURI_CUSTOMER_REVIEW_DATABASE_URL is required for the production review smoke')
}

try {
  const viewer = await resolveViewer({ principalId: BOSS_ID, allowDevelopmentFallback: false })
  const queue = await listCustomerImportReviewQueue({
    businessId: SMARTGIFT_BUSINESS_ID,
    viewer,
  })

  console.log(JSON.stringify({
    status: 'VERIFIED',
    viewer: {
      principalCode: viewer.principal.code,
      role: viewer.role,
      visibleBusinessCount: viewer.visibleBusinessIds.length,
      ownedBusinessCount: viewer.ownedBusinessIds.length,
      smartGiftPermissions: viewer.permissionsByBusinessId[SMARTGIFT_BUSINESS_ID] || [],
    },
    queue: {
      businessCode: queue.scope.businessCode,
      cases: queue.counts.cases,
      items: queue.counts.items,
      openCases: queue.counts.openCases,
      rawPii: queue.privacy.rawPii,
    },
  }))
} finally {
  await prisma.$disconnect()
}
