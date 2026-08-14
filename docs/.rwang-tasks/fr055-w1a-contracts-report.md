---
version: "0.4.0b"
created_at: "2026-08-14T09:32:00+07:00,ATHER"
last_update: "2026-08-14T09:56:00+07:00,ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "task-report"
  scope: "FR-055 W1A activation and receipt contracts"
---

# FR-055 W1A report — activation and receipt contracts

## Outcome

**PASS for W1A review.** The lane adds strict version `1.0.0` JSON and Zod contracts only. It
does not implement database mutation, a CLI, LINE transport, remote calls or secret handling.

## Contract boundary

- Activation defaults to `DRY_RUN`; `APPLY` must be explicit.
- Exact project/Tenant/Business/binding scope, expected version, literal `PENDING`, absent hash
  expectations, provider/model, three evidence hashes, approval window, binding expiry and
  correlation UUID are required.
- Raw destination, bearer, pepper, authorization, reply token, message content and PII-shaped
  extra fields fail strict parsing and are absent from both JSON Schemas.
- Receipt states remain exactly `GENERATED`, `EVIDENCE_VERIFIED`, `ACCEPTED_BY_LINE`,
  `DISPLAYED_UNKNOWN`, `READ_UNKNOWN`.
- LINE-accepted/display-unknown/read-unknown evidence requires a redacted transport-artifact
  SHA-256 and the bounded `HTTP_2XX` acceptance class. It does not claim display or read.
- Event and correlation UUIDs carry the identity needed for the append-only event store and
  correlation-idempotency lane. Mutation events require exactly one version increment; transport
  events require no binding-version change.

## TDD evidence

| Phase | Command | Result |
|---|---|---|
| RED | `npx vitest run tests/unit/line-activation-contract.test.js` | expected FAIL: module did not exist |
| GREEN | same focused command | PASS: 1 file / 13 tests |
| compatibility | `npx vitest run tests/unit/line-activation-contract.test.js tests/unit/activation-readiness-contract.test.js tests/unit/line-canary-preflight.test.js` | PASS: 3 files / 31 tests |
| diff hygiene | `git diff --check -- <four owned implementation/test paths>` | PASS |

The focused suite covers strict scope/version/evidence parsing, dry-run default, literal pending and
null-hash expectations, invalid approval windows, malformed SHA-256, forbidden fields, truthful
receipt states, LINE acceptance evidence, and event-specific version movement.

## Files produced

- `contracts/phase1-activation/line-activation-input.schema.json`
- `contracts/phase1-activation/line-canary-receipt.schema.json`
- `contracts/phase1-activation/line-rollback-input.schema.json`
- `src/modules/agent/line-activation-contract.js`
- `tests/unit/line-activation-contract.test.js`
- `docs/.rwang-tasks/fr055-w1a-contracts-report.md`

## Review notes

JSON Schema expresses structural constraints and the conditional LINE-acceptance fields. The Zod
parser additionally enforces approval-window ordering and event-specific version movement, which
JSON Schema cannot express portably without non-standard extensions. W2 must parse through the Zod
boundary before any operator action. Database uniqueness and append-only enforcement remain W1B,
not this contract lane.

No files were staged or committed.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Strict redacted activation and receipt contracts with RED→GREEN evidence | working-tree | ATHER |

## Independent review

**Reviewer:** Tesla
**Reviewed at:** 2026-08-14T09:34:23+07:00
**Verdict:** `FAIL` — W1A exit is blocked pending contract strictness and schema/parser parity fixes.

The lane correctly preserves the local-only, non-mutating boundary and no forbidden raw field was
found in the declared contract shapes. However, the current parser accepts impossible production
versions, expired binding windows and receipt event/state combinations that collapse the separate
mutation and transport owners required by SDD-028. The current test only inspects selected JSON
Schema metadata; it does not validate shared fixtures through both JSON Schema and Zod, so parity
is not proven.

| Review area | Result | Finding |
|---|---|---|
| Authority and scope | `PASS` | ADR-020 and FR-055 authorize local contract implementation only; no DB mutation, CLI, transport, remote access or secret handling exists in these files. |
| Versioned strict objects | `PASS` | Both schemas fix `contractVersion: 1.0.0`; Zod and JSON Schema reject unknown properties at the top level and in nested activation objects. |
| Forbidden raw fields | `PASS_WITH_WARNING` | The tested top-level destination/bearer/pepper/authorization/reply-token/content/email fields are rejected by strict parsing and absent from schema properties. Structural strictness cannot prove that an allowed free-text value such as `approvalRef` is PII-free; downstream logging/storage still needs redaction tests. |
| Activation binding version | `FAIL` | JSON Schema uses `minimum: 0`, Zod uses `nonnegative()`, and tests use version `0`; deployed `line_channel_binding.version` is constrained to `version > 0`. The contract therefore accepts a state that cannot exist in production. |
| Approval window ordering | `PASS_ZOD_ONLY` | Zod rejects `notBefore >= expiresAt`; JSON Schema cannot express that cross-field ordering portably. Every non-Zod consumer must implement an equivalent semantic check. |
| Binding expiry semantics | `FAIL` | `bindingExpiresAt` is only checked as a date-time. The parser accepts an expiry in 2020 alongside a 2026 approval window. No rule proves that the binding expiry is future, follows activation/not-before, or satisfies an approved maximum TTL. |
| Receipt version movement | `PASS_ZOD_ONLY` | Zod enforces mutation `+1` and transport `+0`; JSON Schema does not. Shared consumers cannot rely on schema validation alone. Version minima also incorrectly allow `0`. |
| Receipt event/state separation | `FAIL` | Neither schema nor parser constrains `eventType` against `receiptState`; for example `ACTIVATION + ACCEPTED_BY_LINE` and `CANARY_TRANSPORT + EVIDENCE_VERIFIED` parse successfully. This violates SDD-028's separate readiness, mutation and transport owners and can misattribute LINE acceptance. |
| Receipt truth vocabulary | `PASS` | The five approved states are preserved, and LINE-observed states require a transport SHA-256 plus `HTTP_2XX`; no display/read success is claimed. |
| Append-only/idempotent enforcement | `DEFERRED` | Event/correlation IDs are present, but uniqueness, append-only storage and one-correlation ownership cannot be proven by a data parser. W1B/W2 must enforce and integration-test them. The W1A report correctly labels this boundary. |
| JSON Schema/parser parity test | `FAIL` | Tests parse valid/invalid inputs only through Zod. The JSON Schema test checks top-level strictness, version constant and forbidden property names but never validates fixtures with a Draft 2020-12 validator. Nested required/type/conditional drift could pass unnoticed. |
| Model-provider identifier semantics | `WARN` | The fixture uses `providerId: line` with a GPT model, although LINE is transport and the existing model-provider contract allows `openrouter`, `openai`, `anthropic`, `gemini` or `groq`. Either declare provider IDs opaque in authority or test an actual approved model-provider identifier. |
| TDD GREEN evidence | `PASS` | Independent rerun passed 3 files / 31 tests, including 13 W1A tests. |
| TDD RED evidence | `WARN` | The reported initial missing-module failure is plausible but no retained RED output, commit or evidence artifact exists, so the reviewer cannot independently reproduce the transition from the current completed tree. |

### Reproduced counterexamples

A read-only direct parser check against the current module returned both values as `true`:

```json
{
  "acceptsImpossibleBindingVersionAndExpiredBinding": true,
  "acceptsActivationAsLineTransport": true
}
```

The first input used `bindingVersion: 0` and `bindingExpiresAt` in 2020 while its approval window
was in 2026. The second used `eventType: ACTIVATION`, `receiptState: ACCEPTED_BY_LINE`, a transport
artifact hash and `HTTP_2XX`. No file, database or remote state was changed by this check.

### Required fixes before W1A exit

1. Align activation and receipt version minima with the deployed invariant (`>= 1`) and add
   boundary tests; mutation events then move `n -> n + 1`, transport remains `n -> n`.
2. Freeze binding-expiry semantics in authority (future relative to execution/not-before and an
   explicit maximum TTL or approved bound), enforce them in Zod/W2, and add expired/overlong cases.
3. Define and enforce an `eventType`/`receiptState` compatibility matrix so only the transport owner
   can record `ACCEPTED_BY_LINE`, `DISPLAYED_UNKNOWN` or `READ_UNKNOWN`.
4. Add shared valid/invalid fixtures executed through both a Draft 2020-12 JSON Schema validator
   and Zod. Document semantic checks that JSON Schema cannot portably express and require W3 to
   implement equivalent checks rather than treating schema validation as sufficient.
5. Replace or explicitly justify the `providerId: line` fixture so model-provider identity cannot
   be confused with LINE transport identity.
6. Retain a machine-readable RED receipt in future TDD lanes when RED→GREEN provenance is an exit
   claim; the fresh GREEN rerun alone does not prove the historical RED state.

This review appended only this section. It performed no stage, commit, remote call, secret access,
database mutation or change to implementation/schema/test files.

## Remediation follow-up

**Implementation state: ready for independent re-review.** The findings above were replayed as
failing tests and the contract lane was corrected without DB, CLI, LINE, remote or secret access.

| Review finding | Remediation |
|---|---|
| impossible version `0` | Activation expectation and both receipt versions now require integers `>= 1` in Zod and JSON Schema. |
| unbounded/stale binding expiry | `parseLineActivationInput(value, { now })` accepts a deterministic execution time and requires the approval window to be active, `bindingExpiresAt > now`, `bindingExpiresAt > approval.notBefore`, and `bindingExpiresAt <= approval.expiresAt`. Runtime defaults to current time. |
| event/state owner collapse | `ACTIVATION`/`ROLLBACK` accept only `EVIDENCE_VERIFIED` and reject transport fields; `CANARY_TRANSPORT` accepts only `GENERATED`, `ACCEPTED_BY_LINE`, `DISPLAYED_UNKNOWN`, or `READ_UNKNOWN`. `GENERATED` may carry an artifact hash but cannot carry LINE acceptance; accepted/display/read states require both artifact hash and `HTTP_2XX`. Both Zod and JSON Schema enforce the matrix. |
| no real JSON Schema validation | Tests compile both schemas through Ajv `8.20.0`'s Draft 2020-12 entry and execute the same valid/invalid structural fixtures through Ajv and Zod. UUID and date-time formats have explicit test validators. |
| provider identity ambiguity | The contract remains a non-empty model-provider ID inherited from FR-054. The misleading `line` fixture is now `openai`; LINE remains the transport, not the model provider. |
| RED evidence | The remediation RED run is retained here: 16 focused tests ran, with four failures covering expiry/version, event/state ownership and strict Draft 2020-12 compilation. |

Cross-field date ordering and arithmetic version movement are semantic Zod checks because portable
Draft 2020-12 JSON Schema cannot express those relations directly. Structural constraints,
version minima, event/state ownership and conditional transport evidence are enforced by both
validators. W2/W3 must use the Zod parser rather than treating JSON Schema-only success as complete
operator authorization.

### Remediation verification

| Phase | Command | Result |
|---|---|---|
| RED replay | `npx vitest run tests/unit/line-activation-contract.test.js` | expected FAIL: 4 failed / 12 passed |
| RED transport tightening | same focused command | expected FAIL: 2 failed / 14 passed for generated-plus-acceptance in Zod and Draft 2020-12 |
| GREEN + compatibility | `npx vitest run tests/unit/line-activation-contract.test.js tests/unit/activation-readiness-contract.test.js tests/unit/line-canary-preflight.test.js` | PASS: 3 files / 34 tests |

### Remediation changelog

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.0b | 2026-08-14 | candidate | Closed version, expiry, event/state and Draft 2020-12 parity findings; ready for re-review | working-tree | ATHER |

## Standards parity follow-up

The Draft 2020-12 fixture harness now uses `ajv-formats@3.0.1` through `addFormats(Ajv2020)`
instead of local UUID and `Date.parse` format callbacks. Ajv runs with
`{ strict: true, useDefaults: true }`.

Two dedicated parity fixtures prove:

- a date-only value such as `2026-08-14` fails the `date-time` contract in both Ajv and Zod; and
- omitting `mode` materializes `DRY_RUN` in the Ajv-validated object and the Zod parse result.

| Phase | Command | Result |
|---|---|---|
| RED standards replay | `npx vitest run tests/unit/line-activation-contract.test.js` | expected FAIL: 2 failed / 16 passed; custom date parser accepted date-only and Ajv did not materialize the default |
| GREEN + compatibility | `npx vitest run tests/unit/line-activation-contract.test.js tests/unit/activation-readiness-contract.test.js tests/unit/line-canary-preflight.test.js` | PASS: 3 files / 36 tests |

### Standards parity changelog

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.3.0b | 2026-08-14 | candidate | Replaced custom formats with ajv-formats RFC3339/UUID validation and proved default materialization parity | working-tree | ATHER |

## Authority-completeness follow-up

The activation expectation now pins both immutable channel identifiers:
`bindingCode: LINE-SMARTGIFT-OA` and `channelProvider: LINE`. `providerId` remains the separate
model-provider identity inherited from FR-054.

All contract date-time fields use Zod `datetime({ offset: true })`, matching the RFC3339 offset
support exercised through `ajv-formats`. A `+07:00` activation window, binding expiry and receipt
timestamp pass both contract boundaries, while the prior date-only rejection remains covered.

The lane now also publishes `line-rollback-input.schema.json` and `parseLineRollbackInput` with:

- contract version `1.0.0` and `DRY_RUN` default (`APPLY` must be explicit);
- exact scope, binding code and LINE channel provider;
- binding version `>= 1`, literal `ACTIVE`, and both hash-presence expectations fixed to `true`;
- model provider/model plus the three pinned evidence hashes;
- strict approval reference/window with deterministic `options.now`; and
- strict rejection of secret, payload, PII and all undeclared fields.

Rollback schema fixtures are compiled with Ajv Draft 2020-12 and parsed with Zod. Both validators
materialize the same default and reject a non-`ACTIVE` binding. Zod additionally enforces that the
approval window is active at execution time.

| Phase | Command | Result |
|---|---|---|
| RED authority replay | `npx vitest run tests/unit/line-activation-contract.test.js` | expected FAIL: 8 failed / 14 passed; exact identity was undeclared, offset Zod parsing and rollback schema/parser were absent |
| GREEN + compatibility | `npx vitest run tests/unit/line-activation-contract.test.js tests/unit/activation-readiness-contract.test.js tests/unit/line-canary-preflight.test.js` | PASS: 3 files / 40 tests |

### Authority-completeness changelog

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.4.0b | 2026-08-14 | candidate | Added exact channel identity, RFC3339 offset parity and strict rollback input contract | working-tree | ATHER |

## Remediation review

**Reviewer:** Tesla
**Reviewed at:** 2026-08-14T09:46:04+07:00
**Verdict:** `FAIL` — version, expiry, event/state ownership and provider-fixture defects are closed,
but the claimed Draft 2020-12/Zod parity still has reproducible date-time and default-normalization
divergence.

| Prior finding | Result | Re-review evidence |
|---|---|---|
| Binding/event version `0` accepted | `PASS` | Both schemas now use `minimum: 1`; Zod uses `.min(1)`; boundary tests reject version `0`. |
| Stale/unbounded binding expiry | `PASS_ZOD` | Parser takes deterministic `now`, requires an active approval window, future binding expiry and `bindingExpiresAt <= approval.expiresAt`; stale and approval-exceeding tests pass. The approval expiry is now the explicit bound. |
| Event type / receipt state collapse | `PASS` | Mutation events accept only `EVIDENCE_VERIFIED` and reject transport fields; transport accepts only generated/accepted/display-unknown/read-unknown. Both JSON Schema and Zod cover the matrix. |
| LINE evidence requirements | `PASS` | Accepted/display/read states require artifact SHA-256 plus `HTTP_2XX`; generated state rejects an acceptance class. |
| Structural JSON Schema validation absent | `PASS_PARTIAL` | Tests now compile both schemas with Ajv 8 Draft 2020-12 and run targeted valid/invalid fixtures through Ajv and Zod. See remaining parity failure below. |
| Model provider fixture says `line` | `PASS` | Fixture now uses `openai`; LINE remains transport identity. |
| Forbidden raw fields | `PASS_WITH_WARNING` | Strict objects still reject the named raw fields. Content-level PII in allowed identifier strings remains a downstream redaction responsibility. |
| Focused compatibility suite | `PASS` | Independent rerun: 3 files / 34 tests, including 16 W1A tests. |
| Historical RED provenance | `WARN` | RED counts are recorded in prose, not a machine-readable command artifact or commit. This does not invalidate current GREEN behavior but remains non-reproducible historical evidence. |

### Remaining blocker — validator parity is not exact

The parity helper registers date-time as `!Number.isNaN(Date.parse(value))`. That is not an
RFC 3339 date-time validator. A reproduced activation fixture using date-only values
(`2026-08-14`, `2026-08-15`) produced:

```json
{
  "ajvAcceptedDateOnly": true,
  "zodAcceptedDateOnly": false,
  "modeAfterAjv": "ABSENT"
}
```

This shows two shared-contract differences:

1. Ajv accepts a date-only string for a `date-time` field while Zod `.datetime()` rejects it.
2. JSON Schema `default: DRY_RUN` is an annotation; with the tested Ajv configuration it does not
   populate an omitted `mode`. Zod returns a normalized object with `mode: DRY_RUN`.

The current parity test does not contain either counterexample, so its PASS cannot support a claim
that JSON Schema-only and Zod consumers accept and normalize the same contract. W2/W3 using the
Zod parser is safe locally, but the JSON Schema is intended as a shared `zuri-cli` contract and
must not imply normalization or temporal parity it does not provide.

### Required closure

1. Use a standards-compliant RFC 3339 date-time format implementation (for example pinned
   `ajv-formats`) and align Zod offset policy, or add an identical explicit timestamp regex/policy
   to both contracts. Add date-only and timezone-offset parity cases.
2. Freeze normalization semantics for omitted `mode`: either require `mode` in the JSON wire
   contract, enable/test default application in every consumer, or state that schema validation is
   validation-only and every consumer must normalize absent mode to `DRY_RUN` before use.
3. Execute the same fixture matrix through both validators and compare accept/reject **and** the
   normalized values for fields with defaults.
4. The newly pinned Ajv dependency changes shared `package.json` and `package-lock.json`, outside
   the original five-file W1A ownership list. The integrator must explicitly own, review and stage
   those two files; the package lock is present and version-pinned.

The earlier direct counterexamples for version `0`, expired binding and
`ACTIVATION + ACCEPTED_BY_LINE` now fail closed. This review appended only this section and made no
implementation/schema/test/package edit, stage, commit, remote call or secret access.

## Final remediation review

**Reviewer:** Tesla
**Reviewed at:** 2026-08-14T09:50:54+07:00
**Verdict:** `FAIL` — default materialization is closed, but RFC 3339 offset parity and two required
W2 operator-input contracts remain open.

### Verification result

| Gate | Result | Evidence |
|---|---|---|
| Standards validator dependency | `PASS` | `ajv@8.20.0` and `ajv-formats@3.0.1` are directly pinned with lockfile entries. |
| Date-only rejection | `PASS` | Dedicated fixture rejects `2026-08-14` through both Ajv and Zod. |
| Omitted mode normalization | `PASS_HARNESS` | Ajv is configured with `useDefaults: true`; the validated object and Zod result both materialize `DRY_RUN`. Every external JSON-Schema consumer must use the same normalization policy. |
| Focused suite | `PASS` | Independent rerun passed 3 files / 36 tests, including 18 W1A tests. |
| RFC 3339 timezone-offset parity | `FAIL` | `ajv-formats` accepts a valid `+07:00` RFC 3339 date-time, while Zod `.datetime()` with its current default rejects offsets. No offset parity fixture exists. |
| Exact binding code/channel provider for W2 CAS | `FAIL` | Activation input has binding UUID and model `providerId`, but no `bindingCode` or channel-provider expectation (`LINE`). ADR-020 requires CAS over exact binding provider/code; model provider is a different identity and cannot substitute. |
| Strict rollback/disable input | `FAIL` | The only input requires `PENDING`, null hashes and `DRY_RUN|APPLY`; it cannot represent an authorized `ACTIVE -> INACTIVE` routing-first rollback. A receipt event type is evidence after an action, not authority/input for W2 disable mode. |

### Reproduced offset counterexample

Using otherwise valid approval/binding timestamps with `+07:00` offsets produced:

```json
{
  "ajvAcceptedOffset": true,
  "zodAcceptedOffset": false,
  "modeAfterAjv": "DRY_RUN"
}
```

This closes the previous default failure but confirms the temporal wire contract still differs
between validators.

### Required closure before W1A/W2 handoff

1. Align temporal syntax explicitly: either use Zod `.datetime({ offset: true })` and add Z/offset
   valid plus date-only invalid fixtures, or constrain JSON Schema to the same UTC-only syntax as
   Zod. The accepted wire format must be identical for `notBefore`, approval expiry,
   `bindingExpiresAt` and receipt `occurredAt`.
2. Add separately named exact binding expectations—at minimum `bindingCode` and
   `channelProvider: LINE`—without overloading the existing model-provider ID. Test wrong code and
   wrong channel provider as fail-closed CAS inputs.
3. Add a strict, versioned rollback input (or an operation-discriminated operator schema) that
   pins exact scope/code/channel provider, expected `ACTIVE` state and version, correlation,
   approval/recovery evidence and routing-first `INACTIVE` target. It must not accept raw secrets
   and must not reuse the activation-only `PENDING`/null-hash preconditions.
4. Keep execution authority separate from receipt evidence: a `ROLLBACK` receipt cannot authorize
   the rollback it records.

No implementation/schema/test/package file was edited by this review; no stage, commit, remote
call, secret access or database action occurred.

## Authority-completeness review

**Reviewer:** Tesla
**Reviewed at:** 2026-08-14T09:57:35+07:00
**Verdict:** `PASS_WITH_WARNINGS` — all prior W1A authority and parser/schema blockers are closed;
the lane is ready for W2 consumption as a local contract, not for production execution.

| Authority gate | Result | Final evidence |
|---|---|---|
| RFC 3339 offset parity | `PASS` | All Zod date-time fields now use `.datetime({ offset: true })`; Ajv uses pinned `ajv-formats`. Tests accept `+07:00` activation, rollback and receipt timestamps through both boundaries and still reject date-only values. |
| Default normalization | `PASS_HARNESS` | Activation and rollback schemas carry `default: DRY_RUN`; Ajv runs with `useDefaults: true`; tests compare the materialized Ajv value with the Zod normalized result. External JSON-Schema consumers must preserve this configuration/normalization contract. |
| Exact binding code | `PASS` | Activation and rollback require literal `LINE-SMARTGIFT-OA`; wrong-code parser tests fail closed. |
| Exact channel provider | `PASS` | Activation and rollback require literal `LINE`, separate from model `providerId`; wrong-provider parser tests fail closed. |
| Activation state/version/hash expectations | `PASS` | Activation requires version `>= 1`, `PENDING`, and both persisted binding hashes absent. |
| Strict rollback authority | `PASS` | Separate versioned schema and `parseLineRollbackInput` require exact scope/identity, version `>= 1`, `ACTIVE`, both hashes present, model/evidence hashes, approval reference/window and distinct correlation. `APPLY` remains explicit; default is `DRY_RUN`. |
| Routing-first target safety | `PASS_BY_DESIGN` | Rollback input does not expose a caller-selected target status. W2 owns the fixed `ACTIVE -> INACTIVE` operation, preventing input from requesting `PENDING`, `ROTATED` or another state. |
| Approval timing | `PASS_ZOD` | Activation and rollback parsers accept deterministic `now` and reject inactive windows; activation additionally bounds binding expiry to the active approval window. Cross-field/current-time checks remain semantic parser requirements beyond portable JSON Schema. |
| Receipt event/state/version truth | `PASS` | Mutation and transport owners remain separated; mutation increments once, transport does not move version, and accepted/display/read states require artifact hash plus `HTTP_2XX`. |
| Ajv/Zod structural parity | `PASS` | Draft 2020-12 schemas for activation, rollback and receipt compile with Ajv; targeted valid/invalid identity, state, version, date and default fixtures execute across both validators. |
| Raw secret/PII-shaped fields | `PASS_WITH_WARNING` | All three schemas are strict and the test scans them for destination, bearer, pepper, authorization, reply token, message content and customer email fields; parser tests reject undeclared activation/receipt/rollback inputs. Structural validation cannot detect PII embedded inside an allowed free-text identifier, so downstream redaction remains mandatory. |
| Focused compatibility suite | `PASS` | Independent rerun passed 3 files / 40 tests, including 22 W1A contract tests. |
| TDD RED provenance | `WARN` | RED counts are retained in report prose but not as machine-readable command output or a commit boundary. Current GREEN behavior is independently verified; historical RED remains author-reported. |
| Shared dependency ownership | `WARN` | `ajv` and `ajv-formats` are directly pinned with lockfile entries, but `package.json`/`package-lock.json` are shared integrator-owned files outside the original exclusive W1A list and must be scoped deliberately when staged. |

### W2 handoff boundary

W1A now supplies complete strict inputs for activation and rollback plus the redacted receipt
contract. It does not itself implement or authorize a mutation. W2 must still:

1. parse through the corresponding Zod boundary before any transaction;
2. source raw destination/bearer/pepper only from approved environment/secret storage;
3. lock and compare exact project/Tenant/Business/binding UUID/code/channel provider, version,
   status, hash presence, evidence and approval window;
4. hardcode activation to `PENDING -> ACTIVE` and rollback to routing-first `ACTIVE -> INACTIVE`;
5. append the matching event atomically and return the existing redacted result or fail closed on
   correlation replay; and
6. retain `DRY_RUN` as the default regardless of upstream schema-validator behavior.

No implementation/schema/test/package file was edited by this review; no stage, commit, remote
call, secret access or database action occurred.
