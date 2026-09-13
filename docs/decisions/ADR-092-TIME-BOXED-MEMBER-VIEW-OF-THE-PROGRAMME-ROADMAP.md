---
version: "1.0.0"
created_at: "2026-09-14T18:00:00+07:00,Claude Opus 5"
last_update: "2026-09-14T18:00:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "platform-control"
  doc_type: "architecture-decision"
  scope: "a 30-day read-only view of the programme roadmap for any signed-in person, outside /control"
---

# ADR-092 — A time-boxed member view of the programme roadmap

**Status:** Accepted on the owner's instruction of 2026-09-14 (TASK-ZAI-104).

**Amends:** ADR-048, which reserved every view of the programme plan for the installation operator. `/control/**` and its D2 predicate are unchanged. This decision adds one read-only view outside `/control`, and it closes by itself.

**Relates to:** FR-105, FR-211, FR-216, FR-219, FR-221, FR-241, ADR-086 D7, ADR-087 D4, SEC-020.

## Context

On 2026-09-14 the owner asked for the programme roadmap to be open for 30 days. `/control/roadmap` then admitted one person, the only holder of an OPERATOR grant. The owner chose two things:

1. **Who.** Anyone signed in to zuri-ai. Not an anonymous public URL and not a secret share link.
2. **What.** The programme plan and the Domain map. Nothing about people or devices.

The operator board carries three kinds of data:

- **The plan.** Phases, sprints, tasks, status, progress, size, evidence badges and the Domain map. All of it comes from files already in the public repository.
- **Measured usage per lane.** Token totals, active time and requests. It names no one.
- **People and devices.** Usage split by person and by device label, the Agent devices tab (person, device label, OS user), and the tool and model names in the usage detail. ADR-086 D7 kept those names on the operator-only board because a tool name can reveal which connector an agent used.

## Decision

### D1 — A separate route, not a wider guard

- **Route.** The view is `/roadmap`, outside the `(control)` route group and outside BusinessShell. `/control/roadmap` keeps ADR-048 D2 exactly, so opening the view never widens the control shell, its navigation or anything later added under `/control`.
- **Guard order.** The guard runs on the server before any programme data is rendered:
  - no session → `/login`
  - session store unavailable → the shared retry state
  - window closed → a non-enumerating 404
  - otherwise the view renders

### D2 — Any signed-in person, for a declared window

- **Who.** Any authenticated session is admitted, including a person still in the Waiting Room. No Business, role or grant is consulted, and none is conferred.
- **When.** The window is a constant in code: it closes at **2026-10-15 00:00 Asia/Bangkok** (`2026-10-14T17:00:00Z`), 30 days after the instruction. After that the route is a 404 for everyone, including operators, who keep `/control/roadmap`.
- **Changing it.** Extending or closing early is a reviewed change to that constant plus a deploy. That is deliberately not a runtime switch: nobody can quietly keep the view open, and the closing date is visible in the code, this record and FR-241.

### D3 — The server removes people and devices before the client sees anything

The member projection is built on the server from the same inputs as the operator board, then reduced:

- **Kept.**
  - the plan
  - evidence badges
  - the Domain map
  - per lane: token totals, active time, request, session and report counts, sources, and the headline detail counts (thinking tokens, tool calls, tool errors, denials, prompts, compactions)
- **Removed.**
  - usage by person and by device
  - tool names and model names
  - the Agent devices tab
  - any credential or report row

Hiding a figure in the component is not enough, because the rendered page payload would still carry it. The projection function is the boundary, and a test asserts the removed fields are absent from its output.

### D4 — It stays a plan snapshot

The view carries ADR-048 D3's framing: a read-only plan snapshot, not Business progress, not calculated from Git activity. It writes nothing, exposes no API and adds no navigation entry. The link is shared by whoever the owner chooses.

## Consequences

- For 30 days every account holder can read the delivery programme without being made an operator. The operator grant stays the single authority for `/control/**`.
- Signups are open (FR-120), so "signed in" is a low bar. The plan itself is already public in the repository. The new exposure is the lane-level measured totals, which name no one.
- When the window closes, the route and its guard stay in the tree as dead code until someone removes them or re-opens the window with a new decision.

## Alternatives rejected

**Admit non-operators to `/control/roadmap` for 30 days.** Rejected (D1). It bends ADR-048 D2's single predicate for the whole control group, and the Agent devices tab and per-person usage sit on that page.

**An anonymous public URL.** Not chosen by the owner. It would also need the usage totals removed, and it could be indexed.

**A revocable share link with a token.** Not chosen by the owner. It is stronger control, but it needs a new credential model and a migration.

**A runtime switch (environment variable or database flag).** Rejected (D2). It can be left on by accident, and its state lives outside review.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-14 | accepted | `/roadmap`: a 30-day, signed-in, read-only view of the programme plan and Domain map, with people, devices, tool and model names removed on the server; `/control/roadmap` unchanged | working-tree | Claude Opus 5 |
