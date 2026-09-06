---
version: "0.1.0b"
created_at: "2026-09-06T13:00:16+07:00,RWANG,9cb60a763c7a450f456f54b813a7e6bba7853d6c"
last_update: "2026-09-06T13:00:16+07:00,RWANG"
status: candidate
superseded_by: null
attributes:
  domain: marketing
  doc_type: information-architecture-proposal
  scope: "Marketing sidebar, subdomain tabs, detail views and user journeys"
---

# Marketing — Navigation & Views

**Relates to:** [Marketing Domain Design](../CR-018-MARKETING-DOMAIN-DESIGN.md)

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Status** | Candidate; all new paths/tabs are proposed, not live routes |
| Parent | [Marketing Domain Design](../CR-018-MARKETING-DOMAIN-DESIGN.md) |

## 1. Navigation grammar

```text
Existing Business context → Marketing domain bar item
  → Sidebar capability
    → One tab bar for distinct workspaces of that capability
      → Selected record detail / drawer (replaces list; no second tab bar)
```

- **Subdomain:** งาน/record lifecycle ต่างกัน เช่น Paid Media กับ SEO
- **Tab:** context ต่างกันของ capability เดียวกัน เช่น Performance กับ Experiments
- **Filter:** dataset เดิมต่าง provider/account/date/status เช่น Meta/TikTok; ไม่ทำให้เกิด tab ใหม่
- **View toggle:** list/board/calendar เป็นการแสดง record ชุดเดียวกัน; ไม่สร้าง subdomain
- **Detail:** Campaign → Ad group/set → Ad เป็น entity drill-down/breadcrumb ไม่ใช่ nested tabs
- **Link/handoff:** ไป CRM, Commerce, PM, Files หรือ Integration; ไม่ clone หน้าของ owner มาอีกชุด

Default tab อยู่ใน URL เป็น `?tab=<key>`; record detail ใช้ route segment เช่น `/<id>`
ทุก page มี tab bar ได้ชั้นเดียว; detail ที่ต้องใช้ tabs แทน bar ของ collection และมี Back/breadcrumb
ถ้า detail สั้น ใช้ drawer/sections แทน tabs
Business context ตาม shell เดิม; date/account/property filters อยู่ใน shareable URL เมื่อไม่ใช่ข้อมูลอ่อนไหว
server resolve authority ใหม่ทุกครั้ง; URL ไม่ใช่ grant

## 2. Subdomain / tab matrix

ชื่อ tab อังกฤษเป็น draft UI labels; subtitle/help ใช้ภาษาไทยได้ ไม่ถือเป็น immutable IDs

| Sidebar / base path | Collection tabs (default first) | Detail / view เพิ่ม | ทำไมต้องเพิ่ม tab หรือไม่ต้อง |
|---|---|---|---|
| Dashboard `/growth` | **ไม่มี** | Drill-through KPI ไป owner view | สรุปหนึ่งหน้า ไม่ซ่อน health/decisions ใน tabs |
| Strategy & Planning `/growth/strategy` | Situation · Objectives · Plans · Scenarios | Plan detail: sections Brief, Assumptions, Budget, Evidence | ต่าง decision context แต่ใช้ Business เดียวกัน |
| Campaigns `/growth/campaigns` | **ไม่มี**; list/board toggle + status filter | `/<initiativeId>`: Brief · Plan · Timeline · Results · Decisions | Tab มีประโยชน์หลังเลือก business initiative; เลิกใช้ path นี้กับ Meta-only campaign |
| Paid Media `/growth/paid-media` | Performance · Campaigns · Creatives · Experiments | `/campaigns/<adCampaignId>` แสดง hierarchy, metrics, breakdown selector ใน sections | แยกผล/โครงสร้าง/creative effectiveness/การทดลอง; provider เป็น filter |
| Content & Creative `/growth/content` | Briefs · Production · Library | Production list/board toggle; asset detail มี versions/rights/review sections | Brief, work pipeline และ approved assets มี lifecycle ต่างกัน; ไม่ทำ tab ตามตำแหน่งคน |
| Social & Community `/growth/social` | Posts · Calendar · Insights · Handoffs | Account/channel filter; post detail มี draft/preview/receipt sections | Publishing order/time, performance และ CRM handoff เป็นงานต่างกัน |
| Creators & Partnerships `/growth/partners` | Partners · Programs · Deliverables · Performance | Type = Affiliate/Influencer filter; partner detail ใช้ sections | ใช้ common partner core; affiliate link/coupon และ influencer deliverable มี fields เฉพาะ |
| Live Marketing `/growth/live` | **ไม่มี**; list/calendar toggle | `/<liveId>`: Brief · Rundown · Readiness · Results | tab ที่ระดับ event จึงมีความหมาย; list ไม่ต้องหลาย tabs |
| Website & CRO `/growth/website` | Pages · Journeys · Experiments | Page/site filter; page detail มี design/evidence/handoff sections | Page inventory, journey hypothesis และ test decisions เป็นงานต่างกัน |
| SEO & Organic Search `/growth/seo` | Performance · Opportunities · Technical · Workplan | Property/page/query filters; technical issue detail มี evidence/history | Results, prioritized intent, technical findings และ committed work ต้องแยก |
| Analytics & Attribution `/growth/analytics` | Overview · Acquisition · Funnels · Attribution · Data Quality | Source/property filters; compare report revisions | ไม่ซ่อนนิยามและความน่าเชื่อถือของข้อมูลไว้หลังกราฟ |
| Marketing Operations `/growth/operations` | Intake · Calendar · Approvals · Handoffs | View filters owner/team/status; links ไป PM/Gate/CRM/Commerce | aggregate queues ที่มาจากเจ้าของเดิม; ไม่ใช่ task database ใหม่ |
| Team & Refinement `/growth/team` | Team · Runs · Reviews · Decisions · Learnings | `/runs/<runId>` ใช้ sections Brief, Steps, Evidence, Diff, Approval, Outcome | Whole-domain collaboration; run detail ไม่เพิ่ม tabs ซ้อนกับ Runs |

ทุก tab มี unique scoped URL, one primary purpose และ owner ของ records ที่ชัดเจน
Daily/Hourly, Age/Gender/Placement, Meta/TikTok/Instagram เป็น selectors ใน view เดียว
ไม่เพิ่ม tab bar ชั้นที่สอง; ให้ผู้ใช้เทียบช่องทางในตารางเดียวได้

### Sidebar grouping

```text
Marketing
  Dashboard
  Direction             [label, not clickable]
    Strategy & Planning
    Campaigns
  Channels & Creative
    Paid Media
    Content & Creative
    Social & Community
    Creators & Partnerships
    Live Marketing
  Website & Search
    Website & CRO
    SEO & Organic Search
  Measurement & Delivery
    Analytics & Attribution
    Marketing Operations
    Team & Refinement
```

13 entries คือ target capability map; rollout ตาม wave ใน parent ไม่ render 13 empty screens
group ไม่มี record, route, permission หรือ nested navigation เพิ่ม
Connections อยู่ Platform Integrations เดิม; Data Quality แสดง scoped health + deep link ตามสิทธิ์

## 3. Wireframes ของจุดที่ซับซ้อน

### Paid Media: platform เป็น filter ไม่ใช่ menu silo

```text
Business: SmartGift > Marketing > Paid Media
[Performance] [Campaigns] [Creatives] [Experiments]
[Provider: All / Meta / TikTok] [Accounts] [Date range] [Currency]
[Placement: All / Facebook / Instagram / provider-supported values]
Data coverage ...  Source updated ...  Attribution definition ...

Spend | Impressions | Clicks | CTR | CPC | Provider-reported outcomes
Comparison table by account/provider/campaign
Trend + [Daily / Hourly] selector where supported

Choose campaign → breadcrumb: Paid Media > Campaign > Ad Set/Group > Ad
                 content: details + metrics + evidence; no nested tab bars
```

Instagram filter applies to Meta placement where supported; TikTok rowsไม่มีค่า Instagram
ถ้าเลือก filters ขัดกันให้แสดง validation ไม่คืน empty chart ที่ชวนเข้าใจผิด

### SEO: measurement → evidence → work

```text
Marketing > SEO & Organic Search
[Performance] [Opportunities] [Technical] [Workplan]
[Search Console property] [Site/page] [Date] [Device/country]
Coverage and source quality

Performance: clicks/impressions/CTR/average position + query/page table
Opportunities: intent cluster → target page → proposed content brief
Technical: index evidence / canonical / robots / sitemap findings + evidence time
Workplan: prioritized PM WorkItems and owner/verification links
```

ไม่เรียก average position ว่า guaranteed rank; external observation ไม่เท่ากับ issue verified fixed
SEO Workplan และ Operations Calendar เป็น projection ของ PM IDs เดียวกัน

### Team & Refinement: reviewer เห็นการเปลี่ยนก่อนอนุมัติ

```text
Marketing > Team & Refinement > Run MKR-...
Back to Runs | State: HUMAN_REVIEW | Round 2 of 3 | Remaining budget/time
Brief: objective / constraints / source window / named human owner
Team: coordinator, analysts, channel/content specialists, independent reviewer
Steps: claimed / running / waiting / failed / complete + receipt timestamps
Evidence: source snapshots, scope, confidence, missing data

v1 → v2 comparison
  Changed: budget proposal, channel mix, claims, creative brief, KPI plan
  Why: reviewer finding + source reference
  Outstanding: disagreements / required dependency / unsupported capability
[Approve this version] [Request changes] [Reject] [Pause / Cancel]
Outcome: approved plan receipt / manual delivery receipt / measurement / learning
```

Team tab แสดงสมาชิก/บทบาท/availability ไม่อ้างว่าสมาชิกกำลังทำงานจนมี run step จริง
ไม่แสดง hidden chain-of-thought; แสดง concise rationale, evidence, outputs และ review findings

## 4. Journeys ที่ต้องต่อกันได้จริง

1. **CMO:** Dashboard anomaly → Analytics evidence → Strategy scenario → team refinement → human-approved Campaign plan → PM execution → Results → next refinement
2. **Paid specialist:** Paid Media filters Meta+TikTok → compare comparable definitions → creative fatigue hypothesis → experiment brief → reviewer → human decision; ไม่มี auto-spend
3. **Instagram/content team:** Content Brief → Production → approved version → Social calendar → manual/provider receipt → organic Insights; paid boost ผูก Paid Media record อย่าง explicit
4. **SEO specialist:** Search Console opportunity + GA4 landing report → SEO brief → Content หรือ website fix handoff → verify source evidence after observation window → measure → learning
5. **Affiliate/Influencer + Live:** Program brief → partner/rights + Live readiness → approved deliverables → live/manual outcome evidence → attributed results ที่ตรวจ source ได้
6. **MDT:** Campaign blocker → Operations handoff → Commerce stock/offer owner หรือ CRM support owner → owner receipt → campaign status update; ไม่แก้ stock จาก Marketing

## 5. State / accessibility / permission acceptance

- Reload, browser Back และ copied URL คืน selected tab/filter/record ได้โดยยังเช็คสิทธิ์
- Business switch clears incompatible account/property/record IDs; no stale data flash จาก Business ก่อนหน้า
- Tab role/selected state, keyboard arrows, focus after navigation และ mobile horizontal overflow ผ่าน accessibility checks
- Loading, empty, partial, stale, failed, unavailable, forbidden เป็น state ต่างกัน; `0` ใช้เมื่อวัดได้ศูนย์จริง
- ยังไม่เชื่อม source: show setup requirement กับ owner link; ขาด grant: ไม่เผย names/counts ของทรัพยากรที่อ่านไม่ได้
- Plan/task/calendar/library ที่ปรากฏหลาย view มี record UUID/version เดียวกัน; edit ผ่าน owner service เดียว
- Data Quality เห็น source health ไม่ได้ให้สิทธิ์แก้ secret; Reviews เห็น draft ไม่ได้ให้สิทธิ์อนุมัติ spend
- Marketing Dashboard ไม่มี local tab bar; Campaigns/Live collection ไม่มีแท็บเกินจำเป็นตาม matrix

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Define 11 subdomain entries plus two shared surfaces, exact tab placement, filters, wireframes and journeys | See git history | RWANG |
