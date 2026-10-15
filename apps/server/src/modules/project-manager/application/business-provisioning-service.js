// @req FR-286 — provision the pinned Business template within FR-074 creation transactions.
// @spec FR-074, FR-169, FR-191, FR-192, FR-285 — no new grants or public apply path.
// @tested tests/integration/business-provisioning-template.test.js,
// tests/integration/fr074-scope-creation-authorization.test.js
import { uniqueHumanCode } from '@/lib/ids'
import { recordAudit } from './audit'
import {
  BusinessProvisioningError,
  STANDARD_BUSINESS_SPACE_KEY,
  STANDARD_BUSINESS_TEMPLATE_ID,
  STANDARD_BUSINESS_TEMPLATE_VERSION,
  buildStandardBusinessTemplate,
  canonicalBusinessJson,
  standardBusinessSnapshotDigest,
  validateStoredBusinessProvisioning,
} from './business-provisioning-template'

function refuse(code, status = 409) {
  throw new BusinessProvisioningError(code, status)
}

function hasAnyMarker(business) {
  return [
    business.provisioningTemplateId,
    business.provisioningTemplateVersion,
    business.provisioningTemplateDigest,
    business.provisioningSnapshotJson,
  ].some((value) => value != null)
}

function ancestryMatches(space, business, tenant) {
  return space?.scopeType === 'BUSINESS' && space.businessId === business.id &&
    space.tenantId === tenant.id && space.portfolioId === tenant.portfolioId
}

function withoutTenantRelation(business) {
  const { tenant: _tenant, ...row } = business
  return row
}

/**
 * Private FR-074 creation hook. Call only after the existing creation guard,
 * with the transaction's newly-created Business and, for self-service, its
 * existing starter Business Space.
 */
export async function provisionStandardBusinessTemplate(tx, {
  business,
  actorId,
  workspace: suppliedWorkspace = null,
  workspaceName,
}) {
  if (typeof business?.id !== 'string' || !business.id ||
      typeof business?.tenantId !== 'string' || !business.tenantId ||
      typeof actorId !== 'string' || !actorId) {
    refuse('BUSINESS_PROVISIONING_CONTEXT_INVALID', 400)
  }

  const persisted = await tx.business.findUnique({
    where: { id: business.id },
    include: { tenant: { select: { id: true, portfolioId: true } } },
  })
  if (!persisted || persisted.tenantId !== business.tenantId ||
      persisted.tenant?.id !== persisted.tenantId || !persisted.tenant?.portfolioId) {
    refuse('BUSINESS_PROVISIONING_SCOPE_INVALID', 409)
  }
  const tenant = persisted.tenant
  const spaces = await tx.workspace.findMany({
    where: { businessId: persisted.id },
    orderBy: { createdAt: 'asc' },
  })
  const keyedSpaces = spaces.filter((space) => space.provisioningKey != null)

  if (hasAnyMarker(persisted)) {
    if (keyedSpaces.length !== 1 || keyedSpaces[0].provisioningKey !== STANDARD_BUSINESS_SPACE_KEY) {
      refuse('BUSINESS_PROVISIONING_CORRUPT', 500)
    }
    if (suppliedWorkspace && suppliedWorkspace.id !== keyedSpaces[0].id) {
      refuse('BUSINESS_PROVISIONING_CORRUPT', 500)
    }
    const valid = validateStoredBusinessProvisioning(persisted, keyedSpaces[0])
    return {
      ...valid,
      status: 'ALREADY_APPLIED',
      business: withoutTenantRelation(persisted),
      workspace: keyedSpaces[0],
    }
  }

  if (keyedSpaces.length) refuse('BUSINESS_PROVISIONING_CORRUPT', 500)
  let target = null
  if (suppliedWorkspace) {
    target = spaces.find((space) => space.id === suppliedWorkspace.id) || null
    if (!target || target.provisioningKey != null || !ancestryMatches(target, persisted, tenant)) {
      refuse('BUSINESS_PROVISIONING_SCOPE_INVALID', 409)
    }
  } else if (spaces.length) {
    // This private helper is a creation hook, never an existing-Business
    // backfill. Ordinary pre-existing Spaces are left untouched by refusal.
    refuse('BUSINESS_PROVISIONING_EXISTING_SPACE_CONFLICT', 409)
  } else {
    const code = await uniqueHumanCode(
      'WS',
      workspaceName || `งานของ${persisted.name}`,
      async (candidate) => Boolean(await tx.workspace.findUnique({ where: { code: candidate } })),
    )
    target = await tx.workspace.create({
      data: {
        code,
        name: workspaceName || `งานของ${persisted.name}`,
        scopeType: 'BUSINESS',
        portfolioId: tenant.portfolioId,
        tenantId: tenant.id,
        businessId: persisted.id,
      },
    })
  }

  if (!ancestryMatches(target, persisted, tenant)) refuse('BUSINESS_PROVISIONING_SCOPE_INVALID', 409)

  const snapshot = buildStandardBusinessTemplate({
    businessId: persisted.id,
    tenantId: tenant.id,
    portfolioId: tenant.portfolioId,
  })
  const digest = standardBusinessSnapshotDigest(snapshot)
  const updatedBusiness = await tx.business.update({
    where: { id: persisted.id },
    data: {
      provisioningTemplateId: STANDARD_BUSINESS_TEMPLATE_ID,
      provisioningTemplateVersion: STANDARD_BUSINESS_TEMPLATE_VERSION,
      provisioningTemplateDigest: digest,
      provisioningSnapshotJson: canonicalBusinessJson(snapshot),
    },
    include: { tenant: { select: { id: true, portfolioId: true } } },
  })
  const markedWorkspace = target.provisioningKey === STANDARD_BUSINESS_SPACE_KEY
    ? target
    : await tx.workspace.update({
      where: { id: target.id },
      data: { provisioningKey: STANDARD_BUSINESS_SPACE_KEY },
    })

  await recordAudit(tx, {
    entityType: 'BUSINESS',
    entityId: persisted.id,
    action: 'BUSINESS_TEMPLATE_APPLIED',
    actorId,
    tenantId: tenant.id,
    businessId: persisted.id,
    payload: {
      source: 'STANDARD_BUSINESS_TEMPLATE_V1',
      templateId: STANDARD_BUSINESS_TEMPLATE_ID,
      templateVersion: STANDARD_BUSINESS_TEMPLATE_VERSION,
      digest,
    },
    afterJson: {
      schemaVersion: snapshot.schemaVersion,
      scope: snapshot.scope,
      digest,
    },
  })

  return {
    status: 'APPLIED',
    business: withoutTenantRelation(updatedBusiness),
    workspace: markedWorkspace,
    snapshot,
    digest,
  }
}
