# ADR-026 — Agent Topology for the Visual Office

**Status:** Accepted
**Date:** 2026-08-16
**Decided by:** Boss (owner)
**Relates to:** [ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md) (the domain spine this stands on), [ADR-023](ADR-023-AGENT-VAULT-AND-EPISTEMIC-MEMORY.md) (where a desk's beliefs live), [ARCHITECTURE-TARGET-MODULAR-MONOLITH.md](../ARCHITECTURE-TARGET-MODULAR-MONOLITH.md) §21 and invariants 1–3, 12 (agents consume capabilities, they do not own tables), [docs/domains/agent/CHARTER.md](../domains/agent/CHARTER.md) (the LINE/AI runtime domain — *not* this topology)
**Supersedes:** nothing

## Context

The owner asked how agents should be arranged for the **Visual Office** — the
planned surface where a person watches zuri-ai's agents work as if looking at an
office floor, instead of reading a log. Three arrangements were on the table:
**role-based** (a dev desk, a QA desk, a PM desk), **domain-based** (a desk per
business domain), or **hierarchical / adaptive scheduling** (a manager agent that
assigns and re-assigns dynamically).

This is not a cosmetic question. Whatever the office *shows* is whatever the
system *is* — a floor plan is a projection of a topology, and a topology the UI
has to lie about is the wrong topology.

There is also evidence to decide on, because this repository was itself built by
concurrent agents and its failures are on the record: two sessions claiming
`ADR-020` at the same moment; a session committing onto another session's branch
and switching it mid-command; plans derived from documents describing a program
that had already been retired. Those are **collision**, **authority** and
**staleness** failures — precisely the three things a topology decides.

[ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md) already answered the
analogous question for documents and chose domains, for a reason that transfers
directly: domains are the slowest-moving axis, and they are the axis on which
**write ownership is already defined** (architecture invariants 1–3). Agents
that write need lanes. The lanes already exist, are already declared in charters,
and are already enforced by preflight.

## The three candidates

| Basis | What it optimizes | Verdict |
|---|---|---|
| **Role-based** — permanent dev / QA / PM / architect desks | Immediately legible to a human; the office metaphor's obvious first draft | **Rejected as the spine.** A role desk needs write access wherever its role applies — that is, everywhere — which dissolves lane ownership and reproduces the spec's *"agent as database superuser"* anti-pattern (§25). Roles survive as **hats** (D3), where they cost nothing |
| **Domain-based** — one desk per domain | Write ownership, collision safety, and traceability that already exists | **Chosen.** The lanes are already defined (`docs/domains/<d>/CHARTER.md`), already mirror `src/modules/`, and a module without a charter is already a preflight CRITICAL. The floor plan is a governed artifact on day one |
| **Hierarchical / adaptive scheduling** | Throughput under uneven load | **Deferred, not rejected — and it was never a third alternative.** It is a *scheduling policy* layered over whichever topology you pick, not a topology itself. It also needs a baseline to adapt against, and none exists yet (D7) |

## Decision

| # | Decision |
|---|---|
| D1 | **Domain agents are the permanent staff.** One desk per domain, one-to-one with `docs/domains/<d>/CHARTER.md`. The office floor plan *is* the domain list — a desk appears because a module and its charter exist, never the other way round |
| D2 | **The charter is the job description.** No separate per-domain agent-role document. A desk's authority, boundaries and public contracts are read from the charter it already has. Reason: a second copy of an ownership fact is a copy that will rot, and preflight can only guard the copy it knows about (the 2026-08-16 drift RCA) |
| D3 | **Roles are hats, not desks.** reviewer, tester, planner, doc-architect exist as *transient* workers spawned inside a domain agent's turn. A role worker carries no authority of its own — it inherits the lane of the desk that spawned it and dies with the task |
| D4 | **Scheduling is shallow: exactly two layers.** Orchestrator (layer 1) → domain agents (layer 2). Role workers are not a third layer; they live inside one desk's turn and are that desk's business. No agent-manages-agent recursion. Each extra layer is another place a stale instruction gets handed downward and another place the trace breaks — and stale instructions are this repo's worst recorded incidents |
| D5 | **Work reaches a desk through a per-domain queue, claimed under lease.** A task is enqueued to exactly one domain. A desk claims it, holding a lease with a deadline; an expired lease returns the task to the queue and is **recorded as a lease breach**, never silently reassigned. **At most one active claim per domain** — a lane lock, not a file lock. This is what makes "two agents edited the same thing" structurally impossible rather than merely unlucky |
| D6 | **Cross-lane work is split, never granted.** A task touching two lanes becomes two tasks with a contract between them, sequenced by the orchestrator — the direct mirror of invariant 3 (cross-domain writes go through module contracts). No desk is ever granted temporary write access to another lane |
| D7 | **Adaptive scheduling is deferred, and instrumented for.** The queue records what a future scheduler would need — wait time, lease breaches, rework rate, split rate. No priority learning, no dynamic re-assignment, no manager agent is built now. A topology decision must not smuggle in a scheduler (the same restraint as ADR-025 D8) |
| D8 | **The Visual Office is a projection of the queue, not an authority.** The floor renders desks (domains), occupancy (active claims), inbox depth (queue), and current hats (role workers). It holds no state the queue does not have. Same contract as `FEATURE-MAP.md` / `DOMAIN-MAP.md` / `TRACE.md`: a view that can show something its source does not know is a view that can lie |
| D9 | **This ADR decides topology only.** Where the queue lives (table, file, or external service), which model runs a desk, how the office is rendered, and the FR/FEAT ids for all of it are separate decisions taken when implementation starts. Nothing here obliges a schema change today |

## What this buys

- **The floor plan cannot drift from the code.** The domain list is already
  preflight-enforced, so an office showing five desks while `src/modules/` holds
  a sixth unchartered one is a CI failure, not a UI bug. Free — ADR-025 paid for it.
- **Collisions become impossible instead of unlucky.** Single-writer-per-lane
  (D5) plus no cross-lane grants (D6) removes the mechanism behind every
  concurrency incident this repo has recorded.
- **A stuck agent is visible and recoverable.** A lease that expires surfaces as a
  breach on the floor; today a silent session simply holds ground indefinitely.
- **The office is honest by construction.** D8 makes the surface a query over
  queue state, so "what is the system doing" and "what does the screen say" cannot
  diverge.

## Consequences

- **Load is uneven, and it will show.** Five domains today, but `project-manager`
  owns three modules and most routes while `crm` and `knowledge` are thin. With
  single-writer-per-lane a busy lane serializes. Accepted deliberately: D7 keeps
  the measurement, so splitting `project-manager` into finer domains becomes a
  data-driven decision rather than a hunch — and splitting the lane is the
  answer, never granting cross-lane writes.
- **Long work must renew its lease.** A desk that goes quiet loses its claim.
  That is the point: an agent holding a lane forever is the failure this exists
  to prevent.
- **Role workers are not addressable from outside.** "Ask the reviewer" is not
  something a user can do in the office. They ask a *desk*, which may put on the
  reviewer hat. This is the cost of D3, and it is the cost that keeps roles from
  needing global write access.
- **Two different things both contain the word *agent*.**
  `docs/domains/agent/CHARTER.md` is the domain that runs user-facing LINE/AI
  turns. This ADR is the topology of the agents that *build the product*. They
  are unrelated; do not merge them, and do not let one's boundaries be quoted as
  the other's.

## Review

Revisit when either of these happens:

1. **A lane's wait time or lease-breach count makes serialization the
   bottleneck.** That is the signal to split a domain — not to relax D6.
2. **The first ERP domain from the architecture spec gets a module**, adding its
   desk. Re-check that D4's two layers still hold at roughly ten desks: the
   orchestrator's fan-out is the part that degrades first, and if it does, the
   answer is a scheduling policy under D7, not a third layer.
