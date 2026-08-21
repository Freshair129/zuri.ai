-- Production security hardening for the server-owned application schema.
-- The application server owns these tables; browser/Data API roles do not.
-- This is intentionally idempotent so it can repair an already-provisioned
-- project without changing row contents.

BEGIN;

DO $$
DECLARE
  table_record record;
BEGIN
  FOR table_record IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      table_record.schema_name,
      table_record.table_name
    );
    EXECUTE format(
      'REVOKE ALL ON TABLE %I.%I FROM PUBLIC, anon, authenticated',
      table_record.schema_name,
      table_record.table_name
    );
  END LOOP;
END $$;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Keep future application tables private by default for the migration owner.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

COMMIT;
