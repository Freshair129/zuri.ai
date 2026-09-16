---
version: "1.0.1"
created_at: "2026-09-14T15:00:00+07:00,Claude Opus 5"
last_update: "2026-09-14T15:00:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "integration"
  doc_type: "architecture-decision"
  scope: "browser write-only provisioning of channel credentials into the Integration lane's secret store, stateless LINE tokens, the AAL2 step-up gate, the installation-wide channel account claim, automatic webhook registration and derived legacy quiescence for self-serve LINE OA onboarding"
---

# ADR-089 — Browser write-only credential provisioning into the Integration vault, and self-serve LINE OA onboarding

**Status:** Accepted on the owner's instruction of 2026-09-14 ("ใช้ค่าที่เสนอทุกข้อ"). Phase 0
(declaration) only: no port, store, route, model, migration or UI exists yet.

**Decided by:** the owner, 2026-09-14, accepting every recommended default of the LINE OA platform
design (decisions 1–6, 10 and 17A of the consolidated decision table).

**Amends by pointer** (each amended ADR carries a one-line pointer back here; their text is not rewritten):

- **ADR-061 D8** — "LINE material is a scoped Integration secret-manager reference, not a Studio
  field" stays true. What changes: the reference may now point into a store the owner wrote to from
  the browser (D2), not only at the operator's read-only mount.
- **ADR-060 D3** — "Connect account … never accepts secret material". The Studio still never holds
  material; the connect wizard posts it write-only to the Integration lane's route (D7).
- **ADR-041 D3** — "the cloud console does not capture, store, or display sensitive edge
  credentials". Still true for EDGE-mode accounts (ADR-060 0.2.0 scoped it); a CLOUD-mode account's
  channel credential may be *captured* write-only by the cloud console and is never stored in a
  readable form or displayed (D2).
- **ADR-032 D2**, the sentence "raw value is entered in the Supabase Dashboard Vault UI; this page
  accepts only `supabase-vault:<uuid>`". That remains the generic Platform form's behaviour until a
  per-kind validator exists; for LINE channel credentials the write path is the
  `SecretManagerProvisionPort` ADR-032 D2 reserved, named `SecretStorePort` here (D1).

**Relates to:** ADR-031, ADR-032, ADR-041, ADR-045, ADR-053, ADR-057, ADR-058, ADR-060, ADR-061,
ADR-090, ADR-091, FR-080, FR-094, FR-095, FR-146, FR-149, FR-223, FR-224, FR-225, FR-226,
FR-227, FR-228, FEAT-036, SEC-030, SDD-097, SDD-098,
`docs/plans/LINE-OA-CREDENTIAL-VAULT-ONBOARDING-AND-CHAT-HISTORY-DESIGN.md`.

## Context

The evidence is in [the credential vault design](../plans/LINE-OA-CREDENTIAL-VAULT-ONBOARDING-AND-CHAT-HISTORY-DESIGN.md)
§2, each claim marked VERIFIED or ASSUMED with its file. The facts that force a decision:

- **Only an operator can connect a LINE OA today.** The Studio form and
  `apps/server/src/modules/integration/application/line-server-provisioning-service.js` accept only a
  destination and a `deployment-secret:<name>` reference; the channel secret itself has to be typed
  into a JSON file on the host, which `server-line-transport.js` re-reads on every resolution. A
  Business owner of a hosted installation cannot onboard without someone with shell access.
- **The Supabase Vault path cannot serve a LINE OA connection.** The one Vault resolver
  (`supabase/migrations/20260818050000_phase1_line_supabase_vault_resolver.sql`) joins the Phase-1
  runtime's own `zuri_core.integration_*` tables with `purpose = 'PHASE1_LINE_LLM'`; LINE OA
  connections live in Prisma's `public."IntegrationConnection"`. There is no `vault.create_secret`
  anywhere in the repository, so no write path exists either.
- **`ENABLE_SERVER` is hard-wired to the mount** (`line-oa-account-service.js` constructs
  `createServerLineSecretManagerFromEnv()` unconditionally) and asks a person to type that the old
  transport has stopped — the only fence against two consumers of one webhook.
- **One bot can be connected by two Tenants.** `IntegrationConnection` is unique on
  `(tenantId, providerId, externalAccountId)`.
- **Step-up exists and is unused here.** `POST /api/auth/step-up` and `assertSessionAssurance`
  (`session-assurance.js`, FR-094/FR-095 and PR #347) elevate a Session to AAL2 for 900 seconds.
  There is no rate limiter anywhere in `src/lib` or the API helpers.
- **LINE issues stateless tokens.** `POST https://api.line.me/oauth2/v3/token` exchanges Channel ID
  and Channel secret for a token valid 15 minutes that cannot be revoked and has no issuance limit;
  `GET /v2/bot/info` returns the bot's user id (the webhook `destination`); the webhook endpoint can
  be set, read and tested through `/v2/bot/channel/webhook/*`.
- **The three ADR sentences that block browser entry are not the security invariant.** ADR-061 D8's
  invariant is "raw channel keys never become API response fields or Prisma values"; the "no browser
  entry" rule came from FR-149's implementation choice and ADR-060 D3's wording. ADR-032 D2 and D5
  already reserved a write-only provision path, and ADR-053 D3 designed one for FlowAccount.

## Decision

### D1 — One `SecretStorePort` in the Integration lane, two writable stores, one operator mount

The Integration lane owns a `SecretStorePort` with write, activate, rotate, revoke and resolve.
Behind it:

| Store | For | Where encryption happens | Selected by |
|---|---|---|---|
| **Supabase Vault** (primary) | the hosted product | in the database, inside `SECURITY DEFINER` functions over the public Prisma tables; the root key never enters the database or the app | `ZURI_SECRET_STORE=supabase-vault` |
| **Envelope store** | self-host and generic Postgres (ADR-058 `local-db`), and SQLite dev/test | in the app: AES-256-GCM under a per-secret data key wrapped by a key-encryption key the database never holds | `ZURI_SECRET_STORE=envelope` |
| **Deployment secret mount** | operator-provisioned accounts that already exist | none (a read-only file outside the checkout) | present only when its file is configured; never writable, never the UI default |

Both writable stores are built in the same wave, so a self-host customer never needs an operator to
onboard. An installation writes to exactly one store. A reference names its store by prefix, and a
prefix with no configured adapter resolves `Unavailable` — **cross-store resolution is refused**,
never attempted. SDD-097 records the mechanics. The Phase-1 model-credential resolver is not touched.

### D2 — Browser entry is write-only, and the invariant is restated as a security requirement

A credential may be entered in the browser. It then exists in exactly three places: the request, the
store, and the process that resolves it for one LINE call. SEC-030 is the invariant: no API response,
log line, audit payload, error or its cause, backup snapshot, Prisma column or long-lived client state
carries it, in either store; display is a mask plus the last four characters of the **Channel ID**
(never of the secret or token); there is no read-back route in any store.

### D3 — Store Channel ID and Channel secret; mint 15-minute stateless tokens

For a LINE channel the stored bundle is `{channelId, channelSecret}`. The LINE port mints a stateless
token per SDD-098 and caches it briefly per credential version. A long-lived channel access token is
accepted only as an **explicit override** the owner pastes deliberately; it is never asked for by
default, because a stored long-lived token never expires and can only be revoked in the LINE console.

### D4 — Every credential write needs AAL2; no factor means enrol first

Write, rotate, revoke and validate all call `assertSessionAssurance(viewer, 'AAL2')`. A Person with no
ACTIVE TOTP factor is sent to enrolment first (`MFA_FACTOR_REQUIRED`). The same gate applies to every
role allowed to write a credential. These routes also get the product's first rate limit (FR-224).

This ADR does not touch MFA code. Sealing `MfaFactor.secret` at rest is a separate lane already
running (`ADR-088`, branch `fix/identity-mfa-secret-at-rest`, merged to main as PR #387 after this
branch was cut, so it is cited by name rather than linked); a later move of that secret into this port is not decided here.

### D5 — Credentials are versioned; rotation never leaves an account unresolvable

Every write is a new version in `PENDING_VALIDATION`; live validation activates it. Rotation keeps the
previous version resolvable until the new one validates, then purges it; a failed validation keeps the
old one and purges the new one. Rotation does not bump the account's transport epoch (queued work keeps
flowing); revocation does fence the account (ADR-061 D7). A store write whose database transaction then
fails is purged by compensation (the ADR-053 D3 rule); a purge that itself fails leaves a `REVOKED`,
not `PURGED`, version row for a reconciler. A restored snapshot sets every credential to
`REENTRY_REQUIRED`, which is what ADR-061 already demands in words ("activation requires fresh
credential validation"). The store functions re-prove Tenant, Business, connection and destination
from the rows, never from their arguments.

### D6 — A bot is claimed once across the installation; a foreign claim is refused truthfully

Before any secret is stored, the connection takes a `ChannelAccountClaim` keyed by the SHA-256 of the
bot's destination, unique among live claims installation-wide. A claim held by another Tenant is
refused with a truthful message ("บัญชีนี้เชื่อมต่ออยู่กับพื้นที่ทำงานอื่นแล้ว") that names no Tenant or
Business. Disclosing "already bound elsewhere" is acceptable only because the caller has just proved
possession of the channel secret. An operator-mediated takeover is a later phase with its own
requirement.

### D7 — One wizard connects an account; the webhook is set and tested through LINE's API

The onboarding sequence is: step-up → Channel ID + secret (+ optional override token) → mint token and
`GET /v2/bot/info` (fills destination, basic id, display name) → claim → store write → connection and
credential → DRAFT `LineOaAccount` → register webhook → enable server. Thai copy and the error table
are in the design §5.3–5.4.

Webhook registration is automatic: set the endpoint, read it back, run LINE's test, store the outcome
as account webhook health. When the API refuses (URL not https, public base URL unset, "Use webhook"
toggled off, test failure), a manual card shows the URL to paste into the console. A test request
whose signature fails proves the stored secret is not this channel's and routes to rotation.

### D8 — Legacy quiescence is derived for vault-backed accounts

For an account whose credential lives in a writable store, `ENABLE_SERVER` derives quiescence: LINE's
webhook endpoint equals this server's account URL **and** the legacy seam recorded no evidence for the
destination in the last **120 seconds**. The typed checkbox stays for mount-backed accounts, where no
automatic webhook replacement has happened. `ENABLE_SERVER` validates through the dispatching secret
manager of SDD-097 instead of constructing the mount adapter. Its epoch fence and its refusal while
SENDING or UNKNOWN jobs exist are unchanged.

### Planned persistence (not in any schema yet)

Named so no other lane designs them elsewhere; each lands with its implementation FR, its charter
claim and its Supabase migration in the same change:

| Lane | Planned | Purpose |
|---|---|---|
| integration | new columns on `IntegrationCredential` (store, kind, display hint, validation, revocation) | lifecycle metadata, never material |
| integration | `IntegrationCredentialVersion` | append-only version history for rotate and revoke |
| integration | `IntegrationSecretEnvelope` | envelope-store ciphertext; excluded from backup export |
| integration | `ChannelAccountClaim` | one live claim per bot, installation-wide |
| identity | `RateLimitBucket` | the credential-write rate limit (ADR-058 has no Redis) |
| line-oa-studio | `LineOaAccount.webhookStateJson` | webhook health only LINE can report |

## Requirement map

| Design placeholder | Id | Subject |
|---|---|---|
| vault FR-NEW-1 | FR-223 | Integration credential vault |
| vault FR-NEW-10 | FR-224 | Credential-write step-up gate |
| vault FR-NEW-2 | FR-225 | Self-serve LINE OA connection |
| vault FR-NEW-4 | FR-226 | LINE channel account claim |
| vault FR-NEW-3 | FR-227 | Automatic LINE webhook registration |
| (decision 6) | FR-228 | Derived legacy-transport quiescence |
| vault SEC-NEW-1 | SEC-030 | Write-only credential material |
| vault SDD-NEW-1 | SDD-097 | Secret store selection by reference prefix |
| vault SDD-NEW-2 | SDD-098 | Stateless LINE token minting |
| vault FEAT-NEW-1 | FEAT-036 | Connect LINE OA yourself |

## Consequences

- **Onboarding stops needing an operator** for CLOUD-mode accounts, on hosted and self-host
  installations alike. EDGE-mode accounts are unchanged (ADR-041 D2).
- **MFA becomes mandatory for anyone who connects a LINE account.** Onboarding friction rises by one
  step; the wizard enrols inline.
- **Automatic webhook replacement un-routes any other consumer of the bot, irreversibly from LINE's
  side.** That is the intent, and D8's derived check runs before `ENABLE_SERVER` for that reason.
- **Two security stories to keep true.** Supabase Vault's boundary is SQL privilege on one view, so the
  definer functions and grants are the whole story; the envelope store's boundary is the app host, so
  its key-encryption key backup and rotation are this product's job.
- **Charters.** integration, identity and line-oa-studio gain prose for the planned models; no
  `owns_models` change until a model exists.
- **Migrations** are written with each implementation slice and applied only on the owner's
  instruction (ADR-057). `docs/.schema-migration-baseline.json` must not grow.

## Required proof (before any production activation)

1. A browser write leaves no material in the response, server log, audit row, error, backup export or
   any Prisma column — a test greps captured output for the test secret, in both stores.
2. A store function called with another Tenant's or Business's connection id refuses from the
   database (`CHANNEL_SECRET_SCOPE_MISMATCH`), not only from the app.
3. A reference with a prefix whose store is not configured resolves `Unavailable`; no cross-store read.
4. An AAL1 session, an expired elevation and a Person with no factor are each refused before any LINE
   call; the rate limit answers 429 with `retryAfterSeconds`.
5. A wrong Channel ID and a wrong secret are indistinguishable in the response; nothing is stored.
6. A bot claimed in another Tenant is refused with no Tenant or Business named; no orphan secret remains.
7. Rotation keeps sends flowing through validation; revocation fences the account and fails queued
   sends closed; a restored snapshot forces re-entry.
8. The webhook test with a wrong stored secret is reported as a signature mismatch and routes to rotation.
9. `ENABLE_SERVER` on a vault-backed account refuses while legacy evidence is younger than 120 s and
   succeeds after, with no typed confirmation.
10. A real LINE channel is connected end to end from the browser in a dev deployment before any
    production migration is applied.
    **Ordering waived by the owner on 2026-09-14:** the five Phase 1 migrations
    (`20260914140000`..`20260914140400`) were applied on production before this run, on the owner's
    instruction. The end-to-end proof itself still stands for Phase 1 acceptance (TASK-ZAI-081).

## Delivery phases (shared numbering with ADR-090 and ADR-091)

| Phase | Content | Gate |
|---|---|---|
| 0 | This ADR, FR-223..FR-228, SEC-030, SDD-097, SDD-098, FEAT-036 declared; charter prose | `govern` green; owner approval 2026-09-14 |
| 1 | `SecretStorePort`, Vault functions and envelope store, dispatching manager, credential versions, channel account claim, LINE channel-admin port (token, bot info, webhook set/get/test), rate limit, AAL2 gate | unit and integration tests on both providers; proof items 1–6 and 10 |
| 2 | Thai wizard, credential and webhook cards, derived quiescence, migration from the mount, restore re-entry | e2e journey; proof items 7–9; production migrations applied by the operator on instruction; one production account moved off the mount |
| 7 | Generalise the port to other kinds (FlowAccount `OAUTH_CLIENT`, model-provider keys); retire the Phase-1 resolver | separate requirements |

Phases 3–6 belong to ADR-091 and ADR-090.

## Alternatives rejected

**Keep operator-only provisioning.** Rejected: it makes every SaaS onboarding a support ticket and was
never the invariant ADR-061 D8 protects.

**Supabase Vault only.** Rejected by the owner: self-host (ADR-058) has no Vault, so those customers
would keep needing an operator.

**Store the long-lived channel access token by default.** Rejected: it never expires and cannot be
revoked from here; stateless tokens bound the blast radius by time.

**Allow the same bot in two Tenants and let the webhook decide.** Rejected: two consumers of one
webhook is the failure ADR-061 D3's quiescence rule exists to prevent.

**Amend ADR-061, ADR-060, ADR-041 and ADR-032 in place.** Rejected: four ADRs say "no secret material"
in different words; one new decision amending them by pointer is the ADR-063 / ADR-067 precedent.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.1 | 2026-09-14 | accepted | Proof 10's ordering waived by the owner: the Phase 1 migrations were applied on production before the real-channel run; the proof itself is unchanged | working-tree | Claude Opus 5 |
| 1.0.0 | 2026-09-14 | accepted | Browser write-only credential provisioning into one `SecretStorePort` (Supabase Vault primary, envelope store for self-host, mount operator-only, no cross-store resolution), stateless LINE tokens, AAL2 step-up, installation-wide channel claim, automatic webhook registration and derived legacy quiescence; amends ADR-061 D8, ADR-060 D3, ADR-041 D3 and ADR-032 D2 by pointer; Phase 0 declaration only | working-tree | Claude Opus 5 |
