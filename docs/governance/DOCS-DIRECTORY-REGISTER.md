---
doc_type: filesystem-inventory
status: active
version: "0.3.0"
checked_at: "2026-10-22"
checked_base_revision: "1f1e5a0a7591f4e42646ebc33e78654a4e3477be"
---

# Direct directories under `docs/`

This register records all 20 tracked directories directly under `docs/` at the reviewed base. Counts are direct files / immediate child directories. This change adds local indexes for `domains/`, `plans/`, `roadmap/`, `templates/`, and `prompts/`; those files are absent from the base counts. The table names the entrypoint to use today, including generated or registry indexes where another README would duplicate them.

| Directory | Files / child dirs at base | Current entrypoint | Placement decision |
|---|---|---:|---|
| [`appendices/`](../appendices/) | 4 / 0 | [Architecture index](../architecture/README.md) and [governance index](README.md) | Both generated indexes list the appendix files; a second local catalog would duplicate them. |
| [`architecture/`](../architecture/README.md) | 3 / 4 | `README.md` | Generated architecture navigation; do not edit by hand. |
| [`archive/`](../archive/00-START-HERE.md) | 14 / 1 | `00-START-HERE.md` | Existing dated entrypoint describes the historical pack; archive placement alone does not prove obsolescence. |
| [`change-requests/`](../change-requests/README.md) | 19 / 8 | `README.md` | Local intake rules and proposal index. |
| [`changes/`](../changes/) | 12 / 1 | [Governance index](README.md) | Generated governance navigation lists issued ZV2-CR records and artifacts. |
| [`decisions/`](../decisions/) | 112 / 0 | [Architecture index](../architecture/README.md) | Generated architecture view lists ADRs; preserve their paths and lifecycle. |
| [`deployment/`](../deployment/) | 2 / 0 | [Operations index](../operations/README.md) | Generated operations view lists both deployment documents. |
| [`domains/`](../domains/README.md) | 0 / 15 | `README.md` | Added a charter/SRS inventory without copying canonical requirement text. |
| [`features/`](../features/) | 0 / 46 | [Canonical document registry](../../registry/document-registry/index.json) | Registry owns FEAT paths and membership; do not create a second catalog. |
| [`governance/`](../governance/README.md) | 1 / 0 | [Documentation entrypoint](../README.md) and [generated governance navigation](../governance/README.md) | The main documentation index links the new profile and filesystem registers; the generated view remains unchanged in this no-generator pass. |
| [`migrations/`](../migrations/) | 0 / 4 | [Operations index](../operations/README.md) | Generated operations view lists migration documents; each migration lane keeps its own authority and evidence. |
| [`operations/`](../operations/README.md) | 1 / 0 | `README.md` | Generated operations navigation includes deployment, migrations, plans, and runbooks. |
| [`plans/`](../plans/README.md) | 20 / 0 | `README.md` | Historical base count. After the 2026-10-23 cleanup and explicitly requested PM planning, current enumeration has nine retained sources, four proposed PM plans and README (14 files). Legacy source-path exceptions are explicit in that index. |
| [`product/`](../product/README.md) | 1 / 0 | `README.md` | Generated product navigation. |
| [`prompts/`](../prompts/README.md) | 1 / 0 | `README.md` | Added an index marking the only prompt as historical and non-authorizing. |
| [`requirements/`](../requirements/) | 345 / 0 | [Canonical document registry](../../registry/document-registry/index.json) | Registry owns requirement paths; no second ID list. |
| [`roadmap/`](../roadmap/README.md) | 36 / 2 | `README.md` | Added current-source versus projection and historical-snapshot distinctions. |
| [`runbooks/`](../runbooks/) | 8 / 0 | [Operations index](../operations/README.md) | Generated operations view lists all eight runbooks. |
| [`services/`](../services/README.md) | 1 / 4 | `README.md` | Generated service navigation. |
| [`templates/`](../templates/README.md) | 3 / 0 | `README.md` | Added template scope and a linked domain-SRS skeleton. |

## Findings

- At the reviewed base, six of the 20 directories had a direct README. This change adds five local indexes; 11 now have a direct README. The remaining nine have a named canonical or generated entrypoint in the table.
- `features/` and `requirements/` are indexed by the canonical registry. `decisions/`, `changes/`, `migrations/`, `deployment/`, `runbooks/`, and `appendices/` are covered by generated navigation. A duplicate local file list would create another copy to drift.
- `archive/00-START-HERE.md` is the existing archive entrypoint. `prompts/README.md` is the only new local index needed for its single historical prompt.
- The directory register is not a complete recursive file listing. For any edit or deletion, enumerate the affected subtree, including tracked, untracked, and ignored files, as required by `AGENTS.md`.
- A tracked-file SHA-256 scan found four byte-identical pairs under `change-requests/` and `migrations/document-reintegration/record-migrations/`. Each pair has an intake path and a named approval snapshot; preserve both as provenance and do not deduplicate by hash alone. The scan found no byte-identical Markdown or Prisma files directly under `docs/`.
- Do not add directories or files solely to make this inventory symmetrical. A missing local README is acceptable when an exact canonical index already covers the contents.

## Version diff

0.2.0 → 0.3.0 (2026-10-23): record four explicitly requested proposed PM plans
after SRS approval; fourteen current direct plan-folder files. The historical
reviewed-base counts and retained-source classifications remain unchanged.

0.1.1 → 0.2.0 (2026-10-23): records the plan cleanup and current ten-file
enumeration while preserving the table's original reviewed-base counts. The
retained non-plan sources require reader/pinned-reference reconciliation before
relocation; folder names alone do not authorize their deletion.

0.0 → 0.1.1 (2026-10-22): Enumerates all 20 direct documentation folders, resolves each folder to a local, generated, or canonical entrypoint, classifies the prompt artifact, and records exact-copy evidence without deleting provenance.
