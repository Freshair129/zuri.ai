// @req FR-191, FR-192 — the one place a `Membership` row comes into existence.
//   Three services in two lanes used to create them: identity's
//   `addBusinessMembership`, project-manager's `addProjectTeamMember`, and
//   `scope-service`'s FR-074(c) founder grant. Production carries twelve grants
//   and six MEMBERSHIP_ADDED events, because two of the three audited under
//   PROJECT and BUSINESS — which is the direct reason the lifecycle could not be
//   repaired by a service in one lane
//   (.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md).
// @spec ADR-077 D1/D8, ADR-025 D3, BR-033, SEC-003, SDD-092
// @req FR-198 — the creation event carries tenantId/businessId/reason as
//   columns, not only inside payload (ADR-080).
// @tested tests/unit/membership-grant-service.test.js,
//   tests/integration/fr191-access-grant-lifecycle.test.js,
//   tests/integration/fr198-fr199-audit-access-evidence.test.js
import prisma from '@/lib/db'
import { z } from 'zod'
import { DOMAINS } from '@/config/domains'
import { MEMBERSHIP_GRANT_SOURCES, MEMBERSHIP_ROLES, LIVE_ACCESS_STATUSES } from '@/lib/validation/enums'
import { recordAudit } from '@/modules/project-manager/application/audit'

const DOMAIN_KEYS = DOMAINS.map((domain) => domain.key)

const zGrant = z.object({
  personId: z.string().min(1),
  tenantId: z.string().min(1),
  // Null is BUSINESS-less on purpose: a tenant-wide grant passes
  // `businessId: null` *and* `scopeType: 'TENANT'`, so the caller has to say
  // what it means rather than have the absence read for it (FR-192).
  businessId: z.string().min(1).nullable().default(null),
  scopeType: z.enum(['TENANT', 'BUSINESS']).optional(),
  role: z.enum(MEMBERSHIP_ROLES).default('MEMBER'),
  domainKeys: z.array(z.enum(DOMAIN_KEYS)).default([]),
  grantSource: z.enum(MEMBERSHIP_GRANT_SOURCES).default('ADMIN'),
  // `.nullish()`, not `.optional()`: callers forward a column value that is
  // genuinely null when unset, and `.optional()` accepts only `undefined` —
  // which turned every grant into a 400 the first time a caller passed one.
  reason: z.string().trim().max(500).nullish(),
  expiresAt: z.date().nullable().optional(),
  actorId: z.string().min(1).nullable().default(null),
  // The action name, because two events for one act is noise an access
  // review has to de-duplicate. FR-038's own history is keyed to
  // `MEMBERSHIP_ADDED` and an id is a key (AGENTS.md §18), so that path
  // keeps its name while every path shares the MEMBERSHIP entityType —
  // the family is the entityType, not the verb.
  action: z.string().regex(/^[A-Z_]+$/).default('MEMBERSHIP_GRANTED'),
})

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Create a grant. **Authority is the caller's problem, not this function's.**
 *
 * Deliberate: the three call sites prove authority in three genuinely different
 * ways — `addBusinessMembership` with `ownsBusiness`, the project team screen
 * with `assertTeamWritable`, and FR-074(c) with "you just created this Business,
 * so you own it by construction". Folding those into one predicate here would
 * either weaken the strictest or invent an authority the founder path does not
 * have. What this function owns is the *shape* of the row and the *record* that
 * it was created: provenance, scope coherence, duplicate refusal and one audit
 * family. Callers stay responsible for deciding who may ask.
 */
export async function grantBusinessMembership(input, { db = prisma } = {}) {
  const data = zGrant.parse(input)
  const scopeType = data.scopeType ?? (data.businessId ? 'BUSINESS' : 'TENANT')

  // The CHECK constraint in Postgres says the same thing; this says it in the
  // application so a SQLite dev run and a Postgres production run refuse
  // identically rather than one of them accepting a row the other rejects.
  if (scopeType === 'BUSINESS' && !data.businessId) throw failure(400, 'BUSINESS_SCOPE_REQUIRES_BUSINESS_ID')
  if (scopeType === 'TENANT' && data.businessId) throw failure(400, 'TENANT_SCOPE_TAKES_NO_BUSINESS_ID')

  // Any live status, not only ACTIVE: a SUSPENDED row is still this person's
  // grant for this scope, and a second row beside it would leave two grants for
  // one scope — which `resolveViewer` reads both of. A REVOKED row is not live,
  // so a revoked person can be granted again as a new row, which is exactly
  // what the partial unique indexes permit.
  const existing = await db.membership.findFirst({
    where: {
      personId: data.personId,
      status: { in: LIVE_ACCESS_STATUSES },
      ...(scopeType === 'TENANT'
        ? { tenantId: data.tenantId, businessId: null }
        : { businessId: data.businessId }),
    },
    select: { id: true },
  })
  if (existing) throw failure(409, 'MEMBERSHIP_ALREADY_EXISTS')

  const created = await db.membership.create({
    data: {
      personId: data.personId,
      tenantId: data.tenantId,
      businessId: data.businessId,
      scopeType,
      role: data.role,
      status: 'ACTIVE',
      domainKeysJson: JSON.stringify(data.domainKeys),
      grantedByPersonId: data.actorId,
      grantReason: data.reason ?? null,
      grantSource: data.grantSource,
      expiresAt: data.expiresAt ?? null,
    },
    include: { person: { select: { id: true, code: true, displayName: true, email: true } } },
  })

  // One audit family for every creation path, whatever screen asked. The
  // calling lane may record its own PROJECT/BUSINESS event alongside as a
  // cross-reference; what it may not do is be the only record.
  //
  // @req FR-198 — tenantId/businessId/reason go on the row as columns, not only
  // inside `payload`, so `listAccessHistory` (FR-199) can query this event by
  // scope instead of scanning the whole stream and parsing JSON.
  await recordAudit(db, {
    entityType: 'MEMBERSHIP',
    entityId: created.id,
    action: data.action,
    payload: {
      personId: data.personId,
      tenantId: data.tenantId,
      businessId: data.businessId,
      scopeType,
      role: data.role,
      domainKeys: data.domainKeys,
      grantSource: data.grantSource,
      reason: data.reason ?? null,
    },
    actorId: data.actorId,
    tenantId: data.tenantId,
    businessId: data.businessId,
    reason: data.reason ?? null,
    afterJson: { status: 'ACTIVE', role: data.role, scopeType, domainKeys: data.domainKeys },
  })

  return created
}
