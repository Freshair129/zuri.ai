---
version: "0.1.0b"
created_at: "2026-09-02T10:30:00+07:00,RWANG"
last_update: "2026-09-02T10:30:00+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "phase-evidence"
  scope: "ZV2-CR-010 Phase 2"
---

# ZV2-CR-010 — W2 Asset Evidence Impact Report

## Outcome

Phase 2 fixed the smallest safe execution slice and the owner approved the proposed
document/architecture shape with `approve` on 2026-09-02.

## Evidence-backed findings

| Area | Current state | Approved impact |
|---|---|---|
| Asset foundation | strict preview envelope; no persistence/provider calls | add one application writer and readiness state only |
| File management | MANAGED_BLOB metadata but no content port/hash input | extend owner service; Asset references it |
| RBAC | generic RoleBinding registry with two current roles | add receiver/reviewer role keys only |
| Storage | no production object adapter in this path | add provider-neutral port + Supabase adapter |
| AI | no SDK; existing native fetch patterns | native Responses API adapter behind extractor port |
| Excel | ExcelJS installed and tested | Asset-specific workbook/converter reusing style |
| Google Sheets | no native connector/auth | bounded one-way row snapshot; `.xlsx` export |
| LINE | zuri-cli owns signing/binary; zuri-ai binding resolves scope | opaque FileAsset handoff only |
| Procurement/Finance | no runtime authority | refs/candidates only; no mutation/posting |
| UI | `/assets` explicitly shows adapters unavailable | enable receiving slice; keep registration/posting unavailable |

Official provider confirmation at survey time:

- Supabase documents uploads to an existing bucket, new-object INSERT permission,
  server-side service keys that bypass Storage RLS, and warns never to expose the key.
- OpenAI documents Responses image/file input and strict structured output. Data-control
  guidance supports `store: false`; provider submission remains explicit and auditable.

## Single-writer matrix

| Record/decision | Writer |
|---|---|
| File bytes/hash/blob reference | file management through object port |
| Evidence role/extraction/review | Asset Management |
| Intake envelope/validation/readiness | Asset Management |
| RoleBinding membership | Identity |
| LINE signature/byte retrieval | zuri-cli transport |
| PR/PO/GRN truth | future Procurement |
| capitalization/journal/depreciation book | future Finance |

## Authorization and threat controls

| Threat | Control |
|---|---|
| cross-Business ID probing | authorize selected Business first; target misses remain non-enumerating |
| MIME/extension spoof | magic-byte and declared MIME comparison before storage |
| oversized/zip-bomb input | fixed byte cap; no archive type accepted |
| public evidence leak | private bucket, server credential, opaque ref, no public/signed URL response |
| provider data retention | explicit provider action, `store: false`, no raw-byte logs |
| OCR hallucination | strict local schema + candidate status + human review |
| replay overwrite | content-addressed no-upsert object + source payload hash |
| Sheet as hidden writer | snapshot hash + preview only + canonical writer |
| LINE scope/secret injection | server binding, forbidden authority/token/url body keys |

## Exact approved documentation topology

| Action | Path / class | Reason |
|---|---|---|
| ADD | `CR-015-ASSET-EVIDENCE-INTAKE-EXECUTION.md` | product execution request |
| ADD | `ADR-056-ASSET-EVIDENCE-CLOUD-AND-EXTRACTION-BOUNDARY.md` | architecture/security/provider decision |
| ADD | `ZV2-CR-010-ASSET-EVIDENCE-INTAKE-EXECUTION.md` | implementation/migration envelope |
| ADD | `PLAN-ASSET-EVIDENCE-INTAKE-4-PHASES.md` | ordered evidence gates |
| ADD | `FR-137-asset-evidence-intake-execution.md` | FR-137..140 behavior, stories and UX |
| ADD | W1..W4 artifacts | phase evidence |
| UPDATE | global PRD/FEATURES/ROADMAP/API/trace/interface authorities | register requirements and surfaces |
| UPDATE | Asset charter/context/foundation PRD | connect the next slice without changing ownership |
| GENERATE | graph/domain-state/ID ledger/Postgres projection | machine outputs only |
| NO CHANGE | Product positioning and Project Inventory contract | no product/domain ownership change |

## Expected implementation classes

- additive Prisma migration and generated Postgres parity;
- RBAC role/permission constants;
- object-storage port/Supabase adapter and FileAsset managed-blob extension;
- Asset evidence policy, draft/review service, OpenAI extractor, Excel/Sheet adapters;
- nine route methods and one receiving page/component;
- OpenAPI inventory/details and focused unit/integration/E2E proof.

## Exit

Complexity remains C-3 and risk HIGH. Owner approval allows Phase 3 documentation and
RED tests, followed by Phase 4 code only after focused RED is recorded.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-02 | beta | Recorded as-is evidence, writer/threat matrix, exact approved docs and implementation classes | working-tree | RWANG |
