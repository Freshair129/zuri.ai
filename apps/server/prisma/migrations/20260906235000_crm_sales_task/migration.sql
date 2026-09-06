-- @req FR-161 — SalesTask, a sales follow-up owed to a customer (crm). Twin of
-- supabase/migrations/20260906235000_crm_sales_task.sql.
-- @spec ADR-064; BR-001; BR-002; SEC-001
-- Additive: one new table, its indexes and foreign keys; nothing existing changes.

-- CreateTable
CREATE TABLE "SalesTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "conversationId" TEXT,
    "assigneePersonId" TEXT,
    "createdByPersonId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'FOLLOW_UP',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "scheduleKind" TEXT NOT NULL DEFAULT 'SINGLE',
    "dueDate" DATETIME NOT NULL,
    "startDate" DATETIME,
    "timeStart" TEXT,
    "timeEnd" TEXT,
    "outcome" TEXT,
    "completedAt" DATETIME,
    "completedByPersonId" TEXT,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "SalesTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesTask_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesTask_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalesTask_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalesTask_assigneePersonId_fkey" FOREIGN KEY ("assigneePersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesTask_tenantId_code_key" ON "SalesTask"("tenantId", "code");
CREATE INDEX "SalesTask_businessId_status_dueDate_idx" ON "SalesTask"("businessId", "status", "dueDate");
CREATE INDEX "SalesTask_assigneePersonId_status_idx" ON "SalesTask"("assigneePersonId", "status");
CREATE INDEX "SalesTask_customerId_idx" ON "SalesTask"("customerId");
CREATE INDEX "SalesTask_conversationId_idx" ON "SalesTask"("conversationId");
