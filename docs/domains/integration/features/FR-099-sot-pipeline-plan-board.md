---
domain: integration
feature: FR-099
module: integration
source: v2-native
version: "0.1.0"
status: proposed
---

# FR-099 — SoT pipeline plan board

## Rationale

The business-wide Source-of-Truth pipeline (Drive → landing → extract → curate →
DuckDB → knowledge graph → serving; design: Zuri SoT Pipeline, 2026-08-24,
approved by Boss) runs outside this repository, but the plan that governs it and
the humans who steer it live here. Until now the plan existed as a design page
and chat threads — nothing in the product showed where the pipeline stands, and
"done" claims could not be traced to run evidence.

FR-099 gives the plan one authoritative, viewable home: a board of the pipeline's
phases (P0–P10) whose status is **derived from FR-071 run evidence**, never typed
in. A phase with no runs is `planned`; the board can never disagree with the
tracking data it reads.

## Contract

1. **The plan is data.** `contracts/sot-pipeline-plan.v1.json` declares the
   phase list: `{ planId, version, phases: [{ phaseId: "P0".."P10", title,
   titleTh, summaryTh, kind: AUTOMATED|HUMAN_GATE, dependsOn: [phaseId],
   pipelineDefinitionIds: [] }] }`. The file is `.strict()`-validated by
   `zSotPipelinePlan`; an unknown field fails the load. Phase ids are keys —
   never renumbered (AGENTS.md §18 spirit).
2. **Status is derived, not stored.** For each phase, status =
   - `planned` — no linked runs exist;
   - `running` — a linked `PipelineRun` is QUEUED/RUNNING;
   - `blocked` — the newest linked run FAILED, or a required FR-100 decision for
     this phase is PENDING;
   - `done` — every `pipelineDefinitionIds` entry has a newest run SUCCEEDED and
     no required decision is PENDING.
   The derivation is a pure function (`sot-plan-status.js`) with unit tests; the
   route composes it from `listPipelineRuns` + FR-100 decision counts.
3. **Viewer-scoped.** `GET /api/platform/sot/plan` resolves the viewer
   (`resolveRequestViewer`) and requires Business access via the same authority
   the Platform shell uses; the response carries phases + derived status +
   per-phase run/decision counts. No mutation endpoints exist in FR-099.
4. **One board page.** `/platform/sot-pipeline` renders the phases in dependency
   order with Thai titles, status pills, and per-phase evidence links (runs,
   pending decisions). It is a reader surface: the only actions it offers are
   navigation into FR-100's inbox and FR-071's run evidence.

## Not in scope

No editing of the plan from the browser (the plan file changes by PR), no
scheduler, no writes to `PipelineRun`, and no dependency on the unmerged
`codex/platform-control-roadmap` branch — the board is a new leaf under the
Platform shell.
