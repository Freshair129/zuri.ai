// The Payment compare-and-swap: a second writer moves the payment's version
// between this verify's version check and its update (the PostgreSQL-shaped
// interleaving SQLite's writer lock never produces on its own). The verify must be
// refused 409 PAYMENT_VERSION_CONFLICT and leave nothing — no status change, no
// audit, no outbox, no receipt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createCommandBus } from '../../src/application/commands.js'
import { createFixtureReferenceAuthority } from '../../src/infrastructure/reference-authority.js'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, REFERENCE_FIXTURE, TENANT, idem, openTestStore } from '../support/fixtures.js'

test('a Payment version change between check and update is refused and rolled back', async () => {
  const h = createHarness()
  const orderId = randomUUID()
  const now = new Date().toISOString()
  await h.store.transaction((sql) => sql.run("INSERT INTO SalesOrder (id, code, tenantId, businessId, origin, status, currency, discountSatang, orderedAt, createdAt, updatedAt, version) VALUES (?,?,?,?,'WALK_IN','CONFIRMED','THB',0,?,?,?,1)", orderId, 'ORD-CAS-1', TENANT, BIZ, now, now, now))
  const rep = h.as({ sub: 'per-rep', grants: { [BIZ]: { owner: false, domains: ['commerce'], permissions: ['commerce.order.write'] } } })
  const verifier = h.as({ sub: 'per-ver', grants: { [BIZ]: { owner: false, domains: ['commerce'], permissions: ['commerce.payment.verify'] } } })
  const { payment } = await h.run(rep, 'commerce.payment.record', { targetId: orderId, body: { method: 'CASH', amount: 10 } })
  const before = await h.snapshot()
  await h.store.close()

  const store = openTestStore(h.db)
  let current = null
  const transaction = store.transaction
  store.transaction = (fn) => transaction((sql) => { current = sql; return fn(sql) })
  let interleave = true
  const bus = createCommandBus({ store, references: createFixtureReferenceAuthority(REFERENCE_FIXTURE), faults: { 'commerce.payment.action': { beforePaymentUpdate: () => {
    if (interleave) current.run('UPDATE Payment SET version = version + 1 WHERE id = ?', payment.id)
  } } } })
  try {
    await rejects(bus.run(verifier, 'commerce.payment.action', { idempotencyKey: idem('cas'), targetId: payment.id, body: { action: 'VERIFY', version: 1 } }), { status: 409, code: 'PAYMENT_VERSION_CONFLICT' })
    const after = await store.read((sql) => ({
      row: { ...sql.get('SELECT status, version, verifiedAt FROM Payment WHERE id = ?', payment.id) },
      audit: sql.get('SELECT COUNT(*) AS n FROM ScmAuditEvent').n,
      outbox: sql.get('SELECT COUNT(*) AS n FROM ScmOutbox').n,
      receipts: sql.get('SELECT COUNT(*) AS n FROM ScmOperationReceipt').n,
    }))
    assert.deepEqual(after, { row: { status: 'PENDING', version: 1, verifiedAt: null }, audit: before.ScmAuditEvent, outbox: before.ScmOutbox, receipts: before.ScmOperationReceipt })
    interleave = false
    assert.equal((await bus.run(verifier, 'commerce.payment.action', { idempotencyKey: idem('cas-retry'), targetId: payment.id, body: { action: 'VERIFY', version: 1 } })).payment.status, 'VERIFIED')
  } finally {
    await store.close()
    h.db.cleanup()
  }
})
