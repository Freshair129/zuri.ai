-- @req FR-047, FR-051, FR-052 - verify the approved 74-row projection under runtime RLS.
-- @spec SDD-025, SDD-026, SEC-009, SEC-010 - exact scope, public-only and price-disabled.
-- @tested supabase/tests/business_knowledge_import_verification.sql

begin;
grant zuri_line_smartgift_login to postgres;
set local role zuri_line_smartgift_login;
set local role zuri_line_smartgift_ro;

select
  count(*) = 74 as exact_row_count,
  count(distinct product_code) = 74 as exact_product_count,
  bool_and(
    tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
    and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
    and bootstrap_batch_id = '948076f9-6a0a-43f3-88f5-d7225345ac8a'
  ) as exact_scope_and_batch,
  bool_and(sensitivity = 'PUBLIC' and is_active) as public_and_active_only,
  bool_and(sell_price is null and currency is null) as price_publication_disabled,
  (
    select count(*) = 0
    from zuri_core.business_knowledge
    where tenant_id <> '77cdbe70-3111-4a04-922a-8059be99a8b0'
       or business_id <> '834fa869-62f3-431c-a287-e9a95e91175b'
  ) as cross_scope_rows_hidden
from zuri_core.business_knowledge;

rollback;
