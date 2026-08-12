# Demo Runbook — SmartGift Executive Demo

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Draft — blocked on four owner decisions (§6) |
| **Author** | Claude |
| **Created** | 2026-08-12 |
| **Goal** | The fastest credible executive demo ("ส่งมอบตัวอย่างให้ทีมบริหาร") for Business-01 SmartGift |
| **Basis** | Read-only scan of 5 systems (`smartgift-demo-scoping` workflow, 2026-08-12) |

## 0. The one-sentence story

Everything the demo needs **already exists and runs** — it is scattered across five
repos. This is a **join, not a build**: a battle-tested LINE transport
(`zuri-command-agent`) meets a battle-tested Thai data brain (`explore_agent` over
`sot.duckdb`), the roadmap shows on GoVibe Mission Control (which already parses
Zuri's roadmap dialect), memory comes from GoVibe's MSP runtime, and the knowledge
graph SmartGift has **already synced and evaluated** (17.9k nodes, eval 4/4) is the
picture behind the answers.

## 1. What is real vs what is not (ruthless maturity)

| Component | Reality | Evidence |
|---|---|---|
| SmartGift data (`sot.duckdb`) | **Working** — clean, provenance-stamped | 8,285 docs, 3,569 customers, quotations ฿1.29B, billing ฿78M, 2020–2026 |
| Q&A brain (`explore_agent`) | **Working** — Thai RAG + graph + local LLM + citations | 354 pytest passing; MCP server with 2 read-only tools |
| LINE transport (`zuri-command-agent`) | **Working** — webhook, identity gate, outbox push | live chat logs 2026-08-11 |
| Mission Control (GoVibe) | **Working** — real React app, roadmap parser | `ROADMAP-zuri-v2-lab.md` parses in its exact dialect |
| MSP memory | **Working** — SQLite, 3-vault, bitemporal | 30 test files incl. security suites; prebuilt Windows binary |
| GenesisBlockDB engine + SmartGift graph | **Working + evaluated** | 17,761 nodes / 9,682 edges, eval recall=precision=1.0 |
| **GKS governance layer** | **SPEC ONLY** — never on the critical path, never named as working | BLUEPRINT "candidate", ADR-025 "proposed", client stub throws |
| DuckDB → Supabase mirror | **Does not exist** — named stage D7 only | no Supabase code anywhere in the workspace |
| `line-copilot-runtime` server | **Spec-stage** — its own REQ-CR-012 forbids wiring until the contract gate passes | keep as the post-demo production path |

## 2. The demo cut — 5 beats, ~12 minutes

| # | Beat | Time | What the exec sees | Proves |
|---|---|---|---|---|
| 1 | **LINE Q&A on a real phone** | 5 min | Asks in Thai "ยอดขายเดือนนี้เท่าไหร่", "ลูกค้า top 10 คือใคร" → answered from real `sot.duckdb`; one open question routed to the RAG brain, answered with citations | The AI answers over real business data |
| 2 | **Mission Control** | 3 min | GoVibe board, two tabs — Zuri V2 + SmartGift delivery — plus the `migrate-status --json` feed as "the machine-readable truth behind this board" | Roadmap visibility, per-business and per-workstream (incl. the live migration) |
| 3 | **Memory** | 2 min | Tell the agent a fact in LINE, restart the process on screen, ask "เมื่อกี้ผมบอกอะไรไว้" → answered from MSP; flash `msp_memory_history` | The agent remembers across restarts |
| 4 | **Data to cloud** | 1 min | Run the mirror live, refresh Supabase, aggregate tables appear — **only if the PDPA aggregates-only decision is made** (§6.1); else substitute the migrate-status feed | Data flows to the cloud |
| 5 | **Graph visual** *(optional)* | — | `graph-viewer.html` or the Obsidian vault (2,659 notes) as "the knowledge graph behind the answers" | The knowledge structure is real |

**Every beat is rehearsable via `zuri-agent chat say`** — the identical answer path
with no LINE or tunnel dependency. A full screen recording of the happy path is the
break-glass backup.

## 3. Day-by-day (≈3 working days of build, then rehearse)

Ordered so the riskiest seam is proven first, per the assessment.

| Day | Task | Why first |
|---|---|---|
| **D1 AM** | **Wire the seam end to end**: one Thai question → webhook → new registered query → real `sot.duckdb` read → guarded reply. Replace the fixture `fetchQueryData` (`src/queries/duckdb.ts:70-117`) with a real duckdb read against a **copy** of `sot.duckdb`. | The core move (transport + brain from two repos) has never run together. If it does not work, everything else is moot. |
| **D1 PM** | **Delete the fixture switch.** Unknown queryIds must **fail closed**, not return `[]` or hardcoded revenue. Smoke-test GoVibe Mission Control boot (pin to last green commit if the WIP HEAD fails). | The fixture is the single most dangerous thing in the estate (§5). |
| **D2 AM** | Add 2–4 registered read-only queries: `monthly_sales`, `top_customers`, `tier_counts`, `pipeline_by_stage`. Wire matching evidence-tools in `src/answer/tools.ts` + `src/answer/llm.ts` + the MCP pricing server. | These are the demo questions. |
| **D2 PM** | Copy `ROADMAP-zuri-v2-lab.md` (demo copy, `PHASE-V2-REPLACE` first) and the new `ROADMAP-business01-smartgift-delivery.md` into `G:\govibe\docs\roadmap\`. Set `GOVIBE_MCP_TOKEN` + `VITE_GOVIBE_MCP_TOKEN`. Boot the board. | Highest wow-to-effort; near zero code. |
| **D3 AM** | Spawn `msp-runtime` with `MSP_DB_PATH` in the agent's own data dir; vendor `createMspStdioCaller` (~100 lines) behind the existing `src/answer/memory.ts` interface. Prove upsert → restart → search. | Supporting beat; keep it to upsert/search/history only. |
| **D3 PM** | Pre-warm GenesisBlockDB (~36s cold start) and Ollama. If PDPA cleared: write the ~150-line aggregates-only mirror (DuckDB `ATTACH postgres`). Rehearse all 5 beats end to end via the CLI harness. Record the backup video. | Remove live-day latency; capture the fallback. |

## 4. Freeze and safety checklist (before rehearsals start)

- [ ] **Freeze both repos** (`zuri-command-agent`, `Bussiness-01-SmartGift`) on a tagged commit for demo week. Any upstream change after the freeze is forbidden.
- [ ] **Fixture revenue deleted** — no hardcoded numbers reachable from any query path.
- [ ] **`line-note.txt` removed from the demo machine** — it holds plaintext mailbox credentials and LINE OA invite links. Rotate them.
- [ ] **`dashboard-app/.env.local` off the demo profile** — it holds a production Vercel Blob token.
- [ ] **`G:\zuri`, `G:\govibe`, `.env` files** — never touched, never opened. The demo reads copies.
- [ ] **Denominators on every slide** — "75/75 files = business 1", "1 of 4 businesses". Never present SmartGift coverage as group coverage.
- [ ] **Backup video recorded** of the full happy path.

## 5. Top risks (from the adversarial assessment)

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Fake numbers reach the executives** — the DuckDB executor returns hardcoded fixture revenue; prices are 100% unapproved; 1-of-4 coverage could look like group coverage | Delete the fixture on D1; unapproved-price refusal is shown as a *governance feature*; denominators on every slide |
| 2 | **Live-infra fragility** — ephemeral Cloudflare tunnel, Ollama latency, ~36s graph cold start, GoVibe WIP HEAD: four SPOFs stacked | Boot-test D1; pre-warm; script the questions; CLI-harness fallback; backup video |
| 3 | **PDPA breach** — a Supabase mirror pushes customer PII off-machine, against the workspace's enforced local-only rule; a cloud LLM over PII raises the same question | Aggregates/non-PII only (or reuse `smartgift-mask.mjs`); prefer local/subscription answer layer; **owner decision in writing before demo day** |
| 4 | **Governance self-violation + credential exposure** — new data tools change `zuri-command-agent`'s capability surface (its own AGENTS.md gates this); plaintext secrets in two files | New tools stay strictly read-only registered queries with recorded owner sign-off; remove/rotate the secret files first |
| 5 | **Integration-seam underestimation** — Python/uv MCP spawned from a Node agent, two fail-closed philosophies, Thai answer stitching, never run together | Wire the seam on D1 before polishing anything; freeze both repos |

## 6. Owner decisions that block this runbook

### 6.1 PDPA — the pacing decision
May customer-level data leave this machine at all (Supabase mirror, cloud-LLM
context)? **Aggregates-only / masked / full fidelity?** This gates beat 4 and the
answer-model choice. If undecided by demo day, beat 4 becomes the `migrate-status`
feed and the narrative loses nothing.

### 6.2 Which model layer powers the LINE agent on stage
- **Anthropic API key** — cloud, has cost, exposes PII to a cloud model
- **Headless Claude Code subscription** — local-ish, billed to subscription
- **Ollama-only** (via `explore_agent`'s brain) — fully local, PDPA-clean, slower

Each is a different rehearsal.

### 6.3 Capability + posture sign-off
Approve the new **read-only** analytics capability in `zuri-command-agent` under its
own AGENTS.md permission matrix, and the temporary posture of demoing LINE via
`zuri-command-agent` while `line-copilot-runtime` stays the gated production path.

### 6.4 Demo logistics
Live LINE on a real phone (tunnel risk) vs projected screen with the CLI harness vs
pre-recorded segments? Everything runs on **one Windows machine** (win32 binaries,
local Ollama, local graph store) — is the demo on that machine?

## 7. What is explicitly deferred (post-demo, not on the critical path)

- `line-copilot-runtime` server wiring and deployment — gated by its own REQ-CR-012
- GKS governance end-to-end (candidate envelopes, promotion, ADR-025 conformance) — spec-only
- MSP → GKS knowledge promotion — fail-closed stub, no provider anywhere
- A Zuri-owned GenesisBlockDB sync of `.doc-graph.json` + Prisma rows — good second act; adds nothing SmartGift's existing graph does not already show
- Zuri V2 `/api/import` PlanEnvelope posting from the LINE agent — a **new write** capability; the demo stays read-only Q&A
- Full-fidelity PII Supabase mirror — blocked on 6.1
- Cost/margin analytics (cost Excels are Drive-only), "what did this customer buy" (P5.4 blocked on a FlowAccount export), contact history (interaction table empty), the other 3 businesses (no SoT)
- A stable webhook address — accept the ephemeral tunnel for the demo with the CLI fallback

## 8. The reuse map (who owns what, so nothing is rebuilt)

| Demo goal | Reused from | The only new code |
|---|---|---|
| 1 LINE Q&A | `zuri-command-agent` transport + `explore_agent`/`sot.duckdb` brain | real `fetchQueryData` + 2–4 registered queries + matching tools |
| 2 Mission Control | GoVibe Mission Control React app + roadmap parser | one SmartGift roadmap markdown file (§ next commit) |
| 3 Memory | GoVibe `msp-runtime` | ~100-line vendored stdio caller |
| 4 Data → cloud | `sot.duckdb` (clean source) | ~150-line aggregates-only mirror *(if PDPA cleared)* |
| 5 Graph | SmartGift's already-synced GenesisBlockDB projection | none |
