---
doc_type: filesystem-index
status: active
version: "0.1.0"
checked_at: "2026-10-22"
checked_base_revision: "1f1e5a0a7591f4e42646ebc33e78654a4e3477be"
---

# Documentation templates

Templates define structure, not requirements, ownership, IDs, acceptance, or approval. Copy a template only when its document profile applies; fill source links and status from approved authority.

| Template | Intended document |
|---|---|
| [ADR.md.template](ADR.md.template) | Architecture decision record; use the ADR lifecycle and authority |
| [FR.md.template](FR.md.template) | Explanatory note for an existing FR; it does not issue or change an FR |
| [FR-PHASE.md.template](FR-PHASE.md.template) | Phase note linked to an existing parent requirement; not an execution gate |
| [DOMAIN-SRS.md.template](DOMAIN-SRS.md.template) | Proposed linked domain SRS view; list canonical IDs and source paths without copying their normative text |

The canonical requirement-record format has its own templates under [registry/document-registry](../../registry/document-registry/). Those are generator-owned projection scaffolds, not substitutes for the explanatory templates listed here.

No template creates a new domain, feature membership, requirement ID, or lifecycle state. Resolve authority and ownership before copying one.

## Version diff

0.0 → 0.1.0 (2026-10-22): Lists the available explanatory templates, adds the
linked domain-SRS view template, and distinguishes these from canonical record
generator scaffolds.
