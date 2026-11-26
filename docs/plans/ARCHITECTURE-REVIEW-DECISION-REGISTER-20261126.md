---
status: implementation-plan
version: "0.1.0"
source_of_truth: false
---

# Architecture-review decision register D1–D16 (2026-11-26)

**Purpose.** One place that says, for each review decision, what it decided, who decided it, where
it is recorded, what is still open and when it is next reviewed. It decides nothing and changes no
code. It was written from the repository at `main` (`b01da202`); every row cites a path. A cell that
says "no record" means no file under `docs/` carries it, not that the decision was never made.

**Two numbering families.** `D-D1`…`D-D4` are the documentation decisions of
[ADR-118](../decisions/ADR-118-DOCUMENT-KINDS-AND-WRITE-HOMES.md) (`:230-231`). `D-D5`…`D-D13` are
the architecture-review decisions. `D14`–`D16` are not recorded anywhere in the repository; the
owner has to supply their wording (see the end of this note).

**Who decided.** "Delegated" means a delegated product-owner decision by Astra (`gpt-6-astra`) under
owner instruction 2026-11-08, relayed by the lead Claude session; it is **not** human approval. The
owner's own decisions are marked "owner".

| ID | Subject | Status | Decided by | Recorded in | Still open | Next review |
|---|---|---|---|---|---|---|
| D-D1 | `docs/governance/` and `docs/migrations/` write homes; where new reports go | approved | per ADR-118 | ADR-118 `:230` | none recorded | none set |
| D-D2 | `reports/**/*.md` counted as documentation in CI | approved, separate change | per ADR-118 | ADR-118 `:231` | whether the separate change landed is not recorded here | none set |
| D-D3 | Fold the Compact narrative of `docs/README.md` into the report index | approved, separate change | per ADR-118 | ADR-118 `:231`; `docs/README.md:226` | as D-D2 | none set |
| D-D4 | Audit the `source_of_truth` declarations | approved, separate change | per ADR-118 | ADR-118 `:231` | no duplicate-subject or source-of-truth check is enabled | none set |
| D-D5 | Phase B recovery: contract, export and offline verifier only (option C) | decided | delegated (as written in the design doc) | `docs/architecture/2026-10-22-visual-office-zuri-client-design.md:455,461`; `docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md` | clean-target restore and production recovery deferred; audit carriage in the export package unspecified | none set |
| D-D6 | `Person` is owned by identity, not crm | decided | delegated | `docs/domains/identity/CHARTER.md:202`; `docs/domains/crm/CHARTER.md:303` | none recorded | none set |
| D-D7 | Keep the deterministic primary keys of eight Knowledge models | accepted | delegated | [ADR-123](../decisions/ADR-123-KEEP-DETERMINISTIC-IDS-OF-EIGHT-KNOWLEDGE-MODELS.md) | `KnowledgeChunk`, `PlanImportReceipt` and singleton rows remain unrecorded (`docs/architecture/IDENTIFIER-AND-CODE-SYSTEM.md:310`) | none set |
| D-D8 | `Customer.code` unique per Tenant | accepted; migration written, **not applied** | delegated | [ADR-122](../decisions/ADR-122-HUMAN-CODE-UNIQUENESS-SCOPE.md); [checklist](D8-CUSTOMER-CODE-TENANT-SCOPE-MIGRATION-CHECKLIST-20261125.md) | owner applies the migration (ADR-057) and confirms the apply receipt; deploy-to-apply gap (checklist section 3) | on apply |
| D-D9 | Forced-RLS equivalence of a self-hosted production PostgreSQL | **deferred** | none | [evidence note](D9-D10-D12-DEFERRED-DECISIONS-EVIDENCE-20261125.md) | target-specific isolation contract; Compact RLS is `USING (true)` outside six Phase B tables; no authorised-host evidence | none set |
| D-D10 | Authentication session idle timeout, throttled `lastSeenAt`, logout-all | accepted, implemented (PR #865) | **owner** | [ADR-124](../decisions/ADR-124-SESSION-IDLE-TIMEOUT-AND-LOGOUT-ALL.md) | audit event and profile-page UI for logout-all added (G10, 2026-11-26); multi-instance tests against a real store | 2026-12-12 |
| D-D11 | Verified settlement before order completion and stock issue | accepted | delegated | [ADR-120](../decisions/ADR-120-VERIFIED-SETTLEMENT-BEFORE-ORDER-COMPLETION.md) | none recorded | none set |
| D-D12 | Direct-SQL scripts as an exception to the service boundary | **deferred**, reduced by ADR-119 | none | [evidence note](D9-D10-D12-DEFERRED-DECISIONS-EVIDENCE-20261125.md) | audit evidence, immutable input record and recovery evidence per script; assess `phase-b-recovery.mjs` | none set |
| D-D13 | Stage 9 outbox retention and recovery | accepted as a **decision only** | delegated | [ADR-121](../decisions/ADR-121-STAGE9-OUTBOX-RETENTION-AND-RECOVERY-CONTRACT.md) | ADR-121 edits no code: unbounded `requestJson` retention (F1, F3) and unfiltered reply storage remain; numeric bounds in D4 await confirmation | none set |
| D14 | no record | unknown | unknown | none | wording needed from the owner | none set |
| D15 | no record (reported deferred) | deferred | none | none | wording needed from the owner | none set |
| D16 | no record (reported deferred) | deferred | none | none | wording needed from the owner | none set |

## Owner-only follow-ups that hang off these rows

- Apply migrations `20261120000000` (SmartGift data drop) and `20261125120000` (D8) on production and
  keep the apply receipts. `docs/roadmap/ROADMAP.md` does not yet mention ADR-120 to ADR-124 or either
  migration.
- Confirm or replace the first numeric bounds in ADR-121 D4.
- Review D10 by 2026-12-12.

## What this note does not do

It does not record D14–D16, does not edit `docs/roadmap/ROADMAP.md` (live delivery state is updated
by its own process), and does not claim any migration is applied.

## Version history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-11-26 | Claude Sonnet 5.5 | Initial register from the 2026-11-26 gap analysis (G8). |
