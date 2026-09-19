-- @req FR-224 — "RateLimitBucket": fixed-window counters behind the product's first
-- rate limit — credential writes and validations per Person and Business, and LINE
-- validation calls per installation (design migration 8).
-- @spec ADR-089 D4; ADR-058 (no Redis); ADR-057
-- @tested tests/unit/identity/rate-limit-bucket-migration.test.js
--
-- A row is a key built from internal ids (never a secret, an IP address or a LINE
-- id), the start of its current window and a count. Rows are ephemeral: the table
-- is excluded from backup export, and a lost row only resets one window.
--
-- Additive and idempotent. NOT APPLIED by the change that writes it — an
-- owner-instructed operator step (ADR-057).

BEGIN;

CREATE TABLE IF NOT EXISTS "RateLimitBucket" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "RateLimitBucket_key_key" ON "RateLimitBucket"("key");

ALTER TABLE "RateLimitBucket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RateLimitBucket" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'RateLimitBucket' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "RateLimitBucket" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "RateLimitBucket" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "RateLimitBucket" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "RateLimitBucket" IS 'FR-224 — fixed-window rate-limit counters (ADR-089 D4): key built from internal ids, window start, count. Ephemeral; excluded from backup export.';

COMMIT;
