---
id: ZAI:DATA-PIPELINE-ARCHITECTURE
title: Data pipeline architecture — how each pipeline is controlled
version: "0.2.0"
status: candidate
created_at: "2026-11-12"
last_update: "2026-11-13"
author: Claude Fable 5.2 (as-built description from a static review at 49b10eb3)
superseded_by: null
source_of_truth: false
attributes:
  doc_type: architecture-specification
  domain: platform
  scope: Control properties of every data pipeline — contract, preview, transaction, replay, failure handling, evidence
relations:
  - type: relates_to
    target: ZAI:DATA-PIPELINE-MAP
  - type: references
    target: ZAI:BR-009
  - type: references
    target: ZAI:SDD-009
  - type: relates_to
    target: ZAI:ADR-030
  - type: relates_to
    target: ZAI:ADR-049
  - type: relates_to
    target: ZAI:ADR-067
  - type: relates_to
    target: ZAI:ADR-068
  - type: relates_to
    target: ZAI:ADR-084
  - type: relates_to
    target: ZAI:ADR-085
  - type: relates_to
    target: ZAI:ADR-093
---

# Data pipeline architecture

[DATA-PIPELINE-MAP.md](../DATA-PIPELINE-MAP.md) answers *where data enters,
where it is combined and who receives it*. This page answers the other half:
*how each pipeline is controlled* — what it validates, whether it previews,
where its transaction ends, how a repeat is recognised, and what happens to a
record that fails.

It is a description of the code at `49b10eb3`, plus the 2026-11-13 additions listed in the version diff, not a new authority. The owning
charter, ADR and machine-readable contract decide each pipeline's behaviour.
A cell marked **unverified** was not established by the review; it is not a
claim that the property is absent.

## 1. Five kinds of pipeline

The word "pipeline" covers five different shapes here. They do not share one
control model, and a rule written for one does not automatically bind another.

| Kind | Shape | Control model |
|---|---|---|
| **Intake** | A person or client hands over a structured document | Envelope → validate → dry-run preview → one transaction → audit (BR-009, SDD-009) |
| **Event ingress** | A provider calls a webhook | Verify signature → capture durably → acknowledge → process asynchronously, de-duplicated by the provider's event id |
| **Staged run** | Work that crosses a process or system boundary | A durable run with per-stage evidence; no transaction spans the whole run |
| **Run ledger** | Workers report what they did | Append-only events keyed for idempotency; the ledger observes, it does not execute |
| **Lifecycle worker** | A scheduled job that removes or moves data | Per-Tenant transactions, a once-per-period guard, counts in one audit event |

The five kinds are not exhaustive. The inventory in §3 also holds migration
scripts, single commands that happen to feed a chain, read paths and
projections; those rows carry their own label. The lifecycle control model
above describes the scheduled sweeps (rows 22 to 24), not backup or restore.

## 2. The intake contract

`docs/ARCHITECTURE.md` §Business writes and import states it:

```text
structured input → schema validation → dry-run preview
                → conflict and authorization checks
                → one canonical transactional write → audit / import receipt
```

A new intake surface adds a converter into an existing envelope. It never adds
a second write path. Four intake families write canonical business records,
each with its own envelope:

| Family | Envelope | Converters | Commit |
|---|---|---|---|
| Project plans | `PlanEnvelope` (full plan, `schemaVersion` 1.0 to 1.2), `PlanDelta` (`schemaVersion` 1.3: project deltas and dependency registers, `import/plan-delta-schema.js`), `ExecutionPlanBundle` (`apps/server/contracts/`) | Wizard, JSON, Excel, MCP, marketing handoff, meeting actions | `apps/server/src/modules/project-manager/import/plan-import-service.js`; a bundle commits under one outer transaction in `import/bundle/bundle-commit-service.js` |
| Catalogue | Inventory intake envelope (ADR-084) | JSON, Excel, LINE `#sku` | `apps/server/src/modules/inventory/application/catalog-intake-service.js` — persisted plan, re-planned inside the commit transaction |
| Supplier cost sheets | Supplier-cost envelope | Excel, JSON | `apps/server/src/modules/procurement/application/supplier-cost-sheet-service.js` — draft preview, human-confirmed mappings, one transaction |
| Assets | `AssetIntakeEnvelope` | Excel, hashed Google Sheet snapshot | `apps/server/src/modules/asset-management/application/asset-intake-service.js`; registration is a second, separate transaction |

A fifth intake stages rather than writes: the SmartGift document intake
(`POST /api/ingest/documents`, contract `smartgift.document-intake.v1`) records
an incoming document as Integration-owned raw evidence and stops there (§3,
row 28).

There is no customer spreadsheet intake. The one customer load in the
repository is a fixed migration from a SmartGift snapshot (§3, row 5).

## 3. Inventory

Owner is the charter that owns the written models. "Hold" means a durable
state that keeps a failed record for a person to look at; a validation error
returned to the caller is a refusal, not a hold.

| # | Pipeline | Kind | Contract and validation | Preview | Transaction boundary | Repeat recognised by | On failure | Evidence | Owner | In the map |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Plan, delta and bundle import | Intake | Zod + JSON Schema; bundle semantics | Dry run | Plan: one transaction. Bundle: one outer transaction | `trace.idempotencyKey` — required for a full plan at `schemaVersion` 1.2, a delta at 1.3 and a bundle at 1.1; optional for a full plan at 1.0 or 1.1 and for a legacy bundle | Refusal with preview errors | Execution run/step, receipt, AuditEvent | project-manager | CH-10 |
| 2 | Catalogue intake | Intake | Envelope + per-item validation | Persisted, hashed plan | One transaction; plan re-computed inside it | Business + channel + correlation key, and the plan hash | Stale or conflicting plan refuses | Intake status, writer AuditEvents | inventory | CH-11 |
| 3 | Supplier cost sheet | Intake | Envelope normalisation | Persisted draft with mapping suggestions | One transaction after mappings are confirmed | Business + source SHA-256, and the preview hash | Unconfirmed or stale mappings refuse; the draft stays | Sheet and line status, `SUPPLIER_COST_SHEET_PREVIEWED` and `_COMMITTED` AuditEvents | procurement | CH-24 |
| 4 | Asset intake and registration | Intake | Strict envelope from the converters | Workbook or sheet preview | Intake: one transaction. Registration: a later one | Business + channel + correlation, bound to the payload hash | Invalid envelope refuses | `AssetIntake`, evidence, AuditEvents, ledger definition `DPL-ASSET-REGISTER-IMPORT-V1` | asset-management | CH-08 |
| 5 | SmartGift customer backfill | Migration script | Snapshot hash and a migration contract | Redacted dry-run receipt | Direct SQL transaction (`apps/server/scripts/apply_smartgift_customer_backfill.py`) | Batch id derived from contract + snapshot, plus row hashes | Duplicates and doubtful rows go to a review queue | Batch, provenance and review tables | crm | CH-20 |
| 6 | SmartGift business-knowledge import | Migration script | Field, version and hash checks | Reconciliation artifact | Generated SQL, run by an operator (`apps/server/scripts/build_business_knowledge_import.py`) | Batch and artifact hash; deterministic ids; upsert | Fails closed | Bootstrap audit event, row count | knowledge | CH-03 |
| 7 | LINE webhook → CRM → turn | Event ingress | Signature over bounded raw bytes; account binding | — | Raw capture and admission marker before the acknowledgement; ingest and job creation in one later transaction | LINE event and message ids | Capture failure returns non-2xx; stale admissions are reconciled from stored evidence | Raw evidence, `LineConversationJob`, CRM events, AuditEvents | line-oa-studio, crm, integration | CH-02, 18, 20, 22 |
| 8 | Notion webhook receipt | Event ingress | HMAC over exact bytes; Zod event schema | — | One receipt insert | Provider event id (the receipt's primary key) | Storage failure returns 503 | `NotionWebhookReceipt`; no AuditEvent per event was found | integration | Nodes `in.notion-webhook` and `s.notion-receipts`, no chain: no consumer processes a receipt (only backup export and restore carry the table), so no path reaches a recipient |
| 9 | Knowledge admission and 17 stages | Staged run | Source and envelope validation | None end to end | Per stage; Stages 9–17 run outside zuri-ai | Source and run identity; idempotency key | Failed and quarantined counts in stage evidence; a failed run can be replayed with lineage | `PipelineRun`, steps, gate decisions | knowledge | CH-04, 22 |
| 10 | Knowledge candidates from LINE | Staged run | Locator-only candidate; human decision | The review is the gate | Review, then normal admission | Candidate and source identity | Rejected or withdrawn candidates are not published | Audited review state | crm, knowledge | CH-22 |
| 11 | Stage reporter and evidence pull | Run ledger | Zod event and page contracts | — | One transaction per event or page; the cursor moves only after the page commits | Run + stage + attempt + outcome | An unmappable row blocks: the cursor stops before it, so the next pull sees it again | `KnowledgeEvidenceCursor`, ledger, AuditEvents | integration, knowledge | CH-05, 07 — replay and cursor not drawn |
| 12 | Pipeline run ledger and replay | Run ledger | `zPipelineRunInput`, `zPipelineEvent` | — | One transaction per operation | Idempotency key + request hash | Key reuse with a different body conflicts | `PipelineRun`, steps, receipts, AuditEvents (`apps/server/src/platform/integrations/core/pipeline-tracking-service.js`) | integration | CH-05, 07 |
| 13 | SoT decision loop | Run ledger (pull) | Zod types; payload hash | — | Scoped writes; export by cursor | Equivalent payload is unchanged; decided rows are immutable | — | `SotDecision`, AuditEvents | integration, identity | CH-15 |
| 14 | Market raw record → observation | Staged run | Lineage-preserving translation | — | Persist through the Market Intelligence service | Raw id + hash + schema + type | Unresolved classifications stay explicit | Observation status, run counts | integration, market-intelligence | CH-09 |
| 15 | Goods receipt → stock → ATP | Intake (command) | Domain validation | None | Receipt, stock movement and order version in one transaction | **unverified** | Refusal | Receipt and movement rows, AuditEvents | procurement, inventory | CH-12 |
| 16 | POS sale → payment → documents | Intake (command) | Branch, location and product checks | Billing has its own preview | Sale, stock issue and pending payment in one transaction; the document is issued separately | Billing: idempotency key + request hash | Conflict refusals | Order, payment, document, AuditEvents | commerce, inventory | CH-13 |
| 17 | Rich menu publish | Staged run | Account and image checks | Draft, then freeze | Job row persisted before the provider call | Job and correlation identity; provider retry **unverified** | Job status | Version and job status, AuditEvents | line-oa-studio | CH-14 |
| 18 | Broadcast intent | Intake | Validated plan; idempotency key required | — | Transactional planning writes | Intent key | Dispatch is not available, so nothing is retried | Intent status, AuditEvents | marketing | CH-19 |
| 19 | Backup export | Lifecycle | Snapshot schema | — | One read snapshot | — | — | An `EXPORTED` AuditEvent carrying the counts, plus the operator-use audit | project-manager | CH-17 |
| 20 | Snapshot restore | Lifecycle | Snapshot and recovery schema | Required, with explicit confirmation | One serializable replacement transaction over the replaceable snapshot models (Phase B families are not replaced); the file-content postpass runs after it | None | A failure inside the transaction rolls it back; a postpass failure comes after the commit and cannot undo it | `RESTORED` and `BACKUP_RESTORE` AuditEvents, written after the re-insert so the restore does not erase them | project-manager | CH-25 (`p.backup-restore`) |
| 21 | Managed-blob transfer | Staged run | Transfer contract; operator proof; custody checks | Export, then preview, then confirm; confirm needs a signed admission for a local TEST target (loopback `zuri_server_test`) | Per step; provider writes are outside any database transaction, and the metadata commit is the snapshot restore | Job id, lease, epoch, hashes | State conflicts refuse; an ambiguous provider write leaves the job `UNKNOWN` for operator `inspect`, never a blind retry | Job state, per-object receipts, `BACKUP_EXPORT` and `TRANSFER_*` AuditEvents | project-manager | CH-26 (`p.blob-transfer`) |
| 22 | CRM retention sweep and cold archive | Lifecycle | The Tenant's effective window (730 days, 24 months approximated, by default; an override is never longer); a message a non-terminal LineConversationJob still references is skipped | Dry run **not** supported | Per Tenant; the archive file is written and verified before the tombstone transaction, except lines of an erased, keyless Customer, which are deferred or blanked | One run per UTC day, checked before the run starts (not atomic) | A failed archive write leaves that Tenant's rows untouched for the next run | Manifests, counts, one `RETENTION_SWEEP_COMPLETED` AuditEvent per run | crm | Node `p.crm-retention-sweep`, no chain |
| 23 | Chat-archive expiry | Lifecycle | Chain verification | — | — | — | Lapsed legal-hold keys are expired first; if the Tenant's chain is then invalid, key and file destruction is skipped for that Tenant | An `ARCHIVE_EXPIRY_COMPLETED` AuditEvent on both a skipped and a completed run | crm | Node `p.crm-archive-expiry`, no chain. Since 2026-11-13 `POST /api/crm/archive-expiry` and the shared retention worker call it; the repository has a one-shot worker and `register-retention-sweep-task.ps1`, and whether a deployment has registered the task is not established here |
| 24 | MSP memory retention | Lifecycle | Bounded request (only `dry_run`); one configured Tenant; a window of at most 90 days that an override only shortens | Dry run supported | Per Tenant, in bounded batches (200 rows per table, at most 10 batches per run), through the MSP thread-retention tick, under a database fence | A fresh run id for each run; a run that started and never settled defers later runs for that Tenant | Defers while a job or memory delivery is pending; an uncertain provider call is reported `UNKNOWN` and an unsettled run holds the Tenant until a signed stopped-container attestation reconciles it | `MSP_RETENTION_REQUESTED`, `_STARTED`, one outcome event that carries the counts, and `_RECONCILED` | agent | Node `p.msp-retention`, no chain |
| 25 | Knowledge query and citation | Read path | Query contract and scope | — | None | — | An empty result is an answer | Citation and trace read model | knowledge, agent | CH-06, 21, 23 |
| 26 | Repository → readiness | Projection | — | — | — | — | — | Generated snapshots | project-manager | CH-16 |
| 27 | FlowAccount pull | — | **Declared only.** ADR-053 says no connector is implemented | — | — | — | — | — | integration | Marked declared |
| 28 | SmartGift document staging | Intake (staging) | `smartgift.document-intake.v1`; writing needs installation-operator authority, reading the monitor needs it or a visible Business | — | One transaction; it writes raw evidence, not a canonical record | The ingestion idempotency key on `RawExternalRecord`: Tenant, connection, entity type, document id and payload hash | A contract marked `QUARANTINED` is stored with that status | Raw record status; `DOCUMENT_INTAKE_STAGED` or `DOCUMENT_INTAKE_QUARANTINED` AuditEvent | integration | CH-27 (`in.document-intake`) |
| 29 | LINE raw payload retention | Lifecycle | The Tenant's effective window (90 days by default; an override is never longer); a record a live job or admission still needs is skipped | Dry run supported (it writes no run audit and skips the daily check) | Per page of 100 records; no Tenant-wide transaction | One run per UTC day, checked before the run starts (not atomic) | A failed page stops that Tenant; committed pages stay redacted, later rows are intact; the next run re-queries and skips existing tombstones | One `RAW_LINE_RETENTION_SWEEP_COMPLETED` AuditEvent per run, naming any `{ tenantId, code }` failure | integration | Node `p.raw-line-retention`, no chain |
| 30 | Agent trace payload retention | Lifecycle | The Tenant's effective window (90 days by default; an override is never longer); a turn that a live job, pending memory delivery or open erasure request still needs is skipped | Dry run supported (it writes no run audit and skips the daily check) | One transaction per turn | One run per UTC day, checked before the run starts (not atomic) | A failed turn stops that Tenant; committed turns stay redacted; the next run re-queries and skips existing tombstones | One `AGENT_TRACE_RETENTION_SWEEP_COMPLETED` AuditEvent per run, naming any `{ tenantId, code }` failure | agent | Node `p.agent-trace-retention`, no chain |

## 4. What a failed record does

There is no shared quarantine. The pipelines that can meet a bad record use
one of four behaviours, and the choice decides whether a person ever sees the
record again. Read paths, projections, restore (which rolls back), the Notion receipt (a non-2xx answer; whether Notion retries is the sender's policy) and the
declared-only row are not classified here.

| Behaviour | Meaning | Used by |
|---|---|---|
| **Refuse** | No canonical write commits and the caller gets the reason. A persisted preview, draft or audit row may remain | Every canonical intake (rows 1–4, 15, 16, 18). Catalogue intake and supplier cost sheets keep their preview or draft |
| **Hold** | The record is kept in a state a person resolves | Customer backfill review queue (5); document staging stores the raw record as `QUARANTINED` (28); a managed-blob transfer job left `UNKNOWN` waits for an operator `inspect` (21) |
| **Block** | Processing does not move past the bad record until it is fixed | Evidence pull: the cursor stops before the row (11). Archive expiry: an invalid chain skips customer-key and file retirement for the whole Tenant, after lapsed legal-hold keys were already destroyed (23). MSP retention: a run that started and never settled defers every later run for that Tenant until it is reconciled (24) |
| **Leave** | The source rows stay as they were and the next run tries again | Retention sweeps (22, 29, 30); LINE admission reconciliation (7) |

Two things look like a hold and are not. The knowledge pipeline's "quarantined"
figures are counts in stage evidence, not held records. The `DeadLetterRecord`
model exists in the schema, and the only code that names it is the backup
exclusion list — nothing writes or reads a dead letter.

## 5. Departures from the stated rule

These are places where the code does something the architecture summary does
not describe. None is hidden in the code; each is simply not written down
where a reader of the rule would look.

1. **The SmartGift migrations write domain tables by SQL, not through the
   owning application service** (rows 5 and 6). The customer backfill and its
   review-queue script (`apply_smartgift_customer_backfill.py`,
   `build_smartgift_customer_review_queue.py`) apply SQL directly, after a
   redacted dry run. The business-knowledge tool
   (`build_business_knowledge_import.py`) does not touch the database: it
   generates a SQL file that an operator runs. The "every write goes through a
   service" rule has no stated exception for either.
2. **A full plan at `schemaVersion` 1.0 or 1.1 has no replay key.**
   `plan-schema.js` requires `trace.idempotencyKey` for a full plan only at
   1.2, and `plan-import-service.js` reads it only there, so a repeated
   submission of an older full plan is not recognised as a repeat. Deltas (1.3)
   and handoff bundles (1.1) always carry a key; a legacy bundle may omit it.
3. **Staged runs have no end-to-end preview.** That is inherent — a run that
   leaves the process cannot be dry-run as one transaction — but BR-009 is
   worded as if every intake previews.
4. **Chat-archive expiry has no trigger.**
   `apps/server/src/modules/crm/chat-evidence-archive-expiry-service.js` states
   in its header that it is not wired to a route or a scheduled worker, and no
   caller exists in `apps/server/src` or `apps/server/scripts`. Unless something
   outside the repository invokes it, archive files and keys past the ten-year
   window are not destroyed. *Closed in code on 2026-11-13:* the run service and
   `POST /api/crm/archive-expiry` exist, the worker calls it after the CRM sweep,
   and ADR-093 1.3.0 makes expiry chain-safe (a retirement file is committed
   before an expired file is deleted). It still needs an operator to set
   `ZURI_RETENTION_SWEEP_TOKEN` and register the task.
5. **Raw LINE payloads and agent trace payloads have no age-based sweep.**
   ADR-091 gives both a 90-day window; `retention-sweep-service.js` names them
   as another domain's job and no sweeper for either was found. *Closed in code
   on 2026-11-13:* Integration (`raw-line-retention-sweep-service.js`) and Agent
   (`trace-retention-sweep-service.js`) each sweep their own model, with routes
   under `/api/integration/raw-retention-sweep` and
   `/api/agent/trace-retention-sweep`. Whether a deployment has registered the scheduled task is not established by the repository.

6. **Snapshot restore commits its metadata in one transaction and its file
   content after it** (row 20). `importSnapshot` replaces every replaceable
   snapshot model for every Tenant in one Serializable transaction (the Phase B
   families are not replaced; plugin installations and workspace mounts are
   cleared and only the supplied remounts recreated), then
   `restoreFileAssetPostpass` runs outside it and reports
   `unresolvedContentFileIds`. A restore is a replacement, not an intake, so
   BR-009 does not describe it; the post-commit step is the part a reader of
   "one transaction" would not expect.
7. **Managed-blob transfer writes objects outside any database transaction**
   (row 21). Each provider write is a recorded, fenced step; an ambiguous one
   leaves the job `UNKNOWN` until an operator runs `inspect`. Its confirm step
   is refused unless a signed admission names a local TEST target (loopback
   `zuri_server_test`) bound to the source package and synthetic-dataset
   evidence (`MANAGED_BLOB_TRANSFER_NOT_ADMITTED`). The code does not prove that
   database is disposable.
8. **SmartGift document staging stops at raw evidence** (row 28). The receipt
   names `DOMAIN_VALIDATION` as the next step (`REVIEW_REQUIRED` when
   quarantined), but nothing under `apps/server/src` promotes a staged record to
   a canonical row: the code reads staged records only for the duplicate lookup,
   the monitor and backup.
9. **The Notion receipt keeps no audit trail per event** (row 8). It stores the
   event id, type, workspace and times, and discards the payload; only the
   operator's reveal and reset of the verification token are audited.

## 6. Differences from the map

The map's registry is validated by its generator, which can only check what the
registry names (DATA-PIPELINE-MAP §1). The seven implemented flows that this
page used to list as missing are now registry nodes (2026-11-13):

| Flow (row) | Nodes | Chain |
|---|---|---|
| Supplier cost-sheet intake (3) | `in.supplier-cost-sheet`, `p.cost-sheet-planner`, `s.supplier-cost-sheets` | CH-24 |
| Notion webhook receipt (8) | `src.notion`, `in.notion-webhook`, `s.notion-receipts` | none: no recipient |
| Snapshot restore (20) | `src.operator`, `p.backup-restore` | CH-25 |
| Managed-blob transfer (21) | `p.blob-transfer` | CH-26 |
| CRM retention sweep and cold archive (22) | `p.crm-retention-sweep`, `p.crm-archive-expiry` (row 23) | none: a lifecycle loop |
| MSP memory retention (24) | `p.msp-retention` | none: a lifecycle loop |
| SmartGift document staging (28) | `in.document-intake` | CH-27 |

The two 90-day sweepers of rows 29 and 30 were mapped with the retention change
(`p.raw-line-retention`, `p.agent-trace-retention`). The ledger's replay API and
the evidence-pull cursor (11, 12) are implemented but not drawn as edges.

The generator projects only a node's id, kind, system, label, detail, domain,
requirement ids, decisions, surfaces and status, so there is no field for a
failure behaviour, an idempotency key or an audit action. Those properties stay in this inventory, and each
new node's `detail` repeats the ones a reader of the picture needs.

New registry changes follow DATA-PIPELINE-MAP §6: each node needs a real surface
path and requirement ids the readiness snapshot knows, and `npm run govern`
regenerates `apps/server/runtime/data-pipeline-map.json`.

## 7. Adding a pipeline

1. Decide its kind from §1. The kind fixes the control model.
2. Intake: reuse one of the four envelopes in §2, or justify a fifth in the
   owning charter. Write a converter, not a writer.
3. Name what identifies a repeat, and store it under a unique constraint.
4. Choose a failure behaviour from §4 on purpose, and say which in the charter.
5. Record evidence a person can read later: counts, the actor, the scope.
6. Add the node, edges and chain to the map registry in the same change (DATA-PIPELINE-MAP §6).
7. A lifecycle worker is not finished until something calls it on a schedule.

## Version diff

0.1.0 → 0.1.1 (2026-11-13): findings 4 and 5 and the flow 23 row note that the
expiry trigger, the chain-safe retirement and the two 90-day sweepers now exist
in code. The body of the document remains the static review at `49b10eb3`.

0.1.1 → 0.2.0 (2026-11-13): the seven flows the map registry lacked are now
registry nodes with chains CH-24 to CH-27 (§6), checked against source on main
`d01c388c`. Rows 3, 8, 20 to 24 and 28 now name their nodes; rows 20, 21, 22, 24
and 28 are corrected against the code (restore evidence, the transfer's TEST
admission, the CRM sweep's window and skip rule, MSP retention's fence and
reconciliation, and the operator-only writer of document staging). Rows 29 and
30 add the two 90-day sweepers; §4 and §5 items 6 to 9 follow. Rows not named
here were not re-verified.

0.0 → 0.1.0 (2026-11-12): first inventory of pipeline control properties, the
four failure behaviours, the departures from BR-009 / SDD-009 and the flows the
map registry does not yet contain. Introduces no pipeline, model, requirement
or rule.
