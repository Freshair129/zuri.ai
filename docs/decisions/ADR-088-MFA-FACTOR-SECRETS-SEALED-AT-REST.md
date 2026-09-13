---
version: "1.0.0"
created_at: "2026-09-14T12:00:00+07:00,Claude Opus 5"
last_update: "2026-09-14T12:00:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "identity"
  doc_type: "architecture-decision"
  scope: "encryption at rest of TOTP multi-factor secrets in MfaFactor.secret, its keys, and the migration of rows written before"
---

# ADR-088 — MFA factor secrets are sealed at rest

**Status:** Accepted on the owner's instruction of 2026-09-14.

**Amends:** ADR-045 (adds the at-rest rule for the MFA factors that PR #347 built
on its D2/D5 boundary).

**Relates to:** FR-094, FR-095, SEC-018, SEC-029, SDD-052, SDD-096, ADR-031,
ADR-032, ADR-057, ADR-061.

## Context

PR #347 (commit e829b80e, P2 TOTP MFA and session step-up) stores the base32
TOTP secret in `MfaFactor.secret` exactly as generated, and reads it back to
verify a code. Anyone who can read the table — a leaked database credential, a
support-class read, or any backup export, which carries `mfaFactor` so that a
restore does not lock people out (`backup-service.js`) — holds every enrolled
person's second factor. Anyone who can *write* the table can do worse: set a
secret they know on an ACTIVE factor and pass step-up as that person.

Unlike a password, a TOTP secret cannot be hashed: RFC 6238 verification is an
HMAC keyed by the secret itself, so the server has to be able to recover it.

The repository already has two relevant patterns. ADR-031/ADR-032 put
integration credentials in Supabase Vault behind a private `SECURITY DEFINER`
resolver that only `zuri_line_runtime` may call, and give the web app role no
Vault view (ADR-032 D6). ADR-061's `sealLineReplyToken` seals a LINE reply token
in an application column with AES-256-GCM under a deployment key
(`ZURI_LINE_REPLY_SEAL_KEY`), nonce + auth tag + ciphertext, AAD bound to the
account id. A separate, not yet accepted design proposes a shared credential
vault for LINE OA that would, in a later phase, hold envelopes like this one.

## Decisions

### D1 — Application-level AES-256-GCM in the existing column

`MfaFactor.secret` keeps its name and TEXT type and holds a sealed value. There
is no schema change and so no Supabase migration: a column that means "sealed
secret" instead of "secret" is a change of content, not of shape, and every
existing reader (the backup export, restore) keeps copying it unchanged.

Rejected alternatives:

- **Supabase Vault (ADR-032 D2).** Vault holds a handful of operator-provisioned
  integration credentials resolved by a runtime role. MFA secrets are per-Person
  rows the web app creates during a request; putting them there would grant the
  app role the Vault access ADR-032 D6 withholds, and the SQLite dev/test
  database has no Vault at all, so the path tests exercise would not be the path
  production runs.
- **`pgcrypto` in SQL.** The key would travel inside statements and could land
  in database logs, and SQLite has no equivalent.
- **Hashing.** Impossible for TOTP, as above.

### D2 — Stored form and binding

```text
mfa.v<keyVersion>.<nonce>.<auth tag>.<ciphertext>      (each part base64url)
```

A fresh 12-byte nonce per seal and a 16-byte tag. The additional authenticated
data is `["MfaFactor.secret", keyVersion, personId, factorId]`, so a sealed value
copied to another factor or another Person, or relabelled with another key
version, fails authentication rather than opening. Because the factor id is part
of the binding, `startTotpEnrollment` chooses the row id before insert. The
prefix cannot collide with a legacy value: base32 has no lowercase letters and
no `.`.

### D3 — Keys come from the deployment and fail closed

| Variable | Meaning |
|---|---|
| `ZURI_MFA_SECRET_KEY` | 64 hex characters — the current key; seals and opens |
| `ZURI_MFA_SECRET_KEY_VERSION` | positive integer, default `1` — the current key's label |
| `ZURI_MFA_SECRET_KEY_V<n>` | 64 hex characters — a retired key; opens only |

With `NODE_ENV=production`, a missing or malformed current key refuses every
MFA operation with 503 `MFA_SECRET_KEY_REQUIRED` — before a factor is read,
written or deleted, so an enrollment in progress is not discarded by a
misconfigured deployment. Outside production a missing key falls back to a
fixed development key labelled `v0`; production never opens a `v0` value, so a
development database restored into production fails closed instead of opening
under a key that is published in the source.

On open, a legacy plaintext value, a key version this deployment does not hold,
a value bound to another row, and any tampering all refuse with
`MFA_SECRET_UNAVAILABLE` and a reason code. `confirmTotpEnrollment` answers that
as 503; `verifyMfaChallenge` treats that one factor as unable to verify (logged
with its factor id and reason, never the value) and still tries the Person's
other factors.

**Rotation:** move the old key to `ZURI_MFA_SECRET_KEY_V<old>`, set the new key
and version, deploy, run the sweep in D4, then remove the retired key once the
sweep reports nothing pending.

### D4 — Rows written before move by an explicit sweep, not re-encrypt-on-read

`scripts/seal-mfa-factor-secrets.mjs` (over `resealMfaFactorSecrets` in
`mfa-secret-reseal.js`) is the one migration path, for plaintext rows and for
rows under a retired key version alike. It reports by default and exits 1 while
anything is pending; `--write` reseals each row with a compare-and-set on the
old stored value (a row changed concurrently is reported, not overwritten) and
records one `MFA_FACTOR` / `SECRET_RESEALED` audit event per row, without
secret material. It covers every status, REVOKED included, because a revoked
secret is still in the table and in every backup. Re-running it is a no-op.

Re-encrypt-on-read was rejected for three reasons:

1. **It never finishes.** Only a challenged factor is read. A person who
   enrolled and has not stepped up since keeps a plaintext secret indefinitely,
   and nothing can report the exposure as closed.
2. **It keeps a plaintext-accepting reader alive.** For as long as the reader
   accepts a base32 value, a database writer can plant a secret of their choosing
   on an ACTIVE factor — exactly the integrity property the authenticated seal
   exists to provide.
3. **It puts writes into the step-up read path**, where a concurrent enrollment
   or revocation would race it.

The reader therefore refuses plaintext from the first deploy. The window that
leaves is bounded and fail-closed: between the deploy and the sweep, a person
whose factor predates this change cannot step up (401, as for a wrong code) or
confirm a pending enrollment (503). The operator order below keeps it to minutes,
and a report run first shows whether it is empty.

**Operator steps (not performed by the change that writes this ADR, ADR-057):**

1. Generate a key once:
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`,
   and add `ZURI_MFA_SECRET_KEY` to `apps/server/.env` (the web container's
   `env_file`).
2. Deploy.
3. From `apps/server` in a checkout at the deployed commit, with the production
   database URL and the same key in the environment:
   `node scripts/seal-mfa-factor-secrets.mjs`, then `--write`, then the report
   again, which must exit 0. The runtime image does not carry `src/`, so the
   script runs from a checkout, not inside the container.

### D5 — One small boundary, so the vault phase can replace it

`src/modules/identity/mfa-secret-seal.js` is the only file that creates a cipher
over `MfaFactor.secret`. It exports `sealMfaSecret`, `openMfaSecret`,
`describeStoredMfaSecret` and `assertMfaSecretKeyConfigured`, and imports only
`node:crypto`. `mfa-service.js` and the sweep call nothing else. When a shared
credential envelope store is accepted, it replaces this module's body; the
stored-value prefix and the sweep are how rows move from one to the other.

## Consequences

- A backup export now carries sealed values. Restoring it into a deployment with
  the same key (current or retired) keeps every factor working; into a
  deployment with a different key, those factors fail closed and their owners
  revoke and re-enroll. Revocation needs only an authenticated session today.
- Losing every copy of the key has the same effect for every factor. MFA is a
  step-up factor, not a login factor, so no one loses sign-in.
- The one-time enrollment response still returns the base32 secret and
  `otpauth://` URI; that is the point at which the authenticator app receives
  it, and nothing about it changes.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-14 | accepted | Seal `MfaFactor.secret` with AES-256-GCM under a versioned deployment key, AAD-bound to Person and factor; fail closed in production; explicit reseal sweep instead of re-encrypt-on-read; one swappable module | working-tree | Claude Opus 5 |
