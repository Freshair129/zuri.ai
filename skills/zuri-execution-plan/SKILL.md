---
name: zuri-execution-plan
description: Use when work must be created or updated inside Zuri — build a PlanEnvelope in the right one of Zuri's seven execution modes (SOFTWARE_SPRINT, DATA_MIGRATION, B2B_SALES, B2C_CAMPAIGN, PRODUCT_LAUNCH, OPERATIONS, BUSINESS_EXPANSION), dry-run it, then commit it. Triggers - "send this plan to zuri", "create a project/sprint/campaign/migration/pipeline in zuri", "import work into zuri", "zuri execution plan", "PlanEnvelope", "ส่งแผนเข้า zuri", "สร้างโปรเจกต์ใน zuri".
---

# Send an execution plan to Zuri

Every intake surface in Zuri — the web console, Excel, LINE, and your harness —
converges on **one** envelope, **one** validation, **one** transaction, **one** audit
event. Your job is to produce that envelope correctly, prove it with a dry run, and
commit it once.

**A plan is data. Nothing in it is ever executed.** Never put a command, a script, a
path to run, or an instruction-for-the-reader inside a plan field.

## Step 1 — connect

Run [zuri-connect](../zuri-connect/SKILL.md) first. You need `ZURI_BASE_URL`,
`ZURI_SESSION_COOKIE`, and the target `workspaceId` (or a `scope.workspaceCode` that
resolves on that instance). A plan sent at an unverified connection is a plan you cannot
report on.

## Step 2 — choose the execution mode

One workstream = one mode. A project may carry several workstreams in different modes.
Choose by **how progress is proven**, not by what the team is called:

| The work is proven by… | Mode | progressStrategy |
|---|---|---|
| tasks and defects closing inside sprints/epics/releases | `SOFTWARE_SPRINT` | `TASK_WEIGHT` |
| records moved, validated and reconciled | `DATA_MIGRATION` | `RECORD_VALIDATION` |
| named deals advancing through pipeline stages | `B2B_SALES` | `WEIGHTED_PIPELINE` |
| campaign KPIs against spend | `B2C_CAMPAIGN` | `KPI_ATTAINMENT` |
| launch phases whose deliverables are ready and gates are open | `PRODUCT_LAUNCH` | `MILESTONE_READINESS` |
| recurring periods meeting SLA, with backlog and incidents | `OPERATIONS` | `SLA_SCORE` |
| a new site/entity becoming operational (legal, budget, hiring, vendors) | `BUSINESS_EXPANSION` | `EXPANSION_READINESS` |

The strategy is **fixed by the mode** — never choose it separately, never mix a mode's
strategy with another's. Longer selection guidance, including the near-miss pairs
(migration vs. sprint, launch vs. sprint, operations vs. expansion):
[references/mode-selection.md](references/mode-selection.md).

## Step 3 — read the vocabulary, do not remember it

Each mode allows only its own container subtypes, item subtypes and metric keys. Print
them from the published contract instead of typing them from memory:

```bash
node skills/zuri-execution-plan/scripts/zuri-plan.mjs vocab --mode DATA_MIGRATION
```

(`--contract <path|url>` if you are outside the Zuri checkout. A metric key or subtype
that is merely plausible is rejected — that rejection is the feature.)

## Step 4 — build the envelope

Start from [references/example-plan.json](references/example-plan.json) and
[references/envelope-rules.md](references/envelope-rules.md). The rules that bite first:

- **`code` is the identity key.** Stable, unique across the whole envelope, never
  renumbered or reused. Re-sending the same codes is an update, not a duplicate.
- **Foreign ids never become keys.** A Jira/HubSpot/Salesforce id belongs in
  `externalRefs: [{ system, id }]`, and one external id may be claimed by exactly one entity.
- **The envelope carries no dates** beyond `project.targetAt`. Scheduling is a separate,
  explicit step — see [zuri-schedule](../zuri-schedule/SKILL.md).
- **`schemaVersion: "1.2"`** buys idempotent commits: `trace.correlationId` +
  `trace.idempotencyKey` are required, and a repeated key with the same payload returns
  the first receipt instead of writing twice. Leave `identityRefs` empty and omit
  `project.riskIds` — populated ones are rejected in this slice.
- Use `1.1` only when you deliberately want no idempotency record.

## Step 5 — check, dry-run, commit

```bash
node skills/zuri-execution-plan/scripts/zuri-plan.mjs check   plan.json   # local pre-check
node skills/zuri-execution-plan/scripts/zuri-plan.mjs dry-run plan.json   # THE contract check
node skills/zuri-execution-plan/scripts/zuri-plan.mjs commit  plan.json   # single transaction
```

`check` is a courtesy; the **dry run is the contract**. Read its `preview` before
committing and say out loud what it will do:

- `inserts` — new records. Confirm the count is the count you intended.
- `updates` — existing records this plan will change, and whether it matched by `code` or
  by `externalRef`. An unexpected update means your codes collided with someone else's work.
- `conflicts` — **stop**. A conflict is never "commit anyway": it means the same code or
  external id already belongs to something outside your target scope.

Commit only after a clean dry run, then report the receipt (what was inserted/updated,
the correlation id, the target workspace).

## When it refuses

- `valid: false` with errors → fix the envelope and dry-run again. Do not "simplify" the
  plan until it passes by dropping the work it was supposed to carry.
- Commit failed or the response never arrived → **re-run the dry run with the same
  idempotencyKey**. Never mint a fresh key to get past a refusal; that is how a plan gets
  committed twice.
- `Target workspace not found` / `does not match an existing workspace` → you were not
  given that scope, or it does not exist. Ask. Do not try other ids.

## Never

- Never edit `contracts/plan-envelope.schema.json` or any file under `contracts/` to make
  your plan pass.
- Never bypass the envelope with per-record `POST /api/work` calls for bulk creation —
  that skips the transaction and the receipt.
- Never renumber, reuse, or recycle a code that has already been committed.
