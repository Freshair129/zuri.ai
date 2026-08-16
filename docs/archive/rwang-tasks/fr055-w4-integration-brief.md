# FR-055 W4 brief — composed PostgreSQL and public-surface verification

Own only `src/modules/agent/index.js`, `src/modules/agent/line-operator.js`, `package.json`,
`tests/unit/activation-readiness-integration.test.js`,
`tests/integration/line-binding-activation.postgres.test.js`, and
`docs/.rwang-tasks/fr055-w4-integration-report.md`.

Read ADR-020, FR-055 AC-055-01..09, W1A/W1B/W2/W3 reports and all delivered code first. Use
strict TDD RED→GREEN. Preserve root-owned exact Ajv dependencies already present in package files.

Expose the approved contract/service/adapter through a dedicated operator module; the generic agent
index must not expose mutation capability. Add only the direct operator script alias needed for
local invocation. Add a tracked, env-gated composed PostgreSQL 17
test. It must hard-reject any non-loopback host or database name other than `zuri_fr055_test`, apply
the existing bootstrap plus FR-055 migration in that disposable database, provision only a random
test password in process memory, connect as `zuri_line_activation_login`, and run the real W2
service against actual roles/RLS/constraints.

Prove: exact activation with HMAC hashes/event/version; duplicate correlation zero mutation;
post-lock expired approval/expiry zero mutation; insert failure rolls the binding update back;
routing-first rollback preserves hashes/data; wrong scope/login/role denied; and all test changes
are rolled back or removed. Use immutable exact bytes for the three evidence artifacts throughout
each call. Run W1A-W3 focused compatibility. Do not contact Supabase remote or LINE, read real
secrets, edit generated governance files, stage or commit. Remove every temp Docker container,
config and artifact. Annotate `@req FR-055`, `@spec NFR-013, BR-014, SDD-028, SEC-012`, and
`@tested` truthfully. Report every PASS/SKIP/NOT_RUN exactly.
