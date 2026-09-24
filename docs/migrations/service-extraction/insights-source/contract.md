# Contract: Insights Dashboard Module

## 1. Purpose

Implement an "Insights" module for the internal Ads Dashboard (Next.js + TypeScript + Supabase) that replicates the core reporting patterns of Meta Business Suite's Insights section (Overview / Results / Content tabs) for our own connected Pages and ad accounts (INFRESH, Glowcea, 056 Laos). The goal is a single place to see performance trends, drill into individual metrics, and see which content/format is driving results — without leaving our dashboard to check Meta Business Suite.

This contract defines scope, data model, API surface, and UI behavior. It does not cover ad creation/editing — read-only reporting only.

## 2. Scope

**In scope:**
- Page/asset selector + date range picker (default: last 28 days), shared across all sub-views
- Overview view: compact multi-metric summary cards with sparkline trends
- Results view: full-size per-metric trend charts with CSV export
- Content view: content-type filter (All/Post/Story/Reel/Live), organic-vs-paid breakdown, top-content-by-views leaderboard, top-content-by-format breakdown
- Scheduled sync of insights data from Meta Graph API into Supabase (via n8n, per existing automation pattern)
- Multi-brand support (INFRESH, Glowcea, 056 Laos) via a brand/asset selector

**Out of scope (this contract):**
- Editing, boosting, or publishing content from this module (link out to Meta Business Suite / Ads Manager instead)
- Messaging/Inbox, Benchmarking, Earnings, Monetization tabs
- Audience demographic breakdowns (may be a follow-up contract)

## 3. Data Sources

Pulled via Meta Graph API (Page + Post + Ad Insights endpoints), using the existing app credentials already used for the Meta Ads API integration.

| Metric | Graph API field / endpoint |
|---|---|
| Views (page/post impressions) | `page_impressions_unique`, `post_impressions` |
| Viewers (reach) | `page_impressions_unique` (unique) |
| Content interactions | `page_post_engagements` |
| 3-second video views | `page_video_views` |
| Watch time | `page_video_view_time` |
| Visits | `page_views_total` |
| Follows / Unfollows / Net follows | `page_fan_adds`, `page_fan_removes` |
| Link clicks | `page_consumptions_by_consumption_type` (link clicks) |
| Per-post breakdown (organic vs. paid) | `insights` edge on each `Post` object, `is_organic` derived from `distribution_type` |
| Content format | derived from post `attachments.media_type` (photo/video/link/text) |

All calls go through the existing `Meta_Ads_MCP` / Graph API service layer — do not add a second Meta API client.

## 4. Data Model (Supabase / Postgres)

```sql
-- One row per brand/page per day per metric
create table insights_daily (
  id bigint generated always as identity primary key,
  brand_id text not null,          -- 'infresh' | 'glowcea' | '056laos'
  page_id text not null,
  metric_date date not null,
  metric_key text not null,        -- 'views' | 'viewers' | 'interactions' | 'visits' | 'follows' | 'unfollows' | 'link_clicks' | 'watch_time' | 'three_sec_views'
  organic_value numeric default 0,
  paid_value numeric default 0,
  unique (brand_id, page_id, metric_date, metric_key)
);

-- One row per published post, refreshed on sync
create table content_performance (
  id bigint generated always as identity primary key,
  brand_id text not null,
  page_id text not null,
  post_id text not null unique,
  content_type text not null,      -- 'post' | 'story' | 'reel' | 'live'
  format text not null,            -- 'photo' | 'video' | 'text' | 'link'
  is_organic boolean not null default true,
  published_at timestamptz not null,
  permalink text,
  views bigint default 0,
  interactions bigint default 0,
  reactions bigint default 0,
  comments bigint default 0,
  shares bigint default 0,
  last_synced_at timestamptz not null default now()
);

create index on insights_daily (brand_id, metric_date);
create index on content_performance (brand_id, published_at desc);
```

## 5. Sync Job (n8n)

- Cron: daily at 02:00 Asia/Bangkok, plus an on-demand "refresh now" trigger from the dashboard.
- Steps: for each connected page → pull last 28 days of `insights_daily` rows (upsert) → pull posts published in that window → upsert `content_performance`.
- Failure handling: on API error, retry once after 5 min, then send a LINE alert (existing LINE Notify integration) naming the brand and error.
- Rate limits: batch requests per Graph API batching rules; do not exceed 200 calls/hour/app as currently configured elsewhere in the project.

## 6. API Contract (internal, Next.js route handlers)

```
GET /api/insights/summary?brand=infresh&from=2026-08-26&to=2026-09-22
  -> { metricKey: string, total: number, changePct: number, series: {date, value}[] }[]

GET /api/insights/metric/:metricKey?brand=infresh&from=...&to=...
  -> { date: string, organic: number, paid: number }[]   // for Results view full chart

GET /api/insights/metric/:metricKey/export?brand=infresh&from=...&to=...
  -> text/csv download

GET /api/insights/content?brand=infresh&from=...&to=...&type=all|post|story|reel|live
  -> {
       summary: { views, threeSecViews, interactions, watchTime, organicViews, paidViews },
       topContent: { postId, permalink, thumbnailUrl, publishedAt, views, reactions, comments, shares }[],
       byFormat: { metric: 'published'|'views'|'interactions', breakdown: {label, value}[] }[]
     }
```

All endpoints read from Supabase only (never call Graph API directly on request) to keep the dashboard fast and within rate limits.

## 7. UI / Component Breakdown

**Shared shell** (`<InsightsLayout>`): brand selector, date-range picker, tab bar (Overview / Results / Content), persists selection in URL query params.

**Overview tab** (`<InsightsOverview>`):
- Grid of `<MetricCard>` components (Views, Follows, Visits, Interactions, Video, Conversions placeholder) — each shows total, % of period, and a `<Sparkline>`.
- Each card links to the corresponding Results metric.

**Results tab** (`<InsightsResults>`):
- One `<MetricChart>` per metric, full width, with an "Export CSV" button per chart calling the `/export` endpoint.

**Content tab** (`<InsightsContent>`):
- `<ContentTypeFilter>` (All/Post/Story/Reel/Live) — client-side filter or query param, re-fetches summary + list.
- `<OrganicPaidChart>` stacked/dual-line chart for Views over time.
- `<TopContentList>` — ranked table/cards: thumbnail, published date, views, reactions, comments, shares; "View on Facebook" link (no boost/edit action in this contract).
- `<FormatBreakdown>` — three small comparison panels (Published / Views / Interactions by format), each showing % change vs. prior period.

Use the existing dataviz conventions (chart colors, palette, tooltip/legend style) already established in the ads dashboard rather than introducing a new chart library.

## 8. Non-Functional Requirements

- Dashboard pages must render from cached Supabase data in under 500ms server response time (no live Graph API calls in the request path).
- Date range changes should refetch via the same endpoints with new `from`/`to` params, not a full page reload.
- All monetary/metric values formatted per existing dashboard locale conventions (Thai market, Buddhist calendar not required — Gregorian dates with Thai number formatting where applicable).
- Multi-brand isolation: no query may return data across brands unless `brand` param explicitly requests it (guard in API layer, not just UI).

## 9. Acceptance Criteria

- [ ] Overview, Results, and Content tabs render for all three brands with real synced data
- [ ] Date range picker updates all three views correctly
- [ ] CSV export produces a valid file matching the displayed chart's values
- [ ] Content type filter correctly narrows `topContent` and `byFormat` results
- [ ] Sync job runs on schedule and on manual trigger; failures alert via LINE
- [ ] No direct Graph API calls originate from dashboard page requests (verified via network/log audit)
- [ ] Cross-brand data isolation verified with a test covering all three brand IDs

## 10. Open Questions (for Dev + stakeholder before build starts)

1. Should "Conversions" (orders/leads/appointments) be wired to our own attribution data or left as a placeholder until a later contract?
2. Do we need per-brand custom date-range presets (e.g., campaign-aligned periods) beyond the standard 7/28/90-day options?
3. Should the "Boost content" action from Meta Business Suite be replicated here, or intentionally excluded to keep this module read-only (current assumption: excluded)?
