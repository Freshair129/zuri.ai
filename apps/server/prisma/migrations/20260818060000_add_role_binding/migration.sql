-- FR-076 / ADR-033: generic Business-scoped RBAC role binding.
-- Product Owner is represented by roleKey = PRODUCT_OWNER; no owner-specific table exists.
CREATE TABLE "RoleBinding" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "personId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "roleKey" TEXT NOT NULL,
  "scopeType" TEXT NOT NULL DEFAULT 'BUSINESS',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "assignedBy" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  CONSTRAINT "RoleBinding_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RoleBinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RoleBinding_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RoleBinding_personId_businessId_roleKey_key"
  ON "RoleBinding"("personId", "businessId", "roleKey");
CREATE INDEX "RoleBinding_tenantId_businessId_status_idx"
  ON "RoleBinding"("tenantId", "businessId", "status");
CREATE INDEX "RoleBinding_personId_status_idx"
  ON "RoleBinding"("personId", "status");
CREATE INDEX "RoleBinding_roleKey_status_idx"
  ON "RoleBinding"("roleKey", "status");
