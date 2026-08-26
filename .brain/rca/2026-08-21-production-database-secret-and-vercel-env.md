---
version: "0.1.0b"
created_at: "2026-08-21T11:00:00+07:00,ATHER"
last_update: "2026-08-21T11:00:00+07:00,ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "security-and-runtime"
  doc_type: "root-cause-analysis"
  scope: "production database credential handling and Vercel runtime configuration"
---

# RCA — Production database credential embedded in source

## Symptom

The production database runtime can fall back to a Postgres URL declared in
`src/lib/db.js`, while the linked Vercel project reports no configured
Environment Variables. The production pipeline routes are reachable but an
authenticated canary cannot be completed safely.

## Evidence

- `src/lib/db.js` declares `SUPABASE_DEFAULT_POSTGRES_URL` with an embedded
  database credential. The value is intentionally omitted from this document.
- The declaration is present in the committed history, not only in an
  uncommitted working-tree diff.
- `vercel env ls` for `pornpons-projects/zuri-ai` reports no Environment
  Variables.
- Production `/api/pipelines/runs` and
  `/api/platform/integrations/line-registry` return `401 AUTH_REQUIRED`, so
  the server routes and fail-closed boundary are present.
- Production `/api/session/demo` returns `404 NOT_FOUND`, so the local demo
  session cannot be used as a production authentication shortcut.

## Root Cause

The runtime database selector was implemented with a hard-coded production
credential fallback instead of requiring a secret-managed Postgres environment
variable. This couples production availability to source code, creates a
credential-leak risk, and hides the missing Vercel configuration until an
authenticated request reaches a database-backed route.

## Why the issue escaped detection

- Local tests load `.env`, so the missing Vercel environment is not represented
  in the normal local verification path.
- Public pages and unauthenticated API probes do not exercise the authenticated
  database boundary.
- Deployment metadata points to a valid production commit and the deployment is
  `READY`, which does not prove that secret configuration is present or safe.

## Proposed remediation

1. Remove the hard-coded Postgres URL from `src/lib/db.js`.
2. Require a server-only Postgres URL from Vercel Environment Variables in
   production and fail closed with a safe configuration error when absent.
3. Rotate the exposed database credential before any further production use.
4. Add the rotated value through Vercel's encrypted environment configuration;
   never commit it, print it, or paste it into chat.
5. Add a regression test that rejects source-level database credentials and
   verifies the missing-production-config path.
6. Redeploy and run the authenticated `EVIDENCE_ONLY` canary only after the
   configuration and migration gates are satisfied.

## Prevention

- Keep all database credentials in secret-managed runtime configuration only.
- Add a CI secret-pattern scan covering Postgres URLs, Supabase keys and
  provider tokens while allowing redacted documentation examples.
- Make production configuration validation part of deployment readiness, not
  only an application request path.
- Keep the canonical Supabase apply, Product/Customer promotion and replay
  actions behind separate approval gates.

## Risk assessment

**HIGH** — security-sensitive runtime configuration and production database
access.

## Gate

This RCA is a candidate remediation document. No source code, Vercel
Environment Variable, database migration or production data was changed by
this RCA step.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-21 | candidate | Documented embedded production credential and missing Vercel environment gate | working-tree | ATHER |
