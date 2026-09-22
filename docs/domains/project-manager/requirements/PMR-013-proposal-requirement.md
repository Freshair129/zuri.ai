---
requirement: PMR-013
domain: project-manager
source: gpt-site-spine
source_document: docs/architecture/project-manager-system/01-REQUIREMENTS-AND-UX.md
status: registered
version: "0.1.0b"
created_at: "2026-09-18T20:42:13+07:00,RWANG"
last_update: "2026-09-18T20:42:13+07:00,RWANG"
superseded_by: null
canonical_status: registered_as_fr_272
attributes:
  doc_type: supporting-document
  domain: project-manager
---

# PMR-013 — Proposal requirement

**Version:** 0.1.0b · **Status:** Candidate

> This file remains the single local source for the proposal body. PMR-013 is
> registered as canonical [FR-272](../features/FR-272-approval-gateway-admission.md);
> implementation annotations use FR-272, while PMR-013 remains the acceptance
> trace key.

## Normative behavior

Approval ผูก exact artifact/spec/config hashes, action และ expiry; เปลี่ยน input ต้อง approval ใหม่; reviewer conflict ถูกปฏิเสธ

## Capability and ownership

- Capability: PMF-06
- Primary owner: project-manager
- Acceptance family: [PMT-013](../../../architecture/project-manager-system/07-DELIVERY-AND-VERIFICATION.md#5-acceptance-scenarios)

## Existing repository references

- Gate; FR-196
- Canonical registration: FR-272. FR-196 remains context for the existing
  Identity segregation-of-duties rule and is not repurposed.

## Traceability

- Site spine source: [../../../architecture/project-manager-system/01-REQUIREMENTS-AND-UX.md](../../../architecture/project-manager-system/01-REQUIREMENTS-AND-UX.md)
- Consolidated SRS: [17-SRS.md](../../../architecture/project-manager-system/17-SRS.md#functional-requirement-catalog)
- Machine index: [pm-requirement-index.json](../../../architecture/project-manager-system/contracts/pm-requirement-index.json)
- Canonical promotion: registered as FR-272 before implementation.
