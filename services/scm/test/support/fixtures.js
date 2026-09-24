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
export function seedDatabase(path, { products = [] } = {}) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec(DDL)
  db.prepare('INSERT OR IGNORE INTO ScmSchemaVersion (version, appliedAt) VALUES (?, ?)').run(SCHEMA_VERSION, new Date().toISOString())
  const now = new Date().toISOString()
  for (const p of products) {
    db.prepare(`INSERT INTO Product (id, code, tenantId, businessId, productMasterId, name, unit, stockPolicy, trackingMode, safetyStock, status, itemKind, createdAt, updatedAt, version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(p.id, p.code, p.tenantId ?? TENANT, p.businessId ?? BIZ, `pm-${p.id}`, p.name ?? p.code, p.unit ?? 'EA', p.stockPolicy ?? 'TRACKED', p.trackingMode ?? 'NONE', p.safetyStock ?? 0, p.status ?? 'ACTIVE', 'RAW_COMPONENT', now, now)
  }
  db.close()
}

export const PRODUCTS = {
  plain: { id: 'prod-plain', code: 'SYN-PLAIN' },
  lot: { id: 'prod-lot', code: 'SYN-LOT', trackingMode: 'LOT' },
  serial: { id: 'prod-serial', code: 'SYN-SERIAL', trackingMode: 'SERIAL' },
  untracked: { id: 'prod-untracked', code: 'SYN-UNTRACKED', stockPolicy: 'UNTRACKED' },
  service: { id: 'prod-service', code: 'SYN-SERVICE', stockPolicy: 'SERVICE' },
  archived: { id: 'prod-archived', code: 'SYN-ARCHIVED', status: 'ARCHIVED' },
  otherBiz: { id: 'prod-other-biz', code: 'SYN-OTHER', businessId: OTHER_BIZ },
}

const FULL = { owner: false, domains: ['procurement', 'inventory'], permissions: ['procurement.po.write', 'procurement.receipt.post', 'inventory.catalog.write'] }
export const ROLES = {
  buyer: { owner: false, domains: ['procurement', 'inventory'], permissions: ['procurement.po.write'] },
  receiverFull: FULL,
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
