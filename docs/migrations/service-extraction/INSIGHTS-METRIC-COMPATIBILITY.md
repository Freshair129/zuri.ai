---
id: ZAI:MARKETING-INSIGHTS-METRIC-COMPATIBILITY
version: "0.1.0"
status: candidate
last_update: "2026-09-24T13:00:00+07:00,Claude"
attributes:
  domain: marketing
  scope: marketing-insights-metric-compatibility
relations:
  - type: relates_to
    target: ZAI:DOMAIN-INTEGRATION
---

# Marketing Insights: metric compatibility matrix (S6)

**Verification date:** 2026-09-24. **Pinned API version:** *none*. No Meta client
exists in this repository, so no version has been chosen or called.
**Account evidence:** *none*. No authorized account, token or asset was used, and none may be.

The Meta sources below were read as public documentation only:

- EXT-3 "Deprecated Metrics — Facebook Pages API" (readable; used for the
  `Meta status` column).
- The Page Insights reference page (`/docs/graph-api/reference/page/insights/`).
  Its header showed **v26.0**, but the metric table renders client-side and could
  not be extracted. Current field definitions, periods and units are therefore
  **UNVERIFIED** and are not guessed.
- The Pages Insights overview page (`/docs/platforminsights/page/`), which names
  `pages_read_engagement` and `read_insights` as required permissions. The
  permission set actually granted to an app is **UNVERIFIED**.

Rule: **unsupported ≠ 0**. A metric the provider cannot supply is stored with
quality `UNSUPPORTED` and shown as unavailable.

## Page daily metrics (contract §3 → `insights_daily.metric_key`)

| metricKey | Contract field | Meta status on EXT-3 (2026-09-24) | Replacement named by Meta | Entity | Unit | Aggregation (D-04) | Organic/paid | Code status |
|---|---|---|---|---|---|---|---|---|
| views | `page_impressions_unique`, `post_impressions` | **Deprecated**: `page_impressions_unique` 2025-06-15; `post_impressions` 2025-11-15 (`page_impressions` also 2025-11-15) | `page_total_media_view_unique` (for the unique field); `post_media_view` / `page_media_view` (for impressions) | Page (+ post rollup in contract) | count | ADDITIVE per day | via `is_from_ads` breakdown (named for `page_impressions_paid` → `page_media_view`); UNVERIFIED | `CONTRACT_FIELD_DEPRECATED` |
| viewers | `page_impressions_unique` | **Deprecated** 2025-06-15 | `page_total_media_view_unique` | Page | people | NON_ADDITIVE_UNIQUE; window total needs an exact-window provider aggregate | organic + paid unique never added | `CONTRACT_FIELD_DEPRECATED` |
| interactions | `page_post_engagements` | not listed | — | Page | count | ADDITIVE | UNVERIFIED | `UNVERIFIED` |
| three_sec_views | `page_video_views` | not listed | — | Page | count | ADDITIVE | UNVERIFIED | `UNVERIFIED` |
| watch_time | `page_video_view_time` | not listed | — | Page | **unit UNVERIFIED** (each row stores its raw unit; mixed units refused) | ADDITIVE | UNVERIFIED | `UNVERIFIED` |
| visits | `page_views_total` | not listed | — | Page | count | ADDITIVE | not modelled | `UNVERIFIED` |
| follows | `page_fan_adds` | **Deprecated** 2025-11-15 | **none named** | Page | count | ADDITIVE | not modelled | `CONTRACT_FIELD_DEPRECATED` |
| unfollows | `page_fan_removes` | **Deprecated** 2025-11-15 | **none named** | Page | count | ADDITIVE | not modelled | `CONTRACT_FIELD_DEPRECATED` |
| net_follows | derived: follows − unfollows | inputs deprecated | — | Page | count | per-day difference, only when both observed; never stored | — | derived |
| link_clicks | `page_consumptions_by_consumption_type` (link clicks) | not listed | — | Page | count | ADDITIVE | not modelled | `UNVERIFIED` |
| conversions | — (contract §10 Q1) | — | — | — | — | — | — | placeholder `CONVERSIONS_NOT_CONNECTED`; never filled from Commerce |

## Post / content metrics (contract §3 per-post insights edge)

| Response field (§6) | Stored in contract §4? | Source | Status |
|---|---|---|---|
| views | yes (`views`) | `post_impressions` (**deprecated** 2025-11-15 → `post_media_view`) | UNVERIFIED replacement |
| interactions / reactions / comments / shares | yes | per-post insights / object fields | UNVERIFIED |
| threeSecViews, watchTime | **no** | per-post video insights | R-06; unavailable until stored |
| organicViews, paidViews | **no** (only `is_organic`) | distribution breakdown | R-05 / R-06 |
| thumbnailUrl | **no** | attachment media | R-06; allow-listed https only, never fetched by server |
| content_type (post/story/reel/live) | yes | provider object type | mapping UNVERIFIED; unknown kept as `unknown` |
| format (photo/video/text/link) | yes | `attachments.media_type` | mapping UNVERIFIED; unknown kept as `unknown` |

## Ad account metrics

Out of this tranche. The contract purpose includes ad accounts (R-08), but it names
no Ad Insights fields. The approved [Marketing channel contract](../../change-requests/marketing/MARKETING-CHANNEL-CONTRACTS.md)
routes Meta Ads to Paid Media (Marketing API hierarchy). Status: **OPEN SCOPE**, with no fields verified.

## What unblocks `METRIC_MAPPING_VERIFIED`

The Integration owner needs to supply: a pinned Graph API version; the replacement
field chosen for each deprecated metric; for each field, its period, unit and
permission, verified against one authorized test Page; and a sanitized
response-shape fixture (synthetic ids) committed as contract evidence. Until then
this matrix stays **UNVERIFIED** except for the deprecation facts above.
