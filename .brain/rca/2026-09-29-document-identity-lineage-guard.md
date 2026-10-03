# Identity-only lifecycle status triggered document successor warning

## Symptom

After adding RSK and MI-RQ identity nodes to the generated graph, strict preflight
reported a new lineage warning for `identity:ZAI:RSK-006`. The risk is closed and
has no replacement identity.

## Evidence

- The generated `docs/.doc-graph.json` node for `identity:ZAI:RSK-006` carries
  `type: document-identity` and `status: superseded`.
- `docs/appendices/E-risk-matrix.md` strikes through RSK-006's resolved risk text
  and says it was closed by the owner; it names no successor ID.
- `apps/server/scripts/doc-preflight.mjs` applied its successor-edge check to every
  graph node with superseded status, regardless of node type.
- The baseline had one warning for ten dangling graph links; adding the identity
  node raised the warning count to two without changing an existing source record.

## Root Cause

The new identity projection correctly retained the source record's lifecycle status,
but preflight treated every superseded graph node as a content-bearing document or
requirement that must point to a successor. Identity-only nodes are reference targets,
not superseded content records.

## Why the issue escaped detection

The earlier graph had no standalone nodes for embedded RSK and MI-RQ identities.
Existing graph tests checked qualified identity resolution and edge types, but did
not check how strict preflight classifies a superseded identity-only node.

## Proposed Prevention

Keep lifecycle status on identity-only nodes and exclude that node type from the
successor-edge obligation. Preserve the check for content-bearing documents and
requirements, add a regression test for both cases, and keep the governance warning
count at its prior baseline. Do not invent a successor ID or rewrite the risk row.
