-- FR-122 — a Profile states who the person is, not just what to call them.
-- Apply after 0002_phase1_line_primary_connection.sql.
--
-- Additive and nullable, so this is safe to apply to a live database with no
-- backfill and no lock beyond the catalogue update: Postgres adds a nullable
-- column without rewriting the table.
--
-- Nullable is a constraint, not a preference. Person rows already exist that can
-- never satisfy these columns — the seed, FR-107's operator bootstrap, and every
-- Person FR-023's LINE ingest creates on first contact from a `lineUserId`,
-- which has a channel subject and nothing else. A NOT NULL would make that
-- intake path unwritable. The requirement is enforced at FR-066's profile
-- boundary instead, the only place a person states these things themselves.
--
-- `IF NOT EXISTS` so re-application is a no-op: this file is applied by hand
-- against Supabase and recorded in `supabase_migrations.schema_migrations`.
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "lastName" TEXT;
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "phone" TEXT;
