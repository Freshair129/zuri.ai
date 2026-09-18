---
requirement: PMR-014
domain: project-manager
source: gpt-site-spine
source_document: docs/architecture/project-manager-system/01-REQUIREMENTS-AND-UX.md
status: candidate
version: "0.1.0b"
created_at: "2026-09-18T20:42:13+07:00,RWANG"
last_update: "2026-09-18T20:42:13+07:00,RWANG"
superseded_by: null
canonical_status: pending_canonical_fr_registration
attributes:
  doc_type: supporting-document
  domain: project-manager
---

# PMR-014 — Proposal requirement

**Version:** 0.1.0b · **Status:** Candidate

> This file is the single local source for the proposal requirement body. PMR-014 is a proposal-local key; it is not a canonical FR and must not be used as an implementation annotation until the requirement is registered.

## Normative behavior

Architecture model เป็น structured specification; unknown types, invalid port pairs, orphan refs และ forbidden cycles fail validation

## Capability and ownership

- Capability: PMF-02
- Primary owner: project-manager
- Acceptance family: [PMT-014](../../../architecture/project-manager-system/07-DELIVERY-AND-VERIFICATION.md#5-acceptance-scenarios)

## Existing repository references

- Governance links
- No canonical FR context was recorded in the Site spine.

## Traceability

- Site spine source: [../../../architecture/project-manager-system/01-REQUIREMENTS-AND-UX.md](../../../architecture/project-manager-system/01-REQUIREMENTS-AND-UX.md)
- Consolidated SRS: [17-SRS.md](../../../architecture/project-manager-system/17-SRS.md#functional-requirement-catalog)
- Machine index: [pm-requirement-index.json](../../../architecture/project-manager-system/contracts/pm-requirement-index.json)
- Canonical promotion gate: reconcile this proposal key against the global FR/FEAT registry before code.
