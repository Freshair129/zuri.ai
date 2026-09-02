# มิติที่ 1 — Layer journey: Landing → Login → Entry → Business Routing → BusinessShell → Domain → Sub-domain → Project resource → Platform / Control

| ฟิลด์ | ค่า |
|---|---|
| รายงาน | มิติที่ 1 — Layer journey: Landing → Login → Entry → Business Routing → BusinessShell → Domain → Sub-domain → Project resource → Platform / Control |
| วันที่ | 2026-09-02 |
| ขอบเขต | เดินตาม product layer ทีละชั้นตามลำดับที่ผู้ใช้จริงพบเจอ (Landing → Login/Signup/Reset → Entry (viewer/onboarding) → Business Routing → BusinessShell → Domain → Sub-domain → Project resource → Platform/Control) แล้วตรวจต่อชั้นว่า: (1) หน้ามีจริงหรือไม่ (2) API ที่รองรับมีจริงหรือไม่ (3) มี guard ชั้นใดป้องกัน (4) รองรับ state ใดบ้าง (loading/empty/error/unauthorized/session หมดอายุ) (5) target ที่อนุมัติแล้ว (ADR-015, ADR-027, ROUTES-SITEMAP.md, INTERFACE-INVENTORY.md) ตรงกับ route tree จริงหรือไม่ และ (6) มี test (unit/integration/e2e) พิสูจน์หรือไม่ |
| วิธีการ | Pipeline: finder → adversarial verifier → section → assemble → critic; แบ่งการตรวจเป็น 3 หน่วย (entry-layers, shell-domain-layers, journey-states-tests-docs) ทำงานอิสระต่อกันแล้วนำผลมารวม; หลักฐานทุกจุดอ้างอิงเป็น file:line จาก repository ที่ HEAD ณ วันที่ 2026-09-02; ไม่มีการรัน server/test ใด ๆ (static analysis เท่านั้น — ดูภาคผนวก ข) |
| แหล่งอ้างอิงหลัก | docs/PRD-SDD-v1.0.md, docs/roadmap/ROADMAP.md, docs/domains/*/CHARTER.md, docs/INTERFACE-INVENTORY.md, docs/TRACE.md, docs/FEATURE-MAP.md, docs/DOMAIN-MAP.md, docs/ROUTES-SITEMAP.md, docs/PRODUCT.md, docs/decisions/ADR-015, docs/decisions/ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md, docs/appendices/A-api-spec.md, src/config/domains.js, src/context/ScopeContext.jsx |
| ความสัมพันธ์กับเอกสารเดิม | docs/GAP-ANALYSIS-ZURI-GOVIBE.md เป็นการวิเคราะห์ช่องว่างข้ามระบบ (Zuri ↔ GoVibe Mission Control) — คนละขอบเขตกับรายงานนี้ รายงานนี้จำกัดเฉพาะภายใน repo zuri-ai เอง (in-repo layer journey) และไม่ทำซ้ำเนื้อหาของเอกสารนั้น หากมีประเด็นทับซ้อนจะอ้างอิงกลับไปยังเอกสารนั้นแทนการคัดลอกเนื้อหา |

## บทสรุปผู้บริหาร

การเดิน journey ทีละชั้นจาก Landing จนถึง Platform/Control พบว่าโครงสร้างหลัก (routing, guard, config) ถูกวางไว้อย่างเป็นระบบและสอดคล้องกับ PRD ในหลายจุด แต่มีช่องว่างที่ต้องแก้ไขกระจายอยู่ทุกชั้น ตั้งแต่บั๊กที่ทำให้ทั้งฟีเจอร์ใช้งานไม่ได้จริง ไปจนถึงฟีเจอร์ backend ที่ประกาศว่า "implemented" แต่ไม่มีทางเข้าถึงจาก UI เลย และเอกสารอ้างอิง (ROUTES-SITEMAP.md, ADR-027) ที่ล้าสมัยกว่าของจริงในโค้ด ประเด็นสำคัญที่สุด 15 รายการมีดังนี้:

- **D1-shell-domain-layers-01 (CRITICAL)** — หน้า SoT Pipeline ทั้งสามหน้า (`/platform/sot-pipeline`, `/inbox`, `/graph`) ใช้งานไม่ได้จริงในเบราว์เซอร์เลย เพราะ `useScope()` ถูก destructure ผิดฟิลด์ (`businessId` ที่ไม่มีอยู่จริงในค่าที่ context คืนมา) ทำให้ทั้งสามหน้าค้างอยู่ที่ ErrorState เสมอ ไม่ว่าจะเลือก Business แล้วหรือไม่ — FEAT-011 (SoT Pipeline Console) จึงไม่ทำงานจริงในโปรดักชันแม้จะรายงานว่า deployed แล้ว
- **D1-shell-domain-layers-07 (HIGH)** — ต้นเหตุที่ทำให้บั๊กข้างต้นหลุดผ่านการทดสอบ: unit test ทั้งหมดของชั้น shell/navigation อ่านซอร์สโค้ด `.jsx` เป็น string แล้วเทียบ substring แทนที่จะ render component จริง — 0 จาก 264 ไฟล์ใน tests/unit render component จริงเลย (ไฟล์เดียวที่ grep ผิวเผินเคยเข้าใจว่าใช้ `@testing-library/react` จริง ๆ เป็นเพียงคอมเมนต์อธิบายว่า repo นี้ไม่มี dependency ตัวนี้) จึงตรวจจับ runtime bug แบบ D1-01 ไม่ได้
- **D1-shell-domain-layers-02 (HIGH)** — หน้า `/market` (FR-092) แสดงข้อมูล mock 100% ไม่มีการเรียก API เลยสักครั้ง และปุ่ม "New Watch Rule" เป็นเพียง `alert()` stub ทั้งที่ INTERFACE-INVENTORY.md ระบุว่าเป็น "implemented beta" ที่มี real-time tracking
- **D1-entry-layers-08 (HIGH)** — FR-067 (owner-side collaboration: mint/revoke invite, remove member) ถูก implement ครบที่ระดับ route/service และมีการทดสอบ แต่ไม่มีทางเข้าถึงจาก UI เลยแม้แต่จุดเดียว — owner ไม่มีปุ่มเชิญสมาชิกในผลิตภัณฑ์จริง
- **D1-journey-states-tests-docs-01 (HIGH)** — guard เกือบทุกจุดในระบบ (ยกเว้น plugin-consent จุดเดียว) ยุบ 503 SESSION_UNAVAILABLE (ระบบ session ล่ม) ให้กลายเป็น redirect ไปหน้า /login เหมือนกับ 401 AUTH_REQUIRED (ไม่ได้ล็อกอินจริง) ทำให้ผู้ใช้ที่ล็อกอินอยู่แล้วถูกเด้งออกโดยไม่มีคำอธิบายเมื่อ session store ล่มชั่วคราว (ครอบคลุมกรณีเดียวกันที่ D1-entry-layers-09 อธิบายเจาะจงสำหรับหน้า pre-shell ทั้งสี่ — หลังการตรวจสอบของ critic ปรับระดับ D1-entry-layers-09 ขึ้นเป็น HIGH ให้ตรงกัน)
- **D1-journey-states-tests-docs-02 (HIGH)** — PlatformGrant (สิทธิ์ OPERATOR) มี schema รองรับการ revoke (`revokedAt`, `revokeReason`) และ PRD ระบุว่า "revocable" แต่ไม่มี code path ใดในระบบที่เขียนค่านี้จริง — การถอนสิทธิ์ operator ทำได้เฉพาะการเข้าไปแก้ database ตรง ๆ เท่านั้น
- **D1-journey-states-tests-docs-12 (HIGH)** — `/control/roadmap` (FR-105, Platform Control) ไม่มี inbound link จากที่ใดในแอปเลย (ไม่มีใน DomainBar/Sidebar/CommandPalette/Topbar) และ `PlatformControlShell` ไม่มีทางกลับ `/overview` — operator เข้าถึงหน้านี้ได้ด้วยการพิมพ์ URL เอง หรือกดปุ่ม back ของเบราว์เซอร์เพื่อออกเท่านั้น ตรงกับ defect class เดียวกับที่ `tests/e2e/navigation-reachability.spec.js` เขียนขึ้นมาเพื่อจับ (critic-added)
- **D1-entry-layers-01 (MEDIUM)** — `POST /api/auth/logout` implement และทดสอบครบถ้วน แต่ไม่มีปุ่ม sign-out ที่ไหนในแอปเลย ผู้ใช้ไม่มีทางออกจากระบบยกเว้นปล่อยให้ cookie หมดอายุเอง
- **D1-journey-states-tests-docs-03 (MEDIUM)** — ไม่มีเส้นทาง UI หรือ CLI ใดในการเพิ่ม operator คนที่สองหรือ successor เมื่อมี operator คนแรกอยู่แล้ว (`bootstrapOperator()` ปฏิเสธเสมอ) — หาก operator คนเดียวที่มีถูกล็อกบัญชี ระบบไม่มีกลไกกู้คืนสิทธิ์
- **D1-shell-domain-layers-06 (MEDIUM)** — ไม่มี `not-found.jsx`/`error.jsx`/`loading.jsx` ที่ไหนใน `src/app` เลย การเข้า URL ของ domain ที่ soon:true (`/commerce`, `/growth`, `/operations`) หรือ URL พิมพ์ผิดจะเจอหน้า Next.js 404 เปล่า ๆ ไม่มี AppShell chrome
- **D1-journey-states-tests-docs-07 (MEDIUM)** — Platform Control layer ทั้งชั้น (`/control/roadmap`, FR-105) ไม่มีหลักฐาน e2e เลยแม้จะรายงานว่า deployed สู่ production แล้ว ต่างจาก FR ระดับเดียวกันอื่น ๆ ที่มี Playwright spec เฉพาะ
- **D1-entry-layers-03 / D1-journey-states-tests-docs-04 (MEDIUM)** — `docs/ROUTES-SITEMAP.md` ยังคงบรรยาย FR-066/067 (profile-first onboarding) ว่า "ยังไม่ implement" ทั้งที่ PRD-SDD และโค้ดจริงยืนยันว่า implement และทดสอบแล้ว เอกสารนี้ไม่ได้อัปเดตตั้งแต่ 2026-08-17
- **D1-entry-layers-04 (MEDIUM)** — ADR-027 D8 กำหนด path เป้าหมายเป็น `/workspaces` แต่ path นี้ถูกใช้ไปแล้วโดยหน้า PM Space (FR-001) ทำให้ของจริงต้อง ship เป็น `/workspace-home` แทน โดยไม่มีการแก้ ADR หรือ ROUTES-SITEMAP.md ให้ตรงกัน
- **D1-shell-domain-layers-04 / D1-shell-domain-layers-08 (MEDIUM)** — เอกสารสร้างอัตโนมัติ/กึ่งอัตโนมัติสองฉบับขัดแย้งกันเอง: marker ที่ตรวจสอบด้วยเครื่องใน INTERFACE-INVENTORY.md บอกว่ามี 8 operational domains (ถูกต้อง) แต่ตาราง prose ในเอกสารเดียวกันบอกว่ามี 7 (ไม่รวม market); ROUTES-SITEMAP.md ขาด route ที่ implement แล้วอย่างน้อย 8 เส้นทาง
- **D1-journey-states-tests-docs-10 (LOW)** — เมื่อ guard ตัดสินใจ FORBIDDEN (ไม่มีสิทธิ์เข้า domain/Business) ระบบไม่เคยแสดงข้อความอธิบายที่ชัดเจน มีแต่ redirect เงียบ ๆ กลับไป Overview เสมอ ขัดกับคำอธิบายใน ROUTES-SITEMAP.md ที่บอกว่ามีทั้งสองแบบ

**บทสรุปภาพรวมของมิตินี้**: โครงสร้าง journey หลัก (routing, guard framework, domain registry, 44 หน้าใต้ BusinessShell) ถูกสร้างและเชื่อมต่อกันอย่างเป็นระบบ ไม่มีช่องโหว่ด้านความปลอดภัยที่ทำให้ข้อมูลรั่ว (ทุก guard ป้องกันการ leak ได้จริง) แต่มีจุดเดียวที่เป็น CRITICAL คือฟีเจอร์ทั้งชุด (SoT Pipeline Console) ใช้งานไม่ได้จริงเพราะบั๊กเล็ก ๆ ในการอ่าน scope ที่ไม่มี test ใดจับได้ — สะท้อนช่องว่างเชิงระบบในวิธีทดสอบ UI (string-matching แทน rendering) มากกว่าที่จะเป็นปัญหาจุดเดียว รองลงมาคือรูปแบบซ้ำ ๆ ของ "backend/route ทำเสร็จ แต่ไม่มี UI ทางเข้า" (logout, FR-067 invite management, operator revoke/succession) และเอกสารอ้างอิง (ROUTES-SITEMAP.md, ADR-027) ที่ตามหลังโค้ดจริงไปหลายสัปดาห์ในหลายจุด ภาพรวมคือ "ใช้งานได้แต่ยังไม่พร้อมเป็น production-grade ทุกชั้น" — ต้องปิดบั๊ก CRITICAL ก่อนอันดับแรก ตามด้วยการเติม UI ที่ขาดหายให้ฟีเจอร์ backend ที่ทำเสร็จแล้ว และสุดท้ายคือการทำความสะอาดเอกสารให้ตรงกับของจริง

## ตารางสรุปตามหน่วยตรวจ

| หน่วย | รายการที่ตรวจ | CRITICAL | HIGH | MEDIUM | LOW | INFO | สถานะโดยรวม |
|---|---|---|---|---|---|---|---|
| entry-layers | 22 | 0 | 2 | 5 | 4 | 0 | มีช่องโหว่ระดับ HIGH 2 จุด (FR-067 ไม่มี UI; 503/401 collapse บนหน้า pre-shell ทั้งสี่ — ปรับระดับให้ตรงกับ D1-journey-states-tests-docs-01 แล้ว) ต้องแก้ก่อนถือว่าฟีเจอร์นี้ใช้งานได้จริง |
| shell-domain-layers | 40 | 1 | 2 | 8 | 2 | 0 | วิกฤต — มีฟีเจอร์ (SoT Pipeline) ใช้งานไม่ได้จริงในสภาพที่รายงานว่า deployed แล้ว ต้องแก้ไขทันที |
| journey-states-tests-docs | 33 | 0 | 3 | 8 | 1 | 0 | มีช่องโหว่ระดับ HIGH 3 จุด (503/401 collapse, PlatformGrant revoke ไม่มีจริง, `/control/roadmap` ไม่มี inbound link เลย) และเอกสารล้าสมัยจำนวนมาก |
| **รวม** | **95** | **1** | **7** | **21** | **7** | **0** | **36 รายการตาม id — หลังหักรายการที่บรรยายข้อเท็จจริงเดียวกันข้ามหน่วยตรวจซ้ำกัน 5 กลุ่ม (ดูเครื่องหมาย "ซ้ำกับ" ในตารางถัดไป) เหลือ 31 defect ที่แตกต่างกันจริง — 1 CRITICAL ต้องแก้ก่อนอันดับแรก** |

## ตารางสรุปช่องว่างทั้งหมด

| ID | ระดับ | ประเภท | หัวข้อ | หน่วย |
|---|---|---|---|---|
| D1-shell-domain-layers-01 | CRITICAL | BROKEN_FLOW | SoT Pipeline board/inbox/graph ใช้งานไม่ได้จริง — `useScope()` destructure ฟิลด์ที่ไม่มีอยู่ | shell-domain-layers |
| D1-entry-layers-08 | HIGH | BROKEN_FLOW | FR-067 owner-side collaboration (mint/revoke invite, remove member) ทำเสร็จแต่ไม่มี UI เลย | entry-layers |
| D1-shell-domain-layers-02 | HIGH | BROKEN_FLOW | `/market` render ข้อมูล hardcoded 100% ไม่มี API call; "New Watch Rule" เป็น `alert()` stub | shell-domain-layers |
| D1-shell-domain-layers-07 | HIGH | TEST_GAP | 0 จาก 264 ไฟล์ใน tests/unit render component จริง — ไม่มี rendering harness ติดตั้งใน repo เลย | shell-domain-layers |
| D1-journey-states-tests-docs-01 | HIGH | BROKEN_FLOW | ทุก client-side guard ยุบ 503 SESSION_UNAVAILABLE ให้เหมือนกับ 401 AUTH_REQUIRED (รวม D1-entry-layers-09) | journey-states-tests-docs |
| D1-journey-states-tests-docs-02 | HIGH | DECLARED_NOT_BUILT | PlatformGrant ถูกเอกสารว่า "revocable" แต่ไม่มี code path ใดเขียนค่า revoke จริง | journey-states-tests-docs |
| D1-entry-layers-09 | HIGH | PARTIAL | หน้า pre-shell ทั้งสี่ยุบ 503 SESSION_UNAVAILABLE เหมือนกับ 401 AUTH_REQUIRED (ซ้ำกับ D1-journey-states-tests-docs-01 — ปรับระดับให้ตรงกันโดย critic) | entry-layers |
| D1-journey-states-tests-docs-12 | HIGH | BROKEN_FLOW | `/control/roadmap` (FR-105) ไม่มี inbound link จากที่ใดในแอปเลย และ PlatformControlShell ไม่มีทางกลับ — dead-end reachable ด้วยการพิมพ์ URL เท่านั้น (critic-added) | journey-states-tests-docs |
| D1-entry-layers-01 | MEDIUM | BROKEN_FLOW | `POST /api/auth/logout` implement/ทดสอบครบแต่ไม่มี UI trigger ใด ๆ ในแอป | entry-layers |
| D1-entry-layers-03 | MEDIUM | DOC_DRIFT | ROUTES-SITEMAP.md ยังบอกว่า FR-066/067 ไม่ implement ทั้งที่ PRD ระบุ ✅ implemented (ซ้ำกับ D1-shell-domain-layers-04, D1-journey-states-tests-docs-04/06 — ทั้งหมดคือ ROUTES-SITEMAP.md ล้าสมัยจุดเดียวกัน) | entry-layers |
| D1-entry-layers-04 | MEDIUM | DOC_DRIFT | ADR-027 D8 กำหนด path `/workspaces` แต่ path นี้ถูกใช้โดย PM Space page ไปแล้ว (naming collision) | entry-layers |
| D1-entry-layers-06 | MEDIUM | PARTIAL | Mutation handler บนหน้า FR-066 แสดง error code ดิบให้ผู้ใช้เห็น ไม่ redirect ไป /login เมื่อ session หมดอายุ | entry-layers |
| D1-entry-layers-10 | MEDIUM | DOC_DRIFT | `ENTRY_PATHS` ใน ScopeContext.jsx ล้าสมัย — 6 หน้า pre-shell ที่เพิ่มมาทีหลังยิง `/api/scope` ขัดกับ annotation FR-046 ของไฟล์เอง (critic-added) | entry-layers |
| D1-shell-domain-layers-03 | MEDIUM | TEST_GAP | e2e coverage ของ DomainBar/Sidebar navigation ไม่ครบทุก domain (Market/Platform ส่วนใหญ่ไม่มี — CRM มีแล้ว) | shell-domain-layers |
| D1-shell-domain-layers-04 | MEDIUM | DOC_DRIFT | ROUTES-SITEMAP.md route tree/สรุป domain ล้าสมัยเทียบกับ `src/config/domains.js` จริง (ซ้ำกับ D1-entry-layers-03, D1-journey-states-tests-docs-04/06) | shell-domain-layers |
| D1-shell-domain-layers-06 | MEDIUM | MISSING_SURFACE | ไม่มี `not-found.jsx`/`error.jsx`/`loading.jsx` ที่ไหนเลย — soon-domains เจอ Next.js 404 เปล่า | shell-domain-layers |
| D1-shell-domain-layers-08 | MEDIUM | DOC_DRIFT | INTERFACE-INVENTORY.md marker ที่ตรวจด้วยเครื่องขัดแย้งกับตาราง prose ในเอกสารเดียวกัน (ผิดหลายบรรทัด ไม่ใช่แค่ 3) | shell-domain-layers |
| D1-shell-domain-layers-10 | MEDIUM | DOC_DRIFT | เอกสารสร้างอัตโนมัติ (FEATURE-MAP/TRACE) อ้าง `/market` page ที่เป็น mock เป็นหลักฐานว่า FR-092 "✅ live" | shell-domain-layers |
| D1-shell-domain-layers-11 | MEDIUM | DOC_DRIFT | `@tested` annotation ของ `market/page.jsx` อ้างอิง test ที่ไม่เคยแตะหน้าหรือ component นี้เลย (ซ้ำกับ D1-journey-states-tests-docs-08 — ปรับระดับให้ตรงกันโดย critic) | shell-domain-layers |
| D1-shell-domain-layers-12 | MEDIUM | TEST_GAP | `/projects/new` (FR-017 objective intake) ไม่มีทั้ง inventory row และ finding ใด ๆ ในรายงานฉบับก่อนหน้า — click-through coverage มีเพียง `page.goto()` เดียว (critic-added) | shell-domain-layers |
| D1-shell-domain-layers-13 | MEDIUM | PARTIAL | Platform domain ไม่มี Dashboard แยกจาก Settings — สอง nav entries ชี้ `/settings` เดียวกันและถูกทำ `aria-current="page"` พร้อมกันทั้งคู่ (critic-added) | shell-domain-layers |
| D1-journey-states-tests-docs-03 | MEDIUM | MISSING_SURFACE | ไม่มีเส้นทาง UI/CLI สำหรับเพิ่ม operator คนที่สอง/successor เมื่อมี operator คนแรกแล้ว | journey-states-tests-docs |
| D1-journey-states-tests-docs-04 | MEDIUM | DOC_DRIFT | ROUTES-SITEMAP.md ส่วน ADR-027 pre-shell target ยังบอกว่า journey ยังไม่ implement ทั้งที่ shipped แล้ว (ซ้ำกับ D1-entry-layers-03, D1-shell-domain-layers-04, D1-journey-states-tests-docs-06) | journey-states-tests-docs |
| D1-journey-states-tests-docs-05 | MEDIUM | DOC_DRIFT | ADR-027 status header และ FR-044 feature note ยังอ่านว่า "implementation pending" | journey-states-tests-docs |
| D1-journey-states-tests-docs-06 | MEDIUM | DOC_DRIFT | ROUTES-SITEMAP.md route tree ของ BusinessShell/project-resource ขาดหลายเส้นทางที่มีอยู่จริง (ซ้ำกับ D1-entry-layers-03, D1-shell-domain-layers-04, D1-journey-states-tests-docs-04) | journey-states-tests-docs |
| D1-journey-states-tests-docs-07 | MEDIUM | TEST_GAP | Platform Control layer (`/control/roadmap`, FR-105) ไม่มีหลักฐาน e2e แม้ระบุว่า deployed production แล้ว | journey-states-tests-docs |
| D1-journey-states-tests-docs-08 | MEDIUM | TEST_GAP | หน้า Market Intelligence ไม่มี UI-level test เลย และ `@tested` อ้างอิง test ที่ไม่เกี่ยวข้องกับหน้า (ซ้ำกับ D1-shell-domain-layers-11) | journey-states-tests-docs |
| D1-journey-states-tests-docs-09 | MEDIUM | TEST_GAP | FR-066/FR-067 มี unit/integration coverage แต่ไม่มี e2e ต่างจาก entry-layer feature พี่น้องอื่น ๆ | journey-states-tests-docs |
| D1-journey-states-tests-docs-11 | MEDIUM | MISSING_SURFACE | ตัวกรอง entityType ของ Audit browser กรองได้เพียง 16 จาก 46 ค่าที่เขียนจริง — ไม่ใช่แค่ขาด 'PERSON' (ขยายขอบเขตโดย critic) | journey-states-tests-docs |
| D1-entry-layers-02 | LOW | MISSING_SURFACE | `POST /api/auth/login` ไม่มี rate limiting/lockout ต่างจาก signup ที่มี limiter | entry-layers |
| D1-entry-layers-05 | LOW | PARTIAL | ไม่มี `src/middleware.js` — 4 ใน 5 หน้า pre-shell guard ตัวเองแบบ client-side เท่านั้น | entry-layers |
| D1-entry-layers-07 | LOW | TEST_GAP | ไม่มี e2e test สำหรับ `/onboarding/profile`, `/waiting-room`, `/workspace-home` | entry-layers |
| D1-entry-layers-11 | LOW | MISSING_SURFACE | ไม่มีการจัดการสถานะ "ผู้ใช้ล็อกอินอยู่แล้ว" บน `/`, `/login`, `/signup`, `/reset-password` — ไม่ redirect ไป `/businesses` (critic-added) | entry-layers |
| D1-shell-domain-layers-05 | LOW | PARTIAL | `/people` "Dashboard" render component เดียวกับ `/people/directory` ทุกประการยกเว้น title | shell-domain-layers |
| D1-shell-domain-layers-09 | LOW | PARTIAL | Checkbox สิทธิ์ domain บน `/platform/users` แสดง domain ที่ soon:true ซึ่งไม่มีหน้าจริงรองรับ | shell-domain-layers |
| D1-journey-states-tests-docs-10 | LOW | DOC_DRIFT | การตัดสินใจ FORBIDDEN ระดับ domain/Business ไม่เคยแสดงข้อความชัดเจน มีแต่ redirect เงียบ | journey-states-tests-docs |

## รายละเอียดตามหน่วยตรวจ

## entry-layers

#### สรุปย่อ

- สี่เส้นทาง core (Landing/FR-044, Login-Signup-Reset/FR-046/120/104, Plugin Auth/FR-123) ได้รับการนำมาใช้และบูรณาการเต็มที่ด้วย UI entry point ครบถ้วน
- FR-067 owner-side collaboration (mint/revoke invite, remove member) ถูก implement ที่ชั้น route/service อย่างสมบูรณ์ แต่ไม่มี UI caller ใดๆ ในแอป — invitee ด้านรับเชิญจาก waiting-room มีหน้าแต่ owner-side mint ไม่มี
- FR-066 pre-Business journey (onboarding/profile → waiting-room → workspace-home) มี route และ API ครบถ้วน แต่ error handling และ e2e coverage ขาด
- POST /api/auth/logout ถูก implement และทดสอบอย่างสมบูรณ์ แต่ไม่มี UI trigger ใดๆ — ผู้ใช้ไม่มีปุ่ม sign-out
- ไม่มี src/middleware.js — สี่หน้า pre-shell guard ตัวเอง client-side เท่านั้น ยกเว้น /plugin/authorize redirect server-side เฉพาะ
- docs/ROUTES-SITEMAP.md ยังคงบรรยาย FR-066/067 เป็น "not implemented" ทั้งที่ PRD-SDD ระบุ "✅ implemented" แล้ว
- `ENTRY_PATHS` ใน ScopeContext.jsx (และสำเนาซ้ำใน business-shell-guard.js) ล้าสมัย — ไม่ครอบคลุม 6 หน้า pre-shell ที่เพิ่มมาทีหลัง (พบเพิ่มเติมโดย critic)
- ไม่มีการ redirect ผู้ใช้ที่ล็อกอินอยู่แล้วออกจาก `/`, `/login`, `/signup`, `/reset-password` ไป `/businesses` (พบเพิ่มเติมโดย critic)

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|--------|---------|----------|
| Landing "/" page + ZuriLanding + EntryShell | IMPLEMENTED | src/app/page.jsx:1-13; src/components/landing/ZuriLanding.jsx:122-125; src/components/layouts/EntryShell.jsx:1-61 | @req FR-044, FR-056; @tested tests/unit/entry-surfaces.test.js, tests/unit/fr056-landing.test.js. ไม่มี guard สำหรับผู้ใช้ที่ล็อกอินอยู่แล้ว — ดู D1-entry-layers-11 |
| Login "/login" page + POST /api/auth/login | IMPLEMENTED | src/app/login/page.jsx:1-140; src/app/api/auth/login/route.js:1-77; src/modules/identity/login-error-copy.js:1-23 | Handles 401 vs 503 distinctly with localized copy. @tested tests/unit/fr046-auth-route.test.js, tests/e2e/fr046-entry-contract.spec.js. ไม่มี guard สำหรับผู้ใช้ที่ล็อกอินอยู่แล้ว — ดู D1-entry-layers-11 |
| Logout POST /api/auth/logout | PARTIAL | src/app/api/auth/logout/route.js:1-46; grep confirms no UI caller | Implemented and tested, but no UI entry point. See D1-entry-layers-01 |
| Signup "/signup" page + POST /api/auth/signup (FR-120) | IMPLEMENTED | src/app/signup/page.jsx:1-175; src/app/api/auth/signup/route.js:1-115; src/modules/identity/signup-copy.js:1-57 | Grants no scope/authority (BR-002). @tested tests/unit/fr120-signup-*.test.js, tests/e2e/fr120-signup.spec.js (8 cases). ไม่มี guard สำหรับผู้ใช้ที่ล็อกอินอยู่แล้ว — ดู D1-entry-layers-11 |
| Reset-password "/reset-password" page + POST /api/auth/reset-password (FR-104) | IMPLEMENTED | src/app/reset-password/page.jsx:1-162; src/app/api/auth/reset-password/route.js:1-20; src/modules/identity/password-reset-copy.js | No public forgot-password route (no mail transport). @tested tests/unit/password-reset-*.test.js, tests/e2e/fr104-password-reset-redemption.spec.js. ไม่มี guard สำหรับผู้ใช้ที่ล็อกอินอยู่แล้ว — ดู D1-entry-layers-11 |
| GET /api/entry (FR-046) | IMPLEMENTED | src/app/api/entry/route.js:1-16; src/modules/identity/entry-read-model.js:1-78 | Fails closed 401 AUTH_REQUIRED / 503 SESSION_UNAVAILABLE. @tested tests/integration/fr046-entry-contract.test.js, tests/e2e/fr046-entry-contract.spec.js |
| GET /api/viewer | IMPLEMENTED | src/app/api/viewer/route.js:1-11 | Thin wrapper over resolveRequestViewer; @req FR-031/FR-032 |
| Session/cookie mechanics (session-port, request-viewer, auth-service) | IMPLEMENTED | src/modules/identity/session-port.js:47-98; src/modules/identity/request-viewer.js:9-36; src/modules/identity/auth-service.js:32-37 | platformGrant resolved live per-request, never cached in token (FR-107) |
| Google second way in (FR-121) | DECLARED_ONLY | docs/PRD-SDD-v1.0.md:331; no Google/OAuth affordance in login/signup pages | Declared blocked (no OAuth client credential); UI has no Google option — verified consistent, not a drift |
| /businesses (Business Routing) + GET /api/entry | IMPLEMENTED | src/app/(entry)/businesses/page.jsx:1-100; src/components/layouts/BusinessRoutingShell.jsx:1-13 | Client-side guard only; redirects to /waiting-room when businesses.length===0 (FR-066 AC-066.1) |
| /onboarding/profile (FR-066/FR-122) + POST /api/onboarding/profile + GET /api/onboarding/state | IMPLEMENTED | src/app/(entry)/onboarding/profile/page.jsx:1-167; src/app/api/onboarding/state/route.js:1-19 | firstName/lastName/phone required per FR-122. @tested tests/unit/workspace-onboarding-routes.test.js |
| /waiting-room (FR-066) + GET /api/onboarding/state + POST /api/workspace-invites/accept | IMPLEMENTED | src/app/(entry)/waiting-room/page.jsx:1-170; src/app/api/workspace-invites/accept/route.js:1-26 | Lists only caller's own invites/workspaces (AC-066.3). @tested tests/unit/workspace-onboarding-routes.test.js |
| /workspace-home (FR-066) + GET /api/onboarding/state + POST /api/scope | IMPLEMENTED | src/app/(entry)/workspace-home/page.jsx:1-165 | Owner continuation reuses FR-020/FR-074(c) one-step Business+Default-Space creator (AC-066.8..11) |
| /plugin/authorize (FR-123) + GET/POST /api/plugin/auth/authorize | IMPLEMENTED | src/app/(entry)/plugin/authorize/page.jsx:1-112; src/modules/identity/plugin-consent-access.js:1-27; src/app/api/plugin/auth/authorize/route.js:1-60+ | Server component with true server-side redirect('/login') on AUTH_REQUIRED (SEC-022 fix). @tested tests/unit/fr123-plugin-*.test.js, tests/e2e/fr123-plugin-consent.spec.js |
| /api/plugin/auth/{capabilities,revoke,token} | IMPLEMENTED | src/app/api/plugin/auth/*.js (files present via find) | Existence and FR-123 test wiring confirmed; full bodies not deep-read |
| /api/workspace-invites (mint, POST), /api/workspace-invites/[id] (revoke, DELETE), /api/workspace-memberships (remove, DELETE) | IMPLEMENTED | docs/appendices/A-api-spec.md:235-238; tests/unit/workspace-onboarding-routes.test.js:78-91 | Owner-side endpoints implemented and tested; zero UI caller. See D1-entry-layers-08 |
| docs/ROUTES-SITEMAP.md vs actual FR-066/067 route tree | PARTIAL | docs/ROUTES-SITEMAP.md:22-40, 145-152 vs docs/PRD-SDD-v1.0.md:276-277; docs/INTERFACE-INVENTORY.md:59-87 | See D1-entry-layers-03 |
| No src/middleware.js anywhere in repo | MISSING | find src -iname "middleware*" returned no results | Guard for protected pages is either server-side redirect (/plugin/authorize) or client-side (/other pre-shell pages). See D1-entry-layers-05 |
| Login brute-force protection | MISSING | src/modules/identity/auth-service.js:189-229 vs src/app/api/auth/signup/route.js:43 (signupRateLimiter.check) | See D1-entry-layers-02 |
| e2e coverage of FR-066 pre-Business pages | PARTIAL | No tests/e2e/fr066/fr067/onboarding/waiting-room/workspace-home spec; only unit tests with mocked viewers | See D1-entry-layers-07 |

#### Findings

##### D1-entry-layers-08 — ฟีเจอร์ owner-side collaboration ของ FR-067 (mint invite, revoke invite, remove membership) ทำเสร็จสมบูรณ์ที่ชั้น route/service แต่ไม่มี UI entry point เลยแม้แต่จุดเดียวในผลิตภัณฑ์

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| ระดับ | HIGH |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | src/app/api/workspace-invites/route.js:24 (POST สร้าง invite ที่ scoped); src/app/api/workspace-invites/[id]/route.js:14 (DELETE revoke); src/app/api/workspace-memberships/route.js:19 (DELETE ลบสมาชิก); grep src/app src/components หาชื่อ endpoint/service ที่เกี่ยวข้อง พบ UI เพียงจุดเดียวคือ waiting-room/page.jsx:55 (ฝั่งผู้รับเชิญกด accept ไม่ใช่ฝั่ง owner mint) |
| สิ่งที่ควรเป็น | docs/PRD-SDD-v1.0.md FR-067 ระบุ "✅ implemented" — owner ที่มีสิทธิ์ควรสามารถออก invite ที่ scoped/หมดอายุ/ใช้ครั้งเดียวผ่านผลิตภัณฑ์ได้ และ revoke หรือลบสมาชิกได้ INTERFACE-INVENTORY.md และ A-api-spec.md ลงรายการ endpoint เหล่านี้ว่า shipped แล้ว ซึ่งบ่งบอกว่า owner เข้าถึงได้ |
| สิ่งที่เป็นจริง | owner ไม่มีปุ่ม, ฟอร์ม หรือหน้าใดในเส้นทาง route ที่ ship จริงที่เรียก POST /api/workspace-invites, DELETE /api/workspace-invites/:id หรือ DELETE /api/workspace-memberships ได้เลย วิธีเดียวที่จะเชิญผู้ร่วมงานได้วันนี้คือสร้าง HTTP request ที่ authenticated ด้วยมือหรือผ่าน test เท่านั้น — ฟีเจอร์ที่ PRD ระบุว่า implemented ครบถ้วนกลับเข้าถึงไม่ได้จากผลิตภัณฑ์จริงสำหรับ owner แม้ว่าฝั่งผู้รับเชิญ (ช่อง token ใน waiting-room) จะมีหน้าที่ใช้งานได้จริงแล้วก็ตาม |
| ข้อเสนอแนะ | เพิ่มหน้า owner-facing invite management (เช่น ที่ /workspace-home หรือ /workspace-home/[id]/members เมื่อแก้ naming collision ของ ADR-027 D8 ใน D1-entry-layers-04 แล้ว) ที่ mint invite, แสดง/คัดลอก one-time token, ลิสต์ invite/สมาชิกที่ยัง active และให้ owner revoke หรือลบได้ ระหว่างที่ยังไม่มีหน้านี้ ให้แก้สถานะ FR-067 ใน PRD ระบุช่องว่างฝั่ง owner UI ไว้ด้วย |
| เกี่ยวข้อง | D1-entry-layers-01, D1-entry-layers-04 |
| การตรวจสอบ | verifier-added |

##### D1-entry-layers-01 — `POST /api/auth/logout` implement และทดสอบครบถ้วนแล้ว แต่ไม่มี UI entry point เลยแม้แต่จุดเดียวในผลิตภัณฑ์

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| ระดับ | MEDIUM |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | src/app/api/auth/logout/route.js:33 (implement ถูกต้องและครบถ้วน); grep คำว่า logout/signOut/ออกจากระบบ ทั่ว src/app, src/components, src/modules พบ UI hit เป็นศูนย์นอกจากตัว route เอง, openapi.js และ dialog ของ platform/integrations ที่ไม่เกี่ยวข้อง; grep เจาะจงใน profile/page.jsx, settings/page.jsx, Topbar.jsx, Sidebar.jsx, AppShell.jsx = พบศูนย์ |
| สิ่งที่ควรเป็น | FR-046/FR-095 (@spec ADR-017, ADR-045 D2, SEC-018) บรรยาย logout ว่าเป็นส่วนหนึ่งของ session lifecycle ที่ผู้ล็อกอินอยู่ควรเรียกใช้ได้; INTERFACE-INVENTORY และ @tested annotation ของ route เอง (tests/unit/fr046-auth-route.test.js, tests/unit/iam-session.test.js) ถือว่า shipped แล้ว |
| สิ่งที่เป็นจริง | ผู้ใช้ที่ล็อกอินอยู่ไม่มีปุ่ม, ลิงก์, เมนู หรือฟอร์มใดเลยใน EntryShell, BusinessShell (AppShell.jsx), /profile หรือ /settings ที่เรียก POST /api/auth/logout วิธีเดียวที่จะจบ session ได้วันนี้คือปล่อยให้ cookie หมดอายุเองหรือล้าง cookie ในเบราว์เซอร์ด้วยมือ |
| ข้อเสนอแนะ | เพิ่มปุ่ม sign-out (เช่น ที่ /profile หรือเมนูบัญชีใน BusinessShell) ที่ POST ไป /api/auth/logout แล้ว redirect ไป /login และเพิ่ม e2e test ยืนยัน round trip (คลิก → cookie ถูกล้าง → request ที่ protected ครั้งถัดไปได้ 401) หากเป็น debt ที่ตั้งใจไว้ ให้บันทึกไว้ชัดเจนในช่องสถานะของ FR-046 ใน docs/PRD-SDD-v1.0.md |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D1-entry-layers-03 — docs/ROUTES-SITEMAP.md นำเสนอ flow onboarding ก่อนเข้า Business ของ FR-066/FR-067 ว่าเป็น "approved next target" ที่ยังไม่สร้าง ทั้งที่ PRD-SDD ระบุทั้งสอง requirement ว่า implemented แล้วและ routes/APIs มีอยู่จริงพร้อมทดสอบแล้ว

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/ROUTES-SITEMAP.md:22-24 — "This is the approved documentation target for Profile-first onboarding. It is not implemented by the current route tree yet"; docs/ROUTES-SITEMAP.md:160-161 — "those endpoints are not present yet"; docs/PRD-SDD-v1.0.md:276-277 — FR-066 และ FR-067 ถูกทำเครื่องหมายว่า "✅ implemented" ทั้งคู่; docs/appendices/A-api-spec.md:232 และ docs/INTERFACE-INVENTORY.md:84 — ลงรายการ endpoint/หน้าว่า implemented ทั้งหมด |
| สิ่งที่ควรเป็น | แหล่งอ้างอิง approved-target ของมิตินี้ (ROUTES-SITEMAP.md) ควรบรรยาย route tree ที่ shipped จริงในปัจจุบันให้ถูกต้อง หรือแยก "shipped" กับ "future" ให้ชัดเจนแบบเดียวกับที่ A-api-spec.md และ INTERFACE-INVENTORY.md ทำ |
| สิ่งที่เป็นจริง | ROUTES-SITEMAP.md (draft ลงวันที่ 2026-08-17) ไม่ได้ถูกอัปเดตตอน FR-066/FR-067 ship — ยังคงกำหนดกรอบว่า /onboarding/profile, /waiting-room และ onboarding/workspace-invite APIs เป็น "approved next pre-shell target" ที่ยังไม่ implement และไม่เคยกล่าวถึง /signup, /reset-password, /plugin/authorize หรือ /workspace-home เลย |
| ข้อเสนอแนะ | Regenerate หรือแก้ docs/ROUTES-SITEMAP.md ด้วยมือ ย้าย flow ของ FR-066/067 ออกจากส่วน "approved next target" ไปเป็นส่วน "current verified" เพิ่ม 4 route ที่ขาดหาย และปรับให้ตรงกับ docs/INTERFACE-INVENTORY.md ที่ถูกต้องอยู่แล้ว เพื่อให้เหลือแหล่งความจริงเดียว |
| เกี่ยวข้อง | D1-entry-layers-04, D1-shell-domain-layers-04, D1-journey-states-tests-docs-04, D1-journey-states-tests-docs-06 (ทั้งสี่รายการอธิบายความล้าสมัยของ ROUTES-SITEMAP.md จุดเดียวกันคนละมุม — ดูเครื่องหมายซ้ำในตารางสรุป) |
| การตรวจสอบ | CONFIRMED — critic แก้เลขบรรทัดของหลักฐานที่สองจาก :151 เป็น :160-161 (ข้อความเดิมอยู่จริงที่ ROUTES-SITEMAP.md บรรทัด 161 ในส่วน "## API reference" ไม่ใช่บรรทัด 151 ซึ่งเป็นคนละส่วน) |

##### D1-entry-layers-04 — path เป้าหมายระดับบนสุดของ ADR-027 D8 คือ "/workspaces" ไม่เคยถูก implement ภายใต้ชื่อนั้นจริง (ship เป็น /workspace-home แทน) เพราะชื่อนี้ถูก PM Space compatibility page ที่ไม่เกี่ยวข้องใช้ไปแล้ว

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/decisions/ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md:203 (D8 ระบุ '/workspaces' เท่านั้น — grep ทั้งไฟล์พบคำว่า '/workspaces' เพียงสองจุดคือบรรทัด 203 และ 208 ในเนื้อความอธิบาย ADR ไม่เคยเอ่ยถึง '/workspaces/:id' เลย); docs/ROUTES-SITEMAP.md:35 ('/workspaces/:id Workspace Home and membership/invitation state' — เป็นแหล่งที่มาจริงของรูปแบบ ':id' ซึ่งเป็นการขยายจาก ADR ของ sitemap เอง ไม่ใช่ข้อความใน ADR-027); src/modules/identity/onboarding-steps.js:8 (คอมเมนต์ในโค้ด: WORKSPACE_HOME คือ /workspace-home ไม่ใช่ /workspaces ตาม ADR-027 D8 เพราะ path นั้นถูก PM Space page ใช้ไปแล้ว); src/app/(pm)/workspaces/page.jsx:3 (@req FR-001); src/app/(pm)/workspaces/[workspaceId]/page.jsx (หน้า PM Space detail ของ FR-001 อยู่ที่ /workspaces/:id ตัวจริงพอดี); src/app/(entry)/workspace-home/page.jsx:21 (เป็นหน้า list ไม่มี parameter ไม่มี route ย่อยระดับ [id]) |
| สิ่งที่ควรเป็น | ADR-027 D8 ระบุว่าลำดับที่อนุมัติแล้วใช้ /workspaces เป็น top-level collaboration-Workspace surface; docs/ROUTES-SITEMAP.md ขยายเป้าหมายนี้ต่อเป็น /workspaces/:id สำหรับ Workspace Home และสถานะ membership/invitation |
| สิ่งที่เป็นจริง | route ที่ ship จริงคือ /workspace-home (หน้า list อย่างเดียว แสดงเฉพาะ workspace ที่เข้าร่วมแล้ว ไม่มีหน้า per-id สำหรับจัดการ membership/invitation) — เป็นการเบี่ยงเบนที่ตั้งใจและมีคอมเมนต์อธิบายไว้ในโค้ดแล้ว แต่ทั้ง ADR-027 เองและ ROUTES-SITEMAP.md ยังไม่ถูกแก้ไขด้วย decision addendum ใด ๆ ผู้อ่านที่ตาม ADR จะไปหา /workspaces แล้วเจอหน้าอื่น (PM Space compatibility page) แทน ส่วนรูปแบบ /workspaces/:id ที่ ROUTES-SITEMAP.md ตั้งเป้าไว้ก็ถูกหน้า PM Space detail (FR-001) ครองอยู่แล้ว ไม่ใช่ surface สำหรับ collaboration membership/invitation ตามที่ sitemap ตั้งใจ |
| ข้อเสนอแนะ | เลือกทางใดทางหนึ่ง: (a) ย้าย PM Space compatibility page ออกจาก /workspaces ไปเป็น /spaces (ROUTES-SITEMAP.md:37 คาดการณ์การย้ายนี้ไว้แล้วว่าเป็นไปได้ในอนาคต) แล้วคืน path /workspaces ให้เป้าหมายของ ADR-027 หรือ (b) เพิ่ม decision addendum ใน ADR-027 (และแก้ ROUTES-SITEMAP.md) ยอมรับ /workspace-home เป็น path ถาวรอย่างเป็นทางการ เพื่อให้สองเอกสารเลิกขัดแย้งกับ route tree จริง พร้อมทั้งตัดสินใจ/สร้างหน้ารายละเอียด membership/invitation ต่อ workspace (/workspaces/:id หรือเทียบเท่า) หรือประกาศตัดขอบเขตออกไปให้ชัดเจน |
| เกี่ยวข้อง | D1-entry-layers-03 |
| การตรวจสอบ | ADJUSTED, critic-corrected — ข้อกล่าวอ้างหลักยืนยันแล้ว (naming collision เป็นจริงและมีคอมเมนต์อธิบายในโค้ด) แต่การอ้างอิงเดิมผิด: ADR-027 D8 ไม่เคยเอ่ยถึง '/workspaces/:id' เลย รูปแบบนั้นมาจาก docs/ROUTES-SITEMAP.md:35 ซึ่งเป็นการขยายเป้าหมายของ sitemap เอง ไม่ใช่ข้อความใน ADR — แก้ไขการอ้างอิงและประโยค "สิ่งที่ควรเป็น" ให้ตรงกับแหล่งที่มาจริงแล้ว |

##### D1-entry-layers-06 — mutation handler ระหว่าง session บนหน้า pre-Business ของ FR-066 แสดง error code จาก server แบบดิบให้ผู้ใช้เห็นแทนข้อความที่แปลแล้ว และไม่ redirect ไป /login เมื่อเจอ AUTH_REQUIRED ต่างจาก path ตอน page-load

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| ระดับ | MEDIUM |
| ประเภท | PARTIAL |
| หลักฐาน | src/app/(entry)/waiting-room/page.jsx:59, 76 (catch block ของ acceptInvite และ createWorkspace เอา err.message แทรกลงข้อความไทยตรง ๆ); src/app/(entry)/workspace-home/page.jsx:72 (catch ของ createBusiness); src/app/(entry)/onboarding/profile/page.jsx:74 (catch ของ save); src/modules/identity/login-error-copy.js และ signup-copy.js (เทียบกัน: /login และ /signup มีโมดูล *-copy เฉพาะของตัวเอง); find src/modules/identity -iname "*copy*" พบเพียง login-error-copy.js, password-reset-copy.js, signup-copy.js (ไม่มี onboarding-copy.js) |
| สิ่งที่ควรเป็น | ในเมื่อ /login, /signup และ /reset-password ต่างมีโมดูล *-copy.js เฉพาะของตัวเองที่ไม่ปล่อยให้ error code ดิบจาก server ไปถึงผู้ใช้เลย และ path ตอน page-load บนหน้า pre-Business เดียวกันนี้ก็มี logic redirect AUTH_REQUIRED → /login ที่ถูกต้องอยู่แล้ว mutation path บนหน้าเดียวกันควรทำตามธรรมเนียมทั้งสองข้อนี้เช่นกัน |
| สิ่งที่เป็นจริง | ไม่มี src/modules/identity/onboarding-copy.js อยู่เลย หาก session หมดอายุระหว่างที่ waiting-room/workspace-home/onboarding-profile โหลดเสร็จแล้วกับตอนที่ผู้ใช้ submit ฟอร์ม ข้อความ error ที่ได้จะอ่านเป็น server code ภาษาอังกฤษแทรกอยู่กลางประโยคไทย และผู้ใช้ยังค้างอยู่หน้าเดิมแทนที่จะถูกส่งไป /login เพื่อ re-authenticate |
| ข้อเสนอแนะ | เพิ่มโมดูล onboarding-error-copy ที่ map PROFILE_REQUIRED, INVALID_OR_EXPIRED_INVITE, INVITE_ROLE_NOT_ALLOWED ฯลฯ ไปเป็นข้อความที่แปลแล้ว และให้ catch block ของแต่ละ mutation ตรวจ err.status===401 (useApi.js's requestJson แนบค่านี้มาให้อยู่แล้ว) เพื่อ redirect ไป /login แทนการ render ข้อความดิบ |
| เกี่ยวข้อง | D1-entry-layers-05, D1-entry-layers-07 |
| การตรวจสอบ | CONFIRMED |

##### D1-entry-layers-02 — `POST /api/auth/login` ไม่มี rate limiting หรือ lockout ใด ๆ ต่างจาก `POST /api/auth/signup` ที่มี limiter ต่อ source (แม้จะอ่อนแอ)

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| ระดับ | LOW |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/modules/identity/auth-service.js:189-229 (authenticateUser ค้นหา Person แล้วเรียก verifyPassword โดยไม่มีการหน่วง throttling); src/app/api/auth/login/route.js:38 (POST handler เรียก authenticateUser ตรง ๆ โดยไม่เช็ค rate-limiter); src/app/api/auth/signup/route.js:43 (signupRateLimiter.check(...) — รูปแบบที่มีให้ signup แต่ login ไม่มี) |
| สิ่งที่ควรเป็น | ไม่มี PRD requirement ใดบังคับ login rate limiting ชัดเจน แต่เอกสารของ FR-120 เองกำหนดกรอบ rate limiting ต่อ source ว่าเป็น compensating control ต่อการ enumeration/abuse สำหรับ endpoint signup ที่ใหม่กว่าและมูลค่าต่ำกว่า ส่วน endpoint login ที่มูลค่าสูงกว่า (ใช้ brute-force รหัสผ่านบัญชีที่มีอยู่ได้) กลับไม่มี control แบบเดียวกัน |
| สิ่งที่เป็นจริง | authenticateUser จะรัน scrypt password verification (ตั้งใจให้แพงในการคำนวณ) สำหรับทุกครั้งที่ login โดยไม่มีการหน่วงต่อ source หรือต่อบัญชีเลย ผู้โจมตีจึงสามารถเดารหัสผ่านได้ไม่จำกัดต่อ username/code ที่รู้อยู่แล้ว ด้วยอัตราเท่าที่ต้นทุน scrypt จะเปิดให้ทำได้ |
| ข้อเสนอแนะ | นำรูปแบบของ signup-rate-limit.js (หรือรุ่นถัดไป) มาใช้กับ POST /api/auth/login โดย scope ตาม source และ/หรือบัญชีเป้าหมาย และระบุความแข็งแรงจริงของมัน (in-process/per-instance เหมือนที่เปิดเผยไว้อย่างตรงไปตรงมาสำหรับ signup แล้ว) ไว้ใน PRD แทนที่จะปล่อย login ไว้โดยไม่กล่าวถึง |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D1-entry-layers-05 — เมื่อไม่มี src/middleware.js สี่ใน ห้าหน้า pre-shell entry จึง guard ตัวเองแบบ client-side เท่านั้น (render-then-redirect) มีเพียง /plugin/authorize หน้าเดียวที่ redirect ฝั่ง server จริง

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| ระดับ | LOW |
| ประเภท | PARTIAL |
| หลักฐาน | src/app/(entry)/businesses/page.jsx:54, /waiting-room/page.jsx:30, /workspace-home/page.jsx:29, /onboarding/profile/page.jsx:33 (ทั้งหมดใช้ 'use client' กับ useEffect-on-fetch-error redirect); src/modules/identity/plugin-consent-access.js:25 (เรียก redirect('/login') ของ Next แบบ synchronous ใน server component ก่อน HTML จะ stream ออกไปเลย — หน้าเดียวที่ fail closed ที่ฝั่ง server); find src -iname "middleware*" ไม่พบผลลัพธ์ใด |
| สิ่งที่ควรเป็น | คำถามของมิตินี้คือ: เมื่อไม่มี src/middleware.js แล้ว guard ของแต่ละชั้นทำอะไรจริงเมื่อผู้เยี่ยมชมที่ยังไม่ล็อกอินเข้ามา — redirect, render error หรือรั่วข้อมูล |
| สิ่งที่เป็นจริง | ไม่มีข้อมูลที่ต้อง protect รั่วออกมาเลย (แต่ละหน้า client แสดง LoadingCard ระหว่างโหลดหรือระหว่าง error เป็น AUTH_REQUIRED ไม่เคยแสดงเนื้อหาจริง) และชุด e2e ยืนยันว่าจบที่ /login เสมอ แต่กลไกไม่สม่ำเสมอ: สี่หน้าส่ง page shell และ JS bundle เต็มให้ผู้เยี่ยมชมที่ยังไม่ล็อกอินก่อน แล้วค่อย redirect หลัง client fetch ล้มเหลว ขณะที่หนึ่งหน้า (/plugin/authorize) redirect ก่อน render อะไรเลย ไม่มี guard จุดเดียวที่ใช้ร่วมกัน — แต่ละหน้าเขียน useEffect pattern เดียวกันซ้ำด้วยมือ |
| ข้อเสนอแนะ | ไม่ใช่ defect เชิงฟังก์ชัน (มีทดสอบแล้ว ไม่มีข้อมูลรั่ว) แต่เป็นช่องว่างด้าน maintainability/ความสม่ำเสมอ: พิจารณาทำ shared client guard hook (หรือ middleware.js matcher สำหรับ route group (entry)) เพื่อให้ pattern redirect-on-401 อยู่จุดเดียวแทนการ copy-paste ซ้ำสี่หน้า |
| เกี่ยวข้อง | D1-entry-layers-06 |
| การตรวจสอบ | CONFIRMED |

##### D1-entry-layers-07 — ไม่มี e2e (ระดับเบราว์เซอร์) test สำหรับ /onboarding/profile, /waiting-room หรือ /workspace-home เลย มีเพียง unit test ระดับ route/service ที่ mock viewer เท่านั้น

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| ระดับ | LOW |
| ประเภท | TEST_GAP |
| หลักฐาน | find tests/e2e -iname "*.spec.js" ลิสต์ได้ 17 specs; ไม่มีชื่อไฟล์สำหรับ onboarding/waiting-room/workspace-home เลย; grep คำเหล่านี้ใน fr044/fr046/smoke.spec.js ได้ผลลัพธ์ศูนย์; tests/unit/workspace-onboarding-routes.test.js คลุมเฉพาะ handler GET/POST/DELETE ด้วยการ mock resolveRequestViewer และ service function เท่านั้น |
| สิ่งที่ควรเป็น | checklist ของมิตินี้เรียกร้อง e2e coverage ต่อทุก entry route; flow พี่น้องอย่าง FR-044/046/104/120/123 ต่างมี Playwright spec เฉพาะของตัวเองที่ขับหน้าจริงในเบราว์เซอร์ (กรอกฟอร์ม, submit, ยืนยัน redirect) |
| สิ่งที่เป็นจริง | journey FR-066/067 ก่อนเข้า Business มีหน้าที่ใช้งานได้จริงและ unit test ที่ผ่านครบ แต่ไม่มี regression coverage ระดับเบราว์เซอร์เลย — การเปลี่ยนแปลงที่ทำให้ฟอร์มที่ render จริงพัง (เช่น submit handler เสีย, ปัญหา CSS/z-index บังปุ่ม, บั๊กใน client-side routing ของ useEffect redirect) จะไม่ถูก test suite ที่ผ่านอยู่ปัจจุบันจับได้เลย |
| ข้อเสนอแนะ | เพิ่ม e2e spec (เช่น tests/e2e/fr066-onboarding-journey.spec.js) ที่เดินบัญชีที่เพิ่ง signup ผ่าน /onboarding/profile → /waiting-room → create-Workspace → /workspace-home → create-Business → /businesses ในเบราว์เซอร์จริง ตามสไตล์ของ fr120-signup.spec.js และ fr044-entry-routing.spec.js |
| เกี่ยวข้อง | D1-entry-layers-06 |
| การตรวจสอบ | CONFIRMED |

##### D1-entry-layers-09 — หน้า pre-shell entry ทั้งสี่หน้า redirect ไป /login เมื่อเจอ session-store outage จริง (503 SESSION_UNAVAILABLE) เหมือนกับกรณีไม่มี session เลย (401 AUTH_REQUIRED) ทำให้ปัญหา infrastructure ถูกนำเสนอเป็นปัญหา credential

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| ระดับ | HIGH |
| ประเภท | PARTIAL |
| หลักฐาน | src/modules/identity/request-viewer.js:17 (sessionPort.read() ที่ throw ถูก map เป็น httpError(503, 'SESSION_UNAVAILABLE')); src/app/(entry)/waiting-room/page.jsx:30, /onboarding/profile/page.jsx:33, /workspace-home/page.jsx:29, /businesses/page.jsx:54 (ทุก useEffect ปฏิบัติกับ state.error === 'AUTH_REQUIRED' \|\| state.error === 'SESSION_UNAVAILABLE' เหมือนกันหมด — ทั้งคู่ redirect ไป /login); src/modules/identity/login-error-copy.js (เจตนาการออกแบบ: 503 AUTH_UNAVAILABLE คือ server-state failure และต้องอ่านออกมาเป็นอย่างนั้น) |
| สิ่งที่ควรเป็น | หัวคอมเมนต์ของ login-error-copy.js เองระบุเจตนาการออกแบบไว้ชัดเจนว่า "A 503 AUTH_UNAVAILABLE ... is a server-state failure and must read as one" — กล่าวคือความล้มเหลวของ infra ไม่ควรถูกนำเสนอเป็นความล้มเหลวของ credential/login |
| สิ่งที่เป็นจริง | หลักการนี้ถูกยึดถือบน error surface ของ route login เองเท่านั้น แต่ไม่ถูกส่งต่อไปยัง page-load guard ของสี่หน้า pre-shell — session-store outage จะเด้งผู้ใช้ไป /login เงียบ ๆ เหมือนกับกรณีไม่มี session เลย ซึ่งผู้ใช้จะเห็น network error ทั่วไปหรือถูกชวนให้กรอก credential ใหม่ทั้งที่ไม่ใช่ต้นเหตุ โดยไม่มีสัญญาณใดบอก operator ว่าปัญหาคือ infrastructure ไม่ใช่ session ที่หมดอายุ |
| ข้อเสนอแนะ | ใน effect ที่ redirect-on-error ที่ใช้ร่วมกัน (หรือ shared guard hook ที่เสนอไว้ใน D1-entry-layers-05) ให้แยกสองรหัสนี้ออกจากกัน: redirect ไป /login เฉพาะ AUTH_REQUIRED เท่านั้น ส่วน SESSION_UNAVAILABLE ให้ render ErrorState/ปุ่มลองใหม่ เพื่อให้ outage แยกออกจากสถานะล็อกเอาต์ปกติได้ชัดเจน |
| เกี่ยวข้อง | D1-entry-layers-05, D1-entry-layers-06, D1-journey-states-tests-docs-01 (บรรยายข้อเท็จจริงเดียวกันในระดับทั้งระบบ — critic ปรับระดับ finding นี้จาก LOW เป็น HIGH ให้ตรงกัน) |
| การตรวจสอบ | verifier-added; critic ปรับระดับความรุนแรงจาก LOW เป็น HIGH เพื่อให้ตรงกับ D1-journey-states-tests-docs-01 ซึ่งบรรยายข้อเท็จจริงและหลักฐานชุดเดียวกันในขอบเขตที่กว้างกว่า (ทุก guard ในระบบ ไม่ใช่แค่สี่หน้า pre-shell) — สองรายการนี้เป็น defect เดียวกัน แยกไว้เพราะคนละหน่วยตรวจค้นพบอิสระต่อกัน |

##### D1-entry-layers-10 — `ENTRY_PATHS` ใน ScopeContext.jsx ล้าสมัย: 6 หน้า pre-shell ที่เพิ่มมาภายหลังยิง `GET /api/scope` ตอน mount ขัดกับ annotation FR-046 ของไฟล์เอง

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | src/context/ScopeContext.jsx:22 `const ENTRY_PATHS = new Set(['/', '/login', '/businesses'])`; src/context/ScopeContext.jsx:11 `// @req FR-046 — entry surfaces never prefetch the broad compatibility scope inventory.`; src/context/ScopeContext.jsx:63-64 `if (ENTRY_PATHS.has(pathname)) return; refresh()`; tests/unit/fr046-api-ui-contract.test.js:29-30 ตรวจเพียงว่ามีข้อความ `ENTRY_PATHS.has(pathname)` อยู่ในซอร์ส ไม่ได้ตรวจสมาชิกจริงของ set เลย; src/lib/business-shell-guard.js:10 มีรายการ 3 path เดียวกันคัดลอกซ้ำแยกไว้อีกชุด; หน้า pre-shell ที่ไม่อยู่ใน ENTRY_PATHS: src/app/signup/page.jsx, src/app/reset-password/page.jsx, src/app/(entry)/onboarding/profile/page.jsx, src/app/(entry)/waiting-room/page.jsx, src/app/(entry)/workspace-home/page.jsx, src/app/(entry)/plugin/authorize/page.jsx (รวม 6 หน้า) |
| สิ่งที่ควรเป็น | ScopeProvider ถูก mount ทุกหน้ารวมถึงหน้า entry เพราะอยู่ใน root layout; annotation ของไฟล์เองประกาศเจตนาว่า entry surfaces ไม่ควร prefetch scope inventory ที่กว้างเกินจำเป็น (FR-046) ซึ่งควรครอบคลุมหน้า pre-shell ทุกหน้า ไม่ใช่แค่สามหน้าแรกของยุค FR-044/FR-046 |
| สิ่งที่เป็นจริง | `ENTRY_PATHS` เป็นรายการของยุค FR-044/FR-046 เท่านั้น หลังจากนั้น FR-120 (/signup), FR-104 (/reset-password), FR-066 (/onboarding/profile, /waiting-room, /workspace-home) และ FR-123 (/plugin/authorize) เพิ่มหน้า pre-shell มาอีก 6 เส้นทางโดยไม่มีใครแก้รายการนี้ ผลคือผู้เยี่ยมชมที่ยังไม่ล็อกอินบน /signup จะยิง `/api/scope` ซึ่ง fail closed ด้วย 401 — ไม่มีข้อมูลรั่ว แต่ขัดกับสิ่งที่ไฟล์ประกาศไว้เองว่า entry surfaces จะไม่ prefetch scope inventory (ประเภท (d) doc/annotation บอก X โค้ดทำ Y) และ contract test ที่ควรคุ้มครองเรื่องนี้ตรวจเพียงว่ามีข้อความ `ENTRY_PATHS.has(pathname)` อยู่ในซอร์สเท่านั้น ไม่ได้ตรวจว่าสมาชิกของ set ครบหรือไม่ ซ้ำร้ายรายการเดียวกันยังถูกคัดลอกไว้ที่ business-shell-guard.js อีกชุดหนึ่ง ทำให้ต้องแก้สองที่พร้อมกันทุกครั้งที่มีหน้า pre-shell ใหม่ |
| ข้อเสนอแนะ | เพิ่ม 6 path ที่ขาดหายเข้า `ENTRY_PATHS` (และชุดที่ซ้ำใน business-shell-guard.js หรือรวมสองรายการเป็นแหล่งเดียว) แล้วแก้ contract test ให้ตรวจสมาชิกจริงของ set แทนการตรวจแค่การมีอยู่ของโค้ด `ENTRY_PATHS.has(pathname)` |
| เกี่ยวข้อง | D1-entry-layers-05, D1-entry-layers-11 |
| การตรวจสอบ | critic-added |

##### D1-entry-layers-11 — ไม่มีการจัดการสถานะ "ผู้ใช้ที่ล็อกอินอยู่แล้ว" บน `/`, `/login`, `/signup`, `/reset-password` — ไม่มี redirect ไป `/businesses` ที่ใดเลย

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| ระดับ | LOW |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/app/login/page.jsx:17-50 (component ไม่มีการอ่าน /api/entry, /api/viewer หรือ session ใด ๆ ก่อน render ฟอร์ม); grep คำว่า 'businesses\|api/entry\|api/viewer' ใน src/app/login/page.jsx, src/app/signup/page.jsx, src/app/reset-password/page.jsx, src/components/landing/ZuriLanding.jsx พบผลลัพธ์เดียวคือ src/app/login/page.jsx:44 (redirect หลัง POST login สำเร็จเท่านั้น ไม่ใช่การเช็คสถานะก่อน render); ไม่มี src/middleware.js (ยืนยันด้วย find); src/app/(pm)/layout.jsx:11-16 BusinessShellGuard ไม่คลุมเส้นทางเหล่านี้เพราะอยู่คนละ route group |
| สิ่งที่ควรเป็น | checklist ของมิตินี้ระบุชัดว่าต้องตรวจสถานะที่แต่ละชั้นรองรับ (loading/empty/error/unauthorized/expired session) รวมถึงสถานะกลับด้าน — ผู้ใช้ที่มี session ใช้งานได้อยู่แล้วเข้าหน้า /login ควรถูกพาไป /businesses แทนที่จะเห็นฟอร์มล็อกอินซ้ำ |
| สิ่งที่เป็นจริง | ทั้งสี่หน้าแรกสุดของ journey (Landing, Login, Signup, Reset-password) ไม่มีทั้ง middleware, server component check หรือ client effect ใดที่ตรวจสถานะ "already signed in" แล้วพาไป /businesses เลย ผู้ใช้ที่ล็อกอินค้างอยู่แล้วเปิด /login จะเห็นฟอร์มล็อกอินซ้ำเสมอ เชื่อมโยงโดยตรงกับ D1-entry-layers-01 (ไม่มีปุ่ม sign-out) — ผู้ใช้ที่ล็อกอินค้างจึงไม่มีทั้งทางออกและสัญญาณว่าตนล็อกอินอยู่ |
| ข้อเสนอแนะ | เพิ่มการเช็ค session ที่ยังใช้งานได้ (เช่นเรียก GET /api/entry) ก่อน render ฟอร์มใน `/login`, `/signup`, `/reset-password` และ Landing แล้ว redirect ไป `/businesses` ทันทีถ้าพบ session ที่ยัง ACTIVE — จะทำเป็น server component check หรือ client effect ร่วมกับ guard hook ที่เสนอใน D1-entry-layers-05 ก็ได้ |
| เกี่ยวข้อง | D1-entry-layers-01 |
| การตรวจสอบ | critic-added |

#### ข้อจำกัดการตรวจ

**Finder examination scope:** นำมาใช้ครบถ้วน ได้แก่ src/app/page.jsx, src/components/layouts/EntryShell.jsx, src/app/login/page.jsx, src/app/api/auth/login/route.js, src/app/api/auth/logout/route.js, src/app/signup/page.jsx, src/app/api/auth/signup/route.js, src/app/reset-password/page.jsx, src/app/api/auth/reset-password/route.js, src/app/api/entry/route.js, src/modules/identity/entry-read-model.js, src/app/api/viewer/route.js, src/modules/identity/session-port.js, src/modules/identity/request-viewer.js, src/modules/identity/auth-service.js, src/modules/identity/onboarding-steps.js, src/modules/identity/login-error-copy.js, src/modules/identity/signup-copy.js, src/app/(entry)/businesses/page.jsx, src/app/(entry)/onboarding/profile/page.jsx, src/app/(entry)/waiting-room/page.jsx, src/app/(entry)/workspace-home/page.jsx, src/app/(entry)/plugin/authorize/page.jsx, src/modules/identity/plugin-consent-access.js, src/app/api/onboarding/state/route.js, src/app/api/workspace-invites/accept/route.js, src/components/layouts/BusinessRoutingShell.jsx, docs/ROUTES-SITEMAP.md, docs/decisions/ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md (D7/D8), docs/appendices/A-api-spec.md (targeted), docs/INTERFACE-INVENTORY.md (targeted lines 59-87), docs/PRD-SDD-v1.0.md (FR-044/046/056/066/067/120/121/122) — รวมทั้ง grep ขนาดใหญ่สำหรับ logout, middleware, rate-limit patterns

**Route/service-level existence only (via find, wc, grep cross-reference):** src/app/api/onboarding/profile/route.js, src/app/api/onboarding/workspaces/route.js, src/app/api/workspace-invites/route.js (mint), src/app/api/workspace-invites/[id]/route.js (revoke), src/app/api/workspace-memberships/route.js, src/app/api/plugin/auth/{capabilities,revoke,token}/route.js, src/app/api/platform/users/password-resets/route.js — ได้รับการยืนยันว่ามีอยู่และมีการเดินสายต่อ แต่ไม่ได้อ่านรายละเอียด

**ไม่ได้อ่าน (นอกขอบเขต):** src/components/layouts/AppShell.jsx internals (grep-only for logout), src/components/layouts/{BusinessShellGuard,PlatformControlShell}.jsx, src/lib/{business-routing,business-shell-guard,home-scope}.js, src/config/domains.js, src/context/ScopeContext.jsx, (pm)/* pages — สืบค้นเฉพาะ @req headers เพื่อยืนยัน naming collision

**Verifier examination scope:** เปิดอ่านไฟล์ที่ finder อ้างอิงครบถ้วน + context รอบข้าง (full route files, full ADR-027 D8, full ROUTES-SITEMAP.md, PRD-SDD FR rows) สำหรับการ verify "absence" claims ทำการ grep ของคำ-คำหลัก กว้าง ๆ ข้าม src/ และ tests/e2e ไม่ได้เชื่อใจเพียง named paths เท่านั้น — ไม่พบตัวอย่างโต้แย้งใด ๆ

**Test execution:** ไม่มีการรัน test suite ใด ๆ (read-only per instructions) — การอ้างสิทธิ์ test coverage มาจากการอ่านชื่อไฟล์ test, `test(...)` declarations, และ assertion bodies

**Verdict classification:** 7 findings CONFIRMED, 1 ADJUSTED (D1-entry-layers-04 sub-clause correction), 0 REFUTED, 2 verifier-added (D1-entry-layers-08, D1-entry-layers-09). No V1-parity or ADR-boundary false-gaps detected. **รอบ critic (หลังการ assemble):** เพิ่ม 2 finding ใหม่ (D1-entry-layers-10, D1-entry-layers-11), แก้เนื้อหาหลักฐานของ D1-entry-layers-03/04, และปรับระดับ D1-entry-layers-09 จาก LOW เป็น HIGH เพื่อให้ตรงกับ D1-journey-states-tests-docs-01 — รวม 11 findings ในหน่วยนี้หลัง critic

## shell-domain-layers

#### สรุปย่อ

- **ระบบการนำทาง (BusinessShell, DomainBar, Sidebar) ถูกนำมาใช้งานอย่างถูกต้อง** ด้วยการกำหนดค่า 9 domains (1 business-home + 8 operational) และการป้องกันแบบไคลเอนต์/เซิร์ฟเวอร์ แต่มีข้อบกพร่องที่ซ่อนอยู่ในระดับต่างๆ
- **FR-099/100/101 (SoT Pipeline Console) ไม่สามารถทำงานได้อย่างแท้จริง** เนื่องจากบั๊ก destructuring useScope() ที่ทำให้ทั้งสามหน้า render สถานะ 'ยังไม่เลือก Business' ตลอดเวลา — นี่คือบั๊ก CRITICAL ที่ส่งมาพร้อมกับการพัฒนา
- **/market (FR-092) ใช้ข้อมูล hardcoded และไม่มี API call** เลย แม้ว่า backend translation core ถูกนำมาใช้งานแล้ว; ปุ่ม "New Watch Rule" เป็น alert() stub
- **ช่องโหว่ในการทดสอบ**: e2e test ที่ click ผ่าน DomainBar/Sidebar ไปยัง sub-page มีจริงสำหรับ Development/People/CRM แต่ยังขาดสำหรับ Market/Platform ส่วนใหญ่; unit test สำหรับ shell นั้นอ่านต้นฉบับ .jsx ด้วย string matching แทนการ render component จริง — ไม่มี rendering harness ติดตั้งใน repo เลย (0 จาก 264 ไฟล์)
- **ปัญหาเอกสารทั่วไป**: ROUTES-SITEMAP.md ล้าสมัย (ขาด Market, Files); INTERFACE-INVENTORY.md §4 ขัดแย้ง (marker พูดว่า 8 operational domains แต่ตารางพูดว่า 7 โดยละเว้น market และตัวเลขอื่นในตารางเดียวกันก็ผิดหลายจุด)
- **ไม่มี global error/not-found handlers** และไม่มี page.jsx สำหรับ soon-true domains (/commerce, /growth, /operations) — direct URL entry จะแสดง bare Next.js 404 แทน AppShell
- **`/projects/new` ตกหล่นจากรายงานฉบับก่อนหน้าไปทั้งหน้า** และ **Platform domain ไม่มี Dashboard ที่แยกจาก Settings จริง** — พบเพิ่มเติมโดย critic (ดู D1-shell-domain-layers-12, -13)

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|--------|--------|---------|
| src/app/(pm)/layout.jsx — BusinessShell root layout | IMPLEMENTED | src/app/(pm)/layout.jsx:11-17 | Wraps BusinessShellGuard + AppShell; @req FR-044 |
| src/components/layouts/BusinessShellGuard.jsx (client guard) | IMPLEMENTED | src/components/layouts/BusinessShellGuard.jsx:19-49 | Client-side; renders LoadingCard/Redirecting/ErrorState per state |
| src/lib/business-shell-guard.js — resolveBusinessShellDecision | IMPLEMENTED | src/lib/business-shell-guard.js:41-91 | FR-044/FR-060/FR-061 decision function |
| src/config/domains.js — DOMAINS registry (Tier2/Tier3 nav) | IMPLEMENTED | src/config/domains.js:24-146 | 9 top-level entries; 27 sub-domain entries total |
| isDomainVisible / domainForPath helpers | IMPLEMENTED | src/config/domains.js:156-178 | Shared by guard, DomainBar, CommandPalette (FR-060/FR-061) |
| src/config/scope-views.js — ERP/PM lens | IMPLEMENTED | src/config/scope-views.js:25-57 | Two label lenses over one scope hierarchy |
| src/context/ScopeContext.jsx | IMPLEMENTED | src/context/ScopeContext.jsx:24-147 | Has selection.businessId, shell.activeBusinessId; NOT top-level businessId |
| AppShell.jsx / Topbar / DomainBar / Sidebar / Breadcrumb / CommandPalette | IMPLEMENTED | src/components/layouts/AppShell.jsx:24-48 | DomainBar renders soon domains as disabled; CommandPalette has hand-kept RESOURCE_ROUTES |
| /overview — Business Home Dashboard (FR-060) | IMPLEMENTED | src/app/(pm)/overview/page.jsx:159-395 | Full loading/error/empty coverage |
| /customer — CRM Dashboard (FR-091) | IMPLEMENTED | src/app/(pm)/customer/page.jsx:24-104 | Real API; explicit no-business/loading/error/empty states |
| /customer/conversations — CRM Inbox (FR-091/FR-103) | IMPLEMENTED | src/app/(pm)/customer/conversations/page.jsx:1-20 | Read-only by design (BR-011) |
| /market — Market Intelligence Dashboard (FR-092) | PARTIAL | src/modules/market-intelligence/components/MarketDashboard.jsx:1-227 | 100% hardcoded local state; zero fetch call; 'New Watch Rule' is alert() |
| /people — People Dashboard (FR-042) | PARTIAL | src/app/(pm)/people/page.jsx:1-9 | Renders identical PeopleDirectory component as /people/directory |
| /people/directory — People Directory (FR-042) | IMPLEMENTED | src/app/(pm)/people/directory/page.jsx:1-9 | Real API; loading/error/empty states |
| /projects — Development Dashboard (FR-003) | IMPLEMENTED | src/app/(pm)/projects/page.jsx:1-390 | Header/route wiring confirmed |
| /work — All Work (FR-005) | IMPLEMENTED | src/app/(pm)/work/page.jsx:1-16 | Wrapper over AllWorkView |
| /execution — Execution index (FR-009) | IMPLEMENTED | src/app/(pm)/execution/page.jsx:1-44 | Static links to 7 execution-mode routes |
| /execution/[mode] (FR-009) | IMPLEMENTED | src/app/(pm)/execution/[mode]/page.jsx:11-17 | Handles unknown mode with EmptyState |
| /timeline, /dependencies, /milestones (FR-064/FR-007/FR-006) | IMPLEMENTED | src/app/(pm)/timeline/page.jsx:1-21 | Thin wrappers over universal views |
| /files — Business Files (FR-045) | IMPLEMENTED | src/app/(pm)/files/page.jsx:12-53 | Real API; explicit save-error state |
| /repositories (FR-008) | IMPLEMENTED | src/app/(pm)/repositories/page.jsx:93-164 | Loading/error/empty; scopes to active Business |
| /platform/users — Users & permissions (FR-038/FR-062) | IMPLEMENTED | src/app/(pm)/platform/users/page.jsx:26,54,67-79 | Manageable flag from server; includes soon:true domains in checkboxes |
| /platform/integrations (FR-080) | IMPLEMENTED | src/app/(pm)/platform/integrations/page.jsx:11,13,138-143 | Uses useFetch; 1245 lines, not fully verified |
| /platform/customer-import-reviews (FR-078) | IMPLEMENTED | src/app/(pm)/platform/customer-import-reviews/page.jsx:1-30 | Uses useScope/useFetch/api correctly |
| /platform/sot-pipeline — SoT Plan Board (FR-099) | PARTIAL | src/app/(pm)/platform/sot-pipeline/page.jsx:31,37 | const { businessId } = useScope() always undefined → always ErrorState |
| /platform/sot-pipeline/inbox — SoT Approval Inbox (FR-100) | PARTIAL | src/app/(pm)/platform/sot-pipeline/inbox/page.jsx:23,31-34 | Same useScope() destructuring bug |
| /platform/sot-pipeline/graph — SoT Pipeline Graph (FR-101) | PARTIAL | src/app/(pm)/platform/sot-pipeline/graph/page.jsx:62-70 | Same bug a third time |
| /platform/product-readiness (+[domain]) (FR-124) | IMPLEMENTED | src/app/(pm)/platform/product-readiness/page.jsx:8-10 | Server components; auth before notFound() |
| /projects/new — Objective intake (FR-017) | IMPLEMENTED | src/app/(pm)/projects/new/page.jsx:1-7,384 lines total; docs/INTERFACE-INVENTORY.md:98 | Envelope builder (validate → dry-run → confirm, BR-009); inbound links from projects/page.jsx:205,366, overview/page.jsx:395, workspaces/[workspaceId]/page.jsx:28; @tested names only tests/e2e/smoke.spec.js which reaches it via page.goto(), not click-through. Omitted from this report entirely before the critic pass — see D1-shell-domain-layers-12 |
| /settings, /audit, /backup, /profile (FR-020/FR-014/FR-013/FR-038) | IMPLEMENTED | src/app/(pm)/audit/page.jsx:141 | Audit/backup/profile have full state coverage; /settings is mutation-only. Its two Sidebar nav entries ('Dashboard' and 'Settings') both point at the same /settings path and both render aria-current at once — see D1-shell-domain-layers-13 |
| /workspaces, /workspaces/[workspaceId] (FR-001) | IMPLEMENTED | src/app/(pm)/workspaces/page.jsx:92-164 | Deliberately excluded from DOMAINS; treated as 'resource' not 'capability' |
| ProjectResourceShell layout + ProjectTabs (FR-040) | IMPLEMENTED | src/app/(pm)/projects/[projectId]/layout.jsx:42-69 | 6 live tabs + 3 PLANNED tabs in 'More' disclosure |
| 13 project-resource pages under [projectId]/* | IMPLEMENTED | src/app/(pm)/projects/[projectId]/{page,all-work,board,...}/page.jsx | 14 files total; verified by cross-check not individually |
| PlatformControlShell + PlatformControlGuard (/control/roadmap, FR-105) | IMPLEMENTED | src/components/layouts/PlatformControlGuard.jsx:15-27 | Server-side guard; FORBIDDEN → notFound(); AUTH_REQUIRED → redirect('/login') |
| not-found.jsx / error.jsx / loading.jsx anywhere in src/app | MISSING | find src/app -iname not-found* returned no results | See finding D1-shell-domain-layers-06 |
| docs/INTERFACE-INVENTORY.md | PARTIAL | docs/INTERFACE-INVENTORY.md:24,130,201-207 | Machine-verified marker (line 24) accurate; human-readable §3.5 prose (line 130) and §4 table (lines 201-207) stale on multiple rows, not only the market omission |
| docs/ROUTES-SITEMAP.md | PARTIAL | docs/ROUTES-SITEMAP.md:1-8,46,104,118-120 | Status: draft 2026-08-17; 'Logical layout' tree and domain counts stale |
| tests/e2e/navigation-reachability.spec.js coverage | PARTIAL | tests/e2e/navigation-reachability.spec.js:58-165 (11 tests: 4 top-level + a 7-item loop over WORK_VIEWS at line 92) | Uses page.goto()/project tabs/command palette throughout — no DomainBar or Sidebar click anywhere in this file. Genuine DomainBar/Sidebar click-through for Development/People/Files/CRM lives in fr041/fr045/fr060/fr091 instead (see D1-shell-domain-layers-03). This file does cover Platform's /audit reachability via command palette (lines 122-130) |
| Unit-test methodology for shell/nav UI components | PARTIAL | tests/unit/fr059-strategy-edit-ui.test.js:8-13; package.json:40-63; vitest.config.js:11 | 0 of 264 tests/unit files actually render a component — the one file a naive grep for `@testing-library/react` matches is a comment explaining that this repo has *no* such dependency (`environment: 'node'`, no @testing-library/*, jsdom or happy-dom in package.json); see D1-shell-domain-layers-07 |

#### Findings

##### D1-shell-domain-layers-01 — หน้า SoT Pipeline board, inbox และ graph โหลดข้อมูลไม่ได้เลย เพราะ `useScope()` ถูก destructure อ่านฟิลด์ที่ไม่มีอยู่จริง

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | CRITICAL |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | src/app/(pm)/platform/sot-pipeline/page.jsx:31 `const { businessId } = useScope()` destructure ฟิลด์ businessId ระดับบนสุดที่ไม่มีอยู่จริง; src/app/(pm)/platform/sot-pipeline/page.jsx:37 `if (!businessId) return <ErrorState .../>` จึงทำงานเสมอ; src/app/(pm)/platform/sot-pipeline/inbox/page.jsx:23 และ src/app/(pm)/platform/sot-pipeline/graph/page.jsx:62 มีบั๊กเดียวกัน; src/context/ScopeContext.jsx:121 ค่าที่ context คืนกลับมาไม่มีคีย์ businessId ระดับบนสุดเลย มีแต่ selection.businessId / shell.activeBusinessId / currentBusiness.id ที่ซ้อนอยู่ข้างใน; tests/unit/sot-plan-board-ui.test.js:11 อ่าน source เป็น string จึงตรวจจับ businessId ที่ undefined ตอน runtime ไม่ได้ |
| สิ่งที่ควรเป็น | ทุกหน้าอื่นอ่าน active Business ผ่าน scope.shell.activeBusinessId หรือ scope.currentBusiness?.id (เช่น src/app/(pm)/files/page.jsx:19, src/app/(pm)/repositories/page.jsx:95) เพื่อให้ data fetch ทำงาน; FR-099/FR-100/FR-101 บรรยาย plan board ที่ทำงานได้จริงพร้อม state ครบ (loading, error, empty runs/queue) |
| สิ่งที่เป็นจริง | ทั้งสามหน้าของ SoT Pipeline destructure `businessId` ตรง ๆ จาก `useScope()` ซึ่งเป็น `undefined` เสมอ ผลคือ `businessId ? '/api/platform/sot/plan?...' : null` เป็น `null` ตลอด `useFetch` ไม่เคยทำงาน หน้าเหล่านี้ render สถานะ "เลือก Business..." ค้างอยู่เสมอไม่ว่าจะเลือก Business แล้วหรือไม่ FEAT-011 (SoT Pipeline Console) ใช้งานไม่ได้จริงในเบราว์เซอร์เลยวันนี้ |
| ข้อเสนอแนะ | แก้ทั้งสามไฟล์เป็น `const { shell } = useScope(); const businessId = shell.activeBusinessId;` ตามรูปแบบที่ใช้อยู่แล้วที่อื่น เพิ่ม integration/render test ด้วย ScopeProvider ที่ mock ไว้ หรือ Playwright e2e ที่ mount หน้าเดียวพร้อม Business ที่เลือกแล้วและยืนยันว่า plan/graph render ออกมาจริง |
| เกี่ยวข้อง | D1-shell-domain-layers-07 |
| การตรวจสอบ | CONFIRMED — ตรวจสอบทีละ byte แล้ว; ScopeContext.jsx:121-135 ไม่มี businessId ระดับบนสุด; ทั้งสามไฟล์ sot-pipeline destructure คีย์ที่ไม่มีอยู่จริงตัวเดียวกันเป๊ะ; ที่เหลือของ codebase ใช้ scope.currentBusiness?.id / scope.shell.activeBusinessId ยืนยันว่านี่คือ defect เฉพาะจุด |

##### D1-shell-domain-layers-02 — `/market` render ข้อมูล hardcoded 100% ไม่มี API call เลย ปุ่ม 'New Watch Rule' เป็นแค่ stub alert()

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | HIGH |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | src/modules/market-intelligence/components/MarketDashboard.jsx:12 watchRules เป็น literal array ไม่เคย fetch; src/modules/market-intelligence/components/MarketDashboard.jsx:35 observations เป็น literal array; src/modules/market-intelligence/components/MarketDashboard.jsx:92 onClick={() => alert('New Watch Rule Modal')} เป็น stub; src/app/(pm)/market/page.jsx:7 render <MarketDashboard /> โดยไม่มี props/data fetch wrapper ใด; docs/PRD-SDD-v1.0.md:302 สถานะ FR-092 บรรยายเฉพาะ backend translation core ไม่เคยพูดถึง UI |
| สิ่งที่ควรเป็น | docs/INTERFACE-INVENTORY.md §3.4 บรรยาย /market ว่า 'implemented beta' มี real-time tracking และรองรับสถานะ 'ready, empty, loading, error, forbidden'; ข้อมูล MarketObservation ที่ backend FR-092 persist ไว้ควรถูกแสดงผลจริง |
| สิ่งที่เป็นจริง | MarketDashboard.jsx ไม่มีการเรียก fetch/useFetch เลยสักครั้ง ทุก KPI/รายการ/watch-rule เป็น JS literal ล้วน ไม่มี loading/error/empty state ที่แท้จริง ไม่มี endpoint GET /api/market/observations อยู่เลย (grep ไม่พบการอ้างอิง MarketObservation ใน API แม้แต่จุดเดียว) ผู้ใช้จริงเห็นข้อมูลที่แต่งขึ้นซึ่งแยกไม่ออกจาก observation จริง |
| ข้อเสนอแนะ | เลือกทางใดทางหนึ่ง: (a) สร้าง endpoint GET /api/market/observations ต่อยอดจาก market-observation-service ที่มีอยู่แล้ว แล้วต่อสาย MarketDashboard.jsx เข้ากับ useFetch พร้อม loading/error/empty state จริง แทนที่ literal และ alert() stub หรือ (b) ตั้งค่า market entry กลับเป็น soon:true และแก้ INTERFACE-INVENTORY.md §3.4 จาก 'implemented beta' ให้สะท้อนสถานะ mock แบบ static ที่แท้จริง |
| เกี่ยวข้อง | D1-shell-domain-layers-10, D1-shell-domain-layers-11 |
| การตรวจสอบ | CONFIRMED — ตรวจแล้วว่า MarketDashboard.jsx ไม่มี fetch/useFetch เลย; grep src/app/api ไม่พบการอ้างอิง MarketObservation เลย; INTERFACE-INVENTORY.md §3.4 บรรทัด 126 ระบุ 'implemented beta' พร้อม state ต่าง ๆ ซึ่งขัดแย้งกับ implementation ที่เป็น mock จริง |

##### D1-shell-domain-layers-07 — unit test แทบทั้งหมดของ 'UI contract' ระดับ shell/navigation ตรวจสอบ raw source text ไม่ใช่ component ที่ render จริง — 0 จาก 264 ไฟล์ใน tests/unit render component เลย ไม่มี rendering harness ติดตั้งใน repo

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | HIGH |
| ประเภท | TEST_GAP |
| หลักฐาน | tests/unit/sot-plan-board-ui.test.js:11 อ่าน source เป็น string ด้วย fs.readFileSync ทุก assertion เป็น page.toContain(...) กับ string นี้; tests/unit/fr061-per-business-domain-visibility.test.js:247 อ่าน DomainBar.jsx เป็น string แบบเดียวกัน; tests/unit/fr060-business-home-visibility.test.js:91 ก็เช่นกัน; tests/unit/fr059-strategy-edit-ui.test.js:8-13 คือไฟล์ที่ grep -rl '@testing-library/react' tests/unit จับได้ว่ามีข้อความนี้ — แต่เมื่อเปิดอ่านจริงพบว่าเป็น**คอมเมนต์อธิบายว่า repo นี้ "no @testing-library/react dependency"** ไม่ได้ import ใช้งานจริงแต่อย่างใด; ยืนยันเพิ่มด้วย package.json:40-63 (ไม่มี @testing-library/*, jsdom, happy-dom ใน dependencies ใด ๆ เลย) และ vitest.config.js:11 (`environment: 'node'`) — สรุปคือมี 0 ไฟล์ที่ render component จริงจากทั้งหมด 264 ไฟล์ใน tests/unit |
| สิ่งที่ควรเป็น | ไฟล์ทดสอบชื่อ '*-ui.test.js' หรือ @tested อ้างถึง component ควรทดสอบพฤติกรรมจริงตอน runtime — การ fetch ข้อมูล, การ render ตามเงื่อนไข state ต่าง ๆ — ให้ใกล้เคียงพอที่จะจับ data path ที่พังได้ |
| สิ่งที่เป็นจริง | รูปแบบหลักคืออ่าน .jsx เป็น string แล้ว assert substring/regex ('มี API path นี้อยู่', 'ไม่มี <select>') ไม่สามารถตรวจจับ runtime defect แบบ D1-shell-domain-layers-01 (บั๊ก destructuring ของ useScope()) ได้เลย เพราะโค้ดที่มีปัญหาคือสิ่งที่ test เหล่านี้คาดหวังว่าจะเห็นอยู่แล้วพอดี ไม่ได้ประเมินพฤติกรรมจริงเลย |
| ข้อเสนอแนะ | สำหรับ component ที่มีพฤติกรรมขึ้นกับ state ให้เพิ่ม devDependency ของ @testing-library/react ก่อน แล้วตั้งค่า/แยก vitest environment เป็น jsdom (ไม่ใช่แค่ 'เขียน render test เพิ่ม' เพราะปัจจุบันไม่มี harness ให้ใช้เลย) จากนั้นจึงเพิ่ม render test ที่ mock ScopeContext/useFetch หรือ integration-level test ที่เรียก page logic จริง ส่วนรูปแบบ assert-source-text-เป็น-string ให้สงวนไว้เฉพาะข้อเท็จจริงเชิงโครงสร้าง/contract เท่านั้น นี่คือช่องว่างเชิงกระบวนการที่เป็นระบบซึ่งทำให้ D1-shell-domain-layers-01 หลุดออกไปได้โดยไม่ถูกจับ |
| เกี่ยวข้อง | D1-shell-domain-layers-01, D1-shell-domain-layers-03 |
| การตรวจสอบ | CONFIRMED, critic-corrected — grep -rl '@testing-library/react' tests/unit คืนไฟล์เดียวจริง แต่เป็น false positive (การจับคำในคอมเมนต์ที่บอกว่า "ไม่มี" dependency นี้ ไม่ใช่การ import ใช้งาน) เมื่อยืนยันกับ package.json และ vitest.config.js แล้วสรุปว่าจำนวน render test ที่แท้จริงคือ 0 ไม่ใช่ 1; 28 ไฟล์ unit test ตรงกับรูปแบบ readFileSync-ของ-.jsx-source; ช่องว่างเชิงระเบียบวิธีนี้เป็นสาเหตุโดยตรงที่ทำให้ D1-01 หลุดออกไปได้ |

##### D1-shell-domain-layers-03 — e2e test coverage ของการนำทางผ่าน DomainBar/Sidebar ไม่ครบทุก domain

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP |
| หลักฐาน | tests/e2e/navigation-reachability.spec.js มีทั้งหมด 11 tests (4 test บนสุด + loop 1 ตัวที่วนซ้ำ 7 รายการของ WORK_VIEWS ที่บรรทัด 92) และไฟล์นี้**ไม่มีการคลิก DomainBar หรือ Sidebar เลยสักจุด** — ใช้ page.goto()/project tabs/command palette ตลอดทั้งไฟล์; หลักฐานการคลิกผ่าน DomainBar/Sidebar จริงสองชั้นอยู่ที่ไฟล์อื่น: tests/e2e/fr041-business-first.spec.js:31 คลิก `getByRole('link', {name: 'HR / People'})` ไปที่ /people, tests/e2e/fr060-business-home.spec.js:58-61 คลิก DomainBar 'Development' ไปที่ /projects, tests/e2e/fr045-files.spec.js:19,21 คลิก DomainBar 'Development' แล้วคลิก Sidebar 'Files' ไปที่ /files, และ tests/e2e/fr091-conversation-inbox.spec.js:192-213 คลิกผ่าน sidebar landmark ชื่อ 'CRM sections' ไปที่ 'Inbox' จนถึง /customer/conversations — เป็นหลักฐาน click-through สองชั้นจริงสำหรับ Development+Files, HR/People และ CRM; นอกจากนี้ navigation-reachability.spec.js:122-130 ยังมี test 'search covers Platform, which it previously could not reach at all' ที่คลิกผ่าน command palette ไปยัง /audit ได้จริง |
| สิ่งที่ควรเป็น | navigation-reachability.spec.js ระบุจุดประสงค์ของตัวเองว่าเพื่อให้แน่ใจว่า 'every delivered surface has a navigation path a user can actually follow' ซึ่งบ่งบอกว่าควรมี test อย่างน้อยหนึ่งตัวต่อ domain (หรือ test ตัวแทนขั้นต่ำ) ที่คลิก DomainBar แล้วตามด้วย Sidebar entry จนถึงหน้าปลายทาง |
| สิ่งที่เป็นจริง | Development (ผ่าน Files), HR/People และ CRM มีหลักฐาน click-through สองชั้นแล้ว (ไม่ใช่แค่ Development/People อย่างที่รายงานฉบับก่อนหน้าระบุ); ที่ยังไม่มี click-through coverage เลยคือ Market Intelligence และ Platform sub-pages ส่วนใหญ่ (Users, Integrations, Customer Review, SoT Pipeline ทั้งสาม, Product Readiness, Settings, Backup, Profile) — มีเพียง compile-warmup GET หรือ page.goto() ตรง ๆ เท่านั้น ยกเว้น /audit ที่มี command-palette reachability แล้ว |
| ข้อเสนอแนะ | เพิ่ม parametrized e2e test ที่วนซ้ำทุก entry ที่ visible ใน DOMAINS.sub (ไม่รวม soon) คลิกแต่ละ DomainBar item ยืนยันว่าลงที่ Dashboard แล้วอย่างน้อยหนึ่ง Sidebar item ต่อ domain คลิกต่อไปยัง sub-page พร้อมยืนยัน heading ที่คาดไว้ — เลียนแบบ pattern ของ WORK_VIEWS loop ที่มีอยู่แล้ว test แบบนี้จะจับ D1-shell-domain-layers-01 ได้ |
| เกี่ยวข้อง | D1-shell-domain-layers-01 |
| การตรวจสอบ | ADJUSTED, critic-corrected — finder ระบุว่าไม่มี click-through coverage เลย แต่ grep กว้างขึ้นทั่ว tests/e2e/*.spec.js พบ test คลิกผ่าน DomainBar และ DomainBar+Sidebar จริงสำหรับ Development (ผ่าน Files), HR/People **และ CRM** (fr091-conversation-inbox.spec.js:192-213 ซึ่งรายงานฉบับก่อนหน้าพลาดไป) พร้อม heading assertion; จำนวน test ใน navigation-reachability.spec.js ก็ถูกนับผิดเป็น 6 ทั้งที่จริงคือ 11 และไฟล์นั้นไม่ได้ทำ click-through ผ่าน DomainBar/Sidebar เลยแม้แต่จุดเดียว (ใช้กลไกอื่น) — เครดิตที่ให้ไฟล์นี้จึงระบุแหล่งผิด ข้อสังเกตที่ยังถูกต้องคือ Market และ Platform sub-pages ส่วนใหญ่ยังไม่มี coverage จริง (ยกเว้น /audit ที่มี palette reachability) คำแนะนำยังคงใช้ได้ |

##### D1-shell-domain-layers-04 — route tree และสรุป domain ของ ROUTES-SITEMAP.md ล้าสมัยเทียบกับ src/config/domains.js และ route tree จริง

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/ROUTES-SITEMAP.md:46 หัวข้อ 'Logical layout boundaries' ตามด้วยรายการที่ขาด /customer, /market, /files, /workspaces, /platform/sot-pipeline{,/inbox,/graph}, /platform/customer-import-reviews, /platform/product-readiness, /execution (index) ฯลฯ; docs/ROUTES-SITEMAP.md:104 ระบุ 'seven runtime domain keys' ขาด Market Intelligence ไป (จริง 8); docs/ROUTES-SITEMAP.md:118-120 ลิสต์ sidebar ของ Development โดยไม่มี Files (sub-domain ที่ 8, FR-045) และใช้ป้าย pre-ADR-036 'Projects' แทน 'Dashboard'; docs/ROUTES-SITEMAP.md:3 ลงวันที่ 2026-08-17 (ก่อนหน้า FR-045 Files, การเปิดใช้ Market/CRM วันที่ 2026-08-20, ADR-036 D1 วันที่ 2026-08-19, FR-099/100/101/124/078) |
| สิ่งที่ควรเป็น | ROUTES-SITEMAP.md นำเสนอตัวเองว่าเป็น 'human-readable route map' ที่มีอำนาจอ้างอิงเสริมกับ doc graph ที่ตรวจด้วยเครื่อง บ่งบอกว่า prose ที่เขียนด้วยมือควรตามทันทะเบียนเดียวกัน |
| สิ่งที่เป็นจริง | ต่างจาก INTERFACE-INVENTORY.md ที่มี marker ตรวจด้วยเครื่อง ROUTES-SITEMAP.md ไม่มี marker แบบนั้นเลยและไม่ถูกตรวจโดย scripts/doc-preflight.mjs — ล้าสมัยไปเงียบ ๆ จากการเพิ่ม route กว่า 10 เส้นทางและการเปลี่ยนป้ายหนึ่งครั้งนับตั้งแต่ 2026-08-17 |
| ข้อเสนอแนะ | เลือกทางใดทางหนึ่ง: (a) regenerate ROUTES-SITEMAP.md จาก src/config/domains.js + page tree จริงของ src/app แบบเดียวกับที่ docs:graph regenerate view อื่น หรือ (b) เพิ่มเช็ค staleness ใน scripts/doc-preflight.mjs (marker + เทียบ regex กับ domains.js) เพื่อให้ความล้าสมัยแบบนี้ fail governance gate แทนที่จะสะสมไปเรื่อย ๆ โดยไม่มีใครเห็น |
| เกี่ยวข้อง | D1-shell-domain-layers-08, D1-entry-layers-03, D1-journey-states-tests-docs-04, D1-journey-states-tests-docs-06 (ทั้งสี่รายการอธิบายความล้าสมัยของ ROUTES-SITEMAP.md จุดเดียวกันคนละมุม) |
| การตรวจสอบ | CONFIRMED, critic-corrected เลขบรรทัด — ยืนยัน docs/ROUTES-SITEMAP.md บรรทัด 104 ระบุ domain key เจ็ดตัวพอดีโดยขาด Market Intelligence ไป; บรรทัด 118-120 ลิสต์ sidebar ของ Development โดยไม่มี Files และใช้ป้าย pre-ADR-036; ยืนยัน scripts/doc-preflight.mjs ต่อสาย staleness check ไว้เฉพาะ INTERFACE-INVENTORY.md และ A-api-spec.md เท่านั้น ไม่เคยแตะ ROUTES-SITEMAP.md เลย |

##### D1-shell-domain-layers-06 — ไม่มี not-found.jsx, error.jsx หรือ loading.jsx อยู่ที่ไหนเลยใต้ src/app; การเข้า URL ของ domain ที่สงวนไว้หรือพิมพ์ผิดจะเจอ Next.js 404 เปล่า ๆ

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/config/domains.js:40 ประกาศ commerce พร้อม sub: [{ path: '/commerce' }] แต่ไม่มี src/app/(pm)/commerce/page.jsx อยู่จริง; src/config/domains.js:61 path /growth และ /growth/campaigns ไม่มี page.jsx รองรับ; src/config/domains.js:69 path /operations ก็เช่นกัน; tests/e2e/navigation-reachability.spec.js:133 คอมเมนต์ของ test ยืนยันว่า 'soon domains are reserved slots with no page... app has no 404 screen to land on'; find src/app -iname not-found* ไม่พบผลลัพธ์ใด |
| สิ่งที่ควรเป็น | docs/INTERFACE-INVENTORY.md §5 นิยาม NOT_FOUND state ร่วมไว้เป็นส่วนหนึ่งของ state contract ของทะเบียน; DomainBar ตั้งใจ render soon domains เป็น span ที่คลิกไม่ได้เพื่อไม่ให้ผู้ใช้เจอลิงก์ตาย — บ่งบอกว่าผลิตภัณฑ์ตั้งใจให้ route ที่เข้าถึงไม่ได้ถูกจัดการอย่างสวยงามทุกจุด |
| สิ่งที่เป็นจริง | การป้องกัน 404 ของ soon-domain มีเพียงจุดเดียวคือ DomainBar/CommandPalette ไม่เคยสร้าง Link ไป path เหล่านั้น การแก้ URL เองหรือ bookmark เก่าจะเจอ Next.js 404 แบบไม่มีสไตล์ ไม่มี BusinessShell chrome ไม่มีข้อความตามธีม ไม่มีลิงก์กลับ เช่นเดียวกับ path ที่พิมพ์ผิดจริง ๆ และ render error ที่ไม่ได้ถูกจัดการ (ไม่มี error.jsx boundary ที่ไหนเลย) |
| ข้อเสนอแนะ | เพิ่ม src/app/not-found.jsx (และควรมี src/app/error.jsx ด้วย) ที่ render อยู่ใน shell แบรนด์ขั้นต่ำอธิบายว่าหน้าไม่มีอยู่จริง/เกิดข้อผิดพลาด พร้อมลิงก์กลับ /overview หรือ /login พิจารณาทำ not-found.jsx เฉพาะใต้ src/app/(pm)/ เพื่อให้ผู้ใช้ที่ล็อกอินแล้วยังได้ AppShell chrome |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED — ยืนยัน find ไม่พบไฟล์ not-found/error/loading เลย; ยืนยัน commerce/growth/operations ถูกประกาศใน domains.js บรรทัด 40/61-66/69 โดยไม่มี page.jsx คู่กัน; ยืนยัน navigation-reachability.spec.js บรรทัด 132-133 มีคอมเมนต์ยอมรับช่องว่างนี้ |

##### D1-shell-domain-layers-08 — marker ที่ตรวจด้วยเครื่องของ INTERFACE-INVENTORY.md ขัดแย้งกับตาราง reconciliation ที่มนุษย์อ่านในเอกสารเดียวกัน

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/INTERFACE-INVENTORY.md:24 `<!-- interface-inventory-counts: operational_domain_keys=8; operational_subdomain_entries=26 -->` ยืนยันถูกต้องตรงกับ src/config/domains.js (8 operational DOMAINS keys + 1 business-home = 9 รวม; 26 sub entries + 1 = 27 รวม); docs/INTERFACE-INVENTORY.md:130 เนื้อความ prose ระบุ 'seven domain keys' ล้าสมัยเช่นเดียวกับ marker ก่อนแก้; docs/INTERFACE-INVENTORY.md:201 'Source DOMAINS entries \| 8' เลขคำนวณผิด (1+7=8 ตามคำอธิบายในแถวเดียวกัน แต่จริงคือ 1+8=9); docs/INTERFACE-INVENTORY.md:202 'Operational domain keys \| 7' ขาด market ไป; docs/INTERFACE-INVENTORY.md:204 'Source sub-domain entries \| 23' จริงคือ 27; docs/INTERFACE-INVENTORY.md:205 'Operational sub-domain entries \| 22' จริงคือ 26 (ขัดกับ marker เองที่ระบุ operational_subdomain_entries=26 พอดี); docs/INTERFACE-INVENTORY.md:207 'Platform navigation entries \| 7' นับต่ำไป จริงคือ 9 (Dashboard, Product Readiness, Users, Integrations, Customer Review, SoT Pipeline, Audit, Backup, Settings — นับจาก src/config/domains.js:132-144); scripts/doc-preflight.mjs:406-419 ตรวจสอบเฉพาะ HTML-comment marker เท่านั้น (มีอีกเช็คหนึ่งที่บรรทัด 400-403 ตรวจว่าทุก page route ถูกลงทะเบียนใน INTERFACE-INVENTORY.md หรือไม่ แต่ทั้งสองเช็คไม่แตะตาราง prose §4 เลยและไม่แตะ ROUTES-SITEMAP.md เลยเช่นกัน) |
| สิ่งที่ควรเป็น | ข้อเท็จจริงที่ประกาศไว้ในเอกสารเดียวกันเกี่ยวกับทะเบียนเดียวกันควรตรงกัน — ส่วนที่ตรวจด้วยเครื่อง (marker) ไม่ควรขัดแย้งกับ prose ไม่กี่ย่อหน้าถัดมาที่ไม่ถูกตรวจ |
| สิ่งที่เป็นจริง | marker ถูกต้อง; ตาราง §4 'Runtime registry reconciliation' ล้าสมัยเกือบทุกแถว (แทบแน่นอนว่าไม่ถูกอัปเดตตอน Market เปลี่ยนจาก soon:true เมื่อ 2026-08-20) ทำให้ผู้อ่านที่อิงตารางนี้นับ domain ต่ำกว่าความจริงในหลายมิติ ไม่ใช่แค่การละเว้น market เพียงจุดเดียว |
| ข้อเสนอแนะ | แก้บรรทัด 130, 201, 202, 204, 205, 207 ให้ตรงกับค่าจริง (9 top-level entries รวม business-home, 8 operational domain keys รวม market, 27 sub-domain entries รวม business-home, 26 operational sub-domain entries, 9 Platform navigation entries) และขยาย scripts/doc-preflight.mjs ให้ตรวจตัวเลข/รายการใน prose table เทียบกับ src/config/domains.js ด้วย ไม่ใช่แค่ marker เพื่อไม่ให้ความล้าสมัยแบบนี้เกิดซ้ำแบบเงียบ ๆ อีก |
| เกี่ยวข้อง | D1-shell-domain-layers-04 |
| การตรวจสอบ | CONFIRMED, critic ขยายขอบเขต — คำนวณจำนวน DOMAINS อิสระแล้วตรงกับ marker (9 รวม, 8 operational); ยืนยันว่าไม่ใช่แค่บรรทัด 201/202/207 ที่ผิดตามที่รายงานเดิมระบุ แต่บรรทัด 130, 204, 205 ก็ผิดเช่นกัน (204/205 ขัดกับ marker ในเอกสารเดียวกันเองด้วยซ้ำ); ยืนยัน Platform navigation entries ที่ถูกต้องคือ 9 ไม่ใช่ 8 ตามที่คำแนะนำเดิมระบุผิด; ยืนยันตำแหน่งเช็คใน scripts/doc-preflight.mjs คือบรรทัด 406-419 (marker) และ 400-403 (page-route coverage) ไม่ใช่บรรทัด 395 ตามที่รายงานเดิมอ้าง |

##### D1-shell-domain-layers-10 — เอกสารที่สร้างอัตโนมัติอ้างหน้า /market ที่เป็น mock ที่ตัดขาดจาก backend เป็นหลักฐานว่า FR-092 "มีชีวิตอยู่จริง"

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/FEATURE-MAP.md:107 แถว FR-092 อ้าง `app/(pm)/market/page.jsx +19` เป็นไฟล์รองรับสถานะ '✅ live'; docs/TRACE.md:728 มี trace entry ของ FR-092 เดียวกันจาก @req annotation บน market/page.jsx; src/app/(pm)/market/page.jsx:7 ไฟล์ที่ถูกอ้างถึงนี้ render <MarketDashboard /> โดยไม่มี props/data wiring ใด (ดู D1-shell-domain-layers-02) |
| สิ่งที่ควรเป็น | generated trace/feature view ที่ลง page.jsx เป็นหลักฐานว่า requirement เป็น '✅ live' ควรหมายความว่าหน้านั้นเป็นผู้ใช้งานข้อมูลของ requirement นั้นจริง แบบเดียวกับที่ graph ถูกใช้ที่อื่น (จุดประสงค์ทั้งหมดของ TRACE.md ตาม CLAUDE.md คือ 'surface → code → rules → tests') |
| สิ่งที่เป็นจริง | market/page.jsx มี annotation `@req FR-092` (ซื่อสัตย์เกี่ยวกับ backend translation core) แต่ตัว generator ไม่มีทางรู้ว่า component ที่มันเรียกใช้เป็น mock แบบ static ที่ตัดขาดจาก backend ทำให้ทั้ง FEATURE-MAP/TRACE นำเสนอ mock UI เป็นหลักฐานสนับสนุนสถานะ '✅ live' ซึ่งผู้อ่านจะสรุปอย่างสมเหตุสมผลแต่ผิดว่าฟีเจอร์นี้ทำงานครบวงจรแล้ว |
| ข้อเสนอแนะ | นี่คือข้อจำกัดเชิงโครงสร้างของการ generate เอกสารจาก annotation: ให้เลือกทางใดทางหนึ่ง คือตัดไฟล์ UI ออกจากรายการหลักฐานเมื่อสถานะ PRD ของ requirement นั้นจำกัดขอบเขตไว้แค่ backend เท่านั้น (แบบที่ FR-092 เป็น) หรือเพิ่ม annotation แยกประเภท (เช่น `@req-ui-pending`) เพื่อให้ graph ตีธงว่า 'annotated แต่ยังไม่ต่อสาย' แทนที่จะรวมเข้ากลุ่ม '✅ live' |
| เกี่ยวข้อง | D1-shell-domain-layers-02 |
| การตรวจสอบ | verifier-added — พบระหว่างตรวจสอบ generated view; FEATURE-MAP.md/TRACE.md ทั้งคู่ลง market/page.jsx เป็นหลักฐานของสถานะ '✅ live' ของ FR-092 ทั้งที่ไฟล์นั้นเป็น mock 100% ไม่มีแหล่งข้อมูลจริงเลย |

##### D1-shell-domain-layers-05 — entry 'Dashboard' ของ /people render component/เนื้อหาเหมือน /people/directory ทุกประการ — ไม่มี dashboard ที่แยกจริง

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | LOW |
| ประเภท | PARTIAL |
| หลักฐาน | src/app/(pm)/people/page.jsx:8 return <PeopleDirectory />; src/app/(pm)/people/directory/page.jsx:8 return <PeopleDirectory directoryOnly />; src/modules/people/components/PeopleDirectory.jsx:29 ความต่างที่สังเกตได้มีแค่ title prop |
| สิ่งที่ควรเป็น | ตามธรรมเนียมของทะเบียน DOMAINS sub-domain แรกของทุก domain คือ 'Dashboard' — เป็น surface สรุป/landing ที่แยกจากกัน แบบเดียวกับที่ /customer (KPI + บทสนทนาล่าสุด + ลิงก์ไป Inbox) ต่างจาก /customer/conversations (inbox เต็ม) |
| สิ่งที่เป็นจริง | Dashboard ของ People domain (/people) และ sub-domain ที่สอง (/people/directory) render React component เดียวกันเป๊ะ ด้วย data fetch เดียวกันและตารางเดียวกัน ต่างกันแค่ข้อความ title ใน <h1> ไม่มีเนื้อหาสรุป/KPI ใดที่เฉพาะ Dashboard เลย |
| ข้อเสนอแนะ | เลือกทางใดทางหนึ่ง: สร้าง People Dashboard จริง (KPI จำนวนคน, การแบ่งตาม scope, ลิงก์ไป directory — component คำนวณ peopleCount/businessScopedCount/tenantScopedCount ไว้อยู่แล้ว) หรือถ้าไม่มีแผนทำ Dashboard แยกในเร็ว ๆ นี้ ให้ยุบสอง nav entry เหลือหนึ่งเดียว ('People Directory' ที่ /people) แล้วตัด route /people/directory ทิ้ง พร้อมอัปเดต FR-042 feature note และ INTERFACE-INVENTORY.md §3.5 |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED — อ่าน people/page.jsx, people/directory/page.jsx และ PeopleDirectory.jsx บรรทัด 1-45 แล้ว ยืนยัน component/fetch เหมือนกันเป๊ะ ต่างกันแค่ title prop |

##### D1-shell-domain-layers-09 — checkbox สิทธิ์ domain บน /platform/users ลิสต์ทุก DOMAINS รวมถึง domain ที่ soon:true ซึ่งไม่มีหน้าจริงรองรับอยู่เบื้องหลัง

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | LOW |
| ประเภท | PARTIAL |
| หลักฐาน | src/app/(pm)/platform/users/page.jsx:54 {DOMAINS.map((domain) => ( ... ))} วนซ้ำทั้ง array DOMAINS โดยไม่มีการกรอง soon เลย; src/config/domains.js:40 commerce: soon: true; src/components/layouts/DomainBar.jsx:52 กรองด้วย isDomainVisible/soon — สองจุดนี้ไม่สอดคล้องกัน |
| สิ่งที่ควรเป็น | surface สำหรับให้สิทธิ์ควรเสนอเฉพาะ domain ที่ grant นั้นมีผลจริงเท่านั้น; DomainBar เองก็ปฏิบัติกับ soon domains เป็นของสงวน/ใช้งานไม่ได้อยู่แล้ว |
| สิ่งที่เป็นจริง | OWNER บน /platform/users สามารถติ๊ก 'Commerce', 'Marketing', 'Operations' ให้ MEMBER ได้ ทั้งที่ไม่มีหน้าใดรองรับเลย checkbox นี้ไม่มีผลที่สังเกตได้จริงวันนี้ (สิทธิ์ที่ให้เป็นของจริง แต่ capability ยังไม่มีอยู่) — เป็นความไม่ตรงกันเล็ก ๆ ระหว่างความคาดหวังกับความน่าเชื่อถือ |
| ข้อเสนอแนะ | กรองรายการ checkbox ด้วย `DOMAINS.filter((d) => !d.soon)` ให้ตรงกับตัวกรองของ DomainBar เอง หรือถ้าตั้งใจจะให้สิทธิ์ล่วงหน้าสำหรับ capability ในอนาคตจริง ๆ ให้เพิ่มข้อความกำกับ ('สงวนไว้ — ยังใช้งานไม่ได้') แบบเดียวกับ tooltip ของ DomainBar |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED — ยืนยัน page.jsx:54 วนซ้ำ DOMAINS แบบไม่กรอง; ยืนยัน DomainBar กรองด้วย isDomainVisible/soon; ยืนยันว่า grant เป็นของจริง (Membership.domainKeysJson ถูกใช้ใน business-shell-guard.js) แต่ capability ยังไม่มีอยู่ |

##### D1-shell-domain-layers-11 — annotation `@tested` ของ market/page.jsx อ้างอิงไฟล์ test ที่ไม่เคยแตะหน้าหรือ component นี้เลย

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | src/app/(pm)/market/page.jsx:5 `// @tested tests/unit/market-intelligence/price-observation-domain.test.js`; tests/unit/market-intelligence/price-observation-domain.test.js:15 describe('PriceObservation domain', ...) — เป็น unit test ของ domain-object ล้วน ไม่มีการ import MarketDashboard ไม่มีการ render ไม่มี assertion ระดับหน้าเลย |
| สิ่งที่ควรเป็น | ตามธรรมเนียม doc-code annotation ของ repo นี้ (CLAUDE.md) `@tested` ควรชี้ไปที่ 'where the proof lives' สำหรับพฤติกรรมของไฟล์ที่ annotate ไว้ |
| สิ่งที่เป็นจริง | ไฟล์ test ที่ถูกอ้างถึงพิสูจน์แค่ว่า class PriceObservation/WatchRule ทำงานถูกต้องแบบแยกเดี่ยว ไม่มีการอ้างอิงถึง page/MarketDashboard component/UI ที่ render เลยแม้แต่จุดเดียว annotation นี้จึงกล่าวเกินจริงเรื่อง test coverage และทำให้ผู้ที่ใช้ annotation หา regression coverage ของหน้านี้เข้าใจผิด (ซึ่งไม่มีอยู่จริง ตาม D1-shell-domain-layers-02) |
| ข้อเสนอแนะ | เลือกทางใดทางหนึ่ง: เพิ่ม UI-level test จริงให้ market/page.jsx/MarketDashboard.jsx แล้วคง annotation ไว้ หรือแก้ annotation ให้ชี้เฉพาะ backend test จาก domain/application files ที่ทดสอบจริง แล้วปล่อยช่อง `@tested` ของหน้านี้ว่างพร้อมหมายเหตุว่ายังไม่มี UI test |
| เกี่ยวข้อง | D1-shell-domain-layers-02, D1-shell-domain-layers-07, D1-journey-states-tests-docs-08 (บรรยายข้อเท็จจริงเดียวกัน — critic ปรับระดับ finding นี้จาก LOW เป็น MEDIUM ให้ตรงกัน) |
| การตรวจสอบ | verifier-added, critic-corrected — พบระหว่าง cross-check annotation; การอ้างอิงตัดขาดจากไฟล์หน้าจริง เลขบรรทัดแก้จาก :4 เป็น :5 ให้ตรงกับตำแหน่งจริงของ annotation; ปรับระดับความรุนแรงจาก LOW เป็น MEDIUM เพื่อให้ตรงกับ D1-journey-states-tests-docs-08 ซึ่งบรรยายข้อเท็จจริงและหลักฐานชุดเดียวกัน |

##### D1-shell-domain-layers-12 — `/projects/new` (FR-017 objective intake) ไม่มีทั้ง inventory row และ finding ใด ๆ ในรายงานฉบับก่อนหน้า ทั้งที่เป็นหน้าจริงในชั้น Domain → Sub-domain และเป็น human intake surface ที่ BR-009 กำกับ

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP |
| หลักฐาน | src/app/(pm)/projects/new/page.jsx:1-7 (`@req FR-017`, `@spec BR-003`, `@tested tests/e2e/smoke.spec.js` เพียงไฟล์เดียว); ไฟล์นี้ยาว 384 บรรทัด; inbound links: src/app/(pm)/projects/page.jsx:205 และ :366, src/app/(pm)/overview/page.jsx:395, src/app/(pm)/workspaces/[workspaceId]/page.jsx:28; docs/INTERFACE-INVENTORY.md:98 ลงทะเบียนหน้านี้ไว้แล้วพร้อม required states 'validation, conflict, loading, error, success'; tests/e2e/smoke.spec.js:180 ใช้ `page.goto('/projects/new')` (ไม่ใช่ click-through); grep รายงานฉบับก่อนหน้าหาคำว่า 'projects/new' ได้ 0 ครั้ง |
| สิ่งที่ควรเป็น | มิตินี้ประกาศว่าเดินทุกชั้นของ route tree รวมถึงชั้น Sub-domain; `/projects/new` เป็น 1 ใน 4 intake surfaces ที่ BR-009/SDD-009 กำกับ (envelope → validate → dry-run → preview → commit) มี inbound link จริงจาก 3 หน้า และถูกลงทะเบียนใน INTERFACE-INVENTORY.md แล้ว จึงควรถูกประเมิน state/guard/test เหมือนหน้าอื่นทุกหน้าในรายงานนี้ |
| สิ่งที่เป็นจริง | หน้านี้ไม่ปรากฏในรายงานฉบับก่อนหน้าเลยแม้แต่บรรทัดเดียว ทั้งในตาราง Inventory และใน Findings การประเมิน test coverage พบว่า `@tested` ชี้ไปที่ tests/e2e/smoke.spec.js เพียงไฟล์เดียว ซึ่ง reach หน้านี้ด้วย `page.goto()` ตรง ๆ ไม่ใช่การคลิกผ่าน UI จริง — เป็นทั้ง coverage hole ของรายงานเองและช่องว่างด้าน test ของหน้าจริง |
| ข้อเสนอแนะ | เพิ่ม e2e test ที่คลิกจาก /projects หรือ /overview ผ่านปุ่ม 'Create Project' ไปยัง /projects/new จริง แทนที่จะ page.goto() ตรง ๆ และเมื่อทำรายงานลักษณะนี้ในอนาคต ให้ตรวจสอบรายการ inbound-link ของทุกหน้าที่ INTERFACE-INVENTORY.md ลงทะเบียนไว้เทียบกับรายการที่รายงานครอบคลุมจริง เพื่อไม่ให้เกิด coverage hole แบบนี้ซ้ำ |
| เกี่ยวข้อง | — |
| การตรวจสอบ | critic-added |

##### D1-shell-domain-layers-13 — Platform domain ไม่มี Dashboard ที่แยกจาก Settings — sidebar สองรายการชี้ path `/settings` เดียวกัน และถูกทำเครื่องหมาย active พร้อมกันทั้งคู่ (aria-current ซ้ำ)

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | PARTIAL |
| หลักฐาน | src/config/domains.js:133 `{ label: 'Dashboard', path: '/settings', icon: LayoutDashboard }` และ src/config/domains.js:143 `{ label: 'Settings', path: '/settings', icon: Settings }`; src/components/layouts/Sidebar.jsx:34 `domain.sub.map(...)` ไม่มีการ dedupe และบรรทัด 36 `const active = pathname === item.path || pathname.startsWith(...)`; src/components/layouts/Sidebar.jsx:52 `aria-current={active ? 'page' : undefined}`; docs/INTERFACE-INVENTORY.md:130-132 ยอมรับสภาพนี้ไว้เป็นข้อความ 'Dashboard and Settings navigation entries share /settings' |
| สิ่งที่ควรเป็น | รายงานฉบับก่อนหน้าตรวจพบรูปแบบเดียวกันนี้ที่ /people แล้ว (D1-shell-domain-layers-05, LOW) แต่ Platform เป็นชั้นสุดท้ายก่อน Control และเป็นกรณีที่หนักกว่า เพราะ /settings ยังเป็นหน้าเดียวใน BusinessShell ที่รายงานเองระบุว่าเป็น 'mutation-only' ไม่มี state coverage — Sidebar ที่ render สอง nav entry ชี้ path เดียวกันไม่ควรทำ `aria-current="page"` ให้ทั้งคู่พร้อมกัน เพราะเป็นปัญหา accessibility จริง ไม่ใช่แค่ความซ้ำซ้อนของป้าย |
| สิ่งที่เป็นจริง | `DOMAINS` ประกาศ sub รายการแรกของ Platform เป็น 'Dashboard' ชี้ไป `/settings` และรายการสุดท้าย 'Settings' ก็ชี้ไป `/settings` เดียวกัน Sidebar.jsx render ทุก sub โดยไม่ dedupe และคำนวณ `active` จาก pathname ตรง ๆ ผลคือ link ทั้งสองถูกใส่ `aria-current="page"` พร้อมกัน และผู้ใช้เห็นสองเมนูที่พาไปหน้าเดียวกันโดยไม่มีอะไรแยกความต่าง — สรุปคือ Platform domain ไม่มี Dashboard ที่แยกออกมาจริงเลย |
| ข้อเสนอแนะ | ยุบสอง nav entry ของ Platform เหลือรายการเดียว ('Settings' ที่ /settings) หรือสร้าง Platform Dashboard จริงที่แยกออกจาก /settings (เช่น สรุปสถานะ integrations/audit/backup) แล้วย้าย path ของ Dashboard entry ไปที่หน้าใหม่นั้น พร้อมทั้งแก้ Sidebar.jsx ให้ dedupe รายการที่ path ซ้ำกันไม่ให้ `aria-current="page"` ติดพร้อมกันสองจุดไม่ว่ากรณีใด |
| เกี่ยวข้อง | D1-shell-domain-layers-05, D1-shell-domain-layers-08 |
| การตรวจสอบ | critic-added |

#### ข้อจำกัดการตรวจ

**ครอบคลุม**: ส่วนของ Business shell guard, layout, context, domain/navigation config, components (DomainBar, Sidebar, CommandPalette, AppShell) ทั้งหมด; ทั้ง 26 business pages (overview, customer, market, people, files, repositories, platform sub-pages, etc.) บวก /projects/new ที่ critic เพิ่มเข้ามาภายหลัง; ทั้ง 13 project-resource sub-pages ตรวจสอบผ่าน cross-check INTERFACE-INVENTORY.md (ไม่ได้เปิดทีละหน้า); documentation files (INTERFACE-INVENTORY.md, ROUTES-SITEMAP.md); test files (navigation-reachability.spec.js, domain-navigation.test.js, sot-plan-board-ui.test.js, smoke.spec.js, warmup.setup.js, fr041/fr045/fr060/fr091 e2e specs); 264 files ใน tests/unit ตรวจสอบว่ามีไฟล์ที่ใช้ @testing-library/react จริงหรือไม่ (0 ไฟล์ — grep เดิมจับ false positive จากคอมเมนต์)

**ไม่ได้เปิด**: src/app/(pm)/projects/page.jsx (390 บรรทัด — ตรวจสอบแค่ header/link), src/app/(pm)/platform/integrations/page.jsx (1245 บรรทัด — แค่ import/useFetch lines); src/modules/project-manager/views/universal/{AllWorkView, TimelineView, DependenciesView, MilestonesView}.jsx (ข้ออ้างอิง indirect ผ่าน tests เท่านั้น); src/modules/project-manager/components/ManagedFilesPanel.jsx, ProductReadinessDashboard.jsx และส่วนใหญ่ components สำหรับ platform/integrations, customer-import-reviews (ตรวจสอบแค่ page-level wiring เท่านั้น)

**ไม่ได้รัน npm scripts** — analysis ทั้งหมดเป็น static (grep, find, file read) ตามที่ข้อมูลให้มา; ไม่ได้ execute test, build, govern, docs:graph ใด ๆ; ไม่ได้ตรวจสอบ runtime behavior ของ component ยกเว้น code flow analysis ของ ScopeContext.jsx return value (ซึ่งพอเพียงในการพิสูจน์ useScope() bug D1-01)

**นับได้โดยตรง**: 44 page.jsx files ใต้ src/app/(pm)/** (`find "src/app/(pm)" -name page.jsx | wc -l` = 44, รวม src/app/(pm)/projects/new/page.jsx และ src/app/(pm)/workspaces/[workspaceId]/page.jsx); 54 page routes รวมทั้ง src/app (ตรงกับ marker page_routes=54 ใน docs/INTERFACE-INVENTORY.md:24); 9 DOMAINS entries (1 business-home + 8 operational); 27 DOMAINS.sub entries total (26 excluding business-home); 0 not-found.jsx/error.jsx/loading.jsx files; 0 ไฟล์ใน 264 ไฟล์ของ tests/unit ที่ import @testing-library/react จริง (ไม่ใช่ 1 ไฟล์ตามที่รายงานฉบับก่อนหน้าระบุ — เป็น false positive)

**รอบ critic (หลังการ assemble):** เพิ่ม 2 finding ใหม่ (D1-shell-domain-layers-12, -13), แก้เลขบรรทัดหลักฐานใน D1-01/-03/-04/-08/-11 หลายจุด, ปรับระดับ D1-shell-domain-layers-11 จาก LOW เป็น MEDIUM เพื่อให้ตรงกับ D1-journey-states-tests-docs-08, และแก้ตัวเลขนับ (264 ไฟล์ tests/unit แทน ~241, 44 หน้าแทน 41, 0 ไฟล์ testing-library แทน 1) — รวม 13 findings ในหน่วยนี้หลัง critic

## journey-states-tests-docs

#### สรุปย่อ

- **อินทิเกรชัน Journey State ครบ 95%**: เลเยอร์ entry/business-routing/business-shell ทั้งหมดถูกนำมาใช้และทดสอบ แต่ session-store failure (503) ถูกยุบลงในการแสดงผล "ขออนุญาต" อย่างเดียวกับ 401 ทั่วไป เสียไป AC#6 ของ FR-046
- **ช่องว่าง PlatformGrant Revocation**: Schema ประกาศ revokedAt/revokeReason/grantedByPersonId แต่ไม่มี code path ใดใน src/ ที่เขียน/อัปเดตค่าเหล่านี้ — revocation เป็นการดำเนินการ DBA ขั้นตอนเดียว ไม่ใช่ฟีเจอร์แอปพลิเคชัน
- **ขาด "Operator ที่สอง"**: bootstrapOperator() ปฏิเสธเสมอเมื่อ operator ที่ยืนหนึ่งมีอยู่ — ไม่มีเส้นทาง UI/CLI ในการอนุญาต operator ตัวที่สองหรือ successor
- **เอกสารล้าสมัย 3 ไฟล์**: ROUTES-SITEMAP.md, ADR-027, FR-044 ยังคงอ้างว่า profile-first onboarding ยังต้องการการนำมาใช้ (FR-066/067 ออกแบบแล้ว)
- **Route trees ไม่สมบูรณ์**: ROUTES-SITEMAP.md หายไป /market, /customer, /files, /platform/sot-pipeline, /platform/product-readiness ขณะที่ INTERFACE-INVENTORY.md บันทึกเส้นทางเหล่านี้ แล้ว
- **ช่องว่าง e2e สี่ที่**: Platform Control (FR-105), Market page component, และ entry three (waiting-room/workspace-home/profile) ไม่มีหลักฐาน e2e แม้จะกำหนดว่า ✅ implemented
- **`/control/roadmap` เป็น dead-end surface จริง** ไม่ใช่แค่ขาด e2e — ไม่มี inbound link จากที่ใดในแอปเลยและไม่มีทางกลับ (พบเพิ่มเติมโดย critic ดู D1-journey-states-tests-docs-12)
- **ตัวกรอง entityType ของ Audit browser กรองได้เพียง 16 จาก 46 ค่าที่เขียนจริง** ไม่ใช่แค่ขาด 'PERSON' อย่างที่เคยระบุ (ขยายขอบเขตโดย critic ดู D1-journey-states-tests-docs-11)

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|---|---|---|---|
| src/lib/business-routing.js (buildBusinessRouting) | IMPLEMENTED | src/lib/business-routing.js:9-21; tests/unit/business-routing.test.js | ตัวกรองบริสุทธิ์ของธุรกิจตาม viewer.visibleBusinessIds |
| src/lib/home-scope.js (buildHomeScope) | IMPLEMENTED | src/lib/home-scope.js:14-40; tests/unit/home-scope.test.js | — |
| src/lib/shell-mode.js (deriveShell) | IMPLEMENTED | src/lib/shell-mode.js:36-61; tests/unit, integration, e2e | ทดสอบ 3 ระดับ (unit/integration/e2e) |
| src/modules/identity/entry-read-model.js (buildViewerEntry) + GET /api/entry | IMPLEMENTED | src/modules/identity/entry-read-model.js:33-78; src/app/api/entry/route.js:1-16 | — |
| GET /api/viewer → resolveRequestViewer | IMPLEMENTED | src/app/api/viewer/route.js:1-11; src/modules/identity/request-viewer.js:9-36 | — |
| / Landing, /login Credential Login | IMPLEMENTED | src/app/page.jsx, src/app/login/page.jsx:1-49 | — |
| /businesses Business Routing | IMPLEMENTED | src/app/(entry)/businesses/page.jsx:48-100 | — |
| /onboarding/profile Profile setup | IMPLEMENTED | src/app/(entry)/onboarding/profile/page.jsx:1-49 | สถานะ error branch เหมือนกัน |
| /waiting-room Waiting Room | IMPLEMENTED | src/app/(entry)/waiting-room/page.jsx:1-46 | — |
| /workspace-home Workspace Home | IMPLEMENTED | src/app/(entry)/workspace-home/page.jsx | error-branch pattern เหมือนกัน |
| /plugin/authorize Plugin Consent | IMPLEMENTED | src/app/(entry)/plugin/authorize/page.jsx:1-112; src/modules/identity/plugin-consent-*; tests/unit/fr123-* | Unique: genuine 401 vs 503 distinction ในตรวจสอบฟิลด์และการทดสอบ |
| /overview BusinessShell root | IMPLEMENTED | src/app/(pm)/overview/page.jsx; tests/e2e/fr060-business-home.spec.js | — |
| src/lib/business-shell-guard.js + BusinessShellGuard.jsx | PARTIAL | src/lib/business-shell-guard.js:41-91; src/components/layouts/BusinessShellGuard.jsx:19-50; tests/unit | ยุบ viewerError (401 หรือ 503) ทั้งหมด → AUTH_REQUIRED; FORBIDDEN ไม่แสดงข้อความชัด |
| Domain pages: /customer, /market, /people, /work, /repositories, /files | IMPLEMENTED | find of src/app/(pm)/**/page.jsx | /market ไม่มีหลักฐานทดสอบ UI |
| Project resource shell /projects/[projectId]/* | IMPLEMENTED | src/app/(pm)/projects/[projectId]/**; tests/e2e/fr040, fr077 | — |
| /platform/users (FR-038 Membership/role admin) | IMPLEMENTED | src/app/api/platform/users/route.js:1-21 | — |
| POST /api/platform/users/password-resets (FR-104) | IMPLEMENTED | src/app/api/platform/users/password-resets/route.js:1-20; unit + real-db tests | — |
| PlatformGrant OPERATOR capability: bootstrap (create) | IMPLEMENTED | src/modules/identity/operator-bootstrap.js:46-120; scripts/bootstrap-operator.mjs; tests/unit | — |
| PlatformGrant OPERATOR capability: revoke, grant 2nd/successor | DECLARED_ONLY | prisma/schema.prisma:208-223 declares revokedAt/revokeReason/grantedByPersonId; zero .update()/.delete() in src/ | ดู finding 02, 03 |
| PlatformControlShell /control/roadmap (FR-105) | IMPLEMENTED | src/app/(control)/layout.jsx; src/components/layouts/PlatformControlGuard.jsx; src/lib/platform-control-guard.js; deployed 2026-08-27 | ไม่มีหลักฐาน e2e (ดู finding 07) |
| FR-094 canonical principal/membership authority | IMPLEMENTED | src/modules/identity/resolve-viewer.js:52-86,161-162; status ACTIVE filters | Phase 0 P0 ท้องถิ่น ตรงตามรายการสินค้า |
| FR-095 session lifecycle (persisted, revocable Session) | IMPLEMENTED | src/modules/identity/session-port.js:47-80 | live Session row check, tokenHash, status ACTIVE, expiresAt |
| FR-096 shared policy enforcement seam | PARTIAL | src/modules/identity/request-viewer.js:9-36; src/modules/identity/agent-tool-authorizer.js | ท้องถิ่น P0 เท่านั้น; canary/live-provider NOT_RUN ตามเอกสาร |
| FR-097 ChannelIdentity / verified LINE onboarding | PARTIAL | src/modules/identity/channel-identity.js; tests/integration; tests/unit | webhook/turn/ingest wired ด้วยการทดสอบ integration; provider onboarding evidence ยังคงรอ |
| FR-098 agent/tool/MSP authorization | PARTIAL | src/modules/identity/agent-tool-authorizer.js present | Phase 0 status; ไม่ verify เพิ่มเติม |
| docs/ROUTES-SITEMAP.md 'ADR-027 pre-shell target' section | DOC_DRIFT | docs/ROUTES-SITEMAP.md:24-26 | ดู finding 04 |
| docs/ROUTES-SITEMAP.md route trees | DOC_DRIFT | docs/ROUTES-SITEMAP.md:46-93 | ดู finding 06 |
| docs/decisions/ADR-027 status header | DOC_DRIFT | docs/decisions/ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md:3 | ดู finding 05 |
| docs/INTERFACE-INVENTORY.md §2/§3.1 shell table | IMPLEMENTED | docs/INTERFACE-INVENTORY.md:48-89 | ปัจจุบันและถูกต้อง (อัปเดต 2026-08-29) |
| docs/PRODUCT.md §2.1 Profile-first boundary | IMPLEMENTED | docs/PRODUCT.md:77-88 | ถูกต้อง ไม่พบการเลื่อนตัว |
| MarketDashboard.jsx (/market page) | PARTIAL | src/app/(pm)/market/page.jsx:1-9; grep -rl MarketDashboard tests → no hits | ดู finding 08 |
| FR-066/FR-067 e2e proof (waiting-room, workspace-home, onboarding/profile) | PARTIAL | tests/e2e/*.spec.js directory; no waiting-room/workspace-home/onboarding hits | ดู finding 09 |

#### Findings

##### D1-journey-states-tests-docs-01 — client-side guard ทุกจุดยุบ 503 session-store outage ให้กลายเป็น redirect "ไปล็อกอิน" เหมือนกับ 401 จริง

| ฟิลด์ | รายละเอียด |
|---|---|
| ระดับ | HIGH |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | src/modules/identity/request-viewer.js:17 (mint 503 SESSION_UNAVAILABLE); src/app/(entry)/businesses/page.jsx:55 (จุดที่ยุบ); src/app/(entry)/waiting-room/page.jsx:30 (เช่นเดียวกัน); src/lib/platform-control-guard.js:16 (`if (viewerError \|\| !viewer) return { state: 'AUTH_REQUIRED', redirect: '/login' }` — จุดที่ยุบทั้ง 401 และ 503 เข้าด้วยกันจริง ๆ ของฝั่ง Platform Control); src/components/layouts/PlatformControlGuard.jsx:25-26 (ผลลัพธ์ที่ตามมา: AUTH_REQUIRED → redirect('/login'), อื่น ๆ → notFound()); src/lib/business-shell-guard.js:52 (guard ไม่ inspect ค่า error เลย); src/modules/identity/plugin-consent-view.js:55 (ข้อยกเว้นเดียว: `Number(error?.status) === 401 ? 'AUTH_REQUIRED' : 'SESSION_UNAVAILABLE'`); tests/unit/business-shell-guard.test.js:25 (การยุบนี้ถูก test ล็อกไว้เป็นพฤติกรรมที่คาดหวัง) |
| สิ่งที่ควรเป็น | FR-046 AC#6 และ FR-123 ออกแบบการปฏิบัติฝั่ง client ต่อ 503 ให้แยกจากกันชัดเจน ('ระบบ session ล่ม ลองใหม่อีกครั้ง') ไม่ใช่ 'คุณถูกล็อกเอาต์'; plugin-consent-view.js ใช้รูปแบบนี้อยู่แล้วจริง |
| สิ่งที่เป็นจริง | ทั่วทั้ง journey ยกเว้น plugin-consent เพียงจุดเดียว guard ทั้งหมด (entry pages, BusinessShellGuard, PlatformControlGuard) ทิ้งการแยก 401-vs-503 และ redirect ไปที่ /login เสมอ — session-store ที่ล่มชั่วคราวจะส่งผู้ใช้ที่ล็อกอินอยู่แล้วไปหน้าล็อกอินโดยไม่มีข้อความอธิบายหรือทางเลือกให้ลองใหม่เลย |
| ข้อเสนอแนะ | เลือกทางใดทางหนึ่ง: (a) ส่งต่อค่า SESSION_UNAVAILABLE ผ่าน resolveBusinessShellDecision/resolvePlatformControlDecision และหน้า entry โดยใช้รูปแบบของ plugin-consent-view.js เพื่อแสดง state 'ลองใหม่' ที่ชัดเจน หรือ (b) ถ้าเป็นการตัดสินใจของผลิตภัณฑ์ว่า fail-closed-to-login เป็น UX ที่ตั้งใจแบบเดียวกันทุกจุด ให้อัปเดตเอกสารและ test ของ FR-046/FR-123 ให้ตรงกันแทน พร้อมเพิ่ม test คลุม branch 503 ของ guard ทุกตัว |
| เกี่ยวข้อง | D1-journey-states-tests-docs-10, D1-entry-layers-09 (บรรยายข้อเท็จจริงเดียวกันในขอบเขตเฉพาะสี่หน้า pre-shell — critic ปรับระดับ D1-entry-layers-09 เป็น HIGH ให้ตรงกัน) |
| การตรวจสอบ | CONFIRMED, critic เพิ่มหลักฐาน — verifier ยืนยัน signal SESSION_UNAVAILABLE ใน request-viewer.js, รูปแบบการยุบใน businesses/waiting-room, business-shell-guard.js ที่ `if (viewerError)` ไม่แยก branch เลย และการแยก 401-vs-503 จริงใน plugin-consent-view.js; critic เพิ่ม src/lib/platform-control-guard.js:16 เป็นหลักฐานหลักของฝั่ง Platform Control (จุดยุบจริง) แทนที่จะอ้างเฉพาะ PlatformControlGuard.jsx:25 ซึ่งเป็นเพียงผลลัพธ์ที่ตามมาเท่านั้น |

##### D1-journey-states-tests-docs-02 — PlatformGrant ถูกเอกสารระบุว่า "revocable" แต่ไม่มี code path ใดในระบบที่ revoke มันจริง

| ฟิลด์ | รายละเอียด |
|---|---|
| ระดับ | HIGH |
| ประเภท | DECLARED_NOT_BUILT |
| หลักฐาน | docs/PRD-SDD-v1.0.md:317 (FR-107 ทำเครื่องหมายว่า ✅ implemented, deployed 2026-08-27); prisma/schema.prisma:213 (คอลัมน์ revokedAt, revokeReason, grantedByPersonId); src/modules/identity/operator-bootstrap.js:64-67,96-99 (มีเฉพาะ .create() เท่านั้น ไม่มี .update()/.delete() บน platformGrant เลยใน src/) |
| สิ่งที่ควรเป็น | ข้อความ PRD สำหรับฟีเจอร์ที่ ✅ implemented และ deployed ถึง production แล้ว ระบุว่า grant นี้ revocable และการ revoke มีผลตั้งแต่ request ถัดไป |
| สิ่งที่เป็นจริง | hasOperatorGrant() อ่านค่า status:'ACTIVE' อย่างถูกต้องแล้ว ดังนั้น grant ที่ถูก flip ในฐานข้อมูลจะถูกเคารพจริง — แต่ไม่มี route/service/CLI ใดในโค้ดที่ทำการ flip นั้นเลย revocation เป็นเพียง capability ระดับ schema โดยไม่มีกลไกระดับ application รองรับ |
| ข้อเสนอแนะ | สร้าง revoke path จริง (service function + API route ที่จำกัดเฉพาะ operator เลียนแบบรูปแบบการ revoke ของ Session/ExternalIdentity/RBAC/WorkspaceMembership เช่น src/modules/identity/rbac-service.js:138) พร้อม test ของมัน หรือแก้ข้อความ PRD ของ FR-107 ให้ระบุว่าการ revoke ปัจจุบันเป็นการดำเนินการ manual/DBA เท่านั้น |
| เกี่ยวข้อง | D1-journey-states-tests-docs-03 |
| การตรวจสอบ | CONFIRMED; verifier ตรวจ prisma schema, ยืนยัน operator-bootstrap.js มีแต่ .create(), grep ทั่ว src/ หา .update()/.delete() บน platformGrant ได้ผลลัพธ์ศูนย์ |

##### D1-journey-states-tests-docs-03 — ไม่มีเส้นทางใดเลย — ทั้ง UI และ CLI — สำหรับเพิ่ม operator คนที่สองหรือ successor เมื่อมี operator คนแรกอยู่แล้ว

| ฟิลด์ | รายละเอียด |
|---|---|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/modules/identity/operator-bootstrap.js:50 (`if (standing) throw BOOTSTRAP_REFUSED_OPERATOR_EXISTS` แบบไม่มีเงื่อนไขอื่น); src/modules/identity/operator-bootstrap.js:61 (โหมด grantOnly ก็ยังต้อง !standing เช่นกัน); src/app/(pm)/platform/users/page.jsx:1 (สิทธิ์ Membership/role ของ FR-038 จำกัดแค่ระดับ Business เท่านั้น ไม่ใช่ระดับ OPERATOR) |
| สิ่งที่ควรเป็น | สัญญาของ FR-094 บ่งบอกโมเดลอำนาจ IAM ที่ดำเนินต่อเนื่องได้; ข้อความของ FR-107 กล่าวถึง 'every later grant issued by standing operator' ว่าเป็น lifecycle ที่ตั้งใจไว้หลัง bootstrap |
| สิ่งที่เป็นจริง | ไม่มีโค้ดใดเลยที่ให้ standing operator ออก grant ถัดไปนั้นได้จริง bootstrapOperator() เป็น one-shot และเป็นผู้เขียน PlatformGrant เพียงรายเดียว หากบัญชี operator หายหรือถูกล็อก ไม่มีกลไกใดใน repo สร้างตัวแทนขึ้นมาใหม่ได้เลย นอกจากการเข้าไปแก้ database ตรง ๆ |
| ข้อเสนอแนะ | ตัดสินใจและสร้างเส้นทาง 'standing operator ให้ grant แก่ operator ถัดไป' ตามที่ข้อความ FR-107 สัญญาไว้ — เป็น POST route ที่จำกัดเฉพาะ operator เรียก service function ใหม่ grantOperator() ที่แยกจาก bootstrapOperator() — พร้อม test คู่กับ tests/unit/operator-bootstrap.test.js |
| เกี่ยวข้อง | D1-journey-states-tests-docs-02 |
| การตรวจสอบ | CONFIRMED; verifier ตรวจสอบเช็ก standing-grant ที่ไม่มีเงื่อนไขก่อน branch grantOnly, grep หาการเรียกใช้ bootstrapOperator/OPERATOR_CAPABILITY พบ route call site เป็นศูนย์ |

##### D1-journey-states-tests-docs-04 — ส่วน "ADR-027 pre-shell target" ของ ROUTES-SITEMAP.md ยังบอกว่า Profile-first journey ยังไม่ implement ทั้งที่ shipped แล้ว

| ฟิลด์ | รายละเอียด |
|---|---|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/ROUTES-SITEMAP.md:24 ('not implemented by current route tree yet'); docs/PRD-SDD-v1.0.md:276-277 (FR-066/067 ✅ implemented); docs/INTERFACE-INVENTORY.md:82 ('/onboarding/profile' implemented ลงวันที่ 2026-08-29); src/app/(entry)/waiting-room/page.jsx:1 (ไฟล์มีอยู่จริง ต่อสายกับ /api/onboarding/state, /api/workspace-invites/accept) |
| สิ่งที่ควรเป็น | เอกสารที่ลงวันที่ 2026-08-17 บรรยายเป้าหมายในอนาคตควรถูกอัปเดตเมื่อ ship แล้ว; ไฟล์เองก็ระบุกฎเรื่องความล้าสมัยและสั่งให้รัน docs:graph/preflight |
| สิ่งที่เป็นจริง | ROUTES-SITEMAP.md ไม่ถูกแตะต้องเลยตั้งแต่ 2026-08-17 (สถานะ: draft); ข้อความหลักเกี่ยวกับ ADR-027 กลายเป็นเท็จไปแล้ว; route ที่ระบุว่ายัง unimplemented มีอยู่จริง annotate ด้วย @req FR-066/067 และถูกใช้งานโดย tests/unit/workspace-onboarding-routes.test.js และ integration test |
| ข้อเสนอแนะ | อัปเดตส่วน ADR-027 ของ docs/ROUTES-SITEMAP.md ให้สะท้อนว่า /onboarding/profile, /waiting-room implemented แล้ว และแก้ช่องว่างที่เหลือ (เป้าหมายของเอกสารตั้งชื่อ /workspaces ระดับบนสุด แต่ implementation ใช้ /workspace-home คนละ path) |
| เกี่ยวข้อง | D1-journey-states-tests-docs-05, D1-journey-states-tests-docs-06, D1-entry-layers-03, D1-shell-domain-layers-04 (ทั้งสี่รายการอธิบายความล้าสมัยของ ROUTES-SITEMAP.md จุดเดียวกันคนละมุม) |
| การตรวจสอบ | CONFIRMED; verifier อ่าน ROUTES-SITEMAP.md ทั้งไฟล์ ยืนยันสถานะ FR-066/067 และยืนยันว่าไฟล์หน้าเหล่านั้นมีอยู่จริง |

##### D1-journey-states-tests-docs-05 — status header ของ ADR-027 เองและ feature note ของ FR-044 ยังอ่านว่า "implementation pending" สำหรับงานที่ shipped แล้ว

| ฟิลด์ | รายละเอียด |
|---|---|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/decisions/ADR-027:3 ('Status: Accepted — design approved; implementation pending'); docs/domains/identity/features/FR-044:18 (กรอบข้อความ 'follow-up is implemented'); docs/PRD-SDD-v1.0.md:276 (FR-066 ✅ implemented) |
| สิ่งที่ควรเป็น | ADR ที่ FR ในเครือถูกทำเครื่องหมาย ✅ implemented แล้วควรมีสถานะที่อัปเดตตาม; feature note ที่อ้างถึง follow-up ที่ยัง pending ควรแก้ไขเมื่องานนั้น ship แล้ว เพื่อไม่ให้ผู้อ่านเข้าใจผิด |
| สิ่งที่เป็นจริง | เอกสารทั้งสองยังอ่านเหมือนช่วง design-time ของวันที่ 2026-08-17 เป๊ะ ไม่มีการอัปเดตใด ๆ สะท้อนว่า FR-066/067 shipped แล้ว |
| ข้อเสนอแนะ | เพิ่มบรรทัดสถานะที่ลงวันที่ให้ ADR-027 (เช่น addendum ใต้หัวข้อ 'Consequences'/'Implementation') และอัปเดต FR-044 เมื่อยืนยันว่า FR-066/067 live แล้ว ตามวินัยการอัปเดตที่ใช้ที่อื่น (เช่น ช่องสถานะแบบ versioned ของ FR-046) |
| เกี่ยวข้อง | D1-journey-states-tests-docs-04 |
| การตรวจสอบ | CONFIRMED; verifier ตรวจ ADR-027:1-12 และ grep ทั้งไฟล์หาคำว่า 'implement' (ไม่พบข้อความหลัง design-time เลย), feature note ของ FR-044:14-19, และสถานะ FR-066/067 ใน PRD |

##### D1-journey-states-tests-docs-06 — route tree ของ BusinessShell และ Project-resource ใน ROUTES-SITEMAP.md ขาดหลายเส้นทางที่มีอยู่จริงในแอป

| ฟิลด์ | รายละเอียด |
|---|---|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/ROUTES-SITEMAP.md:58-75 (route tree ของ BusinessShell ลิสต์ไว้ 14 เส้นทาง ขาด /customer, /market, /files, /platform/customer-import-reviews, /platform/product-readiness, /platform/sot-pipeline); docs/ROUTES-SITEMAP.md:81 (รายการ resource ของ PM ขาด /projects/[projectId]/roadmap); src/app/(pm)/market/page.jsx, src/app/(pm)/customer/page.jsx, src/app/(pm)/platform/sot-pipeline/page.jsx มีอยู่จริงทั้งหมด |
| สิ่งที่ควรเป็น | docs/INTERFACE-INVENTORY.md §3 (เอกสารพี่น้อง อัปเดต 2026-08-29) ลงทะเบียน /customer (§3.3), Market (§3.4), Platform Control (§3.7) ไว้แล้ว — ข้อมูลมีอยู่จริง เพียงแต่ไม่ถูกนำมาปรับให้ตรงกับ route tree ของ ROUTES-SITEMAP.md |
| สิ่งที่เป็นจริง | route tree ของ ROUTES-SITEMAP.md ขาด route ที่ implement แล้วอย่างน้อย 8 เส้นทาง ทำให้ไม่น่าเชื่อถือในฐานะแหล่งเดียวสำหรับคำถาม 'BusinessShell มีอะไรบ้าง' เทียบกับ INTERFACE-INVENTORY.md |
| ข้อเสนอแนะ | regenerate route tree ของ ROUTES-SITEMAP.md จากการนับรายการชุดเดียวกับที่ INTERFACE-INVENTORY.md ใช้ (อ้างว่า 50 page routes reconciled แล้ว) หรือรวมเนื้อหาเฉพาะตัวของ ROUTES-SITEMAP.md (เป้าหมายของ ADR-027, กฎ scope/guard) เข้าไปใน INTERFACE-INVENTORY.md แล้วทำเครื่องหมายว่า archived |
| เกี่ยวข้อง | D1-journey-states-tests-docs-04, D1-entry-layers-03, D1-shell-domain-layers-04 (ทั้งสี่รายการอธิบายความล้าสมัยของ ROUTES-SITEMAP.md จุดเดียวกันคนละมุม) |
| การตรวจสอบ | CONFIRMED; verifier ตรวจ route tree เต็มของ ROUTES-SITEMAP.md:55-92 ยืนยันว่าไฟล์ market, customer, sot-pipeline, roadmap page.jsx มีอยู่จริงทั้งหมด |

##### D1-journey-states-tests-docs-07 — ชั้น Platform Control ทั้งชั้น (/control/roadmap, FR-105) ไม่มีหลักฐาน e2e เลย ทั้งที่ระบุว่า deployed สู่ production แล้ว

| ฟิลด์ | รายละเอียด |
|---|---|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP |
| หลักฐาน | docs/PRD-SDD-v1.0.md:315 (FR-105 ✅ implemented; deployed production 2026-08-27); src/app/(control)/layout.jsx:6 (@tested มีแค่ unit test); src/lib/platform-control-guard.js:3 (@tested มีแค่ unit test); tests/e2e/navigation-reachability.spec.js:143 (คลุมเฉพาะ nav ของ BusinessShell ไม่เคยแตะ /control/roadmap เลย) |
| สิ่งที่ควรเป็น | FR-104, FR-120, FR-123, FR-046 ที่อยู่ระดับสถานะเดียวกันต่างมี e2e spec เฉพาะของตัวเอง; tests/e2e/*.spec.js (17 ไฟล์) ไม่มีไฟล์ใดอ้างถึง /control หรือ 'roadmap' เลย |
| สิ่งที่เป็นจริง | ไม่มี Playwright spec ใดโหลด /control/roadmap แบบ authenticated เพื่อตรวจ FORBIDDEN/404 สำหรับผู้ที่ไม่ใช่ operator เลย; guard chain ถูกพิสูจน์แค่ระดับ unit เท่านั้น ไม่เคยพิสูจน์กับ server ที่รันจริง |
| ข้อเสนอแนะ | เพิ่ม e2e spec (เช่น tests/e2e/fr105-platform-control.spec.js): ผู้ที่ไม่ใช่ operator เข้า /control/roadmap → notFound(404), ผู้ที่ยังไม่ล็อกอิน → redirect /login, operator ที่ bootstrap แล้วเห็น roadmap render จริง |
| เกี่ยวข้อง | D1-journey-states-tests-docs-12 (ปัญหาที่หนักกว่าคือหน้านี้ไม่มี inbound link เลยด้วยซ้ำ ไม่ใช่แค่ขาด e2e) |
| การตรวจสอบ | CONFIRMED; verifier grep ทั่ว tests/e2e/*.spec.js (17 ไฟล์) พบผลลัพธ์ศูนย์สำหรับคำว่า /control หรือ roadmap |

##### D1-journey-states-tests-docs-08 — หน้า Market Intelligence domain ไม่มี UI-level test เลย และ annotation `@tested` ของหน้าเองอ้างถึง test ที่ไม่เคยแตะมันเลย

| ฟิลด์ | รายละเอียด |
|---|---|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP |
| หลักฐาน | src/app/(pm)/market/page.jsx:5 (`@tested` ชี้ไป price-observation-domain.test.js); tests/unit/market-intelligence/price-observation-domain.test.js:4 (เป็นฟังก์ชัน domain-logic ล้วน ไม่เคย import MarketDashboard ไม่มีการ render เลย); grep -rl 'MarketDashboard' tests/ ได้ผลลัพธ์ศูนย์ |
| สิ่งที่ควรเป็น | annotation `@tested` ควรชี้ไปยังสิ่งที่ทดสอบหน้า/component จริง แบบเดียวกับหน้า customer/people ที่ชี้ไปยัง e2e spec ที่โหลด route เหล่านั้นจริง |
| สิ่งที่เป็นจริง | annotation ของ market/page.jsx ชี้ไปยังหลักฐานของ backend domain-logic ไม่ใช่หลักฐานของ UI; ตัวหน้า/component เองไม่เคยถูก test ใด render เลย ต่างจาก backend module อีกกว่า 11 ตัวที่ทดสอบไว้ดีแล้ว |
| ข้อเสนอแนะ | เพิ่ม unit test แบบ render component ให้ MarketDashboard (state loading/empty/error) และ e2e spec ที่ navigate ไป /market จริง แล้วแก้ annotation `@tested` ของหน้าให้ชี้ไปยังหลักฐานจริง |
| เกี่ยวข้อง | D1-shell-domain-layers-11 (บรรยายข้อเท็จจริงเดียวกัน — critic ปรับระดับ D1-shell-domain-layers-11 เป็น MEDIUM ให้ตรงกัน) |
| การตรวจสอบ | CONFIRMED, critic แก้หัวข้อ — verifier ตรวจ annotation ของ market/page.jsx ยืนยันว่า price-observation-domain.test.js import เฉพาะฟังก์ชัน domain ล้วน grep หา MarketDashboard ทั่ว tests ได้ผลลัพธ์ศูนย์; หัวข้อเดิมเขียนผิดว่าเป็น annotation `@req` ทั้งที่หลักฐานในกล่องเดียวกันอ้างถึง `@tested` — แก้ให้ตรงกันแล้ว |

##### D1-journey-states-tests-docs-09 — FR-066/FR-067 (Profile, Waiting Room, Workspace Home) มี unit/integration coverage ที่แน่นหนา แต่ไม่มีหลักฐาน e2e เลย ต่างจาก entry-layer feature พี่น้องทุกตัว

| ฟิลด์ | รายละเอียด |
|---|---|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP |
| หลักฐาน | tests/integration/workspace-onboarding-flow.test.js (มีอยู่จริง); tests/unit/workspace-onboarding-routes.test.js:86 (มี unit coverage แต่คลุมเฉพาะ branch AUTH_REQUIRED ไม่เคยคลุม SESSION_UNAVAILABLE เลย); src/app/(entry)/waiting-room/page.jsx:11 (`@tested` ชี้ไปที่ route test ไม่ใช่ page/e2e test) |
| สิ่งที่ควรเป็น | FR-044, FR-046, FR-104, FR-120, FR-123 (สถานะ ✅ ระดับเดียวกันในกลุ่ม entry-layer) ต่างมี tests/e2e/*.spec.js เฉพาะของตัวเองทุกตัว; grep ทั่ว e2e spec หา waiting-room/workspace-home/onboarding/profile ไม่พบเลย |
| สิ่งที่เป็นจริง | รายชื่อ tests/e2e/*.spec.js ไม่มีไฟล์สำหรับ fr066/067 เลย ไม่มี spec ใด navigate ไปยัง route เหล่านั้นจริง |
| ข้อเสนอแนะ | เพิ่ม tests/e2e/fr066-profile-first-onboarding.spec.js: signup ใหม่ → ถูกบังคับ redirect ไป /onboarding/profile → Waiting Room ที่ยังไม่มีสิทธิ์เข้า Business → accept Workspace invite → เส้นทาง owner สร้าง Workspace จาก Workspace Home |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED; verifier ตรวจ annotation `@tested` ใน waiting-room/onboarding/workspace-home, grep ทุก e2e spec หา route เหล่านั้น (ผลลัพธ์ศูนย์), grep workspace-onboarding-routes.test.js หา SESSION_UNAVAILABLE (ศูนย์) |

##### D1-journey-states-tests-docs-10 — การตัดสินใจ FORBIDDEN ระดับ domain/Business ไม่เคยแสดงข้อความชัดเจน มีแต่ redirect เงียบ ๆ เสมอ ขัดกับคำอธิบายของ sitemap เอง

| ฟิลด์ | รายละเอียด |
|---|---|
| ระดับ | LOW |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/ROUTES-SITEMAP.md:149 ('Unauthorized Business/domain → explicit forbidden state or Business Overview' — ถ้อยคำแบบ 'อย่างใดอย่างหนึ่ง'); src/lib/business-shell-guard.js:62,74 (FORBIDDEN พก redirect เสมอ); src/components/layouts/BusinessShellGuard.jsx:43-46 (ทุก FORBIDDEN render 'Redirecting' ไม่เคยแสดงข้อความ forbidden ที่แยกต่างหาก; มี ErrorState ชัดเจนเฉพาะ NOT_FOUND เท่านั้น) |
| สิ่งที่ควรเป็น | ถ้อยคำในเอกสารบ่งบอกว่ามีสองผลลัพธ์: ข้อความ forbidden ที่ชัดเจน หรือการลงที่ Overview |
| สิ่งที่เป็นจริง | FORBIDDEN ไม่เคยสร้างข้อความที่แยกต่างหากเลย — เป็น redirect เงียบ ๆ อยู่หลัง loader 'Redirecting…' ทั่วไปเสมอ ผู้ใช้ไม่มีทางรู้เลยว่าทำไมถึงถูกพากลับไป Overview |
| ข้อเสนอแนะ | เพิ่มข้อความ forbidden ที่ชัดเจนสำหรับกรณี DOMAIN_ACCESS/BUSINESS_ACCESS (ให้ผู้ใช้ได้รับ feedback แทนการถูกเด้งโดยไม่มีคำอธิบาย) หรือแก้ถ้อยคำใน ROUTES-SITEMAP.md ให้ระบุว่าการเข้าถึงที่ไม่ได้รับอนุญาตวันนี้ redirect เงียบ ๆ เสมอ |
| เกี่ยวข้อง | D1-journey-states-tests-docs-01 |
| การตรวจสอบ | CONFIRMED, critic แก้เลขบรรทัด — ยืนยันถ้อยคำที่ docs/ROUTES-SITEMAP.md บรรทัด 149 (ไม่ใช่บรรทัด 141 หรือ 148 ตามที่รายงานเดิมอ้างสองที่ไม่ตรงกัน), business-shell-guard.js FORBIDDEN branches, และ BusinessShellGuard.jsx ที่ render redirect ก่อน ErrorState ซึ่งมีเฉพาะ NOT_FOUND |

##### D1-journey-states-tests-docs-11 — ตัวกรอง entityType ของ Audit browser กรองได้เพียง 16 จาก 46 ค่าที่ write service เขียนจริง — ไม่ใช่แค่ขาด 'PERSON' อย่างเดียว

| ฟิลด์ | รายละเอียด |
|---|---|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/app/(pm)/audit/page.jsx:26-30 (`const ENTITY_TYPES = ['', ...DEPENDENCY_ENDPOINT_TYPES, 'DEPENDENCY', 'REPOSITORY', 'PROJECT_REPOSITORY', 'WORKSPACE', 'PORTFOLIO', 'TENANT', 'BUSINESS', 'BRANCH', 'LEGAL_ENTITY', 'SNAPSHOT']` — DEPENDENCY_ENDPOINT_TYPES มี 6 ค่าจาก src/lib/validation/enums.js:53-60 บวกอีก 10 ค่า hand-list รวมเป็น 16 ค่าที่กรองได้); `grep -rhon "entityType: '[A-Z_]*'" src/ | sort -u | wc -l` นับได้ 46 ค่าที่ถูกเขียนจริงทั่ว src/ (ตรวจสอบซ้ำโดยตรงแล้ว ไม่ใช่ 45 ตามที่เคยกะประมาณไว้); src/modules/identity/operator-bootstrap.js:68 (`recordAudit({ entityType: 'PERSON', ... action: 'OPERATOR_BOOTSTRAPPED' })` — หนึ่งใน 30 ค่าที่กรองไม่ได้); ค่าอื่นที่กรองไม่ได้รวม WORKSPACE_INVITE, WORKSPACE_MEMBERSHIP (FR-067, D1-entry-layers-08), CUSTOMER, CONVERSATION, CONVERSATION_ANALYSIS (FR-091), INTEGRATION_CONNECTION (FR-080), PIPELINE_RUN, MEMBERSHIP, EXTERNAL_IDENTITY, CHANNEL_IDENTITY, RAW_EXTERNAL_RECORD, FILE_ASSET, FILE_CACHE, FILE_RECONCILE, AGENT_ACTION, ROLE_BINDING, STEP_UP, PRINCIPAL, TEAM, PROJECT_FILE, PROJECT_FILE_MIGRATION, PROJECT_GOAL, PROJECT_TEAM, BUSINESS_GOAL, BUSINESS_ROADMAP, EXECUTION_PLAN_BUNDLE, CUSTOMER_IMPORT_REVIEW_CASE, IDENTITY_LINK_TOKEN, LOCAL_WORKSPACE_MOUNT (รวม 30 ค่า) |
| สิ่งที่ควรเป็น | audit browser ระดับติดตั้งทั้งระบบ (FR-014) ที่ตัวกรองควรครอบคลุมทุก entityType ที่ write service ปล่อยออกมาจริง แบบเดียวกับที่ครึ่ง DEPENDENCY_ENDPOINT_TYPES derive จาก enum กลางเพื่อกันความคลาดเคลื่อน |
| สิ่งที่เป็นจริง | ช่องว่างไม่ใช่แค่ 'PERSON' หนึ่งค่าอย่างที่ finding เดิมระบุ แต่เป็น 30 จาก 46 ค่า (65%) ของ entityType ที่เขียนจริงในระบบไม่สามารถกรองได้เลย รวมถึง entityType ของฟีเจอร์ที่รายงานฉบับนี้เองยกเป็น finding อื่น ๆ (WORKSPACE_INVITE/WORKSPACE_MEMBERSHIP, CUSTOMER/CONVERSATION, INTEGRATION_CONNECTION) แปลว่า FR-014 audit browser กรองประวัติส่วนใหญ่ของระบบไม่ได้เลย ไม่ใช่แค่ประวัติ operator-grant เพียงอย่างเดียว รากปัญหาคือครึ่งที่ hand-list ไว้ใน ENTITY_TYPES ไม่ได้ derive จากแหล่งเดียวกันกับครึ่ง DEPENDENCY_ENDPOINT_TYPES |
| ข้อเสนอแนะ | เพิ่มทั้ง 30 ค่าที่ขาดเข้าไปในครึ่ง hand-list ของ ENTITY_TYPES ใน src/app/(pm)/audit/page.jsx อย่างน้อยที่สุด และพิจารณา derive รายการทั้งหมดจากแหล่งเดียว (เช่น สแกน entityType literal ที่เขียนจริงตอน build หรือรวมไว้ใน enums.js ตัวเดียวกัน) เพื่อไม่ให้ตัวกรองตกหล่นค่าใหม่ที่เพิ่มมาในอนาคตอีก การเพิ่มแค่ 'PERSON' ตัวเดียวจะปิดช่องว่างได้เพียงเศษเสี้ยวเท่านั้น |
| เกี่ยวข้อง | D1-journey-states-tests-docs-02 |
| การตรวจสอบ | verifier-added, critic ขยายขอบเขตอย่างมาก — finding เดิมถูกต้องแต่ประเมินขอบเขตต่ำเกินไปมาก (16/46 ค่าที่กรองได้ ไม่ใช่แค่ขาด PERSON ตัวเดียว); เลขบรรทัดของ ENTITY_TYPES แก้จาก :24 เป็น :26-30 ตามตำแหน่งจริง; ระดับความรุนแรงปรับจาก LOW เป็น MEDIUM ให้สอดคล้องกับขอบเขตที่แท้จริงของช่องว่างนี้ |

##### D1-journey-states-tests-docs-12 — `/control/roadmap` (FR-105) ไม่มี inbound link จากที่ใดในแอปเลย และ PlatformControlShell ไม่มีทางกลับ — Platform/Control เป็น dead-end surface ที่เข้าถึงได้ด้วยการพิมพ์ URL เท่านั้น

| ฟิลด์ | รายละเอียด |
|---|---|
| ระดับ | HIGH |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | `grep -rn "control/roadmap" src/` ทั้ง repo พบผลลัพธ์เดียวคือ src/components/layouts/PlatformControlGuard.jsx:12 (สร้าง Request object ปลอมเพื่อ resolve viewer เท่านั้น ไม่ใช่ลิงก์ที่ผู้ใช้คลิกได้); src/components/layouts/CommandPalette.jsx:47-50 (`RESOURCE_ROUTES` มีแค่ 'Spaces' และ 'My Profile' ไม่มี /control เลย); src/components/layouts/Topbar.jsx:83,129 (มีลิงก์แค่ /businesses และ /profile เท่านั้น); src/components/layouts/PlatformControlShell.jsx:5-26 (ไม่มี `<Link>` หรือ nav ใด ๆ ในไฟล์เลย); docs/ROUTES-SITEMAP.md:141-143 (ระบุเองว่า /control/roadmap 'is outside `DOMAINS`' และไม่มี Business selection ใด); tests/e2e/navigation-reachability.spec.js:6-11 (คอมเมนต์หัวไฟล์นิยาม defect class นี้ไว้ตรง ๆ ว่า 'Three routes shipped with zero inbound links from anywhere in the application ... were reachable only by typing the URL') |
| สิ่งที่ควรเป็น | ชั้น Platform/Control เป็นชั้นสุดท้ายที่มิตินี้ประกาศว่าจะเดินตรวจ (Landing → ... → Platform/Control) เช่นเดียวกับทุกหน้าอื่นในรายงานนี้ที่ถูกประเมินเรื่อง reachability; repo นี้เองถือว่า 'route ที่ไม่มี inbound link เลย เข้าถึงได้แค่พิมพ์ URL' เป็น defect class จริงจนถึงขั้นเขียน e2e suite เฉพาะขึ้นมาจับ (navigation-reachability.spec.js) |
| สิ่งที่เป็นจริง | รายงานฉบับก่อนหน้าพูดถึง FR-105 เฉพาะเรื่องขาด e2e (D1-journey-states-tests-docs-07) เท่านั้น แต่ความจริงที่หนักกว่าคือ reachability: ไม่มี `<Link href="/control/roadmap">` ที่ไหนในทั้ง repo เลย, `/control` อยู่นอก `DOMAINS` จึงไม่ปรากฏใน DomainBar/Sidebar และ CommandPalette ก็ไม่ index ให้ นอกจากนี้ PlatformControlShell ไม่มี nav หรือลิงก์กลับไป `/overview` เลยแม้แต่จุดเดียว — operator ที่เข้ามาถึงหน้านี้ได้ (ด้วยการพิมพ์ URL เอง) จะออกได้ก็ด้วยปุ่ม back ของเบราว์เซอร์เท่านั้น |
| ข้อเสนอแนะ | เพิ่ม entry point ที่เข้าถึง /control/roadmap ได้จริงสำหรับผู้ที่มีสิทธิ์ operator (เช่น รายการใน CommandPalette's RESOURCE_ROUTES ที่กรองด้วยสิทธิ์ operator, หรือปุ่มเฉพาะใน Topbar ที่แสดงเมื่อผู้ใช้เป็น operator) และเพิ่มลิงก์กลับ /overview ใน PlatformControlShell.jsx แล้วเสริม e2e ของ D1-journey-states-tests-docs-07 ให้ครอบคลุมการคลิกเข้าถึงจริง ไม่ใช่แค่ page.goto() |
| เกี่ยวข้อง | D1-journey-states-tests-docs-07 |
| การตรวจสอบ | critic-added |

#### ข้อจำกัดการตรวจ

**Coverage scope**: Cross-layer journey state machine (business-routing.js, home-scope.js, shell-mode.js, entry-read-model.js, request-viewer.js, session-port.js) — production IAM tail (FR-094..098) — operator layer (FR-107, PlatformGrant schema, bootstrap, /control/roadmap) — 401/403/404/503 rendering across BusinessShellGuard, PlatformControlGuard, entry pages, plugin-consent-view — documentation drift (INTERFACE-INVENTORY.md, ROUTES-SITEMAP.md, PRODUCT.md, ADR-015, ADR-027, FR-044/046/066/067) — test-coverage matrix (e2e/*.spec.js 17 files, unit, integration).

**ไม่ตรวจสอบอย่างอิสระ**: (a) FR-096/098 'one shared authorization context' web/agent/tool call sites — file presence confirmed; full trace not completed; (b) resolve-viewer.js cross-tenant/cross-business denial paths beyond ACTIVE-status filter; (c) whether docs/GAP-ANALYSIS-ZURI-GOVIBE.md already documents findings 01-10 — per instruction defer to orchestrating review for cross-check; (d) ADR-015 full 172-line text — referenced via PRODUCT.md/ROUTES-SITEMAP.md citations only; (e) production/live-Supabase evidence FR-094-098 (external gate, explicitly pending per feature note) — not probed further as self-documented match to PRD.

**Dropped findings**: ไม่มี — findings 10 ที่เดิม ทั้งหมด CONFIRMED ไม่มี REFUTED; verifier-added 1 (finding 11) เพิ่มเติม.

**รอบ critic (หลังการ assemble):** เพิ่ม 1 finding ใหม่ (D1-journey-states-tests-docs-12, HIGH — /control/roadmap ไม่มี inbound link เลย), แก้เลขบรรทัดหลักฐานใน D1-01/-08/-10, ขยายขอบเขตและปรับระดับ D1-journey-states-tests-docs-11 จาก LOW เป็น MEDIUM (16/46 entityType ที่กรองได้ ไม่ใช่แค่ขาด PERSON), และแก้ภาษาผสมกลางประโยคในหลายกล่องให้เป็นไทยทั้งหมด — รวม 12 findings ในหน่วยนี้หลัง critic

## ข้อเสนอแนะเรียงตามลำดับความสำคัญ

### ทำได้ทันทีในโค้ด

1. **แก้บั๊ก `useScope()` destructuring ในสามหน้า SoT Pipeline** — เปลี่ยน `const { businessId } = useScope()` เป็น `const { shell } = useScope(); const businessId = shell.activeBusinessId;` ใน `src/app/(pm)/platform/sot-pipeline/page.jsx`, `.../inbox/page.jsx`, `.../graph/page.jsx` ปิด **D1-shell-domain-layers-01** (CRITICAL — ต้องทำก่อนอันดับแรก)
2. **เพิ่มปุ่ม sign-out** ที่ `/profile` หรือเมนูบัญชีใน BusinessShell/EntryShell ให้เรียก `POST /api/auth/logout` แล้ว redirect ไป `/login` ปิด **D1-entry-layers-01**
3. **เพิ่ม rate limiting ให้ `POST /api/auth/login`** โดยใช้รูปแบบเดียวกับ `signupRateLimiter` ใน `src/app/api/auth/signup/route.js:43` ปิด **D1-entry-layers-02**
4. **เพิ่ม `src/app/not-found.jsx` และ `src/app/error.jsx`** ที่มี branding ขั้นต่ำและลิงก์กลับ `/overview`/`/login` ปิด **D1-shell-domain-layers-06**
5. **กรอง checkbox สิทธิ์ domain บน `/platform/users`** ให้ตัด `soon:true` ออก (หรือใส่ป้าย "ยังไม่เปิดใช้งาน") ที่ `src/app/(pm)/platform/users/page.jsx:54` ปิด **D1-shell-domain-layers-09**
6. **เพิ่มค่าที่ขาดทั้ง 30 ค่าเข้า `ENTITY_TYPES`** ใน `src/app/(pm)/audit/page.jsx:26-30` (ไม่ใช่แค่ `'PERSON'` — ตัวกรองปัจจุบันครอบคลุมเพียง 16 จาก 46 ค่าที่เขียนจริง) หรือ derive รายการทั้งหมดจากแหล่งเดียวกับที่เขียน entityType จริง ปิด **D1-journey-states-tests-docs-11**
7. **สร้างโมดูล `onboarding-error-copy.js`** สำหรับ mutation catch block ใน waiting-room/workspace-home/onboarding-profile และให้ตรวจ `err.status===401` เพื่อ redirect ไป `/login` แทนการโชว์ error code ดิบ ปิด **D1-entry-layers-06**
8. **แยกการจัดการ 401 กับ 503 ในทุก guard** (BusinessShellGuard, PlatformControlGuard, entry pages) ตามรูปแบบที่ `plugin-consent-view.js:55` ทำอยู่แล้ว — แสดง state "ลองใหม่" สำหรับ SESSION_UNAVAILABLE แทนการ redirect ไป `/login` เหมือน AUTH_REQUIRED ปิด **D1-entry-layers-09, D1-journey-states-tests-docs-01**
9. **เพิ่มข้อความ FORBIDDEN ที่ชัดเจน** แยกจาก redirect เงียบ ใน `resolveBusinessShellDecision`/`BusinessShellGuard.jsx` ปิด **D1-journey-states-tests-docs-10**
10. **แก้ไข `@tested` annotation ของ `market/page.jsx`** ให้ชี้ไปยัง test จริงของหน้า/คอมโพเนนต์ หรือทิ้งว่างพร้อมหมายเหตุว่ายังไม่มี UI test ปิด **D1-shell-domain-layers-11**
11. **เพิ่ม e2e coverage ที่ขาด**: FR-066/067 journey (`fr066-onboarding-journey.spec.js`), Platform Control (`fr105-platform-control.spec.js`), Market page, และ DomainBar/Sidebar sweep ครบทุก domain (parametrized loop) ปิด **D1-entry-layers-07, D1-journey-states-tests-docs-07, D1-journey-states-tests-docs-08, D1-journey-states-tests-docs-09, D1-shell-domain-layers-03**
12. **แทนที่ unit test แบบอ่าน source เป็น string ด้วย `@testing-library/react` render test** สำหรับคอมโพเนนต์ที่มี state-dependent behavior (เริ่มจาก SoT Pipeline, DomainBar) ปิด **D1-shell-domain-layers-07**
13. **แก้ไข/regenerate `docs/ROUTES-SITEMAP.md`** ให้ตรงกับ `src/config/domains.js` และ route tree จริง (เพิ่ม /market, /customer, /files, /platform/sot-pipeline ฯลฯ, แก้จำนวน domain เป็น 8 operational) และแก้ตาราง prose §4 ของ `INTERFACE-INVENTORY.md` ให้ตรงกับ marker ปิด **D1-entry-layers-03, D1-shell-domain-layers-04, D1-shell-domain-layers-08, D1-shell-domain-layers-10, D1-journey-states-tests-docs-04, D1-journey-states-tests-docs-06**
14. **เพิ่ม addendum สถานะให้ ADR-027 และปรับปรุง feature note ของ FR-044** ให้สะท้อนว่า FR-066/067 shipped แล้ว ปิด **D1-journey-states-tests-docs-05** (ส่วนหนึ่งของ D1-entry-layers-04)

### ต้องมี migration/production gate

15. **สร้าง service + route สำหรับ revoke PlatformGrant** (ไม่ต้อง migration เพราะ schema มีฟิลด์อยู่แล้ว แต่เป็นการเปลี่ยนแปลง IAM ระดับ production ที่ต้องผ่าน security review เหมือน SEC-018/ADR-045) mirroring pattern ใน `rbac-service.js:138` ปิด **D1-journey-states-tests-docs-02**
16. **สร้าง `GET /api/market/observations`** เชื่อมกับ `market-observation-service` ที่มีอยู่แล้ว แล้วต่อสาย `MarketDashboard.jsx` เข้ากับ `useFetch` จริง (ต้องผ่าน gate เดียวกับ FR-092 external evaluation ที่ระบุใน PRD) ปิด **D1-shell-domain-layers-02** (ร่วมกับ D1-shell-domain-layers-10)

### ต้องการการตัดสินใจจากเจ้าของผลิตภัณฑ์

17. **ตัดสินใจแก้ปัญหา naming collision ของ `/workspaces`**: ย้าย PM Space compatibility page ไป `/spaces` เพื่อคืน path ให้ ADR-027 D8 หรือแก้ ADR-027 ให้ยอมรับ `/workspace-home` อย่างเป็นทางการ ปิด **D1-entry-layers-04**
18. **ตัดสินใจขอบเขตและตำแหน่งของหน้า owner-side invite management** (mint/revoke invite, remove member) แล้วสร้างขึ้นจริง เพื่อให้ FR-067 ใช้งานได้จากผลิตภัณฑ์ ปิด **D1-entry-layers-08**
19. **ตัดสินใจว่า `/people` ควรมี Dashboard เนื้อหาที่แตกต่างจาก `/people/directory` จริงหรือควรรวมเป็นเส้นทางเดียว** ปิด **D1-shell-domain-layers-05**
20. **ตัดสินใจนโยบายการสืบทอด/เพิ่ม operator คนที่สอง** (successor model) ก่อนออกแบบ service `grantOperator()` ปิด **D1-journey-states-tests-docs-03**

### เพิ่มเติมจาก critic (findings ใหม่)

21. **เพิ่ม entry point ที่เข้าถึง `/control/roadmap` ได้จริงสำหรับ operator** (CommandPalette หรือ Topbar ที่กรองด้วยสิทธิ์) และเพิ่มลิงก์กลับ `/overview` ใน `PlatformControlShell.jsx` ปิด **D1-journey-states-tests-docs-12** (HIGH — ควรทำร่วมกับข้อ 11 ที่เพิ่ม e2e ของ FR-105)
22. **เพิ่ม 6 path ที่ขาดหายเข้า `ENTRY_PATHS`** ใน `src/context/ScopeContext.jsx:22` และชุดที่ซ้ำใน `src/lib/business-shell-guard.js:10` แล้วแก้ contract test ให้ตรวจสมาชิกจริงของ set ปิด **D1-entry-layers-10**
23. **เพิ่มการเช็ค session ที่ยังใช้งานได้ก่อน render ฟอร์ม** ใน `/login`, `/signup`, `/reset-password` และ Landing แล้ว redirect ไป `/businesses` ถ้าพบ session ที่ยัง ACTIVE ปิด **D1-entry-layers-11**
24. **เพิ่ม e2e click-through ให้ `/projects/new`** จากปุ่ม 'Create Project' บน /projects หรือ /overview แทนการพึ่ง `page.goto()` เพียงอย่างเดียว ปิด **D1-shell-domain-layers-12**
25. **ยุบ nav entry ของ Platform ที่ชี้ `/settings` ซ้ำกันสองรายการ** หรือสร้าง Platform Dashboard จริงแยกจาก Settings พร้อมแก้ `Sidebar.jsx` ให้ dedupe ไม่ให้ `aria-current="page"` ติดสองจุดพร้อมกัน ปิด **D1-shell-domain-layers-13**

## ภาคผนวก ก — รายการที่ถูกตัดออกหลังตรวจสอบ

ทั้งสามหน่วยตรวจของมิตินี้รายงาน **dropped=[]** อย่างชัดเจน — ไม่มี finding ใดถูกตัดออกหลังการตรวจสอบโดย adversarial verifier:

- **entry-layers**: 7 findings CONFIRMED, 1 ADJUSTED (D1-entry-layers-04 — แก้ไขเนื้อหาย่อยเรื่อง `/workspaces/:id` แต่ยังคงยืนยัน finding เดิม ไม่ใช่การตัด), 0 REFUTED, 2 verifier-added (D1-entry-layers-08, D1-entry-layers-09) — ไม่มีรายการถูกตัดทิ้ง
- **shell-domain-layers**: findings ทั้งหมด CONFIRMED ยกเว้น D1-shell-domain-layers-03 ที่ถูก **ADJUSTED** (verifier พบหลักฐานโต้แย้งบางส่วนว่ามี e2e click-through จริงสำหรับ Development/People จึงลดระดับความรุนแรงจาก HIGH เป็น MEDIUM แต่ finding ยังคงอยู่ ไม่ได้ถูกตัดทิ้ง) — ไม่มีรายการถูกตัดทิ้ง
- **journey-states-tests-docs**: 10 findings เดิมทั้งหมด CONFIRMED ไม่มี REFUTED, verifier-added 1 รายการ (D1-journey-states-tests-docs-11) — ไม่มีรายการถูกตัดทิ้ง

กล่าวโดยสรุป: ไม่มี finding ใดในมิตินี้ถูกตัดออกด้วยเหตุผลประเภท "เป็นคำศัพท์ประวัติศาสตร์ V1/V2", "อยู่นอกขอบเขต repo โดยตั้งใจตาม ADR" หรือ "verifier หักล้างข้อกล่าวอ้างทั้งหมด" — ทุก finding ที่ finder เสนอผ่านการตรวจสอบและยังคงอยู่ในรายงานฉบับนี้ (มี 2 รายการที่ระดับความรุนแรงถูกปรับลดหลัง verify: D1-entry-layers-04 เนื้อหาย่อย และ D1-shell-domain-layers-03 จาก HIGH เป็น MEDIUM)

## ภาคผนวก ข — ข้อจำกัดของการวิเคราะห์

**ลักษณะการวิเคราะห์**: รายงานฉบับนี้เป็น **static analysis ล้วน** — ไม่มีการรัน `npm run dev`, `npm test`, `npm run build`, `npm run govern`, `npm run docs:graph`/`docs:preflight` หรือเปิดเบราว์เซอร์เพื่อตรวจสอบ runtime behavior ใด ๆ ทั้งสิ้น ทุกข้อสรุปมาจากการอ่านไฟล์ (`Read`), ค้นหา (`grep`/`find`), และการวิเคราะห์ code flow ด้วยสายตาเท่านั้น สิ่งที่ประเมินว่า "ใช้งานไม่ได้จริง" (เช่น D1-shell-domain-layers-01) มาจากการตรวจสอบ code path อย่างละเอียด (เช่น ค่าที่ `ScopeContext.jsx` คืนกลับมาจริง ๆ) ไม่ใช่จากการสังเกตพฤติกรรมจริงในเบราว์เซอร์ที่กำลังรัน — ความมั่นใจในข้อสรุปนี้จึงสูงแต่ไม่ใช่การยืนยันด้วยการรันจริง 100%

**ขอบเขตที่ไม่ได้ตรวจสอบอย่างละเอียด**:
- ไฟล์ใหญ่บางไฟล์ (เช่น `src/app/(pm)/platform/integrations/page.jsx` 1,245 บรรทัด, `src/app/(pm)/projects/page.jsx` 390 บรรทัด) ตรวจสอบเฉพาะจุด wiring ระดับบนสุด ไม่ได้เปิดอ่านทั้งไฟล์
- Component ย่อยจำนวนมากในโดเมน project-manager (`AllWorkView`, `TimelineView`, `ManagedFilesPanel`, `ProductReadinessDashboard` ฯลฯ) ตรวจสอบผ่านการอ้างอิงทางอ้อมจาก test/cross-check กับ INTERFACE-INVENTORY.md เท่านั้น ไม่ได้เปิดอ่านโดยตรงทุกไฟล์
- 13 project-resource sub-pages ใต้ `[projectId]/*` ตรวจสอบด้วยการ cross-check การมีอยู่ของไฟล์และ annotation เท่านั้น ไม่ได้เปิดอ่านทีละหน้า
- FR-096/098 ("one shared authorization context" สำหรับ web/agent/tool call sites) ตรวจสอบเฉพาะการมีอยู่ของไฟล์ ไม่ได้ trace เส้นทางเรียกใช้งานแบบครบวงจร
- `resolve-viewer.js` cross-tenant/cross-business denial path ตรวจสอบเฉพาะ filter สถานะ ACTIVE เท่านั้น ไม่ได้ตรวจ edge case ทั้งหมด
- ADR-015 (172 บรรทัด) อ้างอิงผ่านการอ้างถึงใน PRODUCT.md/ROUTES-SITEMAP.md เท่านั้น ไม่ได้เปิดอ่านทั้งฉบับ
- หลักฐานการทำงานจริงบน production/Supabase สำหรับ FR-094..098 (production IAM gate ที่ยังรอ evidence ตาม feature note) ไม่ได้ถูกตรวจสอบเพิ่มเติม เนื่องจากเป็น external gate ที่อยู่นอกขอบเขตการเข้าถึงของการวิเคราะห์นี้ — ถือว่าตรงกับสถานะที่ PRD ระบุไว้เอง (self-documented)
- ไม่ได้ตรวจสอบว่า `docs/GAP-ANALYSIS-ZURI-GOVIBE.md` (เอกสารข้ามระบบที่มีอยู่ก่อนแล้ว) ได้บันทึก finding ใดในรายงานนี้ไว้แล้วหรือไม่ — ปล่อยให้เป็นหน้าที่ของขั้นตอนรวมผล (assemble/critic) ระดับที่สูงกว่าเพื่อ cross-check ข้ามมิติ

**หลักการอ่านสถานะ PRD**: ข้อความสถานะใน `docs/PRD-SDD-v1.0.md` (เช่น "✅ implemented") ถูกยึดถือตามที่ระบุไว้ (taken at face value) **ยกเว้นในกรณีที่โค้ดจริงขัดแย้งกับข้อความนั้นอย่างชัดเจน** ซึ่งจะถูกบันทึกเป็น finding ประเภท DOC_DRIFT หรือ BROKEN_FLOW (เช่น D1-shell-domain-layers-01 ที่ PRD ระบุว่า deployed แต่โค้ดพิสูจน์ว่าใช้งานไม่ได้จริง) ในกรณีที่ไม่มีหลักฐานขัดแย้งในโค้ด ข้อความสถานะของ PRD ถือเป็นความจริงของรายงานฉบับนี้โดยไม่มีการตรวจสอบเพิ่มเติมกับ production/staging environment จริง

**คำศัพท์ประวัติศาสตร์**: ไม่มี finding ใดในมิตินี้อ้างอิงคำว่า "Zuri V2"/"V1" หรือกล่าวถึง "การขาด parity" กับโปรเจกต์เดิมที่ `G:\zuri` — ตรวจสอบยืนยันแล้วว่าไม่มีการปนเปื้อนจากคำศัพท์ประวัติศาสตร์เหล่านี้เข้ามาในชุด finding ตามกฎของ ADR-024
