-- D8 (ADR-122) Customer.code per-Tenant migration: PRE-check. READ ONLY.
--
-- Run BEFORE applying 20261125120000_customer_code_tenant_scope.sql, first on
-- a scratch database restored from a real backup, then on production:
--   psql "<connection>" -v ON_ERROR_STOP=1 -f d8-customer-code-precheck.sql
--
-- Nothing here writes. It runs inside a READ ONLY transaction so a typo
-- cannot change data. Do not paste connection strings into chat.
-- Write down the "snapshot" row; the post-check must print the same values.

BEGIN READ ONLY;

\echo
\echo '== 1. Indexes (expect exactly one row: Customer_code_key)'
SELECT indexname
FROM pg_indexes
WHERE tablename = 'Customer'
  AND indexname IN ('Customer_code_key', 'Customer_tenantId_code_key');

\echo
\echo '== 2. Customers with NULL tenantId (expect 0)'
SELECT count(*) AS null_tenant_rows FROM "Customer" WHERE "tenantId" IS NULL;

\echo
\echo '== 3. Duplicate (tenantId, code) pairs (expect no rows)'
SELECT "tenantId", "code", count(*) AS n
FROM "Customer"
GROUP BY 1, 2
HAVING count(*) > 1;

\echo
\echo '== 4. Size, for the lock estimate (the index build blocks writes)'
SELECT count(*) AS rows,
       pg_size_pretty(pg_total_relation_size('"Customer"')) AS total_size
FROM "Customer";

\echo
\echo '== 5. Snapshot to compare with the post-check (record both values)'
SELECT count(*) AS rows,
       md5(string_agg(id || code || "tenantId", ',' ORDER BY id)) AS snapshot_md5
FROM "Customer";

\echo
\echo '== 6. Codes shared by more than one Tenant today (expect no rows; a hit'
\echo '      means the global constraint is not what ADR-122 assumed)'
SELECT "code", count(DISTINCT "tenantId") AS tenants
FROM "Customer"
GROUP BY 1
HAVING count(DISTINCT "tenantId") > 1;

ROLLBACK;

\echo
\echo 'PRE-CHECK PASS only if: 1 row in section 1, 0 in section 2, no rows in'
\echo 'sections 3 and 6. Otherwise STOP and do not apply the migration.'
