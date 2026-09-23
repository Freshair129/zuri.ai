-- @req FR-069, FR-094, FR-095 — private PM execution and IAM tables remain
--   usable by the server runtime while forced RLS denies every other role.
-- @spec ADR-104, ADR-102, ADR-045, SEC-001, SEC-018
-- @tested tests/unit/production-migration-reconciliation.test.js
--
-- The PM execution-trace migration enabled and forced RLS but did not create a
-- policy or runtime grants. The P2 MFA and Passkey migrations are older
-- additive migrations with the same missing security block. This follow-up is
-- idempotent and runs after those tables exist; it never writes the migration
-- ledger.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'MfaFactor',
    'PasskeyCredential',
    'ProjectExecutionRun',
    'ProjectExecutionStep'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'PRECONDITION: public.% table is missing before RLS hardening', table_name;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
        AND policyname = 'zuri_app_runtime_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY zuri_app_runtime_all ON public.%I FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)',
        table_name
      );
    END IF;

    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM public, anon, authenticated, service_role',
      table_name
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO zuri_app_runtime, zuri_web_login',
      table_name
    );
  END LOOP;
END $$;

COMMIT;
