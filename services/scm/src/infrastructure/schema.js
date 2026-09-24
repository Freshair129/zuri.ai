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

export const OWNERS = Object.freeze({
  inventory: ['Product', 'ProductLot', 'SerialUnit', 'StockMovement', 'InventoryLedgerFence', 'WarehouseLocation'],
  procurement: ['Supplier', 'PurchaseOrder', 'PurchaseOrderLine', 'GoodsReceipt', 'GoodsReceiptLine'],
  commerce: ['SalesOrder', 'SalesOrderLine', 'Payment', 'BusinessBillingProfile'],
  scm: ['ScmOperationReceipt', 'ScmAuditEvent', 'ScmOutbox', 'ScmSchemaVersion'],
})

// v2 (S5.4 POS checkout): WarehouseLocation, SalesOrder(+Line), Payment,
// BusinessBillingProfile; Product.maintenanceIntervalDays, ProductLot.lastMaintainedAt.
// Disposable stores only — there is no v1→v2 migration (the migration owner writes one).
export const SCHEMA_VERSION = 2

export const DDL = `
CREATE TABLE IF NOT EXISTS ScmSchemaVersion (version INTEGER NOT NULL PRIMARY KEY, appliedAt TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS Product (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, tenantId TEXT NOT NULL, businessId TEXT NOT NULL,
  productMasterId TEXT NOT NULL, name TEXT, unit TEXT NOT NULL DEFAULT 'EA',
  stockPolicy TEXT NOT NULL DEFAULT 'TRACKED', trackingMode TEXT NOT NULL DEFAULT 'NONE',
  safetyStock INTEGER NOT NULL DEFAULT 10, status TEXT NOT NULL DEFAULT 'ACTIVE',
  itemKind TEXT NOT NULL DEFAULT 'RAW_COMPONENT', dedicatedCustomerId TEXT, dedicatedSalesOrderId TEXT,
  maintenanceIntervalDays INTEGER, maxStorageDays INTEGER, reorderPoint INTEGER,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenantId, code)
);
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
-- Append-only ledger: the store refuses UPDATE and DELETE outright (ADR-054 D3).
CREATE TRIGGER IF NOT EXISTS StockMovement_no_update BEFORE UPDATE ON StockMovement
  BEGIN SELECT RAISE(ABORT, 'INVENTORY_LEDGER_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS StockMovement_no_delete BEFORE DELETE ON StockMovement
  BEGIN SELECT RAISE(ABORT, 'INVENTORY_LEDGER_APPEND_ONLY'); END;

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
-- A receipt is never edited or deleted (FR-165): corrections are Inventory ADJUSTMENTs.
CREATE TRIGGER IF NOT EXISTS GoodsReceipt_immutable BEFORE UPDATE ON GoodsReceipt
  BEGIN SELECT RAISE(ABORT, 'GOODS_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS GoodsReceiptLine_immutable BEFORE UPDATE ON GoodsReceiptLine
  BEGIN SELECT RAISE(ABORT, 'GOODS_RECEIPT_IMMUTABLE'); END;

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
  tenantId TEXT, businessId TEXT, requestId TEXT
);

-- Transactional outbox: written with the effect; delivery to the core audit view is a
-- separate, idempotent relay (not implemented in this tranche — rows stay undelivered).
CREATE TABLE IF NOT EXISTS ScmOutbox (
  id TEXT PRIMARY KEY, topic TEXT NOT NULL, aggregateType TEXT NOT NULL, aggregateId TEXT NOT NULL,
  aggregateVersion INTEGER, payloadJson TEXT NOT NULL, createdAt TEXT NOT NULL, deliveredAt TEXT
);
`
