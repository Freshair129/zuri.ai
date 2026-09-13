---
version: "1.2.0"
created_at: "2026-09-13T23:45:00+07:00,Claude Opus 5"
last_update: "2026-09-13T23:45:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "platform-control"
  doc_type: "architecture-decision"
  scope: "measured delivery telemetry and evidence badges on the installation-operator programme board"
---

# ADR-086 — Programme delivery telemetry: measured beside planned, never as progress

**Status:** Accepted on the owner's instruction of 2026-09-13 (TASK-ZAI-064).

**Amends:** ADR-048 D3 (the board stays a plan snapshot; this decision adds a
labelled measured layer beside it and one persistence model to the lane).

**Relates to:** FR-105, FR-124, FR-211, FR-216, FR-217, FR-218, FR-219,
FEAT-034, NFR-008, ADR-057, ADR-081, `docs/roadmap/ROADMAP-zuri-ai-24w-program.md`.

## Context

The owner asked that every phase card on `/control/roadmap` show how many
sprints and tasks it holds, its size and its estimated duration, and — once the
work is done — the time it really took and the tokens it really used, counted by
a surface rather than estimated. Done cards should read light green and review
cards light orange. In the same conversation the owner added evidence badges on
every task card ([DOC] [CODE] [TEST] [FR] [NFR] [FEAT] [domain] [complexity]
[priority]; green done, orange review, red needs fix, gray empty) and a progress
bar for tasks whose plan is split into subtasks P0 to P3.

Two facts shaped the decision:

- **No actual figure exists.** Every Task Container carries
  `token_telemetry.total_token_usage`, but on done tasks it is a copy of
  `predicted_token_usage`. Nothing measured has ever been recorded.
- **Real figures do exist on the operator's machine.** Claude Code writes one
  JSONL line per content block with `message.usage`, `requestId`, `gitBranch`,
  `cwd` and `timestamp`; Codex writes `token_usage_record` events with a
  `response_id` and a `session_meta.git.branch`. Both are measurements taken by
  the tool that billed the request.

ADR-048 D3 says the page never derives completion from Git activity and never
presents live repository activity as roadmap progress. That still holds: time
and tokens are cost, not completion.

## Decision

### D1 — Planned and measured are separate layers, and both are labelled

The board shows two kinds of figure and never mixes them:

| Layer | Figures | Source |
|---|---|---|
| **Planned** | sprint and task counts, size in complexity points, plan window in days, effort estimate in hours, predicted tokens | the programme document (as today) plus the sizing table (D2) |
| **Measured** | tokens used, active time, first and last activity, elapsed time | the usage meter (D4) and usage reports (D5), each with its source and measuring time |

A measured figure never feeds plan progress, a gate or a status. A task, lane or
phase with no measurement reads *not measured* — never zero, and never its
prediction. `total_token_usage` keeps its historical values and is no longer read
by the board.

### D2 — Size and estimate come from a written sizing table

Size is the sum of complexity points (`C-1` = 1, `C-2` = 2, `C-3` = 3). The
effort estimate is the sum of each task's band in the **sizing table** kept in
the programme document's *Delivery Telemetry* section (initially `C-1` 2 h,
`C-2` 6 h, `C-3` 16 h). The plan window is the phase's calendar days from its
start and end dates. The owner may change the table; the board shows whatever
the document says.

### D3 — Work lanes join sessions to tasks by declared branch

A **lane** is a set of tasks worked on together, declared in the document with
the git branches the work used. Several tasks commonly share one branch (the
data pipeline map delivered three tasks from one), so usage is measured per lane
and shown once — never split across tasks by estimate. Rules the generator
enforces:

- a lane's tasks all belong to one phase;
- a branch belongs to at most one lane;
- `main`, `master` and `HEAD` are never declared (detached work cannot be
  attributed, so it is reported as unattributed rather than guessed).

### D4 — The usage meter measures from local session logs

`scripts/programme-usage-meter.mjs` reads Claude Code and Codex logs on the
operator's machine and:

1. counts each billed request **once** — Claude Code by `requestId` (one request
   is written once per content block), Codex by `response_id`;
2. normalises tokens to four counts: input (not cached), cache write, cache
   read and output. Codex `input_tokens` already contains `cached_input_tokens`,
   which is subtracted;
3. attributes a request to the lane that declares its branch, and only for
   requests made inside this repository (a `cwd` under a zuri-ai checkout, or a
   Codex repository URL naming `zuri.ai`);
4. computes per session the first and last request and the **active time**: the
   sum of gaps between consecutive requests, each gap capped at 15 minutes;
5. writes the result into the document's usage block with the measuring time,
   the per-source totals and the session keys it counted (`source:sessionId`),
   and regenerates the board module. Unattributed branches are printed, not
   written.

*Tokens used* on the board is input + cache write + output. Cache read is shown
beside it, because a long session re-reads its context on every request and
would otherwise dwarf the work.

The meter runs by hand. CI cannot run it (the logs are not in the repository);
CI checks only that the generated module matches the document.

### D5 — The usage report endpoint covers agents without local logs

`POST /api/platform/programme-usage-reports` accepts one session's usage for one
task from an agent on another machine. It authenticates with a deployment bearer
`ZURI_PROGRAMME_USAGE_TOKEN` (at least 32 characters, compared in constant time,
like the LINE worker token). The body names the source, session id, task,
model, the four token counts, request count, time span and active minutes.

- The row is keyed by `(source, sessionId)`: the same payload again is an
  idempotent replay; a different payload for the same key is refused with 409.
- An unknown task id is refused by name.
- `ProgrammeUsageReport` is the platform-control lane's first persistence model.
  Its Supabase migration ships in the same change; applying it on production is a
  separate operator step (ADR-057). Until it is applied, the board reads no
  reports and still renders.

**Amended by ADR-087 (2026-09-14):** people's agents report through a browser-paired device with a report-only credential; this deployment bearer remains for unattended automation, and reports gain person, installation and lane attribution (FR-220, FR-221).

The board merges reports with the meter's figures at request time on the server.
A report whose `source:sessionId` the meter already counted is skipped, so one
session is counted once whichever way it arrived. Each figure names the sources
it came from.

### D6 — Evidence badges and subtasks

Every task card shows evidence badges and descriptor badges.

**Evidence badges.** Colour always comes with a word (NFR-008).

| Badge | Green | Orange | Red (needs fix) | Gray (empty) |
|---|---|---|---|---|
| DOC / CODE / TEST | link resolves and the task is done | link resolves and the task is in review | a link is declared but the path no longer exists | no link recorded, or the task has not reached review |
| FR / NFR / FEAT | every delivered id is `verified` (FEAT: `ready`) in the FR-124 snapshot | at least one is `partial`, or built and not-yet-built ids are mixed | an id the snapshot does not know, or the task is done or in review while an id is `planned`, `blocked` or `not_implemented` | no delivered id of that family |

- **Link check.** Link existence is checked when the container module is
  generated, because the production image carries neither `docs/` nor `tests/`.
- **Delivered ids.** A task's ids come from its container's `delivers` list, or
  from the FR, NFR and FEAT ids named in its title (with `FR-154 to FR-156`
  ranges expanded) when the list is absent.
- **Snapshot.** Statuses are read from `runtime/domain-state.json`, never
  recomputed.

**Descriptor badges.** Domain code name (`DOM-` plus the domain key of the
delivered FEAT or FR, else of the code link's module), complexity and priority
are shown in neutral outline. They describe the task; they do not grade it.

**Subtasks.** A container may list subtasks, each with an id (`P0`, `P1`, …),
title and status. The card lists them and draws a progress bar from them under
the board's status mapping. A task without subtasks shows no bar.

**Card tint.** Done cards (phase, sprint and task) are tinted light green and
review cards light orange in both themes, and the status word stays on the card.

### D7 — Usage detail: every countable thing, names and numbers only (added 2026-09-14)

On the owner's instruction to capture everything the agent logs can measure — especially input and output tokens and tool calling — the meter and the harness plugin also count, per session and branch:

| Detail | Claude Code source | Codex source |
|---|---|---|
| Thinking / reasoning tokens (part of output) | `usage.output_tokens_details.thinking_tokens` | `usage.reasoning_output_tokens` |
| Cache writes by lifetime | `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` | not reported (0) |
| Web search and fetch requests | `usage.server_tool_use.web_search_requests` / `web_fetch_requests` | not reported (0) |
| Tool calls by name | `tool_use` content blocks, once per block id | `function_call`, `custom_tool_call`, `local_shell_call` items, once per call id |
| Tool errors | `tool_result` blocks with `is_error`, once per tool use id | not reported (0) |
| Tool denials | user lines carrying `toolDenialKind` | not reported (0) |
| User prompts | user lines whose content is text, excluding meta and compact summaries | `task_started` events |
| Compactions | `system` lines with subtype `compact_boundary` | `compacted` items |
| API errors | `system` lines with subtype `api_error` | not reported (0) |
| Requests per model | `message.model` of each counted request | `turn_context.model` in force |

Two rules bind every field:

- **Privacy.** Only numbers, tool names and model names are kept. Prompt, response, thinking, tool argument and tool output text is never read into the result, reported, stored or shown. A tool name can reveal which connector an agent used; the board is operator-only (ADR-048 D2).
- **One counting rule set.** The meter and the plugin must agree field for field, proven by a parity test. A field a harness does not write is 0, never estimated.

The report endpoint accepts the detail as an optional object, so an older plugin that sends none is still accepted. A resumed session extends only when every count, including the detail, grows (ADR-087 D5).

## Consequences

- The board can answer "what did this phase really cost" for work done in
  declared lanes, and says *not measured* for everything else, including all work
  that predates the meter.
- **Charter change.** The platform-control charter changes: the lane now owns
  one model, one API route and one write path. The removal contract gains one
  table drop.
- **Container generator.** The generator moves from a scratch script into
  `apps/server/scripts/programme-containers.mjs`, with a check mode under test,
  because link colours and subtasks make the generated module more than a copy.
- **Sensitive data.** Session keys and branch names become repository content.
  They are local identifiers, not secrets; no prompt, response or path outside
  the repository is recorded.

## Alternatives rejected

**Estimate actual tokens from commits or diff size.** Rejected. ADR-048 D3
forbids deriving programme facts from Git activity, and the owner asked for real
counts.

**Split a shared branch's usage across its tasks by complexity.** Rejected. That
is an estimate dressed as a measurement; D3 shows the lane once instead.

**Endpoint only.** Rejected. Every past session would be lost, and agents that
already write complete local logs would have to report twice.

**Meter only.** Rejected by the owner. It cannot see agents running on another
machine.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-13 | accepted | Measured delivery telemetry beside the plan: sizing table, lanes by branch, local usage meter, usage report endpoint with `ProgrammeUsageReport`, evidence badges and subtask progress | working-tree | Claude Opus 5 |
| 1.1.0 | 2026-09-14 | accepted | D5 amended by ADR-087: the deployment bearer is for automation; people's agents report through paired devices | working-tree | Claude Opus 5 |
| 1.2.0 | 2026-09-14 | accepted | D7 added: usage detail (thinking tokens, cache lifetimes, web search and fetch, tool calls, errors and denials, prompts, compactions, API errors, models), names and numbers only, with meter–plugin parity | working-tree | Claude Opus 5 |
