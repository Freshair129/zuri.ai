import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { DDL, SCHEMA_VERSION } from '../../src/infrastructure/schema.js'
import { signDelegation } from '../../src/infrastructure/delegation.js'

// Synthetic, disposable fixtures only: invented tenants, SKUs and people. Never
// a copy of the primary database, never a real supplier price.

export const TEST_KEY = 'scm-test-delegation-key-synthetic-000000000000'
export const TENANT = 'tenant-synthetic-a'
export const OTHER_TENANT = 'tenant-synthetic-b'
export const BIZ = 'biz-synthetic-a1'
export const OTHER_BIZ = 'biz-synthetic-a2'

export function tempDbPath(label = 'scm') {
  const dir = mkdtempSync(join(tmpdir(), `zuri-s5-${label}-`))
  return { path: join(dir, 'scm.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Create schema + seed Inventory catalogue rows directly (catalogue writers are not in this slice). */
export function seedDatabase(path, { products = [], locations = [], billingProfiles = [], lots = [], stock = [] } = {}) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec(DDL)
  db.prepare('INSERT OR IGNORE INTO ScmSchemaVersion (version, appliedAt) VALUES (?, ?)').run(SCHEMA_VERSION, new Date().toISOString())
  const now = new Date().toISOString()
  for (const p of products) {
    db.prepare(`INSERT INTO Product (id, code, tenantId, businessId, productMasterId, name, unit, stockPolicy, trackingMode, safetyStock, status, itemKind, dedicatedCustomerId, dedicatedSalesOrderId, maxStorageDays, createdAt, updatedAt, version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(p.id, p.code, p.tenantId ?? TENANT, p.businessId ?? BIZ, `pm-${p.id}`, p.name ?? p.code, p.unit ?? 'EA', p.stockPolicy ?? 'TRACKED', p.trackingMode ?? 'NONE', p.safetyStock ?? 0, p.status ?? 'ACTIVE', 'RAW_COMPONENT', p.dedicatedCustomerId ?? null, p.dedicatedSalesOrderId ?? null, p.maxStorageDays ?? null, now, now)
  }
  for (const l of locations) {
    db.prepare('INSERT INTO WarehouseLocation (id, code, tenantId, businessId, name, type, isVirtual, status, createdAt, updatedAt, version) VALUES (?,?,?,?,?,?,?,?,?,?,1)')
      .run(l.id, l.code, l.tenantId ?? TENANT, l.businessId ?? BIZ, l.name ?? l.code, l.type ?? 'TH_FINISHED_GOODS', l.isVirtual ? 1 : 0, l.status ?? 'ACTIVE', now, now)
  }
  for (const b of billingProfiles) {
    db.prepare('INSERT INTO BusinessBillingProfile (id, tenantId, businessId, promptPayProvider, promptPayTargetType, promptPayTarget, promptPayActive, promptPayVerifiedAt, active, createdAt, updatedAt, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)')
      .run(`bbp-${b.businessId}`, b.tenantId ?? TENANT, b.businessId, b.promptPayProvider ?? 'PROMPTPAY', b.promptPayTargetType ?? 'MOBILE', b.promptPayTarget ?? '0812345678', b.promptPayActive === false ? 0 : 1, b.promptPayVerifiedAt ?? '2026-01-02T00:00:00.000Z', b.active === false ? 0 : 1, now, now)
  }
  for (const l of lots) {
    db.prepare("INSERT INTO ProductLot (id, code, tenantId, businessId, productId, manufacturedAt, expiresAt, receivedQty, status, createdAt, updatedAt, version) VALUES (?,?,?,?,?,?,?,0,?,?,?,1)")
      .run(l.id, l.code, l.tenantId ?? TENANT, l.businessId ?? BIZ, l.productId, l.manufacturedAt ?? null, l.expiresAt ?? null, l.status ?? 'OPEN', l.createdAt ?? now, now)
  }
  // Synthetic opening balances (ledger rows, reference OPENING:FIXTURE).
  for (const [i, m] of stock.entries()) {
    db.prepare("INSERT INTO StockMovement (id, tenantId, businessId, productId, lotId, kind, quantity, reference, occurredAt, createdAt) VALUES (?,?,?,?,?,'RECEIPT',?,'OPENING:FIXTURE',?,?)")
      .run(`opening-${i}`, m.tenantId ?? TENANT, m.businessId ?? BIZ, m.productId, m.lotId ?? null, m.quantity, now, now)
  }
  db.close()
}

export const LOCATIONS = {
  shop: { id: 'loc-shop', code: 'LOC-SHOP' },
  virtual: { id: 'loc-virtual', code: 'LOC-VIRTUAL', isVirtual: true },
  foreign: { id: 'loc-foreign', code: 'LOC-FOREIGN', businessId: OTHER_BIZ },
}

/** Facts the core (Branch), CRM (Customer) and Files (slip) owners would return. */
export const REFERENCE_FIXTURE = {
  branches: [
    { id: 'branch-main', code: 'BR-MAIN', name: 'Synthetic Main Branch', tenantId: TENANT, businessId: BIZ, status: 'ACTIVE' },
    { id: 'branch-closed', code: 'BR-CLOSED', name: 'Closed Branch', tenantId: TENANT, businessId: BIZ, status: 'INACTIVE' },
    { id: 'branch-foreign', code: 'BR-FOREIGN', name: 'Other Business Branch', tenantId: TENANT, businessId: OTHER_BIZ, status: 'ACTIVE' },
  ],
  customers: [
    { id: 'cust-own', code: 'CUS-OWN', displayName: 'Synthetic Buyer', tenantId: TENANT, businessId: BIZ, deletedAt: null },
    { id: 'cust-shared', code: 'CUS-SHARED', tenantId: TENANT, businessId: null, deletedAt: null },
    { id: 'cust-deleted', code: 'CUS-DEL', tenantId: TENANT, businessId: BIZ, deletedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'cust-foreign', code: 'CUS-FOREIGN', tenantId: TENANT, businessId: OTHER_BIZ, deletedAt: null },
  ],
  fileAssets: [
    { id: 'slip-own', tenantId: TENANT, businessId: BIZ, deletedAt: null },
    { id: 'slip-deleted', tenantId: TENANT, businessId: BIZ, deletedAt: '2026-01-01T00:00:00.000Z' },
  ],
}

export const PRODUCTS = {
  plain: { id: 'prod-plain', code: 'SYN-PLAIN' },
  lot: { id: 'prod-lot', code: 'SYN-LOT', trackingMode: 'LOT' },
  serial: { id: 'prod-serial', code: 'SYN-SERIAL', trackingMode: 'SERIAL' },
  untracked: { id: 'prod-untracked', code: 'SYN-UNTRACKED', stockPolicy: 'UNTRACKED' },
  service: { id: 'prod-service', code: 'SYN-SERVICE', stockPolicy: 'SERVICE' },
  archived: { id: 'prod-archived', code: 'SYN-ARCHIVED', status: 'ARCHIVED' },
  aged: { id: 'prod-aged', code: 'SYN-AGED', trackingMode: 'LOT', maxStorageDays: 30 },
  dedicated: { id: 'prod-dedicated', code: 'SYN-DEDICATED', dedicatedSalesOrderId: 'so-someone-else' },
  dedicatedCustomer: { id: 'prod-dedicated-cust', code: 'SYN-DED-CUST', dedicatedCustomerId: 'cust-shared' },
  otherBiz: { id: 'prod-other-biz', code: 'SYN-OTHER', businessId: OTHER_BIZ },
}

const FULL = { owner: false, domains: ['procurement', 'inventory'], permissions: ['procurement.po.write', 'procurement.receipt.post', 'inventory.catalog.write'] }
export const ROLES = {
  buyer: { owner: false, domains: ['procurement', 'inventory'], permissions: ['procurement.po.write'] },
  receiverFull: FULL,
  cashier: { owner: false, domains: ['commerce', 'inventory'], permissions: ['commerce.order.write', 'inventory.catalog.write'] },
  salesRepOnly: { owner: false, domains: ['commerce', 'inventory'], permissions: ['commerce.order.write'] },
  commerceViewer: { owner: false, domains: ['commerce', 'inventory'], permissions: [] },
  receiverNoInventory: { owner: false, domains: ['procurement', 'inventory'], permissions: ['procurement.receipt.post'] },
  receiverNoInventoryDomain: { owner: false, domains: ['procurement'], permissions: ['procurement.receipt.post', 'inventory.catalog.write'] },
  inventoryOnly: { owner: false, domains: ['inventory'], permissions: ['inventory.catalog.write'] },
  owner: { owner: true, domains: ['procurement', 'inventory'], permissions: [] },
}

/** A synthetic core issuer: signs what a resolved viewer would hold. */
export function delegation({ sub = 'person-buyer', tenantId = TENANT, grants = { [BIZ]: ROLES.receiverFull }, lifetime = 60, iat = Math.floor(Date.now() / 1000), key = TEST_KEY, iss = 'zuri-core' } = {}) {
  return signDelegation({ v: 1, iss, aud: 'zuri-scm', sub, tenantId, iat, exp: iat + lifetime, jti: randomUUID(), grants }, key)
}

export const idem = (label) => `${label}-${randomUUID()}`
