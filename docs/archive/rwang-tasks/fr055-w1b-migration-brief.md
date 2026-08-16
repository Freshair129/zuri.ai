# FR-055 W1B brief — operator role and activation event migration

Own only one migration created with `npx supabase@2.114.0 migration new controlled_line_activation`,
`tests/unit/controlled-line-activation-migration.test.js`, and this lane report.

Use TDD RED→GREEN. Add a NOLOGIN operator privilege role plus NOINHERIT/NOBYPASSRLS login, exact
SmartGift-binding SELECT/UPDATE policies, column-limited grants, and an append-only
`zuri_core.line_activation_event` table with exact Tenant/Business/Binding ancestry, correlation
idempotency, receipt-state constraints and SHA-256 fields. Revoke public/anon/authenticated/
service_role/runtime access. Do not add SECURITY DEFINER, public API, raw secret columns or apply
the migration remotely. Preserve the existing migration and binding status enum. Annotate
`@req FR-055`, `@spec NFR-013, SDD-028, SEC-012`, `@tested` truthfully. Write report to
`docs/.rwang-tasks/fr055-w1b-migration-report.md`. Do not commit.
