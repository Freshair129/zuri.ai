-- D8 (ADR-122) Customer.code per-Tenant migration: POST-check. READ ONLY.
--
-- Run AFTER applying 20261125120000_customer_code_tenant_scope.sql, on the
-- same database you ran the pre-check on:
--   psql "<connection>" -v ON_ERROR_STOP=1 -f d8-customer-code-postcheck.sql
--
-- Nothing here writes. It does not insert test rows, because the Customer
-- table has required columns this script cannot know. The uniqueness
-- behaviour is proved from the index definition instead. Create one customer
-- through LINE in a test Tenant afterwards for the live check.

BEGIN READ ONLY;

\echo
\echo '== 1. Indexes (expect exactly one row: Customer_tenantId_code_key)'
SELECT indexname
FROM pg_indexes
WHERE tablename = 'Customer'
  AND indexname IN ('Customer_code_key', 'Customer_tenantId_code_key');

\echo
\echo '== 2. New index is UNIQUE, valid, ready, on ("tenantId", "code") in that order'
SELECT i.indisunique AS is_unique,
       i.indisvalid  AS is_valid,
       i.indisready  AS is_ready,
       pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname = 'Customer_tenantId_code_key';

\echo
\echo '== 3. Any other unique index or constraint still on code alone (expect no rows)'
SELECT c.relname AS index_name, pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE i.indrelid = '"Customer"'::regclass
  AND i.indisunique
  AND pg_get_indexdef(i.indexrelid) ~ '\("code"\)';

\echo
\echo '== 4. Snapshot (must equal the pre-check values: no row was rewritten)'
SELECT count(*) AS rows,
       md5(string_agg(id || code || "tenantId", ',' ORDER BY id)) AS snapshot_md5
FROM "Customer";

\echo
\echo '== 5. NULL tenantId rows (expect 0; NULL would escape the composite key)'
SELECT count(*) AS null_tenant_rows FROM "Customer" WHERE "tenantId" IS NULL;

ROLLBACK;

\echo
\echo 'POST-CHECK PASS only if: 1 row in section 1 (the new index), section 2 shows'
\echo 'true/true/true with ("tenantId", code), no rows in section 3, snapshot equals'
\echo 'the pre-check, 0 in section 5. Then watch logs for P2002 on Customer for 1 hour.'
