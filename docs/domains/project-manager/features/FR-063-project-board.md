---
domain: project-manager
feature: FR-063
module: project-manager
source: v2-native
---

# FR-063: Project Board

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Declared — implementation predates the requirement and does not yet satisfy it |
| **Date** | 2026-08-17 |
| **Relates to** | FR-005 (the work model it renders), FR-040, SDD-019, SDD-036 |
| **Found by** | Wave 0 route-anchor survey, `.brain/waves/w0-s2-report.md` |

## Why this needed a new id rather than widening FR-040

`src/app/(pm)/projects/[projectId]/board/page.jsx` has shipped for a long time
with no requirement behind it. SDD-019 says the Work tab "owns `Structure Plan`,
`Board`, `Schedule`, and `Dependency Map`" — but FR-040, the requirement SDD-019
is keyed to, states only that "every Project provides a Structure Plan (WBS) and
a project-local Dependency Map", and closes with "No new persistence model is
introduced". It names two views. The design decision claimed four.

The survey recommended widening FR-040's text to cover the other two. That was
rejected. Sharpening a statement to name the surface of behaviour it already
declares is legitimate — that is what FR-005, FR-006 and FR-007 got in the same
commit. But **no requirement anywhere in the registry describes rendering work
as a status board**, so adding it to FR-040 would introduce new requirement
content under an existing key, which is the one thing the id contract forbids
(AGENTS.md §18).

The distinction is worth keeping: *unstated surface for stated behaviour* is an
incomplete sentence; *unstated behaviour* is a missing requirement.

## What the code does today, and where it disagrees

`KanbanBoard.jsx` groups WorkItems with a hand-written `COLUMNS` list of six
statuses. `WORK_STATUSES` in `src/lib/validation/enums.js` has **seven**:

```
WORK_STATUSES = PLANNED, READY, IN_PROGRESS, REVIEW, BLOCKED, DONE, CANCELLED
COLUMNS       = PLANNED, READY, IN_PROGRESS, REVIEW, BLOCKED, DONE
```

A WorkItem in `CANCELLED` renders in no column and **disappears from the board
with no indication**. The file's own comment says it groups "by the seven
canonical statuses"; it groups by six.

This is not a design choice to hide cancelled work. CLAUDE.md states the rule
directly — `enums.js` is the single source of truth and an enum list is never
hand-copied — and this is precisely the failure that rule exists to prevent. So
FR-063 states the enum-derived rule, and the current implementation does not yet
meet it. That is why the status above says so.

Hiding cancelled work *may* be the desired product behaviour. If it is, it
should be an explicit filter over the full enum, visible in the UI, not a column
that was never written.

## Scope

**In:** one column per `WORK_STATUSES` value, derived from the enum; cards
opening the existing Workpackage editor; project-scoped only.

**Out:** drag-to-reorder, persisted card order, swimlanes, a global (all-project)
board, WIP limits. Each would need its own FR — and reordering in particular
would introduce the persisted ordering SDD-036 refuses.

## Follow-up this declaration creates

Fix `KanbanBoard.jsx` to derive its columns from `WORK_STATUSES`, decide
explicitly what happens to `CANCELLED`, and flip this FR to ✅. Tracked in
`.brain/waves/2026-08-17-wave-0-1-ledger.md` — deliberately **not** folded into
the Lane G annotation sweep, which is mechanical and must stay that way.
