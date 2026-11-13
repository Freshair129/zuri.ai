---
id: ZAI:ADR-117
title: Cancel the 24-week programme as the delivery plan
version: "1.0.0"
status: accepted
created_at: "2026-11-13"
last_update: "2026-11-13"
author: Claude Sonnet 5.5
superseded_by: null
approval_scope: documentation-only-cancellation-of-schedule-authority
approved_on: "2026-11-13"
approved_by: "Owner instruction given in chat on 2026-11-13 and relayed by the lead Claude session; no other approval is claimed"
attributes:
  doc_type: architecture-decision
  domain: platform-control
  scope: "Stop treating the 24-week programme's schedule, phases, sprints and gates as the delivery plan; no work, task state, count, percentage or production state is changed"
relations:
  - type: relates_to
    target: ZAI:ADR-048
  - type: relates_to
    target: ZAI:ADR-086
  - type: relates_to
    target: ZAI:ADR-113
  - type: relates_to
    target: ZAI:ROADMAP
---

# ADR-117 — Cancel the 24-week programme as the delivery plan

**Status:** Accepted on 2026-11-13 as a documentation decision. It records an
owner instruction given in chat and relayed by the lead Claude session. It is
not an approval by any other person or agent, and it has no production,
deployment, data or runtime effect.

## Context

[ROADMAP-zuri-ai-24w-program.md](../roadmap/ROADMAP-zuri-ai-24w-program.md)
holds a 24-week schedule: `PHASE-ZAI-01` to `PHASE-ZAI-06`, `SPR-ZAI-01` to
`SPR-ZAI-12` and `GATE-ZAI-01` to `GATE-ZAI-09`, with a programme window of
2026-08-24 to 2027-02-07. [roadmap/README.md](../roadmap/README.md) already
describes it as a derived, non-authoritative projection (`source_of_truth:
false`) and names [ROADMAP.md](../roadmap/ROADMAP.md) as the only source of
delivery status. Recent ROADMAP revisions also say that new owner-requested
work receives no phase, sprint, schedule or estimate. What no record did was
say whether the schedule itself was still the plan.

On 2026-11-13 the owner instructed, in chat, that the 24-week programme is
cancelled as the delivery plan and that the work now being done is the plan.
That work is the architecture-review gap closure described in
[the architecture review](../../.brain/reviews/2026-11-12-architecture-review-domains-and-core-systems.md)
(PRs #807 to #816 and their follow-ups).

## Decision

### D1 — The programme is cancelled as the delivery plan

The 24-week programme's schedule, programme window, phase and sprint dates and
`GATE-ZAI-01` to `GATE-ZAI-09` as delivery targets are cancelled. No sprint
date, phase date or gate is a commitment, a deadline or an acceptance
criterion from this decision onward.

### D2 — The working plan is the gap-closure work, tracked without sprint dates

The current plan is the architecture-review gap closure and its follow-ups.
It is tracked by the delivery rows in [ROADMAP.md](../roadmap/ROADMAP.md) and
by pull requests, in line with the existing rule that owner-requested work gets
no phase, sprint or schedule. This decision creates no new phase, sprint,
estimate or task.

### D3 — What this decision does not claim

- No task, requirement or phase is declared done, and none is reopened.
- No task count, percentage, status cell or evidence value is rewritten. The
  ROADMAP.md ledger and its existing phase rows are unchanged.
- No production acceptance, deployment, migration or gate result is stated or
  implied.
- The gates are not declared met or failed. They stop being targets.

### D4 — Identities and history are preserved

Every `TASK-ZAI-*`, `FR-*`, `FEAT-*`, `PHASE-*`, `SPR-*` and `GATE-*` identity
keeps its meaning and is neither renumbered nor reused. AGENTS.md section 18
pins the requirement, feature, ADR and change-request families; this decision
extends the same practice to the roadmap identifiers by choice, not by that
section's text.
The 24-week Markdown file and the static HTML snapshot
([ROADMAP-zuri-ai-24w-program.html](../roadmap/ROADMAP-zuri-ai-24w-program.html))
remain as historical records. The file stays `source_of_truth: false`; its
task containers and evidence stay readable because existing views and the
generated ROADMAP projection still consume them.

### D5 — Board and generated projections are unchanged

The programme board, task containers and generated modules continue to read the
24-week file as before; this decision changes none of them. Whether the board
should show the cancelled state, or stop reading the 24-week file, is a
separate code change that needs its own decision and is not made here.

## Alternatives and consequences

Alternatives not taken: keep the schedule as a reference plan (rejected by the
owner's instruction), or rewrite or delete the 24-week file and its task
containers (rejected: it would alter history and the projections that read it).

- A reader of the 24-week file or its HTML snapshot is told, at the top, that
  it is not the current plan and points to this record.
- Schedule slippage against the 24-week dates is no longer a defect to report.
- Existing evidence, task states and board figures can still be quoted, but only
  as historical or ledger facts, not as progress against the cancelled schedule.

## Verification

Documentation only. `npm run govern` passes locally; the programme container
generator `--check` reports its generated modules in step, so no code or
fixture change is needed. No hosted CI, deployment or production result is
claimed by this record.

## CHANGELOG

- 1.0.0 (2026-11-13): initial record.

## Authority

Source: the owner's chat instruction of 2026-11-13, relayed by the lead Claude
session. This ADR does not substitute for any product or production approval
that other work requires.
