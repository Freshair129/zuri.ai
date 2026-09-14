#!/usr/bin/env node
// Run with: npx vite-node --config vitest.config.js scripts/enable-smartgift-knowledge-candidates.mjs -- --apply
// (omit --apply for a dry run). The Vite runtime supplies the repository's
// @/* alias for server modules, the same way
// scripts/verify-production-customer-review-runtime.mjs does.
//
// @req FR-236 — the one-time write TASK-ZAI-099's success criterion names:
//   "candidates are off by default per Business; when the owner turns them
//   on for SmartGift, the switch is recorded with its date and who asked."
//   This script is that write for the real production SmartGift Business —
//   NOT auto-run by tests, by `npm run govern`, or by any migration. It goes
//   through the same audited service the API route and any future admin UI
//   would use (`business-knowledge-candidates-service.js`), never a raw
//   UPDATE, so the write is versioned CAS and produces the same
//   BUSINESS/KNOWLEDGE_CANDIDATES_ENABLED_CHANGED AuditEvent either way.
// @spec ADR-090 D6; BR-001; SEC-003
// @tested tests/integration/fr236-knowledge-candidates-business-toggle.test.js
//   (the service this script calls; this script itself is not unit-tested —
//   it is a one-shot operator action against production, not library code)
//
// NOT RUN by this change and never executed by this session: no production
// database access exists here, and none was attempted. This is authored for
// the reviewer's separate operator step (ADR-057) — dry run first, then
// --apply, per the CLAUDE.md deploy-role convention.

import prisma from '@/lib/db'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { setKnowledgeCandidatesEnabled } from '@/modules/business/application/business-knowledge-candidates-service'

// Same identities scripts/verify-production-customer-review-runtime.mjs and
// scripts/apply-smartgift-platform-approver-profile.mjs already use: the
// reviewed platform approver (PER-BOSS) and the real SmartGift Business.
const BOSS_PERSON_ID = 'c82690eb-84e8-48a8-8a28-fe3d839c2276'
const SMARTGIFT_BUSINESS_ID = '834fa869-62f3-431c-a287-e9a95e91175b'

// "Recorded with its date and who asked" (TASK-ZAI-099): the date is the
// AuditEvent's own `occurredAt`; "who asked" is recorded here explicitly,
// separate from the acting principal (PER-BOSS resolves the viewer that
// performs the write, which is not necessarily the same row as the person
// whose instruction is being carried out).
const REQUESTED_BY = 'Owen'
const REASON = 'Owner instruction 2026-09-14 (TASK-ZAI-099): turn on LINE FAQ knowledge candidates for SmartGift specifically, after FR-236 shipped without the per-Business gate.'

const apply = process.argv.includes('--apply')

try {
  const business = await prisma.business.findUnique({
    where: { id: SMARTGIFT_BUSINESS_ID },
    select: { id: true, code: true, name: true, version: true, knowledgeCandidatesEnabled: true },
  })
  if (!business) {
    throw new Error(`SmartGift Business ${SMARTGIFT_BUSINESS_ID} not found — refusing rather than guessing another id`)
  }

  if (business.knowledgeCandidatesEnabled) {
    console.log(JSON.stringify({ status: 'ALREADY_ENABLED', businessId: business.id, businessCode: business.code }, null, 2))
    process.exit(0)
  }

  if (!apply) {
    console.log(JSON.stringify({
      status: 'DRY_RUN',
      businessId: business.id,
      businessCode: business.code,
      businessName: business.name,
      currentlyEnabled: business.knowledgeCandidatesEnabled,
      version: business.version,
      wouldWrite: { enabled: true, requestedBy: REQUESTED_BY, reason: REASON },
    }, null, 2))
    process.exit(0)
  }

  const viewer = await resolveViewer({ principalId: BOSS_PERSON_ID })
  const result = await setKnowledgeCandidatesEnabled(business.id, {
    version: business.version,
    enabled: true,
    requestedBy: REQUESTED_BY,
    reason: REASON,
  }, { viewer })

  console.log(JSON.stringify({
    status: 'APPLIED',
    businessId: business.id,
    businessCode: business.code,
    knowledgeCandidatesEnabled: result.knowledgeCandidatesEnabled,
    version: result.version,
  }, null, 2))
} finally {
  await prisma.$disconnect()
}
