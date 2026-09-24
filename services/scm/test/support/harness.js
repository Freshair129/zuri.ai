import { createDelegationVerifier } from '../../src/infrastructure/delegation.js'
import { createCommandBus } from '../../src/application/commands.js'
import { createFixtureReferenceAuthority } from '../../src/infrastructure/reference-authority.js'
import { BIZ, PRODUCTS, REFERENCE_FIXTURE, TEST_KEY, delegation, idem, openTestStore, seedDatabase, tempDbPath } from './fixtures.js'

// In-process component harness: REAL store (SQLite file), REAL use cases, REAL
// delegation verification — only the core issuer is synthetic.
export function createHarness({ faults, clock, products = Object.values(PRODUCTS), seed = {}, references = createFixtureReferenceAuthority(REFERENCE_FIXTURE) } = {}) {
  const db = tempDbPath('component')
  seedDatabase(db, { products, ...seed })
  let store = openTestStore(db)
  const verify = createDelegationVerifier({ key: TEST_KEY })
  let bus = createCommandBus({ store, faults, references, clock })
  const as = (options) => verify(delegation(options))
  const h = {
    db, get store() { return store }, get bus() { return bus }, as,
    run: (scope, action, input) => bus.run(scope, action, { idempotencyKey: idem(action), ...input }),
    async reopen() { await store.close(); store = openTestStore(db); bus = createCommandBus({ store, faults, references, clock }) },
    count: (table) => store.read((sql) => sql.get(`SELECT COUNT(*) AS n FROM ${table}`).n),
    snapshot: () => store.read((sql) => Object.fromEntries(['GoodsReceipt', 'GoodsReceiptLine', 'StockMovement', 'ProductLot', 'SerialUnit', 'SalesOrder', 'SalesOrderLine', 'Payment', 'ScmAuditEvent', 'ScmOutbox', 'ScmOperationReceipt'].map((t) => [t, sql.get(`SELECT COUNT(*) AS n FROM ${t}`).n]).concat([
      ['fence', sql.get('SELECT COALESCE(MAX(mutationRevision), -1) AS r FROM InventoryLedgerFence').r],
      ['poVersions', sql.all('SELECT id, version, status FROM PurchaseOrder ORDER BY id')],
    ]))),
    async close() { await store.close(); db.cleanup() },
    /** Supplier + SENT purchase order with the given lines, created through the real commands. */
    async sentOrder(lines, { buyer = as({ sub: 'person-buyer' }) } = {}) {
      const { supplier } = await h.run(buyer, 'procurement.supplier.create', { body: { businessId: BIZ, code: `SUP-${Math.random().toString(36).slice(2, 8)}`, name: 'Synthetic Supplier Co.' } })
      const { order } = await h.run(buyer, 'procurement.purchase-order.create', { body: { businessId: BIZ, supplierId: supplier.id, lines } })
      const sent = await h.run(buyer, 'procurement.purchase-order.action', { targetId: order.id, body: { action: 'SEND', version: order.version } })
      return sent.order
    },
  }
  return h
}

export async function rejects(promise, { status, code }) {
  try { await promise } catch (error) {
    if (status !== undefined && error.status !== status) throw new Error(`expected status ${status}, got ${error.status} (${error.code}: ${error.message})`)
    if (code !== undefined && error.code !== code) throw new Error(`expected code ${code}, got ${error.code}`)
    return error
  }
  throw new Error(`expected rejection ${code ?? status}`)
}
