-- @req FR-023 — Customer.code is unique within its owning Tenant.
-- @spec BR-001, BR-002, SEC-001, ADR-121 D1-D4 — Tenant is the isolation boundary;
-- a human code is not a cross-tenant identifier.
-- @tested tests/unit/application-schema-migration.test.js
--
-- Customer.tenantId is required, and a globally unique code is already unique
-- within every Tenant. This weaker constraint needs no backfill and rewrites no
-- existing code. This file is written only; applying it is an owner-only step
-- under ADR-057.

DROP INDEX "Customer_code_key";
CREATE UNIQUE INDEX "Customer_tenantId_code_key" ON "Customer"("tenantId", "code");
