-- @req FR-226 — "ChannelAccountClaim": one LINE bot, identified by the SHA-256 of its
-- destination, bound to at most one live connection across the installation
-- (design migration 2).
-- @spec ADR-089 D6; BR-002; ADR-057
-- @tested tests/unit/integration/channel-account-claim-migration.test.js
--
-- Uniqueness. Prisma declares @@unique([provider, externalAccountHash]); production
-- holds it only among live claims, with a partial unique index on
-- "releasedAt" IS NULL, so a released claim (an operator-mediated takeover, a later
-- requirement) never blocks the next owner. The raw destination is never stored.
--
-- Backfill. Every LINE_OA connection that already names a destination and a
-- Business gets a claim, one per destination: when two connections share a
-- destination today (IntegrationConnection is unique per Tenant only), the ACTIVE
-- one and then the oldest wins, and the migration reports how many were left
-- unclaimed so an operator can reconcile them. Nothing is deleted or changed on
-- the connections themselves.
--
-- Additive and idempotent. NOT APPLIED by the change that writes it — an
-- owner-instructed operator step (ADR-057): dry run in a rolled-back transaction,
-- read the NOTICE, apply, record the version.

BEGIN;

CREATE TABLE IF NOT EXISTS "ChannelAccountClaim" (
  "id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "externalAccountHash" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "releasedAt" TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelAccountClaim_connectionId_key"
  ON "ChannelAccountClaim"("connectionId");
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelAccountClaim_provider_externalAccountHash_key"
  ON "ChannelAccountClaim"("provider", "externalAccountHash")
  WHERE "releasedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "ChannelAccountClaim_tenantId_businessId_idx"
  ON "ChannelAccountClaim"("tenantId", "businessId");

INSERT INTO "ChannelAccountClaim" ("id", "provider", "externalAccountHash", "tenantId", "businessId", "connectionId", "claimedAt")
SELECT DISTINCT ON (candidate."hash")
  gen_random_uuid()::text, 'LINE_OA', candidate."hash", candidate."tenantId", candidate."businessId", candidate."id", candidate."createdAt"
FROM (
  SELECT c."id", c."tenantId", c."businessId", c."status", c."createdAt",
         encode(sha256(convert_to(c."externalAccountId", 'UTF8')), 'hex') AS "hash"
  FROM "IntegrationConnection" c
  JOIN "IntegrationProvider" p ON p."id" = c."providerId"
  WHERE p."code" = 'LINE_OA'
    AND c."externalAccountId" IS NOT NULL
    AND c."businessId" IS NOT NULL
) candidate
WHERE NOT EXISTS (SELECT 1 FROM "ChannelAccountClaim" x WHERE x."connectionId" = candidate."id")
ORDER BY candidate."hash", (candidate."status" = 'ACTIVE') DESC, candidate."createdAt", candidate."id"
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  v_unclaimed integer;
BEGIN
  SELECT count(*) INTO v_unclaimed
  FROM "IntegrationConnection" c
  JOIN "IntegrationProvider" p ON p."id" = c."providerId"
  WHERE p."code" = 'LINE_OA' AND c."externalAccountId" IS NOT NULL AND c."businessId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "ChannelAccountClaim" x WHERE x."connectionId" = c."id");
  RAISE NOTICE 'CHANNEL_ACCOUNT_CLAIM_BACKFILL: % LINE_OA connection(s) share a destination already claimed and were left unclaimed', v_unclaimed;
END $$;

ALTER TABLE "ChannelAccountClaim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChannelAccountClaim" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ChannelAccountClaim' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "ChannelAccountClaim" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "ChannelAccountClaim" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ChannelAccountClaim" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "ChannelAccountClaim" IS 'FR-226 — one live claim per external bot across the installation (ADR-089 D6), keyed by sha256(destination); unique among rows with releasedAt IS NULL. Taken before any secret is stored.';

COMMIT;
