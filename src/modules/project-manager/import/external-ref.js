import prisma from '@/lib/db'

// @req FR-019 — validate a customer's existing core ids against our records.
// @spec docs/features/FR-019-enterprise-api.md
// @tested tests/integration/external-ref-import.test.js
//
// Identity resolution order: externalRef → code → create new.
// The customer's value is mapped onto our internal UUID; it is never a primary
// key and never overwrites our `code` (two separate namespaces, on purpose).

export const KIND_TO_ENTITY_TYPE = {
  project: 'PROJECT',
  workstream: 'WORKSTREAM',
  container: 'WORK_CONTAINER',
  item: 'WORK_ITEM',
  milestone: 'MILESTONE',
  gate: 'GATE',
}

const ENTITY_TYPE_TO_MODEL = {
  PROJECT: 'project',
  WORKSTREAM: 'workstream',
  WORK_CONTAINER: 'workContainer',
  WORK_ITEM: 'workItem',
  MILESTONE: 'milestone',
  GATE: 'gate',
}

/**
 * Look up one external id. Returns the mapping plus the record it points at
 * (null when the record has since been deleted — a dangling mapping).
 */
export async function lookupExternalRef(system, value, db = prisma) {
  const ref = await db.externalRef.findUnique({ where: { system_value: { system, value } } })
  if (!ref) return null
  const model = ENTITY_TYPE_TO_MODEL[ref.entityType]
  const record = model ? await db[model].findUnique({ where: { id: ref.entityId } }) : null
  return { ref, record }
}

/**
 * Decide how one envelope entity maps onto an existing record.
 *
 * matched   — an external id already points at a record: UPDATE it (relabel),
 *             keeping our code untouched.
 * new/code  — no external id known: fall through to the normal upsert-by-code.
 * conflict  — the ids disagree with each other, with the entity type, or with
 *             what the plan's code already refers to. Never guessed.
 */
export async function resolveEntityIdentity({ kind, code, externalRefs = [] }, db = prisma) {
  const expectedType = KIND_TO_ENTITY_TYPE[kind]
  const refs = externalRefs.map((r) => ({ system: r.system, value: r.id, labelAs: r.labelAs !== false }))
  const resolution = { kind, code, refs, matchedBy: null, entityId: null, matchedCode: null, conflict: null }
  if (refs.length === 0) return resolution

  const found = []
  for (const r of refs) {
    const hit = await lookupExternalRef(r.system, r.value, db)
    if (hit) found.push({ ...hit, requested: r })
  }
  if (found.length === 0) return resolution // new mapping, created on commit

  const wrongType = found.find((f) => f.ref.entityType !== expectedType)
  if (wrongType) {
    resolution.conflict = `external id ${wrongType.requested.system}:${wrongType.requested.value} is already mapped to a ${wrongType.ref.entityType}, not a ${expectedType}`
    return resolution
  }
  const dangling = found.find((f) => !f.record)
  if (dangling) {
    resolution.conflict = `external id ${dangling.requested.system}:${dangling.requested.value} maps to a record that no longer exists (${dangling.ref.entityId})`
    return resolution
  }
  const targets = new Set(found.map((f) => f.ref.entityId))
  if (targets.size > 1) {
    resolution.conflict = `external ids in this entity point at ${targets.size} different records — cannot merge them`
    return resolution
  }

  const target = found[0]
  resolution.matchedBy = 'externalRef'
  resolution.entityId = target.ref.entityId
  resolution.matchedCode = target.record.code

  // The plan's code must not already belong to some other record.
  const model = ENTITY_TYPE_TO_MODEL[expectedType]
  const byCode = await db[model].findUnique({ where: { code } })
  if (byCode && byCode.id !== target.ref.entityId) {
    resolution.conflict = `external id maps to ${target.record.code} but code "${code}" already belongs to a different record`
  }
  return resolution
}

/**
 * Persist the mappings for one committed record. Re-importing the same batch
 * is idempotent; `labelAs` and `verifiedAt` are refreshed each time.
 */
export async function syncExternalRefs(db, { kind, entityId, refs = [] }, now = new Date()) {
  const entityType = KIND_TO_ENTITY_TYPE[kind]
  if (!entityType) return []
  const saved = []
  for (const r of refs) {
    saved.push(
      await db.externalRef.upsert({
        where: { system_value: { system: r.system, value: r.value } },
        update: { entityType, entityId, labelAs: r.labelAs, verifiedAt: now },
        create: { entityType, entityId, system: r.system, value: r.value, labelAs: r.labelAs, verifiedAt: now },
      })
    )
  }
  return saved
}

/**
 * All external ids for a set of records — used to label our entities with the
 * customer's own ids in API responses.
 */
export async function listExternalRefs({ entityType, entityId }, db = prisma) {
  return db.externalRef.findMany({
    where: { entityType, entityId },
    orderBy: { system: 'asc' },
    select: { system: true, value: true, labelAs: true, verifiedAt: true },
  })
}
