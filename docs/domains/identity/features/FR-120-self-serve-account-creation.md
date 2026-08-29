---
feature: FR-120
domain: identity
status: implemented
---

# FR-120 — Self-serve account creation

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Date** | 2026-08-29 |
| **Status** | Implemented |
| **Author** | Claude Opus 5 |

The door FR-066 assumed existed.

## Why this was missing rather than declined

Three things had to be true at once for nobody new to be able to enter, and all
three were:

| | |
|---|---|
| FR-066 | begins *"after a provider-neutral local identity/session exists"* and never says how one comes to exist |
| FR-067 | accepts an invite as `acceptWorkspaceInvite({ token, personId: viewer.principal.id })` — it attaches membership to somebody **already authenticated** |
| credentials | the only writers were `prisma/seed.js` and FR-107's operator bootstrap, which is operator-run |

The second consequence is the one that is easy to miss: because an invite needs
a `Person` to attach to, nobody new could be **invited** either. The invite flow
was not an alternative door; it was a door with no corridor leading to it.

## What signup does, and what it deliberately does not

Creates a `Person` and a `PersonCredential`. Stops.

No `PlatformGrant`, no Tenant, Business, Space or Project, no
`WorkspaceMembership`. What the new Person may do next is exactly what FR-066
already grants any profiled Person — the owner path of
`createOnboardingWorkspace`, gated on `profileCompletedAt` and nothing else,
which creates one `Portfolio` plus one OWNER membership and, by AC-066.2, zero
Organization/Tenant/Business/Space/Project rows.

**Signup widens who can reach that path. It does not widen the path.**

That claim is asserted rather than described: `fr120-signup-service.test.js`
fails if the service ever reaches for a `platformGrant`, `tenant`, `business`,
`workspaceMembership`, `membership`, `portfolio` or `project` model, and the e2e
spec signs a brand-new account in and asserts `/api/scope` returns it no
Businesses at all.

## Decisions

### Signed in on success

The alternative sends a person to `/login` to retype the password they chose
seconds earlier. The session comes from `authenticateUser` — FR-046's own path,
called rather than reimplemented — so one place issues sessions and a change to
how they are signed, persisted or revoked cannot apply to one door and not the
other.

The cookie carries no `maxAge`: AC-046-15's default is a browser-session cookie
and signup has no "remember me" tick to opt into the seven days.

**If the session cannot be minted, the account is still reported as created**,
with `redirect: '/login'` and `session: false`. It was committed; saying "signup
failed" would send the person to try again and meet `EMAIL_TAKEN` on their own
address.

### Email is an identifier, not a channel

This installation has no mail transport — the stated reason FR-104 has no public
forgot-password — so there is no verification step, and no *"check your inbox"*
response to hide a taken address behind. A taken address therefore returns a
distinguishable `EMAIL_TAKEN`.

That enumeration is accepted deliberately. With no mail, the alternative is a
signup that appears to succeed and silently does nothing, and what a guesser
learns buys them nothing: the account they have found holds no scope, no
capability and no membership until its owner creates a Workspace or somebody
invites them.

### The address is normalized, and that required touching the login lookup

Signup stores the address trimmed and lowercased. `authenticateUser` matched the
stored `email` exactly, so normalizing on one side alone would have created
accounts whose owners could not sign in with the casing they typed — a broken
feature, not a rough edge.

The login lookup now also matches the lowercased identifier. **Additive**: both
exact-match arms are untouched, so every identifier that resolved before still
resolves, including a `code`, which is uppercase and would resolve to nothing if
the identifier were simply lowercased before the query. The e2e spec signs up as
`Mixed.Case@Example.com` and then signs in with that same string, because no
source assertion can see this failure.

## Known limits, stated rather than glossed

### `Person.email` has no unique index, so the refusal is a check, not a constraint

Neither `schema.prisma` nor `schema.postgres.prisma` carries one. The lookup runs
**inside** the transaction, which is the narrowest window available without a
migration — SQLite serializes writes and closes it in dev and test; Postgres at
READ COMMITTED does not, so two requests arriving together can both find nothing
and both insert.

`fr120-signup-service.test.js` asserts the lookup happens inside the transaction
rather than before it, so a refactor that widened the window again would be
caught. It cannot assert what only a constraint can enforce.

**The fix is a `Person.email` unique index**, and it is deliberately not smuggled
into this slice: it is a migration against live data that may already hold
duplicates, and this session has no way to query production to find out. It
belongs with the two migrations already waiting on exactly that question.

### The rate limit is the weaker of the two compensating controls

In-process, fixed-window, per-instance. It resets on every restart and deploy,
it multiplies by the number of replicas, and it keys on a client-supplied
forwarded header — so an attacker who can set that header rotates it and each
attempt lands in a fresh bucket. When no proxy sets one at all, every caller
shares a single bucket and the limit becomes installation-wide, which is why the
window is generous (20 per 15 minutes) rather than tight: a limit low enough to
matter against a scanner would lock out an honest office behind one NAT.

It is a speed bump against a naive scanner and nothing at all against a
deliberate attacker. The control FR-120 actually leans on is the audit trail,
which records every account that comes into existence. All of this is written in
the module's own header for the same reason it is written here: a control
described more strongly than it is built is worse than one described honestly.

Rate-limit refusals are **not** audited. An unauthenticated caller who could
write an audit row per attempt would have been handed an unbounded write.

### A Thai display name always produces the same code stem

`codeFragment` strips everything outside `[A-Za-z0-9_\s-]`, so a wholly Thai name
normalizes to the empty string and falls back to `X` — every such signup starts
from `PSN-X` and takes `PSN-X-2`, `PSN-X-3`, … up to 50 lookups before a UUID
suffix. Correct, and progressively slower.

This is `uniqueHumanCode`'s existing behaviour, shared with
`resolve-line-identity`, not something signup introduces; changing the shared
generator would alter codes on paths this slice has no business touching. Named
here so the next person to hit it finds it already known.

## Files

| | |
|---|---|
| `src/app/signup/page.jsx` | the screen, on `EntryShell` |
| `src/app/api/auth/signup/route.js` | the public route |
| `src/modules/identity/signup-service.js` | Person + PersonCredential + audit, in one transaction |
| `src/modules/identity/signup-rate-limit.js` | the in-process window, and its limitations |
| `src/modules/identity/signup-copy.js` | the refusal sentences |
| `src/modules/identity/auth-service.js` | the additive lowercased-email arm in `authenticateUser` |

## Tests

| | |
|---|---|
| `tests/unit/fr120-signup-service.test.js` | grants nothing · normalization · BR-002 code · in-transaction lookup · audit carries no secret |
| `tests/unit/fr120-signup-rate-limit.test.js` | injected clock throughout — window reopening, eviction at the cap, the shared fallback bucket |
| `tests/unit/fr120-signup-route.test.js` | 429 before any hashing · browser-session cookie · account survives a failed mint |
| `tests/unit/fr120-signup-page.test.js` | every route error code has a sentence, read from the route's source rather than listed by hand |
| `tests/e2e/fr120-signup.spec.js` | the stranger's walk: create, be signed in, hold no scope, be refused the second time, and sign back in whatever the casing |
| `tests/unit/entry-surfaces.test.js` | one added case — Signup mounts EntryShell and links only back into the entry journey. `ENTRY_ROUTES` gained `/signup`, which is a **deliberate widening**: that list is named rather than counted precisely so adding to it is a review moment, not a red assertion silently repaired |
