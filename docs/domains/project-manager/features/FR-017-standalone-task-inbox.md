---
domain: project-manager
feature: FR-017
module: project-manager
source: v2-native
version: 1.0.0
status: implemented
---

# FR-017 — Create Task on All Work: what a "standalone" task attaches to

## Decision

A task created from **Development → All Work → + New Task** is intake, not an
edit, so it goes through the one PlanEnvelope pipeline (BR-009, SDD-009):
**dry run → preview → human confirms → single transaction**. The modal never
writes a WorkItem or Workstream directly.

Because the envelope always names a Project, the modal has to be honest about
where a task lands:

| The user… | The task attaches to | First time | Every later time |
|---|---|---|---|
| picks no Project ("standalone") | the Business's **inbox Project** `PRJ-<BUSINESS CODE>-INBOX` and its one OPERATIONS workstream `WST-<BUSINESS CODE>-INBOX` ("General Tasks & Operations") | the envelope inserts the inbox Project and workstream together with the item | the envelope names both by code; the dry run shows them as updates and only the item as an insert |
| picks a Project | that Project, in its own Space, and a workstream the user chooses from the Project's existing ones | — | Project and workstream are updates, the item is an insert |
| picks a Project that has no workstream yet | that Project plus a new general OPERATIONS workstream `WST-<PROJECT CODE>-GENERAL` | the workstream is inserted with the item | as above |

The preview names the destination before the user confirms, so "standalone"
is a visible place — the Business's inbox — not a silent guess.

## Why the inbox, not a forced Project pick

- The affordance exists for work that has no Project yet ("ยังไม่สังกัดโปรเจกต์").
  Forcing a Project pick would delete the affordance rather than fix it.
- The data model requires WorkItem → Workstream → Project. The inbox Project is
  the one deterministic, per-Business home that satisfies the model without
  inventing a project-less write path (SDD-007 — every write goes through the
  service; SDD-009 — one envelope for every surface).
- The old code attached a standalone task to **the first Project in the
  Business** and created an ad-hoc workstream in it — the destination depended
  on list order and was never shown to the user. That is the defect
  D3-pm-plan-intake-02 recorded, not a design.
- The inbox codes derive from the Business code, so two Businesses can never
  collide, and the dry run refuses the inbox envelope aimed at another
  Business's Space as a conflict (pinned in the integration test).

## What the envelope carries

- Project and workstream **as fetched** (`code`, `name`, `executionMode`,
  `progressStrategy`, `progressWeight`). Commit upserts by code and rewrites
  those fields on an update, so naming a workstream by code alone would reset
  its weight and name; carrying the record verbatim makes the update a no-op.
- The item's `subtype` is constrained to the target workstream's mode contract
  (BR-004); the form offers only those subtypes. Delegator, approver, creator and
  description ride in `item.metadata`, which is what the All Work
  "Delegator / Approver" column reads. The envelope schema has no `assigneeRef`
  field; assignment remains an edit made on the item afterwards (FR-005).
- The target Space is sent explicitly (`workspaceId`): the bound Project's own
  Space, or for a standalone task the Business's own Space (the shell's selected
  Space when it belongs to that Business, else the first). A Business with no
  Space cannot receive a task until one exists — the modal says so instead of
  guessing.

## Where it lives

- Builder: `src/modules/project-manager/import/task-envelope.js`
- Surface: `src/modules/project-manager/components/StandaloneTaskModal.jsx`
  through `usePlanIntake` and `PlanPreview`
- Tests: `tests/unit/task-intake-modal.test.js`,
  `tests/integration/task-modal-intake.test.js`
