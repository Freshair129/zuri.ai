---
version: "0.1.0b"
created_at: "2026-08-19T11:20:00+07:00,CLAUDE"
last_update: "2026-08-19T11:20:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "architecture-decision"
  scope: "direct-manipulation pipeline canvas — node/edge/node with a mandatory handoff contract on every edge"
---

# ADR-035 — The pipeline canvas: node → edge → node, and no edge without a contract

**Status:** Proposed — design only. No implementation is authorized by this
document; it declares the ids and the boundaries the implementation must hold.

**Relates to:** FR-082, FR-083, FR-084, FR-085, FEAT-007, BR-017, SDD-046 ·
existing: FR-005, FR-007, FR-012, FR-040, FR-063, FR-064, FR-068, BR-009,
SDD-009, SDD-019, NFR-008 · ADR-012, ADR-028

## Context

Three surfaces already exist and each holds one third of a pipeline the product
never joined up:

- **Structure Plan** (`/projects/{id}/structure`, FR-040) renders the
  Project → Workstream → WorkContainer → WorkItem hierarchy as a read-only tree.
- **Dependency Map** (`/projects/{id}/dependencies`, FR-040) renders edges whose
  endpoints both belong to the open Project. `DependencyMap.jsx` already draws an
  SVG graph, but it is read-only and its layout is derived — a square-ish grid
  computed from node count, with no persisted position.
- **Board** (`/projects/{id}/board`, FR-063) renders WorkItems in one column per
  `WORK_STATUSES` value.

What is missing is not a fourth view. It is that **nothing crosses between
them**. A user can see a hierarchy, see edges, and move a card, but cannot
express *what one piece of work owes the next*, and the Board will happily let a
successor start while its predecessor is untouched.

`Dependency` (FR-007) persists `sourceType/sourceId/targetType/targetId/
dependencyType` and nothing else. An edge therefore asserts ordering and no
content: "B follows A" with no statement of what A hands B, and no way to say
whether the handover happened. That is the gap this decision closes.

## Decision

### D1 — Every edge carries a Handoff Contract. There is no bare edge.

An edge is a promise between two nodes, so it must say what is promised. The
**Handoff Contract** is the payload of an edge: the deliverable the predecessor
owes, and the acceptance condition that says the debt is paid.

This is the invariant, stated as BR-017: *an edge without a declared contract
cannot be created, and an edge whose contract is unsatisfied cannot release its
successor.*

The word "contract" is deliberate and it is **not** the intake envelope of
BR-009/SDD-009. Those are transport contracts — the shape a payload must have to
cross the system boundary. A Handoff Contract is a *domain* contract — the shape
of an obligation between two pieces of work. Conflating them would put schema
validation and project governance in one bucket. They stay separate words for
separate things.

### D2 — Bind acceptance to `Gate` when a gate already says it, and never otherwise

`Gate` already exists with `required`, `status` and `evidenceJson`, and required
gates already cap progress. Inventing a second thing that blocks progress would
give the product two answers to "why is this stuck".

But a `Gate` is scoped to a Project or a Workstream — it is a checkpoint *in* a
plan, not a condition *on an edge*. So the two cannot be merged:

- A Handoff Contract **may reference** a `Gate` id, and then the gate's status is
  the acceptance condition. One source of truth, no duplicated state.
- A Handoff Contract with no gate carries its own acceptance: a deliverable
  description plus an explicit satisfied/unsatisfied mark with provenance.

### D3 — Layout stays derived. Drag expresses meaning, never arrangement.

The reference UX we are matching lays nodes out *structurally* — hierarchy levels
for the WBS, one row per work package for the schedule. Nothing is free-placed.
We adopt that deliberately and refuse persisted `x`/`y`:

- Two users open the same Project and see the same picture. A dragged layout is
  per-user state that either drifts or needs syncing, and neither is worth it.
- A derived layout cannot rot. `DependencyMap.jsx` already computes one.
- It keeps the drag gesture meaning exactly one thing: **"this node relates to
  that node"**. A gesture that sometimes means "connect" and sometimes means
  "move three pixels left" is a gesture users have to aim.

Node position is therefore not persisted, and no schema field is added for it.

### D4 — The canvas is the preview stage of the one intake pipeline

BR-009 and SDD-009 are unambiguous: every intake surface converges on
validate → semantic check → read-only dry run → preview → single transaction →
audit. A drag gesture **is** an intake surface. It does not get its own write
path.

The honest difficulty is `preview`: for Excel and paste intake that is a modal
the user reads before committing, and a modal on every drop would make the canvas
unusable. The resolution is not to skip the stage but to **relocate it**:

1. On drop the client builds an envelope delta and posts it.
2. `validate → semantic check → dry run` run server-side, unchanged.
3. The optimistic edge already drawn on the canvas, in a visibly pending state,
   **is** the preview — the user is looking at the proposed result, which is what
   the modal was for.
4. A clean dry run commits in one transaction with one audit event. A failed one
   reverts the optimistic edge and prints the reason at the edge, not in a toast
   that outlives the context.
5. Undo uses the audit event, per the existing `undo-support` obligation.

Recorded as SDD-046. If a future surface cannot honour this, it adds a converter,
never a second write path.

### D5 — Every drag has a single-pointer, keyboard-reachable equivalent

NFR-008 binds WCAG 2.2 AA, and SC 2.5.7 *Dragging Movements* is AA. This is not a
polish item to schedule later; a drag-only canvas fails the requirement the
product already claims to meet.

| Drag gesture | Required equivalent |
|---|---|
| Add a child node | The `+` affordance on the parent (already the pattern in the reference UX) |
| Reparent a node | A `Move to…` control on the node |
| Connect node → node | Select source, then `Connect to…`, then choose a target from a list |
| Move a card across the Board | The existing `StatusSelect` |

A drag interaction ships only when its equivalent ships. They are one unit of
work, not two.

### D6 — Existing edges are legacy, not retroactively invalid

Every `Dependency` row that exists today has no contract. Making the column
non-null on arrival would invalidate live data, so:

- The contract is **nullable at rest**. The invariant is enforced at the creation
  surface: no new edge is written without one.
- An edge with no contract renders as `contract undeclared` and is listed for
  backfill. It does not silently look complete.
- D1's release gate (FR-085) treats an undeclared contract as **not blocking** —
  a legacy row must not freeze work that is running today. Only a declared and
  unsatisfied contract blocks.

That last point is the one a reader will want to argue with. It is chosen
knowingly: the alternative turns a data-migration gap into a production stoppage,
and "we made every old edge blocking" is a worse incident than "some old edges do
not gate yet".

## Consequences

- `Dependency` gains one nullable JSON column with a Zod schema at the boundary
  (SDD-008). No new aggregate, no new ownership: `Dependency` is already claimed
  by the `project-manager` charter.
- `DependencyMap.jsx` stops being read-only and becomes the canvas. It keeps its
  derived layout and its accessible edge-list fallback, which is what makes D5
  affordable — the list is already the non-visual equivalent.
- FR-007's cross-project register keeps ownership of edge CRUD semantics,
  including its existing self/cycle refusal. The canvas calls it; it does not
  reimplement cycle detection, and a cycle refused on the canvas must be refused
  in the register with the same message.
- The Board gains a release rule it did not have, which will make some currently
  startable work not startable. That is the point, and it is why FR-085 ships
  last of the four.

## Sequencing, and why this order

1. **FR-084 — contract on the edge** (data + the existing register UI). The
   smallest change that establishes the invariant.
2. **FR-083 — edge creation on the canvas** (drag + equivalent).
3. **FR-082 — structure editing on the canvas** (add/reparent + equivalent).
4. **FR-085 — contract-gated release on the Board.**

The order is load-bearing. If the canvas (2) shipped before the contract (1), it
would spend its first release writing exactly the bare edges D1 forbids, and
step 1 would become a backfill of data we chose to create knowing better.

## Alternatives rejected

**Persist node positions and let users arrange freely.** Rejected in D3. It buys
expressiveness the product does not need and costs shared understanding, which it
does.

**Make the contract a first-class `Contract` model.** Rejected for the MVP: a
1:1 table with `Dependency` earns its cost only when a contract outlives or is
shared between edges, and neither is a requirement today. The JSON column matches
the existing `metadataJson`/`evidenceJson` convention and is a smaller thing to
reverse if the assumption breaks.

**Let the Board gate on `Gate` alone and skip edge contracts.** Rejected: a gate
guards a checkpoint in one plan, not a handover between two nodes. The question
"what does B need from A" has no gate-shaped answer.
