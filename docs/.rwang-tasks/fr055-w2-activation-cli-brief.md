# FR-055 W2 brief — activation and rollback operator CLI

Own only `src/modules/agent/line-binding-activation.js`,
`scripts/manage-line-binding.mjs`, `tests/unit/line-binding-activation.test.js`,
`tests/unit/line-binding-activation-cli.test.js`, and
`docs/.rwang-tasks/fr055-w2-activation-cli-report.md`.

Read ADR-020, FR-055/NFR-013/BR-014/SDD-028/SEC-012, the W1A schemas/parser and the W1B
migration before editing. Use strict TDD RED→GREEN.

Implement an injected PostgreSQL operator service plus a dry-run-default CLI. Activation and
rollback inputs must pass the W1A parsers. The CLI accepts only non-secret artifact paths/options;
database URL, destination, bearer and pepper come from process environment. Reject any database
username except `zuri_line_activation_login`, and never print a URL or secret. Recompute the three
evidence-file SHA-256 values immediately before the database transaction and compare them to the
contract.

Inside one transaction use `SET LOCAL ROLE zuri_line_activation_operator`, correlation replay
inspection, exact project/Tenant/Business/binding/code/channel/version/status/hash expectations,
`SELECT ... FOR UPDATE`, a versioned single-row update and append-only event insert. Activation
uses existing `hashBindingSecret`, installs only HMAC hashes and performs PENDING→ACTIVE.
Rollback is routing-first ACTIVE→INACTIVE, preserves hashes/data and appends its event. Every
mismatch, duplicate correlation or query failure rolls back. Because the event contract does not
persist a canonical request hash, every replay fails closed rather than claiming byte identity.
DRY_RUN verifies evidence and the locked row but always rolls back, has no durable event and returns
a clearly named preview rather than a persisted receipt.

The row lock itself has no stale transaction-time predicate. After the lock, DRY_RUN obtains a
fresh database wall clock and validates the approval/expiry bounds before rollback. APPLY uses a
one-row `clock_timestamp()` CTE in the versioned UPDATE, repeats the approval and activation-expiry
predicates atomically, and derives `valid_from`, `updated_at` and receipt `occurredAt` from that
returned database timestamp.

Do not add a browser/API/webhook/agent-tool entry point. Do not call LINE, use remote Supabase,
read real secrets, edit package files, stage or commit. Annotate `@req FR-055`,
`@spec NFR-013, BR-014, SDD-028, SEC-012`, and `@tested` truthfully.
