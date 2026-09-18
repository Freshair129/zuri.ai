-- @req FR-173, FR-187 — structured catalog FileAssets use a private JSON-only
-- bucket, separate from evidence storage, before they enter the same admission queue.
-- @spec TASK-ZAI-050, ADR-075
-- @tested tests/unit/knowledge-catalog-storage-contract.test.js
-- Additive and idempotent. The service-role storage adapter is the only object
-- writer; no public object policy is created here.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'knowledge-catalog',
  'knowledge-catalog',
  false,
  16777216,
  ARRAY['application/json']::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = 16777216,
    allowed_mime_types = ARRAY['application/json']::text[];

COMMIT;
