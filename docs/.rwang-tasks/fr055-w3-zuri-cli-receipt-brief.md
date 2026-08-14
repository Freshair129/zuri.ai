# FR-055 W3 brief — redacted zuri-cli transport adapter

Own only `contracts/phase1-activation/zuri-cli-transport-artifact.schema.json`,
`src/modules/agent/zuri-cli-canary-receipt.js`,
`tests/unit/zuri-cli-canary-receipt.test.js`, and
`docs/.rwang-tasks/fr055-w3-zuri-cli-receipt-report.md`.

Read ADR-020, FR-055/NFR-013/BR-014/SDD-028/SEC-012 and the W1A receipt contract before editing.
Use strict TDD RED→GREEN.

Define a strict versioned adapter contract for a redacted artifact produced by the external
`zuri-cli` transport owner. It may contain only correlation/scope/version identifiers, pinned
source/config/evidence hashes, occurred-at timestamps and a bounded HTTP acceptance observation.
It must never accept destination, authorization, bearer, reply token, message text/body, headers,
customer identifiers or free-form payload fields. The adapter recomputes the artifact file SHA-256
and emits a W1A-valid `CANARY_TRANSPORT` receipt: GENERATED when LINE acceptance is absent, or
ACCEPTED_BY_LINE only for HTTP 2xx. Display/read remain explicit UNKNOWN and are never inferred.

This lane validates/transforms local redacted evidence only. It has no database mutation, network,
LINE send, signature verification or secret access. Do not edit package files, stage or commit.
Annotate `@req FR-055`, `@spec BR-014, SDD-028, SEC-012`, and `@tested` truthfully.
