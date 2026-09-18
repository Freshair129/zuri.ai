---
version: "1.1.0"
created_at: "2026-09-13T21:30:00+07:00,Claude Opus 5"
last_update: "2026-09-16T22:45:00+07:00,RWANG"
status: "accepted"
superseded_by: null
attributes:
  domain: "knowledge"
  doc_type: "architecture-decision"
  scope: "a Knowledge (GKS) navigation slot for zuri-ai's own knowledge lane, and the data pipeline map it opens with: a hand-maintained registry of where data enters, where it is combined and who receives it, a generator that derives surface levels and validates every id and path, a committed runtime projection, and a node-edge view"
---

# ADR-085 — A Knowledge (GKS) slot, and the data pipeline map as a validated registry

**Status:** Accepted. Implemented locally by FR-212, FR-213, FR-214 and FR-215
(FEAT-033) in the same lane; production/live activation remains a separate gate.
**Date:** 2026-09-13
**Decided by:** Boss (instruction of 2026-09-13: "สร้างเป็น visual node edge เป็น sub domain ในโดเมน genesis knowledge system วางแผนงานทั้งหมดเเล้ว เพิ่มtaskไปในroadmap ก่อนแล้วค่อนลงมือ"), planned as TASK-ZAI-060 to TASK-ZAI-063 in programme v0.4.3.
**Relates to:** [ADR-063](ADR-063-RETIRE-TIER1-GENESISBLOCKDB-DIRECT-CLIENTS.md),
[ADR-050](ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md),
[ADR-081](ADR-081-GENERATED-VIEWS-ARE-BUILT-NOT-COMMITTED.md),
[ADR-069](ADR-069-SCM-IS-A-PARENT-DOMAIN-OVER-WAREHOUSE-INVENTORY-PROCUREMENT-AND-ORDER-MANAGEMENT.md),
FR-060, FR-061, FR-071, FR-124, FR-040, FR-101, SEC-008,
`docs/domains/knowledge/CHARTER.md`, `docs/DATA-PIPELINE-MAP.md`.

## Context

The owner asked a question nothing in the repository answers in one place: where does data come
into zuri-ai, who receives data from it, where is data combined before it is sent on, and how many
such chains are there — each with its domain, its FEAT and whether it has a surface yet. Three
documents answer parts of it, each out of reach of the rest:

- `docs/ARCHITECTURE-DIAGRAMS.md` §3 draws a data flow diagram dated 2026-08-15. It still shows the
  V1 cutover and `zuri-cli` as the LINE transport, both retired since (ADR-024, ADR-061).
- `docs/SYSTEM-DIAGRAM.md` (2026-09-05) draws the system context and the LINE path, with no status
  per surface and no FEAT per flow.
- `docs/KNOWLEDGE-INGESTION-SURFACES-AND-USER-FLOWS.md` is exact, and covers one domain.

The owner also placed the answer: a visual node-edge view, as a sub-domain inside the Genesis
Knowledge System domain. Two facts in the repository constrain that placement.

**ADR-063 D4: GKS is never a zuri-ai domain.** GKS, MSP and GenesisBlockDB are external systems
with their own repositories. The `knowledge` lane holds only the Tier 1 contracts that face GKS;
its charter already says that "(GKS)" names the authority the lane *consumes*.

**The knowledge lane has no navigation slot.** `DOMAINS` in `src/config/domains.js` has no
`knowledge` entry, so the lane's surfaces live elsewhere today (admission in `/files`, the ledger
monitor in `/execution/data-migration`) and TASK-ZAI-047's knowledge base console has nowhere to go.

A map drawn once goes stale the way §3 did. What made `domain-state.json` stay honest (FR-124) is
that it is regenerated from the filesystem on every `govern` run and CI fails when it drifts.

## Decision

### D1 — The slot is `knowledge`, labelled Knowledge (GKS), and it is zuri-ai's lane, not GKS

`DOMAINS` gains one flat entry, key `knowledge`, label **Knowledge (GKS)**, base path
`/knowledge`, owned by `docs/domains/knowledge/CHARTER.md`. The label names the authority the lane
consumes, exactly as the charter's opening line does, so ADR-063 D4 stays true word for word: no
GKS runtime, model or store enters this repository, and nothing here decides what GKS knows.

It is a real domain key rather than a `DOMAIN_GROUPS` container (ADR-069 D2), because it owns
pages. That makes it grantable: a Business OWNER sees it by default through `VIEWER_DOMAINS`, and a
member sees it only when their Membership names it — nothing that exists today changes meaning,
because no stored grant names `knowledge` yet.

The slot opens with one page, the data pipeline map (FR-213). The knowledge base console of
TASK-ZAI-047 is the next page planned for it.

### D2 — The map is a registry of facts plus a generator that derives what can be derived

`docs/DATA-PIPELINE-MAP.md` carries one JSON block between `data-pipeline-registry` markers:
nodes (sources, entry surfaces, processes, stores, recipients), edges (one labelled flow each) and
chains (an ordered path of edges from a source to a recipient). The flows are hand-maintained,
because no scan can tell that a webhook's rows feed a model call — that is design, not structure.

Everything that *can* be derived is derived, and nothing hand-written may contradict it. The
generator (FR-212):

- resolves each declared surface against the tree — an `ENDPOINT` must be an existing
  `src/app/api/**/route.js`, a `UI` an existing `page.jsx`, an `MCP` tool a name in the MCP tool
  registry, a `WORKER` or `FILE` an existing file — and fails by name when one is missing;
- reads each node's requirement statuses from the FR-124 snapshot and each requirement's FEAT from
  the same snapshot, and fails on an id the snapshot does not know;
- accepts a production claim only with written evidence;
- fails on an edge to an unknown node, a node no edge touches, and a chain whose edges do not join
  end to end.

### D3 — Two axes, never one number

Each internal node carries a **build status** and a **surface level**, and the two are never folded:

| Build status | Meaning |
|---|---|
| `BLOCKED` | declared and explicitly blocked (the node says why) |
| `DECLARED` | declared in the registry of requirements; no code |
| `PARTIAL` | some code or tests, not every requirement verified |
| `CODE_TESTS` | every requirement has code and tests (FR-124's `verified`) |
| `PRODUCTION` | available on production, with the evidence written on the node |

| Surface level | Meaning |
|---|---|
| `NONE` | no surface of its own |
| `WORKER` | a worker, script or file only |
| `MCP` | an MCP tool |
| `ENDPOINT` | an HTTP endpoint |
| `UI` | a console page |

An edge's status is the weakest status of the internal nodes it joins; a chain's is its weakest
edge. External sources and recipients carry neither axis. A chain is counted once, by id, so "how
many chains" is a number the generator computes, not a sentence someone keeps current.

### D4 — A committed static projection, rendered on the server, admitted by the slot

The generator writes `docs/.data-pipeline-map.json` (built, not committed — ADR-081 D1) and
`apps/server/runtime/data-pipeline-map.json` (committed — ADR-081 D2, for the same reason as
`domain-state.json`: the server imports it and the Docker context cannot rebuild it). `docs:check`
fails when the projection is stale and CI fails when the committed copy drifts.

The projection holds architecture metadata only — node labels, paths, ids, statuses — and no
Tenant, Business, Person or Customer data. The page resolves the viewer on the server and admits
it only when `knowledge` is visible in the active Business (FR-061), before any of the projection
reaches the RSC payload, in the shape FR-124's server-side seam established.

### D5 — The only live part is a later, Business-scoped overlay

Counts by status and the last run per edge (FR-215) are Business data. They are read later, for
the active Business only, through each owning domain's read port — the FR-071 ledger, the LINE and
rich menu job tables, the extraction jobs — and an edge with no backing table shows no number
rather than zero. The local implementation uses four bounded owning-domain read ports, one read
per backing table, and returns unavailable/null when a read fails or the owner-domain grant is not
available; it never turns a failed read into zero. Failed edges retain monitor links. The static map
never waits on them. Nothing in this overlay adds a GKS, MSP or GenesisBlockDB runtime or proves
production activation.

### D6 — Hand-rolled SVG, and a list view that is the same rows

The view draws layered columns (sources, entry surfaces, processes, stores, recipients) as inline
SVG with no graph library, as FR-040 and FR-101 already do. Every node and edge is reachable by
keyboard, and a list view shows the same chains, nodes and edges as tables, so the page does not
depend on reading a drawing.

## Consequences

1. `ARCHITECTURE-DIAGRAMS.md` §3 and `SYSTEM-DIAGRAM.md` point to the new map as the current data
   flow view and keep their text as dated records.
2. A new data surface that is not added to the registry is not caught automatically — the
   generator validates what the registry says, it cannot see what it omits. The map's own
   document says so, and the PR checklist for a new entry or exit surface names it.
3. A registry edit changes the committed runtime projection, so the change carries a regenerated
   `runtime/data-pipeline-map.json`, exactly as a requirement change carries `domain-state.json`.
4. The `knowledge` key joins every consumer of `DOMAINS` — the permission checkboxes, the route
   guard, the bar — the same way `inventory` did.

## Version diff

1.0.0 → 1.1.0 (2026-09-16): FR-215 is implemented locally with four owning-domain read ports,
Business-scoped authorization and truthful unavailable/null states; no model, migration, external
runtime activation or production evidence is added.
