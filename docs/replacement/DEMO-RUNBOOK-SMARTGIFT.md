# Demo Runbook — SmartGift Executive Demo

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Active — four owner decisions made 2026-08-12 (§6); topology in §5a |
| **Author** | Claude |
| **Created** | 2026-08-12 |
| **Goal** | The fastest credible executive demo ("ส่งมอบตัวอย่างให้ทีมบริหาร") for Business-01 SmartGift |
| **Basis** | Read-only scan of 5 systems (`smartgift-demo-scoping` workflow, 2026-08-12) |

## Build status (2026-08-12)

Branch `demo/smartgift-seam` in `D:\workspace\zuri-command-agent` — **code side done,
tsc clean (exit 0), one blocker fixed**:

- Seam wired; the hardcoded fixture executor is **gone** (unknown queryId + unset
  `SMARTGIFT_DUCKDB_PATH` fail closed). Four registered read-only queries
  (`monthly_sales`, `top_customers`, `tier_counts`, `pipeline_by_stage`) over real
  `sot.duckdb`. Phone and dashboard now compute **identical** values (the
  orders+quotes / regulated-widening divergence was fixed).
- MSP memory wired (channel-keyed `business-01-smartgift` — **demo-only**, per ADR-007
  it must become principal-keyed after Identity).
- **GATE-0 fix (2026-08-12):** the headless Claude Code path (the demo's primary model
  layer) did not expose the four analytics tools and did not pass `SMARTGIFT_DUCKDB_PATH`
  to its spawned MCP server, so "ยอดขายเดือนนี้" would have failed closed on stage.
  Fixed in `src/answer/headless.ts` (added the 4 tools to the allow-list + passed the
  env through). tsc still exit 0.

**Do not demo until the branch is built** (`npm run build`) — until then the running
code is still the old fixture. The remaining steps are owner-run (secrets / live
process): see `zuri-command-agent/docs/DEMO-OPS-CHECKLIST.md` and §3 below. The
`demo/smartgift-seam` changes are uncommitted for owner review (`git diff`).

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
| 4 | **Data to cloud** | 1 min | Run the mirror live → Supabase → **the Vercel-deployed dashboard refreshes and shows the cloud tables** (PDPA cleared, §6.1). Full loop: local brain → cloud mirror → cloud dashboard | Data flows to the cloud, visibly, on a public URL |
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
| **D3 PM** | Write the ~150-line aggregates-first mirror (DuckDB `ATTACH postgres` → Supabase) from a copy of `sot.duckdb`; point the Vercel `dashboard-app` at the Supabase tables. Stand up the **named** tunnel and register its stable URL with LINE once. Pre-warm GenesisBlockDB (~36s cold) and Ollama. Rehearse all 5 beats via the CLI harness **and** the Ollama fallback path. Record the backup video. | PDPA is cleared, so the full cloud loop is in scope; remove live-day latency; capture the fallback. |

## 5a. Topology — Vercel presentation, this PC does the thinking

The owner chose "deploy on Vercel, webhook on this PC". Vercel is stateless
serverless — it **cannot** host the headless Claude Code layer, Ollama, DuckDB or
GenesisBlockDB, all of which are process- or win32-binary-bound to this machine. So
the two halves split cleanly:

```text
LINE Platform ──(named tunnel, stable URL)──▶  THIS PC
                                               ├─ zuri-command-agent webhook server
                                               ├─ brain: Claude Code headless → Ollama fallback
                                               ├─ sot.duckdb · GenesisBlockDB · MSP  (all local)
                                               └─ mirror job ──▶ Supabase (cloud)
                                                                    ▲ reads
                              VERCEL (public):  dashboard-app + Mission Control board
```

- **This PC** owns everything that touches PII, the local models, and the local
  data/graph. The LINE webhook runs here and is exposed with a **named** tunnel
  (Cloudflare named tunnel or an ngrok reserved domain) so the URL registered with
  LINE is stable — do **not** use an ephemeral Quick Tunnel for the demo (it changes
  on every restart; that was risk 2).
- **Vercel** owns only presentation: the existing `dashboard-app` (already deployed)
  and, if wanted, the Mission Control board. It reads the cloud mirror, so beat 4's
  "data to cloud" is visible on a real public URL rather than a localhost tab.
- **The cutover-safety principle still holds**: exactly one process owns the local
  data and the MSP DB file. Vercel never writes back to the PC.

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
| 2 | **Live-infra fragility** — Ollama latency, ~36s graph cold start, GoVibe WIP HEAD, and a tunnel between LINE and the PC: SPOFs stacked | **Named** tunnel (not ephemeral) registered once; boot-test D1; pre-warm; script the questions; CLI-harness + Ollama fallback both rehearsed; backup video |
| 3 | **PDPA — owner cleared it, but the workspace rule still enforces local-only** — the mirror contradicts SmartGift's `local_only` rule mechanically (git-ignored PII, blocked `:cloud` models) | Run the mirror from a **copy** outside the enforced dir; **aggregates first**; rotate any token immediately after the demo; the override is scoped to the demo, not adopted as policy |
| 4 | **Governance self-violation + credential exposure** — new data tools change `zuri-command-agent`'s capability surface (its own AGENTS.md gates this); plaintext secrets in two files | New tools stay strictly read-only registered queries with recorded owner sign-off; remove/rotate the secret files first |
| 5 | **Integration-seam underestimation** — Python/uv MCP spawned from a Node agent, two fail-closed philosophies, Thai answer stitching, never run together | Wire the seam on D1 before polishing anything; freeze both repos |

## 6. Owner decisions — MADE 2026-08-12

### 6.1 PDPA — DECIDED: data may leave the machine
Customer data **may** be mirrored to Supabase and reasoned over by a cloud-backed
model. Beat 4 is live (mirror → Supabase → Vercel dashboard).

> **Recorded caveat (owner reaffirmed after the concern was raised):** the SmartGift
> workspace enforces a `local_only` rule — PII is git-ignored and Ollama `:cloud`
> models are structurally blocked. This decision **overrides that rule for the
> demo**. Consequence: the mirror job must run from a **copy** of `sot.duckdb`
> outside the enforced directory, or the enforcement is toggled for the run.
> Recommendation kept: mirror **aggregates first** (revenue by month, tier counts,
> pipeline) as the default; full-fidelity PII is now permitted but is not required
> for the story, and starting narrow limits the blast radius if a token leaks.

### 6.2 Model layer — DECIDED: headless Claude Code, Ollama fallback
Primary: **headless Claude Code** (billed to the subscription, no per-token API
cost). Fallback: **Ollama local** via `explore_agent`'s brain (fully local, works
offline, PDPA-clean). No Anthropic API key on stage. Rehearse **both** paths — the
fallback must answer the scripted questions if the subscription layer stalls.

### 6.3 Capability + posture — assumed approved, confirm in writing
Proceeding on the basis that the new **read-only** analytics queries in
`zuri-command-agent` are permitted under its AGENTS.md matrix (DuckDB reads are an
allowed class), and that demoing LINE via `zuri-command-agent` while
`line-copilot-runtime` stays the gated production path is acceptable. A one-line
written sign-off before rehearsals closes this.

### 6.4 Logistics — DECIDED: deploy on Vercel, webhook on this PC
Presentation (dashboard, Mission Control) on **Vercel**; the LINE webhook, brain,
data and models on **this Windows machine**, exposed with a **named** tunnel for a
stable URL. See §5a for the topology. Everything binary-/process-bound stays on the
PC by necessity, not choice.

## 7. What is explicitly deferred (post-demo, not on the critical path)

- `line-copilot-runtime` server wiring and deployment — gated by its own REQ-CR-012
- GKS governance end-to-end (candidate envelopes, promotion, ADR-025 conformance) — spec-only
- MSP → GKS knowledge promotion — fail-closed stub, no provider anywhere
- A Zuri-owned GenesisBlockDB sync of `.doc-graph.json` + Prisma rows — good second act; adds nothing SmartGift's existing graph does not already show
- Zuri V2 `/api/import` PlanEnvelope posting from the LINE agent — a **new write** capability; the demo stays read-only Q&A
- Full-fidelity PII Supabase mirror — now *permitted* (6.1) but not required for the story; aggregates-first ships, full fidelity is a later widening
- Cost/margin analytics (cost Excels are Drive-only), "what did this customer buy" (P5.4 blocked on a FlowAccount export), contact history (interaction table empty), the other 3 businesses (no SoT)
- Moving the brain off this PC — impossible for the demo (win32 binaries, local Ollama, local graph); the PC is the runtime, Vercel is only the window onto it

## 8. The reuse map (who owns what, so nothing is rebuilt)

| Demo goal | Reused from | The only new code |
|---|---|---|
| 1 LINE Q&A | `zuri-command-agent` transport + `explore_agent`/`sot.duckdb` brain | real `fetchQueryData` + 2–4 registered queries + matching tools |
| 2 Mission Control | GoVibe Mission Control React app + roadmap parser | one SmartGift roadmap markdown file (§ next commit) |
| 3 Memory | GoVibe `msp-runtime` | ~100-line vendored stdio caller |
| 4 Data → cloud | `sot.duckdb` (clean source) + the Vercel `dashboard-app` (already deployed) | ~150-line aggregates-first mirror → Supabase; point the dashboard at it |
| 5 Graph | SmartGift's already-synced GenesisBlockDB projection | none |
