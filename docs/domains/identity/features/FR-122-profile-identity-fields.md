---
feature: FR-122
domain: identity
status: implemented
---

# FR-122 — A Profile states who the person is

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Date** | 2026-08-29 |
| **Status** | Implemented |
| **Author** | Claude Opus 5 |

FR-066's Profile step collected a display name and an optional email. That is a
label, not an identity. This adds **given name, family name and telephone
number**, all required at the step.

## Why the columns are nullable when the fields are required

This is the only decision in here worth arguing about, so it goes first.

`Person` rows already exist that can never satisfy these fields, and one of them
is not an edge case:

| Writer | What it has when it creates a Person |
|---|---|
| `prisma/seed.js` | a code and a display name |
| FR-107 operator bootstrap | a code and a display name |
| **FR-023 LINE ingest** | **a `lineUserId`, and nothing else** |

The third is the primary surface. `ingestLineMessage` creates Person + Customer +
Conversation + Message atomically on first contact, from a channel subject — it
has no name to write and no telephone number to ask for. A `NOT NULL` on these
columns would make that path unwritable and take LINE intake down with it.

So the requirement cannot live on the column. It lives at
`completeProfile`, which is the only place a person states these things
themselves. The split is deliberate and it is the thing to preserve: a later
change that "tightens" the schema to match the form would break the intake
surface, and the migration comment says so at the point where someone would try.

## Display name is no longer typed twice

Asking for ชื่อ, นามสกุล **and** ชื่อที่แสดง makes a person write their own name
twice. `displayName` is still never empty in storage — every surface renders it —
but the form marks it optional and the service composes `"${firstName} ${lastName}"`
when it is absent. A supplied one always wins.

The contract change is one-directional and safe: `displayName` went from required
to optional, so every existing caller still validates.

## Files

| Path | What |
|---|---|
| `prisma/schema.prisma` | `firstName` / `lastName` / `phone` on `Person`, nullable |
| `prisma/schema.postgres.prisma` | the same three |
| `prisma/migrations/20260829120000_add_profile_identity_fields/` | SQLite dev/test |
| `prisma/postgres/0003_profile_identity_fields.sql` | Supabase, `IF NOT EXISTS`, additive |
| `src/modules/identity/onboarding-service.js` | requires the three, composes the display name, returns them in profile state |
| `src/app/api/onboarding/profile/route.js` | the Zod contract, `displayName` now optional |
| `src/app/(entry)/onboarding/profile/page.jsx` | the form |

## Tests

| Path | What it holds down |
|---|---|
| `tests/unit/onboarding-service.test.js` | each field refused on its own, whitespace refused as absence, display name composed and not overwritten |
| `tests/unit/workspace-onboarding-routes.test.js` | the contract refuses each missing field **and never reaches the service** — a 400 that still called through would mean the schema is decoration |
| `tests/integration/workspace-onboarding-flow.test.js` | the round trip through the real columns; a missing migration fails here and nowhere else |

## Known limits

- No telephone-number format validation. `min(1).max(32)` and nothing more:
  this installation has no SMS transport and no country it can assume, so a
  format check would reject valid numbers to enforce a rule nothing downstream
  relies on. When something does send to this number, that is when the shape
  becomes a requirement with a reason.
- Existing people are not backfilled and are not forced through the step again.
  `profileCompletedAt` is already set for them, so FR-066 routes them past
  `PROFILE`. They will have null names and numbers until they edit their profile.
  Whether that backlog needs a prompt is a product decision, not a defect —
  recorded here rather than silently closed.
- FR-121 (Google) does **not** satisfy this. Google supplies an address and a
  display name of its own; the given name, family name and telephone number are
  still typed by the person.
