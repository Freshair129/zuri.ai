# มิติที่ 3 — Data pipeline: surface ไหนรับข้อมูลจาก user บ้าง และข้อมูลไหลเข้าครบทุกขั้นหรือไม่ (entry → validate → service → audit → persist → read/consume)

## ข้อมูลทั่วไป

| ฟิลด์ | ค่า |
|---|---|
| รายงาน | มิติที่ 3 (D3) — Data pipeline gap analysis: ทุก surface ที่รับข้อมูลจาก user (หรือระบบภายนอกในนามของ user) ถูกตรวจสอบทีละขั้น ตั้งแต่ boundary validation (Zod), semantic check, authorization, dry-run/preview (เมื่อกฎบังคับ), application-service write, audit event, persistence (SQLite dev / Postgres prod parity) ไปจนถึงจุดอ่าน/consumer ปลายทางที่ทำให้ข้อมูลนั้นมองเห็นหรือใช้งานได้จริง |
| วันที่ | 2026-09-02 |
| ขอบเขต | ระบุ surface รับข้อมูลจาก user ทุกจุดใน repo นี้ (LINE webhook, plan/envelope intake ทั้ง 6 ทาง, Excel, MCP, Enterprise API, backup import, CRUD forms ของ business/project-manager, identity/onboarding forms, plugin auth, document/knowledge ingestion, market-intelligence intake) แล้ว trace ทีละขั้นจนถึงจุดอ่าน/consumer ปลายทาง — ระบุจุดที่ flow สมบูรณ์, จุดที่ dead-end (เขียนแล้วไม่เคยอ่าน, ไม่มี producer, ไม่มี scheduler), และจุดที่ write ข้าม mandated pipeline |
| วิธีการ | pipeline 5 unit: finder → adversarial verifier → section-writer → assembler → critic ต่อหนึ่ง unit ตรวจ (pm-plan-intake, line-agent-crm-flow, identity-onboarding-forms, integration-knowledge-document-intake, business-pm-crud-forms); หลักฐานทุกจุดอ้างอิง file:line จาก repo ที่ HEAD ณ วันที่ 2026-09-02; ไม่รัน server, ไม่รัน test suite, ไม่มี production access — วิเคราะห์แบบ static เท่านั้น |
| แหล่งอ้างอิงหลัก | docs/PRD-SDD-v1.0.md, docs/roadmap/ROADMAP.md, docs/domains/{agent,crm,identity,integration,knowledge,market-intelligence,platform-control,project-manager}/CHARTER.md, docs/INTERFACE-INVENTORY.md, docs/TRACE.md, docs/FEATURE-MAP.md, docs/DOMAIN-MAP.md, docs/ROUTES-SITEMAP.md, docs/appendices/A-api-spec.md, docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md, docs/decisions/ADR-007/016/018/024/037/039/044/045/046/053/054, .brain/rca/2026-08-16-global-role-is-not-per-business-authority.md, .brain/rca/2026-08-17-governance-did-not-govern.md |
| ความสัมพันธ์กับเอกสารเดิม | docs/GAP-ANALYSIS-ZURI-GOVIBE.md เป็นการเทียบข้าม-ระบบ (zuri-ai เทียบกับ GoVibe Mission Control) — ไฟล์นี้เป็นการวิเคราะห์ data-pipeline **ภายใน repo เดียว** (in-repo) ไม่ทับซ้อนกัน และไม่คัดลอกเนื้อหาจากเอกสารนั้น |

## บทสรุปผู้บริหาร

การตรวจสอบ 5 หน่วยครอบคลุม 54 ช่องว่าง (5 CRITICAL, 10 HIGH, 22 MEDIUM, 13 LOW, 4 INFO) พบว่า pipeline หลักที่ถูกออกแบบไว้อย่างดี (plan-import envelope pipeline, LINE ingest → CRM, ส่วนใหญ่ของ business/project-manager CRUD) ทำงานตาม BR-009/SDD-009 ได้จริง แต่มีช่องว่างสำคัญกระจายอยู่ 5 กลุ่ม: (1) **UI เรียก endpoint ที่ไม่มีอยู่จริง** ทำให้ flow ล้มเหลว 100% ตั้งแต่ entry point, (2) **ข้อมูลถูกนำเสนอเป็นของจริงทั้งที่เป็น mock/ไม่เคยถูกอ่าน** ทำให้ผู้ใช้ตัดสินใจบนข้อมูลปลอม, (3) **service เขียนได้และมี audit ครบแต่ไม่มี UI/route ให้เรียกใช้งาน** (declared-but-unreachable) จำนวนมากในโดเมน identity/knowledge/market-intelligence, (4) **authorization รั่วจาก visibleBusinessIds แทน ownedBusinessIds** ซ้ำเป็นครั้งที่ 4 ในโดเมนเดียวกัน และ (5) **จุดอ่านที่ไม่ scope ตาม tenant/business เมื่อไม่ระบุพารามิเตอร์** ทำให้เกิด cross-tenant read leak จริงในโดเมน integration ประเด็นสำคัญที่สุด 15 รายการ:

- **D3-pm-plan-intake-01** (CRITICAL): ปุ่ม "Custom Plan Mode" และ "Direct plan upload" บนหน้า `/work` (live nav, ไม่ใช่ soon) ยิง POST ไปยัง `/api/import/plan` ที่ไม่มีอยู่จริงในโค้ด — ล้มเหลว 100%, ไม่มี dry-run/preview ใด ๆ เกิดขึ้นก่อนเลย
- **D3-line-agent-crm-flow-05** (CRITICAL): `/api/agent/heartbeat` เป็น route ที่ไม่มี authorization เขียนลง in-memory Map (ไม่ persist), ไม่มี audit, และ misattribute `@req`/`@tested` ไปยัง FR/test ที่ไม่เกี่ยวข้องกันเลย — เป็นช่องโหว่ความปลอดภัยจริง ไม่ใช่แค่ doc drift
- **D3-identity-onboarding-forms-12** (CRITICAL): ไม่มี UI ทางใดเลยที่ Tenant/Workspace Owner จะเพิ่มบุคคลใหม่เข้า Business ที่มีอยู่แล้วในฐานะ staff — ทุกเส้นทางต้องมี Membership อยู่ก่อนแล้ว หรือไม่ก็ต้องสร้าง Business ใหม่เป็นเจ้าของเอง
- **D3-integration-knowledge-document-intake-01** (CRITICAL): หน้า Market Intelligence Dashboard (`/market`) เป็น hardcoded mock data 100% แต่ nav registry ระบุ `soon: false` ทำให้ business owner เห็นเป็น feature ที่ ship แล้วและอาจตัดสินใจธุรกิจบนตัวเลขที่ไม่มีอยู่จริง
- **D3-integration-knowledge-document-intake-14** (CRITICAL, critic-added): `GET /api/platform/integrations/line-registry` ตรวจสอบสิทธิ์เฉพาะเมื่อมี `businessId` เท่านั้น — เรียกโดยไม่ใส่ query param นี้แล้วได้ทะเบียน LINE group/user ของ**ทุก tenant**ในระบบกลับมา (externalAccountId จริง + ชื่อ/รหัส tenant/business ทุกราย) เป็น cross-tenant data leak ที่ authenticated viewer รายใดก็เรียกได้ทันที
- **D3-pm-plan-intake-02** (HIGH): `StandaloneTaskModal` เขียน WorkItem/Workstream ตรงไปยัง `/api/work`+`/api/workstreams` ข้าม envelope pipeline ทั้งที่ตัวมันเองอ้าง `@req FR-017` ซึ่ง requirement บอกไว้ตรงข้ามว่า "direct modal creation is edit-only"
- **D3-integration-knowledge-document-intake-15** (HIGH, critic-added): LINE Registry (`saveLineGroup`/`saveLineUser`) เรียก `recordAudit` ผิด arity จนทุกการเรียก throw แล้วถูก `.catch(() => {})` กลืนไปเงียบ ๆ — การเขียน LINE group/user ทุกครั้งจึงไม่เคยถูกบันทึก audit เลยแม้แต่ครั้งเดียว ทั้งที่โค้ดดูเหมือนมี audit call อยู่
- **D3-line-agent-crm-flow-03 / -08** (HIGH×2): PDPA erasure (`erasePrincipal`) implement ครบและ integration-test ผ่าน แต่ (a) ไม่มี route/UI/script ใดเรียกมันได้เลยในระบบจริง และ (b) แม้เรียกได้ก็ไม่ลบ `Message.body`/`RawExternalRecord` — ข้อความสนทนาจริงของบุคคลที่ถูก "ลบ" ยังอยู่ครบ
- **D3-identity-onboarding-forms-01 / -02 / -03** (HIGH×3): workspace-invite mint/revoke/remove API สมบูรณ์แต่ไม่มี UI เลย; ข้อมูล onboarding profile (ชื่อ/นามสกุล/เบอร์) ไม่มีทางแก้ไขหรือดูได้อีกหลัง onboarding เสร็จ; plugin-auth-service เขียน record อ่อนไหว 5 จุดโดยไม่มี `recordAudit` แม้แต่ครั้งเดียว
- **D3-integration-knowledge-document-intake-02 / -05** (HIGH×2): executor สำหรับ knowledge-document ingestion (FR-109, 17-stage) implement ครบแต่ไม่มี production entry point เรียกได้เพียงจาก test; translator/persist สำหรับ market-observation ก็เช่นกัน — ทำให้ตาราง `MarketObservation` ว่างเปล่าถาวรในระบบจริง
- **D3-business-pm-crud-forms-01** (HIGH): FileAsset write ทั้ง 6 ฟังก์ชันใช้ `assertVisible` (visibleBusinessIds) แทนที่จะเป็น `assertBusinessOwned`/`ownsBusiness` — เป็น bug class เดียวกับที่เคยแก้มาแล้ว 3 ครั้งก่อนหน้า (FR-059, FR-038, FR-061) ตาม RCA 2026-08-16 แต่ยังไม่ถูกแก้ในจุดนี้

**คำวินิจฉัยโดยรวมของมิตินี้**: pipeline "แกนกลาง" ที่ผ่านการออกแบบและ audit อย่างจงใจ (plan-import envelope, LINE→CRM ingest, ส่วนใหญ่ของ project-manager CRUD) ทำงานสมบูรณ์และตรงตาม BR-009/SDD-009 จริง แต่ระบบมีรูปแบบความเสี่ยงซ้ำที่ชัดเจนคือ **"service layer เสร็จ แต่ไม่มีใครเรียก"** (declared-only / built-not-wired) กระจายอยู่ในแทบทุกโดเมน โดยเฉพาะ PDPA/compliance surfaces, knowledge/market-intelligence pipelines และ identity admin actions — และมี **จุดเดียวที่ข้อมูลปลอมถูกนำเสนอเป็นข้อมูลจริงต่อผู้ใช้** (Market Intelligence) ซึ่งเป็นความเสี่ยงเชิงความน่าเชื่อถือของผลิตภัณฑ์ที่ร้ายแรงกว่าการ dead-end ทั่วไป เส้นทาง data-in ที่มีอยู่ส่วนใหญ่ไม่ทำให้ข้อมูลเสียหายหรือรั่วไหลข้าม tenant ในกรณีทั่วไป ยกเว้นช่องโหว่ authorization ที่ยังไม่ปิดใน FileAsset (finding 01/05 ของ business-pm-crud-forms), heartbeat stub (finding 05 ของ line-agent-crm-flow) และ — ร้ายแรงที่สุดในกลุ่มนี้ — จุดอ่านของ LINE Registry (`GET /api/platform/integrations/line-registry`) ที่ไม่ scope ตาม tenant/business เลยเมื่อไม่ระบุ `businessId` ทำให้เกิด cross-tenant read leak จริงที่ authenticated viewer รายใดก็เรียกได้ (finding 14 ของ integration-knowledge-document-intake) ซึ่งต่างจากอีกสองกรณีตรงที่ไม่ต้องมีการเขียนข้อมูลใด ๆ ก่อน — อ่านอย่างเดียวก็รั่วได้ทันที

## ตารางสรุปตามหน่วยตรวจ

| หน่วย | รายการที่ตรวจ | CRITICAL | HIGH | MEDIUM | LOW | INFO | สถานะโดยรวม |
|---|---|---|---|---|---|---|---|
| pm-plan-intake | 5 | 1 | 1 | 2 | 1 | 0 | 🔴 มี broken-flow ระดับ critical บน live nav (/work) ครอบคลุม endpoint ที่ไม่มีอยู่จริงถึง 5 จุด; pipeline หลัก 6/7 surface สมบูรณ์ |
| line-agent-crm-flow | 9 | 1 | 2 | 3 | 1 | 2 | 🔴 มีช่องโหว่ความปลอดภัยจริง (heartbeat ที่ผูกกับ UI operator จริง) + PDPA erasure ใช้งานไม่ได้จริง; LINE→CRM ingest core สมบูรณ์ |
| identity-onboarding-forms | 13 | 1 | 3 | 7 | 2 | 0 | 🔴 broken-flow ระดับ critical (เพิ่ม staff ใหม่ไม่ได้) + admin/compliance actuator ขาดจำนวนมาก |
| integration-knowledge-document-intake | 21 | 2 | 3 | 7 | 7 | 2 | 🔴 mock data นำเสนอเป็นของจริง (critical) + cross-tenant read leak ใน LINE registry (critical) + knowledge/market pipeline แทบทั้งสายไม่มี production producer |
| business-pm-crud-forms | 6 | 0 | 1 | 3 | 2 | 0 | 🟠 authorization gap ซ้ำ (bug class เดิม ครั้งที่ 4) + UI ขาดสำหรับ scope/Team creators; CRUD หลักสมบูรณ์ |
| **รวม** | **54** | **5** | **10** | **22** | **13** | **4** | — |

## ตารางสรุปช่องว่างทั้งหมด

| ID | ระดับ | ประเภท | หัวข้อ | หน่วย |
|---|---|---|---|---|
| D3-pm-plan-intake-01 | CRITICAL | BROKEN_FLOW | Custom Plan Mode / Direct plan upload บน /work ยิงไป /api/import/plan ที่ไม่มีอยู่ | pm-plan-intake |
| D3-line-agent-crm-flow-05 | CRITICAL | BOUNDARY_VIOLATION | /api/agent/heartbeat ไม่มี auth, ไม่ persist, ไม่ audit, misattribute FR | line-agent-crm-flow |
| D3-identity-onboarding-forms-12 | CRITICAL | BROKEN_FLOW | ไม่มี UI ให้เพิ่ม staff ใหม่เข้า Business ที่มีอยู่ | identity-onboarding-forms |
| D3-integration-knowledge-document-intake-01 | CRITICAL | DOC_DRIFT | Market Intelligence dashboard เป็น mock data 100% แต่ nav บอกว่า shipped | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-14 | CRITICAL | BOUNDARY_VIOLATION | GET .../line-registry ไม่ scope เมื่อไม่มี businessId — คืนทะเบียน LINE ของทุก tenant | integration-knowledge-document-intake |
| D3-pm-plan-intake-02 | HIGH | BOUNDARY_VIOLATION | StandaloneTaskModal สร้าง WorkItem ตรง ข้าม envelope pipeline | pm-plan-intake |
| D3-line-agent-crm-flow-03 | HIGH | MISSING_SURFACE | PDPA erasure (erasePrincipal) ไม่มี route/UI/trigger | line-agent-crm-flow |
| D3-line-agent-crm-flow-08 | HIGH | PARTIAL | PDPA erasure ไม่ลบ Message.body/RawExternalRecord | line-agent-crm-flow |
| D3-identity-onboarding-forms-01 | HIGH | MISSING_SURFACE | Workspace invite mint/revoke/remove API ไม่มี UI | identity-onboarding-forms |
| D3-identity-onboarding-forms-02 | HIGH | MISSING_SURFACE | ข้อมูล onboarding profile แก้ไข/ดูไม่ได้อีกหลังเสร็จ | identity-onboarding-forms |
| D3-identity-onboarding-forms-03 | HIGH | BOUNDARY_VIOLATION | Plugin auth service เขียน 5 จุดไม่มี audit เลย | identity-onboarding-forms |
| D3-integration-knowledge-document-intake-02 | HIGH | MISSING_SURFACE | ingestKnowledgeDocument (FR-109) ไม่มี production trigger | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-05 | HIGH | MISSING_SURFACE | Market translation-persist path ไม่มี production producer | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-15 | HIGH | BOUNDARY_VIOLATION | LINE Registry เรียก recordAudit ผิด arity — ไม่มี write ใดถูกบันทึก audit จริง | integration-knowledge-document-intake |
| D3-business-pm-crud-forms-01 | HIGH | BOUNDARY_VIOLATION | FileAsset writes ใช้ assertVisible แทน assertBusinessOwned | business-pm-crud-forms |
| D3-pm-plan-intake-03 | MEDIUM | DOC_DRIFT | docs/TRACE.md อ้าง StandaloneTaskModal เป็นหลักฐาน FR-017 ที่ขัดแย้งกัน | pm-plan-intake |
| D3-pm-plan-intake-05 | MEDIUM | BROKEN_FLOW | /api/businesses และ /api/workspaces ไม่มีอยู่จริง แต่ 5 จุดเรียกยังคง fetch | pm-plan-intake |
| D3-line-agent-crm-flow-02 | MEDIUM | MISSING_SURFACE | ConversationAnalysis มี service เต็มแต่ไม่มี route/UI/producer | line-agent-crm-flow |
| D3-line-agent-crm-flow-04 | MEDIUM | BROKEN_FLOW | translator RawExternalRecord→MarketObservation ไม่มี caller | line-agent-crm-flow |
| D3-line-agent-crm-flow-09 | MEDIUM | PRODUCTION_GATE_OPEN | heartbeat stub ไม่อยู่ใน route-anchor-baseline ทำให้ preflight ผ่านทั้งที่ misattributed | line-agent-crm-flow |
| D3-identity-onboarding-forms-04 | MEDIUM | DECLARED_NOT_BUILT | Membership.status ไม่มีทางเข้าถึง SUSPENDED (มีแต่ hard delete) | identity-onboarding-forms |
| D3-identity-onboarding-forms-05 | MEDIUM | MISSING_SURFACE | Password-reset mint ไม่มี UI | identity-onboarding-forms |
| D3-identity-onboarding-forms-06 | MEDIUM | MISSING_SURFACE | API access keys mint/revoke ได้แต่ list ไม่ได้ (ไม่มี GET) | identity-onboarding-forms |
| D3-identity-onboarding-forms-07 | MEDIUM | DECLARED_NOT_BUILT | RoleBinding assignment ไม่มี route/UI เลย | identity-onboarding-forms |
| D3-identity-onboarding-forms-08 | MEDIUM | MISSING_SURFACE | erasePrincipal ไม่มี invocation path ในระบบจริง | identity-onboarding-forms |
| D3-identity-onboarding-forms-09 | MEDIUM | MISSING_SURFACE | reapExpiredPluginAuthRecords ไม่มี scheduler/cron | identity-onboarding-forms |
| D3-identity-onboarding-forms-10 | MEDIUM | MISSING_SURFACE | Login route ไม่มี rate limiting/lockout | identity-onboarding-forms |
| D3-integration-knowledge-document-intake-03 | MEDIUM | PARTIAL | Knowledge graph projection write path ไม่เคยถูกเรียกนอก test | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-06 | MEDIUM | BUILT_NOT_DECLARED | Phase 3-5 market services ติด @req FR-092 ผิดความหมาย | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-10 | MEDIUM | PARTIAL | DECIDED customer review case ไม่สร้าง Customer row จริง | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-17 | MEDIUM | DOC_DRIFT | LINE Registry ปนเปื้อน read model ของ FR-080/AC-075.3 health field | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-18 | MEDIUM | BOUNDARY_VIOLATION | LINE Registry เขียนไม่ transact + de-dupe ข้ามขอบเขต business | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-19 | MEDIUM | MISSING_SURFACE | POST .../replay ไม่มี UI caller เลย ทั้งที่ inventory เดิมเหมารวมเป็น IMPLEMENTED | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-20 | MEDIUM | TEST_GAP | viewer-fixture ratchet มองไม่เห็น line-registry test; isPlatformDev ไม่มีบน viewer จริง | integration-knowledge-document-intake |
| D3-business-pm-crud-forms-02 | MEDIUM | MISSING_SURFACE | FR-089 Team backend เสร็จแต่ไม่มี UI สร้าง/จัดการ Team | business-pm-crud-forms |
| D3-business-pm-crud-forms-03 | MEDIUM | MISSING_SURFACE | Scope hierarchy: 5 ใน 7 entity creators ไม่มี UI | business-pm-crud-forms |
| D3-business-pm-crud-forms-05 | MEDIUM | BOUNDARY_VIOLATION | FileAsset ลบได้ผ่าน 2 routes คนละ authorization posture | business-pm-crud-forms |
| D3-pm-plan-intake-04 | LOW | TEST_GAP | route-reachability test ไม่จับ component ที่เรียก endpoint ไม่มีอยู่ | pm-plan-intake |
| D3-line-agent-crm-flow-01 | LOW | BOUNDARY_VIOLATION (hygiene) | LINE X-Line-Signature verifier เป็น dead code ไม่ถูกเรียก | line-agent-crm-flow |
| D3-identity-onboarding-forms-11 | LOW | MISSING_SURFACE | PlatformGrant (OPERATOR) ไม่มี revoke/list path | identity-onboarding-forms |
| D3-identity-onboarding-forms-13 | LOW | MISSING_SURFACE | ไม่มี self-service "leave workspace" | identity-onboarding-forms |
| D3-integration-knowledge-document-intake-04 | LOW | BUILT_NOT_DECLARED | gbdb-rag-service มี zero callers | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-07 | LOW | MISSING_SURFACE | FR-071 tail ไม่มี Product model ปลายทาง | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-08 | LOW | MISSING_SURFACE | business_knowledge producer เป็น manual Python script | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-09 | LOW | PARTIAL | SoT decision submission ไม่มี AuditEvent | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-11 | LOW | MISSING_SURFACE | CustomerImportBatch producer เป็น offline Python script | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-12 | LOW | BUILT_NOT_DECLARED | MarketDashboard "New Watch Rule" เป็น alert() stub | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-21 | LOW | BOUNDARY_VIOLATION (hygiene) | หน้า Platform Integrations hardcode tenant UUID/code จริงเป็นค่า fallback | integration-knowledge-document-intake |
| D3-business-pm-crud-forms-04 | LOW | PARTIAL | write+recordAudit ไม่ transacted ในบริการ CRUD ส่วนใหญ่ | business-pm-crud-forms |
| D3-business-pm-crud-forms-06 | LOW | PARTIAL | rebuildBusinessFileCache write+audit ไม่ transacted | business-pm-crud-forms |
| D3-line-agent-crm-flow-06 | INFO | PRODUCTION_GATE_OPEN | production binding table ทดสอบเฉพาะ opt-in Postgres test | line-agent-crm-flow |
| D3-line-agent-crm-flow-07 | INFO | PARTIAL (positive) | ยืนยัน LINE ingest → CRM → read chain สมบูรณ์ครบทุกขั้น | line-agent-crm-flow |
| D3-integration-knowledge-document-intake-13 | INFO | PARTIAL | SotDataPlaneKey provisioning เป็น CLI-only ต่างจาก FR-106 | integration-knowledge-document-intake |
| D3-integration-knowledge-document-intake-16 | INFO | PARTIAL (positive) | ยืนยัน POST /api/platform/integrations (LLM/Vault intake) สมบูรณ์ครบทุกขั้น | integration-knowledge-document-intake |

## รายละเอียดตามหน่วยตรวจ

## pm-plan-intake

#### สรุปย่อ

- ท่อ intake จาก 6 surface หลัก (wizard UI / Excel template+upload / MCP / Enterprise API / ExecutionPlanBundle / backup import) บรรจบที่ pipeline เดียว `validate→dry-run→commit` บรรลุตาม BR-009 ✅
- **CRITICAL**: แบบฟอร์ม "Custom Plan Mode" (7-mode) และ "Direct plan upload" บน `/work` ส่งไปยัง `/api/import/plan` ที่ไม่มีอยู่จริง — ไม่มี dry-run, ไม่มี preview, failure 100% (BROKEN_FLOW)
- **HIGH**: StandaloneTaskModal สร้าง WorkItem + Workstream โดย POST โดยตรงไปยัง `/api/work` + `/api/workstreams` ข้าม envelope pipeline ทั้งที่ FR-017 ระบุ "direct modal creation is edit-only" (BOUNDARY_VIOLATION)
- เอกสาร TRACE.md อ้างถึง StandaloneTaskModal.jsx เป็นหลักฐาน FR-017 ทั้งที่ component นั้นทำพฤติกรรมตรงข้ามกับที่ requirement ระบุ (DOC_DRIFT)
- route-reachability.test.js ตรวจสอบ page nav links แต่ไม่จับ component ที่เรียก endpoint ไม่มีอยู่ (TEST_GAP)

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|------|--------|---------|
| FR-017 UI wizard 'เริ่มจากเป้าหมาย' (project creation) | IMPLEMENTED | src/app/(pm)/projects/new/page.jsx:141-176 | สร้าง envelope → POST /api/import/dry-run → POST /api/import/commit ✅ |
| POST /api/import/dry-run | IMPLEMENTED | src/app/api/import/dry-run/route.js:16-22 | dryRunPlan + Zod + semantic validation ✅ |
| POST /api/import/commit | IMPLEMENTED | src/app/api/import/commit/route.js:16-22 | commitPlan + recordAudit ✅ |
| plan-import-service.js pipeline | IMPLEMENTED | src/modules/project-manager/import/plan-import-service.js:141-354 | authorize → Zod → semantic → dry-run diff → tx commit → recordAudit ✅ |
| FR-065 import-target-authorization.js | IMPLEMENTED | src/modules/project-manager/import/import-authorization.js:29-166 | ownsBusiness ✓ isApiAccessFor ✓ ungoverned-scope refusal ✅ |
| FR-018 Excel template download | IMPLEMENTED | src/app/api/import/template/route.js:10-28 | session-auth GET + buildTemplateWorkbook ✅ |
| FR-018 Excel upload (project-scoped) | IMPLEMENTED | src/app/api/import/xlsx/route.js:14-43 | workbookToEnvelope → dryRunPlan() in-process; commit เป็น client call แยกไปที่ /api/import/commit พร้อม envelope ที่ได้ (route.js:12-13, 29-34) ✅ |
| xlsx-convert.js converter | IMPLEMENTED | src/modules/project-manager/import/xlsx-convert.js:1-77 | per-row errors, no DB touch ✅ |
| FR-069/071 MCP transport | IMPLEMENTED | src/app/api/mcp/route.js:15-38 | session viewer only, tools/call → dryRunPlan/commitPlan ✅ |
| FR-019 + FR-106 Enterprise API | IMPLEMENTED | src/modules/identity/api-access-auth.js:144-157 | resolveApiAccessViewer + Bearer apik_* (6 call sites) ✅ |
| FR-108 ExecutionPlanBundle | IMPLEMENTED | src/app/api/import/bundle/{dry-run,commit}/route.js | dryRunPlan/commitPlan per project in single tx ✅ |
| FR-013 snapshot backup import | IMPLEMENTED | src/app/api/backup/import/route.js:16-25 | preview (confirm≠true) + importSnapshot (confirm=true) + recordAudit ✅ |
| Direct CRUD: POST /api/projects (FR-003) | IMPLEMENTED | src/app/api/projects/route.js:66-69 | Zod + assertWorkspaceWritable + recordAudit; UI wizard uses envelope ✅ |
| Direct CRUD: POST /api/workstreams, /api/work (FR-004/FR-005) | PARTIAL | src/modules/project-manager/components/StandaloneTaskModal.jsx:57-93 | สร้างโดยตรงจากปุ่ม modal ข้าม envelope (see D3-pm-plan-intake-02) |
| Direct CRUD: POST /api/dependencies (FR-007) | IMPLEMENTED | src/app/api/dependencies/route.js:47-52 | explicitly declared standalone surface ✅ |
| Direct CRUD: POST /api/{containers,milestones,gates} (FR-005/FR-006) | IMPLEMENTED | src/app/api/{containers,milestones,gates}/route.js | API reachable only, zero UI call sites ✅ |
| '7-mode plan customizer' modal on /work | MISSING | src/modules/project-manager/components/PlanModeCustomizerModal.jsx:189 | POST /api/import/plan — route ไม่มี (D3-pm-plan-intake-01) |
| 'Direct plan upload' modal on /work | MISSING | src/modules/project-manager/components/UploadPlanModal.jsx:55-59 | POST /api/import/plan — route ไม่มี (D3-pm-plan-intake-01) |
| Audit read surface (GET /api/audit) | IMPLEMENTED | src/app/api/audit/route.js:14-24 | listAudit; consume PLAN_IMPORTED/CREATED/API_ACCESS_KEY_* events ✅ |
| Progress recompute on read after import | IMPLEMENTED | progress-service.js, project-inventory-read-model.js | pure calculators (no progressCache cache at commit) ✅ |
| Test coverage: core surfaces | IMPLEMENTED | tests/integration/{plan-import,xlsx-intake,execution-plan-bundle,backup}.test.js + more | FR-012/017/018/019/065/069/106/108 ✅ |
| Test coverage: StandaloneTaskModal / UploadPlanModal / /api/import/plan | MISSING | tests/ (grep = zero) | ไม่มี e2e test |

#### Findings

##### D3-pm-plan-intake-01 — แบบฟอร์ม "Custom Plan Mode" และ "Direct plan upload" บน /work ส่งไปยัง /api/import/plan ที่ไม่มีอยู่

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | CRITICAL |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | **PlanModeCustomizerModal.jsx:189** — `await api('/api/import/plan', { method: 'POST', body: { envelope, workspaceId, dryRun: false } })`; **UploadPlanModal.jsx:55** — identical POST; **src/modules/project-manager/views/universal/AllWorkView.jsx:254/259/264** — mount ทั้ง 3 modal ในแถบเครื่องมือ; **src/app/(pm)/work/page.jsx:8** — mount AllWorkView บน /work (live, non-'soon' nav item); **src/app/api/import/** — find lists only bundle/commit/dry-run/template/xlsx (no plan directory); **openapi.js:23** — documented routes ไม่มี /api/import/plan; **git log 39cf386 (2026-08-21)** — ทั้ง 2 component added together, route never existed since; **การซ้อนกันของ dead-endpoint เพิ่มเติม** — AllWorkView.jsx เอง (:115), StandaloneTaskModal.jsx (:13) และ PlanModeCustomizerModal.jsx (:54) ทั้งสามยัง `useFetch('/api/businesses')` ซึ่งไม่มี route จริงเช่นกัน (`/api/businesses` ไม่มี — มีแต่ `src/app/api/business/*`), และ PlanModeCustomizerModal.jsx (:55) กับ UploadPlanModal.jsx (:13) ยัง `useFetch('/api/workspaces')` ซึ่งไม่มี route เช่นกัน (`src/app/api/workspaces/[id]/route.js` มีแต่ PATCH/DELETE ไม่มี GET แบบ list) — ดูรายละเอียดเต็มใน D3-pm-plan-intake-05; ผลคือ `workspaceId`/`businessId` ที่ทั้งสอง modal พยายามส่งไปยัง `/api/import/plan` เป็น `undefined` อยู่แล้วตั้งแต่ก่อนถึงปัญหา endpoint ไม่มีอยู่จริงด้วยซ้ำ (PlanModeCustomizerModal.jsx:137-139,193; UploadPlanModal.jsx:53,59) |
| สิ่งที่ควรเป็น | ตาม BR-009/SDD-009 ทุก intake surface ต้องบรรจบที่ pipeline เดียว validate→dry-run→commit ผ่าน /api/import/dry-run + /api/import/commit (pattern ที่ PlanImportPanel.jsx ทำถูก) |
| สิ่งที่เป็นจริง | ทั้ง 2 component เรียก nonexistent endpoint + hardcode dryRun:false (ไม่มีการพยายาม preview เสียด้วย); Next.js → 404 HTML; useApi.js requestJson → res.json() fails → data=null → Error('Request failed (404)') → generic failure message ผู้ใช้; ล้มเหลว 100%, ไม่มีอะไรถูก validate/preview/persist; ยิ่งไปกว่านั้น แม้จะแก้ endpoint ให้ถูกต้องแล้ว businessId/workspaceId selector ของทั้งสอง modal ก็ยังคงว่างเปล่าเพราะ dropdown ต้นทางของมัน (`/api/businesses`, `/api/workspaces`) เป็น 404 เช่นกัน |
| ข้อเสนอแนะ | ชี้ 2 component ไปยัง existing shared pipeline: replace /api/import/plan ด้วย 2-step flow ที่ PlanImportPanel.jsx ใช้ — POST /api/import/dry-run (preview) → POST /api/import/commit (confirm); both routes already handle JSON envelope + workspaceId; เพิ่ม e2e/integration test exercise /work's 'Custom Plan Mode' + 'Direct plan upload' buttons end-to-end; ตรวจสอบ docs/TRACE.md FR-018/FR-012 citations; แก้ไปพร้อมกับ D3-pm-plan-intake-05 เพราะ business/workspace selector เป็นสาเหตุร่วม |
| เกี่ยวข้อง | D3-pm-plan-intake-02, D3-pm-plan-intake-03, D3-pm-plan-intake-05 |
| การตรวจสอบ | CONFIRMED |

##### D3-pm-plan-intake-02 — StandaloneTaskModal สร้าง WorkItem โดยตรงข้าม PlanEnvelope pipeline

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | HIGH |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | **StandaloneTaskModal.jsx:3** — @req FR-005, FR-017 — create work items directly; **StandaloneTaskModal.jsx:63** — POST /api/workstreams (no envelope/dry-run); **StandaloneTaskModal.jsx:77** — POST /api/work (no envelope/dry-run); **docs/PRD-SDD-v1.0.md:227** — FR-017 row: "direct modal creation is edit-only"; **docs/PRD-SDD-v1.0.md:386** — BR-009: "ทุก intake surface ต้องจบที่ pipeline เดียวกัน"; **src/app/(pm)/projects/new/page.jsx:3** — contrast: wizard header frames as envelope builder |
| สิ่งที่ควรเป็น | FR-017 registry ยืนยัน: direct-modal creation เป็น edit-only; BR-009 ว่า: ทุก intake surface converge ที่ shared validate→dry-run→commit |
| สิ่งที่เป็นจริง | StandaloneTaskModal = creation modal → POST /api/workstreams + POST /api/work direct; services individually correct — Zod ✓ FR-072 auth ✓ audit ✓ — แต่เป็น 2nd un-enveloped write path สำหรับ entity kinds ที่ PlanEnvelope pipeline เป็นเจ้าของ, ไม่มี dry-run/preview, code claim FR-017 while doing opposite; หมายเหตุเพิ่มเติม (ดู D3-pm-plan-intake-05) — Business selector ของ modal นี้เอง (`useFetch('/api/businesses')` ที่ :13) เป็น dead fetch เช่นกัน แต่ modal ยังคงเขียนสำเร็จได้จริง เพราะ `targetProjectId` ที่ใช้ POST มาจาก `/api/projects` (:14, ทำงานได้จริง) ไม่ใช่จาก businesses dropdown ที่ตายแล้ว |
| ข้อเสนอแนะ | **(a)** Reclassify under new FR document exception + drop FR-017 citation; OR **(b)** Rebuild as thin envelope constructor calling /api/import/dry-run + /api/import/commit; อย่างไรก็ตาม update FR-005/FR-017 PRD rows ให้ registry ระบุชัดเจน |
| เกี่ยวข้อง | D3-pm-plan-intake-01, D3-pm-plan-intake-03 |
| การตรวจสอบ | CONFIRMED |

##### D3-pm-plan-intake-03 — docs/TRACE.md อ้างถึง StandaloneTaskModal.jsx เป็นหลักฐาน FR-017 ทั้งที่ requirement บอก "direct modal creation is edit-only"

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | **docs/TRACE.md:136** — FR-017 heading; **docs/TRACE.md:138** — Status: done; **docs/TRACE.md:140** — Code list includes ทั้ง StandaloneTaskModal.jsx และ PlanModeCustomizerModal.jsx (คอมโพเนนต์เดียวกับที่ยิง POST /api/import/plan ที่ไม่มีอยู่จริงใน D3-pm-plan-intake-01 — ถูกอ้างเป็นหลักฐานว่า FR-017 "done" ทั้งที่ endpoint ที่มันเรียกใช้ไม่มีอยู่); **StandaloneTaskModal.jsx:3** — @req FR-017 while perform direct POST (no envelope) |
| สิ่งที่ควรเป็น | FR-017 entry ใน trace ควรแสดงว่า cited files demonstrate rule ที่ requirement ระบุ |
| สิ่งที่เป็นจริง | docs:graph mechanically collect ทุกไฟล์มี @req FR-017 ไม่มีการ verify พฤติกรรม → component ที่ทำตรงข้ามrender เป็น supporting proof |
| ข้อเสนอแนะ | ทั้ง annotate ด้วย FR ใหม่ + drop FR-017 tag, หรือ make conform; consider preflight check ที่ flag self-contradicting trace entries |
| เกี่ยวข้อง | D3-pm-plan-intake-02 |
| การตรวจสอบ | verifier-added |

##### D3-pm-plan-intake-04 — route-reachability.test.js ตรวจสอบ page nav links แต่ไม่จับว่า component fetch target มีอยู่

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | LOW |
| ประเภท | TEST_GAP |
| หลักฐาน | **tests/unit/route-reachability.test.js:1** — ตรวจสอบ PROJECT sub-routes linked from pages; **tests/unit/route-reachability.test.js:8** — scoped to pages, not API endpoints components call |
| สิ่งที่ควรเป็น | N/A — structural observation |
| สิ่งที่เป็นจริง | Natural place to catch 'mounted component calls endpoint with no route.js' (D3-pm-plan-intake-01 failure mode) ไม่ check API existence → exact defect class has no automated backstop; ขอบเขตที่แท้จริงกว้างกว่าที่รายงานเดิมระบุ — ไม่ใช่แค่ `/api/import/plan` เพียงจุดเดียว แต่มี dead fetch target อีก 4 จุดในคอมโพเนนต์เดียวกัน (`/api/businesses` × 3 call site, `/api/workspaces` × 2 call site — ดู D3-pm-plan-intake-05) ที่ backstop เดียวกันนี้จะจับได้เช่นกันถ้ามีอยู่ |
| ข้อเสนอแนะ | Extend to grep project-manager components สำหรับ /api/[\w/-]+ strings + assert route.js exists ด้วย method handler — cheap static check would catch 39cf386 **และ**ทั้ง 5 dead fetch target ที่ D3-pm-plan-intake-05 พบ (`/api/businesses` และ `/api/workspaces`) ในการรันเดียวกัน ไม่ใช่แค่ /api/import/plan |
| เกี่ยวข้อง | D3-pm-plan-intake-01, D3-pm-plan-intake-05 |
| การตรวจสอบ | verifier-added |

##### D3-pm-plan-intake-05 — /api/businesses และ GET /api/workspaces ไม่มีอยู่จริง แต่ 5 จุดเรียกใน 4 คอมโพเนนต์ที่ mount อยู่จริงยังคง fetch ไปหา

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | MEDIUM |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | **src/modules/project-manager/views/universal/AllWorkView.jsx:115** — `useFetch('/api/businesses')` (ใช้เป็น Business filter บนหน้า `/work` ที่ mount จริง); **src/modules/project-manager/components/StandaloneTaskModal.jsx:13** — `useFetch('/api/businesses')`; **src/modules/project-manager/components/PlanModeCustomizerModal.jsx:54** — `useFetch('/api/businesses')`; **PlanModeCustomizerModal.jsx:55** — `useFetch('/api/workspaces')`; **src/modules/project-manager/components/UploadPlanModal.jsx:13** — `useFetch('/api/workspaces')`; ยืนยันด้วยการค้นหา route จริง — `find src/app/api -path '*business*' -o -path '*workspace*'` คืนเฉพาะ `business/{files,goals,roadmaps,strategy}`, `workspace-invites*`, `workspace-memberships` และ `workspaces/[id]` เท่านั้น — ไม่มี `src/app/api/businesses/route.js` และไม่มี `src/app/api/workspaces/route.js` (มีแต่ `[id]/route.js` ซึ่ง export เพียง PATCH/DELETE ไม่มี GET แบบ list) |
| สิ่งที่ควรเป็น | ทุก `useFetch('/api/...')` ที่ component จริงเรียกใช้งานต้องมี route.js รองรับ method ที่ต้องการ — เช่นเดียวกับหลักการที่ D3-pm-plan-intake-01 ยืนยัน |
| สิ่งที่เป็นจริง | AllWorkView.jsx (หน้า `/work` เอง) ใช้ `/api/businesses` เป็นแหล่งข้อมูลของ Business filter — filter นี้จึงว่างเปล่าเสมอ; StandaloneTaskModal, PlanModeCustomizerModal และ UploadPlanModal ทั้งสามใช้ `/api/businesses` และ/หรือ `/api/workspaces` เป็นแหล่งข้อมูลของ business/workspace selector ภายใน modal — selector เหล่านี้ว่างเปล่าเสมอเช่นกัน ส่งผลให้ `workspaceId` ที่ PlanModeCustomizerModal/UploadPlanModal พยายามส่งไปยัง `/api/import/plan` (D3-pm-plan-intake-01) เป็น `undefined` อยู่แล้วโดยไม่เกี่ยวกับปัญหา endpoint ไม่มีอยู่จริงเลย ส่วน StandaloneTaskModal ยังคงเขียนสำเร็จได้เพราะ `targetProjectId` ที่มันใช้จริงมาจาก `/api/projects` (ทำงานได้) ไม่ใช่จาก businesses dropdown ที่ตายแล้ว (ดู D3-pm-plan-intake-02) |
| ข้อเสนอแนะ | เพิ่ม `GET /api/businesses` (รายการ Business ที่ viewer มองเห็น/เป็นเจ้าของ) และ `GET /api/workspaces` (รายการ Workspace ที่ viewer มองเห็น) หรือถ้าตั้งใจให้ใช้ endpoint อื่นที่มีอยู่แล้ว (เช่น `/api/scope` หรือ endpoint ภายใต้ `/api/business/*`) ให้แก้ทั้ง 4 คอมโพเนนต์ให้เรียก endpoint ที่มีจริงแทน; รวม fix นี้เข้ากับ D3-pm-plan-intake-01 เพราะ business/workspace selector เป็นส่วนหนึ่งของ flow เดียวกัน |
| เกี่ยวข้อง | D3-pm-plan-intake-01, D3-pm-plan-intake-02, D3-pm-plan-intake-04 |
| การตรวจสอบ | critic-added |

#### ข้อจำกัดการตรวจ

Finder scope: Unit pm-plan-intake; ไฟล์เปิดอ้างถึงด้วยหมายเลขบรรทัด; evidence lines อ่านจริง; ไม่เปิดแบบเต็ม: prisma/schema.prisma, xlsx-template.js, external-ref.js, business-strategy-mutation-service.js (reference via call sites), plan-schema.js semantic validation (confirm validatePlanSemantics called); test files ยืนยันมีอยู่ (ls) ไม่เปิด line-by-line; 6 of 7 surfaces traced end-to-end complete; no test file references StandaloneTaskModal/UploadPlanModal/api/import/plan (grep = zero); ไม่ run npm test/build per read-only; 2 findings genuine BR-009-adjacent boundary violations.

Verifier unit: pm-plan-intake, dimension D3. Both findings verified by direct file inspection; CONFIRMED as stated; additionally verified both modals hardcode dryRun:false with zero preview attempt (reinforces CRITICAL severity).

**critic pass (เพิ่มเติมภายหลัง)** — ขยาย grep ไปหา `useFetch('/api/` ทั่ว `src/modules/project-manager/{components,views}` แล้วยืนยันการมีอยู่ของแต่ละ route ด้วย `find src/app/api`; พบ dead fetch target เพิ่มอีก 4 จุด (`/api/businesses` × 3, `/api/workspaces` × 2) นอกเหนือจาก `/api/import/plan` เดิม เพิ่ม finding ใหม่ 1 รายการ (05, MEDIUM) และขยายหลักฐานของ finding 01/02/04.

## line-agent-crm-flow

#### สรุปย่อ

- LINE webhook ingest pipeline ✅ สมบูรณ์ (validation, binding auth, identity resolve, CRM write, agent turn execution)
- CRM read surfaces ✅ (inbox/thread/dashboard page เชื่อมต่อและทำงาน)
- Consent & PDPA erasure library ✅ code ใช้งานได้ แต่ 🔴 ไม่มี route/UI/trigger เพื่อให้ผู้ใช้หรือ admin เรียกได้
- Message content erasure 🔴 missing — erasePrincipal redacts display name เท่านั้น ข้อความในอดีตเก็บไว้ตลอด
- ConversationAnalysis 🟠 persistence ✅ producer/route/UI ⏳ deferred ต่อ phase ถัดไป
- Market-intelligence raw-record translation ✅ code มี 🔴 ไม่มี route/job ที่เรียก — RawExternalRecord rows ถูกบันทึกแต่ไม่เคยอ่าน
- Edge heartbeat route 🔴 unauthenticated stub (no persistence, no audit, no tenant scope) + FR misattribution — live BOUNDARY_VIOLATION

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|--------|---------|----------|
| POST /api/agent/line-webhook — boundary validation (Zod zBody/zLineEvent) | IMPLEMENTED | src/app/api/agent/line-webhook/route.js:33-49,78 | Zod schemas enforce shape |
| POST /api/agent/line-webhook — production scope authorization (server-owned binding only) | IMPLEMENTED | src/modules/agent/phase1-runtime.js:285-302; tests/integration/line-webhook-unbound-production.test.js | CLIENT tenantId/businessId rejected |
| LINE binding resolver (bearer HMAC compare) | IMPLEMENTED | src/modules/agent/line-binding-resolver.js:27-67 | zuri_core.line_channel_binding lookup |
| LINE X-Line-Signature HMAC verification | DECLARED_ONLY | src/platform/integrations/providers/line/line-oa-webhook.js:86-93,208-235 | Not called by route.js; only tests |
| LINE raw evidence recording (FR-081 RawExternalRecord) | IMPLEMENTED | src/platform/integrations/providers/line/line-oa-evidence.js:40-87 | Reuses normalizeLineWebhookEvent |
| CRM ingest (Person/Customer/Conversation/Message) | IMPLEMENTED | src/modules/crm/line-ingest-service.js:38-121 | Transaction + audit |
| LINE identity resolution (ChannelIdentity sync) | IMPLEMENTED | src/modules/identity/resolve-line-identity.js:39-171 | Audit on first contact |
| Agent turn orchestration | IMPLEMENTED | src/modules/agent/turn.js:33-131 | Context → action or answer |
| Gate F action gate + registry | IMPLEMENTED | src/modules/agent/write-tools.js:23-131; action-gate.js:75-128 | Authorize + step-up + audit |
| MSP memory port | OUTSIDE_REPO | src/modules/agent/msp-memory-port.js:1-40 | ADR-022; MSP lives outside |
| POST /api/agent/line-delivery (reply receipt) | IMPLEMENTED | src/app/api/agent/line-delivery/route.js:1-131 | Same scope seam as webhook |
| recordLineReply (outbound message write) | IMPLEMENTED | src/modules/crm/reply-record-service.js:68-130 | Tenant-scoped via inbound lookup |
| zuri-cli canary receipt adapter (FR-055) | IMPLEMENTED | src/modules/agent/zuri-cli-canary-receipt.js:56-90 | Offline tooling only |
| GET /api/crm/conversations (inbox list) | IMPLEMENTED | src/app/api/crm/conversations/route.js:1-25 | Tenant/business scoped |
| GET /api/crm/conversations/[id] (thread reader) | IMPLEMENTED | src/app/api/crm/conversations/[id]/route.js:1-24 | Thread detail |
| /customer/conversations page (inbox UI) | IMPLEMENTED | src/app/(pm)/customer/conversations/page.jsx:65-96 | Consent action |
| /customer dashboard (KPIs + recent) | IMPLEMENTED | src/app/(pm)/customer/page.jsx:24-103 | Fed by GET /api/crm/conversations |
| ConversationAnalysis persistence | IMPLEMENTED | src/modules/crm/conversation-analysis-service.js:154-193 | Consent-gated, owner-scoped |
| ConversationAnalysis read model | IMPLEMENTED | src/modules/crm/conversation-analysis-service.js:200-221 | getConversationAnalyses |
| ConversationAnalysis route/UI | MISSING | no src/app match | Out of scope FR-127 increment |
| ConversationAnalysis producer (LLM/worker) | MISSING | only test callers | Out of scope FR-127 increment |
| Customer consent attestation (FR-103) | IMPLEMENTED | src/modules/crm/customer-consent-service.js:62-118; src/app/api/crm/customers/[customerId]/consent/route.js | Service + route + UI |
| PDPA erasure (FR-022 erasePrincipal) | IMPLEMENTED | src/modules/identity/erase-principal.js:25-90 | Revoke + redact identity |
| PDPA erasure trigger (route/UI/script) | MISSING | grep for erasePrincipal in src/app, scripts/ → zero | Only test callers |
| RawExternalRecord → market-intelligence translation | DECLARED_ONLY | src/modules/market-intelligence/application/translate-raw-record.js:120-197 | Zero route/job callers |
| RawExternalRecord → connector health freshness | IMPLEMENTED | src/modules/integration/application/integration-management-service.js:110-123 | Platform Integrations UI |
| POST/DELETE/GET /api/agent/heartbeat | PARTIAL | src/app/api/agent/heartbeat/route.js:24-114 | In-memory Map, no auth, no audit |
| zuri_core.line_channel_binding (Postgres table) | GATED_PRODUCTION | supabase/migrations/20260813213654_production_tenant_bootstrap.sql:90-306 | RLS/roles; raw SQL only |
| Activation gates FR-052..055 | GATED_PRODUCTION | docs/PRD-SDD-v1.0.md:262-265 | Local/beta ✅; production canary NOT_RUN |
| CRM Prisma parity (SQLite/Postgres) | IMPLEMENTED | prisma/schema.prisma and .postgres.prisma | All five models in both |
| Integration test coverage (LINE/agent/CRM) | IMPLEMENTED | tests/integration/{24 files enumerated} | Comprehensive chain tests |

#### Findings

##### D3-line-agent-crm-flow-05 — /api/agent/heartbeat is an unauthenticated, unpersisted, untested stub misattributed to FR-080

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | CRITICAL |
| ประเภท | BOUNDARY_VIOLATION (live security hole, not just DOC_DRIFT) |
| หลักฐาน | src/app/api/agent/heartbeat/route.js:6 (@req FR-080 which is actually Platform Integrations UI, not device heartbeat) · route.js:8 (@tested cites tests/unit/fr080-ui-contract.test.js; that file contains zero 'heartbeat' references) · route.js:24 (globalForDevices.__zuriEdgeDevices is process-local Map; no Prisma model, lost on restart) · route.js:58-84 (POST never resolves a viewer at all — no call to resolveRequestViewer anywhere in this handler — and writes the Map unconditionally) · route.js:69-78 (a failed zBody.safeParse silently falls back to raw, unvalidated body fields and a hardcoded default deviceId 'DEV-SMARTGIFT-PRIMARY') · route.js:33-39 (this swallow-and-fallback pattern is actually in GET: a failed resolveRequestViewer is caught and reported back to the caller as viewerId 'anonymous', not blocked) · route.js:96-104 (DELETE with no deviceId parameter can wipe entire global registry in one unauthenticated call — `edgeDevices.clear()`) · **ผู้บริโภคจริงของ route นี้ (critic-added)**: `src/app/(pm)/platform/integrations/page.jsx:143` — `useFetch('/api/agent/heartbeat', ...)` ดึงสถานะมาแสดงบนคอนโซล operator จริง; `:193-208` — `deleteEdgeDevice`: `confirm()` แล้วยิง `fetch('/api/agent/heartbeat' + (deviceId ? '?deviceId=...' : ''), { method: 'DELETE' })` — เมื่อ operator กด "ลบทั้งหมด" จะไม่ส่ง `deviceId` เลย ตรงกับ path ที่ `edgeDevices.clear()`; `:712-714` — `isOnline`/`device`/`isPaired` คำนวณจาก `heartbeat.data` โดยตรง แล้วใช้ตัดสินสีของการ์ดสถานะ "Edge Runtime online/paired" |
| สิ่งที่ควรเป็น | ตามข้อบังคับ CLAUDE.md: ทุกการเขียนต้องผ่าน application service ที่บันทึก audit event · route ที่ implement FR ต้องมีการอ้าง @req/@tested ที่ถูกต้อง · ต้องมี tenant-scoped authorization · ต้องมีการบังคับ Zod boundary validation |
| สิ่งที่เป็นจริง | POST/DELETE เขียนลง global in-memory Map โดยไม่มีการยืนยันตัวตนเลย (ไม่มีการ persist ลง DB, ไม่มี tenant isolation, ไม่มี audit event, ไม่ผ่าน application service ใด ๆ) การอ้าง @req/@tested ชี้ไปยัง FR/test file ที่ไม่เกี่ยวข้องกันเลย DELETE ที่ไม่มีการยืนยันตัวตนสามารถล้าง registry ทั้งหมดของทุก tenant ได้ในคำขอเดียว **และผลกระทบไม่ได้จำกัดอยู่แค่ route เท่านั้น** — route นี้ถูกผูกเข้ากับ UI คอนโซลจริงที่ /platform/integrations แล้ว: POST ที่ไม่มีการยืนยันตัวตนจากใครก็ได้ สามารถทำให้การ์ดสถานะ "Edge Runtime online/paired" ในคอนโซลของ operator แสดงว่า device ใด ๆ ก็ตาม paired และ healthy ทั้งที่ไม่จริง และ DELETE ที่ไม่มีการยืนยันตัวตนก็สามารถล้างการ์ดสถานะนี้ให้ว่างเปล่าสำหรับทุก tenant ได้เช่นกัน — เปลี่ยนระดับความเสี่ยงจาก "มี stub route อยู่" เป็น "หน้าจอที่ operator ใช้ตัดสินใจ สามารถถูกปลอมแปลงได้จริง" |
| ข้อเสนอแนะ | ประกาศ FR จริงสำหรับ edge-device heartbeat พร้อม Zod validation, tenant scoping, Prisma model, authorization บน POST/DELETE และ audit event ที่ถูกต้อง แล้วจึงแก้การอ้าง @req/@tested ให้ตรง หรือลบ route นี้ทิ้งถ้าเป็นแค่ prototype ที่หลงเหลืออยู่ ตามที่เป็นอยู่ตอนนี้ ถือเป็นช่องโหว่ความปลอดภัยที่ใช้งานได้จริง ละเมิดข้อบังคับเรื่อง audit-on-write ของ CLAUDE.md |
| เกี่ยวข้อง | D3-line-agent-crm-flow-09 |
| การตรวจสอบ | ADJUSTED (verifier escalated from HIGH to CRITICAL; verified all facts; noted preflight Check 3 only checks cited FR id exists, not that route behavior matches FR statement, so misattribution passes governance undetected); ขยายเพิ่มโดย critic เพื่อยืนยันว่าผลกระทบไปถึง UI operator จริง ไม่ใช่แค่ route ที่ไม่มีใครเรียก |

##### D3-line-agent-crm-flow-03 — PDPA erasure exists only as an internal function; no route, UI, or script triggers it

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | HIGH |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/modules/identity/erase-principal.js:25 (erasePrincipal({tenantId, personId, reason}) — full transactional revoke+redact) · src/modules/identity/gate.js:32 (only re-exports erasePrincipal; zero src/ callers outside gate.js itself) · docs/PRD-SDD-v1.0.md:232 (FR-022 marked ✅ complete) · docs/domains/agent/ethics-governance.md:28 ('Right to erasure' listed #6 open, even though underlying function is ✅) |
| สิ่งที่ควรเป็น | สถานะ FR-022 ✅ หมายถึงความสามารถ PDPA erase-revoke ต้องใช้งานได้จริงในผลิตภัณฑ์โดย business owner หรือ admin |
| สิ่งที่เป็นจริง | grep หา erasePrincipal/erase-principal/identity gate ทั่ว src/app และ scripts/ → ไม่พบเลยนอกจาก test suite ไม่มี business owner, customer หรือ admin คนใดสามารถเรียกใช้ erasure ได้; ผู้เรียกมีเพียง tests/integration/identity-erase.test.js และ crm-conversation-analysis.test.js เท่านั้น ฟังก์ชันมีอยู่จริงและทำงานถูกต้อง แต่ไม่มีใครเข้าถึงได้ในระบบที่รันจริง |
| ข้อเสนอแนะ | เพิ่ม admin-facing route (เช่น ภายใต้ /platform หรือ /customer) หรือ operator script ที่เรียก erasePrincipal โดยมี authority gate ที่เหมาะสม ก่อนที่จะถือว่า FR-022 เป็นความสามารถ PDPA ที่สมบูรณ์ อย่างน้อยที่สุดควรปรับสถานะ FR-022 หรือ ethics-governance.md ข้อ #6 ให้สะท้อนว่ากลไกมีอยู่จริงแต่ไม่มีจุดเรียกใช้ |
| เกี่ยวข้อง | D3-line-agent-crm-flow-08 |
| การตรวจสอบ | CONFIRMED (ยืนยันด้วย grep และการอ่านไฟล์ตรงกับที่อ้างอิงทุกจุด) |

##### D3-line-agent-crm-flow-08 — PDPA erasure never touches Message.body or RawExternalRecord payloads, so the actual conversation text of an erased person survives intact

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | HIGH |
| ประเภท | PARTIAL (incomplete implementation) |
| หลักฐาน | src/modules/identity/erase-principal.js:25 (revokes ExternalIdentity/ChannelIdentity/Session, invalidates link tokens, deletes ConversationAnalysis, redacts Customer.displayName/Person.displayName+email — but never references tx.message or tx.rawExternalRecord) · prisma/schema.prisma:1268 (Message.body stores raw conversation text; only cascade-deleted if parent Conversation deleted — erasePrincipal never deletes or redacts Conversation/Message rows) · prisma/schema.prisma:1621 (RawExternalRecord never referenced by erase-principal.js) · docs/domains/agent/ethics-governance.md:28 (Item #6 'Right to erasure: purge derived AI artefacts' marked open) |
| สิ่งที่ควรเป็น | FR-022 ✅ + ADR-054 D6 ระบุว่าข้อมูลส่วนบุคคลที่ derived ต้องถูกล้างไปพร้อมกับการ erasure ซึ่งโดยนัยแล้วควรครอบคลุมเนื้อหาข้อความต้นทางที่มันถูก derive มาด้วย |
| สิ่งที่เป็นจริง | หลัง erasePrincipal ทำงาน: Customer ถูก soft-delete+redact, ChannelIdentity/ExternalIdentity ถูก revoke (บล็อกการเชื่อมต่อในอนาคต), ConversationAnalysis ถูกลบ — **แต่** ทุกแถว Conversation และ Message ในอดีต (Message.body ซึ่งเป็นบทสนทนาจริง) และทุก RawExternalRecord (payload ของ LINE webhook) ที่ผูกกับบุคคลนั้นยังคงอ่านได้ครบผ่าน conversation-read-model และ inbox UI คำขอ PDPA erasure ของเจ้าของข้อมูลจึงไม่ได้รับการตอบสนองจริง — เนื้อหาข้อความยังอยู่ครบ เพียงแค่แยกออกจากชื่อที่แสดงเท่านั้น |
| ข้อเสนอแนะ | ขยาย transaction ของ erasePrincipal ให้ redact/ลบ Message.body และ payload ของ RawExternalRecord ที่เชื่อมโยงกับบทสนทนาของบุคคลที่ถูกลบ หรือไม่ก็ระบุขอบเขต FR-022 อย่างชัดเจนว่า 'ครอบคลุมเฉพาะ identity + derived analysis เท่านั้น ข้อความสนทนายังคงถูกเก็บไว้' เพื่อไม่ให้สถานะ ✅ สื่อเกินจริงว่า erasure ทำอะไรได้บ้าง ร้ายแรงกว่า finding 03 (ไม่มีจุดเรียกใช้) เพราะแม้จะเรียกฟังก์ชันโดยตรงได้ในวันนี้ก็ยังไม่ได้ erasure ที่สมบูรณ์อยู่ดี |
| เกี่ยวข้อง | D3-line-agent-crm-flow-03 |
| การตรวจสอบ | verifier-added (finding ใหม่ที่ไม่มีในรายงานของ finder เดิม) |

##### D3-line-agent-crm-flow-02 — ConversationAnalysis has a fully-audited write+read service but no route, UI, and no producer anywhere in the app

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/modules/crm/conversation-analysis-service.js:154 (recordConversationAnalysis: transactional, consent-gated, owner-scoped, audited write path) · src/modules/crm/conversation-analysis-service.js:200 (getConversationAnalyses: complete authorized read path) · docs/domains/crm/features/FR-127-conversation-intelligence-analysis.md:43,58 (doc self-declares no route/UI/producer in this increment) |
| สิ่งที่ควรเป็น | ตาม roadmap ของ feature note เองที่จงใจแบ่งเป็นเฟส: persistence/read contract ก่อน worker+route+UI ทีหลัง สถานะงานระบุ FR-127 เป็น 🟠 'persistence only, no producer/UI' |
| สิ่งที่เป็นจริง | ไม่มีผู้เรียก recordConversationAnalysis/getConversationAnalyses เลยนอกจาก tests/integration/crm-conversation-analysis.test.js หน้า Conversation UI (src/app/(pm)/customer/conversations/page.jsx) ไม่แสดงฟิลด์ analysis ใด ๆ ตาราง Prisma มีอยู่ทั้งสอง schema แต่ไม่มีอะไรป้อนเข้า ไม่มีอะไรอ่านออกในระบบที่รันจริง |
| ข้อเสนอแนะ | ยังไม่จำเป็นต้องแก้เร่งด่วน — ตรงกับแผนแบ่งเฟสที่บันทึกไว้แล้ว ก่อนที่ FR-128 (Daily Sales Brief) จะต่อยอดบนสิ่งนี้ เจ้าของ feature ต้องตัดสินใจว่าใครเป็นผู้ผลิต analysis (LINE turn hook, batch job หรือ manual staff entry) แล้วเพิ่ม route/UI ตามที่เอกสารระบุว่าจะเลื่อนมา |
| เกี่ยวข้อง | (none) |
| การตรวจสอบ | CONFIRMED (grep ยืนยันไม่มีผู้เรียกนอกจาก test; อ้างอิง PRD/feature note ตรงตามจริง) |

##### D3-line-agent-crm-flow-04 — The generic RawExternalRecord-to-MarketObservation translator (which would consume LINE evidence) is itself unwired to any route or job

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | src/modules/market-intelligence/application/translate-raw-record.js:120 (translateRawRecordToMarketObservation: provider-neutral translator for any RawExternalRecord, LINE_OA included) · src/modules/market-intelligence/application/market-observation-service.js:44 (extractCandidate is injected port; grep across src/app+src/modules → zero callers) · src/modules/integration/application/integration-management-service.js:110 (only actual RawExternalRecord consumer: lastEventByConnection reads receivedAt timestamp only for Platform Integrations health, never payload) |
| สิ่งที่ควรเป็น | ตามที่ระบุขอบเขตงาน market-intelligence ถูกวางไว้ให้เป็นผู้บริโภคของ LINE's RawExternalRecord translation pipeline |
| สิ่งที่เป็นจริง | แม้แต่ translator ของ market-intelligence เองก็ไม่มีผู้เรียกเลยภายใต้ src/app/api — ไม่มี route หรือ scheduled job ใดเรียก translateRawRecordToMarketObservation สำหรับ provider ใดเลย แถว RawExternalRecord ของ LINE ถูกเขียนทุกครั้งที่มี inbound event (FR-081) แต่เนื้อหา payload ไม่เคยถูกอ่านโดยอะไรเลยในระบบที่รันจริง — มีเพียง timestamp receivedAt ที่ถูกอ่านไปใช้เป็นตัวชี้วัด health เท่านั้น |
| ข้อเสนอแนะ | นี่เป็นช่องว่างการต่อสายภายในโดเมน market-intelligence โดยตรง (ต้องมี scheduler หรือ route ที่ดึง RawExternalRecord ที่ยังไม่ resolve แล้วเรียก translator) — ส่งต่อให้เจ้าของโดเมน market-intelligence ในฝั่ง CRM/agent ไม่จำเป็นต้องแก้อะไร เพราะ read path ของ CRM เอง (Conversation/Message) มีเนื้อหาทางธุรกิจอยู่แล้วโดยไม่ต้องพึ่ง raw evidence |
| เกี่ยวข้อง | (none) |
| การตรวจสอบ | CONFIRMED (ขยาย grep ไปถึง scripts/ และทั้ง src/ ไม่ใช่แค่ src/app — ได้ผลลัพธ์ zero-callers เหมือนเดิม) |

##### D3-line-agent-crm-flow-09 — The unauthenticated heartbeat stub is not listed in docs/.route-anchor-baseline.json, meaning the FR-annotation-required preflight check passes on a fabricated citation

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | PRODUCTION_GATE_OPEN (tooling gap) |
| หลักฐาน | docs/.route-anchor-baseline.json:1 (grep for 'heartbeat' → no match; route neither in 46-route accepted-debt baseline nor failing preflight) · src/app/api/agent/heartbeat/route.js:6 (@req FR-080 annotation syntactically well-formed and cites id that exists in PRD registry, so Check 3 has nothing to flag) |
| สิ่งที่ควรเป็น | CLAUDE.md: "a route implementing no declared requirement is preflight CRITICAL" — annotation gate ควรตรวจสอบเชิงเนื้อหาว่า route ทำตาม FR ที่มันอ้างจริงหรือไม่ |
| สิ่งที่เป็นจริง | เครื่องมือ preflight ตรวจสอบเพียงว่า id ที่อ้างมีอยู่ใน registry เท่านั้น ไม่ได้ตรวจว่าพฤติกรรมจริงของ route ตรงกับสิ่งที่ id นั้นระบุหรือไม่ — จึงทำให้ @req ที่ระบุผิด (finding 05) ผ่าน governance ไปได้อย่างเงียบ ๆ ช่องว่างของเครื่องมือนี้ทำให้ข้อบกพร่องจริงของ heartbeat route (ไม่มี auth, ไม่ persist, ไม่มี audit) ไม่ถูก automated check ใดจับได้เลย ช่องว่างประเภทเดียวกันนี้ยังพบซ้ำในโดเมน integration ด้วย — ดู D3-integration-knowledge-document-intake-20 ซึ่งเป็นตัวอย่างที่ตรงข้ามกัน: guard ตัวหนึ่ง (`.viewer-fixture-baseline.json`) ที่มี regex เฉพาะเจาะจงเกินไปจนหลบเลี่ยงได้ทั้งไฟล์ ไม่ใช่แค่หลบเลี่ยงทีละจุด |
| ข้อเสนอแนะ | นี่เป็นข้อสังเกตเชิงกระบวนการ/เครื่องมือ (ไม่ใช่การแก้ heartbeat route เอง ซึ่งอยู่ใน finding 05) — แจ้งเจ้าของ `scripts/doc-preflight.mjs`'s `@req`-anchor check (Check 3 ซึ่งตรวจสอบเพียงว่า `@req` id มีอยู่ใน registry): พิจารณา heuristic ที่ละเอียดขึ้น (เช่น กำหนดให้คีย์เวิร์ดของ FR ที่ annotate ต้องปรากฏใกล้ route หรือให้ตรวจด้วยมือสำหรับ route ที่ไฟล์ `@tested` ไม่ได้กล่าวถึงชื่อ route เลย) เพื่อจับ drift ประเภทนี้ได้เร็วขึ้น |
| เกี่ยวข้อง | D3-line-agent-crm-flow-05, D3-integration-knowledge-document-intake-20 |
| การตรวจสอบ | verifier-added (finding ใหม่ที่ไม่มีในรายงานของ finder เดิม) |

##### D3-line-agent-crm-flow-01 — The live webhook route never checks LINE's X-Line-Signature; the code that does is unreachable (dead code, not a live hole)

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | LOW |
| ประเภท | BOUNDARY_VIOLATION (reclassified as hygiene) |
| หลักฐาน | src/app/api/agent/line-webhook/route.js:114 (createLineOaEvidenceRecorder is only thing besides bearer/HMAC binding check; never touches x-line-signature) · src/platform/integrations/providers/line/line-oa-evidence.js:76 (record() calls normalizeLineWebhookEvent, not signature-verifying readVerifiedBody path) · src/platform/integrations/providers/line/line-oa-webhook.js:208 (verifySignature/parseWebhook/ingestWebhook exist but grep → zero callers outside that file's own definition) · docs/decisions/ADR-007-LINE-AI-STACK-SEQUENCING.md:64 ('zuri-cli owns LINE signature verification' — confirms design intent) |
| สิ่งที่ควรเป็น | ตาม ADR-007/020/022/031 zuri-cli (นอก repo นี้) เป็นเจ้าของ LINE signature/Reply API; zuri-ai ยืนยันตัวตน batch ที่ถูกส่งต่อมาผ่าน server-owned binding (bindingId + destination + bearer HMAC) การแบ่งแยกนี้เป็น boundary ที่ถูกต้องตามการออกแบบ |
| สิ่งที่เป็นจริง | Repo มี HMAC-SHA256 X-Line-Signature verifier ที่สมบูรณ์ (createLineOaWebhookConnector) แต่ไม่เคยถูกเชื่อมเข้ากับ /api/agent/line-webhook หรือ route ใดเลย — ถูกใช้งานเพียงใน tests/unit/platform/line-oa-webhook.test.js และ persistence test หนึ่งไฟล์เท่านั้น อย่างไรก็ตาม resolvePhase1RequestScope (src/modules/agent/phase1-runtime.js:285) และ line-binding-resolver.js มี fail-closed bearer-hash authentication check ที่ใช้งานจริงอยู่แล้วใน production ดังนั้นการระบุว่า 'ไม่มี fallback signature check' จึงประเมินความเสี่ยงปัจจุบันสูงเกินจริง |
| ข้อเสนอแนะ | ลบหรือย้าย connector ที่ไม่ได้ใช้งานนี้ทิ้งในฐานะ dead code (ซ้ำซ้อนกับ boundary ที่ ADR-007 มอบหมายให้ zuri-cli) หรือระบุเหตุผลไว้ชัดเจนใน phase1-runtime.js/feature note ของ FR-052 ว่าเหตุใดจึงมีอยู่โดยไม่ถูกใช้ เพื่อไม่ให้ผู้ดูแลในอนาคตเข้าใจผิดว่ามันปกป้อง route ที่ใช้งานจริงอยู่ นี่เป็นเรื่อง hygiene/dead-code ไม่ใช่ boundary ที่ยังเปิดอยู่ |
| เกี่ยวข้อง | (none) |
| การตรวจสอบ | ADJUSTED (verifier ปรับลดจาก MEDIUM เป็น LOW หลังยืนยันว่า resolvePhase1RequestScope + line-binding-resolver มี fail-closed bearer-hash auth ใน production อยู่แล้วจริง; HMAC connector ที่ตายแล้วเป็น dead code ที่ควรทำความสะอาด แต่ไม่ใช่ช่องโหว่ที่เปิดอยู่จริง) |

##### D3-line-agent-crm-flow-06 — The production binding table and its RLS/role isolation are only exercised by an opt-in Postgres test, never in the default test run

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | INFO |
| ประเภท | PRODUCTION_GATE_OPEN (documented) |
| หลักฐาน | supabase/migrations/20260813213654_production_tenant_bootstrap.sql:90 (zuri_core.line_channel_binding table + RLS created only in Postgres migration; no Prisma model equivalent in .prisma files) · tests/integration/line-binding-activation.postgres.test.js:25 (runPostgres = target.enabled ? describe : describe.skip — entire suite skipped unless ZURI_FR055_TEST_POSTGRES_URL set) · docs/PRD-SDD-v1.0.md:262 (FR-052 status: 'Binding reserved remotely as PENDING; live role isolation passes, activation destination/canary gates remain') |
| สิ่งที่ควรเป็น | สถานะนี้ถูกประกาศไว้ถูกต้องอยู่แล้วว่าเป็น production-only gate (FR-052/053/054/055 NOT_RUN สำหรับการประเมิน real-provider/canary) |
| สิ่งที่เป็นจริง | ตาราง binding เป็น raw-SQL-only (จงใจให้อยู่นอก Prisma ตาม ADR-018/044/045 เพื่อ role-based access control); มีเพียง integration test เดียวที่ต้องการ Postgres 17 จริงผ่าน env var — `npm test` (SQLite) ไม่แตะ path นี้เลย |
| ข้อเสนอแนะ | ไม่ต้องดำเนินการเพิ่มเติม — บันทึกไว้เพื่อยืนยันว่า coverage ของ repo ตรงกับสถานะ gate ที่บันทึกไว้แล้ว เพื่อการตรวจสอบย้อนหลัง |
| เกี่ยวข้อง | (none) |
| การตรวจสอบ | CONFIRMED (ยืนยันครบทั้ง binding table, RLS, Postgres-only test และสถานะ gate ใน PRD) |

##### D3-line-agent-crm-flow-07 — Confirmed complete: LINE ingest, identity resolution, agent turn, reply recording, conversation inbox/thread reads, consent write, and customer Dashboard are each validated, authorized, transactional, and audited

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | INFO |
| ประเภท | PARTIAL (positive verification) |
| หลักฐาน | src/modules/crm/line-ingest-service.js:38 (ingestLineMessage: Zod validate → identity resolve → idempotency check → transaction → recordAudit) · src/modules/identity/resolve-line-identity.js:39 (tenant guard, revoked-binding refusal, transactional Person+ExternalIdentity+ChannelIdentity create + audit) · src/modules/crm/reply-record-service.js:68 (recordLineReply: tenant-scoped lookup by inbound message id, idempotent, transaction + audit) · src/modules/crm/conversation-read-model.js:75 (resolveScope: seesBusiness auth + tenant WHERE in query itself, not filtered after fetch) · src/modules/crm/customer-consent-service.js:62 (recordCustomerConsent: ownsBusiness auth, tenant-scoped lookup, transaction + audit) · src/app/(pm)/customer/page.jsx:27 (Dashboard fetches same GET /api/crm/conversations as Inbox — confirmed fed) |
| สิ่งที่ควรเป็น | BR-009/SDD-009: ทุก intake surface ต้องบรรจบที่ validate → semantic check → transaction → audit; progress/read surface ต้องไม่กลายเป็นแหล่งความจริงที่สอง |
| สิ่งที่เป็นจริง | ยืนยันว่าเป็นจริงสำหรับส่วนนี้ด้วยการอ่านโค้ดโดยตรง ไม่พบการข้าม mandated path ใด ๆ |
| ข้อเสนอแนะ | ไม่มี — บันทึกไว้เป็นการยืนยันเชิงบวก เพื่อไม่ให้ส่วนนี้ถูกตั้งคำถามซ้ำว่ายังไม่ได้ตรวจสอบในรอบถัดไป |
| เกี่ยวข้อง | (none) |
| การตรวจสอบ | CONFIRMED (สุ่มตรวจแต่ละ service และ UI fetch แล้วตรงกับที่ finder อธิบายไว้ทุกจุด) |

#### ข้อจำกัดการตรวจ

**Finder coverage** — อ่านเต็มทั้ง src/app/api/agent/{line-webhook,line-delivery,heartbeat}/route.js; src/platform/integrations/providers/line/{line-oa-webhook,line-oa-evidence}.js; src/modules/crm/{line-ingest-service,reply-record-service,conversation-read-model,conversation-analysis-service,customer-consent-service}.js; src/modules/identity/{resolve-line-identity,erase-principal,gate}.js; src/modules/agent/{turn,phase1-runtime,line-binding-resolver,write-tools,zuri-cli-canary-receipt}.js (action-gate.js, msp-memory-port.js ส่วนที่เกี่ยวข้อง not full line-by-line); src/app/(pm)/customer/{page.jsx,conversations/page.jsx}; src/app/api/crm/conversations/{route.js,[id]/route.js}; src/app/api/crm/customers/[customerId]/consent/route.js; src/modules/market-intelligence/application/translate-raw-record.js (~145 of 181 lines); src/modules/integration/application/integration-management-service.js (excerpt); src/platform/integrations/core/connector-catalog.js (partial). Prisma models verified in both schema files; full column lists not diffed beyond model presence.

**Grep scanning** — createLineOaWebhookConnector, verifySignature, ingestWebhook, recordConversationAnalysis/getConversationAnalyses, erasePrincipal, translateRawRecordToMarketObservation/market-observation-service, RawExternalRecord callers across src/app and src/modules; plus extended grep to scripts/ for finding 04 (same zero-callers result).

**Test verification** — did not run tests (read-only); existence confirmed via file presence; content verified (e.g., fr080-ui-contract.test.js ไม่มี "heartbeat", FR-055 Postgres suite describe.skip) via targeted grep only.

**Verifier re-check** — all 7 finder findings + all cited evidence re-verified independently (finding 01 downgraded to LOW after confirming resolvePhase1RequestScope + line-binding-resolver provide fail-closed auth; finding 05 escalated to CRITICAL and reclassified from DOC_DRIFT to live BOUNDARY_VIOLATION; findings 02, 03, 04, 06, 07 confirmed; 2 new findings added: 08 incomplete PDPA erasure, 09 preflight tooling gap). No findings REFUTED.

**critic pass (เพิ่มเติมภายหลัง)** — อ่าน `src/app/(pm)/platform/integrations/page.jsx` เพิ่มเติม (ไฟล์นี้ไม่อยู่ในขอบเขตที่ finder/verifier รอบแรกเปิดอ่าน) พบว่า `/api/agent/heartbeat` ถูกใช้เป็นแหล่งข้อมูลของการ์ดสถานะ "Edge Runtime online/paired" และปุ่มลบ device จริงบนคอนโซล operator — ขยายหลักฐานของ finding 05 ให้ครอบคลุมผลกระทบต่อ UI จริง ไม่ใช่แค่ตัว route.

## identity-onboarding-forms

#### สรุปย่อ

- การไหลของข้อมูล sign-up, login, password reset และ onboarding profile สร้างครบวงจรอย่างสมบูรณ์ (validation + audit + UI chain ครบถ้วน)
- ข้อมูลใหม่ประวัติส่วนตัว (firstName/lastName/phone/email) ที่รวบรวมในระหว่าง onboarding ไม่มี UI ให้แก้ไขหรือดูได้หลังจากเสร็จสิ้น — gap ระดับ HIGH
- **ช่องว่างระดับวิกฤต**: ไม่มี UI path ใด ๆ ที่จะให้ Business owner เพิ่ม staff ใหม่เข้า Business ที่มีอยู่ (ทุกเส้นทาง require Membership ที่มีอยู่แล้ว หรือ self-serve Business creation เท่านั้น)
- Workspace invite mint/revoke/remove APIs ถูกสร้าง แต่ไม่มี UI ใดก็ตามในแอปพลิเคชัน — ผู้ใช้ไม่มีทางเชิญหรือ revoke workspace invite
- Plugin auth writes (5 call sites: install, auth-code mint, replay revoke, session create, token revoke) ไม่มี recordAudit เลย — แตกต่างจากแนวทางใน identity domain อื่น ๆ
- API key, RoleBinding, password-reset mint, PDPA erasure, plugin reaper ถูกสร้างที่ service layer แต่ไม่มี route/UI ให้เรียกใช้งานจริง
- Membership.status SUSPENDED state มี enforcement ทั้งหมดแต่ไม่มี admin actuator ถูกสร้าง (tracked as Issue #99 in PRD)
- Schema parity dev vs prod ครบถ้วน ไม่มี drift ใดๆ

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|-------|--------|---------|
| Signup — UI + POST /api/auth/signup + signup-service | IMPLEMENTED | src/app/signup/page.jsx:1-115; src/app/api/auth/signup/route.js:1-115; src/modules/identity/signup-service.js:58-118 | Chain ครบ: client validation → rate limit → server validation → transactional create (Person+PersonCredential) → recordAudit ACCOUNT_SELF_CREATED → auto-login → session cookie |
| Signup rate limiting | PARTIAL | src/modules/identity/signup-rate-limit.js:1-48 | In-process Map, resets per instance, keyed on spoofable x-forwarded-for — documented as speed bump only |
| Person.email uniqueness | PARTIAL | prisma/schema.prisma:158; src/modules/identity/signup-service.js:84-92 | Race window open on Postgres (READ COMMITTED); closed only incidentally by SQLite write serialization |
| Login — UI + POST /api/auth/login + auth-service.authenticateUser | IMPLEMENTED | src/app/login/page.jsx:1-50; src/app/api/auth/login/route.js:1-77; src/modules/identity/auth-service.js:189-234 | Session mint via generateSessionToken + HttpOnly signed cookie; no audit on login itself (consistent with repo pattern) |
| Login rate limiting / brute-force throttle | MISSING | src/app/api/auth/login/route.js:38-77 | No rate limiter, no middleware.js exists in repo |
| Password reset — mint (owner/operator) POST /api/platform/users/password-resets | IMPLEMENTED (API-only) | src/app/api/platform/users/password-resets/route.js:1-19; src/modules/identity/auth-service.js:279-314 | Fully authorized, audited AUDIT_EVENT PASSWORD_RESET_MINTED; no UI surface to trigger mint |
| Password reset — consume POST /api/auth/reset-password | IMPLEMENTED | src/app/reset-password/page.jsx:1-100; src/app/api/auth/reset-password/route.js:1-20 | Generic refusal + transactional upsert + revoke all sessions + recordAudit PASSWORD_RESET_COMPLETED |
| Onboarding profile — UI + POST /api/onboarding/profile | IMPLEMENTED | src/app/(entry)/onboarding/profile/page.jsx:1-120; src/app/api/onboarding/profile/route.js:1-42; src/modules/identity/onboarding-service.js:44-101 | Zod .strict() + trusted session + required firstName/lastName/phone enforced server-side + audit |
| Onboarding profile fields — post-onboarding edit | MISSING | src/modules/identity/resolve-viewer.js:46; src/app/(pm)/profile/page.jsx:1-55 | firstName/lastName/phone/email never surfaced after onboarding |
| Onboarding state GET /api/onboarding/state | IMPLEMENTED | src/app/api/onboarding/state/route.js:1-19; src/modules/identity/onboarding-service.js:110-176 | Read-only; scoped per AC-066 |
| Onboarding workspace creation POST /api/onboarding/workspaces | IMPLEMENTED | src/app/(entry)/waiting-room/page.jsx:66-80; src/app/api/onboarding/workspaces/route.js:1-25 | Gated on profileCompletedAt; transactional Portfolio+WorkspaceMembership(OWNER); two recordAudit calls |
| Workspace invite — accept POST /api/workspace-invites/accept | IMPLEMENTED | src/app/(entry)/waiting-room/page.jsx:49-64; src/modules/identity/workspace-membership-service.js:154-210 | Creates WorkspaceMembership only (Portfolio-scoped); atomic PENDING→ACCEPTED updateMany; audited |
| Workspace invite — mint POST /api/workspace-invites, revoke DELETE /api/workspace-invites/[id], remove DELETE /api/workspace-memberships | MISSING_SURFACE (API complete) | src/app/api/workspace-invites/route.js:1-35; src/app/api/workspace-invites/[id]/route.js:1-18; src/app/api/workspace-memberships/route.js:1-29 | All three endpoints fully authorized, audited, Zod-validated; zero UI anywhere calls them |
| Business assignment / RoleBinding (FR-076) | DECLARED_ONLY | src/modules/identity/rbac-service.js:80-160; src/modules/identity/product-owner-service.js:1-16 | assignRoleBinding/updateRoleBindingStatus full implementation + audit; zero route or UI consumer |
| Membership creation (Business-scoped) | IMPLEMENTED (API+UI) | src/modules/project-manager/application/project-team-service.js:108-124; src/app/api/projects/[id]/team/route.js; scope-service.js:231 | Via Project Team add-member UI and Business/Workspace self-creation; addProjectTeamMember audited TEAM_MEMBER_ADDED |
| Membership status lifecycle (ACTIVE/SUSPENDED) — write surface | MISSING | prisma/schema.prisma:401; grep of src/modules shows only role/domainKeysJson writes, never status | Enforcement (resolveAuthorizationContext denies SUSPENDED) fully built+integration-tested; no admin route/UI to set status |
| Users & permissions page /platform/users | IMPLEMENTED | src/app/(pm)/platform/users/page.jsx:1-79; src/app/api/platform/users/route.js:1-21 | Owner-only role/domainKeys edit on existing Memberships; per-Business ownership re-checked; recordAudit PERMISSIONS_UPDATED |
| My profile page /profile | IMPLEMENTED (read-only) | src/app/(pm)/profile/page.jsx:1-55; src/app/api/profile/route.js:1-15 | Shows displayName, code, role, LINE-link boolean, session-active boolean, localStorage language toggle |
| API access keys — mint POST /api/platform/api-access-keys, revoke DELETE /api/platform/api-access-keys/[id] | MISSING_SURFACE (API complete) | src/app/api/platform/api-access-keys/route.js:1-21; src/app/api/platform/api-access-keys/[id]/route.js:1-21 | No GET/list endpoint exists at all; no UI; if key id is lost, impossible to revoke |
| Plugin authorization consent GET/POST /api/plugin/auth/authorize | IMPLEMENTED | src/app/(entry)/plugin/authorize/page.jsx:1-80; src/app/api/plugin/auth/authorize/route.js:1-123 | Two-step GET-render/POST-act split to close SameSite=Lax hole; CSRF token + HMAC-signed request token; capabilities server-derived |
| Plugin auth service writes (5 sites: install, auth-code, replay revoke, session create, token revoke) | BUILT — audit missing | src/modules/identity/plugin-auth-service.js:160,189,223,350,476 | pluginInstallation.create, pluginAuthorizationCode.create, pluginSession.updateMany (replay), pluginSession.create, pluginSession.updateMany (revoke) — zero recordAudit across all five |
| Plugin auth token revoke route POST /api/plugin/auth/revoke | IMPLEMENTED (functionally) — audit missing | src/app/api/plugin/auth/revoke/route.js:1-35 | Calls plugin-auth-service.js:464-476 (no recordAudit) |
| Plugin auth expired-record reaper (reapExpiredPluginAuthRecords) | BUILT_NOT_WIRED | src/modules/identity/plugin-auth-service.js:245-290 | Dead code outside tests; zero cron/route/heartbeat caller; feature note acknowledges 'maintenance invocation remains gated' |
| PDPA erasure — erasePrincipal | BUILT_NOT_DECLARED | src/modules/identity/erase-principal.js:25-113; src/modules/identity/gate.js:32 (re-export only) | Excellent transactional implementation (revoke + redact + audit); zero invocation path in running deployment |
| Operator bootstrap (FR-107) + PlatformGrant lifecycle | IMPLEMENTED (CLI-only by design) — no revoke | scripts/bootstrap-operator.mjs; src/modules/identity/operator-bootstrap.js:46-100 | CLI-only mint matches ADR-016 premise; no revoke/list function, route, or script anywhere |
| Schema parity (SQLite vs Postgres) | IMPLEMENTED | prisma/schema.prisma; prisma/schema.postgres.prisma; supabase/migrations (20260826130000, 20260826150000, 20260827090000, 20260830120000, 20260818084011) | No dev/prod drift found for any identity model |

#### Findings

##### D3-identity-onboarding-forms-12 — No UI path to give a brand-new Person their first Business-level Membership

| ฟิลด์ | รายละเอียด |
|-----|-----------|
| ระดับ | **CRITICAL** |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | workspace-membership-service.js:154 (acceptWorkspaceInvite creates WorkspaceMembership only, never Membership model); project-team-service.js:91 (listProjectTeam queries `db.person.findMany({ where: { memberships: { some: { tenantId: workspace.tenantId } } } })` — only Persons who already hold some Membership); project/[projectId]/team/page.jsx:119 (Team tab's add-member <select> populated from availablePeople only); api/people/route.js:15 (GET-only, no create route); scope-service.js:227 (only Membership.create for self as OWNER of new Business) |
| สิ่งที่ควรเป็น | Tenant/Workspace Owner ต้องสามารถเพิ่ม staff ใหม่เข้า Business ที่มีอยู่ (FR-036/FR-067) — นี่คือเส้นทาง onboarding หลักสำหรับผู้เช่าที่มีหลายคน |
| สิ่งที่เป็นจริง | ทุกเส้นทาง UI ที่สามารถสร้าง Membership ระดับธุรกิจ: (1) FR-067 invite/accept สร้าง WorkspaceMembership (Portfolio-scoped) เท่านั้น ไม่ใช่ Membership; (2) UI เพียงแห่งเดียวที่สร้าง Membership ระดับธุรกิจสำหรับผู้อื่น คือ Project Team tab ซึ่งสามารถเสนอเฉพาะ Persons ที่มี Membership อยู่แล้ว บุคคลใหม่จะไม่ปรากฏในตัวเลือกเลย; addProjectTeamMember service ไม่มีข้อจำกัดดังกล่าว แต่ UI ไม่สามารถค้นพบ id เพื่อเลือกได้; วิธีเดียวที่บุคคลใหม่ได้รับ Business access คือสร้าง Business ใหม่เป็นเจ้าของตัวเอง — ไม่มี UI flow สำหรับ 'เพิ่มบุคคลนี้เข้า Business ของฉันที่มีอยู่' |
| ข้อเสนอแนะ | (a) WorkspaceInvite acceptance ต้องสร้าง/เสนอ Membership ระดับธุรกิจด้วย เมื่อ invite ตั้งชื่อ target Business หรือ (b) เปลี่ยน availablePeople query ของ Team tab เพื่อรวม Persons ที่มองเห็นใน workspace (เช่น ผ่าน WorkspaceMembership ใน portfolio เดียวกัน) แทนการกำหนดให้มี tenant Membership ก่อนหน้านี้ |
| เกี่ยวข้อง | D3-identity-onboarding-forms-01 |
| การตรวจสอบ | verifier-added |

##### D3-identity-onboarding-forms-01 — Workspace invite mint/revoke and membership-removal APIs have no UI anywhere in the app

| ฟิลด์ | รายละเอียด |
|-----|-----------|
| ระดับ | HIGH |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | workspace-invites/route.js:23 (POST mints, fully authorized/audited/Zod-validated); workspace-invites/[id]/route.js:13 (DELETE revokes); workspace-memberships/route.js:19 (DELETE removes); waiting-room/page.jsx:49 (only accept endpoint called, never POST/DELETE); workspace-home/page.jsx:1 (no invite/revoke/remove controls) |
| สิ่งที่ควรเป็น | FR-067: 'Tenant Owner หรือ Workspace Owner ต้องสามารถเชิญ Profile เข้า Workspace' — การกระทำที่เจ้าของคนกระทำจริง ไม่ใช่เพียงสัญญา API |
| สิ่งที่เป็นจริง | ขา accept มีหน้า; ขา mint/revoke/remove (ครึ่ง owner-facing ของคุณสมบัติ) มีอยู่เป็น authenticated JSON endpoints เท่านั้น ศูนย์ UI consuming ใดก็ตามใน src/app หรือ src/components |
| ข้อเสนอแนะ | เพิ่มการควบคุม 'เชิญไป Workspace' (พร้อม revoke/remove) ไป workspace-home หรือหน้า Workspace settings ใหม่ เรียก endpoints ที่มีอยู่สามสาย — ไม่จำเป็นต้องเปลี่ยน service layer เพียง UI |
| เกี่ยวข้อง | D3-identity-onboarding-forms-12 |
| การตรวจสอบ | CONFIRMED |

##### D3-identity-onboarding-forms-02 — firstName/lastName/phone/email collected at onboarding are never displayed or editable again

| ฟิลด์ | รายละเอียด |
|-----|-----------|
| ระดับ | HIGH |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | resolve-viewer.js:46 (resolvePrincipal selects only id/code/displayName); profile-permission-service.js:77 (getMyProfile returns ...viewer plus identities/session; no firstName/lastName/phone/email); profile/page.jsx:30 (/profile renders displayName/code/role/LINE-boolean/session-boolean/language toggle only); onboarding/profile/page.jsx:1 (only page that writes these fields, inside entry group with no link from BusinessShell) |
| สิ่งที่ควรเป็น | FR-122 require given name, family name, phone at profile completion; ผู้พิมพ์ผิดหรือเปลี่ยนหมายเลขต้องมีวิธีแก้ไขหลัง onboarding |
| สิ่งที่เป็นจริง | onboarding-service.completeProfile รองรับการเรียกใช้ต่อมา (stamp PROFILE_UPDATED ไม่ใช่เฉพาะ PROFILE_COMPLETED) ดังนั้นเส้นทางเขียนจึงทนต่อการส่งซ้ำ — แต่ไม่มี UI ที่เข้าถึงได้เพื่อส่งซ้ำเมื่อบุคคลมี Business access และแม้แต่ /api/profile ก็ไม่สามารถแสดงว่าเก็บไว้อะไร |
| ข้อเสนอแนะ | Link /onboarding/profile จาก BusinessShell /profile page เป็นอัฟฟอร์แดนซ์แก้ไข หรือเพิ่มฟิลด์ (พร้อมการบันทึก) ไป /profile โดยตรง; ขยาย getMyProfile/resolvePrincipal เลือก firstName/lastName/phone/email สำหรับแสดง |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D3-identity-onboarding-forms-03 — Plugin auth service writes five distinct sensitive records with zero audit trail

| ฟิลด์ | รายละเอียด |
|-----|-----------|
| ระดับ | HIGH |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | plugin-auth-service.js:160 (findOrCreateInstallation → pluginInstallation.create no recordAudit); :189 (createPluginAuthorizationCode → pluginAuthorizationCode.create no recordAudit); :223 (revokeSessionsFromReplayedCode → db.pluginSession.updateMany no recordAudit); :350 (token exchange → pluginSession.create no recordAudit); :476 (revokePluginToken → db.pluginSession.updateMany no recordAudit); grep ยืนยัน zero occurrences ของ 'recordAudit' หรือ audit import |
| สิ่งที่ควรเป็น | CLAUDE.md: 'ทุกการเขียนต้องผ่านบริการใน application/ ซึ่งบันทึก audit event' ทุกคู่ mint/revoke อื่นใน identity domain (mintPasswordReset/resetPassword, mintWorkspaceInvite/revokeWorkspaceInvite, mintApiAccessKey/revokeApiAccessKey, assignRoleBinding/updateRoleBindingStatus) เรียก recordAudit ในทุกการเปลี่ยนแปลงสถานะ |
| สิ่งที่เป็นจริง | grep ของไฟล์ยืนยัน zero occurrences ของ 'recordAudit' หรือการนำเข้า audit module; ไม่มี call site เขียนทั้งห้าถูก audit |
| ข้อเสนอแนะ | เพิ่มการโทร recordAudit (payload excluding token/code material ตรงกับรูปแบบใน mintWorkspaceInvite/mintPasswordReset) สำหรับ PLUGIN_INSTALLATION_CREATED, PLUGIN_AUTH_CODE_MINTED, PLUGIN_SESSION_ISSUED, PLUGIN_SESSION_REVOKED_REPLAY, PLUGIN_TOKEN_REVOKED |
| เกี่ยวข้อง | D3-identity-onboarding-forms-06 |
| การตรวจสอบ | CONFIRMED |

##### D3-identity-onboarding-forms-04 — Membership.status has no write surface to reach SUSPENDED; the only exposed lifecycle action is a hard delete

| ฟิลด์ | รายละเอียด |
|-----|-----------|
| ระดับ | MEDIUM |
| ประเภท | DECLARED_NOT_BUILT |
| หลักฐาน | schema.prisma:401 (Membership.status String @default("ACTIVE"), indexed [tenantId, status]); tests/integration/iam-authorization.test.js:52 (prisma.membership.updateMany({ data: { status: 'SUSPENDED' } }) — ONLY place SUSPENDED transition occurs, test setup only); project-team-service.js:139 (removeProjectTeamMember does db.membership.delete hard delete, never status flip); grep ของ db.membership.update/updateMany confirms only role, domainKeysJson changes |
| สิ่งที่ควรเป็น | docs/PRD-SDD-v1.0.md FR-095: '...logout, Person erasure, Membership suspension or explicit revocation denies the next request' — สิ่งนี้ชี้ให้เห็น Membership suspension เป็นการกระทำผู้ดูแลจริง และการบังคับใช้ (resolveAuthorizationContext denies SUSPENDED Membership) ถูก implement ครบ + integration-tested |
| สิ่งที่เป็นจริง | ไม่มี route, service function, UI control ใดก็ตามใน src/ ที่เขียน Membership.status นอกจาก ACTIVE default (grep ของ db.membership operations ยืนยัน); enforcement half ถูก build ครบและ integration-test ผ่าน |
| ข้อเสนอแนะ | เพิ่ม suspend/reactivate Membership action (service + route + control on /platform/users หรือ project Team tab) ที่ตั้งสถานะ หรือถ้า hard-delete เป็นแบบจำลองวงจรชีวิตที่ตั้งใจ ให้แก้ไข FR-095 PRD sentence และลบ unused status enum states เพื่อหลีกเลี่ยงการหมายถึงเส้นทางการบังคับใช้ที่ไม่มี actuator |
| เกี่ยวข้อง | — |
| การตรวจสอบ | ADJUSTED — verifier confirmed code gap is real; PRD row already marked '🟠 Issue #99 Phase 0 P0' (known tracked partial); enforcement half fully built+integration-tested; only admin actuator missing. Downgraded to MEDIUM/DECLARED_NOT_BUILT to match finder's treatment of structurally identical gaps (findings 05/06/08/09: service built, no UI/route to invoke). |

##### D3-identity-onboarding-forms-05 — Password-reset mint (POST /api/platform/users/password-resets) has no UI anywhere

| ฟิลด์ | รายละเอียด |
|-----|-----------|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/app/api/platform/users/password-resets/route.js:14 (POST handler wired to mintPasswordReset, fully authorized/audited); src/app/(pm)/platform/users/page.jsx:1 (platform users page only edits role/domainKeys, no reset button; grep of src/app src/components for 'password-resets' finds only route file) |
| สิ่งที่ควรเป็น | FR-104 workflow: 'Tenant Owner ที่ดำเนินการจัดการ Memberships แล้ว (FR-038) มอบลิงก์รีเซ็ต' — owner ทำการนี้จากพื้นผิวเดียวกัน |
| สิ่งที่เป็นจริง | ไม่มีปุ่ม แบบฟอร์ม หรือหน้า endpoint นี้; owner ต้องออก POST โดยตรง (curl/Postman/devtools) |
| ข้อเสนอแนะ | เพิ่มการดำเนินการ 'รีเซ็ตรหัสผ่าน' ต่อแถวบน /platform/users เรียก POST /api/platform/users/password-resets พร้อม personId และแสดงโทเค็นดิบครั้งเดียว |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D3-identity-onboarding-forms-06 — API access keys can be minted and revoked but never listed — no UI, and no GET/list endpoint exists at all

| ฟิลด์ | รายละเอียด |
|-----|-----------|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/app/api/platform/api-access-keys/route.js:15 (only POST exported, no GET); [id]/route.js:15 (only DELETE exported); src/modules/identity/api-access-auth.js:101 (apiAccessKey.findUnique for point lookups; findMany never called in non-test source) |
| สิ่งที่ควรเป็น | Owner ต้องดูว่า Enterprise API keys ใดมีอยู่สำหรับ Tenant เพื่อตัดสินใจ revoke (SEC-006 revocation authority implies knowing what to revoke) |
| สิ่งที่เป็นจริง | Key id ส่งคืนเพียงครั้งเดียวใน mint response; ถ้า id/label mapping หายไป DELETE endpoint ใช้ไม่ได้ เพราะไม่มีวิธีค้นพบ ids; ไม่มี UI mint/revoke |
| ข้อเสนอแนะ | เพิ่ม GET /api/platform/api-access-keys?tenantId=... (id, label, keyPrefix, createdAt, revokedAt — never keyHash) + platform UI page สำหรับ mint/list/revoke |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D3-identity-onboarding-forms-07 — RoleBinding assignment (assignRoleBinding/updateRoleBindingStatus) has no API route or UI at all

| ฟิลด์ | รายละเอียด |
|-----|-----------|
| ระดับ | MEDIUM |
| ประเภท | DECLARED_NOT_BUILT |
| หลักฐาน | src/modules/identity/rbac-service.js:80 (assignRoleBinding full implementation, Zod-less validation, audit); :122 (updateRoleBindingStatus full implementation, audit); product-owner-service.js:9 (deprecated wrapper); grep ของ src/app/api tree and src/app/(pm) + src/components returns zero |
| สิ่งที่ควรเป็น | docs/PRD-SDD-v1.0.md FR-076 marks '🟠 local contract implemented; remote identity and migration pending' — PRD already flags partial |
| สิ่งที่เป็นจริง | grep ของ src/app/api tree and src/app/(pm) + src/components สำหรับ assignRoleBinding/rbac-service/RoleBinding symbols returns zero — no route or consumer UI ใดก็ตาม |
| ข้อเสนอแนะ | เพิ่ม Business-scoped 'Assign Product Owner' route + UI (under /platform/users หรือ Business settings) เมื่อ service contract สเตตเบล หรือปรับ PRD/roadmap wording ระบุชัดเจนว่า zero surface มีอยู่เลยดังนั้น '🟠' status ไม่ถูกอ่านว่า 'usable locally' |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D3-identity-onboarding-forms-08 — erasePrincipal (PDPA erase-revoke) is fully built and integration-tested but has zero invocation path in the running product

| ฟิลด์ | รายละเอียด |
|-----|-----------|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/modules/identity/erase-principal.js:25 (full transactional implementation: revoke + redact Customer + conditionally Person + record AuditEvent ERASED); gate.js:32 (re-exported only as P3 gate aggregate); grep ของ src/app/api (all 110 route files) and scripts/ for 'erasePrincipal' or 'erase-principal' returns zero outside module+test |
| สิ่งที่ควรเป็น | FR-022 (marked ✅ in PRD) names 'PDPA erase-revoke' as part of completed P3 identity gate |
| สิ่งที่เป็นจริง | grep ของ src/app/api (all route files) and scripts/ returns zero — no operator/owner UI, no admin route, no CLI script invokes erasure in deployed instance |
| ข้อเสนอแนะ | เพิ่ม authorized route (operator- หรือ Tenant-owner-gated) ที่เรียก erasePrincipal และ/หรือ CLI script เช่น scripts/bootstrap-operator.mjs เพื่อให้ PDPA capability ที่ PRD อ้างสามารถเข้าถึงได้นอก test code |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D3-identity-onboarding-forms-09 — reapExpiredPluginAuthRecords has no scheduler/cron/route wiring anywhere

| ฟิลด์ | รายละเอียด |
|-----|-----------|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/modules/identity/plugin-auth-service.js:245 (reapExpiredPluginAuthRecords full implementation); docs/domains/identity/features/FR-123-plugin-authentication-and-capability-discovery.md:100 (feature note states 'adds no DDL, route, scheduler, cron'); grep -rln reapExpiredPluginAuthRecords src scripts returns module + test only |
| สิ่งที่ควรเป็น | แถว PluginAuthorizationCode/PluginSession ที่หมดอายุควรถูกล้างทิ้ง (purge) ในระบบที่ใช้งานจริง ตามเจตนา 'local reaper' ของ feature note |
| สิ่งที่เป็นจริง | ไม่มี cron entry, heartbeat hook, API route ใดก็ตามเรียกฟังก์ชัน; run ภายในการทดสอบเท่านั้น |
| ข้อเสนอแนะ | Wire reaper ใน agent heartbeat route ที่มีอยู่ (src/app/api/agent/heartbeat/route.js) หรือ scheduled task ตรงกับรูปแบบที่ feature note anticipates |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D3-identity-onboarding-forms-10 — Login route has no rate limiting or lockout of any kind

| ฟิลด์ | รายละเอียด |
|-----|-----------|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/app/api/auth/login/route.js:38 (POST calls authenticateUser directly, no rate limiter or attempt counter); src/modules/identity/signup-rate-limit.js:1 (signup has in-process rate limiter — inconsistency) |
| สิ่งที่ควรเป็น | Public credential-verification endpoint เป็นเป้าหมาย brute-force ธรรมชาติ; signup endpoint ถือว่าความกังวลนี้สำคัญพอ |
| สิ่งที่เป็นจริง | ไม่มี middleware.js ใน repo, ไม่มี per-source counter/backoff/lockout ใน login path ที่ layer ใด |
| ข้อเสนอแนะ | Apply same (หรือ stronger) rate-limit pattern จาก signup-rate-limit.js ไป login route |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D3-identity-onboarding-forms-11 — PlatformGrant (OPERATOR capability) has a mint path but no revoke or list path anywhere in the repo

| ฟิลด์ | รายละเอียด |
|-----|-----------|
| ระดับ | LOW |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/modules/identity/operator-bootstrap.js:50 (platformGrant.findFirst and platformGrant.create only operations); src/modules/identity/viewer-authority.js:88 (isInstallationOperator reads viewer.isOperator from ACTIVE grant); grep ของ src/modules/identity/*.js for 'platformGrant.' shows only findFirst/create |
| สิ่งที่ควรเป็น | Privilege as strong as installation-wide OPERATOR ต้อง revoke/list ที่ใดที่หนึ่ง เมื่อ granted แม้ว่า minting จะคงอยู่ CLI-only |
| สิ่งที่เป็นจริง | grep ของ src/modules/identity/*.js shows only findFirst/create; ไม่มี update/delete ใน module, no route, no second CLI script revocation |
| ข้อเสนอแนะ | ถ้าตั้งใจให้ operators เป็นถาวร ระบุชัดเจนใน FR-107 feature note; ถ้าไม่เช่นนั้น เพิ่ม scripts/revoke-operator.mjs |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D3-identity-onboarding-forms-13 — No self-service 'leave workspace' action — membership removal always requires owner/admin authority

| ฟิลด์ | รายละเอียด |
|-----|-----------|
| ระดับ | LOW |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/modules/identity/workspace-membership-service.js:261-262 (removeWorkspaceMembership calls assertWorkspaceAdminAuthority unconditionally, no self-removal branch); src/app/api/workspace-memberships/route.js:19 (DELETE route passes through with no self-removal special case) |
| สิ่งที่ควรเป็น | บุคคลที่เข้า Workspace โดยเข้าใจผิดหรือต้องการจากไป ต้องสามารถลบความเป็นสมาชิกได้โดยไม่ต้องมี owner authority |
| สิ่งที่เป็นจริง | เส้นทางลบสมาชิกมีอยู่ทางเดียว และต้องการให้ caller มี workspace admin authority เสมอ; สมาชิก plain ไม่มีวิธี leave Workspace ผ่าน route/UI ใด |
| ข้อเสนอแนะ | เพิ่ม personId === viewer.principal.id short-circuit ใน removeWorkspaceMembership + 'Leave workspace' control ใน workspace-home |
| เกี่ยวข้อง | D3-identity-onboarding-forms-01 |
| การตรวจสอบ | verifier-added |

#### ข้อจำกัดการตรวจ

**Finder coverage** — Scope: ทุก identity/onboarding/admin form และสายการเชื่อมโยง API/service/schema/UI ต่อ D3 assignment boundary (data pipeline: surface ไหนรับข้อมูล → validate → service → audit → persist → read/consume) สำหรับ identity domain เท่านั้น ไฟล์ที่เปิดและอ่านโดยสมบูรณ์หรือในส่วนที่เกี่ยวข้อง: ~35 source files (signup/login/reset/onboarding/profile/permissions/team routes, identity services core layer), 2 schema files (dev SQLite + prod Postgres), 29 migrations directory files (grepped not opened), 3 feature-note markdown files (FR-067/076/123) read via grep เท่านั้น, 2 test directory listings filtered by filename (integration/e2e identity-scoped tests). ไม่ได้เปิด/ไม่ได้อ่านสมบูรณ์: LINE identity linking modules (channel-identity, link-line-identity, resolve-line-identity, classify-principal, authorization-context, agent-tool-authorizer, plugin-consent families), agent/tool IAM modules (action-gate, auth-context full bodies), CRM/customer-consent flows (assigned to line-agent-crm-flow sibling finder unit per assignment boundary note); src/lib/db-boundary.js, full profile-permission-service test file, docs/domains/identity/CHARTER.md (grepped only), docs/domains/identity/features/FR-038/122 prose (grepped only). ไม่ได้รันชุดการทดสอบใดก็ตาม (mandate read-only) — ข้อเรียกร้องการครอบคลุมของ tested/untested based on test file presence/absence และ @tested annotations only.

**Verifier coverage** — Verified all 13 finder reports by opening exact cited files/lines and independently grepping for counter-evidence (alternate UI names, alternate routes, alternate audit patterns). All 11 reported findings reproduced exactly as stated; 1 ADJUSTED (D3-04, severity/framing downgrade only; enforcement half fully built+integration-tested, only admin actuator missing — already tracked as '🟠 Issue #99 Phase 0 P0' in PRD row); 0 REFUTED. 2 verifier-added findings surfaced from tracing "where are Memberships created" question this unit was explicitly asked to answer in assignment scope: D3-12 (CRITICAL, compound root cause sharpening onboarding flow gap), D3-13 (LOW, self-service workspace-leave gap). Did not retest FR-076/104/106/107/FR-123/plugin-auth individual test execution or LINE/agent/tool/CRM modules per read-only mandate and assignment boundary — finder's scope correctly excluded those, verifier only spot-checked.

## integration-knowledge-document-intake

#### สรุปย่อ
- Market Intelligence dashboard และ /market page คือ 100% hardcoded mock data (ข้อมูล 2 ตัวอย่าง + KPI สมมติ) แต่ nav marking เป็น `soon: false` ซึ่งแสดงให้ user เห็นว่าเป็น shipped feature ✅ (CRITICAL)
- **CRITICAL (critic-added)**: `GET /api/platform/integrations/line-registry` เมื่อเรียกโดยไม่ระบุ `businessId` จะคืนทะเบียน LINE group/user ของ**ทุก tenant**ในระบบ — ทั้ง `assertScope` ถูกเรียกเฉพาะ `if (businessId)` เท่านั้น ทำให้ viewer ที่ authenticated แล้วรายใดก็ได้เห็น externalAccountId, ชื่อ/รหัส tenant และ business ของลูกค้ารายอื่นข้าม tenant ทั้งหมด
- **HIGH (critic-added)**: LINE Registry (`saveLineGroup`/`saveLineUser`) เรียก `recordAudit` ผิด arity (ส่ง object เดียวแทนที่จะเป็น `(db, options)`) ทำให้การเรียกทุกครั้ง throw แล้วถูก `.catch(() => {})` กลืนไปเงียบ ๆ — ไม่มีการเขียน LINE group/user ครั้งใดถูกบันทึก audit เลยแม้แต่ครั้งเดียว
- FR-109 (knowledge document ingestion executor) มี implementation ครบทั้ง 17 stages และ PipelineRun audit logging สมบูรณ์ แต่ไม่มี production entry point — reachable เพียงจาก 2 test files เท่านั้น
- Market observation translation core (FR-092) และ 4 adapters (marketplace/retail) เขียน code ครบ persist-ready แต่ไม่มี producer ใดเรียก translate/persist — ทำให้ MarketObservation table ยังเป็น empty ในระบบ
- FR-024 knowledge graph write/projection (projectKnowledgeGraph) มี implementation แต่ไม่เคยถูก trigger ใน production — agent read path ชดเชยด้วย Prisma fallback
- Customer import review decisions สามารถ DECIDE ได้ แต่ customer row creation ถูก defer — applyRequired:true ส่งกลับ แต่ไม่มี apply step ในโค้ด
- SoT decision pipeline, document staging และ pipeline tracking audit เสร็จสิ้นส่วนใหญ่ แต่มี gaps เล็กน้อย (missing audit call, CLI-only FR-102 provisioning)
- **critic-added**: `POST /api/platform/integrations` (LLM-provider/Vault-secret intake) ไม่เคยถูกลงบัญชีในหน่วยนี้เลย — ตรวจสอบแล้วพบว่า flow นี้สมบูรณ์และตรงตาม BR-009/SDD-009 จริง (verified-complete)
- **critic-added**: LINE Registry ทำให้แถวใน read model ของ FR-080/AC-075.3 (`listPhase1Integrations`) ปนเปื้อนด้วยแถวที่เป็นสมุดรายชื่อผู้ติดต่อ ไม่ใช่ channel connection จริง; เขียนแบบไม่ transact และ de-dupe key ผิดขอบเขต business ทำให้ group ของ Business หนึ่งถูกโยกไป Business อื่นได้; replay route มี zero UI caller ทั้งที่ inventory เดิมนับเป็น IMPLEMENTED เหมารวม; governance ratchet (`.viewer-fixture-baseline.json`) มองไม่เห็น hand-built viewer ในเทสต์ของ line-registry-service; และหน้า Platform Integrations hardcode tenant UUID/code จริงไว้เป็นค่า fallback

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|---------|---------|----------|
| POST/GET /api/ingest/documents (SmartGift document intake) | IMPLEMENTED | src/app/api/ingest/documents/route.js:1-48 | |
| cloud-sot-agent.js stageDocumentIntake (validate→resolve→dedupe→audit) | IMPLEMENTED | src/platform/integrations/core/cloud-sot-agent.js:195-331 | |
| cloud-sot-agent.js stageDocumentIntakeForPipeline (Codex/MCP entry) | IMPLEMENTED | src/platform/integrations/core/cloud-sot-agent.js:338-368 | |
| MCP tool pipeline.documentStage → stageDocumentIntakeForPipeline | IMPLEMENTED | src/modules/project-manager/mcp/transport.js:15,322,390 | |
| document-intake-contract.js (Zod schema + assertContractRules) | IMPLEMENTED | src/platform/integrations/core/document-intake-contract.js:57-149,229-241 | |
| raw-ingest-service.js ingestRawExternalRecord (idempotent) | IMPLEMENTED | src/platform/integrations/core/raw-ingest-service.js:13-46 | |
| DocumentIntakePanel / MigrationMonitor (reads DATA_MIGRATION mode) | IMPLEMENTED | src/modules/project-manager/views/execution/mode-bodies.jsx:96-165,273-296,568 | |
| SoT plan board: GET /api/platform/sot/plan | IMPLEMENTED | src/app/api/platform/sot/plan/route.js; sot-plan-service.js:36-68 | |
| SoT decision submit: POST /api/platform/sot/decisions | PARTIAL | src/app/api/platform/sot/decisions/route.js:21-25; sot-decision-service.js:100-130 | no recordAudit call (finding 09) |
| SoT decision decide: POST .../decisions/{id}/decide | IMPLEMENTED | src/app/api/platform/sot/decisions/[decisionId]/decide/route.js; sot-decision-service.js:172-206 | audited, owner-gated |
| SoT decision export: GET /api/platform/sot/decisions/export | IMPLEMENTED | src/app/api/platform/sot/decisions/export/route.js; sot-decision-service.js:227-246 | cursor pull for external data plane |
| SoT pipeline console UI (board/inbox/graph pages) | IMPLEMENTED | src/app/(pm)/platform/sot-pipeline/page.jsx, .../inbox/page.jsx, .../graph/page.jsx | |
| FR-071 tail: canonical apply / Product promotion / publish | MISSING | — | no Product model in schema; apply is external per ADR-046 |
| Prisma model Product (canonical entity) | MISSING | prisma/schema.prisma | no '^model Product' match; canonicalProductRef is bare String? |
| knowledge-ingestion-executor.js ingestKnowledgeDocument (FR-109) | DECLARED_ONLY | src/platform/integrations/core/knowledge-ingestion-executor.js:134-372 | reachable only from 2 test files; no production entry point |
| stage-runner.js runKnowledgeIngestionStages (FR-118/119, 7 Tier-1) | IMPLEMENTED | src/modules/knowledge/stage-runner.js | pure, tested; only reachable via ingestKnowledgeDocument |
| quarantine.js buildQuarantineEnvelope (BR-022) | IMPLEMENTED | src/platform/integrations/core/knowledge-ingestion-executor.js:268-274 | reachable only via ingestKnowledgeDocument |
| pipeline-tracking-service.js (audit + ledger) | IMPLEMENTED | src/platform/integrations/core/pipeline-tracking-service.js | recordAudit at lines 375,489,876 |
| /api/pipelines/runs, /runs/{id}, /events | IMPLEMENTED | src/app/api/pipelines/runs/route.js; src/app/api/pipelines/runs/[executionRunId]/route.js | |
| POST /api/pipelines/runs/{executionRunId}/replay | PARTIAL (critic-corrected) | src/app/api/pipelines/runs/[executionRunId]/replay/route.js:12-16; pipeline-tracking-service.js:757-820 | route+service สมบูรณ์และ operator-gated จริง แต่ **ไม่มี UI caller เลย** — ดู D3-integration-knowledge-document-intake-19 (เดิม inventory เหมารวมไว้กับแถวข้างบนเป็น IMPLEMENTED ทั้งชุด) |
| PipelineMonitorPanel (reads /api/pipelines/runs) in DATA_MIGRATION | IMPLEMENTED | src/modules/project-manager/views/execution/mode-bodies.jsx:169-266 | will show nothing for DPL-KNOWLEDGE-INGEST-V1 since nothing produces a run; บรรทัด 266 มีเพียง label แสดงผล `replay?.workerExecution` ไม่มี control ที่ยิง POST replay |
| published-snapshot-contract.js (FR-110) | PARTIAL | docs/PRD-SDD-v1.0.md:320; tests/unit/knowledge-published-snapshot-contract.test.js | |
| sink.js / genesisblockdb-sink.js (FR-024 graph write) | DECLARED_ONLY | src/modules/knowledge/index.js:6-9 | zero call sites outside src/modules/knowledge |
| gbdb-rag-service.js createGenesisBlockDbRagService | DECLARED_ONLY | src/modules/knowledge/gbdb-rag-service.js | only importer: tests/unit/gbdb-rag-service.test.js |
| graph-query.js createGraphKnowledgeReader (GKS + Prisma fallback) | IMPLEMENTED | src/modules/knowledge/graph-query.js:20-32 | consumed by agent runtime |
| query.js queryKnowledge (Prisma-backed, agent read) | IMPLEMENTED | src/modules/agent/context.js, tools.js, runtime.js | |
| postgres-business-knowledge.js createPostgresBusinessKnowledgeReader | IMPLEMENTED | src/modules/knowledge/postgres-business-knowledge.js:36-66 | consumed by agent phase1-runtime |
| business_knowledge table producer | MISSING (route/job) | scripts/build_business_knowledge_import.py:1-80 | manual Python script; no app route |
| grounded-business-answer.js answerBusinessQuestion | IMPLEMENTED | src/modules/agent/grounded-business-answer.js:60-100 | agent consumer of business knowledge |
| translate-raw-record.js translateRawRecordToMarketObservation (FR-092) | IMPLEMENTED | src/modules/market-intelligence/application/translate-raw-record.js:120-197 | pure translation core |
| market-observation-service.js persist/translateAndPersist | DECLARED_ONLY | src/modules/market-intelligence/application/market-observation-service.js:21-96 | callers only in tests |
| market-observation-repository.js (Prisma-backed, atomic insert) | IMPLEMENTED | src/modules/market-intelligence/infrastructure/market-observation-repository.js:1-27 | production-ready; zero production callers |
| marketplace-listing-adapter.js / retail-price-adapter.js | DECLARED_ONLY | src/modules/integration/adapters/marketplace-listing-adapter.js:14-58 | callers only in own tests |
| price-intelligence / supplier-intelligence / procurement-recommendation services | DECLARED_ONLY | Each carries @req FR-092; zero production callers | phase 3-5; mis-declared |
| /market page + MarketDashboard.jsx | IMPLEMENTED (mock) | src/app/(pm)/market/page.jsx; src/modules/market-intelligence/components/MarketDashboard.jsx:10-72 | 100% hardcoded useState; no fetch |
| src/config/domains.js market nav entry | DOC_DRIFT | src/config/domains.js:55 (`soon: false`) | presented as shipped |
| GET /api/platform/customer-import-reviews (review queue) | IMPLEMENTED | src/app/api/platform/customer-import-reviews/route.js:1-22 | |
| GET /api/platform/customer-import-reviews/targets | IMPLEMENTED | src/modules/crm/customer-import-review-service.js:88-108 | |
| POST /api/platform/customer-import-reviews/{caseId}/decisions | IMPLEMENTED | src/modules/crm/customer-import-review-service.js:110-144 | audited; applyRequired:true returned; no apply step |
| Customer import review UI page | IMPLEMENTED | src/app/(pm)/platform/customer-import-reviews/page.jsx | |
| CustomerImportBatch / CustomerImportProvenance / ReviewCase producer | OUTSIDE_REPO | scripts/build_smartgift_customer_review_queue.py:1-39 | one-time backfill |
| Customer row creation from DECIDED review case (apply step) | MISSING | — | explicitly deferred |
| SotDataPlaneKey (FR-102) minting | DECLARED_ONLY | scripts/mint-sot-data-plane-key.mjs | CLI-only; no authenticated route unlike FR-106 |
| **POST /api/platform/integrations (createPhase1Integration)** (critic-added) | **IMPLEMENTED — verified complete** | src/app/api/platform/integrations/route.js:22-25; src/modules/integration/application/integration-management-service.js:38-44,165-227 | `zCreate.strict()` → `assertOwned` → Vault-only secretRef refusal → `db.$transaction` (provider upsert + connection create + credential create + `recordAudit` PHASE1_METADATA_CREATED ทั้งหมดในธุรกรรมเดียว) → อ่านกลับผ่าน `listPhase1Integrations` (:137) และแสดงบน `/platform/integrations` (page.jsx:273) — ครบ BR-009/SDD-009 |
| **GET/POST /api/platform/integrations/line-registry** (critic-added) | **PARTIAL — ช่องโหว่ระดับ CRITICAL/HIGH** | src/app/api/platform/integrations/line-registry/route.js; src/modules/integration/application/line-registry-service.js | GET ไม่ scope ตาม tenant/business เมื่อไม่ระบุ `businessId` (D3-integration-knowledge-document-intake-14); ทั้ง `saveLineGroup`/`saveLineUser` เรียก `recordAudit` ผิด arity จนไม่มี audit ใดถูกบันทึกจริง (D3-integration-knowledge-document-intake-15); เขียนแบบไม่ transact และ de-dupe ผิดขอบเขต business (D3-integration-knowledge-document-intake-18); ปนเปื้อน read model ของ FR-080 (D3-integration-knowledge-document-intake-17) |

#### Findings

##### D3-integration-knowledge-document-intake-01 — Market Intelligence dashboard is 100% hardcoded mock data presented as a live feed, and the nav marks it as shipped

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | CRITICAL |
| ประเภท | DOC_DRIFT |
| หลักฐาน | src/modules/market-intelligence/components/MarketDashboard.jsx:12,35,149; src/config/domains.js:55 |
| สิ่งที่ควรเป็น | หน้า /market ควรแสดงแถว MarketObservation จริง หรือไม่ nav ก็ควรระบุ soon:true |
| สิ่งที่เป็นจริง | หน้านี้ไม่เคย fetch ข้อมูลเลย ตัวเลข/badge ทั้งหมด hardcode ไว้ทั้งหมด business owner เห็นข้อมูลที่กุขึ้นมาโดยแยกไม่ออกจากข้อมูลจริง |
| ข้อเสนอแนะ | เลือกทำอย่างใดอย่างหนึ่ง: ต่อ MarketDashboard.jsx เข้ากับ endpoint จริง หรือพลิก nav เป็น soon:true และเอาข้อความ 'Live Feed' ออก |
| เกี่ยวข้อง | 02, 03, 04, 05, 06, 12 |
| การตรวจสอบ | CONFIRMED |

##### D3-integration-knowledge-document-intake-14 — GET /api/platform/integrations/line-registry คืนทะเบียน LINE ของทุก tenant เมื่อไม่ระบุ businessId (cross-tenant read leak)

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | CRITICAL |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | src/modules/integration/application/line-registry-service.js:45-52 (`assertScope`: `if (viewer?.isPlatformDev \|\| viewer?.isLocalDev) return; if (!ownsBusiness(viewer, businessId)) throw ...`) · :57-59 (`listLineRegistry`: `const viewer = await resolve(); if (businessId) assertScope(viewer, businessId)` — ไม่มี else branch ใด ๆ) · :61-64 (`const where = { provider: { code: 'line-oa' }, ...(businessId ? { businessId } : {}) }` — เมื่อไม่มี businessId, where ไม่มี predicate ของ tenantId/businessId เลย) · :66-73 (`prisma.integrationConnection.findMany({ where, include: { tenant: {...}, business: {...} }, ... })`) · :83-94 (ผลลัพธ์แต่ละแถวคืน `tenantId`, `tenantCode`, `tenantName`, `businessId`, `businessCode`, `businessName`, `externalAccountId` — เป็นรหัสกลุ่ม/ผู้ใช้ LINE จริงของทุก tenant) · src/app/api/platform/integrations/line-registry/route.js:15-24 (GET ส่ง `businessId: params.businessId \|\| null` ตรงเข้า `listLineRegistry` — ทำให้เรียกโดยไม่ระบุ query param ได้จริงผ่าน HTTP) · เทียบกับ src/modules/integration/application/integration-management-service.js:135-138 (`listPhase1Integrations`: `scopedBusinessIds = businessId ? [businessId] : ownedBusinessIds; if (scopedBusinessIds.length === 0) return []` — service พี่น้องในโดเมนเดียวกัน fallback ไปที่ ownedBusinessIds ของ viewer อย่างถูกต้อง ไม่ใช่คืนทุกแถว) |
| สิ่งที่ควรเป็น | ตาม BR-002/SEC-001 การอ่านข้อมูลที่ scope ด้วย tenant/business ต้องไม่มีทางคืนแถวข้าม tenant ได้เมื่อไม่ระบุพารามิเตอร์ — ตัวอย่างที่ถูกต้องในโดเมนเดียวกันคือ `listPhase1Integrations` ที่ fallback ไปยัง `ownedBusinessIds` ของ viewer เมื่อไม่มี `businessId` แทนที่จะคืนทุกแถวในตาราง |
| สิ่งที่เป็นจริง | `listLineRegistry` เรียก `assertScope` เฉพาะเมื่อมี `businessId` เท่านั้น เมื่อไม่มี ฟังก์ชันจะข้ามการตรวจสอบสิทธิ์ทั้งหมดและสร้าง `where` clause ที่มีเพียง `provider: { code: 'line-oa' }` — ไม่มีเงื่อนไข tenantId หรือ businessId ใด ๆ ผลคือ viewer ที่ authenticated แล้วรายใดก็ตาม (ไม่ต้องเป็นเจ้าของ business ใดเลย) สามารถเรียก `GET /api/platform/integrations/line-registry` โดยไม่ใส่ query param `businessId` แล้วได้รับทะเบียน LINE group/user ของทุก tenant ในระบบกลับมา รวมถึงรหัสกลุ่ม/ผู้ใช้ LINE จริง (`externalAccountId`), ชื่อและรหัสของ tenant/business ทุกรายในระบบ นี่คือ cross-tenant data leak ที่ใช้งานได้จริงโดยไม่ต้องมีสิทธิ์พิเศษใด ๆ |
| ข้อเสนอแนะ | แก้ `listLineRegistry` ให้ทำตามรูปแบบเดียวกับ `listPhase1Integrations` — เมื่อไม่มี `businessId` ให้ fallback ไปที่ `viewer.ownedBusinessIds` และคืน `[]` ทันทีถ้า array นี้ว่าง แทนที่จะสร้าง `where` clause ที่ไม่มี tenant/business predicate เลย ควรเพิ่ม regression test ที่ยืนยันว่าการเรียกโดยไม่ระบุ `businessId` ไม่คืนแถวของ tenant อื่นเด็ดขาด |
| เกี่ยวข้อง | D3-integration-knowledge-document-intake-15, D3-integration-knowledge-document-intake-17, D3-integration-knowledge-document-intake-18 |
| การตรวจสอบ | critic-added |

##### D3-integration-knowledge-document-intake-02 — ingestKnowledgeDocument (FR-109) has no production trigger

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | HIGH |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/platform/integrations/core/knowledge-ingestion-executor.js:134; only importers: 2 test files |
| สิ่งที่ควรเป็น | เอกสารที่ user ป้อนเข้ามาควรไปถึง ingestKnowledgeDocument เพื่อให้หลักฐาน Tier 1 สะสมอยู่ใน PipelineRun |
| สิ่งที่เป็นจริง | ไม่มี route/page/MCP tool ใดเรียกมันเลย; PipelineMonitorPanel ไม่แสดงอะไรเลยสำหรับ DPL-KNOWLEDGE-INGEST-V1 |
| ข้อเสนอแนะ | เพิ่มจุดเข้าถึง (route/MCP tool) ตามรูปแบบเดียวกับ stageDocumentIntakeForPipeline |
| เกี่ยวข้อง | 03 |
| การตรวจสอบ | CONFIRMED |

##### D3-integration-knowledge-document-intake-15 — LINE Registry เรียก recordAudit ผิด arity และกลืน error ทิ้ง — ไม่มีการเขียน LINE group/user ครั้งใดถูกบันทึก audit เลย

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | HIGH |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | src/modules/integration/application/line-registry-service.js:8 (`import { recordAudit } from '@/modules/project-manager/application/audit'`) · :184-193 (saveLineGroup: `await recordAudit({ tenantId, businessId, actorId, action, entityType, entityId, changes, now }).catch(() => {})` — เรียกด้วย object เดียว) · :271-280 (saveLineUser: รูปแบบเดียวกัน) · src/modules/project-manager/application/audit.js:6 (`export async function recordAudit(db, { entityType, entityId, action, payload = {}, actorType = 'LOCAL_USER', actorId = null })` — พารามิเตอร์แรกต้องเป็น prisma/tx client; `tenantId`/`businessId`/`changes`/`now` ไม่ใช่ field ที่ฟังก์ชันนี้รับ) · tests/unit/line-registry-service.test.js (43 บรรทัด ไม่มี assertion เกี่ยวกับ audit เลยแม้แต่จุดเดียว) |
| สิ่งที่ควรเป็น | ตามมาตรฐานเดียวกับที่ D3-identity-onboarding-forms-03 ใช้ตัดสิน plugin-auth-service (ถูกจัดเป็น HIGH ในรายงานนี้แล้ว): ทุกการเขียน record ที่อ่อนไหวต้องเรียก `recordAudit(db, options)` ให้ถูก signature และสำเร็จจริง ไม่ใช่แค่ "มีการเรียก" อยู่ในโค้ด |
| สิ่งที่เป็นจริง | line-registry-service.js import `recordAudit` ตัวจริงมาใช้ แต่เรียกด้วย argument เดียว (object) แทนที่จะเป็น `(db, options)` สอง argument — เมื่อรันจริง `db` จะกลายเป็น object นั้น และ argument ที่สอง (ที่ต้อง destructure `{ entityType, ... }`) จะเป็น `undefined` การ destructure ค่า `undefined` จะ throw ทันที และ `.catch(() => {})` ที่ต่อท้ายกลืน error นี้ไปเงียบ ๆ ผลคือทั้ง `saveLineGroup` และ `saveLineUser` เขียน `IntegrationConnection` สำเร็จ แต่ไม่มีการบันทึก audit ใด ๆ เกิดขึ้นจริงเลยแม้แต่ครั้งเดียว — รุนแรงกว่าการ "ไม่มี audit call" เพราะโค้ดดูเหมือนมี audit แต่ที่จริงมันพังทุกครั้งที่รัน |
| ข้อเสนอแนะ | แก้การเรียกใน saveLineGroup/saveLineUser ให้เป็น `recordAudit(db_หรือ_prisma, { entityType: 'IntegrationConnection', entityId: result.id, action: ..., payload: { tenantId, businessId, ... } })` ตาม signature จริงของ recordAudit; เพิ่ม test ที่ยืนยันว่ามี AuditEvent row ถูกสร้างขึ้นจริงหลังเรียก saveLineGroup/saveLineUser ไม่ใช่แค่ยืนยันว่าไม่ throw |
| เกี่ยวข้อง | D3-integration-knowledge-document-intake-14, D3-identity-onboarding-forms-03 |
| การตรวจสอบ | critic-added |

##### D3-integration-knowledge-document-intake-05 — Market translation-and-persist path has no production producer

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | HIGH |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/modules/market-intelligence/application/market-observation-service.js:67; src/modules/integration/adapters/marketplace-listing-adapter.js:14 |
| สิ่งที่ควรเป็น | ควรมีบางสิ่งสร้าง RawExternalRecord (ผ่าน adapter) แล้วเรียก translateAndPersistRawMarketRecord |
| สิ่งที่เป็นจริง | ไม่มี scraper/webhook/route ใดสร้าง RawExternalRecord เลย ฟังก์ชัน translation ไม่เคยถูกเรียกนอกจาก test |
| ข้อเสนอแนะ | สร้าง acquisition surface (scraper/webhook/upload route) ที่ผลิตแถว RawExternalRecord |
| เกี่ยวข้อง | 01, 06 |
| การตรวจสอบ | CONFIRMED |

##### D3-integration-knowledge-document-intake-03 — Knowledge graph projection write path never invoked outside tests

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | PARTIAL |
| หลักฐาน | src/modules/knowledge/index.js:6; src/modules/agent/runtime.js:1; docs/PRD-SDD-v1.0.md:234 |
| สิ่งที่ควรเป็น | เหตุการณ์ของ Zuri (สร้าง Customer/Membership) ควรเรียก projectKnowledgeGraph |
| สิ่งที่เป็นจริง | grep พบผู้เรียกเฉพาะใน src/modules/knowledge/ เองและ test ของมันเท่านั้น; GKS ไม่เคยถูกเติมข้อมูลเลย |
| ข้อเสนอแนะ | ต่อ trigger เข้ากับ audit/service layer หรือแก้สถานะ FR-024 ให้ระบุว่าฝั่งเขียนยังไม่มีอะไร trigger |
| เกี่ยวข้อง | 02, 04 |
| การตรวจสอบ | CONFIRMED |

##### D3-integration-knowledge-document-intake-17 — LINE Registry ทำให้ read model ของ FR-080/AC-075.3 ปนเปื้อนด้วยแถวที่เป็นสมุดรายชื่อผู้ติดต่อ

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | src/modules/integration/application/integration-management-service.js:140-148 (`listPhase1Integrations` ดึงแถวด้วย OR-clause: `{ purpose: PHASE1_LINE_LLM_PURPOSE }` หรือ `{ provider: { code: LINE_OA_PROVIDER_CODE } }`) · :69-71 (`connectionKind`: provider code `line-oa` ใด ๆ ถูกจัดเป็น `'CHANNEL'` เสมอ) · :73-108 (`toMetadata` คำนวณ field `health` ให้ทุกแถวที่คืนกลับมา) · src/modules/integration/application/line-registry-service.js:120-129 (provider upsert ใช้ `code: 'line-oa'` เดียวกับที่ Phase 1 LINE runtime ใช้) · :172-181 และ :259-269 (สร้าง connection ด้วย `purpose: LINE_REGISTRY_TYPES.GROUP`/`.USER` โดยไม่มี credential ใด ๆ ผูกอยู่เลย) · docs/PRD-SDD-v1.0.md:290 (FR-080: field `health` "computed from connection/credential state and RawExternalRecord arrival evidence") |
| สิ่งที่ควรเป็น | ตามที่ FR-080/AC-075.3 สัญญาไว้ field `health` ควรตอบคำถาม "LINE ยังทำงานอยู่ไหม" โดยคำนวณจากสถานะ connection/credential ของ channel จริงเท่านั้น |
| สิ่งที่เป็นจริง | ทุกกลุ่ม/ผู้ติดต่อ LINE ที่ owner ลงทะเบียนผ่าน LINE Registry จะถูกสร้างเป็น `IntegrationConnection` ที่มี provider code `line-oa` เหมือนกับ channel connection ของ Phase 1 LINE runtime ทุกประการ — `listPhase1Integrations` จึงดึงแถวเหล่านี้มารวมด้วย OR-clause แล้วจัดเป็น `'CHANNEL'` โดยอัตโนมัติ และคำนวณ `health` ให้ ทั้งที่แถวเหล่านี้ไม่มี credential ผูกอยู่เลย (`secretConfigured:false` เสมอ) ผลคือหน้า Platform Integrations แสดงกลุ่ม/ผู้ติดต่อ LINE ทุกรายที่ owner เคยลงทะเบียนเป็น "CHANNEL connection" ที่มีปัญหาด้าน health ทั้งที่จริง ๆ แล้วมันเป็นเพียงสมุดรายชื่อผู้ติดต่อ ไม่ใช่ channel ที่ต้องมี credential |
| ข้อเสนอแนะ | แยก connection kind ของ LINE Registry ออกจาก Phase 1 LINE channel อย่างชัดเจน (เช่น ใช้ `purpose` เป็นตัวตัดสิน `connectionKind` แทนการเช็คแค่ provider code) เพื่อไม่ให้แถวสมุดรายชื่อปนเข้าไปในการคำนวณ health ของ channel จริง |
| เกี่ยวข้อง | D3-integration-knowledge-document-intake-14, D3-integration-knowledge-document-intake-18 |
| การตรวจสอบ | critic-added |

##### D3-integration-knowledge-document-intake-18 — LINE Registry เขียนแบบไม่ transact และ de-dupe คีย์ผิดขอบเขต business — LINE group ของ Business หนึ่งถูกโยกไป Business อื่นได้แบบเงียบ ๆ

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | src/modules/integration/application/line-registry-service.js:114-117 (saveLineGroup: `resolve()` → `zSaveLineGroup.parse(payload)` → `assertScope(viewer, validated.businessId)` — ยืนยันสิทธิ์เฉพาะ business ปลายทางเท่านั้น) · :120-129 (provider upsert เป็นคำสั่งเดี่ยว อยู่นอก `$transaction` ใด ๆ) · :145-151 (`findFirst({ where: { tenantId, providerId, externalAccountId } })` — ไม่มีเงื่อนไข businessId ในการค้นหาแถวเดิมเลย) · :154-165 (เมื่อพบแถวเดิม `update` เซ็ต `businessId: validated.businessId` ทับของเดิมไปเลย) · :184-193 (audit เป็นอีกคำสั่งแยกต่างหาก ซึ่งตามที่ finding 15 ชี้ พังอยู่แล้ว) · เทียบกับ src/modules/integration/application/integration-management-service.js:173 (`createPhase1Integration` ห่อ create + credential + recordAudit ไว้ใน `db.$transaction` เดียวกันทั้งหมด) |
| สิ่งที่ควรเป็น | ตามรูปแบบที่ `createPhase1Integration` ใช้เป็นบรรทัดฐานในโดเมนเดียวกัน: write ที่เกี่ยวข้องกันทั้งหมด (สร้าง/อัปเดต + audit) ควรอยู่ใน `$transaction` เดียว และการค้นหาแถวเดิมเพื่อ de-dupe ต้อง scope ด้วย business เดียวกับที่ authorize ไว้ ไม่ใช่แค่ tenant |
| สิ่งที่เป็นจริง | สองข้อบกพร่องซ้อนกัน: (ก) provider upsert, connection create/update และการเรียก audit เป็นสามคำสั่งอิสระที่ไม่มี `$transaction` ครอบ — ช่องว่างความคงทนแบบเดียวกับที่ D3-business-pm-crud-forms-04 รายงานไว้ แต่ร้ายแรงกว่าตรงที่ audit call ในกรณีนี้ยังพังเองอยู่แล้วด้วย (finding 15); (ข) `assertScope` ยืนยันสิทธิ์เฉพาะ business ปลายทางที่ request ระบุมา แต่การค้นหาแถวเดิมเพื่อ de-dupe ใช้เพียง `tenantId + providerId + externalAccountId` — ไม่มี businessId ร่วมด้วย เมื่อพบแถวที่ตรงกัน โค้ดจะ `update` เซ็ต `businessId` ใหม่ทับของเดิมทันที ผลคือ owner ของ Business B ในเทแนนต์เดียวกันสามารถส่ง groupId ของกลุ่มที่เคยลงทะเบียนไว้กับ Business A มาลงทะเบียนซ้ำ แล้วทำให้กลุ่มนั้นถูกโยกมาเป็นของ Business B ได้ทันที โดยไม่เคยถูกตรวจสอบสิทธิ์กับ Business A เลยแม้แต่ครั้งเดียว |
| ข้อเสนอแนะ | ห่อ provider upsert + connection create/update + recordAudit ไว้ใน `db.$transaction` เดียว ตามรูปแบบ `createPhase1Integration`; แก้ query `findFirst` ให้เพิ่มเงื่อนไข `businessId: validated.businessId` เข้าไปด้วย เพื่อไม่ให้การ de-dupe ข้ามขอบเขต business ได้ |
| เกี่ยวข้อง | D3-integration-knowledge-document-intake-14, D3-integration-knowledge-document-intake-15, D3-integration-knowledge-document-intake-17, D3-business-pm-crud-forms-04 |
| การตรวจสอบ | critic-added |

##### D3-integration-knowledge-document-intake-06 — Phase 3-5 market services mis-annotated under FR-092

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | BUILT_NOT_DECLARED |
| หลักฐาน | procurement-recommendation-service.js:1; price-intelligence-service.js:4 |
| สิ่งที่ควรเป็น | ฟังก์ชันการทำงานควรประกาศ FR id ของตัวเอง หรืออ้างอิงไปยัง FR ที่อธิบายมันจริง |
| สิ่งที่เป็นจริง | ทั้งสี่ service ติด @req FR-092 ทั้งที่ implement พฤติกรรมที่ FR-092 ไม่ได้อธิบายไว้ |
| ข้อเสนอแนะ | ประกาศ FR/FEAT เฉพาะของตัวเอง แล้วรัน npm run docs:ids -- --write |
| เกี่ยวข้อง | 01, 05 |
| การตรวจสอบ | CONFIRMED |

##### D3-integration-knowledge-document-intake-10 — DECIDED customer review case never produces Customer row

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | PARTIAL |
| หลักฐาน | customer-import-review-service.js:139; customer-import-review-store.js:167 |
| สิ่งที่ควรเป็น | เมื่อ review ถูกตัดสินเป็น DECIDED ควรแปลง CREATE_SEPARATE/LINK_EXISTING ให้กลายเป็นแถว Customer จริง |
| สิ่งที่เป็นจริง | ไม่มี route/service ใด implement apply step เลย applyRequired:true ถูกส่งกลับแต่ไม่มีอะไรตามมา |
| ข้อเสนอแนะ | เพิ่มคำเตือนที่มองเห็นได้ใน `src/app/(pm)/platform/customer-import-reviews/page.jsx` ว่าการตัดสินใจ (decide) ยังไม่มีผลต่อข้อมูล Customer จริง และใส่ข้อควรระวังเดียวกันไว้ในเซลล์สถานะของ FR-078 (`docs/PRD-SDD-v1.0.md:288`) ไม่ใช่แค่ในรายงานฉบับนี้ |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D3-integration-knowledge-document-intake-04 — gbdb-rag-service has zero callers

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | LOW |
| ประเภท | BUILT_NOT_DECLARED |
| หลักฐาน | src/modules/knowledge/gbdb-rag-service.js; tests/unit/gbdb-rag-service.test.js:6 only importer |
| สิ่งที่ควรเป็น | RAG service ควรเข้าถึงได้จาก agent runtime |
| สิ่งที่เป็นจริง | ไม่ได้ export จาก public index ของ module เลย ไม่มีผู้เรียกใน agent |
| ข้อเสนอแนะ | ต่อเข้ากับ agent answer path — ผู้เรียกที่เหมาะสมคือ `src/modules/agent/grounded-business-answer.js:60` (`answerBusinessQuestion`) ซึ่งประกอบ `knowledge` port อยู่แล้ว โดย export `createGenesisBlockDbRagService` จาก `src/modules/knowledge/index.js` แล้วส่งเข้าไป หรือไม่ก็ระบุไว้อย่างชัดเจนใน feature note ของ FR-024 ว่าเป็น prototype ที่จงใจพักไว้ |
| เกี่ยวข้อง | 03 |
| การตรวจสอบ | CONFIRMED |

##### D3-integration-knowledge-document-intake-19 — POST /api/pipelines/runs/{executionRunId}/replay ไม่มี UI caller เลย ทั้งที่ inventory เดิมนับรวมไว้เป็น IMPLEMENTED เหมารวม

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/app/api/pipelines/runs/[executionRunId]/replay/route.js:12-16 (`POST` → `requestPipelineReplay`) · src/platform/integrations/core/pipeline-tracking-service.js:757-763 (`requireOperator(viewer)` + `parseReplayInput(input)`) · :768-820 (`transaction`: สร้าง `PipelineRun` ใหม่สถานะ `'QUEUED'` พร้อม replay lineage เต็มรูปแบบ — เป็น write ที่ operator สั่งจริง ไม่ใช่ read-only) · src/modules/project-manager/views/execution/mode-bodies.jsx:266 (การอ้างอิงคำว่า "replay" เพียงจุดเดียวในทุกหน้า/คอมโพเนนต์ คือ label แสดงผล `pipelineRun.replay?.workerExecution` — ไม่มี control ใดยิง POST) · รายงานเดิม (ตาราง Inventory) เหมารวม route นี้ไว้กับ `/api/pipelines/runs, /runs/{id}, /events, /replay` เป็น IMPLEMENTED ชุดเดียว โดยไม่มีข้อควรระวังใด ๆ |
| สิ่งที่ควรเป็น | ตามรูปแบบเดียวกับ MISSING_SURFACE ที่รายงานพบซ้ำหลายจุดในโดเมน identity/knowledge (เช่น D3-identity-onboarding-forms-05/06/07/08): route+service ที่สมบูรณ์และมี authorization gate ควรมี UI หรือช่องทางที่ user จริงเรียกใช้ได้ ไม่ใช่แค่ทดสอบผ่าน test เท่านั้น |
| สิ่งที่เป็นจริง | replay เป็น write ที่ operator เป็นผู้สั่งจริง (สร้าง PipelineRun ใหม่พร้อม replay lineage) และมี authorization gate ที่สมบูรณ์ (`requireOperator`) แต่ไม่มีหน้าหรือคอมโพเนนต์ใดในทั้ง repo ยิง POST ไปยัง route นี้เลย — การอ้างอิงคำว่า replay เพียงจุดเดียวในทุก UI คือ label ข้อความล้วน ๆ ไม่ใช่ control ที่ทำงานได้ นี่คือ pattern เดียวกับ "service เสร็จแต่ไม่มีใครเรียก" ที่รายงานนี้ระบุว่าเป็นความเสี่ยงหลักของมิตินี้ แต่ route นี้หลุดรอดไปเพราะถูกเหมารวมไว้ในแถว Inventory เดียวกับ route อื่นที่ใช้งานได้จริง |
| ข้อเสนอแนะ | เพิ่ม control บน PipelineMonitorPanel (mode-bodies.jsx) ให้ operator ยิง POST replay ได้จริงจาก UI (เช่น ปุ่ม "Replay failed stage" ข้าง label ที่มีอยู่แล้วที่บรรทัด 266) หรือถ้าตั้งใจให้เป็น API-only สำหรับ operator ที่ใช้ผ่านเครื่องมือภายนอกเท่านั้น ให้ระบุไว้ชัดเจนในแถว Inventory และ FR-071 status cell แยกจาก route อื่นที่มี UI จริง |
| เกี่ยวข้อง | D3-identity-onboarding-forms-05, D3-identity-onboarding-forms-06 |
| การตรวจสอบ | critic-added |

##### D3-integration-knowledge-document-intake-07 — FR-071 tail has no destination model (Product)

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | LOW |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | prisma/schema.prisma:1768; docs/PRD-SDD-v1.0.md:281 |
| สิ่งที่ควรเป็น | ควรมีแถว Product/Customer แบบ canonical เป็นจุดพักข้อมูล |
| สิ่งที่เป็นจริง | ไม่มี Product model เลย; external data plane เป็นผู้ apply ตามการออกแบบใน ADR-046 |
| ข้อเสนอแนะ | ระบุไว้ในเซลล์สถานะของ FR-071 ว่า apply เป็นความรับผิดชอบภายนอก พร้อมอ้างอิง ADR-046 |
| เกี่ยวข้อง | 05 |
| การตรวจสอบ | ADJUSTED (ปรับลดจาก HIGH เพราะ boundary การ apply ภายนอกถูกบันทึกไว้ชัดเจนแล้วใน ADR-046 D2.1) |

##### D3-integration-knowledge-document-intake-08 — business_knowledge producer is manual Python script

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | LOW |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | scripts/build_business_knowledge_import.py:1; docs/PRD-SDD-v1.0.md:341 |
| สิ่งที่ควรเป็น | FR-131 อธิบายถึง automated DPS-PUBLISH executor |
| สิ่งที่เป็นจริง | มีเพียง manual script เท่านั้น; เป็นความรับผิดชอบของ external worker ตามการออกแบบใน FR-129(d) |
| ข้อเสนอแนะ | อ้างอิงไขว้ถ้อยคำ boundary ของ FR-129(d) ไว้ใน FR-047/FR-131 ด้วย |
| เกี่ยวข้อง | 02 |
| การตรวจสอบ | ADJUSTED (ปรับลดจาก MEDIUM เพราะ boundary "Tier-1 ไม่ execute เอง" ถูกบันทึกไว้ชัดเจนแล้วใน FR-129(d)) |

##### D3-integration-knowledge-document-intake-09 — SoT decision submission records no AuditEvent

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | LOW |
| ประเภท | PARTIAL |
| หลักฐาน | sot-decision-service.js:114 (no recordAudit); line 181 (only decideSotDecision calls it) |
| สิ่งที่ควรเป็น | ทุกการเขียนควรบันทึก AuditEvent ตามข้อบังคับของ CLAUDE.md |
| สิ่งที่เป็นจริง | submitSotDecisions สร้างแถว SotDecision โดยไม่มี audit; น่าจะเป็นการตัดขอบเขตโดยตั้งใจ |
| ข้อเสนอแนะ | ถ้าตั้งใจ ให้ระบุไว้ชัดเจนในข้อความ FR-100/SDD; ถ้าไม่ตั้งใจ ให้เพิ่ม audit แบบเบา ๆ ให้ submitSotDecisions |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D3-integration-knowledge-document-intake-20 — Viewer-fixture governance ratchet มองไม่เห็น line-registry-service.test.js และ escape hatch (isPlatformDev/isLocalDev) ที่มันใช้ไม่มีอยู่บน viewer จริงเลย

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP + PRODUCTION_GATE_OPEN |
| หลักฐาน | src/modules/integration/application/line-registry-service.js:45-46 (`assertScope`: `if (viewer?.isPlatformDev \|\| viewer?.isLocalDev) return`) · `grep -rn 'isLocalDev\|isPlatformDev' src` คืนบรรทัดนี้เพียงบรรทัดเดียวในทั้ง repo — ไม่มี viewer จริงที่ resolver ใด ๆ ผลิตออกมาจะมี property เหล่านี้เลย · tests/unit/line-registry-service.test.js:13-17 (`const devViewer = { id: 'usr-dev-1', personId: 'per-1', isPlatformDev: true }` — ใช้เป็นผลลัพธ์ของ `resolve()` ในทั้งสอง test ที่มีอยู่, ไฟล์นี้มี 43 บรรทัด และไม่มีคำว่า `role` อยู่เลย) · docs/.viewer-fixture-baseline.json (`"files": []`, ระบุไว้ว่า 'preflight raises a CRITICAL for any file not listed here') · scripts/doc-preflight.mjs:519 (`roleLiteral = /\brole:\s*['"](OWNER\|MEMBER\|DEV)['"]/`) · :532 (`membershipRow` suppressor) · :595 (จุดที่ยก CRITICAL) · docs/.preflight-report.json (`{"critical":0,...,"overall":"PASS"}`) |
| สิ่งที่ควรเป็น | ตามที่ CLAUDE.md's factory rule และ RCA วันที่ 2026-08-16 วางไว้: viewer ที่ใช้ทดสอบต้องสร้างผ่าน `makeViewer()`/`ownsElsewhere()` เท่านั้น และ guard ของ `.viewer-fixture-baseline.json` มีไว้เพื่อจับ viewer ที่สร้างขึ้นมือทุกไฟล์ที่ยังไม่ถูกบันทึกไว้ในนั้น |
| สิ่งที่เป็นจริง | `devViewer` ใน `tests/unit/line-registry-service.test.js` เป็น viewer ที่สร้างขึ้นมือล้วน ๆ (ไม่ผ่าน factory) และใช้ property `isPlatformDev` เป็น escape hatch ให้ `assertScope` ข้ามการตรวจสอบสิทธิ์ทั้งหมด — แต่ grep ทั่ว `src/` ยืนยันว่าไม่มี resolver จริงตัวใดผลิต viewer ที่มี `isPlatformDev`/`isLocalDev` เลย ดังนั้น path การอนุญาตพิเศษนี้จึงไม่มีทางถูก trigger ได้จริงในระบบที่รันจริงเลย — เทสต์ทั้งสองเทสต์ของ service นี้จึงตรวจสอบผ่าน viewer รูปแบบที่ไม่มีทางเกิดขึ้นจริง และ path การตรวจสอบสิทธิ์จริง (ownsBusiness) ไม่เคยถูกทดสอบเลย ในขณะเดียวกัน `devViewer` object นี้ไม่มี field `role:` อยู่เลย (มีแค่ `id`/`personId`/`isPlatformDev`) จึง regex `roleLiteral` ของ preflight check ไม่ match กับไฟล์นี้ตั้งแต่ต้น — การตรวจสอบทั้งชุดจึงไม่เคยไปถึงขั้นตอนพิจารณา `membershipRow` suppressor เลยด้วยซ้ำ ไฟล์นี้จึงหลุดรอดการตรวจจับของ ratchet ไปทั้งไฟล์ ไม่ใช่แค่หลบเลี่ยงทีละจุด และ `docs/.preflight-report.json` ก็ยืนยันว่า critical เป็น 0 จริง |
| ข้อเสนอแนะ | ลบ escape hatch `isPlatformDev`/`isLocalDev` ออกจาก `assertScope` เพราะไม่มี viewer จริงใช้งานมันได้อยู่แล้ว (dead code ที่เป็นความเสี่ยงแฝง); เขียน test ของ line-registry-service.test.js ใหม่ให้ใช้ `makeViewer()`/`ownsElsewhere()` จริงจาก `tests/factories/viewer.js` และทดสอบ path `ownsBusiness` จริง; ปรับ heuristic ของ `scripts/doc-preflight.mjs` ให้ตรวจจับ viewer literal ที่ไม่มี `role:` แต่มี property เฉพาะของ viewer อื่น (เช่น `isPlatformDev`, `isLocalDev`) ด้วย ไม่ใช่พึ่งพา `role:` เพียงอย่างเดียว |
| เกี่ยวข้อง | D3-line-agent-crm-flow-09, D3-integration-knowledge-document-intake-14 |
| การตรวจสอบ | critic-added |

##### D3-integration-knowledge-document-intake-11 — CustomerImportBatch producer is offline Python script

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | LOW |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | scripts/build_smartgift_customer_review_queue.py:20; backup-service.js:67,104 |
| สิ่งที่ควรเป็น | surface การป้อนข้อมูลควรผ่าน request lifecycle ของแอปตาม BR-009/SDD-009 |
| สิ่งที่เป็นจริง | เป็นภารกิจ backfill/migration ครั้งเดียวโดยชัดเจน; เป็นทางเลือกการออกแบบที่มีเหตุผลรองรับ |
| ข้อเสนอแนะ | ถ้าเป็นครั้งเดียวจริงไม่ต้องแก้; ถ้าจะทำซ้ำเรื่อย ๆ ให้ย้าย batch-materialization ไปอยู่หลัง authenticated route |
| เกี่ยวข้อง | 10 |
| การตรวจสอบ | CONFIRMED |

##### D3-integration-knowledge-document-intake-12 — MarketDashboard 'New Watch Rule' button is dead alert() stub

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | LOW |
| ประเภท | BUILT_NOT_DECLARED |
| หลักฐาน | src/modules/market-intelligence/components/MarketDashboard.jsx:92 |
| สิ่งที่ควรเป็น | CTA ของ feature ที่ ship แล้วควรทำงานได้จริง, ถูก disable ไว้, หรือไม่ render เลย |
| สิ่งที่เป็นจริง | ปุ่มยิง alert('New Watch Rule Modal') เปล่า ๆ แล้วไม่ทำอะไรต่อ |
| ข้อเสนอแนะ | รวมเข้ากับการแก้ finding 01: ปิดกั้นด้วย soon:true จนกว่าจะต่อสายจริง |
| เกี่ยวข้อง | 01 |
| การตรวจสอบ | verifier-added |

##### D3-integration-knowledge-document-intake-21 — หน้า Platform Integrations hardcode tenant UUID/code จริงไว้เป็นค่า fallback

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | LOW |
| ประเภท | BOUNDARY_VIOLATION (hygiene) |
| หลักฐาน | src/app/(pm)/platform/integrations/page.jsx:131 (`const tenantId = selectedBusiness?.tenant?.id \|\| '77cdbe70-3111-4a04-922a-8059be99a8b0'`) · :132 (`const tenantCode = selectedBusiness?.tenant?.code \|\| 'TNT-ETOHGROUP'`) |
| สิ่งที่ควรเป็น | หน้าที่รับข้อมูลจาก user ควรได้ tenant/scope มาจากการ resolve viewer จริงเท่านั้น ไม่ควรมี literal ของ tenant จริงฝังอยู่ใน client-side source ตามเจตนารมณ์ของ BR-002 ที่ว่า identity ต้องมาจากการ resolve ไม่ใช่ค่าคงที่ที่ฝังไว้ |
| สิ่งที่เป็นจริง | เมื่อยังไม่ได้เลือก business ตัวแปร `tenantId`/`tenantCode` ของหน้านี้จะ fallback ไปเป็น UUID และรหัส tenant จริงของลูกค้ารายหนึ่ง (`77cdbe70-...` / `TNT-ETOHGROUP`) ที่ถูกเขียนไว้ตรง ๆ ในซอร์สโค้ดฝั่ง client — เปราะบางต่อการเปลี่ยนแปลงข้อมูลจริง และเป็นการรั่วไหลของตัวระบุ tenant จริงเข้าไปในโค้ดที่ทุกคนเข้าถึงได้ |
| ข้อเสนอแนะ | เปลี่ยนค่า fallback ให้เป็นค่าว่างหรือ placeholder ทั่วไป (เช่น `''` หรือ `'TNT-UNSELECTED'`) แล้วปิดการใช้งานปุ่มที่ต้องการ tenantId/tenantCode จนกว่าจะมีการเลือก business จริง แทนการฝัง identifier ของลูกค้ารายจริงไว้เป็นค่าเริ่มต้น |
| เกี่ยวข้อง | — |
| การตรวจสอบ | critic-added |

##### D3-integration-knowledge-document-intake-13 — SotDataPlaneKey (FR-102) provisioning CLI-only unlike FR-106

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | INFO |
| ประเภท | PARTIAL |
| หลักฐาน | scripts/mint-sot-data-plane-key.mjs:1; src/app/api/platform/api-access-keys/route.js:16 |
| สิ่งที่ควรเป็น | N/A ถ้าตั้งใจ (น่าจะเป็นการออกแบบแบบ break-glass) |
| สิ่งที่เป็นจริง | operator ของ installation ที่ไม่มีสิทธิ์เข้าถึง shell ไม่มีทาง provision SoT key ได้เลย ต่างจาก FR-106/107 |
| ข้อเสนอแนะ | ถ้าตั้งใจ (น่าจะเป็นไปตาม SEC-019) ให้เพิ่มบันทึกสั้น ๆ ใน PRD; ถ้าไม่ตั้งใจ ให้เพิ่ม route สำหรับ operator เท่านั้น |
| เกี่ยวข้อง | — |
| การตรวจสอบ | verifier-added |

##### D3-integration-knowledge-document-intake-16 — ยืนยัน: POST /api/platform/integrations (LLM-provider/Vault-secret intake) เป็น flow ที่สมบูรณ์และตรงตาม BR-009/SDD-009 (positive verification)

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | INFO |
| ประเภท | PARTIAL (positive) |
| หลักฐาน | src/app/api/platform/integrations/route.js:22-25 (POST → createPhase1Integration) · src/modules/integration/application/integration-management-service.js:38-44 (`zCreate` เป็น `.strict()` + allow-list ของ provider) · :165-171 (parse → resolve → assertOwned → ปฏิเสธ secretRef ที่ไม่ใช่ Supabase Vault reference) · :173-227 (ทั้งหมดอยู่ใน `db.$transaction` เดียว: provider upsert, connection create, credential create, `recordAudit` PHASE1_METADATA_CREATED) · :127-163 (`listPhase1Integrations` เป็น read path ที่ scope ด้วย owned business อย่างถูกต้อง) · src/app/(pm)/platform/integrations/page.jsx:137-138 (read-back ผ่าน `useFetch('/api/platform/integrations...')`), :273 (จุดยิง POST จริงจาก UI) |
| สิ่งที่ควรเป็น | ตาม BR-009/SDD-009: surface ที่รับข้อมูลอ่อนไหว (ในกรณีนี้คือ provider/model/secretRef ของ LLM) ต้องผ่าน validate → authorization → single transaction → audit → อ่านกลับได้จริง |
| สิ่งที่เป็นจริง | ยืนยันด้วยการอ่านโค้ดโดยตรงว่า flow นี้ทำตามทุกขั้นตอนที่ BR-009/SDD-009 กำหนดไว้ครบถ้วน ไม่มีการข้ามขั้นตอนใดเลย นี่คือหนึ่งใน surface ที่อ่อนไหวที่สุดในทั้ง repo (owner พิมพ์ provider, model name และ secret reference แบบ `supabase-vault:<uuid>`) แต่กลับไม่เคยถูกลงบัญชีไว้ในหน่วยตรวจนี้เลยก่อนหน้านี้ |
| ข้อเสนอแนะ | ไม่มี — บันทึกไว้เป็นการยืนยันเชิงบวกในลักษณะเดียวกับ D3-line-agent-crm-flow-07 เพื่อไม่ให้ surface นี้ถูกมองข้ามว่ายังไม่ได้ตรวจสอบในรอบถัดไป |
| เกี่ยวข้อง | — |
| การตรวจสอบ | critic-added |

#### ข้อจำกัดการตรวจ

Finder read in full: 20+ key files covering intake/SoT pipeline/knowledge ingestion/market intelligence/customer import; verified by grep across src/tests/scripts for static call-site analysis. No runtime tracing; all "reachable only from tests" claims rest on import/grep evidence. Coverage ~40 inventory rows, 6 sub-flows. All 13 findings verified against actual files; 9 CONFIRMED, 2 ADJUSTED (07, 08 downgraded per documented boundaries ADR-046/FR-129), 2 verifier-added. No REFUTED findings.

**critic pass (เพิ่มเติมภายหลัง)** — ตรวจสอบ `src/modules/integration/application/line-registry-service.js`, `src/app/api/platform/integrations/{route.js,line-registry/route.js}`, `src/modules/integration/application/integration-management-service.js`, `src/app/(pm)/platform/integrations/page.jsx`, `src/platform/integrations/core/pipeline-tracking-service.js`, `docs/.viewer-fixture-baseline.json` และ `scripts/doc-preflight.mjs` ทั้งหมด — ไฟล์เหล่านี้ไม่อยู่ในขอบเขตที่ finder/verifier รอบแรกเปิดอ่านมาก่อน เพิ่ม 8 finding ใหม่ (14-21: 1 CRITICAL, 1 HIGH, 4 MEDIUM, 1 LOW, 1 INFO) ยืนยัน file:line ทุกจุดด้วยการอ่านไฟล์จริงก่อนบันทึก ไม่มี finding เดิมถูกตัดออกจากรอบนี้.

## business-pm-crud-forms

#### สรุปย่อ

- หน่วย business-pm-crud-forms ครอบคลุม 26 route.js ที่ให้บริการ CRUD สำหรับ Business Strategy (FR-041, FR-059), File Management (FR-045), People Directory (FR-042), Teams (FR-089), Scope Hierarchy (FR-001), Projects/Workstreams/Work Items (FR-003-007), และ Dependencies (FR-008) — ทั้งหมดนี้ผ่านการตรวจสอบว่าใช้ Zod validation, authorization gates, และ recordAudit
- ข้อมูลไหลตามปกติ: entry (route.js) → validate (Zod) → service layer (application/) → authorization check (assertBusinessOwned/assertProjectWritable/etc.) → prisma write + recordAudit → persist ✓
- ช่องโหว่สำคัญ: FileAsset writes ใช้ assertVisible แทน assertBusinessOwned (ทำให้ Member คนสามารถ mutate Business files ได้) และ FileAsset สามารถถูก delete ผ่านสอง routes ด้วยรูปแบบ authorization ต่างกัน
- ส่วน UI ขาด: FR-089 Teams backend สมบูรณ์ แต่ไม่มี form สร้าง/จัดการ Team ที่ไหน และ scope creators 5 ใน 7 (portfolio/tenant/business/legalEntity/branch) ไม่มี UI
- รูปแบบ atomicity: write + recordAudit เป็นสองคำสั่ง un-transacted ในส่วนใหญ่ของ CRUD services (ช่องโหว่ที่หาพบครั้งที่สาม ของ audit-trail gaps)
- Inventory ทั้งหมด: 26 routes, 0 prisma-bypass, OpenAPI documentation 100% match (107/107), schema parity SQLite↔Postgres complete

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|--------|---------|----------|
| Business Strategy read aggregation (FR-041) GET /api/business/strategy | IMPLEMENTED | src/app/api/business/strategy/route.js:14-19 | Read-only projection, no write endpoint |
| Business Goals CRUD + Goal↔Project link (FR-059) /api/business/goals/** | IMPLEMENTED | src/app/api/business/goals/[id]/route.js, .../[id]/projects/route.js | Zod + ownsBusiness + $transaction + recordAudit, UI wired ✓ |
| Business Roadmaps CRUD (FR-059) /api/business/roadmaps/** | IMPLEMENTED | src/modules/project-manager/application/business-strategy-mutation-service.js:269-439 | Horizon reconciliation with stable-key staging, wrapped in $transaction ✓ |
| Business Files aggregated read (FR-045) GET /api/business/files | IMPLEMENTED | src/app/api/business/files/route.js:13-19 | Read-only, correct |
| Managed FileAsset create/list/delete/content (FR-045) /api/files** | IMPLEMENTED | src/app/api/files/[id]/route.js | Zod + assertVisible (buggy — see finding 01) + recordAudit |
| FileAsset relink / reveal (FR-045) /api/files/[id]/relink, /reveal | IMPLEMENTED | src/app/api/files/[id]/relink/route.js | Reveal hardened (loopback-only, containment), relink buggy authorization |
| Local workspace mounts (FR-045 ADR-016 D5) /api/files/mounts | IMPLEMENTED | src/app/api/files/mounts/route.js | assertVisible (buggy — see finding 01) |
| File reconcile / cache rebuild (FR-045 ADR-016 D6) /api/files/reconcile, /cache/rebuild | IMPLEMENTED | src/app/api/files/reconcile/route.js | Preview/confirm + $transaction (reconcileLocalFiles only), authorization buggy |
| Legacy ProjectFile → FileAsset migration (ZV2-CR-001) POST /api/files/migrate | IMPLEMENTED | src/app/api/files/migrate/route.js | OWNER/DEV-only, no UI caller (ops tool) |
| Project Files bridge (FR-037) /api/projects/[id]/files** | IMPLEMENTED | src/app/api/projects/[id]/files/route.js | Correctly uses assertProjectWritable (ownsBusiness) for write |
| People Directory (FR-042) GET /api/people | IMPLEMENTED | src/app/api/people/route.js | Read-only composed view, no write by design |
| Team organisational grouping (FR-089) /api/teams, /api/teams/[id]/members, /api/projects/[id]/teams | PARTIAL | src/app/api/teams/route.js, src/modules/project-manager/application/team-service.js:419L | Backend complete + tested, **zero UI callers** — see finding 02 |
| Project Team / membership (FR-036) /api/projects/[id]/team | IMPLEMENTED | src/app/api/projects/[id]/team/route.js | Distinct from FR-089, wired to team/page.jsx, authorization fixed 2026-08-17 |
| Projects CRUD + archive (FR-003) /api/projects, /api/projects/[id] | IMPLEMENTED | src/app/api/projects/route.js | Zod + recordAudit, UI wired |
| Workstreams CRUD (FR-004) /api/workstreams, /api/workstreams/[id] | IMPLEMENTED | src/app/api/workstreams/route.js | recordAudit (un-transacted) |
| Work containers (FR-005) POST/PATCH /api/containers, /api/containers/[id] | IMPLEMENTED | src/app/api/containers/route.js | POST unused by UI (created via import pipeline), PATCH only |
| Work items CRUD (FR-005) /api/work, /api/work/[id] | IMPLEMENTED | src/app/api/work/route.js | recordAudit (un-transacted), UI wired |
| Milestones (FR-006) /api/milestones, /api/milestones/[id] | IMPLEMENTED | src/app/api/milestones/route.js | recordAudit (un-transacted) |
| Gates (FR-006) /api/gates, /api/gates/[id] | IMPLEMENTED | src/app/api/gates/route.js | recordAudit (un-transacted) |
| Dependencies (FR-007) /api/dependencies, /api/dependencies/[id], /api/projects/[id]/dependencies | IMPLEMENTED | src/app/api/dependencies/route.js | recordAudit (un-transacted), UI wired |
| Repositories + project link (FR-008/073) /api/repositories/**, /api/repositories/link/** | IMPLEMENTED | src/app/api/repositories/route.js | recordAudit (un-transacted) |
| Workspaces update/archive (FR-001) PATCH/DELETE /api/workspaces/[id] | IMPLEMENTED | src/app/api/workspaces/[id]/route.js | recordAudit (un-transacted) |
| Scope hierarchy creators (FR-001/020/074/075) POST /api/scope {entity: portfolio\|tenant\|business\|businessInGroup\|workspace\|legalEntity\|branch} | PARTIAL | src/app/api/scope/route.js:63-88 | 7 creators all implemented + Zod + authorized + audited, **only 2 have UI** (businessInGroup, workspace) — see finding 03 |
| Resolve external-ref/human-code lookup (FR-019) GET /api/resolve | IMPLEMENTED | src/app/api/resolve/route.js | Read-only, UI wired (DependenciesView.jsx) |
| Progress calculators (FR-010/011) GET /api/progress/project/[id], /workstream/[id], /portfolio | IMPLEMENTED | src/app/api/progress/project/[id]/route.js | Read-only pure calculators per CLAUDE.md rule |
| Audit read (FR-014) GET /api/audit | IMPLEMENTED | src/app/api/audit/route.js | Installation-operator-only, wired to audit/page.jsx |
| Profile (FR-038) GET /api/profile | IMPLEMENTED | src/app/api/profile/route.js | Read-only, language preference UI-localStorage-only (correctly labeled) |
| Route-level prisma bypass check across src/app/api | CLEAN | grep: zero direct writes via prisma in route.js files | All writes delegated to application/ services ✓ |
| OpenAPI documentation vs route.js files | COMPLETE | src/modules/project-manager/api-docs/openapi.js vs 107 route.js paths | 0 undocumented, 0 phantom routes ✓ |
| SQLite/Postgres schema parity | COMPLETE | prisma/schema.prisma vs prisma/schema.postgres.prisma | All models touched by this unit present in both ✓ |

#### Findings

##### D3-business-pm-crud-forms-01 — FileAsset/LocalWorkspaceMount writes authorize on Business visibility, not ownership — same bug class already fixed 3× elsewhere

| ฟิลด์ | รายละเอียด |
|--------|-----------|
| **ระดับ** | HIGH |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | `src/modules/project-manager/application/file-asset-service.js:52` assertVisible() checks visibleBusinessIds only (ไม่มี ownedBusinessIds) · `src/modules/project-manager/application/file-asset-service.js:90` createManagedFileAsset calls assertVisible + stages/promotes content to local mount · `src/modules/project-manager/application/file-asset-service.js:181` upsertLocalWorkspaceMount uses assertVisible · `src/modules/project-manager/application/file-asset-service.js:227` relinkFileAsset uses assertVisible · `src/modules/project-manager/application/file-asset-service.js:246` deleteManagedFileAsset uses assertVisible · `src/modules/project-manager/application/file-reconcile-cache-service.js:51` reconcileLocalFiles uses assertVisible, triggers scanLocalFiles + status flip · `src/modules/project-manager/application/file-reconcile-cache-service.js:76` rebuildBusinessFileCache uses assertVisible · `src/modules/project-manager/components/ManagedFilesPanel.jsx` zero grep matches for 'viewer' or 'isOwner' · `.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md:33` exact bug class fixed 3 times already (FR-059, FR-038, FR-061) · `src/modules/project-manager/application/team-service.js:117` contrast: loadTeamForWrite documents ownsBusiness explicitly citing this RCA · `src/modules/project-manager/application/project-authorization.js:190` contrast: assertProjectWritable requires ownsBusiness for every other project-manager write |
| **สิ่งที่ควรเป็น** | ตามกฎที่ codebase วางไว้แล้ว (FR-072, RCA 2026-08-16): operation ที่เขียนข้อมูลในขอบเขต Business ใดก็ตามต้องตรวจสอบด้วย ownsBusiness/ownedBusinessIds ไม่ใช่ visibleBusinessIds (ซึ่งเป็น read-path เท่านั้น) — Member ธรรมดาของ Business ที่มองเห็นได้ต้องไม่สามารถเขียนได้ |
| **สิ่งที่เป็นจริง** | ฟังก์ชันเขียนข้อมูลทั้ง 6 ตัว (createManagedFileAsset, deleteManagedFileAsset, relinkFileAsset, upsertLocalWorkspaceMount, reconcileLocalFiles, rebuildBusinessFileCache) ล้วนตรวจสอบสิทธิ์ด้วย assertVisible(businessId, visibleBusinessIds) เพียงอย่างเดียว UI panel (ManagedFilesPanel.jsx) ก็ไม่มี ownership gate ใด ๆ เพิ่มเติม Member คนใดก็ตามที่มองเห็น File Manager ของ Business นั้นสามารถ upload/delete/relink ไฟล์, เปลี่ยนจุด local workspace mount, หรือสั่งให้เกิดการไล่สแกนไฟล์ทั้งระบบ + rebuild cache ได้ ไม่มี test ใดสร้างกรณี Member ที่ไม่ใช่ owner พยายามเขียนข้อมูล — มีเพียง viewer แบบ OWNER เท่านั้นที่ถูกทดสอบ |
| **ข้อเสนอแนะ** | เพิ่ม ownsBusiness check ให้ครบทั้ง 6 ฟังก์ชัน (ตามรูปแบบ assertBusinessOwned ที่มีอยู่แล้วใน business-strategy-mutation-service.js) ปิดกั้นการควบคุมใน ManagedFilesPanel.jsx ด้วย viewer.ownedBusinessIds ตามรูปแบบ goal/roadmap ของ overview/page.jsx เพิ่ม Member-cannot-write test ตามรูปแบบ fr072-*-authorization.test.js นี่คือ defect class เดียวกับที่ Prevention #1 ของ RCA 2026-08-16 ('build fixtures through real resolver') ถูกเขียนขึ้นมาเพื่อป้องกันโดยตรง แต่กลับพลาดจุดนี้ไป |
| **เกี่ยวข้อง** | D3-business-pm-crud-forms-05 (FileAsset เดียวกัน สอง route สอง authorization level) |
| **การตรวจสอบ** | CONFIRMED — ตรวจสอบไฟล์โดยตรงยืนยันทุกบรรทัดและ trace path ที่อ้างถึง; ยืนยันด้วยว่า ManagedFilesPanel.jsx render โดยไม่มีเงื่อนไขทั้งบนหน้า /files และ /projects/[id]/files สำหรับ viewer คนใดก็ตามที่เปิดหน้าได้; ยืนยันช่องว่างของ test coverage (มีแค่ fixture แบบ OWNER) |

##### D3-business-pm-crud-forms-02 — FR-089 Team organisational grouping backend complete and marked done, but has no UI entry point

| ฟิลด์ | รายละเอียด |
|--------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | MISSING_SURFACE |
| **หลักฐาน** | `src/app/api/teams/route.js` GET/POST for list/create · `src/app/api/teams/[id]/members/route.js` POST/DELETE for TeamMembership · `src/app/api/projects/[id]/teams/route.js` POST/DELETE for ProjectTeam attach/detach · `src/modules/project-manager/application/team-service.js:195` listTeams/createTeam/addTeamMember/attachTeamToProject fully implemented (419 lines) · `docs/PRD-SDD-v1.0.md:299` FR-089 status marked '✅ implemented; models + BR-018 grants-nothing tests in tree' with no UI caveat · `src/modules/project-manager/application/projects-dashboard-read-model.js:561` Projects Dashboard KPI 'team count' computed from db.projectTeam distinct teamId — entirely dependent on rows nothing in UI can create · `docs/decisions/ADR-037-TEAM-IS-AN-ORGANISATIONAL-GROUPING-NOT-AN-AUTHORITY.md:117` defers 'whether Team tab should show real Teams' as future decision, but never notes zero create/manage UI exists |
| **สิ่งที่ควรเป็น** | FR-089 ถูกประกาศว่าเสร็จแล้ว และข้อมูลของมันถูกนำไปแสดงบน Dashboard KPI จริง (PRD-SDD-v1.0.md:296 ระบุ 'team count from FR-089' เป็นหนึ่งในสอง KPI ที่ Projects Dashboard รายงาน) |
| **สิ่งที่เป็นจริง** | grep ทั่ว src/app และ src/modules ไม่พบการอ้างอิง UI ถึง /api/teams, /api/teams/{id}/members หรือ /api/projects/{id}/teams เลย ไม่มีหน้าหรือคอมโพเนนต์ใดเรียก createTeam, addTeamMember, attachTeamToProject หรือ listTeams KPI บน Dashboard จะแสดงเป็น 0 สำหรับทุก Business จนกว่า operator จะเรียก raw API เองโดยตรง สิ่งนี้ต่างจาก FR-036 Project Team membership (ซึ่งมี UI ทำงานได้จริงที่ projects/[projectId]/team/page.jsx) — comment ใน header ของ route.js เองก็ระบุความแตกต่างนี้ไว้ชัดเจน |
| **ข้อเสนอแนะ** | เลือกทำอย่างใดอย่างหนึ่ง: (a) สร้าง UI ที่ถูกเลื่อนไว้ (หน้า Teams admin + control สำหรับ attach-to-project ให้สอดคล้องกับ FR-036 ตาม ADR-037 D5) หรือ (b) แก้สถานะ FR-089 ใน PRD-SDD-v1.0.md และข้อความ KPI บน Dashboard ให้ระบุว่าเป็น API/agent-only ในตอนนี้ แทนที่จะสื่อว่าเป็นตัวเลขที่ผู้ใช้จริงเป็นคนสร้างขึ้น |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED — ยืนยันว่า route.js ทั้งหมด implement ครบ 10 ฟังก์ชัน CRUD; ยืนยันความแตกต่างของการตั้งชื่อ route ระหว่าง FR-036 กับ FR-089 ในซอร์สโค้ด (comment ใน header ของ route.js ยืนยันการแบ่งแยกนี้เอง); ยืนยันว่า KPI อ่านจากตาราง ProjectTeam โดยตรง (ไม่มีทางป้อนข้อมูลเข้าได้เลย); ยืนยันว่าบรรทัดสถานะใน PRD ไม่มีข้อควรระวังเรื่อง UI |

##### D3-business-pm-crud-forms-03 — Scope hierarchy: 5 of 7 entity creators have no UI form despite FR-001 claiming full CRUD done

| ฟิลด์ | รายละเอียด |
|--------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | MISSING_SURFACE |
| **หลักฐาน** | `src/app/api/scope/route.js:63-88` CREATORS map exposes all 7 entity types (portfolio, tenant, business, businessInGroup, workspace, legalEntity, branch) · `src/modules/project-manager/application/scope-service.js:99` createPortfolio Zod + assertOperator, fully implemented · `src/modules/project-manager/application/scope-service.js:112` createTenant same pattern · `src/modules/project-manager/application/scope-service.js:125` createLegalEntity same pattern · `src/modules/project-manager/application/scope-service.js:145` createBusiness (direct) ownsTenant-gated, fully implemented · `src/modules/project-manager/application/scope-service.js:250` createBranch ownsBusiness-gated, fully implemented · `docs/PRD-SDD-v1.0.md:211` FR-001 row: '✅ จัดการ scope hierarchy: Portfolio / Tenant / Business / Branch / LegalEntity / Workspace (CRUD + human codes)' marked done, no UI-reachability caveat · `src/app/(pm)/settings/page.jsx` only UI caller uses entity: 'businessInGroup' · `src/app/(pm)/workspaces/page.jsx` only other UI caller uses entity: 'workspace' · `src/modules/people/application/people-service.js:31-47` People Directory displays membership.branch with no corresponding branch-creation form |
| **สิ่งที่ควรเป็น** | FR-001 ใน PRD ระบุว่า CRUD เสร็จสมบูรณ์ครบทั้งหกตัวของ scope primitives (Portfolio/Tenant/Business/Branch/LegalEntity/Workspace); CLAUDE.md วาง web app ไว้เป็น 'the back-office console for detail, complex edits and audit' |
| **สิ่งที่เป็นจริง** | grep หา `entity: '<name>'` พบว่ามีเพียง 'businessInGroup' (หน้า settings, workspace-home) และ 'workspace' (หน้า workspaces) เท่านั้นที่ถูก POST จาก UI จริง การสร้าง Portfolio, Tenant, Business (ตรง), LegalEntity และ Branch เป็น API-only ทั้งหมด — ไม่มี form ใดใน src/app เลยที่ operator หรือ Business owner จะใช้สร้างสิ่งเหล่านี้ได้ |
| **ข้อเสนอแนะ** | เลือกทำอย่างใดอย่างหนึ่ง: (a) สร้าง UI สำหรับ operator/admin (น่าจะอยู่ภายใต้ platform-control shell เพราะ portfolio/tenant/legalEntity ต้องการ assertOperator authority) หรือ (b) แก้บรรทัดสถานะ FR-001 ใน PRD และ A-api-spec.md ให้ระบุว่าทั้งห้ารายการนี้เป็น 'API-only, no UI' เพื่อไม่ให้สถานะ ✅ ถูกอ่านว่าเป็น CRUD ที่ครบวงจรจริง Branch ควรได้รับความสำคัญสูงสุดเพราะ People Directory แสดงข้อมูลนี้อยู่แล้วโดยไม่มีทางสร้างเลย |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED — ยืนยันด้วย grep ทั่ว repo หา `entity: '` (พบเฉพาะ workspace และ businessInGroup); ยืนยันว่าไม่มีหน้าใน (control) shell แตะ /api/scope เลย; ยืนยันว่า people-service คืนข้อมูล branch โดยไม่มี UI สำหรับสร้างมันคู่กัน |

##### D3-business-pm-crud-forms-05 — Same FileAsset row deletable via two routes with two different authorization postures (verifier-added)

| ฟิลด์ | รายละเอียด |
|--------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | `src/app/api/files/[id]/route.js:15` DELETE delegates to file-asset-service.js's deleteManagedFileAsset, which authorizes on assertVisible(visibleBusinessIds) only · `src/app/api/projects/[id]/files/[fileId]/route.js:15` DELETE delegates to project-file-service.js's deleteProjectFile, which calls assertProjectWritable(viewer, projectId) [ownsBusiness-gated] before updating the identical FileAsset row · `src/modules/project-manager/application/project-file-service.js:65-75` deleteProjectFile's asset branch performs the same soft-delete (db.fileAsset.update with deletedAt) but only after ownsBusiness check |
| **สิ่งที่ควรเป็น** | entity เดียว (FileAsset) ต้องถูกกำกับด้วยกฎ authorization เดียวเท่านั้น ไม่ว่า client จะใช้ URL ใดในการเขียนถึงมัน ตามเจตนารมณ์ 'one envelope, one pipeline' ของ BR-009/SDD-009 ที่ใช้กับ write target เดียวกัน |
| **สิ่งที่เป็นจริง** | Member (ที่ไม่ใช่ owner) ที่ถูกบล็อกที่ /api/projects/{id}/files/{fileId} ด้วย assertProjectWritable สามารถลบ FileAsset แถวเดียวกันนั้นได้ผ่าน /api/files/{id} แทน ซึ่งตรวจสอบด้วย assertVisible เท่านั้น ขอบเขต authorization จึงขึ้นอยู่กับว่า client เรียก route ใดในสอง route ที่มีอยู่จริง ไม่ได้ขึ้นอยู่กับ entity ที่ถูกกระทำเลย |
| **ข้อเสนอแนะ** | เมื่อฟังก์ชันใน file-asset-service.js ถูกแก้ให้ต้องใช้ ownsBusiness แล้ว (ตามคำแนะนำของ finding 01) ความไม่สอดคล้องนี้จะหายไปเอง แยกรายงานไว้ต่างหากเพื่อแสดงว่าบั๊กนี้เข้าถึงได้จริงวันนี้ผ่าน route ที่สองซึ่ง ship ไปแล้ว ไม่ใช่แค่สมมติฐาน |
| **เกี่ยวข้อง** | D3-business-pm-crud-forms-01 |
| **การตรวจสอบ** | verifier-added — พบระหว่างการ trace เส้นทาง mutation ของ FileAsset; ยืนยันแล้วว่าทั้งสอง route เขียนถึงแถวตารางเดียวกันด้วย authorization posture ที่ต่างกัน |

##### D3-business-pm-crud-forms-04 — Most CRUD writes record audit as separate, un-transacted statement — state change can lose audit trail on mid-flight crash

| ฟิลด์ | รายละเอียด |
|--------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | PARTIAL |
| **หลักฐาน** | `src/modules/project-manager/application/project-service.js:166` createProject: prisma write then separate recordAudit(prisma, ...) call, no $transaction · `src/modules/project-manager/application/project-team-service.js:123` addProjectTeamMember: db.membership.create then separate recordAudit(db, ...) · `src/modules/project-manager/application/work-service.js:59` createContainer: same two-step, un-transacted pattern · `src/modules/project-manager/application/milestone-gate-service.js:40` createMilestone: same pattern (also updateMilestone, createGate, updateGate all un-transacted) · `src/modules/project-manager/application/file-asset-service.js:236` relinkFileAsset: db.fileAsset.update then separate recordAudit(db, ...) · `src/modules/project-manager/application/business-strategy-mutation-service.js:291` Contrast: createRoadmap wraps create AND recordAudit in db.$transaction(async (tx) => {...}) — the safer pattern · `src/modules/project-manager/application/file-reconcile-cache-service.js:63-67` Contrast: reconcileLocalFiles also correctly uses db.$transaction for write+recordAudit |
| **สิ่งที่ควรเป็น** | CLAUDE.md: 'ทุกการเขียนต้องผ่านบริการใน application/ ซึ่งบันทึก audit event' — อ่านโดยธรรมชาติแล้วคือการรับประกันความคงทนว่าการเขียนที่สำเร็จแล้วต้องปรากฏใน audit stream เสมอ |
| **สิ่งที่เป็นจริง** | บริการ CRUD ส่วนใหญ่ของ project-manager (project, workstream, work, milestone, gate, dependency, repository, project-team, และ file-asset-service ส่วนใหญ่) เขียน entity และเรียก recordAudit เป็นสองคำสั่งอิสระที่ไม่อยู่ใน transaction เดียวกัน หากโปรเซส crash หรือเกิด error ระหว่างสองคำสั่งนี้ การเปลี่ยนแปลงจะถูก commit ไปแล้วแต่หายไปจาก audit trail อย่างถาวร — เป็น failure mode ตรงจุดที่ $transaction wrapper มีไว้ป้องกัน |
| **ข้อเสนอแนะ** | นำรูปแบบ db.$transaction(async (tx) => { ...write...; await recordAudit(tx, ...) }) ที่มีอยู่แล้วใน business-strategy-mutation-service.js มาใช้เป็นมาตรฐานสำหรับทุกฟังก์ชันเขียนใน application/ โดยให้ความสำคัญกับ path ที่ใช้งานบ่อยก่อน (project-service.js, work-service.js) นี่เป็นการปรับปรุงความคงทนของข้อมูล ไม่ใช่การแก้บั๊กที่กระทบการทำงานปกติ |
| **เกี่ยวข้อง** | D3-business-pm-crud-forms-06 |
| **การตรวจสอบ** | CONFIRMED — ตรวจสอบฟังก์ชันที่อ้างถึงทั้งหมดโดยตรง ยืนยันรูปแบบสองขั้นตอนนี้จริง; ตรวจสอบ business-strategy-mutation-service.js และ file-reconcile-cache-service.js เพื่อยืนยันว่ารูปแบบที่ถูกต้องมีอยู่แล้วและเป็นที่รู้จักในโค้ดเบสนี้อยู่ก่อน ไม่มีการบันทึกเจตนาว่าการไม่ใช้ transaction เป็นการออกแบบตั้งใจ และถ้อยคำของ CLAUDE.md บ่งชี้ว่าตั้งใจให้เป็นการรับประกันความคงทน |

##### D3-business-pm-crud-forms-06 — rebuildBusinessFileCache stages file and records audit as two independent statements (verifier-added)

| ฟิลด์ | รายละเอียด |
|--------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | PARTIAL |
| **หลักฐาน** | `src/modules/project-manager/application/file-reconcile-cache-service.js:90` rebuildBusinessFileCache: filesystemPort.promote(...) then separate, non-transactional recordAudit(db, ...) call · `src/modules/project-manager/application/file-reconcile-cache-service.js:63-67` Contrast: reconcileLocalFiles in SAME file wraps updateMany calls and recordAudit(tx, ...) in db.$transaction, correct pattern 25 lines above |
| **สิ่งที่ควรเป็น** | ควรมีวินัยเรื่อง transaction ที่สอดคล้องกันภายในไฟล์เดียวกัน ในเมื่อไฟล์นี้เองก็มีฟังก์ชันข้างเคียงที่ทำถูกต้องอยู่แล้ว |
| **สิ่งที่เป็นจริง** | audit event ของ rebuildBusinessFileCache สามารถหายไปได้หาก crash เกิดขึ้นระหว่าง filesystem promote กับการเรียก recordAudit ทั้งที่ฟังก์ชันที่อยู่เหนือขึ้นไปเพียงเล็กน้อยในไฟล์เดียวกัน (reconcileLocalFiles) แสดงให้เห็นแล้วว่ารูปแบบที่ปลอดภัยกว่านี้เป็นที่รู้จักและถูกใช้งานอยู่แล้ว |
| **ข้อเสนอแนะ** | ความสำคัญต่ำ — audit row ที่หายไปสำหรับการ rebuild cache (ซึ่งเป็น projection ที่ idempotent และสร้างใหม่ได้) มีความเสี่ยงต่ำกว่าการเขียนที่เปลี่ยนสถานะจริง จัดการร่วมกับคำแนะนำของ finding 04 คือห่อการบันทึก audit ให้สอดคล้องกัน อย่างน้อยที่สุดควรทำตามวินัย transaction แบบเดียวกับ reconcileLocalFiles ที่อยู่ด้านบนมัน |
| **เกี่ยวข้อง** | D3-business-pm-crud-forms-04 |
| **การตรวจสอบ** | verifier-added — พบระหว่างการตรวจสอบ file-reconcile-cache-service.js อย่างละเอียด และระบุความไม่สอดคล้องของรูปแบบระหว่างสองฟังก์ชันในไฟล์เดียวกัน |

#### ข้อจำกัดการตรวจ

finder ได้ตรวจสอบ 26 route.js files ที่ระบุไว้ในขอบเขต unit นี้ และเซอร์วิส application/ ทั้งหมดที่พวกเขา delegate ไป (business-strategy-service.js, business-strategy-mutation-service.js, file-asset-service.js, file-reconcile-cache-service.js, local-file-reveal-service.js, project-file-service.js, people-service.js, team-service.js, project-team-service.js, project-service.js, work-service.js, milestone-gate-service.js, dependency-service.js, repository-service.js, scope-service.js, progress-service.js, audit.js) · ตรวจสอบการ wire UI โดย grep ทุก page/component ภายใต้ src/app/(pm) และ src/modules/project-manager/components|views สำหรับแต่ละ API path · ยืนยันว่า route.js ทั้งหมด 107 ไฟล์ในทั้ง repo นี้ได้รับการ document ใน openapi.js (0 undocumented, 0 phantom) · ยืนยัน schema parity ระหว่าง SQLite/Postgres สำหรับทุกmodel ที่ unit นี้ใช้ · ตรวจสอบ RCA .brain/rca/2026-08-16-global-role-is-not-per-business-authority.md ที่สร้างสรรค์ ownsBusiness-vs-visibleBusinessIds rule และพบว่า file-asset-service.js และ file-reconcile-cache-service.js ไม่เคยอัพเดตตามข้อปรึกษา · **ไม่รวม scope ของ sibling units**: plan-import/envelope pipeline (/api/import/**, bundle/**), LINE/CRM conversation flows, identity/onboarding/workspace-memberships/auth surfaces, integration/knowledge document ingestion (/api/ingest/documents, /api/mcp) — อ่านเพียงพอที่จะยืนยันว่ามีอยู่และออกนอกขอบเขต · **ไม่ run test suite** (read-only per instructions) · **ไม่ trace runtime behavior** ใน live browser — สรุปทั้งหมด based on static analysis · **ไม่ independ verify** path-security.js หรือ filesystem-port.js internals นอกเหนือจากสิ่งที่ import ขึ้นมา (containment logic confirmed to exist; detailed attack-vector security verification deferred to dedicated security-focused pass) · **Count**: read ~45 source files in full or substantial part (26 route.js + 16 application/ services + 6 UI pages/components + 2 RCA/ADR + 2 Prisma schema files + openapi generator) plus ~15 targeted greps · **verifier** traced every route.js that calls into flagged services; added two narrow extensions (findings 05, 06) of finder's own discoveries rather than new territory; unit's authorization and transaction patterns verified clean elsewhere (dependency-service.js, repository-service.js, milestone-gate-service.js, project-file-service.js, business-strategy-mutation-service.js, audit read); no additional MISSING_SURFACE or DOC_DRIFT gaps beyond finder's scope-hierarchy and Team gaps found.

## ข้อเสนอแนะเรียงตามลำดับความสำคัญ

### ทำได้ทันทีในโค้ด (ไม่ต้องมี migration หรือ production gate)

1. แก้ `PlanModeCustomizerModal.jsx` (บรรทัด 189) และ `UploadPlanModal.jsx` (บรรทัด 55-59) ให้เรียก `POST /api/import/dry-run` แล้ว `POST /api/import/commit` แทน `/api/import/plan` ที่ไม่มีอยู่จริง; เพิ่ม `GET /api/businesses` และ `GET /api/workspaces` (หรือแก้ 4 คอมโพเนนต์ให้เรียก endpoint ที่มีอยู่แล้วแทน) เพื่อให้ business/workspace selector ของ modal เหล่านี้ใช้งานได้จริง พร้อมเพิ่ม integration test ครอบคลุมปุ่มทั้งสองบน `/work` — ปิด **D3-pm-plan-intake-01, D3-pm-plan-intake-04, D3-pm-plan-intake-05**
2. **(critic-added)** แก้ `listLineRegistry` ใน `src/modules/integration/application/line-registry-service.js` ให้ fallback ไปยัง `viewer.ownedBusinessIds` เมื่อไม่มี `businessId` (คืน `[]` ทันทีถ้าว่าง) ตามรูปแบบเดียวกับ `listPhase1Integrations` แทนที่จะสร้าง `where` clause ที่ไม่มี tenant/business predicate เลย — ปิดช่องโหว่ cross-tenant read leak **D3-integration-knowledge-document-intake-14**
3. **(critic-added, ข้าง item เดิม 2)** แก้การเรียก `recordAudit` ใน `saveLineGroup`/`saveLineUser` (`line-registry-service.js`) ให้ตรง signature `recordAudit(db, options)` แทนการส่ง object เดียว และเพิ่ม `recordAudit` ในทั้ง 5 write site ของ `src/modules/identity/plugin-auth-service.js` (บรรทัด 160, 189, 223, 350, 476) ตามรูปแบบ `mintWorkspaceInvite`/`mintPasswordReset` — ปิด **D3-integration-knowledge-document-intake-15, D3-identity-onboarding-forms-03**
4. แก้ `src/app/api/agent/heartbeat/route.js`: แก้ `@req`/`@tested` ให้ถูกต้อง (หรือประกาศ FR ใหม่), เพิ่ม session/operator authorization, ย้ายจาก in-memory Map ไปเป็น Prisma model, เพิ่ม `recordAudit` — ปิด **D3-line-agent-crm-flow-05, D3-line-agent-crm-flow-09**
5. เปลี่ยน 6 ฟังก์ชันใน `file-asset-service.js` และ `file-reconcile-cache-service.js` จาก `assertVisible` เป็น `assertBusinessOwned`/`ownsBusiness` ตามรูปแบบ `project-authorization.js`; เพิ่ม Member-cannot-write test ตามรูปแบบเดียวกับ `fr072-*-authorization.test.js` — ปิด **D3-business-pm-crud-forms-01, D3-business-pm-crud-forms-05**
6. เพิ่ม rate limiter (นำ `src/modules/identity/signup-rate-limit.js` มาปรับใช้) กับ `POST /api/auth/login` — ปิด **D3-identity-onboarding-forms-10**
7. ห่อ write+recordAudit ด้วย `db.$transaction` ในบริการที่ยังไม่ทำ (project-service.js, work-service.js, milestone-gate-service.js, project-team-service.js, file-reconcile-cache-service.js:90, และ `line-registry-service.js`'s saveLineGroup/saveLineUser เมื่อแก้ item 2-3 แล้ว) ตามแบบ `business-strategy-mutation-service.js`/`createPhase1Integration` ที่มีอยู่แล้ว — ปิด **D3-business-pm-crud-forms-04, D3-business-pm-crud-forms-06, D3-integration-knowledge-document-intake-18**
8. เพิ่ม `GET /api/platform/api-access-keys` (list) + หน้า UI mint/list/revoke — ปิด **D3-identity-onboarding-forms-06**
9. เพิ่มปุ่ม "รีเซ็ตรหัสผ่าน" ต่อแถวใน `/platform/users/page.jsx` เรียก endpoint ที่มีอยู่แล้ว (`POST /api/platform/users/password-resets`) — ปิด **D3-identity-onboarding-forms-05**
10. ปิดใช้งานหรือทำปุ่ม "New Watch Rule" ใน `MarketDashboard.jsx` (บรรทัด 92) ให้ disabled/coming-soon แทนการยิง `alert()` — ปิด **D3-integration-knowledge-document-intake-12**
11. แก้ `docs/TRACE.md` ไม่ให้อ้าง `StandaloneTaskModal.jsx` เป็นหลักฐาน FR-017 ที่ขัดแย้งกันเอง; พิจารณาเพิ่ม preflight check ตรวจ self-contradicting trace entries — ปิด **D3-pm-plan-intake-03**
12. **(critic-added)** เขียน `tests/unit/line-registry-service.test.js` ใหม่ให้ใช้ `makeViewer()`/`ownsElsewhere()` จาก `tests/factories/viewer.js` แทน viewer ที่สร้างขึ้นมือ และลบ escape hatch `isPlatformDev`/`isLocalDev` ออกจาก `assertScope` (ไม่มี viewer จริงในระบบใช้มันได้อยู่แล้ว) — ปิด **D3-integration-knowledge-document-intake-20**
13. **(critic-added)** เอาค่า fallback tenant UUID/code จริง (`77cdbe70-3111-4a04-922a-8059be99a8b0` / `TNT-ETOHGROUP`) ออกจาก `src/app/(pm)/platform/integrations/page.jsx:131-132` เปลี่ยนเป็นค่าว่าง/placeholder ทั่วไป — ปิด **D3-integration-knowledge-document-intake-21**

### ต้องมี migration/production gate

14. ขยาย transaction ของ `erase-principal.js` ให้ redact/ลบ `Message.body` และ `RawExternalRecord` ของบุคคลที่ถูกลบ และเพิ่ม authorized route หรือ CLI script (เช่น `scripts/erase-principal.mjs`) ให้เรียกใช้งานได้จริงนอก test — ปิด **D3-line-agent-crm-flow-03, D3-line-agent-crm-flow-08, D3-identity-onboarding-forms-08** (FR-022)
15. เพิ่ม service+route+UI สำหรับ suspend/reactivate `Membership.status` (ต้องพิจารณา migration ถ้าจะ track `suspendedBy`/`suspendedAt`) หรือแก้ถ้อยคำ FR-095 ให้ตรงกับพฤติกรรม hard-delete จริงในปัจจุบัน — ปิด **D3-identity-onboarding-forms-04** (Issue #99)
16. เพิ่ม production entry point (route หรือ MCP tool) ให้ `ingestKnowledgeDocument` (FR-109) ถูกเรียกใช้งานจริงในเส้นทางที่ผู้ใช้ควบคุมได้ ไม่ใช่แค่ test — ปิด **D3-integration-knowledge-document-intake-02**
17. สร้าง acquisition surface จริง (scraper/webhook/upload route) ที่ผลิต `RawExternalRecord` แล้วเรียก `translateAndPersistRawMarketRecord` เพื่อให้ `MarketObservation` มีข้อมูลจริงก่อนจะต่อ `/market` UI เข้ากับข้อมูลจริง — ปิด **D3-integration-knowledge-document-intake-05, D3-line-agent-crm-flow-04**
18. เพิ่ม apply step ที่แปลง DECIDED customer review case (CREATE_SEPARATE/LINK_EXISTING) ให้เป็น `Customer` row จริงในฐานข้อมูล — ปิด **D3-integration-knowledge-document-intake-10**
19. Wire `reapExpiredPluginAuthRecords` เข้ากับ scheduled task/cron จริง (หรือหลังจากแก้ heartbeat route ในข้อ 4 แล้วใช้ route นั้นเป็น trigger) — ปิด **D3-identity-onboarding-forms-09**
20. **(critic-added)** แยก `connectionKind` ของ LINE Registry ออกจาก Phase 1 LINE channel ใน `integration-management-service.js` (ตัดสินด้วย `purpose` แทนการเช็คแค่ provider code) เพื่อไม่ให้แถวสมุดรายชื่อผู้ติดต่อปนเข้าไปในการคำนวณ `health` ของ FR-080/AC-075.3 — ปิด **D3-integration-knowledge-document-intake-17**
21. **(critic-added)** เพิ่ม control บน `PipelineMonitorPanel` (mode-bodies.jsx บรรทัด 266) ให้ operator ยิง `POST .../replay` ได้จริงจาก UI หรือระบุไว้ชัดเจนว่าเป็น API/operator-tool-only แยกจากแถว Inventory ของ route อื่น — ปิด **D3-integration-knowledge-document-intake-19**

### ต้องการการตัดสินใจจากเจ้าของผลิตภัณฑ์

22. ตัดสินใจสถานะ `/market`: พลิก `src/config/domains.js:55` เป็น `soon: true` จนกว่าข้อ 17 จะเสร็จ หรือเร่ง priority ให้ผูก `MarketDashboard.jsx` กับ `MarketObservation` จริงโดยเร็ว — ปิด **D3-integration-knowledge-document-intake-01**
23. ตัดสินใจ UX สำหรับการเพิ่ม staff ใหม่เข้า Business ที่มีอยู่ (ให้ WorkspaceInvite สร้าง Business-level Membership ด้วยหรือไม่ หรือเปลี่ยน query `availablePeople` ของ Team tab) รวมถึงออกแบบ UI สำหรับ invite mint/revoke/remove และ self-service "leave workspace" — ปิด **D3-identity-onboarding-forms-12, D3-identity-onboarding-forms-01, D3-identity-onboarding-forms-13**
24. ตัดสินใจว่า `StandaloneTaskModal` ควรเป็น exception ที่บันทึกไว้อย่างเป็นทางการใน FR-005/FR-017 (พร้อมปรับ PRD row) หรือควรสร้างใหม่ให้เรียก dry-run/commit ตาม envelope pipeline — ปิด **D3-pm-plan-intake-02**
25. ทบทวนและแก้ถ้อยคำสถานะ PRD ของ FR-089 (Team UI), FR-001 (scope hierarchy: 5/7 creators ไม่มี UI), FR-076 (RoleBinding assignment), FR-107 (PlatformGrant revoke/list) ให้ระบุชัดว่า "API-only ไม่มี UI" แทนสถานะ ✅/🟢 ที่อาจถูกอ่านผิดว่าใช้งานได้ end-to-end แล้ว — ปิด **D3-business-pm-crud-forms-02, D3-business-pm-crud-forms-03, D3-identity-onboarding-forms-07, D3-identity-onboarding-forms-11**

## ภาคผนวก ก — รายการที่ถูกตัดออกหลังตรวจสอบ

ทั้ง 5 หน่วยรายงาน `dropped=[]` — ไม่มี finding ใดถูกตัดออก (REFUTED) ในกระบวนการ verify ของมิตินี้ finder ทั้ง 5 unit ส่ง finding ทุกรายการผ่านการตรวจสอบของ adversarial verifier และไม่มีรายการใดถูกพิสูจน์ว่าไม่จริงหรือไม่เกี่ยวข้อง

อย่างไรก็ตาม มี finding จำนวนหนึ่งที่ verifier **ปรับ (ADJUSTED)** ระดับความรุนแรงหรือกรอบการจัดประเภทจากที่ finder รายงานไว้เดิม (ไม่ใช่การตัดออก แต่บันทึกไว้เพื่อความโปร่งใส):

- **D3-line-agent-crm-flow-05**: ปรับจาก HIGH/DOC_DRIFT ขึ้นเป็น CRITICAL/BOUNDARY_VIOLATION หลังยืนยันว่าเป็นช่องโหว่ความปลอดภัยที่ใช้งานได้จริง ไม่ใช่แค่การอ้างอิงเอกสารผิด
- **D3-line-agent-crm-flow-01**: ปรับจาก MEDIUM ลงเป็น LOW หลังยืนยันว่า `resolvePhase1RequestScope` และ `line-binding-resolver.js` มี fail-closed authentication อยู่แล้วในเส้นทาง production จริง โค้ด HMAC ที่ไม่ถูกเรียกใช้เป็นเพียง dead code ไม่ใช่ช่องโหว่ที่เปิดอยู่
- **D3-identity-onboarding-forms-04**: ปรับกรอบ/ยืนยันเป็น MEDIUM/DECLARED_NOT_BUILT ให้สอดคล้องกับ finding โครงสร้างเดียวกันอื่น ๆ ในหน่วยเดียวกัน (05/06/08/09) — ส่วน enforcement build ครบและ integration-test ผ่านแล้ว ขาดแค่ admin actuator
- **D3-integration-knowledge-document-intake-07**: ปรับจาก HIGH ลงเป็น LOW เพราะ boundary "apply เป็นความรับผิดชอบภายนอก" มีบันทึกไว้ชัดเจนใน ADR-046 D2.1 อยู่แล้ว
- **D3-integration-knowledge-document-intake-08**: ปรับจาก MEDIUM ลงเป็น LOW เพราะ boundary "Tier-1 ไม่ execute เอง" มีบันทึกไว้ชัดเจนใน FR-129(d) อยู่แล้ว

## ภาคผนวก ข — ข้อจำกัดของการวิเคราะห์

การวิเคราะห์มิตินี้เป็นการวิเคราะห์แบบ **static เท่านั้น** — ไม่มีการรัน server, ไม่มีการเข้าถึง production, ไม่มีการ trace runtime behavior ในเบราว์เซอร์จริง ข้อสรุปทั้งหมดอิงจากการอ่านซอร์สโค้ด, การ grep หา call site, และการยืนยันไฟล์/บรรทัดโดยตรง (ไม่มีการรัน `npm test`, `npm run build`, หรือ `npm run govern` ตามข้อกำหนดของภารกิจ read-only) สถานะที่ระบุใน `docs/PRD-SDD-v1.0.md` ถูกยึดถือตามที่ระบุไว้ (taken at face value) **ยกเว้น**กรณีที่โค้ดจริงขัดแย้งกับสถานะนั้นอย่างชัดเจน (เช่น FR-080/heartbeat misattribution, FR-017/StandaloneTaskModal) ซึ่งจะถูกรายงานเป็น DOC_DRIFT หรือยกระดับความรุนแรงตามความเหมาะสม

ข้อจำกัดเฉพาะหน่วยที่รวมมาจากรายงานย่อยแต่ละหน่วย:

- **pm-plan-intake**: ไม่ได้เปิดแบบเต็ม prisma/schema.prisma, xlsx-template.js, external-ref.js, business-strategy-mutation-service.js (อ้างอิงผ่าน call site เท่านั้น), plan-schema.js semantic validation ส่วนลึก; ยืนยันไฟล์ทดสอบด้วยการ `ls` ไม่ได้เปิดอ่านทีละบรรทัด
- **line-agent-crm-flow**: ไม่ได้เปิดเต็มบรรทัดสำหรับ action-gate.js, msp-memory-port.js บางส่วน; claim ทั้งหมดเรื่อง "reachable only from tests" อิงหลักฐานจาก import/grep เท่านั้น ไม่ใช่การ trace runtime จริง; ไม่ได้ diff full column list ของ Prisma model เกินกว่าการยืนยันว่ามี model นั้นอยู่จริง
- **identity-onboarding-forms**: ไม่ได้เปิด/อ่านสมบูรณ์ LINE identity-linking modules, agent/tool IAM modules เต็มบรรทัด, และ CRM/customer-consent flows (มอบหมายให้หน่วย line-agent-crm-flow ตามขอบเขตงานที่แบ่งไว้); ไม่ได้เปิด src/lib/db-boundary.js และ full profile-permission-service test file; อ่าน feature-note markdown บางไฟล์ผ่าน grep เท่านั้นไม่ใช่การอ่านเต็มไฟล์
- **integration-knowledge-document-intake**: coverage ครอบคลุม ~40 inventory row ผ่าน 20+ ไฟล์หลักที่อ่านเต็ม บวก grep แบบ static call-site analysis ข้าม src/tests/scripts; claim "reachable only from tests" ทั้งหมดอิงหลักฐานจาก import/grep เท่านั้น ไม่มี runtime tracing
- **business-pm-crud-forms**: ไม่ได้ตรวจสอบภายในของ path-security.js หรือ filesystem-port.js อย่างละเอียด (containment logic ยืนยันว่ามีอยู่ แต่การตรวจสอบ attack-vector เชิงลึกเลื่อนไปเป็นงาน security-focused แยกต่างหาก); ขอบเขตชัดเจนตัดสิ่งที่เป็นของหน่วยอื่นออก (plan-import/envelope pipeline, LINE/CRM flows, identity/onboarding/auth surfaces, integration/knowledge document ingestion)

ทุกหน่วยยืนยันร่วมกันว่า: ไม่มีการรัน test suite ใด ๆ ระหว่างการวิเคราะห์ (ยึดตามกฎ read-only), และการอ้างว่าโค้ดใด ๆ "untested"/"reachable only from tests" อิงจากการมีอยู่ของไฟล์ทดสอบและ `@tested` annotation เท่านั้น ไม่ใช่การรันจริง
