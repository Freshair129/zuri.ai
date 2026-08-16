# Parallel Execution Plan — Agent Types & Gate Model

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Active |
| **Author** | Owen + Claude |
| **Created** | 2026-08-12 |
| **Governs** | Track 1 (ADR-003 cutover) and Track 2 (ADR-007 LINE/AI stack), run in parallel |

## 1. Two gate tiers (answering "how many gates")

**Tier 1 — six release gates (A–F), one per phase.** From [ADR-007](ADR-007-LINE-AI-STACK-SEQUENCING.md).
A phase does not "ship" until its gate's definition-of-done is met and signed off by a
Reviewer **and** (for anything touching auth/data/write) a Security-Auditor. Gate
status is recorded on the Mission Control roadmap.

| Gate | Phase | Track | Ships when |
|---|---|---|---|
| **A** | P1 Extract MSP | 2 | MSP boots standalone · client connects externally · CRUD/search/vault-isolation/context/decay/replay · contract+security+integration tests green · **GoVibe still consumes it unchanged** |
| **B** | P2 Zuri Backend Slice | shared | Tenant/Customer/Conversation/LINE/Permission hardened; impact-scan filed for every change |
| **C** | P3 Identity | shared | Principal/ExternalIdentity/AccountLink; staff↔customer auth separated; `lineUserId` no longer the primary customer id |
| **D** | P4 Persistence | shared + 2 | Zuri→Postgres/Supabase; Zuri DB ≠ MSP DB; per-tenant migrate preserves UUIDs (Track 1) |
| **E** | P6 Agent read-only | 2 | agent does search/read/recommend/answer only, on settled contracts |
| **F** | P7 Agent write | 2 | authorization + audit + step-up auth complete; only then refund/cancel/update/payment/modify |

**Tier 2 — the per-task review gate (recurring inside every build task).** The
subagent-driven discipline: **Builder → Reviewer → Fix**, never the builder reviewing
itself. Hard gates (block the task): compiles/typechecks, contract-aligned (ids/shapes
identical across layers), no fake/fixture data, no cross-file value divergence. Soft
gates (note, batch-fix): style, naming, comments. This is exactly what caught the
phone-vs-dashboard number divergence in the demo build.

So: **6 release gates + 1 recurring review gate.**

## 2. Seven agent types

| # | Agent type | Does | Reads/Writes | Model |
|---|---|---|---|---|
| 1 | **Scout / Impact-Analyst** | discovery; dependency & impact scans; parity inventories; classify MUST-UPDATE / REVIEW / TEST-ONLY / NO-IMPACT | read-only | sonnet |
| 2 | **Builder** | writes code on a branch, scoped to non-overlapping files, against a fixed interface contract | writes source only; no run, no deploy, no install, no commit | sonnet / opus by complexity |
| 3 | **Contract-Test Author** | records request/response fixtures; writes contract + security + integration tests **before** internals are reimplemented (ADR-003 §D6; Gate A) | writes tests | sonnet |
| 4 | **Reviewer / Verifier** | adversarial review gate: typecheck, contract alignment, consistency, "prove it wrong"; separate agent from the builder | read-only + typecheck | opus |
| 5 | **Security-Auditor** | specialised adversarial pass on auth/identity/vault-isolation/step-up/write-capability; blocks Gate C/D/F | read-only | opus / high |
| 6 | **Integrator / E2E** | wires settled contracts; runs the end-to-end path; owns Gate D/E/F evidence | integration branch | opus |
| 7 | **Migration / Data** | per-tenant export→migrate→import with UUID preservation (Track 1); DuckDB/Supabase/MSP-store persistence (both) | migration scripts + reconciliation | sonnet / opus |

## 3. How the two tracks run in parallel

```text
NOW ─────────────────────────────────────────────────────────────────────
  Track 2  ── P1 Extract MSP ───────────────► Gate A     (independent — start now)
  Demo     ── close-out spike (branch demo/smartgift-seam) ► exec demo
  Shared   ── P2.5 Impact-scan Zuri slice ──► scope for P2

THEN ────────────────────────────────────────────────────────────────────
  Shared   ── P2 Zuri Backend Slice ─► Gate B ─► P3 Identity ─► Gate C ─► P4 ─► Gate D
                                                     │
              ┌──────────────────────────────────────┴───────────────────┐
  Track 1     P4 per-tenant migrate · shell lift · nine-owner switch · cutover
  Track 2     P5 Knowledge ─► P6 Agent (Gate E read-only) ─► P7 E2E ─► Gate F (write)
```

**Parallelism rules**
- P1 (MSP extract) and P2.5 (impact-scan) and the demo close-out are independent — run
  concurrently now.
- Within a phase, Builders fan out on **non-overlapping files** with the interface
  contract fixed up front (as the seam swarm did); Reviewer + Security-Auditor gate.
- Cross-phase order is dependency-locked: **Identity (C) before MSP↔Zuri wiring**;
  **contract tests before internals**; **read-only agent (E) before writing agent (F)**.
- Memory is keyed by **principal, not channel** — enforced at P3, never before.

## 4. Standing guardrails for every agent (all tracks)

- `G:\zuri` and `G:\govibe` are **read-only reference** unless a task explicitly owns a
  file there; the demo/extraction copies out, never mutates the source in place.
- **Never read any `.env`.** Env var *names* in code are fine; values are not.
- No agent runs a live server, sends a real LINE message, deploys, or installs packages
  unless a human-owned ops step authorises it (the DEMO-OPS-CHECKLIST pattern).
- No agent commits; the controller/owner reviews `git diff` on a branch and commits.
- Every schema/API/authority/runtime change carries an impact classification before merge.
