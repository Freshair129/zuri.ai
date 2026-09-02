---
version: "0.1.0b"
created_at: "2026-09-02T10:30:00+07:00,RWANG"
last_update: "2026-09-02T10:30:00+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "asset-management"
  doc_type: "phase-evidence"
  scope: "ZV2-CR-010 Phase 1"
---

# ZV2-CR-010 — W1 Repository Structure Report

## Outcome

Phase 1 passed on the merged foundation baseline. No runtime/schema/test source was
changed during the survey.

| Evidence | Value |
|---|---|
| Worktree | `C:\Users\pc\Documents\Codex\2026-09-01\f-crystal-disk-info9-9\zuri-ai-asset-management` |
| Branch | `codex/asset-evidence-intake` tracking `origin/main` |
| Baseline | `2e3ca62cc2ff5a25e6740d00af91983fc645cd45` |
| Foundation PR | GitHub PR #201, merged into `main` |
| Primary checkout | `C:\Users\pc\workspace\zuri-ai`, not used as the write lane |

## Enumerated reusable seams

| Concern | Existing authority / seam |
|---|---|
| Asset contract | `modules/asset-management/domain/asset-intake.js` and preview route |
| Persistence shape | nine Asset models in both Prisma projections; additive foundation migration |
| File identity | `FileAsset`, `FileLink`, file-management application service |
| Viewer/scope | server-resolved viewer, visibility/ownership predicates, per-Business domains |
| Delegated roles | generic Business-scoped `RoleBinding` registry/service |
| Audit | shared append-only `recordAudit` seam |
| Excel | existing ExcelJS template/converter patterns |
| LINE | zuri-cli transport/binding contract and normalized event evidence |
| Provider calls | existing native-fetch Responses API pattern; no OpenAI SDK dependency |
| OpenAPI | live Zod document plus exact route inventory test |
| Documentation | source documents project to generated graph/domain state/trace/API views |

## Baseline verification

| Command | Result |
|---|---|
| `npm test` | PASS — 351 files passed, 4 skipped; 2,919 tests passed, 14 skipped |
| `npm run build` | PASS — 44 static pages; existing Asset preview route built |
| `npm run govern` | PASS — 244 docs, 108 routes, 372 test files; 1,563 graph nodes, 5,422 edges, 0 dangling; 0 critical/warning |

The governance run refreshed `docs/.doc-graph.json` and `docs/.domain-state.json`
because the merged W4 foundation report moved from change state to current state. The
generated files are carried with this change and will be regenerated after Phase 3.

## Risks passed to Phase 2

1. `FileAsset` supports `MANAGED_BLOB` metadata but content resolution currently handles
   only local files.
2. `AssetIntake` has no normalized/validation/idempotency snapshot columns.
3. No native Google OAuth/Sheets runtime exists.
4. zuri-ai does not fetch LINE attachment bytes.
5. No Procurement or Finance runtime authority exists.
6. OCR/payment evidence introduces sensitive-provider and retention risk.

## Exit

Proceed to Phase 2 cross-domain/security/adapter impact analysis.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-02 | beta | Recorded isolated lane, merged baseline, reusable seams, verification and Phase 2 risks | working-tree | RWANG |
