import { randomUUID } from 'node:crypto'

// Commerce-owned pricing persistence (PricingRuleSet, PricingCalculation). The
// only SQL over these tables; the service decides, this adapter reads and writes.

export const ruleById = (sql, id) => sql.get('SELECT * FROM PricingRuleSet WHERE id = ?', id) ?? null

export const rulesOfBusiness = (sql, tenantId, businessId) =>
  sql.all('SELECT * FROM PricingRuleSet WHERE tenantId = ? AND businessId = ? ORDER BY createdAt DESC, id DESC', tenantId, businessId)

/**
 * The latest APPROVED-at-some-point rule whose effective date has arrived —
 * revoked and expired ones included, on purpose: the caller then refuses an
 * unusable latest policy instead of silently falling back to an older one.
 */
export const latestEffectiveRule = (sql, tenantId, businessId, now) =>
  sql.get(
    'SELECT * FROM PricingRuleSet WHERE tenantId = ? AND businessId = ? AND approvedAt IS NOT NULL AND effectiveFrom IS NOT NULL AND effectiveFrom <= ? ORDER BY effectiveFrom DESC, approvedAt DESC, id DESC LIMIT 1',
    tenantId, businessId, now,
  ) ?? null

export function insertRule(sql, r) {
  const id = randomUUID()
  sql.run(
    'INSERT INTO PricingRuleSet (id, tenantId, businessId, name, status, rulesJson, rulesHash, sourceRuleSetId, createdByPersonId, createdAt, updatedAt, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)',
    id, r.tenantId, r.businessId, r.name, 'DRAFT', r.rulesJson, r.rulesHash, r.sourceRuleSetId ?? null, r.createdByPersonId ?? null, r.now, r.now,
  )
  return id
}

const RULE_CHANGE_COLUMNS = new Set(['name', 'rulesJson', 'rulesHash', 'status', 'approvedAt', 'approvedByPersonId', 'effectiveFrom', 'expiresAt', 'approvalReason', 'revokedAt', 'revokedByPersonId', 'revocationReason'])

/** Compare-and-swap on (id, version, status): 1 when this writer won, 0 otherwise. */
export function casUpdateRule(sql, { id, version, status, change, now }) {
  const keys = Object.keys(change)
  for (const k of keys) if (!RULE_CHANGE_COLUMNS.has(k)) throw new Error(`pricing rule column ${k} is not updatable`)
  const sets = keys.map((k) => `${k} = ?`).join(', ')
  return Number(sql.run(
    `UPDATE PricingRuleSet SET ${sets}, version = version + 1, updatedAt = ? WHERE id = ? AND version = ? AND status = ?`,
    ...keys.map((k) => change[k]), now, id, version, status,
  ).changes)
}

export const calculationByKey = (sql, businessId, idempotencyKey) =>
  sql.get('SELECT * FROM PricingCalculation WHERE businessId = ? AND idempotencyKey = ?', businessId, idempotencyKey) ?? null

export const calculationById = (sql, id) => sql.get('SELECT * FROM PricingCalculation WHERE id = ?', id) ?? null

export function insertCalculation(sql, c) {
  const id = randomUUID()
  sql.run(
    'INSERT INTO PricingCalculation (id, tenantId, businessId, ruleSetId, ruleVersion, rulesHash, rulesJson, evaluatorVersion, inputHash, inputJson, resultJson, inputProvenance, requestHash, idempotencyKey, createdByPersonId, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, c.tenantId, c.businessId, c.ruleSetId, c.ruleVersion, c.rulesHash, c.rulesJson, c.evaluatorVersion, c.inputHash, c.inputJson, c.resultJson, 'USER_ENTERED', c.requestHash, c.idempotencyKey, c.createdByPersonId ?? null, c.now,
  )
  return id
}
