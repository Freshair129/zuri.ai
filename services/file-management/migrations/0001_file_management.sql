-- @spec ADR-107 - service-owned file metadata and operation schema.
CREATE SCHEMA IF NOT EXISTS zuri_files;

CREATE TABLE IF NOT EXISTS zuri_files.file_record (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'WITHDRAWN')),
  current_version_id uuid,
  created_by uuid NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  UNIQUE (tenant_id, business_id, id)
);

CREATE TABLE IF NOT EXISTS zuri_files.file_version (
  id uuid PRIMARY KEY,
  file_id uuid NOT NULL REFERENCES zuri_files.file_record(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  file_name text NOT NULL,
  declared_content_type text NOT NULL,
  detected_content_type text,
  safety_state text NOT NULL CHECK (safety_state IN ('UNSCANNED', 'SAFE', 'BLOCKED', 'UNKNOWN')),
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  storage_provider text NOT NULL CHECK (storage_provider = 'S3_COMPATIBLE'),
  storage_binding_id text NOT NULL,
  storage_bucket text NOT NULL,
  storage_key text NOT NULL,
  storage_version_id text NOT NULL CHECK (storage_version_id <> '' AND storage_version_id <> 'null'),
  provenance_json jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (file_id, version_number),
  UNIQUE (storage_key, storage_version_id)
);

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_record_current_version_fk' AND conrelid = 'zuri_files.file_record'::regclass) THEN
    ALTER TABLE zuri_files.file_record
      ADD CONSTRAINT file_record_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES zuri_files.file_version(id) ON DELETE RESTRICT;
  END IF;
END;
$migration$;

CREATE TABLE IF NOT EXISTS zuri_files.file_operation (
  id uuid PRIMARY KEY,
  correlation_id uuid NOT NULL,
  file_id uuid NOT NULL,
  version_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN ('CREATE', 'APPEND')),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_sha256 char(64) NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  storage_provider text NOT NULL CHECK (storage_provider = 'S3_COMPATIBLE'),
  storage_binding_id text NOT NULL,
  storage_bucket text NOT NULL,
  file_name text NOT NULL,
  declared_content_type text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  provenance_json jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'COMMITTED', 'FAILED')),
  result_json jsonb,
  safe_error_code text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (tenant_id, business_id, actor_id, operation_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS file_record_scope_updated_idx ON zuri_files.file_record (tenant_id, business_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS file_version_history_idx ON zuri_files.file_version (file_id, version_number DESC);
CREATE INDEX IF NOT EXISTS file_operation_reconcile_idx ON zuri_files.file_operation (status, created_at) WHERE status <> 'COMMITTED';

CREATE TABLE IF NOT EXISTS zuri_files.file_outbox_event (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES zuri_files.file_operation(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL,
  file_id uuid NOT NULL REFERENCES zuri_files.file_record(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES zuri_files.file_version(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('FILE_VERSION_READY')),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS file_outbox_pending_idx ON zuri_files.file_outbox_event (created_at, id) WHERE event_type = 'FILE_VERSION_READY';

CREATE TABLE IF NOT EXISTS zuri_files.file_audit_event (
  id uuid PRIMARY KEY,
  file_id uuid NOT NULL REFERENCES zuri_files.file_record(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL UNIQUE REFERENCES zuri_files.file_operation(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('FILE_VERSION_STORED')),
  event_json jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS file_audit_history_idx ON zuri_files.file_audit_event (file_id, created_at DESC, id);
