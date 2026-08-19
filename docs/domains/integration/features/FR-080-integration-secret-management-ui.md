---
domain: integration
feature: FR-080
module: integration
source: v2-native
version: "0.2.0b"
created_at: "2026-08-18T12:00:00+07:00,ATHER"
last_update: "2026-08-18T16:00:00+07:00,ATHER"
status: "candidate"
---

# FR-080 — Integration and Secret Manager management UI

## Rationale

FR-079 has a runtime connection selector and provider-neutral secret resolution.
The approved slice adds a safe Platform surface for Business-scoped metadata,
while Supabase Vault remains the only production plaintext store.

## Contract

Add a Platform sub-domain at `/platform/integrations` for authorized owners. The
surface is Business-scoped and manages the existing Integration Platform records:

- provider/model metadata;
- fixed `purpose=PHASE1_LINE_LLM`;
- `ACTIVE`/`PENDING`/`REVOKED` status and `PRIMARY`/secondary role;
- masked secret reference, version, expiry and configured/missing state;
- metadata create/list with explicit loading, empty and error states.

The UI never displays or stores raw secret material. Operators create the value
in Supabase Dashboard → Vault and paste only `supabase-vault:<uuid>` into the
metadata form. The runtime reads it through the private `zuri_line_runtime`
resolver; no browser route reads `vault.decrypted_secrets`.

## Acceptance criteria

### AC-075.1 — Platform placement

The sitemap and navigation contract place Integrations under Platform. It is not
a new Tier-2 business domain and does not change the existing business domain
allow-list.

### AC-075.2 — Trusted scope

The server derives the selected Business from the trusted viewer and rejects
client-selected tenant, business or connection authority. An owner of Business A
cannot list, read status for, mutate or promote a Business B connection.

### AC-075.3 — Metadata-only read model

List/detail responses contain only authorized provider, model, purpose, role,
status, masked reference label, version, expiry and health fields. They contain
no raw secret, provider key, authorization header or full secret-bearing URL.

**Health (implemented 2026-08-19).** `health` is `{ state, reasons[], evidence }`
where state is one of `CONNECTED · DEGRADED · ERROR · DISABLED · MISCONFIGURED`.

It is **computed, never stored** — the same rule progress lives under. A status
column is a claim that was true once, and its failure mode is a dashboard reading
CONNECTED while every event fails. `evaluateConnectionHealth` is a pure function of
evidence the database already holds, so it cannot go stale and there is no cache to
reconcile.

Two judgements worth knowing before reading a row:

- **A configured channel that has never received an event is DEGRADED, not
  CONNECTED.** We have never observed it working, and reporting green on the
  strength of configuration alone is exactly the claim an operator would act on and
  regret. `NO_TRAFFIC_OBSERVED` says which case it is.
- **Traffic silence only counts against a CHANNEL.** A model provider has no
  inbound stream, so judging it on silence would leave every LLM connection
  permanently DEGRADED.

`reasons` carries every finding, not only the one the state is named after, so a
connection that is both disabled and misconfigured reports both. Precedence for the
headline is DISABLED → MISCONFIGURED → ERROR → DEGRADED → CONNECTED: an operator
who has not enabled a connection does not need to be told its optional fields are
blank, and that becomes actionable the moment they do.

The listing covers both kinds an operator has to reason about — the Phase 1
`MODEL_PROVIDER` connections this page creates, and the `LINE_OA` `CHANNEL` the
FR-081 ingress records evidence against. One surface on purpose: "is LINE up?" and
"is the model configured?" are the same question asked twice, and a separate
LINE-only status page would be the second source of truth this domain exists to
avoid. The create form is unchanged and still fixed to `purpose=PHASE1_LINE_LLM`;
channels are read-only here and are provisioned by the operator path in FR-081.

Channel health reads `RawExternalRecord.receivedAt`, which is the only durable
record that a connection actually carried traffic. It does **not** yet see failure
rates: nothing writes `processingStatus=FAILED` or a `DeadLetterRecord`, so a
channel receiving events that all fail downstream still reads CONNECTED. Closing
that needs the dead-letter path FR-081 declares out of scope.

### AC-075.4 — Vault-only secret lifecycle

The implemented form accepts an opaque Vault reference only. Supabase Vault
stores the plaintext; Zuri persists only the reference and returns only redacted
status plus version/expiry. Missing or unavailable resolver capability fails
closed. Write/rotate/revoke operations remain a separate follow-up port.

### AC-075.5 — Connection lifecycle safety

Metadata writes are audited and idempotent. Promotion uses the FR-079 CAS path
and database uniqueness invariant. The UI exposes ambiguity, expiry, stale
version and manager errors without guessing or silently falling back.

### AC-075.6 — Activation separation

No UI action activates a LINE binding, enables routing, calls LINE or produces an
`ACCEPTED_BY_LINE` claim. FR-053/054/055 and their operator evidence remain the
activation gate.

### AC-075.7 — Explicit UX states

The page defines loading, empty, unauthorized, manager unavailable, expired,
rotation in progress, conflict and success states. It is keyboard accessible and
meets the existing NFR-008 WCAG 2.2 AA baseline.

## Implemented and deferred server operations

The first two operations are implemented; lifecycle operations remain deferred:

| Method | Path | Secret rule |
|---|---|---|
| GET | `/api/platform/integrations` | implemented; metadata/status only |
| POST | `/api/platform/integrations` | implemented; opaque Vault reference only |
| PATCH | `/api/platform/integrations/[id]` | version/CAS guarded metadata |
| POST | `/api/platform/integrations/[id]/secret` | write-only through external manager |
| POST | `/api/platform/integrations/[id]/rotate` | no old/new material returned |
| POST | `/api/platform/integrations/[id]/revoke` | purge runtime cache and audit |
| POST | `/api/platform/integrations/[id]/promote` | connection state only; no routing activation |

## Dependencies

- FR-038/FR-061/FR-062 for trusted Platform visibility and Business ownership;
- FR-079, NFR-015, SEC-015 and ADR-031 for connection and secret runtime boundaries;
- SEC-003/SEC-008 for audit and trusted viewer/session authorization;
- ADR-032 for the UI and provisioning decision;
- Supabase production migration application, Vault secret provisioning and live
  isolation/canary evidence before production traffic.

## Out of scope

- Browser-side raw secret entry or raw secret persistence;
- LINE activation/canary or provider golden evaluation;
- Ollama production usage;
- a new role or cross-Business operator authority.

## Delivery state

Implemented locally: Platform page, trusted metadata API/service, Supabase Vault
runtime adapter and private resolver migration artifact. The migration has not
been applied to a live Supabase project in this repository, and no production
Vault secret or LINE canary is claimed.
