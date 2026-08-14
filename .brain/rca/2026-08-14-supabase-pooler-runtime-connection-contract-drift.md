---
version: "0.1.1b"
created_at: "2026-08-14T11:30:00+07:00,ATHER"
last_update: "2026-08-14T11:40:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "security"
  doc_type: "root-cause-analysis"
  scope: "FR-052 FR-054 Supabase runtime connection"
---

# RCA — Supabase pooler runtime connection contract drift

## Symptom

The production SmartGift runtime credential existed in Windows Credential Manager and connected
successfully through the Supavisor session pooler, but the Node.js application and live isolation
probe rejected or failed that same credential.

## Evidence

- Credential target `Zuri:Supabase:qcnmhyglarzcpudjorzc:RuntimeUrl` contains a session-pooler URL
  for `zuri_line_smartgift_login.qcnmhyglarzcpudjorzc` on port `5432`.
- `supabase db query` authenticated that credential and reported session/current user
  `zuri_line_smartgift_login`.
- `phase1-runtime.js` and `runtime-isolation-probe.js` accepted only the direct-connection username
  `zuri_line_smartgift_login`, so they rejected the pooler username suffix.
- The direct database endpoint resolves only to IPv6 on this machine. Node.js could not use that
  route, while the IPv4 Supavisor endpoint was reachable.
- Node.js `pg` with certificate verification enabled rejected the pooler chain until the Supabase
  Root 2021 CA was supplied explicitly.
- `run.bat` loaded neither the Credential Manager URL nor the CA certificate, so the local app
  remained on SQLite-only configuration.
- The first live probe exposed one additional runtime-only failure: an extensionless relative ESM
  import passed Vitest transformation but failed direct Node.js execution with `ERR_MODULE_NOT_FOUND`.

## Root Cause

The implementation encoded one direct-connection URL shape as the entire dedicated-role security
contract. It did not model Supabase's documented pooler username form, did not provide the Supabase
CA to Node.js, and did not bridge the existing Windows Credential Manager entry into the child app
process.

## Why the issue escaped detection

Unit tests covered only direct URLs and injected query functions. Local PostgreSQL integration tests
did not exercise Supavisor username routing, Supabase's CA chain or `run.bat` credential loading.
The credential provisioning proof and application startup proof were treated as separate gates.
Vitest also transformed extensionless imports that direct Node.js ESM does not resolve.

## Proposed prevention

1. Accept only the two exact dedicated-login forms: direct role on the exact project host, or the
   same role plus exact project ref on an approved Supavisor session-pooler host.
2. Pin the public Supabase Root 2021 CA and keep `rejectUnauthorized: true`.
3. Load the runtime URL from Windows Credential Manager into the `run.bat` child process only.
4. Add RED/GREEN tests for pooler acceptance, wrong-project rejection, CA loading and launcher
   fail-closed behavior.
5. Run the real isolation probe and require 74 visible rows, zero foreign-scope rows, denied direct
   grants and denied mutation with rollback.
6. Keep `.js` extensions on modules reached by direct Node.js ESM entrypoints.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Confirmed pooler username, CA and Credential Manager startup contract drift. | working-tree | ATHER |
| 0.1.1b | 2026-08-14 | beta | Added direct-Node ESM import evidence found by the live probe. | working-tree | ATHER |
