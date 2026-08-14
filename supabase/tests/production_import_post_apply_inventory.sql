-- @req FR-051, FR-052
-- @spec SEC-010, SDD-026
-- @tested supabase/tests/business_knowledge_import_verification.sql

select
  (select count(*) from zuri_core.business_knowledge) = 74
    as exact_row_count,
  (select count(distinct product_code) from zuri_core.business_knowledge) = 74
    as exact_product_count,
  not exists (
    select 1
    from zuri_core.business_knowledge
    where tenant_id <> '77cdbe70-3111-4a04-922a-8059be99a8b0'
       or business_id <> '834fa869-62f3-431c-a287-e9a95e91175b'
       or bootstrap_batch_id <> '948076f9-6a0a-43f3-88f5-d7225345ac8a'
  ) as exact_scope_and_batch,
  not exists (
    select 1
    from zuri_core.business_knowledge
    where not is_active or sensitivity <> 'PUBLIC'
  ) as public_and_active_only,
  not exists (
    select 1
    from zuri_core.business_knowledge
    where sell_price is not null or currency is not null
  ) as price_publication_disabled,
  exists (
    select 1
    from zuri_core.bootstrap_audit_event
    where id = 'fcab484c-425e-5bd7-9cc3-384c681caf22'
      and code = 'KNOWLEDGE-834fa869-63a2d5426838a2fe'
      and tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
      and operation = 'BUSINESS_KNOWLEDGE_IMPORT'
      and artifact_sha256 = '63a2d5426838a2fe6e11eb14c370377f28c494e62c6f160d228dc619cf862c5a'
      and row_count = 74
      and correlation_id = '948076f9-6a0a-43f3-88f5-d7225345ac8a'
  ) as exact_import_audit_event,
  exists (
    select 1
    from zuri_core.line_channel_binding
    where id = '84ed2c90-ab44-46f3-9618-1f24df0744b9'
      and code = 'LINE-SMARTGIFT-OA'
      and tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
      and status = 'PENDING'
      and external_channel_id_hash is null
      and credential_hash is null
  ) as binding_still_pending_without_credentials;
