# Session 6 — Marketing Insights: Implementation Master Prompt

วันที่จัดทำ: 24 กันยายน 2026 (Asia/Bangkok)
Session ที่เลือก: **Session 6 / S6 — Marketing Insights**; เปิด session ใหม่ใน Claude Code บนเครื่องที่เข้าถึง working repository ได้
ลักษณะงาน: **เพิ่ม reporting module ใน Marketing + เชื่อม sync ของ Integration เดิม** ไม่ใช่ Marketing service extraction ทั้ง domain และไม่สร้าง Insights microservice
สถานะเอกสาร: IMPLEMENTATION INSTRUCTION / NOT IMPLEMENTED / NOT DEPLOYED; การมี prompt นี้ไม่พิสูจน์ว่า session เริ่มทำงานแล้ว
แหล่งหลัก: `contract.md — Contract: Insights Dashboard Module` ซึ่งฝังต้นฉบับครบไว้ใน Appendix A
SHA-256 ของต้นฉบับ: `693f92f04315e68044043d5d8c9cc4be90ca2845fb38e6b498f4fe9a79e14b63`

## 0. การรับงานและขอบเขตอำนาจ

คุณคือ implementation owner ของ S6. อ่าน prompt ทั้งไฟล์และ Appendix A ก่อนลงมือ ใช้ไฟล์นี้ไฟล์เดียวเพื่อเข้าใจงาน ไม่จำเป็นต้องมีประวัติแชตอื่น

เปิด lane/worktree ของ S6 แยกจาก S1–S5 และ MC0. ถ้ามี S6/Insights implementation อยู่แล้ว ให้ตรวจ branch/head/PR/handoff และทำต่อจาก checkpoint เดิม ห้าม reset หรือสร้างระบบซ้ำ หากชื่อ S6 ถูกใช้งานจริงกับงานอื่นให้รายงาน alias collision ก่อนลงทะเบียน ไม่ยึด session ของผู้อื่น

เป้าหมายหลักคือทำ Overview / Results / Content สำหรับ connected Pages/ad accounts ของ INFRESH, Glowcea และ 056 Laos ตาม contract ให้ใช้งานและตรวจสอบข้อมูลได้จริง ห้ามขยายเป็นการสร้าง/แก้/boost/publish ads, Inbox, TikTok, Instagram organic แยกชุด, GA4, audience demographics หรือ attribution engine ใหม่ในรอบนี้

ข้อแตกต่างที่ต้องรักษา:
- **Read-only reporting** หมายถึงไม่เขียนคอนเทนต์/โฆษณาที่ Meta; งานนี้ยังต้องเขียน cache/read models, sync receipts และ local test data
- **Reporting module** ไม่เท่ากับ standalone deployable service. Query/application services ภายในโค้ดมีได้โดยไม่สร้าง process ใหม่
- **Contract source** ไม่เท่ากับ verified provider capability. ชื่อ metrics/credentials/quota ใน contract ต้องผ่านการตรวจ runtime/API version ก่อนอ้าง live support
- Prompt นี้อนุญาต implementation/tests/docs ใน working repository ที่ยืนยันเป้าหมายแล้ว ไม่อนุญาต deploy, production migration, เปิด production cron, ส่งข้อความ LINE จริง, provision บัญชี หรือเปลี่ยนสิทธิ์ external app เอง
- Code PR/patch ใช้ workflow และสิทธิ์ที่มีจริง ไม่ merge/auto-merge/force-push เอง

## 1. หลักฐานและข้อกำหนด: ห้ามแก้สัญญาเดิมเงียบ ๆ

ให้แยกข้อมูลออกเป็นสามชั้นและบันทึกที่มาของทุกการเปลี่ยน:

1. **BASELINE** — ข้อกำหนดจาก Appendix A; รักษาศัพท์ ชื่อแบรนด์ tabs/components, API surface, technology stack และ scope ที่ระบุ
2. **IMPLEMENTATION DECISIONS** — ขอบเขต module/ports/testing/parallel work ใน prompt นี้; ทำตาม repo instructions โดยไม่ลบ baseline
3. **PROPOSED CONTRACT DELTAS / VERIFIED COMPATIBILITY FINDINGS** — ช่องว่างและการปรับสัญญาใน §5; แสดงก่อน/หลัง เหตุผล ผลต่อ consumers และสถานะ review ก่อนนำ breaking change ไปใช้

สร้าง `INSIGHTS-CONTRACT-RECONCILIATION.md` หรือ equivalent ตาม template ที่ตรวจพบ โดยมีคอลัมน์:
`baseline section | exact requirement | source evidence | observed implementation | discrepancy | proposed delta | authority/reviewer | decision status | affected tests`.

ห้ามแก้ Appendix A ให้ดูเหมือน source เคยกำหนดสิ่งที่เพิ่งเสนอ ห้ามประกาศ ADR/FR accepted หรือคิดเลข registry เอง. การให้สร้าง prompt ไม่ใช่หลักฐานว่า provider credential พร้อมหรือทุก schema/API amendment ได้รับ review แล้ว

เมื่อข้อกำหนดไม่ชัด ให้ใช้แนวทางที่ไม่แต่งข้อมูลและไม่เปิดสิทธิ์ เช่นแสดง unavailable/coverage gap พร้อมแยกเป็นข้อเสนอ contract. ส่วนที่ปลอดภัยและไม่ติด gate ให้ implement ต่อ ไม่หยุดทั้งงานเพียงเพราะ live provider ยังไม่พร้อม แต่ห้ามอ้าง completion ของข้อกำหนดที่ยังไม่มีหลักฐาน

## 2. Target discovery — หาแอปและ client เดิมให้เจอก่อน

บริบทการประสานงานคือ `Freshair129/zuri.ai` และ Marketing domain ของ Zuri แต่ **Appendix A เรียกเป้าหมายว่า internal Ads Dashboard (Next.js + TypeScript + Supabase) และไม่ได้ระบุ repository URL**. ห้ามใช้ข้อความนี้เป็นหลักฐานว่า Zuri มี Meta_Ads_MCP/n8n integration หรือทุก brand binding อยู่แล้ว

ทำ read-only discovery ก่อน structural writes:

1. ตรวจ actual cwd, repository remote, root, base/head SHA, dirty changes, worktrees และ active ownership/PR/handoff ที่เข้าถึงได้; ไม่ checkout กลับ snapshot เก่าจากแชต
2. อ่าน AGENTS.md, CLAUDE.md, directory instructions, Marketing/Integration/Identity charters, templates, ID allocation, test/CI conventions
3. หา Ads Dashboard เดิม, routes/components/dataviz/locale conventions, Supabase schema/Auth/RLS, n8n workflow definitions และ entry point ของ `Meta_Ads_MCP` / Graph API service layer
4. ตรวจว่า layer เดิมรองรับ Page/Post/Ad insights จริงหรือเพียง Ads API; ใช้ code + versioned contracts + tests เป็นหลักฐาน ไม่ถือว่าชื่อ MCP แปลว่าครบ
5. Enumerate connection/account/page mappings ของ INFRESH, Glowcea, 056 Laos ผ่าน metadata ที่อนุญาต โดยไม่เปิด secret material. ห้ามสร้าง provider IDs, token หรือ dataset จริงขึ้นเอง
6. หา tracker/handoff/MC0 endpoint จากตำแหน่งที่อนุญาต ตรวจ ownership ของ Marketing และ shared Integration paths ก่อนเขียน

บันทึก `TARGET_APP_BINDING`: repository, app root, stack, destination module, existing Meta client, workflow locations, schema owner, authenticated brand/asset mapping, evidence SHA, unresolved gaps.

การตัดสินใจเป้าหมาย:
- ถ้า Ads Dashboard และ Integration client อยู่ใน Zuri ตามบริบท ให้ทำ Insights ภายใน Marketing ของ app นั้น
- ถ้าพบว่า contract หมายถึงอีก repository ให้รายงาน exact evidence และเสนอ integration boundary; **ไม่เขียน repo นั้นหรือสร้างแอปใหม่แทนโดยไม่มี authorization เฉพาะ**
- ถ้าไม่พบ client ให้เป็น `EXISTING_META_CLIENT_NOT_FOUND` และทำ ports/fixtures/read-model/UI งานที่ไม่พึ่ง live client ต่อใน scope ที่ชัดแล้ว; ห้ามสร้าง Meta client ตัวที่สองเพื่อกลบ blocker
- Source กำหนด TypeScript + Supabase/Postgres. ถ้า host ปัจจุบันเป็น JavaScript/SQLite ให้บันทึก mismatch และ incremental integration proposal. ไม่ migrate ภาษา/ORM/database ทั้ง Zuri และไม่แทน Supabase ด้วย SQLite แล้วอ้างผ่าน source contract
- SQLite mocks ไม่พิสูจน์ PostgreSQL queries, RLS, concurrency หรือ Supabase Auth. Tests ที่อ้างเรื่องเหล่านั้นต้องใช้ environment ที่รองรับจริง

## 3. Baseline delivery scope ที่ต้องรักษาครบ

จาก Appendix A §1–2, §6–9:

| ส่วน | ข้อกำหนด baseline |
|---|---|
| Brands | INFRESH / Glowcea / 056 Laos; slug `infresh` / `glowcea` / `056laos` ตาม source |
| Shared shell | Page/asset selector, brand selector, date-range picker; default last 28 days; selection อยู่ URL query params |
| Overview | Multi-metric cards + sparkline + previous-period change; Views/Follows/Visits/Interactions/Video และ Conversions placeholder |
| Results | Full-width metric charts + CSV export ต่อ metric |
| Content | All/Post/Story/Reel/Live; organic-vs-paid; top content by views; by-format Published/Views/Interactions |
| Data path | Graph API ผ่าน Meta_Ads_MCP / Graph API layer เดิม; sync ด้วย n8n; query endpoints อ่าน Supabase เท่านั้น |
| Schedule | daily 02:00 Asia/Bangkok + manual refresh; lookback 28 days ตาม baseline |
| Retry/alert | retry once after 5 minutes then LINE alert ตาม baseline; compatibility issue ของ LINE Notify อยู่ §5 |
| Cap | ไม่เกิน 200 calls/hour/app ตาม project configuration ที่ source ระบุ; ไม่อ้างว่าเป็น universal Meta quota |
| Performance | cached Supabase server response under 500 ms; date change ไม่มี full page reload |
| UI conventions | chart palette/tooltips/legend/library และ locale เดิม; Gregorian dates ใช้ได้ตาม source |
| Acceptance | ทั้งสามแบรนด์ต้องแสดง real synced data; CSV ตรง chart; schedule/manual/failure/isolation/no-live-request-path มี proof |

Out of scope ต้องคงตาม Appendix A: ad creation/editing, boost, publishing, Messaging/Inbox, Benchmarking, Earnings, Monetization, audience demographics. ลิงก์ออก Meta Business Suite/Ads Manager ได้ตามสิทธิ์และ safe URL handling ไม่แปลงเป็น write action ในระบบนี้

ข้อ open questions ไม่ใช่คำสั่งเพิ่มฟีเจอร์:
- Conversions ให้คง placeholder ที่บอกว่า “ยังไม่เชื่อมข้อมูล” ไม่ใส่เลข 0 แทนข้อมูลจริง; attribution เป็น future separate contract
- Default 28 days แน่นอน; presets/custom campaign periods ที่ยังไม่ตกลงใช้ของเดิมที่มีพร้อม disclosure ไม่สร้าง campaign calendar ใหม่
- Boost คง excluded/read-only ตาม current assumption ของ source; ไม่รอคำตอบเพื่อแอบสร้าง boost API

Page/Post slice ที่ทำก่อนเป็นเพียง tranche. Purpose รวม ad accounts ด้วยจึงต้องบันทึกว่า Ad Insights ยังเหลืออะไร ไม่ลด full scope ให้เหลือ Pages โดยไม่แจ้ง

## 4. Architecture / ownership ที่เลือก

```text
User → InsightsLayout / Overview / Results / Content
                    ↓
             thin Next route handlers
                    ↓
       Marketing Insights application/query module
                    ↓
       Supabase reporting repositories/read models
                    ↑
       Marketing metric projection / validation
                    ↑
  Integration raw evidence + report/sync receipts
                    ↑
 Existing Meta_Ads_MCP / Graph API service layer
                    ↑
      n8n schedule / authorized refresh job
```

- Marketing owns report semantics, query composition, metric definitions/projection ตาม approved contract, ranking, period comparison และ CSV
- Integration owns connection/capability/credential transport, raw acquisition, rate-limit/pagination/cursors/provider errors และ existing ingestion/run records. Reuse owners ไม่สร้าง second raw-ingestion stack
- n8n orchestrates schedule/refresh/retry/alert. Formula and aggregation logic อยู่ใน version-controlled tested code/module หรือ approved database functions ไม่ซ่อนสูตรสำคัญใน Function node หลายชุด
- สร้าง single controlled writer path สำหรับ reporting projections. n8n/route/agent ห้ามต่างคน upsert ด้วยกฎไม่ตรงกัน
- Supabase/Postgres ถือ reporting data/read models ตาม contract ไม่ clone operational SCM/CRM databases
- Files เก็บ binary/export/media เฉพาะ feature ที่ต้องใช้จริง. CSV ที่ stream ได้ไม่ต้องรอ MinIO; thumbnail ไม่กลายเป็นงานย้าย storage ทั้งแพลตฟอร์ม
- Marketing planning/reviews ที่มีอยู่ยังเป็นของ owner เดิม. ไม่ย้าย planning/PM handoff หรือสร้าง Marketing service process ใหม่ในงานนี้
- UI request ต้องไม่เรียก Graph API สด รวม React Server Component/server action/route helper/CSV export ไม่ใช่แค่ห้าม browser fetch
- Manual refresh เป็น **control request** เข้าคิวได้ แต่ต้องไม่ดึงรายงาน Meta inline. การรอ worker completion ผ่าน polling/status ไม่ใช่ส่วนของ GET report data path

จัดโค้ดตาม layout ที่ตรวจพบ; ตัวอย่าง logical layers คือ `marketing/insights/domain`, `application`, `ports`, `infrastructure`, `ui`, `tests`. ไม่บังคับชื่อ directory ถ้าขัด repo convention

Pure metric functions ไม่ import Next, global Prisma/Supabase singleton, process.env, n8n SDK หรือ provider HTTP client. ประกอบ dependency ที่ composition root. ย้ายเป็น Marketing service ภายหลังได้โดยไม่เขียน metric semantics ใหม่

Ports ที่เสนอให้ map/reuse ไม่ใช่ FR IDs หรือสั่งสร้าง network services ทุกตัว:
`InsightsRepository`, `InsightScopeAuthority`, `MetaInsightsReadPort`, `SyncRequestPort`, `SyncStatusReadPort`, `ReportNotificationPort`, optional `FilePreviewPort`.

ทุก port มี bounded DTOs, typed errors, versions และ provider/consumer tests; raw credential ไม่ข้าม domain boundary. ไม่มี generic execute-arbitrary-Graph-URL endpoint

## 5. Contract reconciliation ที่ต้องทำก่อน freeze schema/API

ตารางนี้เป็น **รายการตรวจและข้อเสนอปรับจากการ review** ไม่ใช่ข้อความที่ source contract ระบุไว้ทั้งหมด การเปลี่ยน schema/DTO/นิยาม metric ต้องเป็น explicit delta พร้อม review ตาม repo

| ประเด็น | สิ่งที่ source ระบุ | งานที่ต้องตรวจ/ข้อเสนอ |
|---|---|---|
| Views กับ Viewers | มี `page_impressions_unique` ซ้ำในสองนิยาม | ตรวจ current official Meta docs, selected API version, endpoint/period/permission และ account response. ห้ามเปลี่ยน reach ให้เป็น views โดยไม่บอก |
| Metric compatibility | มีรายการ Graph fields ใน §3 | ทำ compatibility matrix ต่อ Page/Post/Ad entity, field, version, aggregation, units, period และ capabilities; unsupported ≠ 0 |
| Brands/auth | brand param ควบคุมการขอข้ามแบรนด์ | Server ต้อง intersect requested assets กับ actual actor grants; parameter ไม่ให้สิทธิ์เพิ่ม. ผูก brand กับ Business ตามข้อมูลจริงไม่สมมติหนึ่งต่อหนึ่ง |
| Content timeseries | `content_performance` เก็บล่าสุดหนึ่งแถวต่อ post | แยก publish-window cohort กับ performance-in-window. เสนอ observation period/lifetime snapshot แยก metadata; ไม่สร้างย้อนหลังจากค่า lifetime ปัจจุบัน |
| Organic/paid | มี `is_organic` และ metric organic/paid | ตรวจ provider dimensions. หนึ่งโพสต์อาจมีหลาย distribution measurements; boolean อย่างเดียวไม่ใช่หลักฐาน breakdown ครบ |
| Stored fields vs response | Content API ต้องคืน watchTime/threeSecViews/organicViews/paidViews/thumbnail | ทำ mapping ทุก output ว่ามาจาก schema/query/derivative ใด. Missing source ให้ unavailable ไม่เดาค่า |
| History coverage | recurring lookback 28 days + previous-period change | เปรียบเทียบ 28+28 ต้องมี 56 วัน. เสนอ initial/backfill แยกจาก recurring refresh ภายใต้ provider window; coverage ไม่ครบไม่คำนวณ change แบบหลอก |
| Page/ad account selection | purpose มี Pages/ad accounts แต่ tables/GETs เน้น page/brand | ตกลง typed asset binding + API selector ที่ backward-compatible. ไม่ยัด ad-account IDs ลง page_id โดยไม่มี namespace |
| Unknown values | numeric DEFAULT 0 หลายช่อง | เสนอ nullable values + quality/reason metadata; observed zero ไม่เท่ากับ permission denied/unsynced/unsupported |
| Read DTOs | response เดิมเป็น arrays / object shape เฉพาะ | Keep compatibility หรือทำ versioned extension ที่ reviewed. ไม่คืน envelope ใหม่แล้วปล่อย UI เดิมพัง; zero/null changes ต้องแจ้ง |
| Refresh endpoint | มีปุ่ม manual refresh แต่ไม่มี POST ใน endpoint list | เสนอ scoped POST refresh + GET job-status หรือ reuse existing equivalent; ไม่ใช้ GET report trigger sync |
| CSV consistency | export ต้องตรงค่าที่แสดง | เสนอ exact report snapshot/query token หรือ consistent read mechanism; reauthorize และ preserve metric definitions/filter/window |
| Failure alert | source เรียก LINE Notify | External finding: LINE Notify ยุติ 31 มีนาคม 2025 [EXT-1]. ต้องมี replacement decision/reuse authorized notification adapter; ไม่สร้าง Notify integration ที่ใช้ไม่ได้หรือเปิด LINE account เอง |
| Rate cap | 200 calls/hour/app ตาม config ของ project | เก็บ cap เป็น project safety constraint และตรวจ actual provider limits/headers. จำนวน worker/retry/batch subrequests ไม่เป็นช่องหลบ cap |
| ID/technology mismatch | SQL ใช้ generated bigint; context repo อาจบังคับ internal UUID/คนละ ORM | ไม่เปลี่ยน keys/stack เงียบ ๆ. ทำ explicit schema/alias/compatibility mapping และ migration review |

วิธีดำเนินงานเมื่อยังไม่ freeze:
- สร้าง fixtures ที่มี labels และ tests สำหรับกรณี known/unknown ไม่ใส่ fake data ใน production report
- Metric ที่ API version ไม่รองรับให้แสดง unavailable พร้อมเหตุผลและบันทึก acceptance gap. ห้ามอ้างว่า feature metric นั้นผ่าน
- Reader/UI แบบ defensive และ pure functions ทำต่อได้; migration/breaking provider mapping/publish of production workflow รอ gate เฉพาะของมัน
- ห้ามแก้ไฟล์ source contract เดิมให้ lost provenance; เก็บ approved revision/delta แยก

## 6. Measurement correctness

ทำ metric definition table จาก source และ verified capability; แต่ละ metric ต้องมี `metricKey`, label, provider name/field, API version, entity scope, unit, period kind, dimensions, organic/paid availability, aggregation rule, quality flags และ source evidence

กฎ implementation ที่ต้องทดสอบ:

1. รวมได้เฉพาะค่าที่นิยาม/หน่วย/entity level/timezone/grain เข้ากัน และช่วงไม่ซ้อนกัน. ห้ามรวม Page total + Post totals + Ad totals แล้วเรียกยอดรวมเดียว
2. Views และ unique viewers ไม่ใช่ค่าเดียวกัน. Unique metrics ไม่ `SUM` ข้ามวัน/โพสต์/assets โดยไม่พิสูจน์. การรวม organic+paid unique อาจซ้ำคน ต้องใช้ provider aggregate ที่รองรับหรือแสดงแยก
3. Content published in window กับ engagement occurring in window ต้องระบุใน UI/API ชัด. A lifetime snapshot ไม่ใช่ period insight. ไม่ใช้ผลต่าง lifetime เป็น metric ทางการโดยไม่มี reviewed derivation
4. วันที่ from/to ใน UI กับ provider interval ต้อง define inclusive/exclusive, timezone, current partial day และ comparable previous period. ใช้ convention เดิมที่ยืนยันหรือส่ง delta ไม่บวก/ลบวันตาม guess
5. Watch time ต้องมีหน่วยที่ตรวจจริงและแปลงใน presentation โดยเก็บ raw unit/reference. Net follows = follows - unfollows เฉพาะนิยาม/ช่วง compatible; incomplete inputs ไม่เป็น 0
6. Previous change คำนวณเฉพาะ coverage ครบและ prior denominator ใช้ได้. prior=0/missing/partial ห้ามแสดง Infinity/NaN หรือ invented 100%; แสดง N/A พร้อมเหตุผลตาม DTO ที่ reviewed
7. Ranking ใช้ metric period ที่เลือก ไม่เอา lifetime ของโพสต์เก่าปน. Stable tie-breaker และ pagination ต้องชัด
8. byFormat Published นับ unique eligible content items ไม่ใช่จำนวน metric rows; Views/Interactions ใช้ definitions และ snapshots เดียวกับ summary
9. ผล sync ใหม่ที่แก้ตัวเลขของช่วงเดิมเป็น revised observation ไม่บวกเพิ่ม blind. Freshness, fetchedAt, coveredUntil และ partial reason ต้องอยู่ใน report metadata
10. ตัวเลขขนาดใหญ่/decimal ต้องไม่สูญเสีย precision. หาก baseline JSON number รองรับไม่ได้ ให้ fail/เสนอ type delta ไม่ stringify เงียบหรือ round ธุรกิจใหม่
11. ความเข้ากันได้กับ latest API ต้องมีวันที่ตรวจและ pinned version. อย่าใช้ LLM memory เป็นหลักฐานว่า field ได้รับอนุญาต
12. Content/attachment type mapping ต้อง preserve unknown/unsupported ไม่เดา Reel/Story จาก filename และไม่อ้างครบจาก sample เดียว

## 7. Persistence / security model

รักษา `insights_daily` และ `content_performance` เป็น baseline responsibilities. เสนอ additive tables/views/columns เมื่อ semantics จำเป็น ก่อนลง migration review ชื่อต่อไปนี้เป็น logical responsibilities ไม่ใช่สั่งสร้างทั้งหมด:

- **Authorized asset binding** — Tenant/Business/brand mapping, connection ref, provider namespace + Page/ad-account ID, asset kind, capabilities and revision
- **Content item** — exact provider namespace/account/post identity, type/format/publishedAt/permalink, allowed thumbnail/file reference and source metadata
- **Metric observation** — entity, metric definition/version, time interval/period kind, full dimension tuple, distribution, value+unit+quality, raw evidence/ref, fetchedAt, revision/snapshot
- **Sync run/partition receipt** — normalized request identity, initiating actor, asset/window, API/profile, n8n execution ref, pagination/checkpoint, attempts, lease/fence, result/freshness
- **Published report snapshot** — complete/partial coverage and query-visible generation สำหรับ consistent dashboard/export ถ้าเลือกวิธีนี้

การทำ multi-brand:
- brand slug เป็น selector/alias ไม่ใช่ authority. Resolve จาก authenticated actor และ server-owned binding; same Tenant ไม่ได้สิทธิ์ทุก Business โดยปริยาย
- Shared agency account ต้องมี authorized asset partition. แยกไม่ได้ให้ `UNRESOLVED_SCOPE/BLOCKED` ไม่แจก aggregate ทั้งบัญชีให้ทุก brand
- Connection token มี scope กว้างได้ แต่ application request ยังต้องแคบตาม grant. Client ส่ง page_id ที่เดาได้ไม่ให้สิทธิ์อ่าน
- ทุก read, cache, history, export, thumbnail, manual refresh และ sync callback ตรวจ current authority/scope
- List/search ไม่คืนชื่อ/จำนวน denied brands แล้วค่อยซ่อนที่ UI. Cache keys รวม verified scope/asset/date/filter/metric version/snapshot และ reauthorize ก่อนคืน
- เปิด RLS บน exposed tables และทดสอบด้วย actual authenticated/anon roles. ทดสอบ views/RPC/security-definer paths ด้วย ไม่อ้าง RLS proof จาก service_role ที่ bypass ได้ [EXT-2]
- Job role ต้องจำกัด write path และตรวจ connection parent/binding; ไม่ให้ frontend service key หรือใช้ user-editable metadata เป็น grant
- Current revocation ต้องปิด reads ที่ไม่อนุญาตและหยุด acquisition ตาม owner workflow; stale snapshot ไม่ใช่ bypass
- ไม่สร้าง new privileged Marketing role หรือเปลี่ยน permission keys ทั้งระบบเพื่อให้ demo ผ่าน

## 8. Sync pipeline ด้วย n8n เดิม

Reuse existing workflows/client และทำ version-controlled workflow export ที่ **ไม่มี credentials/secrets/live data**. ทำ runnable dry/test configuration แยกจาก production ไม่ activate live workflow เอง

Baseline schedule = 02:00 `Asia/Bangkok` ทุกวัน; scheduler timezone ไม่อิง container default โดยไม่ตรวจ. Manual refresh ใช้ canonical job path เดียวกับ scheduled sync

Proposed flow ที่ต้อง reconcile กับ implementation เดิม:

```text
Schedule/Authorized refresh
 → validated scope + eligible connection/asset + capability
 → create/reuse durable sync intent
 → acquire partition lease + provider quota allocation
 → existing Meta client fetches reports with bounded pagination
 → validate source parent + API schema + metric definitions
 → raw receipt/checkpoint ตาม Integration owner
 → project allowed metrics through one writer path
 → commit completed partition/report snapshot
 → expose freshness/status to query module
 → authorized notification on final failure when configured
```

รายละเอียด reliability:
- Identical concurrent refresh ของ asset/window/dataset เดียวกัน coalesce/reuse ตาม approved policy; idempotency key เปลี่ยน payload ต้อง conflict ไม่ reuse ผิดงาน
- ใช้ internal syncRunId แยก n8n execution ID และ provider report-job ID; เก็บ mapping ไม่เรียกทั้งสามว่า run ตัวเดียว
- Cursor/pagination/async report completion ต้อง durable/bounded; success page แรกไม่แปลว่าช่วงข้อมูลครบ
- Snapshot ใหม่ที่ยังไม่ครบไม่แทน last-good ทั้งชุด. ถ้าเปิด partial view ให้มี coverage flag; แบรนด์หนึ่ง fail ไม่ทำให้อีกแบรนด์ใช้ข้อมูลปน
- Recurring upsert ตาม natural grain + version semantics; late corrections ไม่ double count. ห้าม delete history outside 28-day window
- Initial backfill กับ recent refresh เป็น jobs คนละ intent/quota priority. 90-day comparison จะต้องมี coverage เพียงพอ; ไม่กวาด 180 วันทุก request โดยอัตโนมัติ
- Retry baseline once after 5 min. Classify permanent auth/schema กับ transient; provider Retry-After/quota safety ที่กำหนดให้รอนานกว่าให้ defer อย่างเปิดเผยไม่ละเมิด provider restriction และบันทึก operational amendment
- รักษา 200 calls/hour/app project cap จนมี approved config change พร้อมตรวจ actual provider limit; ต้องประสาน limiter กับ clients เดิมทั้ง app/token group ไม่คิด quota แยก worker แล้วรวมเกิน
- หลัง timeout/worker restart ใช้ request/receipt/cursor เดิม reconcile. ห้าม mark COMPLETED ก่อน commit/report freshness พร้อม
- Manual refresh route return accepted/coalesced status กับ syncRunId ไม่ตอบว่าข้อมูลใหม่พร้อมก่อนงานจบ. Refresh display cache อย่างเดียวไม่เท่ากับ provider sync
- Failure alert body จำกัด brand display name + safe code + correlation; ไม่ส่ง token/raw payload/customer data. Dedup alert ต่อ failure intent
- LINE Notify ใช้ไม่ได้ตาม EXT-1; NotificationPort reuse ของที่ได้รับอนุญาตหรือ marked unavailable. การ alert ไม่พร้อมต้องบอกชัด ไม่กลบ sync outcome หรืออ้าง acceptance LINE ผ่าน
- POST callback/refresh ต้อง auth/CSRF/replay control ตาม mechanism เดิม. ห้าม webhook anonymous เขียนทุก brand

## 9. Query API และ CSV

รักษา endpoints baseline หรือใช้ compatible forwarding ที่ได้รับ review ไม่เปลี่ยน namespace เพราะย้าย owner เข้า Marketing:

```http
GET /api/insights/summary?brand=...&from=...&to=...
GET /api/insights/metric/:metricKey?brand=...&from=...&to=...
GET /api/insights/metric/:metricKey/export?brand=...&from=...&to=...
GET /api/insights/content?brand=...&from=...&to=...&type=all|post|story|reel|live
```

- Validate brand/asset/metric/date/type/limits strictly. เก็บ response shape baseline จนมี reviewed evolution
- Quality/coverage/source version/snapshot refs และ nullable metrics ต้องมี negotiated representation; ห้ามใช้ default0 เป็นทางลัดเพื่อรักษา shape อย่างผิดความหมาย
- Proposed POST refresh/status routes เป็น delta หรือ reuse existing equivalents. ไม่มี side effect ใน GET report
- Query handlers อ่าน report data จาก Supabase เท่านั้น. Authority/session validation ยังจำเป็น แต่ห้ามฉวยเป็นทางเรียก Graph API เพื่อนับยอดสด
- API serializers ไม่ expose database service keys/provider credentials/raw private URLs
- CSV ใช้ exact scope/asset/date/filter/metric definition และ snapshot ของ chart; ถ้า snapshot expire ให้แจ้ง refresh ไม่เปลี่ยนเป็นล่าสุดเงียบ ๆ
- CSV encoding/escaping/newlines/Thai text ต้องถูกต้อง; ป้องกัน spreadsheet formula injection ใน untrusted text cells โดยไม่เปลี่ยน numeric metrics ให้ผิดค่า
- Bounded stream/pagination/memory; export ไม่โหลดข้อมูลทุกแบรนด์หรือทุกช่วงเวลาเงียบ ๆ
- `under 500 ms server response` เป็น acceptance target จาก source ไม่ใช่คำรับประกันของ agent. วัด environment/data volume/indexes/warm-vs-cold/concurrency, p50/p95/p99/max และ observed violations. อย่าลด requirement เป็น p95 โดยไม่ review

## 10. UI — สร้างตาม source ไม่ทำ dashboard ใหม่คนละเรื่อง

ใช้ chart library/design tokens/locale/accessibility patterns ของ Ads Dashboard เดิม ไม่เพิ่ม library เพราะ mock สวยกว่า

ต้องมีตาม source:
- `<InsightsLayout>`: brand + Page/asset selector, date range, Overview/Results/Content tabs; URL-state/shareable links พร้อม reauthorization
- `<InsightsOverview>`: `<MetricCard>`, `<Sparkline>`, totals/change และ links ไป Results
- `<InsightsResults>`: `<MetricChart>` full-width และ Export CSV ของ chart นั้น
- `<InsightsContent>`: `<ContentTypeFilter>`, `<OrganicPaidChart>`, `<TopContentList>`, `<FormatBreakdown>` ทั้ง Published/Views/Interactions

รายละเอียดที่ต้องไม่หลุด:
- ทั้ง 3 brands ใช้ data paths เดียวตาม bindings ไม่ hardcode credentials/queries แยกแบรนด์
- แยก content_type (Post/Story/Reel/Live) จาก format (photo/video/text/link). Filter ต้องกระทบ summary/topContent/byFormat อย่างสอดคล้อง
- Show loading/empty/not-synced/unsupported/permission-denied/partial/stale/syncing/error states ต่างกัน ไม่ทำกราฟ zero เมื่อไม่มีข้อมูล
- บอก period semantics และ last-synced/covered window. Unique metrics ที่ aggregate ไม่ได้แจ้งชัด
- เมื่อเปลี่ยน brand หรือ dates ให้ cancel/scope-key response, reset selection ที่ไม่เข้ากัน และไม่ให้ request เก่าของ A เขียนทับหน้าของ B
- Date changes ไม่ full reload; history/back navigation คง selection; error message ภาษาไทยอ่านง่าย
- Conversions เป็น labeled placeholder ไม่มี invented order/lead count. ไม่เชื่อม SCM/CRM เพียงเพื่อให้ช่องนี้เต็ม
- Permalink/thumbnail validate scheme/domains ตาม policy; missing/revoked/expired preview ไม่กระทบตัวเลข. ไม่ auto-fetch arbitrary remote URL หรือเปลี่ยนเป็น Files migration project
- ไม่มี Boost/Edit/Publish buttons ที่ซ่อน endpoint เขียนจริงไว้; link out ตาม source เท่านั้น
- Keyboard labels/focus/legends, date/number/unit formatting และสถานะที่ไม่พึ่งสีอย่างเดียว

## 11. ทำขนานกับ S1–S5/MC0 อย่างไร

**เปิด S6 ใหม่ได้ทันทีสำหรับ discovery, metric/DTO reconciliation, pure tests และ owned module/UI work. ไม่ต้องรอ S1–S5 refactor เสร็จทั้งหมด** แต่แต่ละ shared seam ต้องมี owner agreement ก่อนเปลี่ยน

| Lane | จุดประสาน | ระหว่างรอทำอะไรต่อได้ |
|---|---|---|
| S1 Conversation Runtime / shared integrator เดิม | shared auth, Integration substrate, registries/CI; ไม่แก้ LINE turn/queue/executor | Insights pure core, schema proposal, scoped query tests, UI fixtures |
| S2 Work Management | ไม่ใช่ prerequisite ของ reporting; handoff งานในอนาคตเป็นอีก scope | ทำ reporting ทั้ง baseline ต่อโดยไม่รอ PM extraction |
| S3 Files/SOT | optional media/export references เฉพาะที่ต้องใช้; ไม่ย้าย FileAsset/MinIO implementation | CSV streaming, safe thumbnail placeholder และ reporting ไม่ต้องรอ SOT editor |
| S4 Market Intelligence | Marketing Insights วัด own connected assets; Market วัด external market evidence. ไม่แย่ง MarketObservation หรือ supplier intelligence | ทำ own report model; connector read seam ประสาน Integration owner |
| S5 SCM | Conversions/revenue future owner contract ไม่อยู่ baseline; ห้ามอ่านตาราง Sales/Payment ตรงเพื่อเติม placeholder | คง Conversions unavailable ไม่ block Meta reporting |
| Integration/n8n owner | canonical Meta client, connections, raw receipts, quota/notification; ไม่มี session owner ให้ชี้ assignee unresolved ไม่ยึดทั้งหมดเอง | test provider ports + projections/queries/UI โดยระบุ LIVE/OWNER integration pending |
| MC0 | registration/status/inbox เมื่อ broker/adapters ติดตั้งและยืนยันแล้ว | handoff/status delta files ใช้แทนได้; MC0 ไม่พร้อมไม่เป็น hard-start gate |

Owned paths ของ S6 ต้องบันทึกจาก actual layout: Insights-only code/components/routes/tests, relevant report schema changes/workflow exports ที่ได้รับ assignment. อย่า claim ทั้ง `marketing/**` หรือ `platform/integrations/**` หาก lane อื่นถืออยู่

Shared files เช่น root workflow/Compose/package manifest, permission registry, common Prisma/Supabase migrations, ID ledger, roadmap และ generated docs ให้มี integration owner คนเดียวตาม latest handoff. เตรียม patch ใน worktree ตัวเอง ส่ง exact SHA/tests/ordering ห้ามแก้ working tree/branch ของคนอื่นหรือยัดทุกอย่างลง PR #542

ตรวจ latest status ไม่ยึด head/สถานะ PR ในแชตเก่าเป็นปัจจุบัน. Prompt นี้ไม่เปลี่ยน prerequisite เดิมของ S2 และไม่ authorize S6 ให้ทำ Marketing extraction/SCM หรือ MC0 implementation แทน

## 12. ลำดับลงมือ — ทำงานที่รันได้ทีละเส้นทาง

| Tranche | ผลลัพธ์ขั้นต่ำ | Gate ที่ต้องผ่าน |
|---|---|---|
| I0 | Actual target/client/workflow/stack/ownership inventory + baseline traceability + reconciliation/metric matrix | repo access และ task ownership; ไม่ต้องมี live provider |
| I1 | Pure metric functions + scoped query contract + representative fixtures/test DB/read-model slice | semantic/DTO deltas ที่กระทบ slice ต้อง review; no fabricated live data |
| I2 | One real end-to-end test path: existing-client test adapter → sync writer → PostgreSQL → API → Overview | existing client seam, test authority, migration owner; provider fake ยังไม่ใช่ live proof |
| I3 | Results + CSV + Content + asset/date/type/format/breakdown ครบ; isolation/performance/coverage tests | exact reporting definitions และ scope contract |
| I4 | n8n import/run on disposable test config, schedule/manual/retry/recovery/alert adapter tests | workflow/notification integration assignment; no production activation |
| I5 | Provider-by-provider/brand-by-brand **authorized live read** และ capability/backfill proof แยกจาก mocks | explicit test connection/assets/window/budget approval; credentials resolved only by owner |
| I6 | Mandatory CI/regression, browser proof, operating runbook, handoff/status delta + remaining gaps | accepted scope; report partial if live or compatibility gates missing |

เริ่ม Page report slice ก่อนเพื่อให้มี vertical slice จริงได้ แต่ Purpose ของ contract ยังครอบ ad accounts; enumerate และส่งมอบ report coverage ที่ตกลง ไม่ประกาศ feature ทั้งหมดเสร็จจาก Page mock เดียว

ให้ reviewable PR/commit ตามกติกา repo. เอกสาร/source-of-truth amendment, local implementation, provider conformance และ production rollout อาจเป็นคนละ checkpoint. ห้ามสร้าง skeleton ครบทุกหน้าแล้วถือว่างานเสร็จ และห้ามซ่อน live blockers เพื่อได้ป้าย COMPLETE

## 13. Acceptance / test matrix

เก็บ traceability กลับ Appendix A acceptance ทุกข้อ ไม่ใช้ test count มากแทนสิ่งที่ยังขาด

### A. Unit — ไม่มี Next/DB/Meta/n8n runtime
- additive/non-additive metric rules, disjoint/overlapping dimensions, zero/null/unsupported/threshold-like restrictions ที่ provider ให้จริง
- Views vs Viewers distinction, period/lifetime/publish-cohort semantics, previous-period coverage, prior=0, watch-time units
- Date/timezone boundaries/current partial day, ranking stable tie, Content filter vs format distinct, percentages with comparable denominators
- Correction/revision identity, numeric precision/overflow, response mapper completeness, CSV quoting/Thai/formula injection protection

### B. Component — disposable PostgreSQL/Supabase-compatible auth tests
- upsert same grain is replay-safe, correction does not double count, partial partitions don't overwrite last-good silently
- scopes INFRESH/Glowcea/056 Laos; multiple pages per brand, multi-brand authorized actor, unauthorized brand selector, unknown asset/account mismatch
- RLS with anon/authenticated roles and actual policies; restricted privileged job path; views/RPC/exports/caches obey access
- schedule/manual collision, lease expiry/stale callback, restart after partial page/write, duplicate notification and idempotency conflict
- consistent snapshot API/export during concurrent sync and current access revoked after snapshot creation

### C. Provider / orchestration conformance
- All Graph calls flow through existing client; no second HTTP client in UI/n8n shortcut/report server
- API-version metric mapping, permissions per Page/Post/Ad account, pagination and async completion, unsupported fields, token expiry/revocation and safe errors
- Exact quota group + project cap, retry/defer policy, sanitized request receipts, raw evidence lineage
- n8n exported workflow can be imported and executed in allowed disposable environment; schedule timezone/manual job observed
- LINE replacement notification adapter has separate proof. Fake alert log is not live LINE delivery

### D. Browser / non-functional
- Overview/Results/Content + selectors/date URL state/no full reload + chart drills work
- all three brand IDs in synthetic tests; display exact selected asset not hidden all-brand aggregate
- rapid brand/date switch doesn't leak stale responses; loading/empty/partial/stale/unsupported consistent
- organic/paid chart and byFormat use correct definitions; Conversions placeholder has no invented numbers or writes
- chart/export agree using frozen report view even if sync runs concurrently
- network audit for GETs/render/export shows no Graph API calls server or client side
- under-500ms server target measured with stated data volume/cache/index/environment and percentiles/max; failures reported not hidden by smaller toy fixture

### E. Live acceptance ตาม source — **แยกจากชุดทดสอบจำลอง**
- real synced Overview/Results/Content ของทุก configured brand/asset ที่ contract ครอบ พร้อม period/API/capability/freshness proof
- authorized schedule/manual/failure LINE outcomes มีหลักฐานจริงเฉพาะเมื่อ activation/read/send scope ได้รับอนุญาต
- ถ้าไม่มี live authorization ต้องเป็น PARTIAL/NOT_RUN ตามข้อนั้น **ไม่ลด acceptance ให้ fixtures เพียงอย่างเดียว**

ก่อน ready for review รัน mandatory repo checks/affected regressions. ไม่รัน full platform E2E ทุกบรรทัด แต่ห้ามตัด mandatory gate. ห้าม skip/disable tests, ลด assertion หรือใช้ retries/timeouts กลบ flaky failures

## 14. Safety / environment

- แยก worktree, branch, writable dependencies, generated clients, DB, ports, Compose project/volumes และ artifacts. Worktree ไม่แยก Docker daemon หรือ live Supabase ให้อัตโนมัติ
- ใช้ synthetic fixtures เท่านั้นใน git. ห้าม commit actual ad reports, account IDs ที่ private, tokens, signed URLs, customer data หรือ private pricing ลง public repository
- ไม่เปิดหรือคัดลอก production `.env`, secret dumps, n8n credentials export, Supabase service-role keys หรือ edge pairing secrets. ใช้ documented secret references/approved runtime resolver
- ไม่ `down -v`, prune/reset DB, reinitialize MinIO, change bucket policy, replace API client auth ทั้งระบบ หรือ production migration เพื่อให้ test ผ่าน
- Source/read sync เป็น domain scope ของ feature ไม่ authorize ad changes, OAuth scope elevation, provider account creation, spend, outbound social post, message to customers หรือ live LINE alert
- ไม่เปลี่ยน SecretManager/Identity rules, global role, canonical IDs หรือ RLS เป็น allow-all
- n8n workflow imported for dev/test must be isolated and clearly labeled; no silent activation of schedule on production
- Pure report/UI output from provider content is untrusted. Sanitize text/URLs and do not execute content/scripts
- การขาด credential เป็น local blocker ไม่ใช่เหตุสร้าง unauthorized scraper/browser login workaround

## 15. Deliverables และการติดตามสถานะ

ส่งมอบตาม canonical docs/template ที่พบ; ชื่อด้านล่างเป็น working artifacts ไม่ใช่บังคับเพิ่ม FR/ADR IDs:

1. `INSIGHTS-CONTRACT-RECONCILIATION.md` — target/source traceability, baseline vs proposed changes และ decisions ที่ยังไม่ approved
2. `INSIGHTS-METRIC-COMPATIBILITY.md` — per-metric/asset/API/account compatibility + aggregation/period/unit/null/source coverage + verification dates
3. Implementation ของ Insights module/UI/query repositories และ bounded Integration/n8n changes; migration/export files ไม่มี secrets
4. Tests/fixtures + provider/browser/performance/recovery evidence แยกจาก live proof
5. Operating runbook: test setup, initial backfill, scheduled refresh, manual refresh, gaps/retries/notifications, revocation, rollback และ activation gate
6. `MARKETING-INSIGHTS-HANDOFF.md` ใน canonical feature/refactor handoff location พร้อม exact source/implementation/test SHA และ next exact action
7. Status delta ให้ integrator เพิ่ม **S6 — Marketing Insights (feature delivery, NOT service extraction)** ลง tracker. ถ้า tracker มีเฉพาะ refactor ให้เพิ่ม section linked feature lane ตาม protocol ไม่เปลี่ยน Marketing extraction row เป็น completed

ข้อมูล status ต้องแยกอย่างน้อย:
`TARGET_APP_VERIFIED`, `CONTRACT_RECONCILED`, `METRIC_MAPPING_VERIFIED`, `CODE_IMPLEMENTED`, `UNIT_COMPONENT_VERIFIED`, `SCOPE_RLS_VERIFIED`, `UI_VERIFIED`, `N8N_TEST_RUN_VERIFIED`, `META_LIVE_READ_VERIFIED`, `REAL_DATA_ALL_BRANDS_VERIFIED`, `LINE_ALERT_VERIFIED`, `PERFORMANCE_VERIFIED`, `CI_VERIFIED`, `REVIEW_STATUS`, `MERGE_STATUS`, `PRODUCTION_ACTIVATION`.
ใช้ PASS/FAIL/PARTIAL/NOT_RUN/UNKNOWN พร้อม evidence และ tested code SHA ไม่สร้างเปอร์เซ็นต์ completion ตามจำนวนไฟล์

ทุก checkpoint ระบุ:
```yaml
# โครงตัวอย่าง ไม่ใช่การรายงานว่าเริ่มแล้ว
session: S6
workstream: marketing-insights
work_type: FEATURE_MODULE_IMPLEMENTATION
provider: claude-code
repository: null
app_root: null
worktree: null
branch: null
base_sha: null
code_head_sha: null
tested_code_sha: null
pr_number: null
tranche: I0
execution_status: PROMPT_READY
source_contract_sha256: 693f92f04315e68044043d5d8c9cc4be90ca2845fb38e6b498f4fe9a79e14b63
completed: []
verified: []
remaining: []
blockers:
  - dependency: Existing Meta insights client contract
    kind: CONTRACT
    phase_blocked: I2-provider-integration
    owner_to_unblock: Integration owner — ต้องยืนยันจาก actual assignment
    condition_to_unblock: source binding + reviewed DTO/version + test adapter evidence
    safe_work_now: [metric reconciliation, pure tests, scoped query and UI fixtures]
next_action: Inspect actual target and ownership, then implement first non-blocked slice
board_update: PENDING
mc0_registration: NOT_VERIFIED
production_activation: NOT_RUN
```

MC0 integration เป็น optional coordination path:
- ถ้า MC0 service/MCP tools ถูกติดตั้งและอนุญาตแล้ว ลงทะเบียน actual S6/provider/cwd/session ID, challenge/ACK และ report ตาม protocol
- Tool names/endpoints ต้อง discovery จากของจริง ไม่ hardcode ว่ามี `mc_*` เพราะเคยกล่าวในแชต
- ถ้า broker ไม่พร้อม ใช้ handoff + delta ให้ integrator/manual forwarding. ห้ามอ้างส่งถึง agent ถ้าแค่ส่งเข้า broker; receipt/agent ACK แยกกัน
- ไม่ย้าย/kill/resume session คนอื่นเพื่อให้สื่อสารได้ และไม่แย่ง integrator role จาก S1 โดยไม่มี explicit handoff
- ทุก lane ส่งสถานะของตัวเอง; S6 ไม่ทับสถานะ S1–S5 หรือเปิด dependency gate ของผู้อื่นจากการคาดเดา

## 16. เริ่มดำเนินงาน

เริ่มด้วยรายงานสั้นว่า target อยู่ไหน, baseline ที่อ่าน, client/workflows ที่พบจริง, conflicts/ownership และ tranche ที่ทำได้ จากนั้นลงมือ implementation และ tests ใน owned scope ไม่หยุดที่ design-only หรือ scaffold-only

เมื่อมี blocker ให้ระบุ **ติดอะไรใน phase ไหน ใครต้องส่งอะไรเพื่อปลดล็อก และยังทำอะไรต่อได้** ห้ามใช้ข้อความกว้าง ๆ ว่า “รอ Files/SCM/Marketing ทั้งหมด”

จบ checkpoint ด้วยผลจาก commands จริง (counts/exit codes/timings/artifacts), actual code/test/head state, remaining acceptance และ next exact action. ไม่สรุปว่ารันอยู่เบื้องหลังหรือจะส่งผลให้ภายหลังโดยไม่มี runtime ที่เปิดและตรวจแล้ว

## External references — แยกจาก source contract

ข้อมูลภายนอกสองรายการนี้ตรวจเมื่อ 24 กันยายน 2026 เพื่อระบุ compatibility/security findings ไม่ใช่แก้ Appendix A:

- **EXT-1** LINE Developers, “LINE Notify service has been terminated as of March 31, 2025”: https://developers.line.biz/en/news/2025/04/01/line-notify/
  ผลต่อ implementation: notification dependency เดิมต้อง reconcile ก่อนใช้งานจริง; ไม่อนุญาตเปิด Messaging API/ส่งจริงโดยปริยาย
- **EXT-2** Supabase, “Row Level Security”: https://supabase.com/docs/guides/database/postgres/row-level-security
  ผลต่อ implementation: ทดสอบ exposed tables/views/RPC/privileged path ตาม role จริง ไม่ถือ service-key test เป็นหลักฐานว่า browser access isolated แล้ว

Meta field/period/permission/quota compatibility **ยังไม่ถูกยืนยันโดย prompt นี้**. Implementation agent ต้องตรวจ official Meta documentation และ authorized account evidence ของ API version ที่ใช้งานจริง พร้อมแหล่งอ้างอิงและวันที่ตรวจ. หากอ่านแหล่งไม่ได้ให้ UNVERIFIED ไม่แทนด้วย guess

---

## Appendix A — `contract.md` ต้นฉบับครบถ้วน (verbatim)

ข้อความด้านล่างเป็น baseline ที่ผู้ใช้ให้มา ไม่ใช่ source ใหม่ที่ถูกแก้แล้ว ข้อเสนอ/compatibility findings อยู่ด้านบนและต้อง trace กลับ baseline section

````markdown
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
````
