---
version: "0.1.0b"
created_at: "2026-08-18T16:10:00+07:00,ATHER"
last_update: "2026-08-18T16:10:00+07:00,ATHER"
status: "candidate"
attributes:
  domain: "application-runtime"
  doc_type: "root-cause-analysis"
  scope: "provider-specific Prisma client and Next.js build"
---

# RCA - Provider-specific Prisma client was bundled into the Next build

## Complexity and risk

- **Complexity:** C-2 - build/runtime boundary correction
- **Risk:** MEDIUM - deployment artifact and database-client selection

## Symptom

`npm run build` failed before compilation completed with
`EPERM: operation not permitted, scandir C:\\Users\\freshair\\Application Data`.

## Evidence

- The failure appeared after `src/lib/db.js` began importing the generated
  Postgres Prisma client from `src/generated/prisma-postgres`.
- The generated client contains Prisma's engine/platform discovery runtime,
  while Next already externalizes the standard `@prisma/client` package.
- The failing path is outside the repository and is a protected Windows profile
  directory; no application source intentionally reads it.

## Root Cause

The provider-specific Prisma client was generated under `src/` and imported as a
relative source module. Next therefore treated it as application code and
bundled Prisma's filesystem/platform discovery runtime into webpack. That
runtime performs a glob/discovery scan during the build. The standard package
has an externalization boundary that the custom relative client did not have.

## Why the issue escaped detection

The direct Node runtime smoke and Prisma validation run outside Next's webpack
pipeline. They proved provider selection and database access but did not prove
that the generated client remained an external server dependency in the
production build.

## Proposed prevention

1. Generate the client under the ignored `node_modules/@zuri/prisma-postgres`
   package path and give it a stable package identity after generation.
2. Add that package identity to Next's server-component external package list.
3. Keep the client server-only and rerun the production build after every
   provider-client generation change.

## Acceptance criteria

- `npm run build` completes without scanning outside the repository.
- SQLite test/runtime selection remains unchanged.
- A Postgres URL still selects the generated Postgres client in the direct
  runtime smoke.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-18 | candidate | Captured and bounded the Next/Prisma externalization build failure | working-tree | ATHER |
