---
version: "0.1.0b"
created_at: "2026-08-17T00:01:00+07:00,CLAUDE"
last_update: "2026-08-17T00:01:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "doc-governance"
  doc_type: "root-cause-analysis"
  scope: "preflight reported two CRITICALs that were artifacts of the graph it reads"
---

# Incident — preflight reported a CRITICAL about a requirement that was declared

## Symptom

On a branch that added `FR-058` and `FR-059`, `npm run docs:preflight` reported:

```
critical 2 · warning 0 · info 13 → CRITICAL
  [CRITICAL] id-uniqueness: FEAT-001 bundles FR-058, which is not declared in
             the PRD registry — features bundle real requirements only
  [CRITICAL] generated-view: FEATURE-MAP is blind to 2 feature note(s)
```

FR-058 **was** declared, as a properly formatted row in
`docs/PRD-SDD-v1.0.md`, in the same shape as FR-057 beside it.

## Root cause

`scripts/doc-preflight.mjs` does not read the PRD to learn which ids are
declared. It reads the **committed graph**:

```js
const declaredFr = existsSync(GRAPH)
  ? new Set(JSON.parse(read(GRAPH)).nodes
      .filter((n) => n.type === 'requirement')
      .map((n) => n.id.slice(4)))
  : null
```

The graph is a build artifact of `docs:graph`. On a branch that adds a
requirement but has not yet regenerated, the graph legitimately does not know
about it — so preflight reports a true statement about a stale input as if it
were a fact about the repository.

## Why this matters more than a false alarm

`CLAUDE.md` documents the order as:

```
docs:preflight → docs:graph → docs:check
```

For most checks that order is right: preflight catches structural problems before
the graph is rebuilt over them. But **two of its checks consume the graph**, and
for those the documented order is exactly backwards. Following the documented
procedure on any branch that declares a new id produces a CRITICAL that is not
real.

The danger is not the wasted minute. It is that a CRITICAL which is *routinely
false in a common situation* trains everyone — human and agent — to regenerate
and re-run without reading it. The next time it is true, it will be dismissed the
same way.

## Resolution in this instance

Running `docs:graph` first cleared both CRITICALs, and the subsequent preflight
was `critical 0 · warning 0 → PASS`. The finding was verified rather than
assumed: the graph was inspected directly to confirm both FRs became requirement
nodes with real `implements` and `verifies` edges (`FR-058`: 3 code, 5 tests;
`FR-059`: 9 code, 7 tests).

A second, related observation: the graph's coverage line read
`FR with code 100% (57/57)` even after both FRs were present, because the metric
counts delivered requirements and both were still `🔜`. It only became `59/59`
once the PRD status column was flipped. The number was correct at every step, but
it looks like the new work is missing — worth knowing before someone reads it as
a gap.

## Recommended fix

Not applied in this session — recorded for a separate change:

1. Make the graph-dependent checks either derive declared ids **from the PRD
   directly**, or state plainly in their message that they are reporting against
   a possibly-stale graph and name the remedy.
2. Update the documented order in `CLAUDE.md` / `AGENTS.md` to reflect that a
   branch introducing new ids must run `docs:graph` before `docs:preflight` — or
   have preflight regenerate what it needs.
3. Consider having preflight detect a stale graph explicitly (compare the PRD's
   id set against the graph's) and report *that* as the finding, which is the
   actionable statement.

## Prevention

- **A check that reads a build artifact is reporting on the artifact, not on the
  source.** Its message must say so, or it will be read as a claim about the
  repository.
- **A guard that cries wolf in a routine workflow is worse than no guard**, since
  it teaches the reflex that defeats it.
