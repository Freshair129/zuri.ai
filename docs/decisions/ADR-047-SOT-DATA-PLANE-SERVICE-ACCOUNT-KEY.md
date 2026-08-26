# ADR-047 — SoT data plane: a Tenant-bound service-account key, not an operator grant

**Status:** Approved
**Date:** 2026-08-24
**Decided by:** Claude Fable 5 (design), approved by Boss ("Go ahead", 2026-08-24) — the
discovered prerequisite for the Bussiness-01-SmartGift connector requested in
"เริ่มข้อ connector เลย"
**Relates to:** [ADR-046](ADR-046-SOT-PIPELINE-INTERIM-SERVING-AND-PULLED-DECISIONS.md), [ADR-045](ADR-045-CANONICAL-IDENTITY-AND-ACCESS-MANAGEMENT.md), [ADR-017](ADR-017-PRODUCTION-VIEWER-SESSION-AND-ENTRY-READ-MODEL.md), FR-100, FR-102

## Context

FR-100's two data-plane verbs — `POST /api/platform/sot/decisions` (submit) and
`GET /api/platform/sot/decisions/export` (pull) — were gated by
`isInstallationOperator(viewer)` alone, and every viewer comes from
`resolveRequestViewer`, which is purely browser-session-cookie based
(`session-port.js`). Building the Bussiness-01-SmartGift connector — a
non-interactive Python script — surfaced that there was no way for it to
authenticate at all: no API-key mechanism exists anywhere in zuri-ai, not even
in the FR-019 Enterprise API, which despite being designed for backend
integrations still requires a session cookie.

The easy fix — mint the connector a session token, or hand it credentials that
resolve to `isOperator: true` — was rejected. `isInstallationOperator` is
documented (`viewer-authority.js`) as "may this viewer perform an
installation-wide operation" — the same authority that gates a whole-database
restore. A leaked connector credential with that grant could do far more than
submit price rows for one Tenant; the blast radius would be the entire
installation, for every Business, forever, until someone thought to look.

## Decision

1. **A new credential type, not a new Person.** `SotDataPlaneKey` (FR-102) is
   its own Prisma model: a random high-entropy secret (`sdpk_...`), stored only
   as a SHA-256 lookup hash — never the raw value, never a scrypt-slowed hash
   (the secret is already high-entropy; scrypt is for low-entropy human
   passwords, per `PersonCredential`). It is bound to exactly one `tenantId`
   and carries no relationship to `Person`/`Membership` at all: a service
   account is not a person acting for themselves, and giving it a `Person` row
   would put a machine credential in front of FR-091's CRM inbox, FR-094's
   canonical-IAM audit trail, and every other place this codebase assumes
   "Person" means "someone".
2. **Its own authority predicate.** `isSotDataPlaneFor(viewer, tenantId)` lives
   beside `isInstallationOperator` in `viewer-authority.js`, not as a branch
   inside it. `submitSotDecisions`/`exportSotDecisions` accept either
   `isInstallationOperator(viewer)` (unchanged) or `isSotDataPlaneFor(viewer,
   parsed.tenantId)` — satisfied only when the key's bound Tenant matches the
   request's. A key minted for one Tenant can never submit or pull another's
   decisions, however it is presented.
3. **Bearer header, checked ahead of the session seam, only on these two
   routes.** `resolveSotDataPlaneViewer(request)` reads `Authorization: Bearer
   sdpk_...` and returns `null` — never throws — for anything that is not this
   identity: no header, a non-`sdpk_` token, or a token matching no active key.
   Each route tries it first, then falls through to `resolveRequestViewer`
   (session cookie) exactly as `createSessionPort`'s own `readTrustedSession`
   seam already falls through to the cookie when it returns nothing — the same
   fallback shape, not a new one. `listSotDecisions` (the human inbox) and
   `decideSotDecision` (human-only, audited) are untouched: a data-plane key
   authenticates only the two verbs FR-100 actually names as the data plane's.
4. **Revocation has no grace period.** Unlike `Session` (a person can notice
   and log out, and a short window is a fair trade for interactivity), a
   `SotDataPlaneKey` has no user to notice a compromise — `revokeSotDataPlaneKey`
   takes effect on the next request, immediately.

## Consequences

- Minting is a one-off operator command (`scripts/mint-sot-data-plane-key.mjs`),
  printing the raw secret exactly once; it cannot be recovered from the
  database afterward, only reissued.
- A second connector, or a second Tenant's connector, mints its own key — keys
  are never shared across Tenants by design, matching every other Tenant-scoped
  boundary in this codebase (SEC-001).
- Production Supabase deployment needs its own migration
  (`supabase/migrations/*_sot_data_plane_key.sql`) enabling RLS and granting
  `zuri_app_runtime`/`zuri_web_login`, following the ADR-045 runtime-role
  cutover's own idempotent per-table policy pattern. It has not been applied
  against a live Supabase project in this workspace (no Supabase CLI is
  available here, per `docs/DB-MIGRATION-NOTES.md`) — flagged as RSK-016 in
  Appendix E, a pre-production gate.
- This is deliberately narrow: one credential type, one scope dimension
  (Tenant), two routes. A future connector needing finer scope (a single
  Business, a read-only export-only key) is a new field and a new predicate
  clause, not a redesign — YAGNI held it back until a second consumer actually
  needs it.
