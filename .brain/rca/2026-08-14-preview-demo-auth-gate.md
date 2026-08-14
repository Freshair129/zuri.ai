---
version: "0.1.0"
created_at: "2026-08-14T09:40:57+07:00,ATHER,f16904c"
last_update: "2026-08-14T09:40:57+07:00,ATHER"
status: "active"
superseded_by: null
attributes:
  domain: "entry-preview"
  scope: "Zuri V2 local preview"
---

# RCA — Local preview stopped at demo Login

**Date:** 2026-08-14
**Scope:** Landing → Login → Business Routing → BusinessShell preview flow

## Symptom

The Landing CTA reached `/login`, but `Continue with demo login` stayed on Login
instead of redirecting to `/businesses`.

## Evidence

- Browser verification reached `/login` and rendered the enabled demo button.
- The preview server log recorded `POST /api/session/demo 404` twice.
- `src/app/api/session/demo/route.js` returns 404 unless the non-production
  `ZURI_LOCAL_DEMO_AUTH=1` gate is enabled.
- Both `run.bat` and `playwright.config.js` explicitly enable that variable, while
  the ad-hoc preview command used to open the new Landing did not.
- The accepted E2E flow had already passed when launched through the governed
  Playwright configuration.

## Root Cause

The temporary preview server was started without the required local-demo environment
gate. Routing and Login code were connected correctly; the ad-hoc launch command did
not match the repository's governed local-preview contract.

## Why the issue escaped detection

The first preview check focused on Landing visuals and did not submit the Login form.
The server was launched directly instead of through the environment setup already
encoded in `run.bat` and Playwright.

## Proposed prevention

1. Start interactive local entry previews with `ZURI_LOCAL_DEMO_AUTH=1` or `run.bat`.
2. Verify the complete entry flow, not only the first viewport, before handing off
   an interactive preview.
3. Keep production fail-closed behavior unchanged; never enable the demo gate in
   production.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---------|------|--------|---------|-------------|-------|
| 0.1.0 | 2026-08-14 | active | Recorded preview launch mismatch and bounded prevention | f16904c | ATHER |
