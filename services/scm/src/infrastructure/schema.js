// SCM-owned persistence (service-local, disposable in this tranche).
//
// Column names are the Prisma field names of apps/server/prisma/schema.prisma so
// a rehearsal transfer maps 1:1 and ids never change (internal UUIDs stay the
// keys; human codes stay unique per Tenant). Only the models the vertical slice
// executes are here; each table keeps its LOGICAL owner, recorded in OWNERS and
// enforced by test/unit/module-boundaries.test.js (a module's adapter may only
// write its own tables).
//
// Foreign masters (Tenant, Business, Customer, Person, Project, FileAsset…) are
// NOT copied: their ids are opaque references verified by the caller's
// delegated scope (ReferenceAuthority), never joined here.

import { toPostgres } from './sql-dialect.js'

export const OWNERS = Object.freeze({
  inventory: ['Product', 'ProductLot', 'SerialUnit', 'StockMovement', 'InventoryLedgerFence', 'WarehouseLocation', 'ProductIdentifier'],
  procurement: ['Supplier', 'PurchaseOrder', 'PurchaseOrderLine', 'GoodsReceipt', 'GoodsReceiptLine', 'SupplierCostSheet', 'SupplierCostLine'],
  commerce: ['SalesOrder', 'SalesOrderLine', 'Payment', 'BusinessBillingProfile', 'PricingRuleSet', 'PricingCalculation'],
  scm: ['ScmOperationReceipt', 'ScmAuditEvent', 'ScmOutbox', 'ScmSchemaVersion'],
})

// v2 (S5.4 POS checkout): WarehouseLocation, SalesOrder(+Line), Payment,
// BusinessBillingProfile; Product.maintenanceIntervalDays, ProductLot.lastMaintainedAt.
// v3 (S5.4 pricing rules): PricingRuleSet, PricingCalculation; ScmAuditEvent gains
// the reason / beforeJson / afterJson columns of core AuditEvent.
// v4 (S5.4 supplier cost sheets): SupplierCostSheet, SupplierCostLine; Product carton
// facts (unitsPerCarton, cartonCbm, cartonKg, freightGoodsType, leadTimeDays);
// ProductIdentifier (Inventory-owned; read for SKU matching, its writers have not moved).
// Disposable stores only — there is no v1→…→v4 migration (the migration owner writes one).
export const SCHEMA_VERSION = 4

const TABLES = `
CREATE TABLE IF NOT EXISTS ScmSchemaVersion (version INTEGER NOT NULL PRIMARY KEY, appliedAt TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS Product (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, tenantId TEXT NOT NULL, businessId TEXT NOT NULL,
  productMasterId TEXT NOT NULL, name TEXT, unit TEXT NOT NULL DEFAULT 'EA',
  stockPolicy TEXT NOT NULL DEFAULT 'TRACKED', trackingMode TEXT NOT NULL DEFAULT 'NONE',
  safetyStock INTEGER NOT NULL DEFAULT 10, status TEXT NOT NULL DEFAULT 'ACTIVE',
  itemKind TEXT NOT NULL DEFAULT 'RAW_COMPONENT', dedicatedCustomerId TEXT, dedicatedSalesOrderId TEXT,
  maintenanceIntervalDays INTEGER, maxStorageDays INTEGER, reorderPoint INTEGER,
  unitsPerCarton INTEGER, cartonCbm REAL, cartonKg REAL, freightGoodsType TEXT, leadTimeDays INTEGER,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenantId, code)
);

-- Scannable / legacy codes of a SKU (ADR-083 D3). Read here by the cost-sheet SKU
-- matcher; the identifier writers (inventory-identity-service) have not moved.
CREATE TABLE IF NOT EXISTS ProductIdentifier (
  id TEXT PRIMARY KEY, tenantId TEXT NOT NULL, businessId TEXT NOT NULL,
  productId TEXT NOT NULL REFERENCES Product(id), kind TEXT NOT NULL, value TEXT NOT NULL,
  issuer TEXT, unit TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE',
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenantId, kind, value)
);
CREATE INDEX IF NOT EXISTS ProductIdentifier_business ON ProductIdentifier (businessId, value);
CREATE INDEX IF NOT EXISTS Product_business ON Product (businessId, status);

CREATE TABLE IF NOT EXISTS ProductLot (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, tenantId TEXT NOT NULL, businessId TEXT NOT NULL,
  productId TEXT NOT NULL REFERENCES Product(id), manufacturedAt TEXT, expiresAt TEXT,
  receivedQty INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'OPEN', lastMaintainedAt TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (productId, code)
);

CREATE TABLE IF NOT EXISTS SerialUnit (
  id TEXT PRIMARY KEY, serialNo TEXT NOT NULL, tenantId TEXT NOT NULL, businessId TEXT NOT NULL,
  productId TEXT NOT NULL REFERENCES Product(id), lotId TEXT REFERENCES ProductLot(id),
  status TEXT NOT NULL DEFAULT 'IN_STOCK', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (productId, serialNo)
);

CREATE TABLE IF NOT EXISTS StockMovement (
  id TEXT PRIMARY KEY, tenantId TEXT NOT NULL, businessId TEXT NOT NULL,
  productId TEXT NOT NULL REFERENCES Product(id), lotId TEXT REFERENCES ProductLot(id), serialUnitId TEXT REFERENCES SerialUnit(id),
  kind TEXT NOT NULL, quantity INTEGER NOT NULL, reason TEXT, reference TEXT, actorId TEXT,
  occurredAt TEXT NOT NULL, createdAt TEXT NOT NULL,
  sourceLocationId TEXT, targetLocationId TEXT, costSatang INTEGER,
  customerId TEXT, salesOrderId TEXT, workOrderId TEXT
);
CREATE INDEX IF NOT EXISTS StockMovement_product ON StockMovement (productId, occurredAt);

CREATE TABLE IF NOT EXISTS InventoryLedgerFence (
  id TEXT PRIMARY KEY, tenantId TEXT NOT NULL, businessId TEXT NOT NULL,
  mutationRevision INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  UNIQUE (tenantId, businessId)
);

CREATE TABLE IF NOT EXISTS Supplier (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, tenantId TEXT NOT NULL, businessId TEXT NOT NULL,
  name TEXT NOT NULL, taxId TEXT, contactName TEXT, phone TEXT, email TEXT, address TEXT,
  paymentTerms TEXT, leadTimeDays INTEGER, notes TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE',
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenantId, code)
);

CREATE TABLE IF NOT EXISTS PurchaseOrder (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, tenantId TEXT NOT NULL, businessId TEXT NOT NULL,
  supplierId TEXT NOT NULL REFERENCES Supplier(id), status TEXT NOT NULL DEFAULT 'DRAFT',
  currency TEXT NOT NULL DEFAULT 'THB', expectedAt TEXT, notes TEXT, orderedAt TEXT NOT NULL,
  sentAt TEXT, receivedAt TEXT, closedAt TEXT, closeReason TEXT, cancelledAt TEXT, cancelReason TEXT,
  createdByPersonId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenantId, code)
);

CREATE TABLE IF NOT EXISTS PurchaseOrderLine (
  id TEXT PRIMARY KEY, purchaseOrderId TEXT NOT NULL REFERENCES PurchaseOrder(id),
  productId TEXT REFERENCES Product(id), description TEXT NOT NULL, qty INTEGER NOT NULL,
  unitCostSatang INTEGER NOT NULL, sortOrder INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS PurchaseOrderLine_order ON PurchaseOrderLine (purchaseOrderId);

CREATE TABLE IF NOT EXISTS GoodsReceipt (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, tenantId TEXT NOT NULL, businessId TEXT NOT NULL,
  purchaseOrderId TEXT NOT NULL REFERENCES PurchaseOrder(id), supplierReference TEXT, notes TEXT,
  receivedAt TEXT NOT NULL, postedByPersonId TEXT, createdAt TEXT NOT NULL,
  UNIQUE (tenantId, code)
);

CREATE TABLE IF NOT EXISTS GoodsReceiptLine (
  id TEXT PRIMARY KEY, receiptId TEXT NOT NULL REFERENCES GoodsReceipt(id),
  purchaseOrderLineId TEXT NOT NULL REFERENCES PurchaseOrderLine(id), qty INTEGER NOT NULL,
  lotCode TEXT, expiresAt TEXT, serialNosJson TEXT
);
CREATE INDEX IF NOT EXISTS GoodsReceiptLine_orderLine ON GoodsReceiptLine (purchaseOrderLineId);

-- Supplier cost sheets (TASK-ZAI-053). A sheet holds one immutable source version
-- (locked FX + normalized preview) until a person confirms every SKU mapping; lines
-- exist only after commit. At most one CONFIRMED sheet per supplier (see F-12).
CREATE TABLE IF NOT EXISTS SupplierCostSheet (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, tenantId TEXT NOT NULL, businessId TEXT NOT NULL,
  supplierId TEXT NOT NULL REFERENCES Supplier(id), currency TEXT NOT NULL, fxRateLocked REAL NOT NULL,
  sourceRef TEXT, sourceSha256 TEXT NOT NULL, previewHash TEXT NOT NULL, previewJson TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT', lineCount INTEGER NOT NULL DEFAULT 0,
  createdByPersonId TEXT, confirmedByPersonId TEXT, confirmedAt TEXT, supersededAt TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenantId, code),
  UNIQUE (businessId, sourceSha256)
);
CREATE INDEX IF NOT EXISTS SupplierCostSheet_business ON SupplierCostSheet (businessId, status, createdAt);
CREATE UNIQUE INDEX IF NOT EXISTS SupplierCostSheet_one_confirmed ON SupplierCostSheet (businessId, supplierId) WHERE status = 'CONFIRMED';

CREATE TABLE IF NOT EXISTS SupplierCostLine (
  id TEXT PRIMARY KEY, sheetId TEXT NOT NULL REFERENCES SupplierCostSheet(id), productId TEXT NOT NULL REFERENCES Product(id),
  sourceSku TEXT NOT NULL, minQty INTEGER NOT NULL, unitCostForeign REAL NOT NULL,
  unitsPerCarton INTEGER, cartonCbm REAL, cartonKg REAL, freightGoodsType TEXT, leadTimeDays INTEGER,
  mappingConfidence TEXT NOT NULL, mappingConfirmedByPersonId TEXT, mappingConfirmedAt TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  UNIQUE (sheetId, sourceSku, minQty)
);
CREATE INDEX IF NOT EXISTS SupplierCostLine_product ON SupplierCostLine (productId, minQty);

CREATE TABLE IF NOT EXISTS WarehouseLocation (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, tenantId TEXT NOT NULL, businessId TEXT NOT NULL, name TEXT NOT NULL,
  type TEXT NOT NULL, isVirtual INTEGER NOT NULL DEFAULT 0, address TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE',
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenantId, code)
);

-- Commerce. customerId / conversationId / slipFileAssetId are opaque references to
-- CRM and Files owners (verified through ReferenceAuthority, never joined here).
CREATE TABLE IF NOT EXISTS SalesOrder (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, tenantId TEXT NOT NULL, businessId TEXT NOT NULL,
  customerId TEXT, conversationId TEXT, origin TEXT NOT NULL DEFAULT 'WALK_IN', status TEXT NOT NULL DEFAULT 'DRAFT',
  currency TEXT NOT NULL DEFAULT 'THB', discountSatang INTEGER NOT NULL DEFAULT 0, notes TEXT,
  orderedAt TEXT NOT NULL, confirmedAt TEXT, completedAt TEXT, cancelledAt TEXT, cancelReason TEXT, stockIssuedAt TEXT,
  closedByPersonId TEXT, createdByPersonId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenantId, code)
);

CREATE TABLE IF NOT EXISTS SalesOrderLine (
  id TEXT PRIMARY KEY, orderId TEXT NOT NULL REFERENCES SalesOrder(id), productId TEXT REFERENCES Product(id),
  description TEXT NOT NULL, qty INTEGER NOT NULL, unitPriceSatang INTEGER NOT NULL,
  discountSatang INTEGER NOT NULL DEFAULT 0, sortOrder INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS SalesOrderLine_order ON SalesOrderLine (orderId);

CREATE TABLE IF NOT EXISTS Payment (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, tenantId TEXT NOT NULL, businessId TEXT NOT NULL,
  orderId TEXT NOT NULL REFERENCES SalesOrder(id), kind TEXT NOT NULL DEFAULT 'PAYMENT', method TEXT NOT NULL,
  amountSatang INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', bankReference TEXT, slipFileAssetId TEXT, note TEXT,
  paidAt TEXT NOT NULL, verifiedAt TEXT, verifiedByPersonId TEXT, rejectReason TEXT, createdByPersonId TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenantId, code),
  UNIQUE (tenantId, bankReference)
);

-- PromptPay configuration read by POS. Its writer (billing profile update, which also
-- writes Identity-owned LegalEntity/Branch rows) has NOT moved: SHARED_TRANSITION.
CREATE TABLE IF NOT EXISTS BusinessBillingProfile (
  id TEXT PRIMARY KEY, tenantId TEXT NOT NULL, businessId TEXT NOT NULL UNIQUE,
  promptPayProvider TEXT, promptPayTargetType TEXT, promptPayTarget TEXT, promptPayActive INTEGER NOT NULL DEFAULT 0,
  promptPayVerifiedAt TEXT, active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);

-- Pricing (FR-253, ADR-098). Rule content is immutable once it leaves DRAFT and a
-- calculation is an immutable snapshot: both are enforced here as well as in the
-- service, so no future writer can quietly rewrite an approved policy or a price.
CREATE TABLE IF NOT EXISTS PricingRuleSet (
  id TEXT PRIMARY KEY, tenantId TEXT NOT NULL, businessId TEXT NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT', rulesJson TEXT NOT NULL, rulesHash TEXT NOT NULL,
  sourceRuleSetId TEXT REFERENCES PricingRuleSet(id), createdByPersonId TEXT,
  approvedByPersonId TEXT, approvedAt TEXT, effectiveFrom TEXT, expiresAt TEXT, approvalReason TEXT,
  revokedByPersonId TEXT, revokedAt TEXT, revocationReason TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS PricingRuleSet_scope ON PricingRuleSet (tenantId, businessId);
CREATE INDEX IF NOT EXISTS PricingRuleSet_effective ON PricingRuleSet (businessId, effectiveFrom, approvedAt);

CREATE TABLE IF NOT EXISTS PricingCalculation (
  id TEXT PRIMARY KEY, tenantId TEXT NOT NULL, businessId TEXT NOT NULL,
  ruleSetId TEXT NOT NULL REFERENCES PricingRuleSet(id), ruleVersion INTEGER NOT NULL,
  rulesHash TEXT NOT NULL, rulesJson TEXT NOT NULL, evaluatorVersion TEXT NOT NULL,
  inputHash TEXT NOT NULL, inputJson TEXT NOT NULL, resultJson TEXT NOT NULL,
  inputProvenance TEXT NOT NULL DEFAULT 'USER_ENTERED', requestHash TEXT NOT NULL,
  idempotencyKey TEXT NOT NULL, createdByPersonId TEXT, createdAt TEXT NOT NULL,
  UNIQUE (businessId, idempotencyKey)
);
CREATE INDEX IF NOT EXISTS PricingCalculation_ruleSet ON PricingCalculation (ruleSetId);

-- Durable mutation identity: one row per (scope, idempotency key), committed in
-- the SAME transaction as the effect, so "committed" and "has a receipt" are one fact.
CREATE TABLE IF NOT EXISTS ScmOperationReceipt (
  id TEXT PRIMARY KEY, tenantId TEXT NOT NULL, businessId TEXT NOT NULL, action TEXT NOT NULL,
  actorId TEXT NOT NULL, idempotencyKey TEXT NOT NULL, requestHash TEXT NOT NULL,
  targetId TEXT, status TEXT NOT NULL, responseJson TEXT NOT NULL, affectedJson TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  UNIQUE (tenantId, businessId, action, actorId, idempotencyKey)
);

-- Local audit envelope with the columns of core AuditEvent; atomic with the effect.
CREATE TABLE IF NOT EXISTS ScmAuditEvent (
  id TEXT PRIMARY KEY, entityType TEXT NOT NULL, entityId TEXT NOT NULL, action TEXT NOT NULL,
  payloadJson TEXT NOT NULL, actorType TEXT NOT NULL, actorId TEXT, occurredAt TEXT NOT NULL,
  tenantId TEXT, businessId TEXT, requestId TEXT, reason TEXT, beforeJson TEXT, afterJson TEXT
);

-- Transactional outbox: written with the effect; delivery to the core audit view is a
-- separate, idempotent relay (not implemented in this tranche — rows stay undelivered).
CREATE TABLE IF NOT EXISTS ScmOutbox (
  id TEXT PRIMARY KEY, topic TEXT NOT NULL, aggregateType TEXT NOT NULL, aggregateId TEXT NOT NULL,
  aggregateVersion INTEGER, payloadJson TEXT NOT NULL, createdAt TEXT NOT NULL, deliveredAt TEXT
);
`

// Store-level refusals, declared once and emitted per engine. Each fires BEFORE the
// statement and aborts it with the message the services and tests look for.
export const TRIGGERS = Object.freeze([
  // Append-only ledger: the store refuses UPDATE and DELETE outright (ADR-054 D3).
  { name: 'StockMovement_no_update', table: 'StockMovement', event: 'UPDATE', message: 'INVENTORY_LEDGER_APPEND_ONLY' },
  { name: 'StockMovement_no_delete', table: 'StockMovement', event: 'DELETE', message: 'INVENTORY_LEDGER_APPEND_ONLY' },
  // A receipt is never edited (FR-165): corrections are Inventory ADJUSTMENTs.
  { name: 'GoodsReceipt_immutable', table: 'GoodsReceipt', event: 'UPDATE', message: 'GOODS_RECEIPT_IMMUTABLE' },
  { name: 'GoodsReceiptLine_immutable', table: 'GoodsReceiptLine', event: 'UPDATE', message: 'GOODS_RECEIPT_IMMUTABLE' },
  { name: 'SupplierCostSheet_source_immutable', table: 'SupplierCostSheet', event: 'UPDATE', columns: ['currency', 'fxRateLocked', 'sourceSha256', 'previewHash', 'previewJson', 'supplierId', 'businessId', 'tenantId'], message: 'PROCUREMENT_COST_SHEET_SOURCE_IMMUTABLE' },
  { name: 'SupplierCostLine_immutable', table: 'SupplierCostLine', event: 'UPDATE', message: 'PROCUREMENT_COST_LINE_IMMUTABLE' },
  { name: 'PricingRuleSet_content_immutable', table: 'PricingRuleSet', event: 'UPDATE', columns: ['rulesJson', 'rulesHash', 'name', 'tenantId', 'businessId', 'sourceRuleSetId'], when: "OLD.status <> 'DRAFT'", message: 'PRICING_RULE_IMMUTABLE' },
  { name: 'PricingRuleSet_no_delete', table: 'PricingRuleSet', event: 'DELETE', message: 'PRICING_RULE_IMMUTABLE' },
  { name: 'PricingCalculation_no_update', table: 'PricingCalculation', event: 'UPDATE', message: 'PRICING_CALCULATION_IMMUTABLE' },
  { name: 'PricingCalculation_no_delete', table: 'PricingCalculation', event: 'DELETE', message: 'PRICING_CALCULATION_IMMUTABLE' },
])

const sqliteTrigger = (t) => `CREATE TRIGGER IF NOT EXISTS ${t.name} BEFORE ${t.event}${t.columns ? ` OF ${t.columns.join(', ')}` : ''} ON ${t.table}${t.when ? `\n  WHEN ${t.when}` : ''}\n  BEGIN SELECT RAISE(ABORT, '${t.message}'); END;`

const q = (name) => `"${name}"`
const postgresTrigger = (t) => [
  `CREATE OR REPLACE FUNCTION ${q(`scm_refuse_${t.name}`)}() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RAISE EXCEPTION '${t.message}' USING ERRCODE = 'P0001'; END $fn$;`,
  `DROP TRIGGER IF EXISTS ${q(t.name)} ON ${q(t.table)};`,
  `CREATE TRIGGER ${q(t.name)} BEFORE ${t.event}${t.columns ? ` OF ${t.columns.map(q).join(', ')}` : ''} ON ${q(t.table)} FOR EACH ROW${t.when ? ` WHEN (${t.when})` : ''} EXECUTE FUNCTION ${q(`scm_refuse_${t.name}`)}();`,
].join('\n')

/** SQLite DDL (the dev/test engine and the original spelling). */
export const DDL = `${TABLES}\n${TRIGGERS.map(sqliteTrigger).join('\n')}\n`

/**
 * PostgreSQL DDL from the same table text: mixed-case names quoted, REAL widened
 * to DOUBLE PRECISION (REAL is 4-byte there, 8-byte in SQLite), timestamps kept as
 * ISO-8601 TEXT so comparisons and ordering are identical on both engines.
 */
export const POSTGRES_DDL = `${toPostgres(TABLES.replace(/\bREAL\b/g, 'DOUBLE PRECISION')).text}\n${TRIGGERS.map(postgresTrigger).join('\n')}\n`
