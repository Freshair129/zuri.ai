---
id: ZAI:DOC-LINK-METADATA
title: Document link metadata
version: "0.1.0b"
status: candidate
created_at: "2026-09-06T12:35:07+07:00,RWANG,base 436c0db"
last_update: "2026-09-06T12:49:30+07:00,RWANG"
relations:
  - type: relates_to
    target: ZAI:ADR-025
  - type: references
    target: ZAI:ADR-039
---

# Document link metadata

The owner approved implementing the proposed metadata/template/parser workflow on 2026-09-06. This specification adds document linking without changing existing requirement subjects, domain ownership or runtime code.

## Canonical metadata

Use an explicit namespace-qualified `id` and a `relations` array. Each relation contains `type` and `target`; supported types are `relates_to`, `references`, `supersedes`, `superseded_by`. The versioned structural schema is `contracts/doc-link-metadata.schema.json`. Unrelated existing frontmatter fields remain allowed. An empty `relations: []` opts a document into the convention. Existing documents without link metadata remain valid.

Stable IDs resolve through the discovered document registry. `ZAI:ADR-025` is inferred from an existing ADR filename; existing exact global FR/SDD/etc and FEAT IDs resolve to their graph nodes. Explicit document IDs and optional `aliases` retain identity after moves. A phase such as `ZAI:FR-148-P1` must resolve as a complete explicit ID; it is never truncated to the parent FR. Phase links do not assert automated phase-order or completion tracking.

## Link forms

- Metadata target: a stable ID, an exact relative Markdown path, or a quoted wikilink.
- Body wikilink: `[[ZAI:ADR-025]]`, `[[relative-file.md#heading|label]]`.
- Crosslink: ordinary Markdown links in prose remain valid and are projected as references when their local document target resolves. Existing unresolved historical Markdown references retain legacy preflight behavior; explicit metadata and wikilinks fail closed.
- Code fences, inline-code examples and YAML frontmatter are not prose references.

References to headings verify that the target heading exists. Ambiguous basenames/aliases, duplicate explicit IDs, unknown metadata keys inside a relation, malformed metadata, unsupported relation types, invalid namespaces and missing targets fail the graph generation and strict preflight. YAML uses the safe core schema and bounded alias expansion.

## One relationship authority

Metadata relations are authoritative when supplied. A legacy `**Relates to:**`, `**Supersedes:**` or `**Superseded by:**` line may coexist only if it resolves to the same typed target set; contradiction fails rather than silently combining different declarations. Documents with only legacy lines continue through the existing parser. Repeated targets and equivalent wikilinks/Markdown links are deduplicated by source, target and relationship. Incoming backlinks are derived, never hand-maintained.

The server graph maps `relates_to` to its existing `relates` predicate. An Edge schema-2 export would need an explicit versioned mapping; this change does not claim to add that export or modify Edge's registered predicate vocabulary.

## Output and migration

`npm run govern` regenerates and checks `docs/DOCUMENT-LINKS.md`, a Markdown crosslink/backlink view keyed by the resolved nodes. Wikilinks do not render natively on GitHub; use this generated view for portable navigation. Generated outputs are excluded from link discovery, so backlinks cannot become evidence for themselves.

Templates under `docs/templates/` end in `.md.template`: copy one to a real `.md`, replace every placeholder, give it a unique ID, and run governance. ADR, FR and FR-phase templates share the same relation schema. The phase template has parent/order/owner fields for documentation; automatic phase execution validation remains separate work.

Adoption begins with this specification. Existing documentation is not rewritten in bulk, and no generated graph is hand-edited. Registry IDs are preserved.

## Acceptance

Tests prove valid YAML, safe parsing, wrong relation types/targets, same-basename ambiguity, namespace separation, exact phase IDs, stable IDs after path moves, duplicate IDs, alias collisions, heading links, code-example exclusion, legacy conflicts and deterministic outgoing/backlink generation. CLI tests prove missing metadata targets fail both graph and preflight and stale generated link views fail `docs:check`.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Metadata links, templates, backward compatibility and validation contract | uncommitted | RWANG |
