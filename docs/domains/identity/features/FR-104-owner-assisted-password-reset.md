---
domain: identity
feature: FR-104
module: identity
source: v2-native
version: "0.1.0b"
created_at: "2026-08-26T00:00:00+07:00,Claude Fable 5"
last_update: "2026-08-26T00:00:00+07:00,Claude Fable 5"
status: "beta"
---

# FR-104 — Owner-assisted password reset

## Why this exists

FR-090 declared `PasswordResetToken` because the table already existed on the
live database — pushed there from the unmerged `codex/postgres-primary-runtime`
branch — but no route in `main` ever used it. A staff member who forgot their
password had no path back in short of an operator editing the database.

This closes that gap, extracted-by-reimplementation from that branch's FR-082
draft during the 2026-08-26 branch cleanup. Reimplementation, not revival,
because the draft's shape was an account-takeover primitive (Decision 1).

## Decision 1 — no public forgot-password route

The draft shipped `POST /api/auth/forgot-password` returning
`resetToken: token // Returned for API response / development workflow` — the
reset secret, handed to the unauthenticated caller who asked for it. Anyone
who could name an email could take the account.

The underlying constraint is that this repository has **no mail transport**, so
a public forgot-password route has exactly two possible shapes: one that
returns the token (the vulnerability above) or one that returns nothing and
therefore resets nothing. Neither is a password reset.

What this product actually has is a staffed installation: a Business owner who
already administers members' Memberships (FR-038) and talks to their staff on
LINE or over the counter. So minting is an authenticated authority action —
`POST /api/platform/users/password-resets` — and the raw token appears exactly
once, in that authenticated response, for out-of-band handover. Only the
consume leg (`POST /api/auth/reset-password`) is public, and it is exempt from
the route-viewer preflight check for the same structural reason login is: the
token is the credential, and demanding a session from someone locked out of
theirs is the broken boundary.

## Decision 2 — FR-038's authority boundary, verbatim

Who may mint a reset for whom is the same question as who may edit whose
Membership, so it gets the same answer: the installation operator, or an owner
of a Business where the target holds a Membership
(`businessId ∈ viewer.ownedBusinessIds`). The global `role === 'OWNER'` label
is never consulted — an OWNER-of-somewhere-else has no authority here, per the
same RCA that produced `ownsBusiness` (three shipped holes from composing the
global label with visibility).

## Decision 3 — digest in the existing column, no schema change

`PasswordResetToken.token` was declared by FR-090 as the live table's shape. A
SHA-256 digest is a string, so the hash-bound storage SEC-014 already requires
of invite tokens fits the existing column: the service stores
`sha256(rawToken)` and looks up by digest, so the raw value never reaches a
query, a log line, or an audit payload. The integration test proves the raw
token is findable nowhere in the database.

## Decision 4 — consumption revokes every active session

A common reason to reset a password is that the old one — or a session minted
under it — is in someone else's hands. `resetPassword` therefore ends with
`revokeAllSessions(personId, { reason: 'PASSWORD_RESET' })`: the FR-095 Session
rows die in the same operation that changes the credential. The integration
test holds a live session across the reset and asserts it comes out `REVOKED`
while the post-reset login's session stays `ACTIVE`.

## What is deliberately not here

- **A UI.** The mint response is consumed today by an owner in an API client or
  a future platform-users screen; the consume leg needs a small public page.
  Both are additive follow-ups — the contract is the API.
- **Email delivery.** If a mail transport ever lands, a public forgot-password
  route becomes possible — as a new decision on top of this one, not a revival
  of the draft.
- **Rate limiting on consume.** Tokens are 32 random bytes with a one-hour
  life; brute force is not the live risk. Revisit if the TTL ever grows.
