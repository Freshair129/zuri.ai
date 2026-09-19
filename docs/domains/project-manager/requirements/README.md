---
domain: project-manager
doc_type: proposal-requirement-index
version: "0.1.0b"
created_at: "2026-09-18T20:42:13+07:00,RWANG"
last_update: "2026-09-18T20:42:13+07:00,RWANG"
superseded_by: null
source: gpt-site-spine
status: candidate
attributes:
  doc_type: proposal-requirement-index
  domain: project-manager
---

# Project Manager proposal requirements

This directory is the extracted requirement layer of the Site-derived PM design spine.

The public design Site supplied the reading order and the initial requirement catalog. The repository now stores one PMR body per file so the same behavior is not copied between document 01, the SRS, workforce design and implementation packets.

PMR/PMF/PMT are proposal-local keys. They are useful for design traceability, but they are not canonical FR/FEAT/ADR identifiers. A future implementation slice must first register a canonical requirement with the repository governance tooling.

## Requirement files

| Key | Capability | Owner | Acceptance | Existing FR context | File |
|---|---|---|---|---|---|
|PMR-001|PMF-01|project-manager|PMT-001|FR-003, FR-069, FR-108|[PMR-001](PMR-001-proposal-requirement.md)|
|PMR-002|PMF-01|project-manager|PMT-002|FR-070, FR-124|[PMR-002](PMR-002-proposal-requirement.md)|
|PMR-003|PMF-01|project-manager|PMT-003|FR-124|[PMR-003](PMR-003-proposal-requirement.md)|
|PMR-004|PMF-02|project-manager|PMT-004|FR-007|[PMR-004](PMR-004-proposal-requirement.md)|
|PMR-005|PMF-03|project-manager|PMT-005|FR-019, FR-106|[PMR-005](PMR-005-proposal-requirement.md)|
|PMR-006|PMF-04|project-manager|PMT-006|none|[PMR-006](PMR-006-proposal-requirement.md)|
|PMR-007|PMF-05|project-manager|PMT-007|none|[PMR-007](PMR-007-proposal-requirement.md)|
|PMR-008|PMF-06|integration|PMT-008|FR-070|[PMR-008](PMR-008-proposal-requirement.md)|
|PMR-009|PMF-07|integration|PMT-009|FR-048|[PMR-009](PMR-009-proposal-requirement.md)|
|PMR-010|PMF-07|integration|PMT-010|none|[PMR-010](PMR-010-proposal-requirement.md)|
|PMR-011|PMF-07|integration|PMT-011|FR-242|[PMR-011](PMR-011-proposal-requirement.md)|
|PMR-012|PMF-08|identity|PMT-012|FR-191, FR-192|[PMR-012](PMR-012-proposal-requirement.md)|
|PMR-013|PMF-06|project-manager|PMT-013|FR-196|[PMR-013](PMR-013-proposal-requirement.md)|
|PMR-014|PMF-02|project-manager|PMT-014|none|[PMR-014](PMR-014-proposal-requirement.md)|
|PMR-015|PMF-08|project-manager|PMT-015|FR-124|[PMR-015](PMR-015-proposal-requirement.md)|
|PMR-016|PMF-01|project-manager|PMT-016|none|[PMR-016](PMR-016-proposal-requirement.md)|
|PMR-017|PMF-01|project-manager|PMT-017|none|[PMR-017](PMR-017-proposal-requirement.md)|
|PMR-018|PMF-10|project-manager|PMT-018|none|[PMR-018](PMR-018-proposal-requirement.md)|
|PMR-019|PMF-08|identity|PMT-019|FR-198|[PMR-019](PMR-019-proposal-requirement.md)|
|PMR-020|PMF-10|integration|PMT-020|FR-239, FR-240|[PMR-020](PMR-020-proposal-requirement.md)|
|PMR-021|PMF-06|integration|PMT-021|none|[PMR-021](PMR-021-proposal-requirement.md)|
|PMR-022|PMF-09|knowledge|PMT-022|none|[PMR-022](PMR-022-proposal-requirement.md)|
|PMR-023|PMF-09|project-manager|PMT-023|none|[PMR-023](PMR-023-proposal-requirement.md)|
|PMR-024|PMF-09|integration|PMT-024|none|[PMR-024](PMR-024-proposal-requirement.md)|
|PMR-025|PMF-09|project-manager|PMT-025|FR-108|[PMR-025](PMR-025-proposal-requirement.md)|
|PMR-026|PMF-09|identity|PMT-026|none|[PMR-026](PMR-026-proposal-requirement.md)|
|PMR-027|PMF-08|project-manager|PMT-027|FR-124|[PMR-027](PMR-027-proposal-requirement.md)|
|PMR-028|PMF-10|project-manager|PMT-028|none|[PMR-028](PMR-028-proposal-requirement.md)|
|PMR-029|PMF-10|integration|PMT-029|none|[PMR-029](PMR-029-proposal-requirement.md)|
|PMR-030|PMF-06|integration|PMT-030|none|[PMR-030](PMR-030-proposal-requirement.md)|
|PMR-031|PMF-10|integration|PMT-031|none|[PMR-031](PMR-031-proposal-requirement.md)|
|PMR-032|PMF-02|project-manager|PMT-032|none|[PMR-032](PMR-032-proposal-requirement.md)|
|PMR-033|PMF-11|project-manager; people, Identity/CRM ports|PMT-033|FR-036, FR-064, FR-089, FR-193|[PMR-033](PMR-033-proposal-requirement.md)|

## Precedence

1. Canonical FR notes in [FR-INDEX.md](../FR-INDEX.md) and the global PRD/FEAT registries remain authoritative for registered behavior.
2. These PMR files are the source for the proposal behavior catalog.
3. Architecture, API, ERD and blueprint documents explain design consequences and link back here.
4. The hosted design Site is a generated review export. It is not a second editable source.
