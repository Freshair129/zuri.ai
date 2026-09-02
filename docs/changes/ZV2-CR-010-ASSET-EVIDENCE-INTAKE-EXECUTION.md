---
version: "0.2.0b"
created_at: "2026-09-02T10:30:00+07:00,RWANG"
last_update: "2026-09-02T11:05:00+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "change-envelope"
  scope: "Implementation envelope for CR-015 and ADR-056"
---

# ZV2-CR-010 — Asset Evidence Intake Execution

## Intent

Implement CR-015 through ADR-056 without widening the Asset lifecycle beyond
`READY_FOR_REGISTRATION`.

## Impacted domains and ownership

| Domain / area | Impact | Writer remains |
|---|---|---|
| Asset Management | draft, evidence meaning, extraction/review and status | Asset Management |
| File management | managed-blob metadata and content resolution port | File management |
| Identity | two Business-scoped RoleBinding keys/permissions | Identity |
| Integration platform | trusted LINE handoff and provider ports | existing transport/platform owners |
| Project Manager | no inventory mutation | no change |
| Procurement | typed PR/PO references only | future Procurement authority |
| Finance | payment evidence and depreciation candidate only | future Finance authority |

## Additive data change

`AssetIntake` adds:

- `payloadSha256 String?`
- `normalizedEnvelopeJson String @default("{}")`
- `validationJson String @default("{}")`
- `validatedAt DateTime?`

No existing column changes meaning and no row is backfilled with invented business
data. Existing rows retain `{}` snapshots and a null hash/time.

## Public application surfaces

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/assets/evidence` | authorize, validate and upload one private evidence file |
| POST | `/api/assets/evidence/{id}/extract` | create one provider candidate |
| POST | `/api/assets/evidence/{id}/review` | persist explicit human corrections/decision |
| POST | `/api/assets/intakes` | idempotently persist and validate one canonical draft |
| GET | `/api/assets/import/template` | download canonical Asset workbook |
| POST | `/api/assets/import/xlsx` | convert workbook and return row-aware preview |
| POST | `/api/assets/import/sheets` | convert/hash one bounded Sheet snapshot |
| GET | `/api/assets/intakes/export` | export selected Business draft/validated intakes to `.xlsx` |
| POST | `/api/agent/line-asset-handoff` | accept trusted opaque FileAsset references from zuri-cli |

## Source impact

Expected code is limited to:

- Asset application/import/infrastructure modules;
- one generic private-object port and one Supabase adapter;
- a managed-blob creation/content-resolution extension inside file management;
- Identity role registry additions;
- the route handlers above and `/assets/receiving` UI;
- additive Prisma migration/Postgres projection;
- OpenAPI route inventory/details and focused tests.

## Migration and rollback

The migration is additive and SQLite-safe. Rollback of runtime code leaves the four
new columns unused but preserves evidence/intake records. Cloud objects are not bulk
deleted during rollback; each remains addressed by its `FileAsset` metadata for later
reconciliation. Destructive schema rollback is not part of this change.

## Risks

**Classification: HIGH.** The slice processes payment evidence and combines schema,
storage credentials, AI provider calls, RoleBindings and multiple transports.

Controls are fail-closed scope checks before bytes, bounded content/payload sizes,
magic-byte verification, no public URLs, no provider secret in output, human review,
idempotency hashes, audit evidence and full regression verification.

## Exit criteria

- all Phase 3 RED contracts are green;
- migration parity and backup behavior remain valid;
- `npm run verify` passes with no new skips/flakes;
- git diff is limited to this envelope;
- W4 records test counts, known unavailable adapters and exact commit.

## Exit result

The local implementation satisfies the exit criteria. W4 records the command evidence;
the delivery commit is recorded by git history after this document is staged.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-02 | beta | Froze the additive schema, routes, ownership, risk and rollback envelope | working-tree | RWANG |
| 0.2.0b | 2026-09-02 | beta | Closed the local implementation and verification envelope; provider/deployment gates remain open | working-tree | RWANG |
