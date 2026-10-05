---
doc_type: intake-note
title: Marketing report custody and Phase B frozen inventory rebind
status: draft
superseded_by: null
version: "0.1.0"
date: "2026-10-05"
complexity: C-3
risk: HIGH
---

# Phase B compatibility proposal

Parent intent: FR-252 and `docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md` require an exact frozen schema inventory, complete target-table census and clean-target recovery. Peer contract: approved `ZURI-GO-REPORT-PHYSICAL-DESIGN.md` requires retained report custody, fail-closed legacy JSON snapshots and consistent whole-SQLite backup meanwhile. It explicitly defers extending the JSON snapshot format and report/audit import ordering.

Evidence: PR633 CI run37313759406 cannot collect `phase-b-recovery.test.js`: `loadFrozenSchemaInventory()` refuses the current schema. The old frozen inventory/pins describe194 models; the approved additive receiver introduces MarketingReportPolicy, MarketingReportBinding and MarketingExternalReport, giving197. The old loader refusal is the intended checksum fence, not grounds to bypass it. Separate stale ID/count fixtures are corrected under the already approved main-first reconciliation; they do not fix this compatibility gate.

Proposed bounded change for approval:

1. Preserve all194 existing inventory mappings exactly, append only these three public model/table mappings, and compute raw Prisma schema SHA256 plus `computeTargetSchemaSha256` using the existing canonical function. Pin both exact hashes and197 count in the loader. Record the old194 binding as historical in the canonical Phase B decision; continue refusing old or tampered schema/inventory pairs.
2. Keep the three new models excluded from JSON snapshots with the existing explicit custody reasons. Include all three in target census/privilege/lock checks. Any nonempty or unreadable custody table must refuse protected export and replacement/import before mutation. Imports containing unsupported report/policy/binding fields must refuse even on an empty target. Do not add them to SNAPSHOT_MODELS, import/delete ordering or recovery-family delegates, and never disable immutable triggers.
3. Verify exact preservation of194 mappings, exact197 current-model coverage, recomputed hashes, rejection of old/tampered bindings, complete included/excluded accounting and nonempty/unknown custody denial/no mutation through every Phase B entry point. Re-run Phase B integration, receiver native regression, governance and impacted CI. Independently review the pinned artifact and changed boundaries before merge.

Acceptance: current empty-custody schema can load the exact inventory and existing valid recovery fixtures; nonempty/unsupported custody remains fail closed, and no report/receipt/audit is omitted or overwritten. Private consistent whole-SQLite backup stays the sole accepted nonempty custody route. This proposal adds no real migration, backup/restore, credential, binding, send, deploy or merge authorization.

Tradeoff: this narrow rebind restores compatibility for empty-custody Phase B workflows while retaining the approved refusal for nonempty Marketing evidence. Supporting those retained records in JSON recovery requires a separate format/order contract and is deferred. Leaving the old binding unchanged is safe but blocks CI and merge of the receiver schema.

Version diff0→0.1.0: documents a new parent/peer compatibility gate for review. No Phase B code, schema pins or frozen inventory is changed by this proposal.
