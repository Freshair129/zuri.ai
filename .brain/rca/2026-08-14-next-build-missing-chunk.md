---
version: "0.1.0"
created_at: "2026-08-14T09:12:07+07:00,ATHER,f16904c"
last_update: "2026-08-14T09:12:07+07:00,ATHER"
status: "active"
superseded_by: null
attributes:
  domain: "build-tooling"
  scope: "Zuri V2 local build"
---

# RCA — Next build referenced a missing generated chunk

**Date:** 2026-08-14
**Scope:** `.next` disposable build output after FR-051 browser verification

## Symptom

The final `npm run build` stopped with `ENOENT` while opening
`.next/server/chunks/8948.js`.

## Evidence

- The FR-051 production build completed before browser verification.
- Targeted Playwright verification then started and stopped the Next development
  server on port 3100.
- The following production build reported no JSX, CSS, lint, or type error; it failed
  only while reading the generated chunk path.
- `.next/server/chunks/8948.js` was absent, while multiple generated server route
  bundles still referenced chunk id `8948`.
- The failed build left its own `next build` child alive; that exact process tree was
  verified and stopped before recovery.
- After preserving that cache, the first clean rebuild compiled and type-checked but
  briefly reported that `/api/backup/import` had no module. Both its source and its
  generated route bundle were present immediately after the failure.
- An immediate bounded retry, with no source change and no active development server,
  completed all production build stages and emitted `/api/backup/import` normally.

## Root Cause

The Next 14.2.35 build pipeline on the current Windows/Node 24.16 environment observed
an inconsistent generated-artifact set while transitioning between local development,
e2e, and production build stages. The missing shared chunk and the transient route
lookup both occurred after successful source compilation, and the no-source retry
passed. This is a generated-artifact publication/lookup race in the disposable
`.next` lifecycle, not an FR-051 source compilation failure.

## Why the issue escaped detection

The first production build ran against a coherent output set. The final gate ran
immediately after a Playwright-managed development server, and the workflow did not
isolate or refresh `.next` between those two Next modes.

## Proposed prevention

1. Confirm no Zuri Next server or build process remains active before a final build.
2. When a generated chunk is missing, preserve the exact `.next` directory by moving
   it to a bounded `.next-stale-*` sibling rather than deleting it.
3. Rebuild from an absent `.next` directory and require the clean build to pass.
4. If compilation passes but one generated route lookup races, verify that both the
   source and generated route exist, then allow one bounded no-source retry.
5. Keep source changes out of this recovery; a generated-cache failure is not proof
   of an application defect.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---------|------|--------|---------|-------------|-------|
| 0.1.0 | 2026-08-14 | active | Recorded missing generated chunk RCA and bounded recovery | f16904c | ATHER |
