---
domain: line-oa-studio
feature: FR-152
module: line-oa-studio
source: v2-native
bundle: FEAT-018
requirements:
  - FR-152
version: "0.1.0"
status: building
---

# FR-152 — rich menu publish jobs, server-owned

## Intent

The lane that takes a frozen `LineOaRichMenuVersion` (FR-151) and puts it on
LINE, designed on ADR-061 — the server owns LINE — rather than on ADR-060's
earlier `LineOaTransportJob` sketch, which assumed an edge device might own
the channel. Phase 1 slice 4 builds the durable job, the Integration lane's
rich menu port, the worker and the routes. It does not build a page and it
has not been run against LINE.

## Decisions worth recording

**Three owners, as ADR-061 D1 draws them.** The Studio owns the durable
`LineOaRichMenuJob` and the decision of what to do with an outcome. The
Integration lane owns every LINE call — `server-line-rich-menu-transport.js`
creates the menu object, uploads the image, sets the default, sets the alias —
and the credential, resolved per attempt from the same deployment secret
mount FR-149 uses (`resolveServerLineAccount`). The file lane owns the image
bytes (`resolveFileAssetContent`). The job row has no token column, no route
returns one, no audit row carries one.

**One job per menu at a time, queued by a publisher.** `PUBLISH` targets the
newest FROZEN version; `SET_DEFAULT` and `SET_ALIAS` target the PUBLISHED
version that carries an external `richMenuId`. The account must be CONNECTED,
CLOUD and `serverEnabled` — the same server-ownership test the conversation
worker applies — and the menu's `version` is the compare-and-swap, so a stale
designer tab cannot queue over a fresh one. A `LIFF` tap action has no URL
until the LIFF registry exists, so it is refused at queue time rather than
sent as an invented link.

**Claim, fence, resolve, then call — in that order.** The worker takes the
oldest due job with compare-and-set on `(id, version, status)` and a
two-minute lease, but only after the fence: the account must still be
server-owned and on the same `transportEpoch` the job was queued under, or the
job is CANCELLED without an external call. Credential resolution happens
before the claim's external work too, so a revoked mount fails one job
(`LINE_ACCOUNT_UNAVAILABLE`) and cannot become an ambiguous provider attempt.

**Ambiguity is classified by idempotency (ADR-061 D7).** Creating a rich menu
is not idempotent and LINE offers no retry key for it: an unconfirmed create
(network error, timeout, accepted response whose id cannot be read) is
`UNKNOWN`, visible in the ledger, and never retried — a second create would
leave a duplicate menu on the account. A publisher acknowledges it
(`acknowledgePossibleOutcome: true`) and may queue again; the orphan, if any,
is theirs to find by name in the LINE console. Uploading the image, setting
the default and setting an alias are idempotent, so an unconfirmed or 5xx
outcome returns the job to QUEUED with exponential backoff (capped at one
minute) and the persisted `externalRichMenuId` is reused — the create is
never repeated. A 4xx is FAILED with the id kept for cleanup. A lease that
expires mid-attempt is UNKNOWN for the same reason.

**Acceptance is acceptance.** On the provider's 2xx for the last stage the
version becomes PUBLISHED with its `richMenuId` and `publishedAt`, and the
menu's previously PUBLISHED version becomes RETIRED, in one transaction with
the audit row. Nothing claims the menu is visible to a user: LINE's acceptance
of the upload is what was observed, and that is what is recorded.

**One supervised script, two ticks.** `scripts/server-line-worker.mjs` now
ticks `POST /api/line-oa/worker` and then `POST /api/line-oa/rich-menu-worker`
with the same bearer, one bounded request each, so the deployment overlay
`docker-compose.line-server.yml` needs no new process. The rich menu route is
a separate handler so the conversation worker's contract and tests are
untouched.

## Delivered (local, 2026-09-06)

- `prisma/schema.prisma` + generated Postgres schema: `LineOaRichMenuJob`;
  migrations `prisma/migrations/20260906190000_line_oa_rich_menu_job` and
  `supabase/migrations/20260906190000_line_oa_rich_menu_job.sql` (forced RLS,
  private grants, **not applied**) in the same change.
- `src/platform/integrations/providers/line/server-line-rich-menu-transport.js`
  — the Integration lane's port.
- `src/modules/line-oa-studio/domain/line-oa-rich-menu-publish.js` — the LINE
  object translation through the action allow-list, stages, outcome rules.
- `src/modules/line-oa-studio/application/line-oa-rich-menu-jobs.js` — queue,
  list, acknowledge, and `runLineRichMenuWorker`.
- `application/server-line-rich-menu-runtime.js` — deployment composition.
- `GET/POST/PATCH /api/line-oa/rich-menus/[id]/jobs`,
  `POST /api/line-oa/rich-menu-worker`; the worker script's second tick.
- Snapshot coverage after the account, menu and version it references.
- Tests: `tests/integration/fr152-line-oa-rich-menu-jobs.test.js`
  (AC-152.1–.7), `tests/unit/platform/server-line-rich-menu-transport.test.js`,
  `tests/unit/line-oa-rich-menu-publish.test.js`,
  `tests/unit/line-oa-rich-menu-jobs-routes.test.js`.

## Not in this slice

A real LINE canary (needs FR-149's credential mount, `ZURI_LINE_SERVER_ENABLED`
and the worker process on production, plus an account with `serverEnabled`);
deleting a retired menu on LINE; linking a menu to one user; the designer
page; LIFF URL resolution; production application of the migration
(owner-instructed operator step, ADR-057).
