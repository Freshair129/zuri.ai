---
domain: integration
feature: FR-101
module: integration
source: v2-native
version: "0.1.0"
status: proposed
---

# FR-101 — SoT pipeline graph dashboard

## Rationale

Boss asked for the pipeline to be visible as nodes connected by edges — the
mental model the whole SoT design is drawn in — with live status, inside zuri-ai.
The one node/edge renderer in the product (FR-040's project dependency map) is
deliberately scoped to a single Project's work items, so the pipeline needs its
own reader surface. What it must not need is a new data source: everything it
shows is already available from FR-099 (plan + derived status) and FR-100
(pending decision counts).

## Contract

1. **Same data shape as the dependency map.** The dashboard consumes
   `{ version, nodes: [{ id, type, title, status }], edges: [{ id, source,
   target, label? }] }` produced by a pure builder
   (`sot-pipeline-graph.js`) from the FR-099 plan + status payload: one node per
   phase, plus source/store/consumer context nodes declared in the plan file;
   one edge per `dependsOn`. Reusing the shape keeps a later merge of the two
   renderers possible.
2. **Read-only SVG, no library.** Rendered like the dependency map: hand-rolled
   SVG, layered left-to-right by topological depth (not a grid), status carried
   by node fill using the shell's existing status palette. No zoom, pan, drag or
   client-side graph library.
3. **Status legend is FR-099's.** `planned / running / blocked / done` plus a
   pending-decision badge (count) on phases that wait on a human — the badge
   links into the FR-100 inbox filtered to that phase.
4. **One route.** `/platform/sot-pipeline/graph`, viewer-scoped exactly like the
   board; it calls the same `GET /api/platform/sot/plan` endpoint (one fetch,
   two surfaces).

## Not in scope

No arbitrary-graph rendering service, no editing from the canvas, no live
websocket updates (refresh/poll only), and no import of a client-side graph
layout library.
