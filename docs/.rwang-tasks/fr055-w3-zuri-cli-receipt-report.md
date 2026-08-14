---
version: "0.2.0b"
created_at: "2026-08-14T10:04:30+07:00,ATHER"
last_update: "2026-08-14T10:15:58+07:00,ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "task-report"
  scope: "FR-055 W3 redacted zuri-cli transport artifact adapter"
---

# FR-055 W3 report — redacted zuri-cli transport adapter

## Outcome

**PASS after remediation; ready for fresh W3 review.** A strict Draft 2020-12 artifact schema and local file adapter now transform
redacted `zuri-cli` evidence into the existing W1A `CANARY_TRANSPORT` receipt contract. The lane
does not mutate a database, call a network or LINE endpoint, verify a signature, read a secret or
own transport. The earlier independent PASS missed direct-Node resolution, exact-scope and
timestamp-ordering defects; the remediation section records their closure.

## Contract boundary

- Artifact contract version is fixed at `1.0.0`; unknown top-level and HTTP-observation fields
  fail closed in both JSON Schema and Zod.
- Required content is limited to correlation/scope/version identifiers, source/config/evidence
  SHA-256 values, timestamps, actor fingerprint and an optional HTTP status observation.
- Project, Tenant, Business and binding are fixed to the single approved FR-055 slice in both
  Draft 2020-12 and Zod.
- Destination, authorization, bearer, reply token, message/body, headers, customer identifier and
  arbitrary payload fields are rejected.
- The adapter reads the local artifact bytes once, parses those bytes and recomputes their exact
  SHA-256. A caller-supplied artifact hash is not part of the accepted contract.
- An absent or non-2xx HTTP observation emits `GENERATED`; only status `200..299` emits
  `ACCEPTED_BY_LINE` with `HTTP_2XX`. The HTTP observation time cannot precede artifact creation.
- The result is passed through `parseLineCanaryReceipt`, which fixes `eventType` to
  `CANARY_TRANSPORT`, keeps the binding version unchanged and rejects any W1A-invalid result.
- No display or read evidence is synthesized. `ACCEPTED_BY_LINE` retains the ADR-020 meaning that
  display and read remain unknown.

## TDD and verification evidence

| Phase | Command | Result |
|---|---|---|
| RED | `npx vitest run --config vitest.fr055-w3.temp.config.js` | expected FAIL before implementation: adapter module not found; 1 failed suite / 0 tests collected |
| GREEN | same focused command | PASS: 1 file / 24 tests |
| compatibility | same no-globalSetup config with W1A + W3 suites | PASS: 2 files / 46 tests |
| diff hygiene | `git diff --check -- <four W3 owned files>` | PASS |
| schema surface | forbidden-field `rg` over the artifact schema | no declared forbidden field (`rg` exit 1) |

The focused suite proves exact-byte hashing, W1A receipt validity, 2xx-only promotion, non-2xx
fail-closed semantics, strict nested objects, HTTP bounds, malformed JSON/hash/time/version
rejection, JSON Schema/Zod structural parity and rejection of caller-supplied artifact hashes.

## Files produced

- `contracts/phase1-activation/zuri-cli-transport-artifact.schema.json`
- `src/modules/agent/zuri-cli-canary-receipt.js`
- `tests/unit/zuri-cli-canary-receipt.test.js`
- `docs/.rwang-tasks/fr055-w3-zuri-cli-receipt-report.md`

The ephemeral no-globalSetup Vitest config used for isolated evidence was removed. No package file
was edited, and no file was staged or committed.

## Limitations and W4 handoff

1. Structural validation cannot identify PII hidden inside an otherwise allowed identifier string;
   the `zuri-cli` producer must generate opaque/redacted identifiers as required by SEC-012.
2. W3 accepts a caller-supplied local path. W4/operator orchestration must pin the expected artifact
   path and source/config hashes before import; W3 does not authorize execution from the file.
3. A non-2xx HTTP status is retained only inside the hash-pinned source artifact. The W1A receipt
   intentionally has no non-2xx acceptance class, so the adapter truthfully remains `GENERATED`.
4. The artifact source/config hashes are covered by strict validation and the whole-file hash; they
   are not copied into W1A because that receipt contract has no separate source/config fields.
5. The adapter does not prove LINE display/read, transport signature ownership or one-canary
   idempotency. Those remain W4/W5 and database/operator gates.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Strict redacted artifact-to-W1A receipt adapter with RED→GREEN evidence | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | candidate | Closed direct-Node import, exact FR-055 scope and timestamp-ordering defects with RED→GREEN evidence | working-tree | ATHER |

## Independent review

**Reviewer:** ATHER (independent cross-review lane)
**Reviewed at:** 2026-08-14T10:06:15+07:00
**Verdict:** `PASS` — no actionable W3 defect found.

| Review area | Result | Independent finding |
|---|---|---|
| JSON Schema / parser parity | `PASS` | Draft 2020-12 and Zod expose the same required fields, UUID/SHA-256/identifier/version/date-time bounds, optional strict `httpObservation`, and fixed contract version. The compatibility rerun passed W1A and W3 together. |
| Recursive strictness | `PASS` | Both the root object and the only nested object use closed-property validation. Top-level raw/free-form fields and nested headers are rejected; there is no generic metadata/payload escape hatch. |
| Exact-byte hash pin | `PASS` | The adapter reads the file once as bytes, parses that same buffer and hashes the unchanged buffer. A caller-provided artifact hash is outside both contracts and is rejected. |
| Event and version semantics | `PASS` | Output is fixed to `CANARY_TRANSPORT`; before/after versions are equal and at least one; final output is reparsed through W1A rather than returned unchecked. |
| HTTP acceptance truth | `PASS` | Only integer status `200..299` produces `ACCEPTED_BY_LINE` plus `HTTP_2XX`. Missing, informational, redirect and error observations stay `GENERATED` with no acceptance class. Invalid status bounds fail closed. |
| Display/read inference | `PASS` | The adapter has no branch that emits `DISPLAYED_UNKNOWN` or `READ_UNKNOWN`, and tests explicitly prevent a 2xx observation from being described as display/read evidence. |
| Side-effect boundary | `PASS` | Production code imports only local crypto/file parsing, Zod and the W1A parser. It contains no database client, network call, LINE transport/signature code, environment/secret read or mutation. |
| Test quality | `PASS` | Tests cover exact-byte hashing, W1A validity, all HTTP classes and bounds, root/nested forbidden fields, malformed JSON/hash/time/version, schema/Zod structural parity and caller-hash rejection. Fresh no-globalSetup run: 2 files, 46 tests passed. |

The report's existing handoff limits are accurate and remain integration gates rather than W3
defects: W4 must pin the expected local path and expected source/config/evidence hashes, and the
producer must keep values opaque/redacted because structural validation cannot classify PII hidden
inside an otherwise allowed identifier string. No implementation, contract or test file was edited
by this review; only this section was appended. No database, network, LINE or secret operation ran.

## Remediation follow-up

**State:** `PASS` locally and ready for a new independent review. This section supersedes the
earlier no-defect verdict above for the three defects identified during integration.

| Finding | Closure |
|---|---|
| Direct Node import failed | Replaced the Vitest-only `@/modules/...` import with the runtime-safe relative ESM import `./line-activation-contract.js`. A child Node process now dynamically imports the actual source file without Vitest/Vite alias resolution. |
| Artifact accepted arbitrary scope | JSON Schema uses exact `const` values and Zod uses exact literals for project `qcnmhyglarzcpudjorzc`, Tenant `77cdbe70-3111-4a04-922a-8059be99a8b0`, Business `834fa869-62f3-431c-a287-e9a95e91175b` and binding `84ed2c90-ab44-46f3-9618-1f24df0744b9`. Four counterexample fixtures fail both boundaries. |
| HTTP observation could predate artifact | Zod semantic refinement requires `httpObservation.occurredAt >= occurredAt`. Draft 2020-12 remains the structural boundary because portable JSON Schema cannot compare sibling date-time values; the test explicitly proves structural acceptance followed by semantic rejection. Every consumer must invoke the adapter/Zod parser, not JSON Schema alone. |

### Remediation TDD evidence

| Phase | Command | Result |
|---|---|---|
| RED replay | `npx vitest run --config vitest.fr055-w3-remediation.temp.config.js` | expected FAIL: 6 failed / 24 passed — direct Node import, four exact-scope cases and timestamp ordering |
| GREEN focused | same no-globalSetup config, W3 only | PASS: 1 file / 30 tests |
| W1A compatibility | same config, W1A + W3 | PASS: 2 files / 52 tests |
| direct runtime smoke | `node --input-type=module --eval "await import('./src/modules/agent/zuri-cli-canary-receipt.js'); console.log('DIRECT_IMPORT_OK')"` | PASS: `DIRECT_IMPORT_OK` |
| diff hygiene | `git diff --check -- <three W3 implementation/test paths>` | PASS |

Direct Node emits the repository's existing `MODULE_TYPELESS_PACKAGE_JSON` performance warning
because package module mode is not declared. It does not fail resolution or execution; changing
package mode is outside W3 scope. The ephemeral remediation Vitest config was removed. No database,
network, LINE, remote or secret operation ran, and no file was staged or committed.

## Remediation review

**Reviewer:** ATHER (final independent re-review)
**Reviewed at:** 2026-08-14T10:17:56+07:00
**Verdict:** `PASS` — the three remediation defects are closed with no new actionable W3 finding.

| Review area | Result | Independent finding |
|---|---|---|
| Direct runtime import | `PASS` | Production code now imports `./line-activation-contract.js` directly. A fresh child-Node import and standalone smoke both returned `DIRECT_IMPORT_OK` without the Vitest alias. The existing typeless-package warning is performance-only and outside W3 scope. |
| Exact four-part scope | `PASS` | JSON Schema `const` values and Zod literals match exactly for project, Tenant, Business and binding. Four field-specific counterexamples fail both boundaries. |
| Schema / Zod alignment | `PASS` | Structural constraints remain aligned. The only deliberate difference is sibling timestamp ordering: portable Draft 2020-12 validates structure, then the mandatory adapter/Zod semantic boundary rejects out-of-order observations. This is explicit in tests and the report and fails closed before receipt creation. |
| Observation ordering | `PASS` | `httpObservation.occurredAt` may equal or follow artifact `occurredAt` and cannot precede it; valid RFC3339 offsets are normalized by `Date` comparison after Zod validates both timestamps. The counterexample is structurally accepted and semantically rejected as intended. |
| Test quality / report truth | `PASS` | Tests exercise direct Node resolution, all four scope mismatches and pre-artifact observation time. Fresh no-globalSetup compatibility run: 2 files, 52 tests passed; direct smoke passed. Report limitations and the typeless-package warning are accurate. |

The adapter remains local and side-effect bounded; this re-review performed no database, network,
LINE, remote or secret operation. No implementation/schema/test file was edited. Only this section
was appended, and the ephemeral review config was removed.
