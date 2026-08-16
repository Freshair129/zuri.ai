---
version: "0.1.0b"
created_at: "2026-08-17T00:05:00+07:00,CLAUDE"
last_update: "2026-08-17T00:05:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "session-record"
  doc_type: "session-summary"
  scope: "2026-08-16 — branch cleanup, governance rebuild, agent topology, Development domain build"
---

# Session summary — 2026-08-16

One session, four phases: clean up, decide direction, restructure the
documentation so agents can work in lanes, then use those lanes to build.

`main` moved from a repository with 31 branches and a red `docs:check` to one
branch, 783 passing tests, 39 green e2e specs, and 59/59 FRs with both code and
tests.

## Phase 1 — cleanup and the harness

Started from "which branches can be cleared?" and ended with 15 local + 16 remote
branches reduced to one. Along the way three harness defects were found and
fixed, each with its own RCA:

- **`docs:check` was red on pristine `main`** — 133 of 160 "drifted" nodes were
  pure line-ending artifacts, plus a self-referential comparison that required
  two passes to converge. Fixed by a single normalization seam
  (`scripts/canonical-text.mjs`) and by excluding generated views from the scan.
- **A stale Prisma client** failed 51 tests. Root cause was `--skip-generate` in
  the test bootstrap; refined into a schema-fingerprint gate with an atomic lock
  so concurrent runs cannot race.
- An orphaned FR-052 contract test was salvaged rather than deleted.

## Phase 2 — direction (ADR-024)

The owner settled a long-running ambiguity: **zuri-ai is a standalone product**,
not "Zuri V2", and has no relationship to the legacy `G:\zuri` project. ADR-024
retired the replace-by-reuse program with zero modules ever lifted, deleted the
V1 scaffolding, and — importantly — added a **historical-vocabulary guard** so
that reading old ADRs full of "V1/V2" cannot resurrect a dead plan.

A correction from the owner is worth recording: V1 was never in production. Only
test data and a dev LINE OA account ever existed, which invalidated a
"live production" claim that had been sitting in `CLAUDE.md`.

## Phase 3 — documentation architecture (ADR-025, ADR-026)

**ADR-025 — domain-driven spine.** Chosen over role-based and feature-based
organization for one reason that transfers everywhere: domains are the slowest-
moving axis and the axis on which write ownership is already defined. Each
domain gets `docs/domains/<d>/CHARTER.md` — the lane definition an agent reads
before touching anything. Preflight enforces the lanes: a module without a
charter, a model claimed twice, a feature note whose `domain:` disagrees with its
folder, all become CI failures instead of archaeology.

Revision 2 separated two id families the project had been conflating:
**FR = functional requirement** (a precise system behaviour), **FEAT = feature**
(a product capability bundling one or more FRs).

**The drift RCA.** The owner asked why code and docs diverge. The investigation
refuted the obvious hypothesis: every "undocumented" thing was thoroughly
documented. The real finding was sharper — *generated guarantees consistency
with the generator, not with the world*. A string-replace edit had silently
no-opped, leaving `FEATURE-MAP.md` blind to all 26 feature notes while
`docs:check` stayed green. The fix was blindness guards: a generated view must
prove it saw its inputs.

**ADR-026 — agent topology.** Domain agents are permanent desks (one per
charter); role workers are transient hats with no authority of their own;
scheduling is exactly two layers with a per-domain queue, claim-under-lease, and
single-writer-per-lane. Cross-lane work is **split, never granted**. Adaptive
scheduling was deliberately deferred and instrumented for rather than built.

## Phase 4 — the Development domain build

Run as a tiered multi-agent build at the owner's direction: Fable 5 planned,
Sonnet implemented, Haiku ran read-only ownership checks, an adversarial Opus
gate reviewed each wave, and the orchestrator ran final verification.

**The plan's first finding changed the task.** There was no domain to create:
"Development" is a Tier-2 UI domain-bar entry whose code lane is the already-
chartered `src/modules/project-manager`. A `docs/domains/development/` folder
would have double-claimed 26 models. The domain was also far more complete than
assumed — 9 sidebar entries, all with live routes, no stubs. Only two real gaps
existed, both recorded by the repository itself.

Shipped as [PR #30](https://github.com/Freshair129/zuri.ai/pull/30):

| | |
|---|---|
| **FR-058** | File Manager renders one asset set in four switchable views — grid / timeline / by-project / preview |
| **FR-059** | Audited write slice for Business Strategy — the follow-up FR-041 declared for itself |

The gates ran eight waves and returned **FAIL twice** and **PASS WITH FIXES three
times**. Without that layer the merge would have shipped: cross-Business write
access, permanent goal deletion on a roadmap rename, a broken `db:seed`, and a
red CI.

Every defect found has its own incident file in `.brain/rca/`:

- global role read as per-Business authority (three instances)
- horizon replace orphaning every goal
- UI renumbering breaking the idempotent seed
- modal lifecycle: Cancel discarding nothing, focus escaping the dialog
- e2e subset-green and shared state
- `test:e2e` exiting 0 without running
- narrow selects silently dropping fields
- a write contract outrunning the read contract
- preflight reading a stale graph

## What this session taught about verification

Three techniques did the actual work, and none of them is "run the tests":

1. **Run it yourself.** Seven agents and two gates reported the e2e suite green.
   The orchestrator ran the whole suite and found three failures — including a
   spec that no task had touched.
2. **Prove the red state.** The first authorization fix came with tests that
   looked correct and proved nothing, because their fixtures were shapes the
   resolver cannot emit. The accepted fixes each demonstrated the test failing
   against the old behaviour first.
3. **Get evidence from the running system, not the source of truth's
   description of itself.** The gate extracted live DDL from `prisma/dev.db`
   rather than trusting `schema.prisma`; it built a real principal in a real
   database rather than trusting a fixture; it drove a real browser rather than
   trusting a source-text assertion.

A fourth, about delegation: **workers that stop at their lane boundary find more
than workers that don't.** Twice an agent hit a defect in a file it did not own,
reported instead of fixing, and the report led to a second instance of the same
defect that nobody was looking for.

## Merged this session

| PR | |
|---|---|
| #15–#22 | harness fixes: line-ending normalization, per-run test DB, fingerprint-gated client generation |
| #23–#24 | ADR-024 and the V1/V2 retirement sweep |
| #25–#27 | docs sweep, domain spine (ADR-025), trace chain closed with FEAT registry and generated views |
| #28 | CLAUDE.md / AGENTS.md synced with the trace-chain work |
| #29 | ADR-026 — agent topology for the Visual Office |
| #30 | FR-058 + FR-059, with two authorization holes closed |

## Open, deliberately

- **Domain visibility still uses the global-OWNER shortcut** — confirmed against
  real data this session (a MEMBER of Business B who owns an unrelated Business A
  sees all 7 domains instead of their granted 1). Not fixed: `visibleDomains` is
  a flat array and the correct answer is per-Business, so it is a viewer contract
  change and needs its FR declared first.
- Cross-tenant read leak in `listUserPermissions` — proven, unreachable today.
- `PermissionRow.save` swallows errors with no user feedback.
- `npm run test:e2e` can exit 0 having run nothing.
