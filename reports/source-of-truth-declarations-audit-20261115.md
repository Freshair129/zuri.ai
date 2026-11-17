---
doc_type: audit-record
status: active
version: "0.1.0"
source_revision: "379bd71e"
---

# `source_of_truth` declarations audit (ADR-118 O12 / D-D4)

Read-only audit of every tracked Markdown file that declares `source_of_truth`
in its YAML frontmatter, requested by delegated decision D-D4 (Astra,
gpt-6-astra, under owner instruction 2026-11-08; not human approval). It is a
dated evidence snapshot for the stated source revision. It changes no document,
enables no check and approves no re-labelling: `doc-sot-claim` and
`doc-duplicate-subject` stay disabled.

## Method and limits

- Population: all tracked `*.md` at `379bd71e` (1,921 files). A declaration counts
  only when the key sits inside the leading `---` frontmatter block, at the top
  level or nested under `attributes:`. The frontmatter block is parsed on its own,
  so mentions in body text or fenced code are not counted.
- Result: 18 declarations. The 17 recorded by the redesign proposal are all
  present; the 18th is that proposal itself (`false`), added after the count was
  taken. Values: `true` 8, `false` 8, `github` 2.
- Excluded as non-declarations: one fenced YAML example
  (`.brain/rca/2026-08-28-false-claims-passed-every-green-check.md`, quoting the
  ROADMAP header) and six body mentions (`docs/decisions/ADR-028-…`,
  `ADR-117-…`, `ADR-118-…`, `docs/plans/README.md`, `docs/roadmap/README.md`,
  `reports/gap-analysis-2026-09-02/02-domain-driven-gap.md`).
- Rule applied for the "would flag" column is the proposal's D5 wording:
  `true` is allowed only on a kind's source-of-truth owner (PRODUCT, an accepted
  ADR, a charter, a runbook for its procedure, `docs/roadmap/ROADMAP.md` for
  delivery state); a plan carries `false`. Among the eight `true` claimants only
  `docs/roadmap/ROADMAP.md` (`ZAI:ROADMAP`) and the GoVibe roadmap
  (`RM-govibe-mcp-runtime`) declare an `id`, and the two differ; the other six
  declare no subject, so duplicate-subject overlap cannot be computed for them and
  is not asserted.
- `github` is not a boolean. It appears to name where the facts live, not whether
  the file is authoritative.

## Disposition table

| # | File | Value | `status` | Observation | Disposition (recommendation only) |
|---|---|---|---|---|---|
| 1 | `docs/architecture/2026-10-22-visual-office-zuri-client-design.md` | false | candidate | Architecture specification, declared non-authoritative | Keep as is |
| 2 | `docs/architecture/DATA-PIPELINE-ARCHITECTURE.md` | false | candidate | Same | Keep as is |
| 3 | `docs/architecture/IDENTIFIER-AND-CODE-SYSTEM.md` | false | candidate | Same | Keep as is |
| 4 | `docs/architecture/project-manager-system/28-CURRENT-IMPLEMENTATION-AND-DELIVERY-STATUS.md` | github | candidate | Non-boolean; an evidence snapshot | Later: normalise to `false` plus a `source:` note; no edit now |
| 5 | `docs/domains/project-manager/README.md` | github | candidate | Non-boolean on a domain spine page | Same as 4 |
| 6 | `docs/plans/DOCS-ARCHITECTURE-REDESIGN-PROPOSAL-20261113.md` | false | candidate | A plan-kind proposal, consistent with the K9 rule | Keep as is |
| 7 | `docs/roadmap/PLAN-FR-040-PROJECT-WORK-VIEWS.md` | false | implemented | Plan, consistent with the K9 rule; sits in the legacy `PLAN-*` home | Keep as is |
| 8 | `docs/roadmap/PLAN-FR-041-BUSINESS-FIRST-STRATEGY-AND-HR.md` | true | approved | A plan claiming source of truth; D5 would treat it as a conflict | Owner/integrator decision whether to correct to `false`; would flag |
| 9 | `docs/roadmap/PLAN-FR-043-PROJECT-BUSINESS-OWNERSHIP.md` | true | approved | Same as 8 | Same as 8 |
| 10 | `docs/roadmap/PLAN-SMARTGIFT-DATA-BACKFILL-AND-CUSTOMER-IMPORT.md` | true (nested under `attributes:`) | beta | A plan (`doc_type: implementation-plan`) claiming source of truth; the title uses "Roadmap" | Same as 8 |
| 11 | `docs/roadmap/ROADMAP-business01-smartgift-delivery.md` | true | approved | A second claimant for delivery state next to ROADMAP.md; its own text records a wrong pointer inside a file that "declares itself `source_of_truth: true`" | Owner decision: separate ledger or projection; would flag as a second claimant |
| 12 | `docs/roadmap/ROADMAP-zuri-ai-24w-program.md` | false | approved | Derived projection of the cancelled programme (ADR-117) | Keep as is |
| 13 | `docs/roadmap/ROADMAP.md` | true | approved | The delivery-state owner (K10) | Keep as is; the one expected `true` |
| 14 | `docs/roadmap/line-oa-business-agent/README.md` | false | beta | Plan index, consistent | Keep as is |
| 15 | `reference/GoVibe/BACKLOG-task-scoped-context-injection.md` | true | approved | External GoVibe material, not a zuri-ai kind owner; the claim is about the GoVibe project | Leave untouched; treat `reference/` as external prior art; would flag |
| 16 | `reference/GoVibe/MASTERPLAN-govibe-production-readiness.md` | true | approved | Same as 15 | Same as 15 |
| 17 | `reference/GoVibe/ROADMAP-govibe-mcp-runtime.md` | true | approved | Same as 15; also declares its own subject `RM-govibe-mcp-runtime` | Same as 15 |
| 18 | `reference/GoVibe/WIREFRAME-A2-Roadmap-Board.md` | false | draft | External, declared non-authoritative | Keep as is |

## Summary

| Disposition | Rows |
|---|---|
| Consistent, keep | 1, 2, 3, 6, 7, 12, 13, 14, 18 (9) |
| Non-boolean value, normalise later | 4, 5 (2) |
| Plan claiming `true`, integrator/owner decision | 8, 9, 10 (3) |
| Second delivery-state claimant, owner decision | 11 (1) |
| External `reference/` claims, leave untouched | 15, 16, 17 (3) |

If `doc-sot-claim` were enabled today it would report seven existing files
(rows 8 to 11 and 15 to 17) and none of the others. That is a count of what the
audit found, not a request to enable the check: D5 stays disabled and any
re-labelling is a separate, separately approved change.
