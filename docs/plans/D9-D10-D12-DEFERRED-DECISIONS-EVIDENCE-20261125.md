---
status: implementation-plan
version: "0.1.1"
source_of_truth: false
---

# Deferred review decisions D9, D10, D12 — evidence on main (2026-11-25)

> **Status update 2026-11-26.** This note is a snapshot of 2026-11-25 and is partly superseded.
>
> - **D10 is decided and implemented.** [ADR-124](../decisions/ADR-124-SESSION-IDLE-TIMEOUT-AND-LOGOUT-ALL.md)
>   records it as an **owner (human) decision**, not a delegated one; the code merged in PR #865. The
>   D10 section below, including "no idle timeout", "overdue" and "delegated", describes the state
>   before that and is kept as history. Remaining D10 follow-ups are in the
>   [decision register](ARCHITECTURE-REVIEW-DECISION-REGISTER-20261126.md).
> - **D9 and D12 are unchanged** and still deferred.
> - The opening paragraph's "delegated product-owner decisions" wording applied to D9 and D12 only.

**Purpose.** Three architecture-review decisions were deferred (D-D9, D-D10, D-D12; delegated
product-owner decisions by Astra, gpt-6-astra, under owner instruction 2026-11-08, relayed by the lead
Claude session; not human approval). This note collects what the repository at `main` (`4f0860d4`) already
proves toward each resume condition, and what is still missing. It decides nothing and changes no code.
The decision wording below comes from the review record, not from a repository file: no D-D9, D-D10 or
D-D12 text exists under `docs/`.

Every claim cites a path. Where a point was inferred rather than read, it says so.

## D9 — forced-RLS equivalence of a self-hosted production PostgreSQL

**Deferred because** ADR-114 separates production targets and keeps target-specific controls, so
equivalence with Supabase cannot be concluded. **Resume when** there is a target-specific isolation
contract and evidence of roles, grants, policies and negative tests on an authorised host.
ADR-018 is not waived.

**What exists**

- ADR-018 is bound to the Supabase project by name (`docs/decisions/ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md:10,47`). It requires forced RLS on every tenant-owned table, deny by default (`:135-136`), a `NOBYPASSRLS` runtime role (`:93-102`), and negative probes including a second tenant reading zero rows and a wrong-tenant foreign key rejected (`:218-227`).
- ADR-114 names self-hosted PostgreSQL and Supabase "separate production database targets" and says not to infer equivalence (`docs/decisions/ADR-114-ZURI-AI-PRODUCTION-TARGETS.md:40-44`). It authorises no connection to either target.
- ADR-115 D7 states the principle only: the runtime role must not be superuser or bypass RLS, and grants and policies must be qualified on the actual target (`docs/decisions/ADR-115-COMPACT-SELF-HOST-PROFILE.md:172-174`). It is scoped "no production activation" (`:16`).
- Supabase: 73 of the 137 migration files under `apps/server/supabase/migrations` contain `FORCE ROW LEVEL SECURITY` (120 statements; counted 2026-11-26). An earlier version of this note said "137 migrations carry" it, which confused the file count with the match count.
- Compact self-host: `apps/server/scripts/lib/compact/security.mjs` creates `zuri_app_runtime` (NOLOGIN, NOBYPASSRLS), enables and forces RLS on every public table and sets grants (`:8-35`).
- Tests on a disposable PostgreSQL in CI: `compact-fresh-install.test.js` (all public tables forced; cross-scope write rejected; 42501 on forbidden update) and `phase-b-runtime-role.test.js` (cross-tenant and cross-business writes as the runtime role), run by `.github/workflows/compact-postgres.yml:100-111` and `.github/workflows/governance.yml:564-569`.

**What is missing**

1. **No target-specific self-host isolation contract.** ADR-115 D7 is a principle, ADR-018 is Supabase-bound.
2. **Compact RLS is mostly permissive by construction.** Verified at `security.mjs:34`: every public table except six Phase B tables gets `zuri_app_runtime_all ... USING (true) WITH CHECK (true)`. Outside those six tables, forced RLS does not itself separate tenants; isolation there rests on application code. This needs an explicit decision, not an assumption of equivalence.
3. **No self-host equivalent of ADR-018 D8's probe list** (no per-tenant role, no composite-foreign-key wrong-tenant probe, no `anon`/`authenticated` zero-row probe).
4. **No evidence from an authorised self-hosted production host.** All compact evidence is from Windows Docker Desktop TEST targets, 2026-10-27 to 2026-11-01 (`reports/compact-selfhost-2026-10-27/`); Linux-host acceptance is recorded NOT_RUN (`task7-core-matrix.md:69`).
5. **Authority.** ADR-114 and ADR-115 withhold production access, so any host evidence needs separate authorisation.

## D10 — a permanent seven-day session with no idle timeout

**Deferred because** the seven-day absolute ceiling is confirmed but is not sufficient reason to endorse
having no idle timeout permanently. **Resume when** an idle, step-up and revocation contract exists with
multi-instance tests. The existing ceiling stays meanwhile. The review was due **2026-11-21 and is
overdue**; no record of it exists in the repository.

**What exists**

- Ceiling: `SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60` (`apps/server/src/modules/identity/auth-service.js:22`, verified), enforced in token generation and verification (`:88`, `:107-113`). Nothing extends `expiresAt`; there is no refresh and no rotation.
- Each request revalidates a database `Session` row (`session-port.js:59-112`), so validity does not live in per-instance memory.
- `lastSeenAt` is **written on every request and never read**: the only reference in `session-port.js` is the update at line 86 (verified). An idle timeout can therefore be added on an existing column.
- Step-up exists: a 900 s window (`session-assurance.js:16`), routes under `apps/server/src/app/api/auth/step-up` and `.../webauthn/step-up`.
- Revocation is database-backed: single logout (`auth-service.js:154-182`), `revokeAllSessions` (`:184-201`) called only from password-reset consumption, membership suspend/revoke/offboard (`membership-lifecycle-service.js`), and `erase-principal.js:139-147`.
- Tests: `iam-session.test.js`, `fr046-session-port.test.js`, `auth-service.test.js`, `password-reset-flow.test.js`, and the step-up tests.
- The stated policy is "Seven days from issue... No refresh, no rotation, no idle timeout" (`docs/domains/identity/SYSTEM-DIAGRAM.md:360`).

**What is missing**

1. An idle limit, and its enforcement in `session-port.js` using `lastSeenAt`. The `sessionIdleTimeoutMinutes` hits in the repository belong to LINE conversation sessions (FR-243), not authentication.
2. A throttle for the `lastSeenAt` write, which is a database write per request today.
3. A user-facing logout-all route and a session list. `revokeAllSessions` has no route; no change-password revocation was found (only password reset).
4. A decision on rotation and on which actions need step-up and whether 900 s is final.
5. **Multi-instance tests.** No test runs two handlers against one real store; the unit tests mock the database. Needed: revoke on A and the next request on B, idle expiry seen by both, concurrent `lastSeenAt` writes, fail-closed on store outage.
6. The overdue 2026-11-21 review needs an owner or Astra decision to reset the date.

## D12 — direct-SQL scripts as an exception to the service boundary

**Deferred because** the existence of direct-SQL scripts is not approval to bypass the service boundary.
Each needs scope, immutable input, dry-run, audit, replay and recovery evidence; no production apply is
approved. **Reduced by ADR-119** but not closed.

**What exists** (no SmartGift-named script survives in `apps/server/scripts`; ADR-119 itself deletes
nothing, `docs/decisions/ADR-119-REMOVE-SMARTGIFT-AND-GOVIBE-FROM-ZURI.md:16`)

| Item | Scope | Input hash | Dry-run | Audit | Replay | Recovery |
|---|---|---|---|---|---|---|
| `20261120000000_drop_smartgift_business_data.sql` | yes (one Business, aborts on mismatch) | no (only the pre-drop dump is hashed, runbook `:65`) | yes (forced rollback mode) | **no** | yes (no-op when absent) | backup plus scratch restore only |
| `backfill-repository-business.mjs` | yes (ownerless rows) | no | yes (default) | **no** | likely (inferred) | no |
| `backfill-conversation-sessions.mjs` | yes (`--tenant`) | no | yes (default) | **no** | yes | no |
| `migrate-line-oa-provider.mjs` | yes (`tenantIds`) | no | yes | partial (metadata, not `AuditEvent`) | yes | runbook cited, not read |
| `phase-b-recovery.mjs` | not assessed | not assessed | not assessed | not assessed | not assessed | not assessed |

Verified: none of the three backfill scripts mentions "audit", and the drop migration contains no
`AuditEvent` insert; its counts exist only as `RAISE NOTICE` output.

**What is missing**

1. Audit evidence for the drop migration and the two backfills (an `AuditEvent` row or an equivalent manifest).
2. An immutable input record (hash of the input set) per script.
3. Recovery evidence beyond "restore from backup", including the untested parts the runbook itself lists (production-volume run, Step 6, Steps 3, 4 and 9, runbook `:229-231`).
4. An assessment of `phase-b-recovery.mjs`, which uses `$executeRawUnsafe` (`:268`) and a raw `INSERT` (`:518`).
5. A decision, for each script, between routing it through a service and recording an exception with the evidence above.

## Suggested next step (not a decision)

D10 is the only item whose date has lapsed and whose gap is smallest and self-contained: a decision
on the idle limit, then an implementation that reads the existing `lastSeenAt` plus the multi-instance
tests. D9 and D12 need an authorised host and per-script work respectively.

## Version history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-11-25 | Claude Sonnet 5.5 | Initial evidence collection for deferred D9, D10 and D12; three read-only passes, key claims re-verified against source. |
| 0.1.1 | 2026-11-26 | Claude Sonnet 5.5 | Add status update (D10 now ADR-124, owner decision, PR #865); correct the FORCE RLS count (73 files, 120 statements, not 137). From the gap analysis (G15). |
