import { z } from 'zod'
import prisma from '@/lib/db'
import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { createIntegrationConnection, registerIntegrationProvider, upsertIntegrationCredentialMetadata, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'

// @req FR-149 — owner provisions connection metadata; secret bytes stay in the deployment mount.
// @spec ADR-061, SEC-001, SEC-016
// @tested tests/integration/fr149-line-server-configuration.test.js
function notFound() { const error = new Error('Business not found'); error.status = 404; return error }
const inputSchema = z.object({
  businessId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  destination: z.string().regex(/^U[0-9a-f]{32}$/i),
  secretRef: z.string().trim().regex(/^deployment-secret:[A-Za-z0-9_-]{1,100}$/),
}).strict()

export async function provisionLineServerConnection(input, { viewer, db = prisma } = {}) {
  const data = inputSchema.parse(input)
  if (!ownsBusiness(viewer, data.businessId) || !seesBusiness(viewer, data.businessId)) throw notFound()
  assertDomainVisible(viewer, data.businessId, 'line-oa')
  // Five sequential writes — business, provider, connection, credential metadata, audit — under
  // Prisma's 5 s interactive default, which is not a budget anyone chose. It was measured failing
  // on CI at **5045 ms**: a P2028 "Transaction already closed" 45 ms past the line, surfaced to the
  // browser as a 400 with no field to blame, while two sibling reads on the same page answered
  // SESSION_UNAVAILABLE. Nothing was slow; the connection was simply held elsewhere for a moment.
  //
  // This is the same defect `atomic()` in line-conversation-jobs.js was given 15 s for on
  // 2026-09-08, for the same reason (see the comment there, and the RCA it cites). Matching that
  // number here rather than inventing a new one: the two transactions do comparable work against
  // the same pool, and a limit that differs per call site is a limit nobody can reason about.
  // 15 s still fails loudly — it does not hide a regression, it stops a contended moment from
  // being reported to an owner as invalid input.
  return db.$transaction(async tx => {
    const business = await tx.business.findUnique({ where: { id: data.businessId } })
    if (!business) throw notFound()
    const provider = await tx.integrationProvider.findUnique({ where: { code: LINE_OA_PROVIDER_CODE } }) ?? await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account' }, { db: tx })
    const connection = await createIntegrationConnection({
      tenantId: business.tenantId, businessId: business.id, providerId: provider.id,
      name: data.name, externalAccountId: data.destination, status: 'ACTIVE', authorizationType: 'SECRET_MANAGER',
    }, { db: tx })
    await upsertIntegrationCredentialMetadata({ tenantId: business.tenantId, connectionId: connection.id, secretRef: data.secretRef }, { db: tx })
    await recordAudit(tx, { entityType: 'INTEGRATION_CONNECTION', entityId: connection.id, action: 'LINE_SERVER_CONNECTION_PROVISIONED', actorId: viewer.principal?.id ?? null,
      payload: { businessId: business.id, provider: LINE_OA_PROVIDER_CODE } })
    return { id: connection.id, businessId: business.id, name: connection.name, destination: connection.externalAccountId }
  }, { timeout: 15000, maxWait: 5000 })
}
