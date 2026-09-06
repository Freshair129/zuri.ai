---
version: "0.1.0b"
created_at: "2026-09-06T13:16:52+07:00,RWANG,03e3940"
last_update: "2026-09-06T13:16:52+07:00,RWANG"
status: candidate
superseded_by: null
attributes:
  domain: marketing
  doc_type: candidate-interface-inventory
  scope: "All Marketing prototype pages, tabs, records, forms, decisions and shared states"
---

# Marketing — Interface Inventory & Mockup Coverage

**Relates to:** [Domain Design](../CR-018-MARKETING-DOMAIN-DESIGN.md), [Navigation](MARKETING-NAVIGATION-VIEWS.md), [Channels](MARKETING-CHANNEL-CONTRACTS.md), [Team refinement](MARKETING-TEAM-REFINEMENT.md)

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Status** | Candidate design; none of these new interfaces is claimed implemented |
| Total mockup interfaces | 100 |
| Shell | Existing BusinessShell → Marketing; separate design-review toolbar outside product UI |
| Source | mockups/catalog.js; this candidate inventory and JSON export are generated with node mockups/build.js |
| Prototype | [Open all screens](mockups/index.html) |
| Machine inventory | [inventory.json](mockups/inventory.json) |

## 1. Counting and scope

“ทุกหน้า” = all pages/tabs in Navigation v0.1.0b, the record interfaces those pages open,
creation forms for documented briefs/experiments/intake/runs, team decision dialogs and ten shared state previews.
Different tabs have separate screen IDs; provider/date filters are not counted as separate pages.
Shared states are reusable presentations, not 10 extra production routes or a claim to render the entire screen × state Cartesian product.
Cross-domain CRM/Commerce/PM/Integration pages remain owned by their existing inventories; the mockup demonstrates the handoff, not cloned destination apps.

MKT-UI-### is a local design anchor, not a new global FR/FEAT/SDD/ADR or a shipped route.
Routes containing brackets are candidate production shapes; the static prototype uses the screen ID in its URL hash.
Fixture titles, names, metrics, accounts, receipts and outcomes are fictional design data, visibly labeled throughout.
External actions are simulated locally and never call a provider. No application source/schema/API is changed.

| Interface kind | Count |
|---|---:|
| page | 3 |
| tab | 40 |
| detail-tab | 9 |
| detail | 22 |
| form | 9 |
| dialog | 7 |
| state | 10 |

## 2. Common behavior and access

- Every read: trusted session, authorized Business and growth visibility; per-account/property/evidence access before reading.
- Every write: owner-resolved target capability, exact Business and version; Team membership grants nothing.
- Review, approve, external action and GKS promotion are distinct capabilities; exact version/target/ceiling is visible before confirmation.
- On Business switch clear incompatible record/account/property and drafts; prototype uses isolated fictional fixtures, never production records.
- Loading/empty/partial/stale/error/forbidden/unavailable/conflict/blocked/unknown differ visibly; unavailable is not zero.
- Production would persist through owner services; prototype drafts/decisions use sessionStorage for demonstration only; no server record is created.
- Global review selector and previous/next let the reviewer inspect every ID, including forms and shared-state previews.
- Each primary action either opens its named prototype target, updates local presentation state, or shows a clearly labeled owner handoff.

## 3. Full screen registry

Each row links to its mockup and screenshot. Screenshot files are produced by the documented verification run,
not screenshots of a working production feature.

### Dashboard

| ID / mockup | Interface / kind | Candidate route | Purpose / primary action | Source / owner | States | Screenshot |
|---|---|---|---|---|---|---|
| [MKT-UI-001](mockups/index.html#MKT-UI-001) | Marketing dashboard · page | `/growth` | ภาพรวมแผนการตลาด ผลลัพธ์ และสิ่งที่ทีมต้องตัดสินใจวันนี้; Review decisions | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-001.jpg) |
| [MKT-UI-091](mockups/index.html#MKT-UI-091) | Loading source data · state | `/growth?previewState=loading` | Reusable loading state with scope-safe content and an explicit next action; Return to dashboard | Marketing projection + scoped owner references / Marketing | loading | [View](mockups/screenshots/MKT-UI-091.jpg) |
| [MKT-UI-092](mockups/index.html#MKT-UI-092) | No marketing data yet · state | `/growth?previewState=empty` | Reusable empty state with scope-safe content and an explicit next action; Return to dashboard | Marketing projection + scoped owner references / Marketing | empty | [View](mockups/screenshots/MKT-UI-092.jpg) |
| [MKT-UI-093](mockups/index.html#MKT-UI-093) | Some source partitions are missing · state | `/growth?previewState=partial` | Reusable partial state with scope-safe content and an explicit next action; Return to dashboard | Marketing projection + scoped owner references / Marketing | partial | [View](mockups/screenshots/MKT-UI-093.jpg) |
| [MKT-UI-094](mockups/index.html#MKT-UI-094) | Source data is out of date · state | `/growth?previewState=stale` | Reusable stale state with scope-safe content and an explicit next action; Return to dashboard | Marketing projection + scoped owner references / Marketing | stale | [View](mockups/screenshots/MKT-UI-094.jpg) |
| [MKT-UI-095](mockups/index.html#MKT-UI-095) | Acquisition failed · state | `/growth?previewState=error` | Reusable error state with scope-safe content and an explicit next action; Return to dashboard | Marketing projection + scoped owner references / Marketing | error | [View](mockups/screenshots/MKT-UI-095.jpg) |
| [MKT-UI-096](mockups/index.html#MKT-UI-096) | You do not have access · state | `/growth?previewState=forbidden` | Reusable forbidden state with scope-safe content and an explicit next action; Return to dashboard | Marketing projection + scoped owner references / Marketing | forbidden | [View](mockups/screenshots/MKT-UI-096.jpg) |
| [MKT-UI-097](mockups/index.html#MKT-UI-097) | Capability is unavailable · state | `/growth?previewState=unavailable` | Reusable unavailable state with scope-safe content and an explicit next action; Return to dashboard | Marketing projection + scoped owner references / Marketing | unavailable | [View](mockups/screenshots/MKT-UI-097.jpg) |
| [MKT-UI-098](mockups/index.html#MKT-UI-098) | This version has changed · state | `/growth?previewState=conflict` | Reusable conflict state with scope-safe content and an explicit next action; Return to dashboard | Marketing projection + scoped owner references / Marketing | conflict | [View](mockups/screenshots/MKT-UI-098.jpg) |
| [MKT-UI-099](mockups/index.html#MKT-UI-099) | Required dependency is unavailable · state | `/growth?previewState=blocked` | Reusable blocked state with scope-safe content and an explicit next action; Return to dashboard | Marketing projection + scoped owner references / Marketing | blocked | [View](mockups/screenshots/MKT-UI-099.jpg) |
| [MKT-UI-100](mockups/index.html#MKT-UI-100) | External outcome is unknown · state | `/growth?previewState=unknown` | Reusable unknown state with scope-safe content and an explicit next action; Return to dashboard | Marketing projection + scoped owner references / Marketing | unknown | [View](mockups/screenshots/MKT-UI-100.jpg) |

### Strategy & Planning

| ID / mockup | Interface / kind | Candidate route | Purpose / primary action | Source / owner | States | Screenshot |
|---|---|---|---|---|---|---|
| [MKT-UI-002](mockups/index.html#MKT-UI-002) | Situation & opportunity · tab | `/growth/strategy?tab=situation` | เริ่มจากหลักฐานที่เรารู้ และแยกสิ่งที่ยังเป็นสมมติฐาน; Start refinement | Analytics snapshots + Market Intelligence + approved brand facts / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-002.jpg) |
| [MKT-UI-003](mockups/index.html#MKT-UI-003) | Objectives & success measures · tab | `/growth/strategy?tab=objectives` | เชื่อมเป้าหมาย Marketing กับ BusinessGoal และหลักฐานการวัดผล; Add objective | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-003.jpg) |
| [MKT-UI-004](mockups/index.html#MKT-UI-004) | Marketing plans · tab | `/growth/strategy?tab=plans` | แผนที่มีเป้าหมาย งบ ขอบเขต และเวอร์ชันตรวจสอบได้; New plan | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-004.jpg) |
| [MKT-UI-005](mockups/index.html#MKT-UI-005) | Budget scenarios · tab | `/growth/strategy?tab=scenarios` | เปรียบเทียบข้อเสนอการจัดสรรงบก่อนตัดสินใจ ไม่ใช่การใช้งบจริง; Send for review | Marketing scenario assumptions + comparable source evidence / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-005.jpg) |
| [MKT-UI-053](mockups/index.html#MKT-UI-053) | September growth plan · v2 · detail | `/growth/strategy/plans/[planId]` | Approved objective references, assumptions, channel allocation and evidence; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-053.jpg) |
| [MKT-UI-075](mockups/index.html#MKT-UI-075) | New marketing plan · form | `/growth/strategy/new` | Objective, evidence window and proposed channel mix; Save draft & preview | Marketing projection + scoped owner references / Marketing | draft, invalid, ready, conflict, saved | [View](mockups/screenshots/MKT-UI-075.jpg) |

### Campaigns

| ID / mockup | Interface / kind | Candidate route | Purpose / primary action | Source / owner | States | Screenshot |
|---|---|---|---|---|---|---|
| [MKT-UI-006](mockups/index.html#MKT-UI-006) | All campaigns · page | `/growth/campaigns` | หนึ่ง initiative เชื่อมทุกช่องทาง โดยงานดำเนินการอยู่ใน Project Manager; New campaign | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-006.jpg) |
| [MKT-UI-007](mockups/index.html#MKT-UI-007) | Campaign brief · detail-tab | `/growth/campaigns/[initiativeId]?tab=brief` | เป้าหมาย กลุ่มเป้าหมาย ข้อเสนอ และเงื่อนไขของ Autumn Gift Edit; Open refinement | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-007.jpg) |
| [MKT-UI-008](mockups/index.html#MKT-UI-008) | Campaign execution plan · detail-tab | `/growth/campaigns/[initiativeId]?tab=plan` | งานแต่ละช่องทางใช้ WorkItem เดียวกับ PM; Open refinement | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-008.jpg) |
| [MKT-UI-009](mockups/index.html#MKT-UI-009) | Campaign timeline · detail-tab | `/growth/campaigns/[initiativeId]?tab=timeline` | มอง dependencies และกำหนดส่งก่อนเปิดแคมเปญ; Open refinement | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-009.jpg) |
| [MKT-UI-010](mockups/index.html#MKT-UI-010) | Campaign results · detail-tab | `/growth/campaigns/[initiativeId]?tab=results` | ผลลัพธ์ตาม source และ measurement window ที่อนุมัติ; Open refinement | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-010.jpg) |
| [MKT-UI-011](mockups/index.html#MKT-UI-011) | Campaign decisions · detail-tab | `/growth/campaigns/[initiativeId]?tab=decisions` | บันทึกการตัดสินใจพร้อมเวอร์ชัน ผู้อนุมัติ และเหตุผล; Open refinement | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-011.jpg) |
| [MKT-UI-076](mockups/index.html#MKT-UI-076) | New campaign brief · form | `/growth/campaigns/new` | Create a business initiative before provider campaigns; Save draft & preview | Marketing projection + scoped owner references / Marketing | draft, invalid, ready, conflict, saved | [View](mockups/screenshots/MKT-UI-076.jpg) |

### Paid Media

| ID / mockup | Interface / kind | Candidate route | Purpose / primary action | Source / owner | States | Screenshot |
|---|---|---|---|---|---|---|
| [MKT-UI-012](mockups/index.html#MKT-UI-012) | Paid media performance · tab | `/growth/paid-media?tab=performance` | เทียบ Meta และ TikTok ด้วยนิยามตัวเลขที่เข้ากันได้; Inspect campaign | Meta/TikTok translated ad facts via Integration / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-012.jpg) |
| [MKT-UI-013](mockups/index.html#MKT-UI-013) | Ad campaigns · tab | `/growth/paid-media?tab=campaigns` | Campaign ของ provider แยกจาก business initiative; Inspect record / filter view | Meta campaign / TikTok campaign mappings / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-013.jpg) |
| [MKT-UI-014](mockups/index.html#MKT-UI-014) | Creative effectiveness · tab | `/growth/paid-media?tab=creatives` | ดูการใช้งาน creative ในโฆษณา พร้อมนิยามและ source evidence; Inspect record / filter view | Paid creative associations + Files versions / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-014.jpg) |
| [MKT-UI-015](mockups/index.html#MKT-UI-015) | Paid media experiments · tab | `/growth/paid-media?tab=experiments` | สมมติฐาน วิธีเปรียบเทียบ และเกณฑ์ตัดสินใจก่อนเรียกผู้ชนะ; New experiment | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-015.jpg) |
| [MKT-UI-054](mockups/index.html#MKT-UI-054) | Autumn · Discovery · detail | `/growth/paid-media/campaigns/[adCampaignId]` | Meta ad campaign hierarchy with distinct adCampaignId; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-054.jpg) |
| [MKT-UI-055](mockups/index.html#MKT-UI-055) | Gift explorers · Ad set · detail | `/growth/paid-media/ad-groups/[adGroupId]` | Audience reference, parent account, ads and metric grain; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-055.jpg) |
| [MKT-UI-056](mockups/index.html#MKT-UI-056) | Gift in motion · Ad · detail | `/growth/paid-media/ads/[adId]` | Ad creative version, daily metrics, placement evidence; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-056.jpg) |
| [MKT-UI-057](mockups/index.html#MKT-UI-057) | Gift in motion · Effectiveness · detail | `/growth/paid-media/creatives/[creativeId]` | Creative usage and results retain provider attribution definitions; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-057.jpg) |

### Content & Creative

| ID / mockup | Interface / kind | Candidate route | Purpose / primary action | Source / owner | States | Screenshot |
|---|---|---|---|---|---|---|
| [MKT-UI-016](mockups/index.html#MKT-UI-016) | Creative briefs · tab | `/growth/content?tab=briefs` | ทุกชิ้นงานเริ่มจาก objective, audience, message และ acceptance; New brief | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-016.jpg) |
| [MKT-UI-017](mockups/index.html#MKT-UI-017) | Production pipeline · tab | `/growth/content?tab=production` | Creative · Footage · Editor · Art Director · Designer ทำงานใน pipeline เดียว; Open brief | PM WorkItems + creative version references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-017.jpg) |
| [MKT-UI-018](mockups/index.html#MKT-UI-018) | Approved creative library · tab | `/growth/content?tab=library` | ไฟล์ที่มีเวอร์ชัน สิทธิ์การใช้ และการตรวจรับครบ; Inspect record / filter view | Files owner + approved creative references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-018.jpg) |
| [MKT-UI-058](mockups/index.html#MKT-UI-058) | Autumn gift story · Creative brief · detail | `/growth/content/briefs/[briefId]` | Objective, audience, claims, shot list and acceptance criteria; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-058.jpg) |
| [MKT-UI-059](mockups/index.html#MKT-UI-059) | Autumn gift story · Asset v3 · detail | `/growth/content/assets/[assetId]` | Version history, source file, rights and review evidence; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-059.jpg) |
| [MKT-UI-077](mockups/index.html#MKT-UI-077) | New creative brief · form | `/growth/content/new` | Capture a measurable brief, not a task without context; Save draft & preview | Marketing projection + scoped owner references / Marketing | draft, invalid, ready, conflict, saved | [View](mockups/screenshots/MKT-UI-077.jpg) |

### Social & Community

| ID / mockup | Interface / kind | Candidate route | Purpose / primary action | Source / owner | States | Screenshot |
|---|---|---|---|---|---|---|
| [MKT-UI-019](mockups/index.html#MKT-UI-019) | Owned social posts · tab | `/growth/social?tab=posts` | Instagram organic และ publishing intent แยกจากโฆษณา; Draft post | Instagram owned media + approved content versions / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-019.jpg) |
| [MKT-UI-020](mockups/index.html#MKT-UI-020) | Social content calendar · tab | `/growth/social?tab=calendar` | ปฏิทิน content ที่ผูกเวอร์ชันและเจ้าของงาน; Inspect record / filter view | Social publishing intents + PM dates / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-020.jpg) |
| [MKT-UI-021](mockups/index.html#MKT-UI-021) | Instagram organic insights · tab | `/growth/social?tab=insights` | ผลของ owned media ไม่รวม paid reach ที่ถูกนับจาก Meta Ads; Inspect record / filter view | Instagram professional account/media insights / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-021.jpg) |
| [MKT-UI-022](mockups/index.html#MKT-UI-022) | Community handoffs · tab | `/growth/social?tab=handoffs` | ส่งบทสนทนาไป CRM ด้วย reference แทนสร้าง Inbox อีกชุด; Inspect record / filter view | CRM-authorized handoff projection / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-022.jpg) |
| [MKT-UI-060](mockups/index.html#MKT-UI-060) | A gift with a story · Post · detail | `/growth/social/posts/[postId]` | Approved content version, Instagram preview and publication receipt; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-060.jpg) |
| [MKT-UI-078](mockups/index.html#MKT-UI-078) | Draft Instagram post · form | `/growth/social/new` | Associate one approved creative version and intended schedule; Save draft & preview | Marketing projection + scoped owner references / Marketing | draft, invalid, ready, conflict, saved | [View](mockups/screenshots/MKT-UI-078.jpg) |

### Creators & Partnerships

| ID / mockup | Interface / kind | Candidate route | Purpose / primary action | Source / owner | States | Screenshot |
|---|---|---|---|---|---|---|
| [MKT-UI-023](mockups/index.html#MKT-UI-023) | Creator & partner directory · tab | `/growth/partners?tab=partners` | Affiliate และ Influencer ใช้ common partner core และ program type ต่างกัน; Add partner brief | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-023.jpg) |
| [MKT-UI-024](mockups/index.html#MKT-UI-024) | Partnership programs · tab | `/growth/partners?tab=programs` | ขอบเขต deliverables, rights และวิธีวัดผลของแต่ละโปรแกรม; Inspect record / filter view | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-024.jpg) |
| [MKT-UI-025](mockups/index.html#MKT-UI-025) | Partner deliverables · tab | `/growth/partners?tab=deliverables` | ตรวจรับผลงานและสิทธิ์ก่อนนำไปใช้ต่อ; Inspect record / filter view | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-025.jpg) |
| [MKT-UI-026](mockups/index.html#MKT-UI-026) | Partnership performance · tab | `/growth/partners?tab=performance` | แยก verified outcomes จาก provider-reported engagement และ settlement; Inspect record / filter view | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-026.jpg) |
| [MKT-UI-061](mockups/index.html#MKT-UI-061) | Nicha Creates · Partner · detail | `/growth/partners/[partnerId]` | Program references, contact handoff, rights and agreed deliverables; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-061.jpg) |
| [MKT-UI-062](mockups/index.html#MKT-UI-062) | Autumn creator stories · Program · detail | `/growth/partners/programs/[programId]` | Scope, deliverables and measurement policy by program type; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-062.jpg) |
| [MKT-UI-063](mockups/index.html#MKT-UI-063) | Gift story video 01 · Deliverable · detail | `/growth/partners/deliverables/[deliverableId]` | Version, usage rights, reviewer evidence and acceptance; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-063.jpg) |
| [MKT-UI-079](mockups/index.html#MKT-UI-079) | New partnership brief · form | `/growth/partners/new` | Separate program intent from CRM contact and commercial authority; Save draft & preview | Marketing projection + scoped owner references / Marketing | draft, invalid, ready, conflict, saved | [View](mockups/screenshots/MKT-UI-079.jpg) |

### Live Marketing

| ID / mockup | Interface / kind | Candidate route | Purpose / primary action | Source / owner | States | Screenshot |
|---|---|---|---|---|---|---|
| [MKT-UI-027](mockups/index.html#MKT-UI-027) | Live marketing schedule · page | `/growth/live` | วาง Live brief, rehearsal, host และความพร้อมก่อนวันจริง; Plan a live | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-027.jpg) |
| [MKT-UI-028](mockups/index.html#MKT-UI-028) | Live brief · detail-tab | `/growth/live/[liveId]?tab=brief` | Objective, audience, offer และ crew ของ Live; Review readiness | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-028.jpg) |
| [MKT-UI-029](mockups/index.html#MKT-UI-029) | Live rundown · detail-tab | `/growth/live/[liveId]?tab=rundown` | ลำดับช่วงเวลา สคริปต์ สินค้าที่นำเสนอ และ cue; Review readiness | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-029.jpg) |
| [MKT-UI-030](mockups/index.html#MKT-UI-030) | Live readiness · detail-tab | `/growth/live/[liveId]?tab=readiness` | ยืนยัน host, footage, offer, stock และ reviewer; Review readiness | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-030.jpg) |
| [MKT-UI-031](mockups/index.html#MKT-UI-031) | Live results · detail-tab | `/growth/live/[liveId]?tab=results` | ผลการ Live พร้อม manual/provider receipt ที่ติดป้าย; Review readiness | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-031.jpg) |
| [MKT-UI-080](mockups/index.html#MKT-UI-080) | Plan a live session · form | `/growth/live/new` | Confirm host, audience, offer and readiness dependencies; Save draft & preview | Marketing projection + scoped owner references / Marketing | draft, invalid, ready, conflict, saved | [View](mockups/screenshots/MKT-UI-080.jpg) |

### Website & CRO

| ID / mockup | Interface / kind | Candidate route | Purpose / primary action | Source / owner | States | Screenshot |
|---|---|---|---|---|---|---|
| [MKT-UI-032](mockups/index.html#MKT-UI-032) | Landing-page inventory · tab | `/growth/website?tab=pages` | Page intent, content version และ measurement association; Inspect record / filter view | Website page references + GA4/GSC + PM handoffs / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-032.jpg) |
| [MKT-UI-033](mockups/index.html#MKT-UI-033) | Conversion journey hypotheses · tab | `/growth/website?tab=journeys` | เปรียบเทียบ journey intent กับ evidence ที่ตอบ sequence ได้จริง; Create experiment | GA4 authorized reports + declared journey definition / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-033.jpg) |
| [MKT-UI-034](mockups/index.html#MKT-UI-034) | Website & CRO experiments · tab | `/growth/website?tab=experiments` | shared experiment core เดียวกับ Paid Media แต่กรองตาม website scope; New experiment | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-034.jpg) |
| [MKT-UI-064](mockups/index.html#MKT-UI-064) | Autumn gift landing page · detail | `/growth/website/pages/[pageId]` | Page intent, approved copy, GA4/GSC mapping and website-owner handoff; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-064.jpg) |
| [MKT-UI-065](mockups/index.html#MKT-UI-065) | Delivery-date clarity · Experiment · detail | `/growth/website/experiments/[experimentId]` | Hypothesis, treatment, control, window, guardrails and outcome; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-065.jpg) |
| [MKT-UI-081](mockups/index.html#MKT-UI-081) | New marketing experiment · form | `/growth/website/experiments/new` | Predefine evidence and decision rules before launch; Save draft & preview | Marketing projection + scoped owner references / Marketing | draft, invalid, ready, conflict, saved | [View](mockups/screenshots/MKT-UI-081.jpg) |

### SEO & Organic Search

| ID / mockup | Interface / kind | Candidate route | Purpose / primary action | Source / owner | States | Screenshot |
|---|---|---|---|---|---|---|
| [MKT-UI-035](mockups/index.html#MKT-UI-035) | Organic search performance · tab | `/growth/seo?tab=performance` | Search Console query/page performance พร้อม coverage caveat; Inspect record / filter view | Search Console property-scoped Search Analytics / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-035.jpg) |
| [MKT-UI-036](mockups/index.html#MKT-UI-036) | Search opportunities · tab | `/growth/seo?tab=opportunities` | Intent cluster → target page → content brief ที่มี evidence; Inspect record / filter view | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-036.jpg) |
| [MKT-UI-037](mockups/index.html#MKT-UI-037) | Technical SEO findings · tab | `/growth/seo?tab=technical` | แยก inspected evidence ออกจากสมมติฐานและสถานะการแก้ไข; Inspect record / filter view | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-037.jpg) |
| [MKT-UI-038](mockups/index.html#MKT-UI-038) | SEO workplan · tab | `/growth/seo?tab=workplan` | Prioritized work ใช้ PM WorkItem และ verification evidence; Inspect finding | PM WorkItems + SEO finding associations / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-038.jpg) |
| [MKT-UI-066](mockups/index.html#MKT-UI-066) | Canonical mismatch · SEO finding · detail | `/growth/seo/issues/[issueId]` | URL, evidence time/method, recommendation and verification criteria; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-066.jpg) |
| [MKT-UI-067](mockups/index.html#MKT-UI-067) | Corporate welcome gifts · Opportunity · detail | `/growth/seo/opportunities/[opportunityId]` | Query cluster, target page, source coverage and proposed content brief; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-067.jpg) |

### Analytics & Attribution

| ID / mockup | Interface / kind | Candidate route | Purpose / primary action | Source / owner | States | Screenshot |
|---|---|---|---|---|---|---|
| [MKT-UI-039](mockups/index.html#MKT-UI-039) | Marketing measurement overview · tab | `/growth/analytics?tab=overview` | มุมมองรวมที่ไม่บวกผลลัพธ์คนละนิยามเข้าด้วยกัน; Inspect record / filter view | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-039.jpg) |
| [MKT-UI-040](mockups/index.html#MKT-UI-040) | Website acquisition · tab | `/growth/analytics?tab=acquisition` | GA4 property reports ที่ preserve reporting identity และ quality flags; Inspect record / filter view | GA4 Data API report + metadata / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-040.jpg) |
| [MKT-UI-041](mockups/index.html#MKT-UI-041) | Funnel evidence · tab | `/growth/analytics?tab=funnels` | ต้องมี sequence-capable data contract ก่อนเรียกกราฟนี้ว่า user-level funnel; Inspect record / filter view | GA4 compatible funnel contract; demo sequence only / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-041.jpg) |
| [MKT-UI-042](mockups/index.html#MKT-UI-042) | Attribution & revenue · tab | `/growth/analytics?tab=attribution` | Provider-reported, GA4 และ Commerce-confirmed แสดงแยกกัน; Inspect record / filter view | Provider insights + GA4 + planned CRM/Commerce read contract / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-042.jpg) |
| [MKT-UI-043](mockups/index.html#MKT-UI-043) | Source health & data quality · tab | `/growth/analytics?tab=data-quality` | Freshness, completeness, restriction และ account mapping ก่อนเชื่อผลลัพธ์; Inspect record / filter view | Integration source receipts + quality metadata / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-043.jpg) |
| [MKT-UI-068](mockups/index.html#MKT-UI-068) | GA4 acquisition report · Evidence · detail | `/growth/analytics/reports/[reportId]` | Frozen query definition, report quality, source receipt and lineage; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-068.jpg) |

### Marketing Operations

| ID / mockup | Interface / kind | Candidate route | Purpose / primary action | Source / owner | States | Screenshot |
|---|---|---|---|---|---|---|
| [MKT-UI-044](mockups/index.html#MKT-UI-044) | Marketing intake · tab | `/growth/operations?tab=intake` | รวมคำขอและความพร้อมก่อนแตกแผน โดยไม่สร้าง Task อีกระบบ; New intake | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-044.jpg) |
| [MKT-UI-045](mockups/index.html#MKT-UI-045) | Delivery calendar · tab | `/growth/operations?tab=calendar` | กำหนดส่ง Content, Campaigns, Live และ SEO จาก PM records เดียวกัน; Inspect record / filter view | PM schedule projection / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-045.jpg) |
| [MKT-UI-046](mockups/index.html#MKT-UI-046) | Approval inbox · tab | `/growth/operations?tab=approvals` | คนที่มีสิทธิ์ตรวจเวอร์ชันและขอบเขตก่อนอนุมัติ; Inspect record / filter view | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-046.jpg) |
| [MKT-UI-047](mockups/index.html#MKT-UI-047) | Cross-domain handoffs · tab | `/growth/operations?tab=handoffs` | รับทราบคำขอผ่าน owner contract พร้อม receipt; Inspect record / filter view | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-047.jpg) |
| [MKT-UI-069](mockups/index.html#MKT-UI-069) | Autumn landing refresh · Intake · detail | `/growth/operations/intake/[intakeId]` | Objective, owner, dependencies and PM work reference; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-069.jpg) |
| [MKT-UI-070](mockups/index.html#MKT-UI-070) | Verify autumn offer stock · Handoff · detail | `/growth/operations/handoffs/[handoffId]` | Owner-domain request, scope, status and receipt; no Marketing stock write; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-070.jpg) |
| [MKT-UI-082](mockups/index.html#MKT-UI-082) | Submit marketing intake · form | `/growth/operations/new` | Route requested work to the right capability owner; Save draft & preview | Marketing projection + scoped owner references / Marketing | draft, invalid, ready, conflict, saved | [View](mockups/screenshots/MKT-UI-082.jpg) |

### Team & Refinement

| ID / mockup | Interface / kind | Candidate route | Purpose / primary action | Source / owner | States | Screenshot |
|---|---|---|---|---|---|---|
| [MKT-UI-048](mockups/index.html#MKT-UI-048) | Marketing team · tab | `/growth/team?tab=team` | คนรับผิดชอบการตัดสินใจ ผู้เชี่ยวชาญเสนอ และ reviewer ตรวจหลักฐาน; Configure refinement | Team grouping + typed agent role config; not authority / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-048.jpg) |
| [MKT-UI-049](mockups/index.html#MKT-UI-049) | Refinement runs · tab | `/growth/team?tab=runs` | ติดตามงานจริงจาก run/step receipts ไม่ใช้ animation แทนสถานะ; New refinement run | Agreed MSP/Agent run control projection / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-049.jpg) |
| [MKT-UI-050](mockups/index.html#MKT-UI-050) | Review workspace · tab | `/growth/team?tab=reviews` | ทบทวนหลักฐาน ขอบเขต ความเป็นไปได้ และสิ่งที่ยังขัดแย้ง; Compare v1 → v2 | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-050.jpg) |
| [MKT-UI-051](mockups/index.html#MKT-UI-051) | Decision ledger · tab | `/growth/team?tab=decisions` | การอนุมัติผูก artifact hash/version และมีผู้รับผิดชอบ; Inspect record / filter view | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-051.jpg) |
| [MKT-UI-052](mockups/index.html#MKT-UI-052) | Learning candidates · tab | `/growth/team?tab=learnings` | สิ่งที่เรียนรู้มี evidence, limitation และขอบเขตก่อน promote ไป GKS; Inspect record / filter view | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-052.jpg) |
| [MKT-UI-071](mockups/index.html#MKT-UI-071) | September channel plan · MKR-021 · detail | `/growth/team/runs/[runId]` | Brief, roles, steps, budget, evidence, version diff and outcome; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-071.jpg) |
| [MKT-UI-072](mockups/index.html#MKT-UI-072) | Review September plan · v1 → v2 · detail | `/growth/team/reviews/[reviewId]` | Independent review and version-specific human decision; Approve this version | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-072.jpg) |
| [MKT-UI-073](mockups/index.html#MKT-UI-073) | Channel plan approval · Decision · detail | `/growth/team/decisions/[decisionId]` | Exact target/hash/version, approver, scope and immutable receipt; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-073.jpg) |
| [MKT-UI-074](mockups/index.html#MKT-UI-074) | Context matters · Learning candidate · detail | `/growth/team/learnings/[learningId]` | Observation, evidence, limits, scope, expiry and GKS promotion review; Review with team | Marketing projection + scoped owner references / Marketing | ready, loading, empty, partial, stale, error, forbidden | [View](mockups/screenshots/MKT-UI-074.jpg) |
| [MKT-UI-083](mockups/index.html#MKT-UI-083) | Configure refinement run · form | `/growth/team/new` | Finite budgets, allowed roles and an independent reviewer; Save draft & preview | Marketing projection + scoped owner references / Marketing | draft, invalid, ready, conflict, saved | [View](mockups/screenshots/MKT-UI-083.jpg) |
| [MKT-UI-084](mockups/index.html#MKT-UI-084) | Approve exact version · dialog | `/growth/team/runs/[runId]?dialog=approve` | Approve the reviewed artifact and internal handoff only; Confirm in mockup | Marketing projection + scoped owner references / Marketing | ready, invalid, stale-approval, forbidden | [View](mockups/screenshots/MKT-UI-084.jpg) |
| [MKT-UI-085](mockups/index.html#MKT-UI-085) | Request changes · dialog | `/growth/team/runs/[runId]?dialog=request-changes` | Attach specific findings to this version; no silent edits; Confirm in mockup | Marketing projection + scoped owner references / Marketing | ready, invalid, stale-approval, forbidden | [View](mockups/screenshots/MKT-UI-085.jpg) |
| [MKT-UI-086](mockups/index.html#MKT-UI-086) | Reject proposal · dialog | `/growth/team/runs/[runId]?dialog=reject` | Record a reason and prevent downstream execution; Confirm in mockup | Marketing projection + scoped owner references / Marketing | ready, invalid, stale-approval, forbidden | [View](mockups/screenshots/MKT-UI-086.jpg) |
| [MKT-UI-087](mockups/index.html#MKT-UI-087) | Pause refinement · dialog | `/growth/team/runs/[runId]?dialog=pause` | Stop new dispatch, preserve receipts and remaining budget; Confirm in mockup | Marketing projection + scoped owner references / Marketing | ready, invalid, stale-approval, forbidden | [View](mockups/screenshots/MKT-UI-087.jpg) |
| [MKT-UI-088](mockups/index.html#MKT-UI-088) | Cancel refinement · dialog | `/growth/team/runs/[runId]?dialog=cancel` | Fence pending work; an external call already sent cannot be recalled; Confirm in mockup | Marketing projection + scoped owner references / Marketing | ready, invalid, stale-approval, forbidden | [View](mockups/screenshots/MKT-UI-088.jpg) |
| [MKT-UI-089](mockups/index.html#MKT-UI-089) | Review external action · dialog | `/growth/team/runs/[runId]?dialog=action-review` | Exact account, target, creative version, amount and expiry; Confirm in mockup | Marketing projection + scoped owner references / Marketing | ready, invalid, stale-approval, forbidden | [View](mockups/screenshots/MKT-UI-089.jpg) |
| [MKT-UI-090](mockups/index.html#MKT-UI-090) | Review learning promotion · dialog | `/growth/team/runs/[runId]?dialog=promotion` | Only a scoped, evidence-backed lesson enters GKS review; Confirm in mockup | Marketing projection + scoped owner references / Marketing | ready, invalid, stale-approval, forbidden | [View](mockups/screenshots/MKT-UI-090.jpg) |

## 4. Detail and action requirements

Forms show required fields, validation, cancel/back and draft preview. Editing an approved record creates a new draft/version.
Campaign detail and Live detail replace collection navigation with one detail-tab bar; other records use sections/drawers.
Paid campaign → AdSet/Ad Group → Ad uses breadcrumbs, not nested tab bars; common provider filters preserve metric labels.
Creative/post details expose version and rights; publication is an explicit handoff/receipt, never implied by draft save.
Refinement detail shows bounded rounds/cost/time, role/step receipts, evidence, diff, blockers and human decision.
Approval/rejection/change-request/pause/cancel/action/promotion dialogs each show scope and consequence.
Approval on stale input is rejected; ambiguous provider outcome requires reconciliation rather than blind retry.

## 5. Verification and delivery

Evidence is recorded in [verification.json](mockups/verification.json) and [QA report](MARKETING-MOCKUP-QA.md).
Verification must enumerate every catalog ID, open each screen, capture an individual screenshot,
check missing resources/runtime errors/overflow and exercise navigation, filters, forms, version review and shared states.
Desktop and mobile layouts are checked separately; representative contact sheets make visual review practical.
No product unit/build/e2e or live-provider test is claimed by these prototype checks.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Enumerate 100 Marketing mockup interfaces with route, purpose, source, access, states and traceable screenshots | See git history | RWANG |
