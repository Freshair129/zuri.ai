---
version: "0.2.0b"
created_at: "2026-08-23T16:42:00+07:00,ATHER"
last_update: "2026-08-23T17:02:00+07:00,ATHER"
status: "beta"
attributes:
  domain: "runtime-database"
  doc_type: "root-cause-analysis"
  scope: "Preview Supabase transaction pooler"
---

# RCA — Supabase transaction-pooler URL normalization gap

## Symptom

The Preview login route returned `AUTH_UNAVAILABLE` when a non-empty username and
password reached the database lookup. Empty credentials still returned the expected
`INVALID_CREDENTIALS` response. Plugin authorization-code and fake-token revoke
probes continued to reach the database path.

## Evidence

- The same login probe returned `AUTH_UNAVAILABLE` on the Preview deployments before
  and after rotating `ZURI_SESSION_SECRET`; the secret rotation was therefore not the
  cause of this symptom.
- Staging read-only checks showed that `Person`, `PersonCredential`,
  `PluginInstallation`, `PluginAuthorizationCode`, and `PluginSession` exist.
- Staging showed the expected `PersonCredential` columns and a canary Person with
  `credential_present = true`.
- The staging `postgres` role had schema usage and the required table privileges.
  No `zuri_web_login` or `zuri_app_runtime` role exists in this staging project.
- Before the fix, `normalizeSupabaseUrl()` only normalized URLs containing
  `.pooler.supabase.com:5432`; an already transaction-pooler URL on port `6543`
  bypassed the `pgbouncer=true` safeguard.
- A RED regression test reproduced the gap: a valid `:6543` Supabase pooler URL
  resolved with no `pgbouncer` parameter.

## Root Cause

The confirmed code defect was an incomplete Supabase transaction-pooler URL
normalization path. The runtime normalized a session-pooler URL when it saw port
`5432`, but returned an already transaction-pooler URL on port `6543` unchanged.
That allowed a deployment-supplied transaction-pooler URL without
`pgbouncer=true` to reach Prisma without the required transaction-pooler setting.

The exact low-level Prisma error is intentionally hidden by the public login route;
the live evidence establishes the configuration gap and rules out the database
object, credential-row, and `postgres` privilege absence as the cause.

## Why the issue escaped detection

The existing unit suite covered provider selection and the `5432` conversion path,
but had no assertion for an input URL that was already on port `6543`. The Preview
smoke probes also exercised plugin tables and invalid input, not a successful
credential lookup through the browser session path.

## Proposed prevention

1. Normalize both Supabase pooler ports and set `pgbouncer=true` idempotently.
2. Keep regression tests for existing `:6543` URLs, existing query parameters, and
   non-Supabase URLs.
3. Treat successful Preview login as a separate live acceptance gate; do not claim
   Production readiness from unit tests or fake-token probes.

## Acceptance and exit gates

- The focused database-runtime test passes with the new `:6543` coverage.
- Authentication and Plugin Auth regression tests pass.
- Production build passes.
- A new Preview deployment is `Ready` and the login/token/revoke smoke probes are
  rerun without changing Production or the staging schema.

## Implementation result

Approved on 2026-08-23. `src/lib/db.js` now normalizes both Supabase pooler ports
and sets `pgbouncer=true` idempotently while preserving existing query parameters.
The focused and serial auth/plugin regression suite passed 22/22 tests, the
production build passed, and Preview deployment
`zuri-6g7d6ct9j-pornpons-projects.vercel.app` is `Ready`. Invalid credential probes
for both an unknown user and the staging canary now return `INVALID_CREDENTIALS`
instead of `AUTH_UNAVAILABLE`; Plugin Auth token and revoke probes remain green.
No Production environment, deployment, database schema, or IAM worktree was
modified. A successful login with the real canary password remains a separate
manual evidence gate because the password was not exposed or recovered.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-23 | beta | Evidence-backed transaction-pooler normalization RCA and approved fix in progress | working-tree | ATHER |
| 0.2.0b | 2026-08-23 | beta | Idempotent pooler normalization implemented and Preview smoke verified | working-tree | ATHER |
