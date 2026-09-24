-- @spec ADR-107 - restricted runtime role grants; migration role stays separate.
-- Run as the database owner after creating the two service roles.
-- Provision credentials outside the repository. The migrator owns DDL; the runtime has no DDL or purge grants.
REVOKE ALL ON ALL TABLES IN SCHEMA zuri_files FROM PUBLIC;
REVOKE ALL ON SCHEMA zuri_files FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA zuri_files FROM zuri_file_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA zuri_files FROM zuri_file_runtime;

GRANT USAGE ON SCHEMA zuri_files TO zuri_file_runtime;

GRANT SELECT ON zuri_files.file_record TO zuri_file_runtime;
GRANT INSERT (id, tenant_id, business_id, status, created_by, created_at, updated_at)
  ON zuri_files.file_record TO zuri_file_runtime;
GRANT UPDATE (current_version_id, updated_at, row_version)
  ON zuri_files.file_record TO zuri_file_runtime;

GRANT SELECT, INSERT ON zuri_files.file_version TO zuri_file_runtime;
GRANT SELECT, INSERT ON zuri_files.file_outbox_event TO zuri_file_runtime;

GRANT SELECT ON zuri_files.file_operation TO zuri_file_runtime;
GRANT INSERT (id, correlation_id, file_id, version_id, tenant_id, business_id, actor_id, operation_type,
  idempotency_key, request_sha256, storage_provider, storage_binding_id, storage_bucket, file_name, declared_content_type, byte_length, sha256,
  provenance_json, status, created_at)
  ON zuri_files.file_operation TO zuri_file_runtime;
GRANT UPDATE (status, result_json, safe_error_code, completed_at)
  ON zuri_files.file_operation TO zuri_file_runtime;

GRANT SELECT, INSERT ON zuri_files.file_audit_event TO zuri_file_runtime;
