# Qualified graph compatibility during documentation reintegration

## Symptom

The composed graph comparison lost legitimate requirement bindings from slash-separated
legacy references and explicit ZAI references in Edge tests.

## Evidence

- `apps/server/src/modules/project-manager/api-docs/openapi.js` names
  `ADR-106/SDD-110`; the first exact-token scanner excluded the second token.
- `apps/server/tests/integration/openapi-docs.test.js` names
  `FR-133/FR-135/FR-136`; replacing a single pair did not preserve a chain.
- `apps/edge/tests/unit/conversation-progress.test.ts` explicitly names current
  ZAI requirements with qualified `@req`; the source scanner handled them but
  the test scanner initially handled only bare tokens and new `@trace`.

## Root cause

The compatibility adapter treated slash punctuation as a path delimiter everywhere,
and qualification support had not been applied symmetrically to existing test
annotations. Exact identity matching is necessary but must preserve the complete
legacy reference grammar.

## Why the issue escaped detection

Aggregate requirement coverage remained complete through other bindings. Unit
fixtures covered one slash pair and new trace annotations, but not three IDs,
ADR-to-SDD pairs, or the existing qualified Edge test annotation.

## Proposed prevention

A second graph comparison found four legacy wikilinks in the FR-065 design
resolving to newly introduced canonical document basenames instead of their
original requirement nodes. `doc-links.mjs` selected a basename before checking
the exact global ZAI identity. Keep exact declared global identity resolution
ahead of filename aliases, while explicit `.md` paths still select files. Add a
fixture containing both a requirement and its same-named canonical document.
The query consumer's initial source allowlist also omitted `trace-annotation`
for implementation edges, although the graph adapter emits it for current
`@trace implements`. Accept that exact adapter source while keeping foreign
namespaces and crosswalk-derived edges outside current evidence; cover the
adapter-to-query boundary with a binding-completeness regression fixture.

Normalize only complete slash-separated ID lists, without inferring abbreviated
IDs or parsing paths/foreign namespaces. Resolve qualified test `@req` through the
same exact current declaration map. Compare typed edge triples against the pinned
baseline and individually classify every removed edge; aggregate coverage alone
is insufficient. Keep parser regression fixtures for chains and path refusal.
