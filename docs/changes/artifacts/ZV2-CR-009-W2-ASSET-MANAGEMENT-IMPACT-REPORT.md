---
version: "1.0.0"
created_at: "2026-09-01T00:00:00+07:00,Codex"
last_update: "2026-09-01T00:00:00+07:00,Codex"
status: "accepted"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "phase-evidence"
  scope: "Phase 2 ownership, surface, data, security and exact file impact for ZV2-CR-009"
---

# ZV2-CR-009 — Phase 2 Asset Management impact report

## Outcome and owner acceptance

Phase 2 fixes Asset Management as a first-class Business product domain and defines
the smallest safe implementation slice. The owner accepted the proposed document
topology by replying **“ลุย”** after it was presented. Phase 3 may therefore update
the approved sources and write tests first; additions outside this tree require a
new owner decision.

The survey changes one important planning assumption: the expanded user intent
includes multi-surface evidence intake, PR/PO traceability, lots/expiry, temporal
responsibility/location, Project allocation and depreciation preview. These must be
declared now, but the first code slice must not pretend that absent Procurement,
Finance or LINE-binary runtimes already exist.

## As-is findings

| Seam | Evidence-backed state | Consequence |
|---|---|---|
| Product domains | No `asset-management` module, route or charter | Add a peer domain with route key `assets` |
| Procurement | No PR, PO, GRN, Supplier or receiving aggregate in schema/runtime | Store typed, scoped references; do not author Procurement records |
| Finance | No Payment, accounting-book or depreciation runtime authority | Asset can calculate a review candidate; Finance remains the approver/writer |
| Physical inventory | No physical Asset or stock-lot model | Asset owns physical unit truth; do not overload Project Inventory |
| Project Inventory | `PROJECT_INVENTORY` v1.0 read-only DTO | Add only a read projection from Asset-owned allocations in a later compatible DTO version |
| People | `Person` and `Membership` exist; no Department/OrgUnit model | Reference people; store department as a typed external org-unit reference until an authority exists |
| Location | `Branch` exists; no room/site hierarchy | Reference Branch and use Asset-owned location records/history for physical detail |
| Attachments | `FileAsset` + `FileLink` own content identity/storage metadata | Add Asset evidence metadata that references `FileAsset`; never duplicate bytes or repurpose it |
| LINE OA | Signed transport forwards normalized events; zuri-ai skips non-text turns and receives no attachment bytes | Define a staged artifact contract; binary fetch/upload remains a zuri-cli transport dependency |
| Pipeline | Shared definition-neutral run/step/event/record ledger exists | Register a distinct Asset intake definition and reuse the ledger |
| Backup | Explicit `SNAPSHOT_MODELS` allow-list | Add every new Asset table atomically with backup tests |

## Context map and single-writer matrix

| Concept | Writer / authority | Asset Management behavior |
|---|---|---|
| `RegisteredAsset`, physical lifecycle, Asset ID | Asset Management | Own and mutate |
| Evidence role, OCR candidate and human review state | Asset Management | Own metadata; reference `FileAsset` content |
| PR, PO, PO line, GRN and supplier | Future Commerce/Procurement | Preserve typed external references; never mutate |
| Payment record, capitalization, depreciation book and journal | Future Finance/Accounting | Preserve reference and review decision; no journal write |
| Person and Membership | Identity/People | Read reference; never alter employment authority |
| Department/Org Unit | Future People/organization authority | Typed external reference only until a model exists |
| Branch | Existing Business hierarchy | Read reference; never create from an Asset form |
| Detailed physical location | Asset Management | Own versioned location history beneath optional Branch |
| `ProjectAssetRequest` | Project Manager | Future request/intent writer; not created in the first persistence slice |
| `AssetProjectAllocation` | Asset Management | Own allocation interval and exclusivity |
| Project Inventory | Project Manager read model | Consume a read-only Asset projection; no Asset mutation path |
| `FileAsset` bytes/storage identity | Existing file-management authority | Reference by ID and relation; unchanged semantics |
| Pipeline ledger | Integration platform | Reuse ledger with Asset-specific definition IDs |

## Intake surfaces and convergence

Every channel must converge on one strict, versioned `AssetIntakeEnvelope` before it
can affect Asset truth.

```text
Web / REST / Excel-CSV / Google Sheet / Agent-MCP / LINE OA-LIFF
                 │
                 ▼
         immutable FileAsset evidence
                 │
                 ▼
 DPL-ASSET-REGISTER-IMPORT-V1 / EXC-ASSET-REGISTER-IMPORT-V1
 intake → malware/type/size guard → OCR/Vision candidate → normalize
        → scope/reference validation → duplicate/reconciliation preview
        → human confirmation → approval gate → transactional apply
```

The candidate is never authoritative merely because OCR or a vision model produced
it. Original evidence, extractor/model identity, confidence, field-level provenance,
human corrections and approval decision must remain reconstructable.

### Surface rules

| Surface | Accepted input | Boundary |
|---|---|---|
| Web / LIFF | form plus image/PDF/e-receipt/payment slip | direct upload to authorized staged storage |
| REST API | JSON envelope plus previously uploaded `FileAsset` IDs | enterprise authentication and server-derived scope |
| Excel/CSV | versioned workbook rows plus evidence references | preview/dry-run; no hidden apply |
| Google Sheet | same canonical columns through connector/export | Sheet is intake, not source of truth |
| Agent/MCP | structured proposal referencing authorized evidence | model output cannot authorize or approve |
| LINE OA | multi-message draft, image/PDF/e-receipt/slip metadata | zuri-cli must fetch bytes and hand back trusted artifact IDs; no raw LINE token in zuri-ai |

Payment proof is required when a draft is submitted for a procurement-origin asset.
Draft capture may be incomplete so LINE/Web users can add multiple messages/files,
but Submit fails closed without at least one active `PAYMENT_PROOF` evidence item.

## Data proposal

The first schema slice uses explicit temporal records and typed references:

| Aggregate / record | Purpose and key invariants |
|---|---|
| `RegisteredAsset` | Business-scoped stable Asset ID; status; serial policy; acquisition amount/currency; optional Branch/current pointers; never recycle code |
| `AssetIntake` | channel, draft/validation/approval state, scope, submitter, pipeline run and source correlation |
| `AssetEvidence` | evidence role, `FileAsset` reference, hash/extraction/review metadata; payment role required by submit validator |
| `AssetProcurementRef` | typed `PR`/`PR_LINE`/`PO`/`PO_LINE`/`GRN`/`INVOICE` external reference; new procurement assets require both PR and PO before approval |
| `AssetLot` | Business-scoped `lotId`, manufacture/expiry dates; required only for expiry-controlled categories |
| `AssetResponsibility` | effective interval for `ACCOUNTABLE`, `CUSTODIAN`, `USER`; Person plus optional org-unit reference |
| `AssetLocationHistory` | effective interval, optional Branch and physical location code/name |
| `AssetProjectAllocation` | effective project/workstream allocation, quantity/share and exclusive-overlap rule |
| `AssetDepreciationCandidate` | deterministic preview inputs/output and review state; never an accounting journal |

Department and location are not copied onto `Person`. An asset may have one
accountable person, multiple actual users, a primary owning department, an operating
department and a physical location that all change independently. Effective intervals
prevent present-state columns from erasing history.

## Validation and approval rules

1. Server-resolved Tenant/Business scope overrides or rejects client scope.
2. Accepted content types are allow-listed; extension alone is insufficient.
3. Submission requires payment proof for procurement-origin intake.
4. Approval of a procurement-origin intake requires at least one PR and one PO
   reference; line references are recorded where supplied.
5. Expiry-controlled categories require `lotId` and expiry date; ordinary durable
   assets do not receive invented lots.
6. OCR/Vision fields remain candidates until confirmed by a trusted person.
7. Duplicate evidence hash, payment reference, Asset ID and applicable serial
   collisions surface as conflicts; they never silently merge.
8. Every meaningful state change appends audit evidence in the same transaction.
9. A Project allocation never transfers Asset ownership to Project Manager and must
   not overlap an exclusive active allocation.
10. Depreciation output is `PREVIEW`/`REVIEWED` only. Finance acceptance or posting
    requires a later Finance contract.

## Threat and authorization matrix

| Threat / action | Required authority | Fail-closed proof |
|---|---|---|
| Client selects another Business | Trusted viewer plus visible Business | reject before lookup/mutation |
| User uploads executable or spoofed file | Asset intake policy and content inspection | quarantine/reject; no OCR/apply |
| OCR hallucinates price/vendor/PO | Human confirmation and source evidence | candidate cannot approve itself |
| Duplicate payment slip reused | Business-scoped fingerprint/reference reconciliation | conflict with prior intake |
| QR/Asset ID used as credential | Normal viewer authorization | identifier grants no access |
| Person from another tenant assigned | Person/Membership scope resolution | reject assignment |
| Project from another Business allocated | Project scope and Business match | reject allocation |
| LINE event forges attachment URL/scope | trusted transport binding and staged artifact ID | reject client URL/token/scope |
| Finance preview treated as journal | explicit candidate status and no posting adapter | no authoritative accounting write path |
| Soft-deleted evidence/asset read | active filters and version checks | hidden or explicit unavailable result |

## Smallest implementation slice

Phase 4 will implement the foundation that can be proven locally without inventing
external systems:

- domain/navigation slot and guarded `/assets` dashboard;
- canonical intake/evidence/procurement/lot/responsibility/location/project-allocation
  and depreciation-candidate contracts;
- Asset-specific pipeline definition/catalog on the existing ledger;
- additive SQLite/Postgres schema and backup contract;
- application validation for required evidence, PR+PO, expiry lot, temporal overlap,
  scope and depreciation preview;
- a safe intake validation API that returns preview/conflicts and performs no OCR or
  external posting;
- tests proving those contracts and regressions.

Deferred behind explicit adapters/credentials/authorities: actual LINE binary fetch,
cloud object upload, OCR/Vision provider invocation, Google Sheets live sync,
Procurement lookup, Finance posting and full Project Inventory DTO expansion. The
contracts land now so those adapters cannot redefine the data later.

## Exact document topology accepted for Phase 3

| Action | Path | Authority / rationale |
|---|---|---|
| UPDATE | `docs/change-requests/CR-014-ASSET-MANAGEMENT-DOMAIN.md` | Product PRD; incorporate expanded owner intent and phased limits |
| UPDATE | `docs/decisions/ADR-055-ASSET-MANAGEMENT-DOMAIN-AND-PHYSICAL-ASSET-LIFECYCLE-BOUNDARY.md` | Architecture boundary; record intake, Project and Finance ownership |
| UPDATE | `docs/changes/ZV2-CR-009-ASSET-MANAGEMENT-DOMAIN.md` | Cross-cutting scope/file/migration impact |
| UPDATE | `docs/roadmap/PLAN-ASSET-MANAGEMENT-4-PHASES.md` | Evidence plan and frozen Phase 4 slice |
| ADD | `docs/domains/asset-management/CHARTER.md` | Single domain ownership authority |
| ADD | `docs/domains/asset-management/CONTEXT-MAP.md` | Needed because four absent/existing authorities interact with Asset |
| ADD | `docs/domains/asset-management/features/FR-<allocated>-asset-management-foundation.md` | Detailed behavior, user stories, UX/wireframes and acceptance criteria |
| UPDATE | `docs/PRD-SDD-v1.0.md` | Allocate global FR/NFR/BR/SEC/SDD requirements |
| UPDATE | `docs/FEATURES.md` | Register one MVP/foundation FEAT bundle |
| UPDATE | `docs/SITEMAP-DOMAIN-NAV.md` | Official Tier-2/Tier-3 routes and stable domain identity |
| UPDATE | `docs/roadmap/ROADMAP.md` | Delivery row, gates and limitations |
| ADD | `docs/changes/artifacts/ZV2-CR-009-W3-DOCS-AND-RED-TEST-REPORT.md` | RED evidence |
| ADD | `docs/changes/artifacts/ZV2-CR-009-W4-IMPLEMENTATION-REPORT.md` | Delivery/verification evidence |
| GENERATE | `docs/.doc-graph.json`, `docs/.domain-state.json`, ledger and generated views selected by governance | Machine projections only |
| NO CHANGE | `docs/PRODUCT.md` | No product-positioning change; this is a new domain inside the accepted product |
| NO CHANGE | `docs/ARCHITECTURE.md` and architecture views | ADR-055/context map carry the boundary; no monolith/deployment topology change |

## Expected Phase 3/4 runtime and test impact

| Action | Path group | Purpose |
|---|---|---|
| ADD | `src/modules/asset-management/**` | contracts, validators and read-model helpers |
| UPDATE | `src/config/domains.js` | canonical domain and route registration |
| ADD | `src/app/(pm)/assets/page.jsx` | guarded dashboard/intake entry surface |
| ADD | `src/app/api/assets/intakes/validate/route.js` | safe preview-only validation endpoint |
| UPDATE | `src/platform/integrations/core/pipeline-tracking-contract.js` | Asset definition/stage catalog on shared ledger |
| UPDATE | `src/lib/validation/enums.js` | closed Asset vocabularies |
| UPDATE | `prisma/schema.prisma` | additive Asset records and relations |
| GENERATE | `prisma/schema.postgres.prisma`, Prisma clients | provider parity/generated client |
| ADD | `prisma/migrations/<timestamp>_asset_management_foundation/migration.sql` | additive migration |
| UPDATE | `src/modules/project-manager/application/backup-service.js` | snapshot completeness for new models |
| ADD/UPDATE | `tests/unit/**asset**`, `tests/integration/**asset**`, navigation/pipeline/backup tests | RED then GREEN proof |
| UPDATE | `tests/e2e/fr060-business-home.spec.js` | denominator changes from 8 to 9 non-home domains |
| NO CHANGE | `src/app/api/agent/line-webhook/route.js` | no attachment bytes exist at this boundary yet |
| NO CHANGE | `src/modules/project-manager/application/project-inventory-read-model.js` | v1.0 stays stable until allocation persistence and DTO version are shipped together |
| NO CHANGE | `src/modules/project-manager/application/file-asset-service.js` | content authority and semantics remain unchanged |

## Test matrix

| Layer | Required proof |
|---|---|
| Unit | domain/path ownership; envelope strictness; payment/PR+PO/lot gates; OCR candidate not authoritative; temporal overlap; depreciation formulas/rounding; pipeline IDs; FileAsset semantic regression |
| Schema | models, tenant/business fields, intervals, indexes, version/delete fields, SQLite/Postgres parity, additive migration |
| Integration | server-derived scope, validation preview, audit/transaction boundaries when persistence mutations land, backup export/import completeness |
| API | unauthenticated denial, cross-Business refusal, strict input, no apply/OCR side effect from validation route |
| E2E | domain visibility and guarded dashboard; full upload/OCR/LINE flow deferred until a binary/provider adapter exists |

## Blockers and explicit non-claims

- zuri-ai cannot retrieve LINE attachment bytes with the current live webhook
  contract; zuri-cli must expose a trusted artifact handoff first.
- No configured OCR/Vision provider or cloud object-store adapter was found. This
  phase defines contracts and validation, not a false production OCR claim.
- No authoritative PR/PO, Finance or Department service exists. References remain
  unresolved-but-typed until those domains ship contracts.
- Google Sheet is an intake/export convenience, never the asset register authority.

## Exit decision

Phase 2 is complete. The exact document structure has owner acceptance, every
candidate record has one writer, and Phase 3 may allocate IDs, update sources and
write focused RED tests.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-01 | accepted | Fixed ownership, convergence, data, security, document topology, runtime impact and blockers after repository survey | working-tree | Codex |
