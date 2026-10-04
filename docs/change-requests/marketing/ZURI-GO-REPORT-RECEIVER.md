---
doc_type: intake-note
title: Zuri-Go reported Marketing evidence — parent record migration
status: draft
superseded_by: null
version: "0.3.0"
date: "2026-10-05"
complexity: C-3
risk: HIGH
---

# Zuri-Go report receiver — parent contract and record migration

The owner approved Zuri-Go's Marketing report exchange P3 on 2026-10-05: a dedicated report credential, isolated QA first, explicit delivery and a durable reported-evidence receipt; the owner subsequently selected minimum retention of 90 days. This document makes the parent Identity/Marketing boundary concrete. It is an intake under [the proposal rules](../README.md), not an issued requirement or a claim of parent implementation. New canonical records need the reviewed migration below; no generated registry or pinned historical row is rewritten by this proposal.

## Authority and compatibility

Parent intent is [Marketing charter](../../domains/marketing/CHARTER.md) and [initiative ownership](../../domains/marketing/features/FR-160-campaign-initiatives.md). Peer Identity behavior is [Enterprise API key](../../domains/identity/features/FR-106-enterprise-api-access-key.md), [Business domain visibility](../../domains/identity/features/FR-061-per-business-domain-visibility.md) and [audit scope](../../domains/identity/features/FR-198-audit-scope-and-evidence.md). Record authoring follows the approved [governance profile](../../migrations/document-reintegration/GOVERNANCE-PROFILE.md) and [canonical format](../../migrations/document-reintegration/CANONICAL-FORMAT.md).

Source baseline: `332b88c9277ee0995798f125f99d5343e7d493f0`. The parent remains SQLite/Prisma; Go is PostgreSQL schema 11. The inspected growth routes use session viewers and native writes require Business ownership. `resolveApiAccessViewer` resolves a Tenant service account, not a Marketing owner. No external-report receiver or report-ingest permission exists in this baseline. Existing FR-106 tokens must retain their current semantics.

External counterpart: `Freshair129/zuri-go`, reviewed documentation commit `696c387bc9db171151c93b96edf0ee230542ecd7`, design at `docs/features/FEAT-015-marketing-report-exchange/design.md`, wire version `zuri-marketing-report/0.1`. These external file locators do not declare or alias parent ZAI identities. The full wire field whitelist, canonical serialization and receipt shape are owned once by `docs/features/FEAT-015-marketing-report-exchange/contract.md` there. This parent chapter owns credential, receiver persistence and authorization. Before coding, confirm that the reviewed counterpart contract is still applicable; do not use a moving draft or copied schema.

## Proposed canonical record migration

These are exact behavioral subjects for new records, not reinterpretations of FR-106 or FR-159. Qualified IDs, export placement, source provenance and test bindings must be allocated at a fresh-main check through a reviewed record migration. The current registry tool preserves pinned initial rows; `--adopt` cannot label these new subjects as historical source. Do not hand-edit compatibility exports/indexes or weaken their checks to insert them.

| Proposed subject | Owner | Required statement / acceptance |
|---|---|---|
| Report-only machine credential | Identity | Resolve only an active dedicated credential to its explicit source deployment/Business and target Tenant/Business binding with report-ingest permission. Never synthesize a Person/OWNER or accept it on Enterprise import/native Marketing writer routes. Missing, invalid or revoked credentials share a generic authentication refusal. |
| Atomic reported-evidence intake | Marketing | Authenticate before intake/replay, validate exact bytes and scope, atomically persist one immutable external evidence/receipt/audit for one binding + reportId, return the same committed receipt for identical replay, and reject different bytes under that key without writes. |
| Private source-preserving evidence read | Marketing | Re-evaluate Business/growth visibility before every read, exclude Guest/public projections, preserve null/UNKNOWN/reported trust and leave native plans, reviews, decisions, PM execution and Commerce verified totals unchanged. |
| Receiver/Identity design | Identity + Marketing | Specify the physical models, fixed receiver route, authority checks, SQLite concurrent-transaction behavior, retention policy and the scoped integration tests below. Delivery stays declared until tests and operational gates pass. |

The parent canonical migration is OPEN. The approval of the overall P3 scope is recorded; this intake does not self-approve newly issued parent records. New source provenance must distinguish authored behavior from the pinned migration inventory. Existing subject anchors, identities and generated source rows remain intact.

## Credential and binding — proposed minimum

One `MarketingReportBinding` logical record contains one dedicated credential and its exact immutable scope. This avoids a new generic auth framework and exposes no browser provisioning UI in the first slice.

| Field group | Proposed data / invariant |
|---|---|
| Identity | UUID id; Business-scoped immutable binding identity, never a human code |
| Credential | unique SHA-256 keyHash of a high-entropy report-only bearer secret; distinct credential prefix; raw secret returned once to the authorized operator, never persisted/logged |
| Source | fixed sourceSystem `zuri-go`, sourceDeploymentId and opaque sourceBusinessId |
| Target | tenantId + businessId pointing to the same active parent Business; explicit permission `marketing.report.ingest`; native Business owner/domain gates are not reinterpreted as machine grants |
| Lifecycle | ACTIVE/REVOKED, createdAt, revokedAt; immutable key/scope. Revoke is audited. A replacement credential/binding gets a new identity and requires a new reviewed Go association/report |
| Custody | operator-only provisioning/revocation in this first slice, isolated synthetic credentials for QA; real minting needs separate operational authorization |
| Privacy | no raw token, Member PID or customer identifiers in reports, browser state, audit payloads or receipt |

The resolver returns a dedicated report-ingest principal containing the verified binding/scope; it never returns an Enterprise `isApiAccess` viewer or native Person viewer. No session fallback exists on the receiver. The dedicated prefix is rejected by existing Enterprise and native session entry points; regression tests prove that they cannot gain those capabilities. A public POST URL is not permission.

Before each new intake or replay, recheck credential/binding status inside the receiving transaction, derive Tenant/Business from the binding, compare source and target hints to that scope and resolve the requested initiative/plan from the same active Business. Current machine growth permission requires all of: an ACTIVE binding, its explicit report-ingest permission and the target Business's currently enabled growth domain. Provisioning against an enabled growth domain is not a permanent grant. Every transaction, including a replay or a contention retry, rechecks this conjunction; disabling the target growth domain or revoking the binding refuses both new writes and receipt disclosure. Machine scope is separate from native Member domain visibility; human reads retain the existing visibility gate. An inactive/deleted target also refuses receipt disclosure. This does not mint OWNER authority.

## Operations — candidate paths, no allocated API IDs

| Operation | Authority | Result |
|---|---|---|
| `POST /api/growth/external-marketing-reports` | dedicated report credential only; fixed JSON media type and bounded exact body; no browser session fallback | 201 committed reported evidence receipt; 200 identical replay; 409 same identity/different bytes; generic 401 invalid credential; scope refusal without revealing another Business |
| private evidence read in Marketing application service | existing `assertMarketingReadAccess`, resolved Tenant/Business and record scope | sanitized reported evidence/receipt; hidden/foreign/nonexistent record has the existing 404-shaped refusal |

No new public listing, dashboard, webhook, automatic notification or provider integration is included. Exact request byte limit, object whitelist, hash and strict receipt fields are the reviewed Go wire contract. Reject invalid UTF-8, duplicate/unknown keys, unsupported contract/revision, noncanonical payload, hash mismatch and oversized input before storing evidence. Do not coerce wire identifiers into native identity fields.

## Evidence and receipt persistence — proposed minimum

One `MarketingExternalReport` logical record stores immutable evidence and committed receipt together; an extra receipt model is unnecessary for this synchronous first slice. Existing `AuditEvent` is the separate audit writer.

| Field group | Proposed data / invariant |
|---|---|
| Parent scope | UUID id, tenantId, businessId, bindingId and resolved initiativeId; relational scope must agree |
| Source identity | sourceDeploymentId/sourceBusinessId/sourceCampaignId, sourceReportId UUID; unique `(bindingId, sourceReportId)` in the database |
| Wire | contractVersion, canonicalEnvelope text, SHA-256 payloadHash; revision 1 only; no correction/supersedes in this first slice |
| Receipt | unique receiverReceiptId UUID, acceptedAt and status `ACCEPTED_REPORTED_EVIDENCE`; strict immutable receipt references agree with the same envelope/binding/target |
| Custody | private read policy; no public projection or joins from Guest routes |
| Retention | owner-approved minimum 90 days, policy version 1; measured from acceptedAt; no automatic purge in this slice |

Acceptance does not update `MarketingPlan`, `MarketingPlanVersion`, `MarketingReview`, `MarketingDecision`, `MarketingHandoff`, Initiative lifecycle, PM records or Commerce totals. A report may be entirely HELD/UNKNOWN and still be stored as reported evidence; acceptance verifies the envelope/authority, not provider completeness or native approval.

Within one SQLite transaction: resolve/recheck binding and target → find exact key → verify replay bytes/hash, or insert new evidence with server receipt → append one scoped audit → commit → return receipt. The audit uses a service-principal actor tied to the binding UUID and explicit Tenant/Business fields; never a fabricated Member. No raw envelope/token is put in audit payload. The accepted evidence keeps the bounded canonical envelope privately.

Concurrent intake must rely on the unique constraint and handle SQLite contention through bounded whole-transaction retry. A uniqueness loser re-authorizes and reads the committed winning row; it cannot return a receipt from an aborted transaction. Recheck byte equality as well as hash. Busy exhaustion fails without an acknowledgment; the sender may retain UNKNOWN and replay identical bytes later. Do not transplant PostgreSQL row-lock clauses into SQLite. The application API never exposes update/delete of evidence or receipt; append-only restrictions and their native tests belong in the physical design/record migration before coding.

## Read and retention policy gate

People read through current Marketing read authority with Business/growth visibility; Guest, foreign Business and revoked machine credentials do not read evidence. A machine receives only its own matching receipt through re-authorized intake/replay, not arbitrary reports or native Marketing data. A full evidence UI/read route is outside the first slice.

Owner decision on 2026-10-05: minimum retention **90 days**, policy version 1, measured from acceptedAt for reported evidence and its matching receipt. Audit retains its existing append-only policy. This is a minimum, not an automatic deletion deadline. No scheduler/manual purge command is implemented here; any future destructive operation needs an approved retention/purge contract and explicit authorization. Revocation changes access, not the retained report/receipt bytes. The numeric retention gate is closed; parent record migration remains the coding prerequisite.

## Isolated QA and tests

QA uses a fresh test-owned SQLite file and synthetic Tenant/Business/initiative/binding/credential. Go uses a separate guarded PostgreSQL QA database and test-only server. No restored Local Business, Production data, live credential or existing parent DB is used.

| Test group | Required assertions |
|---|---|
| Credential isolation | invalid/revoked key uniform refusal; dedicated key fails Enterprise import, native Marketing writes and unrelated routes; no Person/OWNER synthesized |
| Scope/replay privacy | crossed deployment/source Business/target Tenant/Business/initiative, inactive target, disabled machine growth scope and revoked binding refuse before write or receipt disclosure; disable/revoke after a successful intake also denies identical replay; human hidden-domain read denial is checked separately |
| Strict wire | canonical bytes/hash, whitelist/UTF-8/duplicates/size/revision checks; UNKNOWN/null and unverified review trust preserved |
| Atomic acceptance | deliberate failure before audit/commit leaves no evidence or receipt; reply never acknowledges an uncommitted transaction |
| SQLite concurrency | independent requests/clients, identical key creates one evidence/receipt/audit; different bytes conflicts; contention retry cannot bypass reauthorization |
| Source custody | parent native tables/counts/content hashes and Go source unchanged; no provider/native approval promotion |
| End-to-end loss | parent commits then response is lost; Go remains UNKNOWN; identical eligible replay returns original receipt and only then ACKNOWLEDGED |

Go delivery lease/attempt/receipt schema and PostgreSQL tests remain Go-owned. Existing P2 HTTP QA acceptance can be prepared from approved code, but cross-system receiver/sender coding still requires the canonical parent records and retention gate above. Correction/latest-pointer acceptance stays OPEN and is not passed by revision-1 delivery.

## Execution and verification record

Prepared on isolated branch `codex/marketing-report-p3`; the active parent checkout/runtime is unchanged. Status: overall Go P3 scope APPROVED, detailed parent intake/record migration DRAFT, retention APPROVED (90 days), code/schema/QA end-to-end NOT_RUN. No issued IDs, registry exports or application artifacts changed.

Before coding: review/approve the parent record migration and physical contracts → allocate fresh qualified IDs through the supported governed authoring path → regenerate/check registry, graph, views and identity/ID-ledger constraints. A missing authoring capability must be documented and resolved under its own approved scope; never edit a generated index or label new rows source-preserved merely to pass a check.

## Version diff

0.2.0 → 0.3.0: pinned the reviewed Go documentation revision and made current machine growth permission, per-transaction reauthorization and disable/revoke replay denial explicit after independent architecture review. No issued records or application behavior changed.

0.1.0 → 0.2.0: recorded owner-approved minimum retention of 90 days and closed the numeric policy gate; parent normative record migration and code/QA acceptance remain unperformed.

0 → 0.1.0: proposed the parent-owned report credential, fixed intake, immutable evidence/receipt, private-reader policy, explicit record migration and SQLite QA assertions for the approved Go P3 direction. No code, applied schema, credential or runtime change.
