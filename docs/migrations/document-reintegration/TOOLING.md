---
doc_type: migration-tooling-contract
status: draft
version: "0.1.0"
---

# Document query tooling contract

**Version:** 0.1.0
**Scope:** local read-only queries over the current ZAI canonical document registry
and one committed document-graph snapshot.

These tools provide bounded views over current declarations and graph bindings.
They do not approve imported specifications, run tests, report test outcomes, or
infer runtime or production status. The canonical index and graph remain the only
inputs; the query tools do not scan external repositories or fetch network data.

## Identity and lookup

The canonical registry declares ZAI records as `ZAI:<ID>`. A caller may also use a
bare ID when it resolves to exactly one ZAI declaration. Lookup is exact: an unknown
or ambiguous ID fails with a non-zero exit. A feature's requirement scope comes only
from its explicit `requirementKeys` parsed from the canonical FEAT row; tools do not
infer membership from number prefixes, neighboring IDs, or graph navigation links.

`ZNEXT:<ID>` is treated as source provenance, never current implementation or
verification evidence. `edge::<ID>` is classified separately as Edge. The query
tools classify those namespace prefixes without asserting that the referenced ID
exists in its source registry, and return no current ZAI evidence for them. They are
never silently treated as ZAI requirements. Graph nodes and test files under
`apps/edge/` remain in an Edge app group, separate from the server and service groups.

## Query behavior

`tools/tests-for.mjs` lists current `verifies` graph bindings for an exact FR or for
the explicit FR members of a FEAT. It returns only graph test nodes whose file path
exists under the selected repository root. Missing paths remain visible as missing
bindings. Repo-relative `apps/edge/` and `services/` paths retain their package
prefix; a server-relative path is resolved below `apps/server/`. Run commands are
grouped by application package and test runner (server Vitest and Playwright are
separate groups), with a structured `argv` array in JSON and a PowerShell-quoted
display form; the tool never executes them. A binding records
that the graph connects a test file to a requirement. It does not mean that the
test ran or passed. A requirement binding counts as current ZAI evidence only when
the graph's exact requirement node is also namespaced ZAI and marked current, any
namespaced edge endpoint is ZAI, and the edge is current with a recognized source
(`test-reference`, `trace-annotation`,
or `transitive` for `verifies`; `annotation`, `qualified-annotation` or `trace-annotation` for
`implements`; `annotation` for `tests`). Other evidence-shaped edges are returned
under `unverifiedEvidence` by impact queries and do not enter test bindings or the
review set.

`tools/impact.mjs` reports graph relations incident to the requested declaration in
separate groups: typed evidence (`implements`, `verifies`, `tests`), other typed
relations, navigation-only `relates`, and weak `references`. For a FEAT it also
queries only the FRs explicitly listed by that feature. Only typed relations
appear in the review set. Neither `relates` nor `references` is promoted to
dependency, implementation, ownership, or verification evidence.

`tools/document-readiness.mjs` reports whether the canonical declaration and graph
node exist, and how many current code and test bindings the graph declares. FEAT
readiness aggregates only its explicit FR membership. These are declaration and
binding-completeness measures; they do not promote document approval, delivery to
implemented/live, test execution, hosted CI, runtime activation, or production
readiness.

## Inputs and invocation

Each CLI accepts `--root <repo-root>`, `--graph <graph-file>`, and `--json`.
Without `--root`, the repository root is derived from the tool file, not the current
working directory. `--graph` may be absolute or relative to the selected root; the
default is `docs/.doc-graph.json`. The tools read `registry/document-registry/index.json`
and the indexed canonical records from that root. They never rewrite these inputs.

Examples:

```text
node tools/tests-for.mjs ZAI:FR-042 --json
node tools/tests-for.mjs ZAI:FEAT-001 --root <repo-root> --graph <graph-file>
node tools/impact.mjs ZAI:FR-042 --json
node tools/document-readiness.mjs ZAI:FEAT-001 --json
```

Exit code 0 means a ZAI canonical identity was resolved or a foreign namespace was
classified, and a report was produced, including a report with zero bindings. Exit
code 1 means an unknown or ambiguous ZAI identity, malformed registry/graph, or
unreadable input. Exit code 2 means invalid command-line usage. JSON mode returns
the same facts as text mode and does not change these semantics.

## Version history

- **0.1.0** — initial contract for read-only current-registry test, impact, and
  declaration/code/test-binding queries; explicit ZNEXT provenance and Edge
  separation; no execution or delivery-status claims.

Commands include structured argv and an explicit working directory. Displayed PowerShell commands restore the caller directory after the selected runner exits. Canonical queries use the strict registry reader; dangling graph endpoints are unverified evidence.

Only implements/verifies/tests count as evidence and require existing endpoints. Other typed relations and depends_on remain navigation/review leads; missing endpoints are explicitly type unknown and do not prove implementation or verification.
