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
  })
}
