---
feature: FR-121
domain: identity
status: blocked
---

# FR-121 — Google as a second way in

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Date** | 2026-08-29 |
| **Status** | Declared — blocked |
| **Author** | Claude Opus 5 |

Declared and **not built**. This note exists to record *what blocks it*, because
"not built yet" would hide that one of the two blockers is a model change, not a
missing key.

## The two blockers, both specific

**1. No OAuth client credential.** Nothing in the tree holds a Google client id
or secret, and none can be created from here — it is an account action in Google
Cloud Console, taken by the owner. Until then the button has nothing to call.

**2. `ExternalIdentity` requires a Tenant, and a self-serve signup has none.**
This is the harder one. The model already anticipates the provider:

```prisma
provider String // 'LINE' (later FACEBOOK | GOOGLE)
@@unique([tenantId, provider, providerSubject])
```

but `tenantId` is a required foreign key, because the only writer today is
`link-line-identity.js` and a LINE subject always arrives through a tenant's own
LINE OA. FR-120's signup deliberately creates **no Tenant** — the whole point is
that a new account holds no scope until somebody grants it. So a Google binding
for a self-serve account has no tenant to key on, and cannot be written at all.

That needs a decision before any code: either `tenantId` becomes nullable for
provider bindings that precede a tenant, or pre-tenant bindings get their own
model. Both are schema changes with a migration; neither is a detail to settle
mid-implementation.

## What is already decided

- **Sign-in follows sign-up necessarily.** A person who signed up with Google set
  no password. Offering Google only at `/signup` would strand the account behind
  a credential that was never created.
- **It grants nothing**, exactly as FR-120: no `PlatformGrant`, Tenant, Business,
  Space, Project or `WorkspaceMembership`.
- **It does not satisfy FR-122.** Google supplies an address and a display name
  of its own choosing; the given name, family name and telephone number are still
  typed by the person. The telephone number Google never supplies at all.
- **Linking to an existing local account requires `email_verified`.** An
  unverified assertion is refused, not linked. Linking on an unverified address
  is account takeover performed by signing up: anyone able to create a Google
  account bearing a target's address would inherit that person's `Person`.
- `IDENTITY_PROVIDERS` in `src/lib/validation/enums.js` is the single place
  `'GOOGLE'` gets added — never hand-copied into a second list.

## Open, and needing the owner rather than an implementer

- Which shape the tenant-less binding takes (nullable `tenantId` vs a separate
  model) — see blocker 2.
- Whether Google is offered at `/login` for accounts that *do* have a password,
  i.e. whether an existing local account may add Google as a second factor of
  convenience, or whether the two stay disjoint per account.
