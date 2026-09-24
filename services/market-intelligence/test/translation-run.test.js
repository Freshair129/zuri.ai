import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MARKET_TRANSLATION_RUN_DEFAULT_LIMIT,
  extractGenericMarketCandidate,
  parseMarketTranslationRunInput,
  runMarketTranslationForBusiness,
} from '../src/index.js'
import {
  BUSINESS_A,
  BUSINESS_B,
  TENANT_T,
  createAudit,
  createObservationTable,
  createRawEvidence,
  createScopeAuthority,
  rawRecord,
} from './fakes.js'

const owner = { sees: [BUSINESS_A], owns: [BUSINESS_A] }

function deps(overrides = {}) {
  const table = overrides.table ?? createObservationTable()
  return {
    table,
    scopeAuthority: createScopeAuthority(),
    rawEvidence: createRawEvidence(overrides.records ?? []),
    openObservationStore: table.open,
    audit: createAudit(),
    extractCandidate: extractGenericMarketCandidate,
    now: () => new Date('2026-09-24T00:00:00Z'),
    ...overrides,
  }
}

test('translates the backlog, then a replay changes nothing', async () => {
  const d = deps({ records: [rawRecord({ id: 'r1' }), rawRecord({ id: 'r2' })] })
  assert.deepEqual(await runMarketTranslationForBusiness({ actor: owner, businessId: BUSINESS_A }, d), { translated: 2, unchanged: 0, failed: [] })
  assert.equal(d.table.rows.size, 2)
  assert.deepEqual(await runMarketTranslationForBusiness({ actor: owner, businessId: BUSINESS_A }, d), { translated: 0, unchanged: 0, failed: [] })
  assert.equal(d.table.rows.size, 2)
})

test('translation writes need ownership; every refusal is the same 404 and nothing is read', async () => {
  const d = deps({ records: [rawRecord()] })
  for (const actor of [{ sees: [BUSINESS_A] }, { sees: [BUSINESS_A], owns: [BUSINESS_A], marketHidden: [BUSINESS_A] }]) {
    await assert.rejects(runMarketTranslationForBusiness({ actor, businessId: BUSINESS_A }, d), { status: 404, message: 'Business not found' })
  }
  await assert.rejects(runMarketTranslationForBusiness({ actor: owner, businessId: 'nope' }, d), { status: 404, message: 'Business not found' })
  assert.equal(d.rawEvidence.calls.length, 0)
  assert.equal(d.audit.events.length, 0)
})

test('the raw read is scoped by authority and bounded', async () => {
  const d = deps()
  await runMarketTranslationForBusiness({ actor: owner, businessId: BUSINESS_A, limit: 7 }, d)
  assert.deepEqual(d.rawEvidence.calls, [{ tenantId: TENANT_T, businessId: BUSINESS_A, scanLimit: 35 }])
})

test('per-record failures do not abort the batch', async () => {
  const d = deps({ records: [rawRecord({ id: 'bad', payloadJson: '{x' }), rawRecord({ id: 'good' })] })
  const result = await runMarketTranslationForBusiness({ actor: owner, businessId: BUSINESS_A }, d)
  assert.equal(result.translated, 1)
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0].rawRecordId, 'bad')
  assert.match(result.failed[0].reason, /invalid JSON/)
})

test('raw evidence from another Business or lane is refused, not translated', async () => {
  const leaky = {
    calls: [],
    async listMarketCandidates() {
      return [
        rawRecord({ id: 'leak-b', businessId: BUSINESS_B }),
        rawRecord({ id: 'leak-lane', lane: 'COMMERCE' }),
        rawRecord({ id: 'ok' }),
      ]
    },
  }
  const d = deps({ rawEvidence: leaky })
  const result = await runMarketTranslationForBusiness({ actor: owner, businessId: BUSINESS_A }, d)
  assert.equal(result.translated, 1)
  assert.deepEqual(result.failed, [
    { rawRecordId: 'leak-b', reason: 'RAW_EVIDENCE_SCOPE_MISMATCH' },
    { rawRecordId: 'leak-lane', reason: 'RAW_EVIDENCE_SCOPE_MISMATCH' },
  ])
  assert.deepEqual([...d.table.rows.values()].map((row) => row.rawRecordId), ['ok'])
})

test('one audit event per run with counts only, never payloads', async () => {
  const d = deps({ records: [rawRecord({ id: 'r1', payloadJson: JSON.stringify({ title: 'secret-title' }) })] })
  await runMarketTranslationForBusiness({ actor: owner, businessId: BUSINESS_A }, d)
  assert.equal(d.audit.events.length, 1)
  assert.deepEqual(d.audit.events[0], {
    entityType: 'MARKET_OBSERVATION',
    entityId: BUSINESS_A,
    action: 'MARKET_TRANSLATION_RUN',
    payload: { businessId: BUSINESS_A, candidates: 1, eligible: 1, translated: 1, unchanged: 0, failed: 0 },
  })
  assert.doesNotMatch(JSON.stringify(d.audit.events), /secret-title/)
})

test('an audit failure surfaces after the writes, as the legacy route does', async () => {
  const d = deps({ records: [rawRecord()], audit: createAudit({ fail: true }) })
  await assert.rejects(runMarketTranslationForBusiness({ actor: owner, businessId: BUSINESS_A }, d), /audit unavailable/)
  // Observations committed before the audit append stay committed; a retry is a no-op
  // translation because lineage makes it idempotent. Durable audit is an M4 item.
  assert.equal(d.table.rows.size, 1)
})

test('concurrent runs over the same backlog create each observation once', async () => {
  const table = createObservationTable()
  const records = [rawRecord({ id: 'r1' }), rawRecord({ id: 'r2' }), rawRecord({ id: 'r3' })]
  const results = await Promise.all([1, 2, 3].map(() =>
    runMarketTranslationForBusiness({ actor: owner, businessId: BUSINESS_A }, deps({ table, records }))))
  assert.equal(table.rows.size, 3)
  assert.equal(results.reduce((sum, r) => sum + r.translated, 0), 3)
})

test('input parsing keeps the legacy default and maximum', () => {
  assert.deepEqual(parseMarketTranslationRunInput({ businessId: 'b' }), { businessId: 'b', limit: MARKET_TRANSLATION_RUN_DEFAULT_LIMIT })
  assert.equal(parseMarketTranslationRunInput({ businessId: 'b', limit: 1000 }).limit, 100)
  assert.throws(() => parseMarketTranslationRunInput({ businessId: 'b', viewer: {} }))
})

test('required ports are checked before any authority call', async () => {
  await assert.rejects(runMarketTranslationForBusiness({ actor: owner, businessId: BUSINESS_A }, { ...deps(), audit: undefined }), /AuditPort.record/)
  await assert.rejects(runMarketTranslationForBusiness({ actor: owner, businessId: BUSINESS_A }, { ...deps(), extractCandidate: undefined }), /extractCandidate/)
})
