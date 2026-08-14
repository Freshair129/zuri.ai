---
version: "0.4.0b"
created_at: "2026-08-14T03:52:31+07:00,ATHER"
last_update: "2026-08-14T07:35:29+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "data-security"
  doc_type: "change-request"
  scope: "production tenant bootstrap and approved knowledge import"
---

# ZV2-CR-004 — Supabase production tenant bootstrap

## Delivery status

Owner-approved on 2026-08-14. Both migrations are recorded remotely. The approved 74-row
price-disabled artifact has exact Tenant/Business/batch and SHA-256 audit evidence. Static remote
RLS/policy/grant/role inventory and warning/error-level advisors pass. The retained scoped logical
backup was captured post-apply and has a SHA-256 manifest; it is not pre-mutation evidence and
physical backup/PITR is not enabled. The production
binding remains credential-free and `PENDING`; live runtime-login isolation and LINE are not enabled.

## Goal

Bootstrap SmartGift in Supabase project `qcnmhyglarzcpudjorzc` with database-enforced Tenant and
Business isolation before importing the approved 74-row knowledge dataset or enabling LINE traffic.

## Risk and complexity

- Complexity: `C-3` — architecture, schema, authorization, channel identity, migration and rollback.
- Risk: `HIGH` — a defect can disclose data across tenants or put production credentials in an
  over-privileged runtime.

## Impact classification

| Target | Classification | Required change/proof after approval |
|---|---|---|
| `docs/PRODUCT-V2.md` | REVIEW | Existing hierarchy remains authoritative; no label/key reinterpretation |
| `docs/PRD-SDD-v1.0.md` | MUST UPDATE AFTER APPROVAL | Register the next canonical FR/NFR/BR/SDD/SEC IDs together with real code/test anchors |
| `prisma/schema.postgres.prisma` and generator | MUST UPDATE | Production schema/search path plus tenant ancestry constraints; preserve SQLite compatibility |
| `prisma/postgres/0001_init.sql` | REVIEW | Never deploy unhardened core tables into exposed `public`; applied history determines correction path |
| `supabase/migrations/*business_knowledge*` | MUST UPDATE | Add `tenant_id`, internal Business FK, private schema, RLS, grants and indexes |
| New tenant/bootstrap migration | MUST ADD | Idempotent reserved Portfolio/Tenant/Business/binding metadata and audit batch |
| `scripts/export_smartgift_business_knowledge.py` | MUST UPDATE | Map source code `smartgift` to reserved internal UUIDs without changing source provenance |
| `scripts/build_business_knowledge_import.py` | MUST UPDATE | Require tenant UUID, composite keys, batch ID and rollback/reconciliation contract |
| `src/modules/knowledge/supabase-business-knowledge.js` | MUST REPLACE/ISOLATE | Secret-key REST access bypasses RLS; production uses least-privilege scope-bound access |
| `src/modules/agent/phase1-runtime.js` | MUST UPDATE | Refuse secret/service-key runtime configuration and bind one deployment to one DB role |
| `src/app/api/agent/line-webhook/route.js` | MUST UPDATE | Reject client-selected scope; resolve from active binding before turn |
| `D:\workspace\zuri-cli` transport | MUST UPDATE | Send binding identity/destination, not authoritative tenant/business IDs |
| Supabase Auth/Membership | REVIEW, FOLLOW-UP | Human login policy is separate from machine LINE role; Membership stays authority |
| MSP/GKS/GenesisBlockDB | NO OWNERSHIP CHANGE | Separate databases/contracts; no direct Supabase base-table access |
| SmartGift DuckDB | READ ONLY | Source/provenance remains unchanged |

## Implementation sequence after approval

1. RED: add schema/policy tests that expose missing tenant and cross-tenant access.
2. Read-only remote inventory and backup/advisor gate.
3. Generate migration through Supabase CLI; do not invent or rewrite applied migration history.
4. Implement schemas, roles, ancestry FKs, RLS, indexes and reserved identity seed.
5. Replace LINE/body-selected scope and RLS-bypassing knowledge runtime.
6. Regenerate the approved export with internal UUID mapping and reconcile 74 rows.
7. Apply to remote using an environment-held migration connection; never print the URL/key.
8. Run positive/negative isolation probes, advisors, migration list, build and full tests.
9. Keep production LINE kill switch disabled pending provider credentials and one canary.

## Merge definition of done

- ADR-018 merge gates pass with remote evidence;
- no unresolved cross-tenant table/path exists in the Phase 1 slice;
- no Supabase secret/service key is used by the LINE runtime;
- docs graph/preflight, tests and build pass.

Merging does not activate LINE. The binding must remain `PENDING`, hashes absent and the production
kill switch off.

## Production activation definition of done

- the runtime login secret is provisioned and live positive/cross-Tenant/mutation-denial probes pass;
- an approved physical backup/PITR policy is active;
- rollback is rehearsed without deleting source or unrelated database data;
- provider credential and approved golden questions pass; and
- destination/credential hashes plus the signed LINE canary are accepted before traffic is enabled.

## Out of scope

- enabling production LINE traffic;
- importing customer/CRM/PII, prices, cost, margin or invoices;
- moving MSP/GKS/GenesisBlockDB into the Zuri database;
- placing staging/test tenants in the production project; and
- converting every Prisma text UUID to native Postgres `uuid` in the same change.

Canonical requirements FR-051/052, NFR-011, BR-012, SDD-026 and SEC-010 are now registered with
real implementation/test anchors and an explicit remote-gate status.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Proposed production isolation bootstrap and implementation gate | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | beta | Local implementation complete for schema, role/binding boundary and import builder; remote evidence/apply remains gated | working-tree | ATHER |
| 0.3.0b | 2026-08-14 | beta | Production migrations and verified 74-row import complete; LINE activation remains out of scope | working-tree | ATHER |
| 0.4.0b | 2026-08-14 | beta | Approved production-disabled merge boundary; activation retains runtime, backup, rollback, provider and canary gates | working-tree | ATHER |
