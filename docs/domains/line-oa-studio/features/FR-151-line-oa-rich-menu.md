---
domain: line-oa-studio
feature: FR-151
module: line-oa-studio
source: v2-native
bundle: FEAT-018
requirements:
  - FR-151
version: "0.1.0"
status: building
---

# FR-151 — the rich menu designer: `LineOaRichMenu` and its versions

## Intent

The first design surface of LINE OA Studio, as data: what a rich menu of one
account looks like and which taps do what, kept as numbered bodies that freeze
into immutable versions. Phase 1 slice 3 builds the record, its rules, the only
writer and the routes. It does not build the page and it does not talk to LINE.

## Decisions worth recording

**A version is the unit of truth; the menu is its address.** `LineOaRichMenu`
holds identity (`code` unique per Tenant), the optional `alias` (unique per
account, the handle a rich-menu-switch action names), the default flag and a
coarse status (DRAFT until a version is frozen, then READY, then ARCHIVED).
`LineOaRichMenuVersion` holds everything a deployment would send — layout,
chat-bar text, `selected`, the image reference and declared size, the areas —
numbered per menu. While DRAFT it is edited in place; once FROZEN it never
changes, and the next save opens the next number. That is LOS-RQ-041 taken
literally: the version a transport job deploys is the version the audit names,
forever.

**Freeze is the gate, save is not.** An author mid-work may save an image-less
draft with an area hanging off the edge; the version reports every such
`issue` back (unsupported image size, area out of bounds, no areas, no image)
and `FREEZE` refuses with the same list as 422. The designer page can render
the list; the API never has to guess whether the author is done.

**Tap actions are an allow-list, never an object.** `MESSAGE`, `POSTBACK`,
`URI` (https or tel only — never `javascript:` or http), `LIFF` (by the
Studio's own LIFF app code, resolved to a URL at publish time by the lane that
owns LIFF apps), `RICHMENU_SWITCH` (by alias). A discriminated union at the
boundary rejects an unknown `type` and a field from another type, so a stored
area is always something the designer can render and the transport lane can
translate. This is ADR-060 D6's "flows are data, connectors are an allow-list"
applied to the first surface that has actions.

**Images are `FileAsset` references (LOS-RQ-016).** The service checks that the
referenced file is a live PNG/JPEG of the same Tenant and Business within
LINE's 1 MiB, from the metadata the file lane recorded on upload; bytes are
never read or copied. The declared `imageWidth × imageHeight` must be one of
LINE's six sizes and every area must fit inside it — the service validates the
declaration, not the pixels, because pixel inspection belongs to the file lane
and to the transport job that will actually upload the bytes.

**Nothing here reaches LINE.** Publishing a frozen version, setting the
default, registering an alias and linking a menu to a user are each a
`LineOaTransportJob` with its own receipt (LOS-RQ-042) — the next slice. The
`externalRichMenuId` column exists on the version as a nullable attribute
(BR-002) and is written by that lane only; `PUBLISHED` and `RETIRED` are its
statuses to set. This slice ships nothing that pretends otherwise.

**Same write discipline as the account.** Publisher authority (OWNER or
`LINE_OA_PUBLISHER`), the FR-072 404 for every refusal, one transaction per
write, compare-and-swap on the menu's `version`, one audit row per action with
no secret and no customer content — copied from FR-146 rather than reinvented.

## Delivered (local, 2026-09-06)

- `prisma/schema.prisma` + generated Postgres schema: both models; migrations
  `prisma/migrations/20260906150000_line_oa_rich_menu` and
  `supabase/migrations/20260906150000_line_oa_rich_menu.sql` (forced RLS,
  private grants, **not applied**) in the same change — the
  `schema-migration-drift` guard is green.
- `src/modules/line-oa-studio/domain/line-oa-rich-menu.js` — schemas, the
  layout grid, image-size and bounds validation, the freeze gate.
- `src/modules/line-oa-studio/application/line-oa-rich-menu-service.js` — the
  only writer: create, list, get, `SAVE_DRAFT` / `FREEZE` / `ARCHIVE`.
- `GET/POST /api/line-oa/rich-menus`, `GET/PATCH /api/line-oa/rich-menus/[id]`.
- Snapshot coverage after the account and the file asset the version references.
- Tests: `tests/integration/fr151-line-oa-rich-menu.test.js` (AC-151.1–.7),
  `tests/unit/line-oa-rich-menu-domain.test.js`,
  `tests/unit/line-oa-rich-menu-routes.test.js`,
  `tests/unit/line-oa-rich-menu-schema-contract.test.js`.

## Not in this slice

The designer page under `/line-oa/accounts/[accountId]/studio`; the transport
jobs (publish, default, alias, link) and the receipts they write back; the
`LIFF` action's URL resolution (waits for the LIFF app registry); production
application of the migration (owner-instructed operator step, ADR-057).
