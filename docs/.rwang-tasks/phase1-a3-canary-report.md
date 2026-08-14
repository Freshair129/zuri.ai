---
version: "0.1.0b"
created_at: "2026-08-14T09:20:00+07:00,ATHER"
last_update: "2026-08-14T09:20:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "audit-report"
  scope: "FR-053 FR-054 canary identity, activation prerequisites and receipt truth"
---

# Phase 1 A3 report — canary prerequisites and receipts

## Verdict

**BLOCKED for A6 binding activation and A7 signed canary.** The repository has a coherent
dry-run-only canary contract, stable production scope identifiers, fail-closed binding resolution
and truthful receipt vocabulary. It does not contain current live proof of a `PENDING`, hash-free
binding, an approved exact destination, an approved physical backup/PITR policy, a rollback
rehearsal, a controlled production binding-mutation procedure, or a post-LINE receipt artifact.

This audit was read-only. It did not query production, inspect credentials, choose a destination,
install hashes, enable routing, call LINE or write production.

## Evidence baseline

- Audited Git baseline: `be1c834a870a3def9b680a6260225fc758378686`.
- Authority: ADR-018, ADR-019, ZV2-CR-005, FR-052, FR-054 and the LINE Phase 1 canary runbook.
- Historical production evidence: `.agent/evidence/supabase-2026-08-14/manifest.json`, observed at
  `2026-08-14T07:02:48+07:00`. It is not a fresh production re-read.
- No secret material was opened or copied.

## Prerequisite matrix

| Gate | Status | Evidence | Required closure |
|---|---|---|---|
| Stable production project | PASS | ADR-018 fixes project ref `qcnmhyglarzcpudjorzc`. | Reconfirm target immediately before any remote operation. |
| Tenant identity | PASS | ADR-018 reserves Tenant `77cdbe70-3111-4a04-922a-8059be99a8b0` / `TNT-SMARTGIFT`. | Fresh read must match both UUID and code. |
| Business identity | PASS | ADR-018 reserves Business `834fa869-62f3-431c-a287-e9a95e91175b` / `BUS-SMARTGIFT`. | Fresh read must match Tenant ancestry. |
| Binding identity | PASS | ADR-018 reserves binding `84ed2c90-ab44-46f3-9618-1f24df0744b9` / `LINE-SMARTGIFT-OA`. Migration has an identity-collision guard. | Fresh read must match UUID, code, provider, Tenant and Business. |
| Current binding state | NOT_RUN | Historical manifest says `PENDING` with no hashes; this audit made no production query. | Re-read immediately before mutation and require `PENDING`, null hashes and routing disabled. |
| Exact canary destination | BLOCKED | No approved raw destination is tracked, and none may be inferred from a binding code or LINE event fixture. | Owner/operator supplies one exact destination through the approved secret-safe channel. |
| Binding destination hash | BLOCKED | Historical manifest says absent. No controlled production installer exists in `scripts/` or `src/`; the only matching update is rollback-scoped test SQL. | Approve and implement/review a bounded operator procedure that HMACs the exact destination without logging it. |
| Binding credential hash | BLOCKED | Historical manifest says absent. Resolver requires a high-entropy bearer HMAC; no approved bearer/pepper or controlled installer was supplied. | Provision bearer and pepper in the approved secret manager and install only the hash through the reviewed operator path. |
| Provider/model/credential | BLOCKED | Preflight requires exact provider/model, `APPROVED`, and `credentialAvailable: true`; real-provider evaluation remains `NOT_RUN`. | Pin approved provider/model and fresh passing redacted golden report hash. |
| Live isolation report | BLOCKED | Preflight requires a fresh `PASS` isolation report and exact SHA-256; live dedicated-login probe remains `NOT_RUN`. | Run the rollback-only probe with the dedicated login and retain a redacted, hash-pinned report. |
| Physical backup/PITR | BLOCKED | Historical manifest: WAL-G enabled, PITR false, available backups 0. Retained logical dump is post-apply, not pre-mutation evidence. | Owner approves backup/PITR policy and captures fresh provider evidence before activation. |
| Rollback procedure | PASS | ADR-018 and the runbook both require routing first, binding non-active, credential rotation when needed, and preservation of imported/source data. | Keep this order in the operator procedure. |
| Rollback rehearsal | BLOCKED | No rehearsal artifact, timestamp, approver or restore result was found. | Execute and review a non-destructive rehearsal before A6. |
| Dry-run plan contract | PASS | Schema fixes `mode: DRY_RUN`, `receiptState: EVIDENCE_VERIFIED`, `canActivateBinding: false`, `canSendLine: false`; preflight checks exact scope and evidence hashes. | Generate only after fresh A1/A2 evidence exists. |
| Signed LINE transport | BLOCKED | Zuri delegates signature verification and Reply API ownership to external `zuri-cli`; no current zuri-cli commit/config/canary evidence exists in this repository. | Pin the reviewed zuri-cli version/config, verify one reply owner and obtain explicit canary approval. |
| Live receipt record | BLOCKED | Repository defines receipt states but only persists them in the dry-run plan at `EVIDENCE_VERIFIED`; no live-canary receipt schema/artifact path was found. | Freeze a redacted receipt artifact before A7, including request correlation, LINE HTTP acceptance, timestamps and hashes without reply token/PII. |

## Canary identity packet

The non-secret identity packet may be prepared with these exact authority values:

| Field | Value/state |
|---|---|
| Project ref | `qcnmhyglarzcpudjorzc` |
| Tenant | `77cdbe70-3111-4a04-922a-8059be99a8b0` (`TNT-SMARTGIFT`) |
| Business | `834fa869-62f3-431c-a287-e9a95e91175b` (`BUS-SMARTGIFT`) |
| Binding | `84ed2c90-ab44-46f3-9618-1f24df0744b9` (`LINE-SMARTGIFT-OA`) |
| Provider/model | BLOCKED — owner-approved exact pair required |
| Golden report SHA-256 | BLOCKED — fresh passing A1/A5 artifact required |
| Isolation report SHA-256 | BLOCKED — fresh passing A2 artifact required |
| Destination | BLOCKED — exact owner-approved value required outside Git |
| Mutation window/approval ref | BLOCKED — operator input required |

The packet must not contain raw database URLs, passwords, provider keys, LINE channel secrets,
binding bearers, HMAC pepper, reply tokens, authorization headers, customer content or PII.

## Receipt-state audit

| State | Contract meaning | Current evidence |
|---|---|---|
| `GENERATED` | A response was generated locally. | NOT_RUN for a real canary. |
| `EVIDENCE_VERIFIED` | Dry-run prerequisites passed. | NOT_RUN with fresh production artifacts; only local contract/test evidence exists. |
| `ACCEPTED_BY_LINE` | LINE accepted the separately approved request. | NOT_RUN. No LINE request was made. |
| `DISPLAYED_UNKNOWN` | Provider acceptance does not prove device display. | PASS as a required semantic; no display claim exists. |
| `READ_UNKNOWN` | Provider acceptance does not prove that a person read it. | PASS as a required semantic; no read claim exists. |

`ACCEPTED_BY_LINE` must be derived only from the LINE transport response owned by `zuri-cli`.
Neither a successful Zuri internal API response nor a generated answer is delivery evidence.

## Findings

1. **Hard blocker — controlled mutation path is missing.** The runbook refers to an approved
   operator path for installing hashes and activating the binding, but repository search found no
   such production command. `supabase/tests/production_tenant_isolation.sql` performs an `ACTIVE`
   update only inside a transaction that ends in `ROLLBACK`; it must not be reused as activation.
2. **Hard blocker — live receipt artifact is undefined.** Receipt vocabulary is frozen, but the
   tracked JSON schema ends at dry-run `EVIDENCE_VERIFIED`. A7 cannot be auditable until a
   redacted post-transport receipt contract/location and owner are approved.
3. **Hard blocker — backup and rollback evidence are incomplete.** The historical snapshot is
   post-apply, PITR is disabled, there are zero provider backups in the manifest, and no rollback
   rehearsal artifact was found.
4. **External dependency — signed delivery lives in `zuri-cli`.** This repository cannot alone
   prove signature verification, the single reply owner, feature flag state or LINE acceptance.
5. **Truth-sync issue — acceptance checklist is stale.** `docs/ACCEPTANCE-CRITERIA.md` leaves
   remote inventory/migration boxes unchecked while later phase reports record the schema/import
   as deployed. This does not unblock activation; the checklist should be reconciled by the
   integrator against current evidence.

## Safe next sequence

1. Complete A1/A2 and obtain fresh hash-pinned golden and isolation reports.
2. Obtain owner approval for backup/PITR policy, exact destination, provider/model and mutation
   window; record a rollback rehearsal.
3. Design/review the secret-safe binding installer and post-LINE receipt artifact under a separate
   approved change before any mutation.
4. Re-authenticate, verify project ref, and re-read the exact binding immediately before A6.
5. Stop if any predecessor is missing, stale, mismatched, non-`PENDING`, already hashed or routed.
6. Only then install hashes and activate one binding through the operator-controlled path.
7. Run one signed canary through the pinned `zuri-cli`; record `ACCEPTED_BY_LINE` separately from
   `DISPLAYED_UNKNOWN` and `READ_UNKNOWN`, then disable routing first on any failure.

## Local verification note

Focused tests were attempted in this clean worktree but are `NOT_RUN` because dependencies are not
installed (`vitest` was not found). The merged phase report records the earlier suite as passing;
this audit treats that as historical evidence, not a fresh test result.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Read-only A3 canary prerequisite and receipt audit; A6/A7 remain blocked | working-tree | ATHER |

## Independent review

**Reviewer:** Tesla
**Reviewed at:** 2026-08-14T09:03:29+07:00
**Report verdict:** `PASS_WITH_WARNINGS`
**Live A6/A7 execution verdict:** `BLOCKED`

The report matches the A3 brief, FR-054, ADR-019, the canary runbook, the dry-run schema,
preflight implementation, binding resolver and retained production manifest. Its primary conclusion
is conservative and correct: repository readiness contracts are not evidence of binding activation
or a signed LINE canary, and no live acceptance/display/read claim is supported.

| Review item | Result | Independent finding |
|---|---|---|
| Scope and non-mutation boundary | `PASS` | The report stays read-only and does not prescribe reuse of rollback-scoped test SQL as activation. |
| Dry-run contract | `PASS` | Schema and implementation fix `DRY_RUN`, `EVIDENCE_VERIFIED`, `canActivateBinding: false` and `canSendLine: false`. |
| Fail-closed prerequisites | `PASS` | Preflight rejects wrong scope/provider/hash, stale evidence, non-`PENDING` state, existing hashes and enabled routing. |
| Binding hashing semantics | `PASS` | `line-binding-resolver.js` confirms HMAC-SHA256 of both bearer and destination with a secret pepper; raw values must remain outside Git. |
| Controlled production installer | `FAIL` (live gate) | Repository-wide search finds no production mutation command; only the rollback-scoped SQL test sets hashes/`ACTIVE`. A6 must not run until a separately approved path exists. |
| Post-LINE receipt artifact | `FAIL` (live gate) | The tracked schema ends at dry-run `EVIDENCE_VERIFIED`; no approved durable/redacted `ACCEPTED_BY_LINE` receipt artifact is present. |
| Historical vs live evidence | `PASS_WITH_WARNING` | The narrative distinguishes the 07:02 historical manifest from a fresh read. However, the matrix `PASS` labels for project/Tenant/Business/binding mean **authority-reserved static identity only**, not current production existence, health or ancestry. Treat them as `PASS_STATIC` until re-read. |
| Upstream A2 dependency | `FAIL` (upstream gate) | Independent A2 audit found the current live isolation probe compares production `text` IDs with `$n::uuid`. A fresh A2 `PASS` cannot be accepted until that mismatch is fixed and exercised against PostgreSQL. |
| Receipt truth | `PASS` | The report correctly limits `ACCEPTED_BY_LINE` to transport acceptance and keeps display/read unknown. |
| Documentation truth-sync | `WARN` | In addition to the stale acceptance checklist noted by the author, PRD FR-050 says `Phase 1 active - owner-approved` while ADR-019 and FR-054 say the signed canary and Phase 1 acceptance remain `NOT_RUN`. The integrator should reconcile this wording without promoting live state. |

### Historical state accepted by this review

- Baseline commit is exactly `be1c834a870a3def9b680a6260225fc758378686`.
- The retained manifest observed at `2026-08-14T07:02:48+07:00` records a `PENDING`, hash-free
  binding, 74 knowledge rows, forced RLS, PITR disabled and zero physical backups.
- Earlier phase reports record test/build success, but the A3 worktree did not freshly rerun those
  suites. Those results remain historical, not current execution evidence.

### Live state not established

- current binding state, hashes, routing state and exact ancestry;
- current production project visibility/health under the intended operator identity;
- approved provider/model plus passing real golden report;
- a passing dedicated-login isolation report;
- approved destination, bearer/pepper, mutation window and operator path;
- physical backup/PITR approval and rollback rehearsal;
- pinned `zuri-cli` transport/config and signed LINE acceptance; and
- any durable post-transport receipt.

No remote query, secret access, code change, binding mutation, LINE call or commit was performed by
this review. The author report is approved as a prerequisite audit, not as authorization for A6 or
A7.
