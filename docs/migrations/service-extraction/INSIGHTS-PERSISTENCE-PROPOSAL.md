---
id: ZAI:MARKETING-INSIGHTS-PERSISTENCE-PROPOSAL
version: "0.1.0"
status: candidate
last_update: "2026-09-24T14:20:00+07:00,Claude"
attributes:
  domain: marketing
  scope: marketing-insights-persistence-proposal
relations:
  - type: relates_to
    target: ZAI:DOMAIN-INTEGRATION
---

# Marketing Insights: persistence proposal (S6, for migration review)

**This is a proposal, not a migration.** Nothing here is in `schema.prisma` or
`supabase/migrations/`. Those are shared files, so the migration owner (the
integrator) decides whether to apply it and how to order it (handoff blocker B2).
The design keeps the responsibilities of the contract's `insights_daily` and
`content_performance` tables (§4) and resolves reconciliation rows R-04, R-05,
R-06, R-08, R-09, R-13 and R-14.

## Principles

- Keys are internal UUIDs plus a human `code` where users see the record. Provider
  ids go in namespaced columns, and `ExternalEntityRef` does the mapping (BR-002, R-14).
- Every table carries `tenantId` + `businessId`, taken from the server-owned binding,
  never from the client (SEC-001).
- Values are nullable, and every value carries `quality`. Unknown is never stored as 0 (R-09).
- Corrections are new revisions of the same grain. Nothing is overwritten in place
  and nothing outside the recurring window is ever deleted (master prompt §8).
- There is exactly one writer: the Marketing projection service run by the sync job.
  Routes, n8n nodes and agents never upsert directly (master prompt §4).
- Raw provider payloads and sync receipts stay in Integration's existing tables
  (`IngestionRun`, `RawExternalRecord`, `SyncCursor`, `DeadLetterRecord`). Marketing
  stores only the projected metrics and references the raw record by id.

## Tables (Marketing-owned; to be added to the Marketing charter `owns_models`)

### `MarketingInsightAssetBinding`: authorized asset binding (R-03, R-08)

| column | type | note |
|---|---|---|
| id | uuid pk | = `bindingId` in the port |
| tenantId, businessId | uuid, fk Business | the Business the brand belongs to (confirmed by the owner, B6) |
| brandSlug | text | `infresh` / `glowcea` / `056laos`; a selector alias, not a grant |
| assetKind | text enum `PAGE`/`AD_ACCOUNT` | enums.js source of truth |
| namespace | text `meta.page`/`meta.ad_account` | must agree with assetKind (CHECK) |
| externalRefId | uuid fk ExternalEntityRef | the provider id lives there, not here |
| connectionId | uuid fk IntegrationConnection | whose credential reads it; parent is checked on every sync |
| displayName | text | |
| status | text enum `ACTIVE`/`REVOKED`/`UNRESOLVED_SCOPE` | a shared agency account with no partition → `UNRESOLVED_SCOPE` |
| revision | int | |
| unique | (tenantId, namespace, externalRefId) | |

### `MarketingInsightObservation`: metric observation (replaces the `insights_daily` rows)

| column | type | note |
|---|---|---|
| id | uuid pk | |
| tenantId, businessId, bindingId | uuid | scope |
| metricKey | text | one of the catalog's stored keys; `net_follows` is never stored |
| metricDefinitionVersion | text | ties the row to the catalog revision it was projected under |
| periodKind | text `DAY`/`WINDOW` | `WINDOW` rows are provider aggregates for exact windows (unique metrics) |
| periodStart, periodEnd | date | Asia/Bangkok calendar dates, inclusive; `DAY` rows have start = end |
| distribution | text `ALL`/`ORGANIC`/`PAID` | the full dimension tuple (R-05) |
| value | numeric(20,4) null | read as a string, then range-checked into a JS number at the port; a value past 2^53 fails loudly instead of being rounded |
| unit | text | the raw unit as the provider states it (watch time: verified at I5) |
| quality | text enum | OBSERVED / NOT_SYNCED / UNSUPPORTED / PERMISSION_DENIED / PROVIDER_ERROR / PRECISION_UNSAFE |
| revision | bigint | monotonic per binding (from the snapshot sequence below) |
| rawRecordId | uuid fk RawExternalRecord null | lineage |
| fetchedAt | timestamptz | |
| unique | (bindingId, metricKey, periodKind, periodStart, periodEnd, distribution, revision) | the natural grain plus the revision |

### `MarketingInsightContentItem` + `MarketingInsightContentMeasurement` (replaces `content_performance`, R-04/R-06)

- Item: `id`, scope, `bindingId`, `externalRefId` (the post), `contentType` (`post/story/reel/live/unknown`),
  `format` (`photo/video/text/link/unknown`), `publishedAt`, `permalink` (checked against the allow-list on write),
  `thumbnailRef` (an allow-listed URL or a Files reference; never fetched by the server), `revision`.
- Measurement: `itemId`, `field` (`views`, `threeSecViews`, `interactions`, `reactions`, `comments`, `shares`,
  `watchTime`, `organicViews`, `paidViews`), `metricPeriod` (`LIFETIME_AS_OF_SYNC` now, with room for a
  reviewed per-period kind later), `value numeric null`, `unit`, `quality`, `revision`, `rawRecordId`, `fetchedAt`.

### `MarketingInsightSnapshot`: published report snapshot (R-13)

| column | type | note |
|---|---|---|
| id | uuid pk | = `snapshotId` |
| tenantId, businessId, bindingId | uuid | |
| revisionCeiling | bigint | the reader takes, for each grain, the highest revision ≤ ceiling |
| coveredUntil | date null | last fully committed day |
| state | text `COMPLETE`/`PARTIAL`/`NOT_SYNCED` | |
| partialReason | text null | a sanitized code, no provider text |
| ingestionRunId | uuid fk IngestionRun | the Integration run that produced it |
| generatedAt | timestamptz | |
| expiresAt | timestamptz | after this, `?snapshot=` returns 409 `SNAPSHOT_EXPIRED` |

**Consistent read:** the writer inserts new-revision rows, then inserts the snapshot
row with `revisionCeiling` = its highest revision, in one transaction. Readers
without `?snapshot=` use the latest `COMPLETE` snapshot, or the latest `PARTIAL`
one flagged as partial. Readers with `?snapshot=` use exactly that ceiling. A sync
running concurrently cannot change what a chart or its CSV sees. A failed or partial
sync never replaces the last good snapshot as "latest complete".

## Sync receipts (Integration-owned; no new Marketing table)

`syncRunId` = `IngestionRun.id`. The n8n execution id and the provider report-job id
are stored on the run as separate columns, each under its own name, so the three
are never treated as one "run". If `IngestionRun` lacks lease, fence, attempt or
window columns, the Integration owner proposes them. Marketing does not fork a
second run table.

## RLS and roles (EXT-2)

- Enable RLS on every table above. Browser roles (`anon`, `authenticated`) get no
  direct grant, because the app reads through the server with its own authority
  check. If a Supabase-exposed path is ever wanted, policies must key on the same
  Business membership resolved by Identity and be tested with the real roles, not
  `service_role`.
- The writer role may insert only, and only rows whose `bindingId` → `connectionId`
  parent matches the run's connection. It has no update/delete on observations.
- Follow the grant pattern of the most recent table-creating migrations under
  `apps/server/supabase/migrations/`, and remember that `public` has default-ACL
  rows from two grantors, of which a migration can clean only its own.

## Tests this proposal requires before it can be called verified

A disposable Postgres (not SQLite) running: same-grain replay idempotency;
correction without double count; partial partition not replacing the last good
snapshot; schedule/manual collision coalescing; stale callback after lease expiry;
snapshot-pinned export during a concurrent sync; revoked grant after snapshot
creation; RLS with `anon`/`authenticated`; writer-role limits.
