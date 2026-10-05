---
doc_type: intake-note
title: Marketing report receiver — physical design for review
status: approved
superseded_by: null
version: "0.2.0"
date: "2026-10-05"
complexity: C-3
risk: HIGH
---

# Marketing report receiver — physical design proposal

Final main gate: main advanced to `07779662` and issued a different FR-278. References below are this task branch's issued records at `fcb7ade3`, not active-main identities. [Main-first reconciliation](ZURI-GO-REPORT-MAIN-RECONCILIATION.md) is approved; the fresh main worktree implements its combined tooling before reviewed fresh issuance and application coding. No identity is renamed or aliased by this physical proposal.

This proposal elaborates [ZAI:SDD-111](../../requirements/SDD-111.md), [FR-278](../../requirements/FR-278.md), [FR-279](../../requirements/FR-279.md) and [FR-280](../../requirements/FR-280.md). Their issued statements, identities, planned delivery and frozen approval remain unchanged. The approved [receiver intake](ZURI-GO-REPORT-RECEIVER.md) supplies behavior; this document proposes its physical enforcement and native test bindings. Owner approved this physical design on 2026-10-05, including the separate deny-default Business machine policy and backup restrictions. Native implementation/acceptance remains pending. No schema, application code or live credential is delivered here.

Inspected composition: parent merge `fcb7ade3a022029cf47530643edc74fab2e49420`, integrating main `3506129ffc1feb93773d2110901e248609f80f7c` into the task branch without rebasing issued provenance. Counterpart Go baseline: `f06ef4d3e2321ff9ab24f125503bf32900343e37`, schema 11. Go owns the wire whitelist/canonicalization in `docs/features/FEAT-015-marketing-report-exchange/contract.md` v0.3.0 and sender physical chapter `p3-physical-delivery.md` v0.1.0. Pin their approved blobs together before coding; a moving draft is not approval. This intake issues no new API, component or TC ID and does not change feature membership.

## Decisions requiring review

[ASSUMPTIONS]

1. The approved “currently enabled growth domain” for a machine means a current Business-level permission for Marketing report intake, independent of native Membership visibility. There is no existing Business-wide growth enable switch to reuse: `business-capabilities.js` declares only `physicalStock`; `viewer-domains.js` grants human access. A report credential must never fabricate that human grant.
2. First delivery remains explicit and local-operator initiated. Parent storage remains SQLite/Prisma 5.22; Go remains PostgreSQL. Revision 1 only, no correction chain or automatic purge.

Proposed resolution of assumption 1: add `MarketingReportPolicy`, one row per Business, with `ingestEnabled = false` by default. Absence is denial. This row is the current machine growth gate, not a new switch hiding the native growth UI. Setting it false denies new intake AND identical replay receipt disclosure. An operator-only, versioned, audited command controls it; the dedicated report credential cannot change it. Provisioning and enabling real Businesses require separate operational authorization.

| Alternative | Tradeoff |
|---|---|
| Separate Business-scoped policy row — proposed | One additional small model beyond the two approved logical models; explicit deny-by-default grant, no changes to native capability/default/Member semantics |
| Add a native `growth` capability | Fewer new tables but changes FR-169 and module applicability semantics, including defaults and existing UI; exceeds this receiver slice |
| Binding ACTIVE alone | Fewer fields but cannot independently disable all machine intake for a Business; fails the approved current-Business-gate requirement |

Owner approval must settle this explicit machine-gate interpretation. If the owner instead intends a native module-wide growth toggle, stop and propose the additional parent/peer requirement change through governed record migration. Do not silently substitute per-binding ACTIVE status.

## Physical models and constraints

Prisma schema relations and additive SQLite migration are proposed; allocate the migration name after approval/fresh-main inspection. New storage uses ordinary FK relations with RESTRICT deletion and immutable UUID scope. Do not transplant PostgreSQL row locks or runtime role grants to SQLite.

| Model | Columns / indexes | Enforcement |
|---|---|---|
| `MarketingReportPolicy` | `businessId` PK/FK, `tenantId` FK, `ingestEnabled` boolean default false, positive `version`, created/updated timestamps | Tenant matches Business. Scope immutable; no delete. Only enabled/version/time transition under expected-version CAS, with scoped operator audit in one transaction |
| `MarketingReportBinding` | UUID `id`; unique lower-hex SHA-256 `keyHash`; `tenantId`, `businessId`, `sourceSystem = zuri-go`, bounded `sourceDeploymentId`, UUID `sourceBusinessId`, literal `permission = marketing.report.ingest`; `status`, `createdAt`, nullable `revokedAt`, positive `version` | Policy and Business scope match. Key/scope/creation immutable; no delete. ACTIVE with null revokedAt → REVOKED with timestamp/version+1 only; no reactivation. Exact no-op guard UPDATE permitted; all other updates rejected |
| `MarketingExternalReport` | UUID `id`; tenant/Business/binding/initiative FKs; deployment/source Business/campaign/report IDs; contract version; revision 1; null supersedes; canonical envelope TEXT; lowercase hash; unique receipt UUID; acceptedAt; literal reported-evidence status; retention policy version 1/minimum 90 days; unique `auditEventId` FK | UNIQUE(bindingId, sourceReportId). All columns immutable; UPDATE/DELETE abort. UTF-8 byte bound 262144 via BLOB length, JSON validity/required-field/type/identity consistency checks; receipt derives from these fields, not a second mutable JSON object |

Indexes: evidence `(tenantId,businessId,initiativeId,acceptedAt)`, binding `(businessId,status)`, and the uniqueness indexes above. UUIDs use the reviewed wire rules; bounded opaque deployment identifiers follow the counterpart whitelist. Credentials/receiver URLs never enter envelope or audit. Generate a report-only `zmr_` bearer with 32 cryptographic random bytes; persist SHA-256 only. Return raw credential once through an authorized private operator handover. Never return it through browser UI or audit, and never log authorization/body headers.

Insert guards reject mismatched Business/Tenant, binding/source/permission and initiative/plan scope using the actual native FK targets plus explicit cross-scope checks. Independent single-column UUID FKs alone are insufficient. Reject missing, soft-deleted or inactive eligible targets at intake/replay; initiative must be OPEN and its plan undeleted in the same Business. Report-linked native scope keys (Business tenant; initiative tenant/Business/plan; plan tenant/Business) cannot be reassigned while referenced; surgical guards prevent only these scope moves, not native content/lifecycle edits. FK RESTRICT plus no cascaded update of report keys protects retained evidence. Test native edit compatibility and these new restrictions explicitly.

SQLite has no assumed SHA-256 SQL extension: application strict validation calculates the reviewed hash over canonical envelope WITHOUT payloadHash; stored canonical bytes include that field. DB constraints check structural/hash-format/identity parity and immutability, not independent cryptographic truth. Validate digest and exact bytes again for replay. The storage trust boundary is the server/authorized operator controlling the SQLite file; this is not PostgreSQL RLS or protection against an operator replacing the file/triggers.

## Atomic authorization and replay

`POST /api/growth/external-marketing-reports` is the sole receiver route, using a dedicated principal. Strictly parse one bounded bearer; no Enterprise key/session fallback, fabricated Person or OWNER. Optional prelookup is only a cheap negative filter; it supplies no reusable grant. Require JSON/UTF-8, duplicate-key rejection, exact nested whitelist and reviewed canonical bytes within 256 KiB before accepting storage. Dedicated key alone cannot authorize Enterprise import or native Marketing routes; an independent valid human session retains its own existing semantics.

The first statement in each interactive Prisma transaction is a parameterized exact no-op binding guard UPDATE using the candidate key hash. It acquires the SQLite write transaction before any authorization SELECT; it must not bump version/time or write an audit. Inside that transaction, fetch binding, current policy, Business and target, and recheck all grants/scope. Missing policy, false flag, revoked key, inactive Business, missing/deleted/closed initiative or crossed scope refuses before evidence lookup/disclosure. Scope failures use a generic 404-shaped denial; invalid/missing/revoked credentials use generic 401.

```mermaid
sequenceDiagram
  participant Go as Explicit Go sender
  participant R as Dedicated receiver
  participant DB as SQLite transaction
  Go->>R: Frozen canonical envelope + dedicated bearer
  R->>R: Bound input and strict wire validation
  R->>DB: Begin; first statement is binding guard write
  R->>DB: Recheck binding, Business machine gate, target
  alt Exact authorized replay
    DB-->>R: Existing immutable receipt
  else New identity
    R->>DB: Scoped audit + immutable report/receipt
  else Same identity with different bytes
    DB-->>R: Conflict; no evidence changes
  end
  R->>DB: Commit transaction
  R-->>Go: 201 first acceptance / 200 exact replay
```

For a new identity, preallocate report/receipt/audit UUIDs, create the scoped existing `AuditEvent`, then the report referring to it, all in the same transaction. Persist acceptedAt once from the parent server clock. Audit uses `actorType = MARKETING_REPORT_BINDING`, `actorId = binding UUID`, explicit tenantId/businessId, entityType `MARKETING_EXTERNAL_REPORT`, action `REPORTED_EVIDENCE_ACCEPTED`, and IDs/hash only. Insert guard checks audit scope/entity/action/actor against the report. Failure anywhere rolls back all effects. Emit receipt only after the outer transaction resolves successfully. Replay creates no acceptance audit and returns identical stored receipt fields; different bytes under the same binding/report key yields 409 without overwrite.

New report-linked audit rows must also reject UPDATE/DELETE with narrowly scoped guards; preserve all pre-existing audit rows and policies. Existing `/api/audit` is installation-operator gated by `assertOperatorAndRecordUse`; do not create a report path through unscoped `listAudit`. Human evidence application reads call existing `assertMarketingReadAccess` each time and retain its current visibility/inactive-Business semantics. Machine replay uses the stricter current active target gate. No Guest/public projection, general report listing or full evidence UI is added.

SQLite allows one writer; taking the write transaction first orders intake against revocation and policy disable. Either acceptance commits before disable, or the later intake observes disable and denies even replay. Do not nest BEGIN IMMEDIATE inside a Prisma transaction. This proposed first-write guard needs real Prisma 5.22 multi-client verification before acceptance, not a mocked transaction proof. See [SQLite transaction semantics](https://www.sqlite.org/lang_transaction.html); current online Prisma docs describe a later ORM and are not authority for this installed client's API.

Retry the entire rolled-back transaction at most three attempts within a five-second overall database budget, including lock wait, with bounded 25/100 ms delay; each attempt reauthorizes. Map only demonstrated SQLite busy/locked or installed-client serialization conflict errors; do not blanket-retry all Prisma errors. A unique-key loser uses a fresh authorized transaction to compare the winning bytes and read the committed receipt. Unknown commit outcome cannot emit success: return generic 503 and let Go retain UNKNOWN/replay. Callback-local tentative receipt is never returned after outer commit failure. Native tests must establish error mapping and enforce the budget; failure to qualify blocks implementation acceptance.

## Native QA bindings proposed for approval

These are intended files, not test results or allocated TC records. Test-owned SQLite files must use the actual Prisma client/migration and separate connections/processes; Go uses its guarded disposable PostgreSQL and a private synthetic receiver. Never use restored Local/Production data, current parent DB or real credentials. Formal test IDs/bindings follow the sanctioned authoring workflow after approval.

| Candidate binding under `apps/server/tests/` | Required evidence | Canonical subject |
|---|---|---|
| `unit/marketing-report-wire.test.js` | Golden wire/receipt parity with Go; invalid UTF-8, duplicate/unknown keys, byte/hash/size/revision rejects; UNKNOWN/null retained | ZAI:FR-279 |
| `integration/marketing-report-identity.test.js` | No policy/default denial; enable/disable; inactive targets; revoked/crossed source/target; key isolation/no Person; successful acceptance followed by disabled/revoked replay denial | ZAI:FR-278 |
| `integration/marketing-report-receiver.test.js` | One report/receipt/audit; audit/commit failpoints rollback; lost committed response replay; byte conflict; guarded native evidence read; direct-SQL immutability/scope/FK/audit checks | ZAI:FR-279/280 |
| `integration/marketing-report-concurrency.test.js` | Multi-client identical/different-byte races, real lock exhaustion, concurrent disable/revoke, each retry sees fresh grants; bounded time and one committed outcome | ZAI:FR-278/279 |
| Cross-repository synthetic harness | Go freeze → explicit send → strict parent commit → validate receipt; dropped response → same-byte replay; verify native Marketing/PM/Commerce and Go source hashes/counts unchanged | ZAI:SDD-111; Go FR-015-004/005 |

Before merge of application code: all above native evidence, peer wire review, scoped independent architecture/security review, approved migration review, and preservation checks must pass. Before live migration/provision/send/deploy: obtain separately scoped operational approval and backup/target checks. Minimum retention is 90 days from acceptedAt; no automatic purge or manual deletion command. Private evidence and receipt persist after revoke.

## Backup and schema portability boundary

The existing application `backup-service.js` enumerates Marketing models explicitly and does not yet include these models. This slice proposes fail-closed application snapshot custody: if any policy/binding/report exists, legacy JSON snapshot export/import/replacement refuses before mutation instead of omitting retained data or attempting trigger-bypassing replacement. Imports carrying these unsupported model fields also refuse, including on an empty target. Inspect every supported backup/import entry point; require nonempty synthetic refusal/no-mutation tests. Extending the application snapshot format and its report→audit import ordering is deferred to a separately reviewed contract; never disable immutable guards or rotate/recreate bindings to make import succeed.

Private consistent whole-SQLite database backup/restore is the operational custody route meanwhile. It must preserve all three models, linked AuditEvent, native scope records, indexes and triggers together; copying an active file without its journal/consistent backup mechanism is not verified backup. Raw secrets remain outside DB backups; key hashes/policy state are private. A restore preserves existing scope/revocation/grant history exactly, does not authorize minting/rebinding/reactivating or a real report send, and requires the receiver stopped until the operator verifies credential custody/current grants and explicitly authorizes resuming it. Synthetic whole-database round-trip must prove receipt bytes/acceptedAt/audit linkage, immutable guards and disabled/revoked replay denial survive; real restore remains separately authorized.

Marketing charter also requires generated PostgreSQL Prisma schema and additive SQL artifacts to accompany parent schema changes. Generate/check them through the existing parent tools, including the new models and equivalent reviewed constraint intent; do not hand-write generated schema or infer PostgreSQL receiver runtime qualification from portability generation. SQLite remains the native receiver acceptance engine. Candidate migrations, exporter guards and tests are application work only after this proposal is approved.

Version diff 0 → 0.1.0: proposes the missing Business machine gate, physical immutable constraints, audit coupling, SQLite first-write serialization and native QA bindings. Adds no issued identities, application version, real database operation or delivery claim.

Version diff 0.1.0 → 0.2.0: records owner approval. Old task-qualified references remain historical until the reviewed fresh issuance provides new IDs; no alias or live operation is implied.
