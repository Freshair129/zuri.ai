---
feature: FR-042
module: people
source: v2-native
---

# FR-042 - HR / People peer domain

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Implemented |
| **Date** | 2026-08-13 |
| **Relates to** | ADR-013, FR-039, BR-001, SEC-003 |

The user-facing `HR / People` domain is a peer of Development. Its MVP surface
is a Business-scoped People Directory backed by existing `Person` and
`Membership` records. It does not duplicate Project Team: Development Team is
project assignment/capacity, while People is the Business workforce directory.

Attendance, leave, payroll, and performance are future HR features and remain
out of scope for this slice.
