---
domain: project-manager
feature: FR-082
module: project-manager
source: v2-native
---

# FR-082–085: The pipeline canvas (UX/UI plan)

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Proposed — design only, no implementation authorized |
| **Date** | 2026-08-19 |
| **Relates to** | ADR-035 (the decision), FEAT-007, BR-017, SDD-046 · FR-005, FR-007, FR-012, FR-040, FR-063, FR-064, BR-009, SDD-009, SDD-019, NFR-008 |
| **Bundled as** | FEAT-007 — Pipeline Builder |

This note is the UX/UI half of ADR-035. The ADR decides the boundaries; this one
describes what the user does with their hands, and what the interface owes them
while they do it.

## The shape: three stages of one pipeline

The product already has the three surfaces. What it lacks is that they read as
one motion. The plan is to make each stage produce the input of the next:

```text
  ① Structure          ② Pipeline              ③ Execution
  build the nodes  →   connect node→edge→node  →  release work in order
  /structure           /dependencies (canvas)     /board
```

The invariant that joins them is BR-017: **there is no bare edge.** Stage ②
cannot draw a line without saying what crosses it, and stage ③ reads exactly that
statement to decide what may start.

## Stage ① — Structure: build the nodes

**Today:** a read-only tree of Project → Workstream → WorkContainer → WorkItem.

**Planned (FR-082):** the same hierarchy, editable in place.

- A `+` affordance on any node adds a child *of the type the hierarchy allows
  there* — the level decides the type, so the user is never asked to pick
  "Workstream or WorkContainer?" in the abstract.
- Creating a node opens one modal for the fields that make it real (title,
  description, goal, duration, status, estimated effort). The modal is where
  intent is captured; the canvas is where structure is captured. Splitting them
  is what keeps the canvas from becoming a form.
- Reparenting is a drag, with a `Move to…` control as its equivalent (ADR-035
  D5). A move that the hierarchy forbids is refused **during** the drag — the
  invalid drop target never lights up — rather than accepted and then explained.

**Interaction rules that apply** (`ui-ux-pro-max` §2, §7): a drop target shows
its state before the drop, not after; drag starts past a movement threshold so a
click never becomes an accidental move; the dragged node keeps a live visual
attached to the pointer.

## Stage ② — Pipeline: node → edge → node, with a contract on the edge

**Today:** `DependencyMap.jsx` draws a read-only SVG graph with a derived layout
and an accessible edge-list fallback beside it.

**Planned (FR-083 + FR-084):** the same graph, now the place edges are made.

- Each node exposes a connection handle. Dragging from a source handle to a
  target node proposes an edge.
- **On drop, the contract dialog opens. It is not skippable.** This is the whole
  point: the edge does not exist until the user has said what passes across it.
  Cancelling the dialog cancels the edge.
- The contract asks for two things and no more:
  - **Deliverable** — what the predecessor hands over.
  - **Acceptance** — how we know it happened. Either a reference to an existing
    `Gate` (ADR-035 D2, so gate status *is* the answer), or an explicit
    satisfied/unsatisfied mark with provenance.
- Layout stays derived (ADR-035 D3). Nodes are not draggable *for position*, so
  the only thing a drag can mean here is "connect".
- Self-edges and cycles are refused by the existing FR-007 rule, called — not
  reimplemented. A refusal renders at the attempted edge with its reason.

**The write path** is SDD-046: the drop posts an envelope delta, the server runs
validate → semantic check → dry run, and the optimistic pending edge on the
canvas *is* the preview stage. Clean dry run commits with an audit event; a
failed one reverts the edge and prints why, at the edge.

### Edge states the canvas must be able to draw

| State | Meaning | Must not look like |
|---|---|---|
| `pending` | posted, dry run in flight | committed |
| `declared` | contract stated, unsatisfied | blocking-by-accident |
| `satisfied` | acceptance met, successor released | a plain line |
| `undeclared` | legacy row, no contract (ADR-035 D6) | satisfied |
| `refused` | validation or cycle refusal | a network error |

Five states means colour alone cannot carry them (`color-not-only`, WCAG). Each
needs a shape or a label as well as a hue.

## Stage ③ — Execution: release in the right order

**Today:** one column per `WORK_STATUSES` value; any card can move anywhere.

**Planned (FR-085):** a card whose inbound edges carry declared, unsatisfied
contracts is **held**, and says so on its face — naming the predecessor it is
waiting for, as a link to it, not as prose.

- Held is a *visible* state on the card, not a hidden refusal on drop. The user
  must know before they try.
- Attempting the move anyway explains and offers the only two real exits: go
  satisfy the contract, or change it.
- An `undeclared` legacy edge does **not** hold anything (ADR-035 D6). It is
  surfaced for backfill, not enforced retroactively.

## Accessibility — the part that is not negotiable

NFR-008 binds WCAG 2.2 AA and SC 2.5.7 *Dragging Movements* is AA, so each drag
below ships **with** its equivalent, in the same change, or not at all:

| Drag | Equivalent | Where it already exists |
|---|---|---|
| Add child node | `+` on the parent | new |
| Reparent | `Move to…` menu | new |
| Connect two nodes | select source → `Connect to…` → pick target | the edge list beside the graph is already the non-visual view |
| Move a Board card | `StatusSelect` | already shipped |

The existing accessible edge list is what makes this affordable: the canvas has a
textual twin, so the equivalent is a control on a list rather than a second
interaction model.

Also required, and cheap if done from the start: a visible focus ring on every
node and handle; the graph reachable by keyboard in the same order it reads
visually; `prefers-reduced-motion` honoured by the edge-drawing animation; and
every state above announced, not merely drawn.

## What this plan deliberately does not do

- **No free-form node positioning.** ADR-035 D3.
- **No new write path.** SDD-046. A drag is an intake surface like any other.
- **No second progress-blocking concept.** ADR-035 D2 binds acceptance to `Gate`
  where a gate already exists.
- **No retroactive invalidation of live edges.** ADR-035 D6.

## Open questions for the implementation plan

1. Does the contract dialog need a per-Project template ("every handover in this
   project needs a signed drawing")? Probably yes eventually; deliberately out of
   scope until one project asks twice.
2. Does an edge between nodes in *different* Projects get a contract too? FR-007
   is the cross-project register, so the honest answer is yes, and the canvas is
   project-local — meaning the register UI must be able to state a contract as
   well. Sequencing puts the register first (FR-084) partly for this reason.
3. Board holding is computed per card on render today. With contracts it becomes
   a graph query; whether that stays a client-side derivation or moves into the
   read model is a performance question to measure, not to guess.
