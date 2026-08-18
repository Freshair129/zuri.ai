---
domain: crm
feature: FR-078
module: crm
source: v2-native
version: "0.4.0"
created_at: "2026-08-18T06:35:00+07:00,ATHER"
last_update: "2026-08-18T09:25:08+07:00,ATHER"
status: "beta"
---

# FR-078 — Customer data backfill contract

## Intent

กำหนด contract สำหรับนำเข้าประวัติ Customer Profile จาก SmartGift DuckDB เข้า
CRM ของ Zuri อย่างมีขอบเขตและตรวจสอบย้อนกลับได้ โดยรอบแรกครอบคลุมเฉพาะ
Customer Profile ของ `BUS-SMARTGIFT` เท่านั้น

เอกสารนี้บันทึก contract ที่ได้รับอนุมัติและ batch แรกที่ migrate สำเร็จแล้ว โดย
แยก historical backfill ออกจาก production LINE/event path อย่างชัดเจน การอนุมัติ
ของ contract นี้เป็นคนละ gate กับ mission ที่ migrate product knowledge 74 แถว
เสร็จแล้ว

Machine-readable contracts:

- [Contract manifest](../../../../contracts/migrations/smartgift-customer-data-contract.json)
- [Contract schema](../../../../contracts/migrations/smartgift-customer-data-contract.schema.json)
- [Staging record schema](../../../../contracts/migrations/smartgift-customer-record.schema.json)
- [Target schema migration](../../../../supabase/migrations/20260818070000_customer_profile_backfill_schema.sql)
- [Platform approver profile migration](../../../../supabase/migrations/20260818071000_platform_approver_profile.sql)
- [Current contract receipt migration](../../../../supabase/migrations/20260818072000_customer_profile_contract_receipt.sql)
- [Target verification script](../../../../scripts/verify-smartgift-customer-profile-target.mjs)
- [Redacted target verification](../../../../artifacts/migrations/MIS-SG-CUSTOMER-DATA-BACKFILL-001/customer-profile-target-verification.json)
- [Redacted post-apply verification](../../../../artifacts/migrations/MIS-SG-CUSTOMER-DATA-BACKFILL-001/customer-profile-target-post-apply-verification.json)
- [Redacted dry-run receipt](../../../../artifacts/migrations/MIS-SG-CUSTOMER-DATA-BACKFILL-001/customer-backfill-dry-run.json)
- [Verified target backup](../../../../artifacts/migrations/MIS-SG-CUSTOMER-DATA-BACKFILL-001/customer-backfill-target-backup-before-apply.json)
- [Applied-batch rollback rehearsal](../../../../artifacts/migrations/MIS-SG-CUSTOMER-DATA-BACKFILL-001/customer-backfill-rollback-applied-batch-rehearsal.json)
- [Platform-owner approval](../../../../contracts/approvals/smartgift-customer-data-platform-owner-20260818.json)
- [Customer-data owner and security approval](../../../../contracts/approvals/smartgift-customer-data-owner-security-20260818.json)

## Identity and approval

| Identity | Value |
|---|---|
| `customerDataContractId` | `CDC-SG-CUSTOMER-DATA-001` |
| `versionId` | `VER-SG-CUSTOMER-DATA-CONTRACT-0.2.0B` |
| `missionId` | `MIS-SG-CUSTOMER-DATA-BACKFILL-001` |
| Requested by / Platform approver | Boss (`PER-BOSS`, `c82690eb-84e8-48a8-8a28-fe3d839c2276`) |
| Contract status | `APPROVED` — all required approvals and gates complete; batch apply reconciled |
| Customer Data Owner | Boss (`PER-BOSS`, `c82690eb-84e8-48a8-8a28-fe3d839c2276`) — scoped to this mission |
| Security/PDPA approver | Boss (`PER-BOSS`, `c82690eb-84e8-48a8-8a28-fe3d839c2276`) — scoped to this mission |
| Privacy basis | `OWNER_ATTESTATION`; approval evidence is the owner/security record, not an Organization Owner membership |
| Retention | `retentionUntil: null`; retain only while necessary, review at least annually, then delete/anonymize when no longer necessary or after a validated erasure request |
| Historical window | `2020-07-17` through `2026-06-22`, approved against snapshot as-of `2026-08-12T12:13:43+07:00` |

`customerDataContractId` เป็น identity ของ data contract ไม่ใช่
Project Manager `contract_id` ซึ่งหมายถึง CRM Contact ตาม FR-070/FR-071

## Scope

```text
Wannapa Workspace / PF-WANNAPA-WORKSPACE
  └── TNT-EtohGroup / 77cdbe70-3111-4a04-922a-8059be99a8b0
        └── SmartGift / BUS-SMARTGIFT
             834fa869-62f3-431c-a287-e9a95e91175b
```

Rules for this contract:

- Target is one Tenant and one Business: SmartGift.
- No automatic merge or sharing across Etoh-Muku, Mujeen or EMC.
- A customer appearing to belong to more than one Business goes to review;
  the importer must not infer cross-Business ownership.
- Historical date range is approved as `2020-07-17` through `2026-06-22`, based
  on the full observed SmartGift source window in the read-only snapshot.
- Customer Profile is the only initial publishable record type.

## Source inventory

The source was inspected read-only. Counts below are inventory evidence, not
approval that all rows are valid or ready to publish.

| DuckDB table | Role | Rows | Key | Initial disposition |
|---|---|---:|---|---|
| `customer` | Canonical profile candidate | 3,569 | `customer_key` | Profile source |
| `stg_contact` | Contact/identity evidence | 4,679 | `contact_code` | Resolution only |
| `stg_doc` | Transaction/document evidence | 8,285 | `doc_no` | Excluded from initial publish |
| `interaction` | Interaction evidence | 0 | `interaction_id` | Excluded from initial publish |

Snapshot evidence:

- Source alias: `SMARTGIFT_DUCKDB_PATH`
- DuckDB snapshot SHA-256:
  `a8da233228cb80a088f11ff98fdef5773d0890bc158bcc40752c6d7a5e4bd5d7`
- Snapshot last-write observation: `2026-08-12T12:13:43+07:00`
- Access mode: `READ_ONLY`
- `customer` contains 65 duplicate `normalized_name` groups; name alone is
  therefore not a safe merge key.
- `customer` has 2,540 rows without a tax ID and `stg_contact` has 3,387 rows
  without a tax ID; fallback identity must remain reviewable.

The source database is analytical evidence. It is not allowed to become the
runtime CRM database or to be written to by the importer.

## Record contract

The staged record is `CUSTOMER_PROFILE` and must validate against the staging
record schema. A record carries:

```json
{
  "schemaVersion": "1.0.0",
  "recordType": "CUSTOMER_PROFILE",
  "scope": {
    "tenantId": "server-resolved",
    "businessId": "server-resolved"
  },
  "source": {
    "sourceSystem": "SMARTGIFT_DUCKDB",
    "sourceTable": "customer",
    "sourceRecordKey": "source-key",
    "sourceRow": 1,
    "sourceSha256": "sha256",
    "snapshotSha256": "sha256"
  },
  "identity": {
    "taxId": null,
    "normalizedName": null,
    "email": null,
    "phoneE164": null
  },
  "profile": {
    "displayName": "redacted-example",
    "postcode": null,
    "contactType": null
  },
  "resolution": {
    "status": "NEW_CANDIDATE",
    "matchMethod": "NONE",
    "matchedPersonId": null,
    "matchedCustomerId": null,
    "reasonCode": "NEW_SOURCE_PROFILE"
  },
  "privacy": {
    "basis": "OWNER_ATTESTATION",
    "evidenceRef": "contracts/approvals/smartgift-customer-data-owner-security-20260818.json#privacy",
    "approvedByPersonId": "c82690eb-84e8-48a8-8a28-fe3d839c2276",
    "retentionUntil": null
  },
  "disposition": {
    "action": "PUBLISH",
    "reasonCode": "APPROVED_NEW_CANDIDATE"
  },
  "idempotencyKey": "SMARTGIFT_DUCKDB|customer|source-key|sha256"
}
```

The source key, source row, source hash, artifact reference and logical source
reference are provenance evidence. They are not primary keys and must not be
shown as a customer-facing label.

## Identity resolution

Resolution is server-owned and produces an explicit disposition for every
source candidate:

1. Deduplicate an exact `sourceRecordKey` within the same snapshot. Conflicting
   rows enter the review queue.
2. Match an exact, non-empty `taxId` only when it is one-to-one and corroborated.
   A tax ID shared by conflicting names, Businesses or source entities enters
   the review queue.
3. Allow an exact `normalizedName` match only when one corroborating attribute
   (email, phone or postcode) also agrees and there is exactly one candidate.
4. Name-only candidates are always `REVIEW_REQUIRED`; they never auto-merge.
5. An existing Zuri `Person` or `Customer` may be linked only by an explicit
   internal mapping or an approved owner decision. The importer must not create
   a global Person from a name-only historical row.

Resolution outcomes:

| Outcome | Meaning | Write allowed |
|---|---|---:|
| `AUTO_MATCH` | One-to-one evidence satisfies the rule | Only after all contract gates |
| `NEW_CANDIDATE` | No existing match; candidate may be created | Hold until privacy/owner approval |
| `REVIEW_REQUIRED` | Duplicate, conflict, cross-Business or name-only case | No |
| `UNRESOLVED` | Required identity evidence is unavailable | No |
| `REJECTED` | Malformed or prohibited record | No |

Required reports before any write:

- duplicate source keys;
- duplicate/colliding tax IDs;
- name-only candidates;
- cross-Business candidates;
- unresolved and rejected rows;
- source rows with no provenance; and
- source rows that do not map to the approved SmartGift scope.

## Field and privacy policy

| Field/group | Classification | Staging | Initial publish |
|---|---|---:|---:|
| `sourceRecordKey`, source row/hash | Internal identifier/evidence | yes | no |
| `displayName` | Personal data | yes | yes, with approved basis |
| `normalizedName` | Personal data | yes | no |
| `taxId` | Restricted personal data | yes, exact-match only | no |
| `email`, `phoneE164`, `postcode` | Personal data | yes | no; target schema/PDPA gate required |
| `contactType` | Profile metadata | yes | no until target mapping is approved |
| `orders`, `quotes`, `lifetime_value` | Financial/derived | no for this contract | no |
| `amount`, `vat`, `total`, `credit_days` | Financial | no for this contract | no |
| raw documents, raw paths, LINE identifiers, credentials/secrets | Restricted/secret | no | no |

No raw PII may appear in logs, monitor payloads, browser responses, test
fixtures committed to the repository or error messages. PII-bearing staging
artifacts must be access-controlled, short-lived according to the approved
retention decision and referenced by hash rather than copied into audit text.

## Target mapping

The current Zuri CRM model has `Person` and tenant-scoped `Customer`. A
historical row cannot be written until the target mapping is approved because:

- `Customer` requires a `personId`;
- `Person` is global while `Customer` is tenant-scoped;
- source `customer_key` is external/source identity, not a Zuri primary key;
- the target migration adds a private customer provenance/idempotency table;
- contact phone/tax ID fields do not have an approved target mapping; and
- `Customer.businessId` must remain SmartGift-scoped for this contract.

Target rules once the schema gate is approved:

- server generates internal UUIDs;
- source identity is stored in a private provenance/idempotency mapping;
- existing Person/Customer links are explicit and auditable;
- new Person creation requires an approved privacy basis and owner decision;
- no Membership or Product Owner RoleBinding is created for a customer;
- no LINE `ExternalIdentity` or channel binding is synthesized from historical
  contact data; and
- no cross-Business customer sharing is inferred.

The target schema migration creates the following private `zuri_core` tables and
stores no raw source PII in the provenance boundary:

| Table | Purpose |
|---|---|
| `person` | Global Zuri Person identity; initial publish field is `display_name` only |
| `customer` | Tenant/Business-scoped Customer projection linked to `person` |
| `customer_import_batch` | Batch receipt, approval, counts and rollback boundary |
| `customer_import_provenance` | Source key/hash, resolution/disposition and idempotency ledger |

The target-schema and contract-receipt migrations are schema/receipt-only. The
approved server-owned batch then wrote only `display_name` to the private target.
Pre-apply verification confirmed the Tenant/Business scope, forced RLS, no Data
API grants, one `PER-BOSS` platform profile, and an empty target. Post-apply
verification for batch `3a7a45b1-1785-55dd-af41-d225a4afb45c` confirms 3,439
Customer rows, 3,440 Person rows including the approver profile, one applied
batch and 3,569 provenance rows. The 130 review-required rows remain held with
no Person/Customer target row.

## Write, rollback and channel boundary

The only permitted future ingress is:

```text
DuckDB read-only snapshot
  → validated customer artifact
  → entity-resolution report
  → duplicate/unresolved review
  → named approvals
  → verified backup
  → transaction-local staging
  → server-owned scoped upsert
  → post-apply reconciliation
```

The importer must not use LINE webhook/reply APIs, a public REST endpoint,
browser-side writes, `anon`, `authenticated` or a runtime `service_role` key.
The destination transaction must be idempotent by source-system/table/key/
snapshot hash and must publish no partial batch.

Rollback is batch-scoped and append-audited:

- new Customer rows may be soft-deleted or reversed by the batch rollback;
- updated rows restore the prior version from the verified backup;
- existing shared Person rows are never hard-deleted or re-homed implicitly;
- unrelated Businesses, customer rows and LINE bindings are untouched; and
- a rollback receipt records the affected batch, restored rows and verification.

## Approval gates

| Gate | Status | Exit evidence |
|---|---|---|
| CDC-G1 Source snapshot/inventory | complete | source hash, table counts, read-only evidence |
| CDC-G2 Record/forbidden-field validation | complete | dry-run receipt, allowed-field policy and no-raw-PII evidence |
| CDC-G3 Entity resolution | complete | 3,439 publish candidates, 130 held review rows, no name-only auto-merge |
| CDC-G4 Customer data owner + Security/PDPA | complete | Boss scoped owner/security approval, `OWNER_ATTESTATION`, retention rule |
| CDC-G5 Target schema/scope | complete | target/profile/receipt migrations, pre/post verification, forced RLS and no Data API grants |
| CDC-G6 Dry-run/backup/rollback | complete | dry-run receipt, verified backup, applied-batch rollback rehearsal and post-apply assertions |

No additional batch may write while any gate above is `pending` or `blocked`.
The 130 review-required rows are still `HOLD_NO_WRITE` even though the batch
itself is applied.

## Acceptance criteria

- **AC-078.1** The contract has one immutable `customerDataContractId`,
  `versionId` and a separate customer-backfill `missionId`.
- **AC-078.2** The destination is fixed to the reconciled
  `TNT-EtohGroup`/`BUS-SMARTGIFT` scope; a client cannot select another scope.
- **AC-078.3** Every staged record carries source table/key/row/hash,
  snapshot hash, resolution status, privacy basis, disposition and idempotency
  key.
- **AC-078.4** Name-only, conflicting, duplicate and cross-Business records
  fail closed into review or hold; no implicit merge occurs.
- **AC-078.5** Financial, raw document, LINE and secret fields are excluded from
  this contract and require separate approval if ever needed.
- **AC-078.6** No raw PII is emitted into logs, monitor payloads, browser
  responses, repository fixtures or audit detail.
- **AC-078.7** Target writes require the Person/Customer/provenance schema gate,
  privacy basis, named data owner/security approval, backup and dry-run receipt;
  the first approved batch is evidenced by its post-apply verification.
- **AC-078.8** The future write is server-owned, transactional, idempotent,
  tenant/business-scoped and independently rollbackable.
- **AC-078.9** Historical customer data is not replayed through LINE and does not
  activate a LINE binding.

## Non-goals

- Authorizing future fields, future snapshots, review-row publication or any
  additional business beyond the approved batch and scope.
- Importing invoices, quotations, payments, costs, margin, orders or documents.
- Importing interactions or consent/erasure history without their own contract.
- Creating LINE identities, memberships, Product Owner bindings or marketing
  segments from historical rows.
- Treating DuckDB as the transactional CRM database.

## Related documents

- [FR-023 — CRM Customer/Conversation/Message](../../../PRD-SDD-v1.0.md#fr-023)
- [FR-071 — Supabase data pipeline monitor and replay](../../knowledge/features/FR-071-supabase-data-pipeline-monitor-and-replay.md)
- [ADR-007 — LINE/AI stack sequencing](../../../decisions/ADR-007-LINE-AI-STACK-SEQUENCING.md)
- [ADR-018 — Supabase production tenant isolation](../../../decisions/ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md)
- [SmartGift data backfill roadmap](../../../roadmap/PLAN-SMARTGIFT-DATA-BACKFILL-AND-CUSTOMER-IMPORT.md)

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.4.0 | 2026-08-18 | beta | Record scoped owner/security approval, approved historical window and successful batch apply with post-apply/rollback evidence | pending | ATHER |
| 0.3.1b | 2026-08-18 | candidate | Record Boss Platform Owner approval; Customer Data Owner, Security/PDPA and import gates remain pending | working-tree | ATHER |
| 0.3.0b | 2026-08-18 | candidate | Verify target scope/RLS, create PER-BOSS profile and append current contract receipt; dry-run/import remain gated | working-tree | ATHER |
| 0.2.0b | 2026-08-18 | candidate | Add private Person/Customer/provenance target schema boundary; live apply and customer write remain gated | working-tree | ATHER |
| 0.1.0b | 2026-08-18 | draft | Define scoped Customer Profile contract, resolution rules, PII boundary and approval gates | working-tree | ATHER |
