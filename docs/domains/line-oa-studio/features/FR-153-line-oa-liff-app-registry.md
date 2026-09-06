---
domain: line-oa-studio
feature: FR-153
module: line-oa-studio
source: v2-native
bundle: FEAT-018
requirements:
  - FR-153
version: "0.1.0"
status: building
---

# FR-153 — the LIFF app registry

## Intent

What LIFF apps an account has, so the rest of the Studio can name one instead
of pasting a URL. Phase 1 slice 5 builds the registry record, its only writer,
the routes, and the one resolution that was missing: a rich menu `LIFF` tap
action (FR-151) now publishes (FR-152) as `https://liff.line.me/{liffId}{path}`
through an ACTIVE registered app, and is refused by code — not invented — when
no such app exists or it is not yet active.

## Decisions worth recording

**A registry, not a LINE client.** LIFF apps are created in LINE Developers
under a LINE Login channel, whose credential is not the Messaging API token the
server-owned transport holds (ADR-061 D8 scopes each secret to its purpose).
So this slice records what a publisher created there — name, view size,
endpoint, scopes, bot prompt — and the `liffId` LINE issued, validated as a
shape (`\d{10}-[A-Za-z0-9]{8}`) and never looked up. Creating or updating the
app on LINE through a transport job (SRS LOS-RQ-070's second sentence) waits
for a LINE Login credential contract; nothing here pretends to have made one.

**DRAFT until the id is known, ACTIVE from then.** A registration without a
`liffId` is a plan; `RECORD_LIFF_ID` activates it. Only ACTIVE apps resolve, so
a rich menu that names a DRAFT app is refused at queue time with
`LINE_OA_RICH_MENU_LIFF_NOT_ACTIVE` — distinct from `…_LIFF_UNRESOLVED` for a
code the account does not have at all. The publish worker resolves again at
execution, so an app archived between queue and run fails the job rather than
publishing a dead link.

**Same write discipline as the account and the menu.** `code` unique per
Tenant, `liffId` unique per account (BR-002: an attribute, never a key),
publisher authority, the FR-072 404, compare-and-swap on `version`, one audit
row per action without secrets. Archiving keeps the row.

**Vocabularies where the guards expect them.** View sizes, scopes, bot prompts
and actions are enums in `enums.js`; the three-word status list lives with the
aggregate for the same `enum-copy` reason FR-152's job statuses do.

## Delivered (local, 2026-09-06)

- `prisma/schema.prisma` + generated Postgres schema: `LineOaLiffApp`;
  migrations `prisma/migrations/20260906210000_line_oa_liff_app` and
  `supabase/migrations/20260906210000_line_oa_liff_app.sql` (forced RLS,
  private grants, **not applied**) in the same change.
- `src/modules/line-oa-studio/domain/line-oa-liff-app.js` — schemas, the id
  shape, `liffUrl`, `resolveLiffAction`.
- `src/modules/line-oa-studio/application/line-oa-liff-app-service.js` — the
  only writer: register, list, get, `UPDATE` / `RECORD_LIFF_ID` / `ARCHIVE`.
- `domain/line-oa-rich-menu-publish.js` and `application/line-oa-rich-menu-jobs.js`
  — `translateAction` resolves `LIFF` through the registry at queue and at
  execution.
- `GET/POST /api/line-oa/liff-apps`, `GET/PATCH /api/line-oa/liff-apps/[id]`;
  snapshot coverage after the account.
- Tests: `tests/integration/fr153-line-oa-liff-app.test.js` (AC-153.1–.5),
  `tests/unit/line-oa-liff-app-domain.test.js`,
  `tests/unit/line-oa-liff-app-routes.test.js`.

## Not in this slice

Creating or updating the app on LINE (needs a LINE Login channel credential
contract); the LIFF tab of the designer page; flow `LIFF` nodes (the flow
designer is a later phase); production application of the migration
(owner-instructed operator step, ADR-057).
