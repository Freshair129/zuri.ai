---
version: "0.1.0b"
created_at: "2026-08-18T13:45:00+07:00,ATHER"
last_update: "2026-08-18T13:45:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "implementation-plan"
  scope: "FR-077 / FEAT-005"
---

# Implementation plan — FR-077 Project Inventory MVP

| Work | Deliverable | Exit |
|---|---|---|
| W0 | FR-077, FEAT-005, ADR-034, SDD-045 and source API/UI contract | registry and docs review |
| W1 | Stable DTO schema, serializer, pagination and pure progress projection | unit contract/serialization tests |
| W2 | Trusted viewer guard and SQLite section composition | relation/isolation integration tests |
| W3 | Additive API route and Project-local Inventory tab/page | build and UI contract checks |
| W4 | Happy, empty, error, partial/truncated and unauthorized E2E coverage | Playwright suite passes without flakiness |
| W5 | Generated graph/preflight reconciliation and final verification | `npm test`, build, govern, E2E, diff check |

No mutation, external API, network sync, new execution mode or Prisma migration
is included in this plan.
