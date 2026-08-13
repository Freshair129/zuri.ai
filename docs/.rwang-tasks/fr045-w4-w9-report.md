# FR-045 W4-W9 Final Report

**Date:** 2026-08-14
**Status:** PASS
**Risk:** HIGH
**Scope:** ADR-016, FR-045, SDD-023, BR-010, SEC-007, ZV2-CR-001

## Delivered

| Work package | Result |
|---|---|
| W4 | FileAsset/FileLink application service, staged local ingest, content, relink, metadata deletion, lossless ProjectFile dry-run/confirm migration and legacy adapter |
| W5 | Business and Project File Manager routes/UI, Development > Files navigation and viewer-scoped API boundary |
| W6 | Explicit reconcile, MISSING/restore states, operator-confirmed relink and revisioned disposable cache equal to the direct read model |
| W7 | Reveal denied by default; requires enabled local bridge, loopback same-origin request, explicit intent, viewer authorization and contained final path |
| W8 | Snapshot includes FileAsset/FileLink and content manifest, excludes mounts, supports explicit content inclusion, remount preview and confirmed restore |
| W9 | `RETAIN_REFERENCE`: 39 files / 15,077 bytes remain unchanged outside the repo; no archive/delete/move/rename |

## Acceptance evidence

- Vitest: **71 files / 375 tests passed**.
- Playwright: **33 passed / 4 intentionally skipped**, including FR-045 Business Files and cross-Business denial.
- Production build: PASS; all managed file routes and `/files` compiled.
- Prisma: SQLite and Postgres schemas validate; additive migration retained; ProjectFile remains present.
- Documentation: graph **633 nodes / 980 edges / 0 dangling**; preflight **0 critical / 0 warning**; docs check up to date.
- Security regression: W2 post-mkdir reparse escape and cross-volume checks re-reviewed ALL PASS.

## Compatibility and rollback

The legacy `/api/projects/{id}/files` route and `ProjectFile` model remain. Migration
reports accepted/conflict/skipped rows before commit. Snapshot import requires preview
and explicit confirmation; local absolute roots are supplied as remount input and are
never portable identity. Physical content is never silently deleted by metadata
deletion or rollback.

## Open limitations

None inside the approved FR-045 scope. Cloud sync, Loading Dock ingestion, automatic
hash-candidate matching, native desktop packaging and legacy model removal remain
separate future changes and are not implied by this closure.
