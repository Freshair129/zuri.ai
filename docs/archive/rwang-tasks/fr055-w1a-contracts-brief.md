# FR-055 W1A brief — activation and receipt contracts

Own only `contracts/phase1-activation/line-activation-input.schema.json`,
`contracts/phase1-activation/line-rollback-input.schema.json`,
`contracts/phase1-activation/line-canary-receipt.schema.json`,
`src/modules/agent/line-activation-contract.js`,
`tests/unit/line-activation-contract.test.js`, and this lane report.

Use TDD RED→GREEN. Contracts are strict, versioned and redacted. Activation input contains exact
scope, binding/version/PENDING/null-hash expectations, evidence hashes, provider/model, approval
window, expiry and correlation ID. Rollback input carries the same authority but requires the exact
ACTIVE/hash-present expectation and no activation secret material. Neither accepts destination, bearer, pepper, authorization, reply token,
message content or PII. Receipt is append-only/idempotent and distinguishes
`GENERATED`, `EVIDENCE_VERIFIED`, `ACCEPTED_BY_LINE`, `DISPLAYED_UNKNOWN`, `READ_UNKNOWN`.
Do not implement DB mutation, CLI, LINE transport, remote calls or secrets. Annotate
`@req FR-055`, `@spec BR-014, SDD-028, SEC-012`, `@tested` truthfully. Write report to
`docs/.rwang-tasks/fr055-w1a-contracts-report.md`. Do not commit.

Authority-completeness follow-up: activation and rollback pin binding code
`LINE-SMARTGIFT-OA` and channel provider `LINE`; model `providerId` remains separate. RFC3339
offsets must validate consistently through Zod and Draft 2020-12. Rollback execution requires a
current approval window evaluated against an injected deterministic time in tests.
