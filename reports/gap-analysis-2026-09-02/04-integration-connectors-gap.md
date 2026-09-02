# มิติที่ 4 — Connectors ใน Integration: catalog ↔ adapter ↔ credential ↔ health ↔ ingestion ↔ scheduler ↔ tests ↔ production evidence

| ฟิลด์ | ค่า |
|---|---|
| รายงาน | มิติที่ 4 — Connectors ใน Integration: catalog ↔ adapter ↔ credential ↔ health ↔ ingestion ↔ scheduler ↔ tests ↔ production evidence |
| วันที่ | 2026-09-02 |
| ขอบเขต | สำรวจ connector, provider, port และระบบภายนอกทุกรายการที่ผลิตภัณฑ์ zuri-ai กล่าวถึงหรือพึ่งพา สำหรับแต่ละรายการ ระบุว่าอะไรมีอยู่จริงในเรโพนี้ (โค้ด adapter, รายการใน registry, เส้นทาง credential, การคำนวณ health, การ ingestion/replay, scheduler, UI, tests) และอะไรเป็นเพียงไทล์ใน catalog, ADR เชิงออกแบบที่ยังไม่อนุมัติให้สร้าง, หรือความรับผิดชอบของเรโพภายนอก (MSP/GKS/GenesisBlockDB/zuri-cli) จากนั้นระบุช่องว่างเชิงธรรมาภิบาล (governance) รอบเลนของ connector — การกำหนดสิทธิ์, การจัดการวงจรชีวิต (lifecycle), ความสอดคล้องของ enum/id, และความเที่ยงตรงของเอกสารต่อโค้ดจริง |
| วิธีการ | finder → adversarial verifier → section → assemble → critic; แบ่งเป็น 3 หน่วยตรวจ (in-repo-connectors, external-ports, connector-governance) ทำงานคู่ขนานแล้วประกอบรวม; หลักฐานทุกชิ้นอ้างอิงเป็น file:line จากเรโพจริงที่ HEAD ณ วันที่ 2026-09-02 (ไม่มีการอนุมาน) ต่อด้วยรอบ critic ตรวจสอบว่าทุก finding ที่อยู่ใน section ปรากฏในตารางสรุปรวม |
| แหล่งอ้างอิงหลัก | docs/PRD-SDD-v1.0.md, docs/roadmap/ROADMAP.md, docs/domains/integration/CHARTER.md, docs/domains/integration/features/FR-079/080/081/099/100/101/125/129/130, docs/INTERFACE-INVENTORY.md, docs/TRACE.md, docs/DOMAIN-MAP.md, docs/decisions/ADR-031/032/035/038/039/046/050/053, docs/.preflight-report.json |
| ความสัมพันธ์กับเอกสารเดิม | docs/GAP-ANALYSIS-ZURI-GOVIBE.md เป็นเอกสารเปรียบเทียบข้ามระบบ (zuri-ai ↔ GoVibe) ระดับ cross-system — ไม่ใช่ขอบเขตของรายงานนี้ รายงานฉบับนี้ตรวจสอบเฉพาะภายในเรโพ zuri-ai (in-repo) เท่านั้น ไม่ทับซ้อนขอบเขตและไม่คัดลอกเนื้อหาจากเอกสารดังกล่าว จะอ้างอิงถึงกันเฉพาะเมื่อจำเป็นต่อการอธิบายขอบเขต |

## บทสรุปผู้บริหาร

แพลตฟอร์ม integrations ของ zuri-ai มีโครงสร้างที่ครบถ้วนในระดับไลบรารี — connector catalog, contract การ ingest, secret manager แบบ pluggable, connection health, และ pipeline-tracking ledger ล้วนมีโค้ดจริงและมี unit/integration test รองรับ — แต่เมื่อไล่ตามเส้นทางจาก "โค้ดมีอยู่" ไปจนถึง "ใช้งานได้จริงใน production" กลับพบช่องว่างเชิงโครงสร้างที่ร้ายแรงหลายจุด ที่สำคัญที่สุดคือ runtime การผลิตจริง (PRODUCTION_LINE) อ่านข้อมูลการเชื่อมต่อจากตาราง Postgres คนละตารางกับที่ UI ของผลิตภัณฑ์เขียนเข้าไป (**D4-in-repo-connectors-01**) ทำให้การเชื่อมต่อที่ operator สร้างผ่านหน้าเว็บไม่มีทางถูก runtime มองเห็นได้เลย และในทำนองเดียวกัน หน่วยความจำระยะยาวของ agent (MSP) และการอ่านกราฟความรู้ (GKS) ก็มีโค้ดที่ทดสอบผ่านแล้วแต่ไม่เคยถูกต่อสายเข้ากับเส้นทาง production เดียวที่มีอยู่จริง (**D4-external-ports-01, -02, -03, -08**) ทั้งที่ FR-029/FR-024 ถูกทำเครื่องหมายว่า ✅ แบบไม่มีข้อกังขาในเอกสาร PRD-SDD ซึ่งเป็นการลอยของเอกสาร (doc drift) ที่ผิดรูปแบบเดียวกับที่ FR-057/079/080/081 ระมัดระวังไว้แล้ว พอร์ต production gate เปิดอยู่อีกจุดที่รายงานฉบับแรกไม่เคยกล่าวถึงคือ plugin authorization port (`/api/plugin/auth/**`, ADR-052/FR-123) ซึ่งต่อสายกับ route จริงครบทั้ง authorize/token/capabilities/revoke พร้อม consent screen แล้ว แต่ PRD-SDD เองระบุ 🟠 ว่า production Supabase migration, การลงทะเบียน client และหลักฐานด้าน device-binding ยังถูก gate อยู่ (**D4-external-ports-10**)

ด้านความปลอดภัยและการแบ่งขอบเขตผู้เช่า (tenant boundary) พบข้อบกพร่องระดับ CRITICAL สองจุดในหน่วย connector-governance: ฟังก์ชัน `recordAudit()` ถูกเรียกด้วย signature ผิดในทุกการสร้าง/แก้ไข LINE group และ LINE user ทำให้ audit event ไม่เคยถูกบันทึกจริง (**D4-connector-governance-03**) และ `listLineRegistry` คืนข้อมูล LINE group/user ของ **ทุกผู้เช่า** เมื่อไม่ระบุ `businessId` ซึ่งขัดกับ BR-002/SEC-001 โดยตรง (**D4-connector-governance-13**) เส้นทาง `/api/agent/heartbeat` ก็ไม่มีการตรวจสอบสิทธิ์หรือขอบเขตผู้เช่าเลย ใครก็ตามที่รู้ URL สามารถลบทะเบียนอุปกรณ์ของทุกธุรกิจได้ในคำขอเดียว (**D4-connector-governance-15**)

ในเชิงความครบถ้วนของ catalog: จาก 11 ไทล์ connector มีเพียง `line-oa` เท่านั้นที่มี adapter + health + หลักฐานการใช้งานจริงใน production ส่วน `openrouter` และ `google-gemini` ใช้เส้นทาง MODEL_PROVIDER ทั่วไปเส้นทางเดียวกัน (`model-provider.js`) โดย health มาจาก supabase-vault reference ที่วางด้วยมือ และไม่มีหลักฐานการใช้งานจริงใน production ในเรโพนี้เลย ส่วนที่เหลืออีก 8 ไทล์ (Slack, Notion, Microsoft 365, Vercel webhook, Gmail alerts, Google Calendar, Google Drive, GitHub) เป็น `providerCodes: []` ที่ยังไม่มี adapter ใดๆ — ซึ่งเอกสารของ catalog เองยอมรับตรงไปตรงมาว่านี่เป็นการแก้ไขความไม่ซื่อสัตย์ของสถานะเดิม (FR-130) จึงไม่ใช่ doc drift แต่ OpenRouter OAuth (PKCE) กลับเป็นกรณีตรงข้าม — มีโค้ดสมบูรณ์ ผ่านการทดสอบ RCA-hardened แต่ไม่มี route หรือปุ่ม UI ใดเรียกใช้เลย ขณะที่ PRD-SDD ระบุว่า "Phase 1 active — owner-approved" (**D4-in-repo-connectors-02 / D4-external-ports-04**) เช่นเดียวกับ adapter การดึงข้อมูลตลาด (marketplace-listing-adapter, retail-price-adapter) ที่มีรูปแบบ payload เข้ากันไม่ได้กับ envelope มาตรฐานและไม่มีผู้เรียกนอกเทสต์ของตัวเอง (**D4-in-repo-connectors-03**)

ช่องว่างเชิงธรรมาภิบาลอื่นที่ควรเฝ้าระวัง ได้แก่ ตัวตนผู้ให้บริการ LINE ที่แยกเป็นสองรหัส ('line-oa' vs 'LINE_OA') ทำให้ LINE Registry มองไม่เห็นจาก catalog/health (**D4-in-repo-connectors-05 / D4-connector-governance-04**), automation "daily report" ของ LINE Group ที่ผู้ใช้เปิดใช้งานผ่าน UI ได้แต่ไม่มี scheduler ใดทำงานจริงเบื้องหลัง (**D4-connector-governance-14**), โมเดล 3 รายการ (SyncCursor, ExternalEntityRef, DeadLetterRecord) ที่ charter อ้างสิทธิ์แต่ไม่มีผู้เขียนเลย (**D4-in-repo-connectors-06 / D4-connector-governance-05**), และการชนกันของชื่อ enum `GATE_STATUSES` ที่ให้ค่าคนละความหมายในสองไฟล์ (**D4-connector-governance-10**) การทดสอบ cross-repo กับ zuri-cli ที่พิสูจน์ BR-011 ก็ไม่เคยรันใน CI จริง เป็นเพียง opt-in ที่ไม่มีใครเปิดสวิตช์ (**D4-external-ports-05**)

**ข้อสรุปโดยรวม**: มิตินี้อยู่ในสถานะ "โครงสร้างไลบรารีสมบูรณ์ แต่จุดต่อเข้า production ยังขาดอย่างเป็นระบบ" (CRITICAL 4 รายการ, HIGH 10 รายการ จากทั้งหมด 40 finding — รวม 7 finding ที่ critic เพิ่มเข้ามาหลังการตรวจครั้งแรก) รูปแบบที่พบซ้ำมากที่สุดคือ "โค้ดมีอยู่ ผ่านเทสต์ แต่ไม่มี caller/route ใน production" ซึ่งเกิดขึ้นทั้งในระดับ connector ในเรโพ (OpenRouter OAuth, market adapters, promote/rotate) และในระดับพอร์ตภายนอก (MSP memory, GKS knowledge, GenesisBlockDB write) — นี่ไม่ใช่ปัญหาของโค้ดแต่ละไฟล์ แต่เป็นช่องว่างเชิงระบบระหว่าง "สิ่งที่ build" กับ "สิ่งที่ wiring เข้า production factory" ซึ่งควรได้รับการแก้ไขก่อนที่จะประกาศสถานะ ✅ เพิ่มเติมใน PRD-SDD สำหรับ requirement ใดๆ ที่พึ่งพาพอร์ตเหล่านี้

## ตารางสรุปตามหน่วยตรวจ

| หน่วย | รายการที่ตรวจ | CRITICAL | HIGH | MEDIUM | LOW | INFO | สถานะโดยรวม |
|---|---|---|---|---|---|---|---|
| in-repo-connectors | 48 | 1 | 2 | 5 | 3 | 0 | เสี่ยงสูง — จุดต่อ production ขาดหายอย่างเป็นระบบ (raw-SQL vs Prisma table mismatch) |
| external-ports | 24 | 1 | 5 | 4 | 1 | 0 | เสี่ยงสูง — MSP/GKS/GenesisBlockDB มีแต่ library ที่ไม่ถูกต่อสายเข้า production route เดียวที่มี; ยังพบ production gate เปิดอยู่อีกจุดที่ critic เพิ่มเข้ามา (plugin auth, FR-123) |
| connector-governance | 25 | 2 | 3 | 10 | 3 | 0 | เสี่ยงสูงมาก — พบข้อบกพร่องด้าน audit และ tenant isolation ที่ยืนยันแล้วเป็นจริง (CONFIRMED) |
| **รวม** | **97** | **4** | **10** | **19** | **7** | **0** | — |

## ตารางสรุปช่องว่างทั้งหมด

| ID | ระดับ | ประเภท | หัวข้อ | หน่วย |
|---|---|---|---|---|
| D4-in-repo-connectors-01 | CRITICAL | BROKEN_FLOW | Production runtime อ่านตาราง integration_connection ที่ไม่มีโค้ดใดในเรโพเขียนเข้าไป | in-repo-connectors |
| D4-external-ports-01 | CRITICAL | PRODUCTION_GATE_OPEN | FR-029 ทำเครื่องหมายเสร็จ (✅) แต่ production ไม่เคยต่อ MSP memory — ทุกเทิร์นใช้ in-memory ชั่วคราว | external-ports |
| D4-connector-governance-03 | CRITICAL | BROKEN_FLOW | recordAudit() ถูกเรียกผิด signature ใน line-registry-service.js — audit ของ LINE group/user ล้มเหลวเงียบทุกครั้ง | connector-governance |
| D4-connector-governance-13 | CRITICAL | BOUNDARY_VIOLATION | listLineRegistry คืนข้อมูล LINE group/user ของทุกผู้เช่าเมื่อไม่ระบุ businessId | connector-governance |
| D4-in-repo-connectors-02 | HIGH | DOC_DRIFT | OpenRouter OAuth (PKCE) ถูกประกาศ "Phase 1 active" ใน PRD แต่ไม่มี route/UI ใดเรียกใช้ | in-repo-connectors |
| D4-in-repo-connectors-03 | HIGH | DECLARED_NOT_BUILT | Adapter/repository การดึงข้อมูล Market Intelligence ไม่เชื่อมกับสิ่งใดใน production เลย | in-repo-connectors |
| D4-external-ports-02 | HIGH | PRODUCTION_GATE_OPEN | GenesisBlockDB knowledge reader (createGraphKnowledgeReader) ไม่เคยถูกต่อเข้า production LINE turn | external-ports |
| D4-external-ports-03 | HIGH | DOC_DRIFT | สถานะ ✅ ของ FR-029 เป็น doc drift ต่อช่องว่างการต่อสายจริงใน D4-01/D4-02 | external-ports |
| D4-external-ports-05 | HIGH | TEST_GAP | Test เดียวที่พิสูจน์ cross-repo LINE contract กับ zuri-cli ไม่เคยรันใน CI (opt-in ที่ไม่มีใครเปิด) | external-ports |
| D4-external-ports-08 | HIGH | PRODUCTION_GATE_OPEN | เส้นทางเขียน/projection ของ GenesisBlockDB (FR-024) ไม่มีผู้เรียกใน production เลย | external-ports |
| D4-external-ports-10 | HIGH | PRODUCTION_GATE_OPEN | Plugin authorization port (/api/plugin/auth/**, FR-123) มี production gate เปิดอยู่จริงที่รายงานไม่เคยกล่าวถึง | external-ports |
| D4-connector-governance-04 | HIGH | BOUNDARY_VIOLATION | LINE Group/User ใช้รหัสผู้ให้บริการ 'line-oa' ขณะที่ส่วนอื่นใช้ 'LINE_OA' — ตัวตนแยกกันสองแบบ | connector-governance |
| D4-connector-governance-14 | HIGH | BROKEN_FLOW | LINE Group 'daily report' automation เก็บสถานะได้ครบใน UI/DB แต่ไม่มี scheduler/executor ใดทำงานจริง | connector-governance |
| D4-connector-governance-15 | HIGH | BOUNDARY_VIOLATION | /api/agent/heartbeat ไม่มีการตรวจสอบสิทธิ์และไม่มีขอบเขตผู้เช่า/ธุรกิจ | connector-governance |
| D4-in-repo-connectors-04 | MEDIUM | MISSING_SURFACE | Connection promotion และ credential rotation มีโค้ด CAS/versioning ถูกต้องแต่ไม่มีเส้นทางเรียกใช้จากผลิตภัณฑ์ | in-repo-connectors |
| D4-in-repo-connectors-05 | MEDIUM | BOUNDARY_VIOLATION | ตัวตนผู้ให้บริการ "LINE Official Account" สองแบบที่แยกกันโดย catalog มองไม่เห็นอีกฝั่ง | in-repo-connectors |
| D4-in-repo-connectors-06 | MEDIUM | DECLARED_NOT_BUILT | SyncCursor, ExternalEntityRef, DeadLetterRecord ที่ charter อ้างสิทธิ์ไม่มีผู้เขียนใดๆ เลย | in-repo-connectors |
| D4-in-repo-connectors-07 | MEDIUM | MISSING_SURFACE | ไม่มี route/page/script ใดสร้าง connection LINE_OA หรือ SMARTGIFT_DOCUMENT_INTAKE ได้ทั่วไป | in-repo-connectors |
| D4-in-repo-connectors-11 | MEDIUM | DOC_DRIFT | ChannelIdentity (FR-094/FR-097) ซึ่งผูก external subject ของ LINE เข้ากับ Person จริงในการทำงาน ไม่มีแถว Inventory ในรายงานนี้เลย | in-repo-connectors |
| D4-external-ports-04 | MEDIUM | MISSING_SURFACE | OpenRouter OAuth+PKCE มีโค้ดสมบูรณ์และผ่านเทสต์ แต่ไม่มี API route หรือ UI trigger ใดๆ | external-ports |
| D4-external-ports-06 | MEDIUM | TEST_GAP | ไม่มีการตรวจสอบอัตโนมัติว่า schema.postgres.prisma และ 0001_init.sql ยัง sync กับ schema.prisma | external-ports |
| D4-external-ports-09 | MEDIUM | DOC_DRIFT | MCP server port (/api/mcp) ไม่ปรากฏในรายงานนี้เลย ทั้งที่เป็นพอร์ต machine-to-machine เดียวและเป็นผู้บริโภคจริงของ FR-071 ledger | external-ports |
| D4-external-ports-11 | MEDIUM | DOC_DRIFT | zuri-edge-device (ADR-041) และ omni-channel dispatcher (ADR-044) ไม่เคยถูกระบุเป็นระบบภายนอกในรายงานนี้ | external-ports |
| D4-connector-governance-01 | MEDIUM | MISSING_SURFACE | LINE_OA channel connection ไม่มี application-code creation path — เรียกได้จาก test เท่านั้น | connector-governance |
| D4-connector-governance-02 | MEDIUM | DECLARED_NOT_BUILT | /platform/integrations ไม่มี action disable/rotate/revoke/promote/delete/test-connection | connector-governance |
| D4-connector-governance-05 | MEDIUM | DECLARED_NOT_BUILT | SyncCursor/ExternalEntityRef/DeadLetterRecord ถูกประกาศเป็น owns_models แต่ zero writer | connector-governance |
| D4-connector-governance-06 | MEDIUM | BROKEN_FLOW | PipelineReconciliation.evidenceJson ถูก hardcode เป็น '{}' โดยไม่สนใจ input ของผู้เรียก | connector-governance |
| D4-connector-governance-07 | MEDIUM | MISSING_SURFACE | ไม่มี authorization policy ว่าใครมีสิทธิ์ลงนาม PipelineGateDecision และไม่มี route สร้าง APPROVED decision | connector-governance |
| D4-connector-governance-08 | MEDIUM | MISSING_SURFACE | FR-071 pipeline run ledger (steps/gates/gateCompliance/reconciliation) ไม่มีผู้บริโภคฝั่ง browser เลย | connector-governance |
| D4-connector-governance-10 | MEDIUM | BOUNDARY_VIOLATION | GATE_STATUSES ถูก export สองชุดค่าที่ไม่เหมือนกันจากสองไฟล์คนละโดเมน | connector-governance |
| D4-connector-governance-16 | MEDIUM | MISSING_SURFACE | FR-102 SotDataPlaneKey ไม่มีแถว Inventory หรือ finding ใดๆ mint/revoke ได้เฉพาะจาก CLI เท่านั้น | connector-governance |
| D4-connector-governance-17 | MEDIUM | MISSING_SURFACE | FR-106 ApiAccessKey มี route mint/revoke แต่ไม่มีผู้บริโภคฝั่ง browser เลย | connector-governance |
| D4-connector-governance-18 | MEDIUM | TEST_GAP | heartbeat route ติด @tested ชี้ไปยัง test file ที่ไม่มีการอ้างอิงถึง heartbeat เลย — หลักฐานการทดสอบเท็จ | connector-governance |
| D4-in-repo-connectors-08 | LOW | MISSING_SURFACE | 3 ใน 5 LLM provider ที่เชื่อมต่อได้จริงไม่มีไทล์ catalog ของตัวเอง | in-repo-connectors |
| D4-in-repo-connectors-09 | LOW | MISSING_SURFACE | CONNECTION_KINDS มีเพียง CHANNEL และ MODEL_PROVIDER — ไม่มี DATA_SOURCE สำหรับ connector แบบดึงข้อมูล | in-repo-connectors |
| D4-in-repo-connectors-10 | LOW | TEST_GAP | LOCAL_FILE secret backend's write method ถูกเรียกเฉพาะในเทสต์ของตัวเองเท่านั้น | in-repo-connectors |
| D4-external-ports-07 | LOW | TEST_GAP | Python test suite ของสคริปต์ data-migration SmartGift ไม่เคยถูกรันโดย gate อัตโนมัติใดๆ | external-ports |
| D4-connector-governance-09 | LOW | DOC_DRIFT | Frontmatter ของ FR-099/FR-100/FR-101 ยังเป็น 'proposed' ทั้งที่ PRD-SDD และโค้ดระบุว่าสร้างเสร็จแล้ว | connector-governance |
| D4-connector-governance-11 | LOW | MISSING_SURFACE | Adapter market-source ตาม ADR-038 D3 เป็นฟังก์ชัน formatting 2 ตัวที่ไม่มีใครเรียกและไม่อยู่ใน charter's Public contracts | connector-governance |
| D4-connector-governance-12 | LOW | DOC_DRIFT | /api/agent/heartbeat/route.js ติด @req FR-080 ผิด ทำให้ TRACE.md ของ FR-080 ปนเปื้อนหลักฐาน | connector-governance |

## รายละเอียดตามหน่วยตรวจ

## in-repo-connectors

### in-repo-connectors

#### สรุปย่อ

- หน่วย in-repo-connectors สำรวจแพลตฟอร์ม integrations โดยรวม 11 ไทล์ใน CONNECTOR_CATALOG พร้อมตัวเลือกเครื่องจักร/โช่ข้อมูล 5 รายการ กับสตริมสัญญา adapter/credential/health ตั้งแต่ workflow-intake จนถึงการเบิกจ่ายแบบ raw-ingestion ตามที่คาดหวังโดย BR-009/SDD-009/FR-081
- ความครบถ้วน: เฉพาะ `line-oa` เท่านั้นที่มี adapter + health check + หลักฐานการใช้งานจริงใน production; `openrouter` และ `google-gemini` ใช้เส้นทาง MODEL_PROVIDER ทั่วไปเส้นทางเดียวกัน (`model-provider.js`) โดยไม่มีหลักฐานการใช้งานจริงใน production เลย ส่วนที่เหลืออีก 8 ไทล์ถูกประกาศไว้เท่านั้น (DECLARED_ONLY, `providerCodes: []`) เช่น Slack, Notion, Microsoft 365
- ช่องว่างที่สำคัญที่สุด: PRODUCTION_LINE runtime ใช้ raw SQL ที่เลือก `zuri_core.integration_connection` แต่ไม่มีโค้ดใด ๆ ในที่เก็บนี้สร้าง/เขียนข้อมูลไปยังตารางนั้น; การสร้างการเชื่อมต่อแบบมนุษย์เพียงอย่างเดียวเขียนเข้าไปในตาราง Prisma-mapped ของสกีมา default ซึ่งแตกต่างกันโดยพื้นฐาน
- OpenRouter OAuth มีการเชื่อมต่ออย่างสมบูรณ์ แต่ไม่มีเส้นทางหรือหน้า UI ใดใน src/app ที่เรียกใช้ — ผู้ใช้สามารถเชื่อมต่อได้เท่านั้นโดยการวาง raw key ลงในแบบฟอร์ม Phase 1 ทั่วไป
- แบบจำลอง 3 รายการในอ้อมขอบเขตของ charter (SyncCursor, ExternalEntityRef, DeadLetterRecord) มีผู้เขียน/ผู้สร้าง 0 รายการทุกที่; การแทรก Marketplace/Retail และ SMARTGIFT_DOCUMENT_INTAKE ด้านเดียวคือ hand-written migration หรือการสร้างแบบไม่ได้ใช้มาตรฐาน
- ความสามารถในการทำให้สุขภาพดี: CONNECTION_KINDS ประกาศเฉพาะ CHANNEL และ MODEL_PROVIDER เท่านั้น; ไม่มี DATA_SOURCE ที่ร่าง FR-092/BR-019 และ FR-125 ขาดรูปแบบสำหรับการเชื่อมต่อแบบดึงข้อมูล

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|-------|--------|---------|
| src/platform/integrations/core/connector-catalog.js — 11-tile CONNECTOR_CATALOG + deriveConnectorStatus/deriveConnectorCatalog | IMPLEMENTED | src/platform/integrations/core/connector-catalog.js:73-193,203-249 | State is computed (never a stored literal); tested tests/unit/platform/connector-catalog.test.js and tests/e2e/fr130-connector-catalog.spec.js |
| src/platform/integrations/core/integration-registry.js — connection selection, provider registration, connection/credential/ingestion-run writers, LINE_OA resolution, promotion | PARTIAL | src/platform/integrations/core/integration-registry.js:1-300 | resolvePhase1PrimaryConnection (Prisma) and resolvePhase1PrimaryConnectionByQuery (raw SQL vs zuri_core.integration_connection) both exist but are never selected by the same code path in production — see finding 01. registerIntegrationProvider/createIntegrationConnection/promotePhase1PrimaryConnection/upsertIntegrationCredentialMetadata have zero callers under src/app or scripts (finding 04, 07) |
| src/platform/integrations/core/contracts.js — zIngestionEnvelope, createIngestionEnvelope, DATA_LANES | IMPLEMENTED | src/platform/integrations/core/contracts.js:1-83 | MARKET_INTELLIGENCE lane declared (line 25) but never set as a value by any producer in src/ (grep 0 hits) |
| src/platform/integrations/core/raw-ingest-service.js — ingestRawExternalRecord idempotent write | IMPLEMENTED | src/platform/integrations/core/raw-ingest-service.js:1-46 | Called by line-oa-webhook.js, line-oa-evidence.js, cloud-sot-agent.js. Not called by marketplace/retail adapters (finding 03) |
| src/platform/integrations/core/raw-record-repository.js — scope-bound RawExternalRecord repository | IMPLEMENTED | src/platform/integrations/core/raw-record-repository.js:1-101 | Reused by market-intelligence's wrapper (finding 03) and cloud-sot-agent.js |
| src/platform/integrations/core/idempotency.js — stableStringify/hashPayload/buildIdempotencyKey | IMPLEMENTED | src/platform/integrations/core/idempotency.js:1-35 | marketplace/retail adapters compute a DIFFERENT, incompatible idempotency hash instead of importing this module (finding 03) |
| src/platform/integrations/core/secret-manager.js — RUNTIME_SOURCES, SecretManagerError, file-vault + Supabase-vault adapters, createSecretManagerPort | IMPLEMENTED | src/platform/integrations/core/secret-manager.js:1-186 | Tested tests/unit/fr079-runtime-cutover.test.js, fr080-supabase-vault.test.js |
| src/platform/integrations/core/credential-vault.js — AES-256-GCM file vault (dev/test only) | IMPLEMENTED | src/platform/integrations/core/credential-vault.js:1-125 | Explicitly forbidden for PRODUCTION_LINE by secret-manager.js:115-117 |
| src/platform/integrations/core/connection-health.js — evaluateConnectionHealth, CONNECTION_KINDS | IMPLEMENTED | src/platform/integrations/core/connection-health.js:1-153 | CONNECTION_KINDS is only ['CHANNEL','MODEL_PROVIDER'] (line 29) — no DATA_SOURCE kind (finding 09) |
| src/platform/integrations/core/document-intake-contract.js — SMARTGIFT_DOCUMENT_INTAKE contract/allowlist | IMPLEMENTED | src/platform/integrations/core/document-intake-contract.js:1-50 | Consumed by cloud-sot-agent.js |
| src/platform/integrations/core/cloud-sot-agent.js — stageDocumentIntake / stageDocumentIntakeForPipeline / listDocumentIntakeRecords | PARTIAL | src/platform/integrations/core/cloud-sot-agent.js:195-433; src/app/api/ingest/documents/route.js | Route exists for staging/listing; no route or script anywhere CREATES the SMARTGIFT_DOCUMENT_INTAKE IntegrationConnection except one hand-written migration hardcoded to one Business UUID (finding 07) |
| src/platform/integrations/core/pipeline-tracking-contract.js + pipeline-tracking-service.js — FR-071/FR-129/FR-110 execution ledger, requestPipelineReplay | IMPLEMENTED | src/platform/integrations/core/pipeline-tracking-service.js:757-902 | This is the FR-071 knowledge/SoT pipeline replay surface, distinct from FR-081's own (still-unbuilt) raw-ingestion scheduler/replay — do not conflate the two |
| src/platform/integrations/llm/provider-catalog.js — LLM_PROVIDER_CATALOG (5 entries) | IMPLEMENTED | src/platform/integrations/llm/provider-catalog.js:1-31 | All 5 PUBLIC_LINE_PROVIDERS have presentation metadata; only 2 of the 5 have a CONNECTOR_CATALOG tile (finding 08) |
| src/platform/integrations/providers/line/line-oa-webhook.js — LINE_OA connector: signature verify, normalize, ingestWebhook | IMPLEMENTED | src/platform/integrations/providers/line/line-oa-webhook.js:1-237 | createLineOaWebhookConnector itself is reachable only from tests (per FR-081 doc's own note); the live path goes through line-oa-evidence.js reusing normalizeLineWebhookEvent |
| src/platform/integrations/providers/line/line-oa-evidence.js — createLineOaEvidenceRecorder, live wiring to /api/agent/line-webhook | IMPLEMENTED | src/platform/integrations/providers/line/line-oa-evidence.js:1-87; src/app/api/agent/line-webhook/route.js:4 | Writes RawExternalRecord for provider LINE_OA; never opens an IngestionRun per FR-081 doc's own admission; DeadLetterRecord unwritten on failure |
| src/modules/agent/model-provider.js — createModelProviderPort for openrouter/openai/anthropic/gemini/groq/ollama | IMPLEMENTED | src/modules/agent/model-provider.js:1-166 | Ollama gated to LOCAL_DEV/TEST/EVAL and loopback-only (lines 84-113) |
| src/modules/agent/openrouter-oauth.js — OpenRouter Authorization Code + PKCE flow | PARTIAL | src/modules/agent/openrouter-oauth.js:1-43; src/modules/agent/index.js:28 | Fully implemented and unit-tested, but zero route/page anywhere calls createOpenRouterAuthorization/exchangeOpenRouterCode (finding 02) |
| src/modules/integration/adapters/marketplace-listing-adapter.js — formatMarketplaceListingRawRecord | DECLARED_ONLY | src/modules/integration/adapters/marketplace-listing-adapter.js:1-58 | Zero callers outside its own file and its own unit test (finding 03) |
| src/modules/integration/adapters/retail-price-adapter.js — formatRetailPriceRawRecord | DECLARED_ONLY | src/modules/integration/adapters/retail-price-adapter.js:1-61 | Zero callers outside its own file and its own unit test (finding 03) |
| src/modules/integration/application/integration-management-service.js — listPhase1Integrations / createPhase1Integration, health projection | IMPLEMENTED | src/modules/integration/application/integration-management-service.js:1-228 | Backs GET/POST /api/platform/integrations; writes the Prisma-mapped IntegrationConnection table that PRODUCTION_LINE's runtime resolver never reads (finding 01) |
| src/modules/integration/application/line-registry-service.js — LINE group/user registry (listLineRegistry/saveLineGroup/saveLineUser) | IMPLEMENTED | src/modules/integration/application/line-registry-service.js:1-283 | Uses provider code 'line-oa' (lowercase), a second, catalog-invisible identity from LINE_OA_PROVIDER_CODE='LINE_OA' (finding 05) |
| CONNECTOR_CATALOG tile: line-oa (LINE Official Account) | IMPLEMENTED | src/platform/integrations/core/connector-catalog.js:74-83 | providerCodes:['LINE_OA']; adapter, health and production ingestion evidence all exist; connection creation UI/route does not (finding 07) |
| CONNECTOR_CATALOG tile: openrouter (OpenRouter LLM) | PARTIAL | src/platform/integrations/core/connector-catalog.js:84-93 | Model port + OAuth module exist; OAuth unreachable (finding 02); connection created only via generic Phase1 form requiring a pre-existing manual Supabase Vault secretRef |
| CONNECTOR_CATALOG tile: slack | DECLARED_ONLY | src/platform/integrations/core/connector-catalog.js:94-103 | providerCodes:[]; no adapter anywhere in src/ |
| CONNECTOR_CATALOG tile: notion | DECLARED_ONLY | src/platform/integrations/core/connector-catalog.js:104-113 | providerCodes:[]; no adapter anywhere in src/ |
| CONNECTOR_CATALOG tile: microsoft-365 | DECLARED_ONLY | src/platform/integrations/core/connector-catalog.js:114-123 | providerCodes:[]; no adapter anywhere in src/ |
| CONNECTOR_CATALOG tile: google-gemini | IMPLEMENTED | src/platform/integrations/core/connector-catalog.js:124-136 | providerCodes:['gemini']; same MODEL_PROVIDER path as openrouter, manual vault secretRef only |
| CONNECTOR_CATALOG tile: vercel-webhook | DECLARED_ONLY | src/platform/integrations/core/connector-catalog.js:137-147 | Catalog entry itself documents no Vercel webhook endpoint in this system |
| CONNECTOR_CATALOG tile: gmail-alerts | DECLARED_ONLY | src/platform/integrations/core/connector-catalog.js:148-157 | providerCodes:[]; no adapter anywhere in src/ |
| CONNECTOR_CATALOG tile: google-calendar | DECLARED_ONLY | src/platform/integrations/core/connector-catalog.js:158-167 | providerCodes:[]; no adapter anywhere in src/ |
| CONNECTOR_CATALOG tile: google-drive | DECLARED_ONLY | src/platform/integrations/core/connector-catalog.js:168-177 | providerCodes:[]; no adapter anywhere in src/ |
| CONNECTOR_CATALOG tile: github | DECLARED_ONLY | src/platform/integrations/core/connector-catalog.js:178-192 | Catalog entry itself documents no GitHub API access; FR-130 blocked on PII attestation |
| PUBLIC_LINE_PROVIDERS: openai, anthropic, groq (model providers with no catalog tile) | PARTIAL | src/modules/agent/model-provider.js:7; src/platform/integrations/llm/provider-catalog.js:10-16; src/app/(pm)/platform/integrations/page.jsx:1201-1202 | Fully supported by the model port and reachable from the shared MODEL_SETTINGS dropdown, but absent from CONNECTOR_CATALOG's 2 AI_MODELS tiles (finding 08) |
| LOCAL_EVAL_PROVIDERS: ollama | OUTSIDE_REPO | src/modules/agent/model-provider.js:8,84-113; src/platform/integrations/core/connection-health.js:64 | Correctly excluded from the catalog by design — local/dev/test evaluation provider only, not a public/production connector (ADR-031 D4) |
| IntegrationProvider row: 'line-oa' (lowercase, LINE Registry groups/users) | PARTIAL | src/modules/integration/application/line-registry-service.js:62,119-129,206-215 | A second, catalog-invisible provider identity distinct from 'LINE_OA' (finding 05); not seeded anywhere, created lazily on first saveLineGroup/saveLineUser call |
| IntegrationProvider row: SMARTGIFT_DOCUMENT_INTAKE | PARTIAL | supabase/migrations/20260820212547_smartgift_document_intake_connection.sql:21-36 (provider upsert), :41-62 (connection INSERT) | Not in the 11-tile catalog at all; provisioned in production by one hand-written migration hardcoded to a single Business/Tenant UUID, not by any general-purpose script or UI (finding 07) |
| Prisma model IntegrationProvider — seed coverage | MISSING | prisma/seed.js (0 matches for integrationProvider) | No demo/dev seed data; every provider row is created lazily on first connection creation |
| Prisma model IngestionRun — writers | PARTIAL | src/platform/integrations/core/integration-registry.js:279-300; src/platform/integrations/core/cloud-sot-agent.js:224-231,262-277 | Only createIngestionRun (SMARTGIFT_DOCUMENT_INTAKE path) writes it; LINE_OA webhook evidence deliberately leaves ingestionRunId null (FR-081 doc, 'Still not closed by this') |
| Prisma model RawExternalRecord — writers | PARTIAL | src/platform/integrations/core/raw-record-repository.js:98; src/platform/integrations/core/cloud-sot-agent.js:258-261 | Only 2 providers actually reach this table in production: LINE_OA (via line-oa-evidence.js) and SMARTGIFT_DOCUMENT_INTAKE (via cloud-sot-agent.js). Market-intelligence lane never writes here (finding 03) |
| Prisma model SyncCursor — writers | MISSING | prisma/schema.prisma:1666-1686; grep for .create/.update/.upsert on syncCursor across src/ = 0 hits | Charter-owned model with zero producers anywhere; doc-acknowledged as out of FR-081 scope (finding 06) |
| Prisma model ExternalEntityRef — writers | MISSING | prisma/schema.prisma:1688-1715; grep for .create/.update/.upsert on externalEntityRef across src/ = 0 hits | Charter-owned model with zero producers anywhere (finding 06) |
| Prisma model DeadLetterRecord — writers | MISSING | prisma/schema.prisma:1717-1746; grep for .create/.update/.upsert on deadLetterRecord across src/ = 0 hits | Charter-owned model with zero producers anywhere; doc-acknowledged in FR-081's own 'Still not closed by this' section (finding 06) |
| Scheduler / pull-adapter surface for FR-081 | MISSING | grep -rln 'scheduler\|cron' src/platform/integrations src/modules/agent src/modules/integration = 0 hits; docs/domains/integration/features/FR-081-raw-external-ingestion.md 'Not in scope' section | Confirmed not started, matching briefing |
| zuri_core.integration_provider / integration_connection / integration_credential (hardened RLS Postgres tables, distinct from Prisma-mapped tables) | MISSING | supabase/migrations/20260818040000_phase1_line_runtime_connections.sql:25-67 (three CREATE TABLE statements); src/platform/integrations/core/integration-registry.js:64-90; grep for INSERT into these tables anywhere in repo = 0 hits | Table exists (DDL applied) but is never populated by any code path in this repo — critical to finding 01 |
| Connection promotion path (promotePhase1PrimaryConnection) | DECLARED_ONLY | src/platform/integrations/core/integration-registry.js:171-212 | Zero callers outside tests/agent/index.js re-export (finding 04) |
| Credential rotation path (upsertIntegrationCredentialMetadata) | DECLARED_ONLY | src/platform/integrations/core/integration-registry.js:147-169 | Zero callers outside tests (finding 04); also records no audit event even in isolation |
| CONNECTION_KINDS taxonomy (CHANNEL, MODEL_PROVIDER only — no DATA_SOURCE) | PARTIAL | src/platform/integrations/core/connection-health.js:29 | POST /api/platform/integrations only ever creates MODEL_PROVIDER-purpose connections (integration-management-service.js:38-44); no route or kind exists for a pure data-pull connector (finding 09) |
| ChannelIdentity / ExternalRef (FR-094/FR-097) — BR-002 external-id binding for LINE | PARTIAL | prisma/schema.prisma:446,1078; src/modules/identity/{channel-identity,resolve-line-identity,link-line-identity}.js; src/modules/agent/auth-context.js | Live, wired-through mapping distinct from the Integration charter's ExternalEntityRef (finding 06); PRD-SDD 🟠 — "ChannelIdentity lifecycle implemented and wired through webhook/turn/ingest with integration tests" (finding 11) |

#### Findings

##### D4-in-repo-connectors-01 — Production LINE/LLM runtime reads a connection table that nothing in this repo ever writes

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | CRITICAL |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | src/modules/agent/phase1-runtime.js:187 (resolveConnection branches on integrationDb); src/app/api/agent/line-webhook/route.js:83 (runtimeFactory() called with zero arguments); src/app/api/agent/line-delivery/route.js:54 (same); src/platform/integrations/core/integration-registry.js:78 (raw SQL selects from zuri_core.integration_connection); supabase/migrations/20260818040000_phase1_line_runtime_connections.sql:36 (CREATE TABLE zuri_core.integration_connection — physically separate from Prisma default-schema); src/modules/integration/application/integration-management-service.js:193 (writes via tx.integrationConnection.create — the Prisma ORM table); prisma/schema.postgres.prisma:1547 (no @@schema/@map on IntegrationConnection; repo-wide `grep -c "@@schema" prisma/schema.postgres.prisma` = 0, so every Prisma model lands in the default `public` schema) |
| สิ่งที่ควรเป็น | ADR-031/FR-079 อธิบายว่ามี Phase-1 connection เดียวที่ resolve จาก trusted binding scope; charter ของ FR-080 ระบุว่า /platform/integrations คือ 'this domain's surface' สำหรับจัดการ connection นั้น connection ที่ operator สร้างผ่านหน้าดังกล่าวควรเป็นตัวเดียวกับที่ PRODUCTION_LINE resolve ได้ตอน conversation time |
| สิ่งที่เป็นจริง | การ grep ทั้งเรโพหา INSERT/create/upsert ใดๆ ต่อ zuri_core.integration_connection / zuri_core.integration_provider / zuri_core.integration_credential ให้ผลลัพธ์เป็นศูนย์ — การอ้างอิงเดียวใน src/ คือ SELECT แบบอ่านอย่างเดียวภายใน resolvePhase1PrimaryConnectionByQuery ทุกเส้นทางสร้าง connection ที่เข้าถึงได้จริง (POST /api/platform/integrations, line-registry-service.js, migration ของ SmartGift document-intake) กลับเขียนเข้าตาราง Prisma-mapped default-schema แทนทั้งหมด ในโหมด PRODUCTION_LINE runtime factory เลือกสาขา raw-SQL เสมอ จึงไม่มีทางเห็นแถวที่ถูกสร้างผ่าน UI ของผลิตภัณฑ์เองได้เลย |
| ข้อเสนอแนะ | ทำได้สองทาง: (ก) ทำให้เส้นทาง create/promote/rotate ของ FR-080 เขียนเข้า zuri_core.integration_connection/_provider/_credential โดยตรง (หรือผ่านการ sync ที่มีเอกสารรองรับ) หรือ (ข) เปลี่ยน resolvePhase1PrimaryConnectionByQuery ให้ query ตาราง Prisma-mapped แทน พร้อมเพิ่ม integration test ที่ขับ POST /api/platform/integrations แล้วยืนยันว่า runtime path resolve แถวนั้นได้จริง ติดตามผูกกับ ADR-031/FR-079/FR-080 หมายเหตุ: FR-079/FR-080 มีสถานะ 🟠 'production evidence pending' อยู่แล้ว และ ADR-031 ก็เปิดเผยแล้วว่า Supabase migration/canary ยังไม่ถูก apply จริงใน production — ดังนั้นภาพกว้างว่า 'ยังไม่ถึง production' ถูกเปิดเผยไว้แล้ว สิ่งที่ยังไม่ถูกเปิดเผยคือการ apply migration เพียงอย่างเดียวจะไม่ทำให้ flow นี้ทำงานได้โดยไม่ต้องมีโค้ด reconciliation ใหม่ |
| เกี่ยวข้อง | D4-in-repo-connectors-04, D4-in-repo-connectors-07 |
| การตรวจสอบ | CONFIRMED — Re-verified: createPhase1BusinessAgentPortsFromEnv defaults integrationDb to undefined; line-webhook/line-delivery call runtimeFactory() with zero args; resolvePhase1PrimaryConnectionByQuery's raw SQL targets zuri_core.integration_connection (physically distinct from Prisma default-schema per missing @@schema/@map); createPhase1Integration writes only to Prisma-mapped IntegrationConnection; repo-wide grep for INSERT into zuri_core.integration_connection = zero results outside one raw SELECT. |

##### D4-in-repo-connectors-02 — OpenRouter OAuth (PKCE) flow is implemented and PRD-declared active, but no route or UI ever calls it

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | HIGH |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/PRD-SDD-v1.0.md:258 (FR-048 row: 'ModelProviderPort normalizes OpenRouter OAuth credential references...', status 'Phase 1 active - owner-approved 2026-08-14'); src/modules/agent/openrouter-oauth.js:11,27 (createOpenRouterAuthorization, exchangeOpenRouterCode); src/modules/agent/index.js:28 (re-export); src/app/(pm)/platform/integrations/page.jsx:146 ('openrouter' as default select value only — no OAuth button, callback route, or redirect handling) |
| สิ่งที่ควรเป็น | ตาม PRD-SDD registry เส้นทาง OpenRouter OAuth เป็นส่วนหนึ่งของ FR-048 ที่ active และ owner-approved แล้ว ซึ่ง business owner ควรใช้เชื่อมต่อ OpenRouter ได้โดยไม่ต้องเห็น raw API key เลย |
| สิ่งที่เป็นจริง | โมดูล OAuth สร้างเสร็จสมบูรณ์และมี unit test แล้ว แต่ไม่มีจุดใดในแอปพลิเคชันที่กำลังรันอยู่เรียกใช้มันได้เลย วิธีเดียวที่จะเชื่อมต่อ OpenRouter ได้ในวันนี้คือฟอร์ม Phase 1 ทั่วไป ซึ่งบังคับให้ operator ต้องวาง raw OpenRouter key ลงใน Supabase Dashboard Vault UI แล้วนำ reference supabase-vault:<uuid> ที่ได้มาวางลงในฟอร์มอีกที — เป็นขั้นตอนแบบ manual เป๊ะๆ ที่ OAuth flow ถูกสร้างขึ้นมาเพื่อหลีกเลี่ยง |
| ข้อเสนอแนะ | เพิ่ม callback route ที่ขาดหายไป (เช่น /api/platform/integrations/openrouter/callback ที่เรียก exchangeOpenRouterCode) พร้อมปุ่ม 'Connect via OpenRouter' บนไทล์ openrouter หรือไม่ก็แก้แถว FR-048 ใน PRD-SDD ให้สะท้อนความจริงว่าเส้นทาง OAuth ยังไม่ถูกต่อสาย เรโพนี้มีตัวอย่าง PKCE flow ที่เปิดผ่าน route พร้อม consent screen จริงอยู่แล้วที่ /api/plugin/auth/authorize (FR-123, ดู D4-external-ports-10) ซึ่ง callback ของ OpenRouter ควร mirror รูปแบบเดียวกันได้ |
| เกี่ยวข้อง | D4-external-ports-10 |
| การตรวจสอบ | CONFIRMED — Verified createOpenRouterAuthorization/exchangeOpenRouterCode exist and are unit-tested; FR-048 PRD-SDD row says 'Phase 1 active'; grep for openrouter in src/app returns only the default select value. |

##### D4-in-repo-connectors-03 — Market Intelligence's raw-ingestion adapters and read-side repository wrapper are wired to nothing in production

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | HIGH |
| ประเภท | DECLARED_NOT_BUILT |
| หลักฐาน | src/modules/integration/adapters/marketplace-listing-adapter.js:14 (formatMarketplaceListingRawRecord builds {rawPayload, idempotencyKey, ...}, not {lane, sourceType, schemaVersion, payload}); src/modules/integration/adapters/retail-price-adapter.js:14 (same incompatible shape); src/platform/integrations/core/contracts.js:32 (zIngestionEnvelope.strict() requires lane/entityType/externalId/sourceType/schemaVersion/payload); src/modules/market-intelligence/infrastructure/market-raw-record-repository.js:18 (createMarketRawRecordRepository has no caller outside its own file/test); src/platform/integrations/core/contracts.js:25 (MARKET_INTELLIGENCE lane declared but grep for producers = zero) |
| สิ่งที่ควรเป็น | BR-019/SDD-049 อธิบายว่าควรมี adapter เฉพาะแต่ละแหล่ง (source-specific) ต้นน้ำใน Integration ป้อนเข้า RawExternalRecord แล้วให้ translator ฝั่ง Market อ่านผ่าน repository ที่ scope เฉพาะ Market — เป็น envelope เดียวที่บรรจบกันตาม BR-009/SDD-009 |
| สิ่งที่เป็นจริง | adapter ทั้งสองตัว (ติด @req FR-081, FR-092) สร้าง payload รูปแบบที่ส่งเข้า createIngestionEnvelope/ingestRawExternalRecord ตรงๆ ไม่ได้ ต้องผ่านขั้นตอนแปลงที่ยังไม่มีอยู่จริง และไม่มีผู้เรียกนอกจาก unit test ของตัวเอง repository ฝั่งอ่านของ Market ก็ไม่มีผู้เรียกเช่นกัน ทั้งเส้นทางตั้งแต่ acquisition ไปจนถึง translation จึงไม่ทำงานเลยตั้งแต่ต้นจนจบในเรโพนี้วันนี้ |
| ข้อเสนอแนะ | ทำได้สองทาง: ต่อสาย adapter ทั้งสองตัวเข้ากับ ingestRawExternalRecord (แปลง output ให้เป็น zIngestionEnvelope โดยใช้ buildIdempotencyKey/stableStringify แทนการทำ hash เองแยกต่างหาก) ผ่าน route หรือ pull job แล้วต่อสาย createMarketRawRecordRepository เข้ากับ translator service ของ Market หรือไม่ก็ระบุในคอลัมน์สถานะของ PRD-SDD อย่างชัดเจนว่าฝั่ง acquisition ของ FR-092/BR-019 ยังไม่ถูกสร้าง |
| เกี่ยวข้อง | D4-in-repo-connectors-06 |
| การตรวจสอบ | CONFIRMED — Verified both adapters have incompatible output shapes; grep for their call sites outside their own tests = zero results; grep for MARKET_INTELLIGENCE lane usage = only the declaration at contracts.js:25. |

##### D4-in-repo-connectors-04 — Connection promotion and credential rotation exist with correct CAS/versioning semantics but are unreachable from the product

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/platform/integrations/core/integration-registry.js:171 (promotePhase1PrimaryConnection); src/platform/integrations/core/integration-registry.js:147 (upsertIntegrationCredentialMetadata); src/modules/agent/index.js:1 (both re-exported from agent module); grep across src/app and scripts for both function names = zero call sites outside tests |
| สิ่งที่ควรเป็น | docs/domains/integration/CHARTER.md ระบุว่า 'Management operations for promotion, rotation and revocation are separate audited paths' |
| สิ่งที่เป็นจริง | grep หาชื่อฟังก์ชันทั้งสองทั่ว src/app และ scripts ให้ผลลัพธ์เป็นศูนย์นอกจาก tests (fr079-runtime-cutover.test.js, integration-persistence.test.js) — วันนี้ไม่มี API route, หน้าเว็บ, หรือสคริปต์ของ operator ที่ทำให้ใครก็ตาม promote secondary connection ขึ้นเป็น primary หรือ rotate credential reference ได้เลย และทั้งสอง call site ก็ไม่บันทึก audit event ด้วย |
| ข้อเสนอแนะ | เพิ่ม route POST /api/platform/integrations/:id/promote และ /:id/rotate-credential ที่เรียกฟังก์ชันทั้งสองนี้พร้อมบันทึก audit event (ตาม pattern ที่ createPhase1Integration ใช้อยู่แล้ว) หรือไม่ก็ระบุให้ชัดเจนว่าตั้งใจ defer ไว้ก่อนตาม FR-080/ADR-032 |
| เกี่ยวข้อง | D4-in-repo-connectors-01 |
| การตรวจสอบ | CONFIRMED — Verified both functions have zero call sites under src/app; src/app/api/platform/integrations/ contains only route.js and line-registry/route.js; FR-080's own doc lists PATCH/secret/rotate/revoke/promote as un-implemented. |

##### D4-in-repo-connectors-05 — Two disjoint IntegrationProvider identities both represent "LINE Official Account", and only one is visible to the connector catalog

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | MEDIUM |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | src/platform/integrations/core/integration-registry.js:224 (LINE_OA_PROVIDER_CODE = 'LINE_OA'); src/platform/integrations/core/connector-catalog.js:82 (line-oa tile: providerCodes:['LINE_OA']); src/modules/integration/application/line-registry-service.js:62,121 (filters/upserts where code:'line-oa' — lowercase-hyphen); src/modules/integration/application/integration-management-service.js:146 (listPhase1Integrations filters on LINE_OA_PROVIDER_CODE, excluding 'line-oa' rows from catalog read model) |
| สิ่งที่ควรเป็น | ไทล์ connector เดียว ('LINE Official Account') ควรสื่อถึงตัวตน/เรื่องราวด้าน health ที่สอดคล้องกันเพียงชุดเดียวสำหรับการเชื่อมต่อ LINE ของ business นั้น |
| สิ่งที่เป็นจริง | ฟีเจอร์ LINE Registry (กลุ่ม/ผู้ใช้ที่รับการ push อัตโนมัติ) ลงทะเบียน IntegrationProvider ของตัวเองภายใต้ code 'line-oa' ซึ่งมองไม่เห็นเชิงโครงสร้างจากการคำนวณ health ของ catalog ที่ key ด้วย LINE_OA และจาก listPhase1Integrations ไม่มี test หรือเอกสารใดยืนยันว่าการแยกนี้เป็นความตั้งใจ |
| ข้อเสนอแนะ | ทำได้สองทาง: รวม connection ของ LINE Registry เข้าใต้ LINE_OA_PROVIDER_CODE (แยกด้วย purpose=LINE_GROUP/LINE_USER) หรือไม่ก็บันทึกไว้อย่างชัดเจนใน docs/domains/integration/CHARTER.md ว่าเหตุใดจึงตั้งใจแยกตัวตนกัน และสิ่งนี้มีผลอย่างไรต่อการรับประกัน health ของไทล์ LINE OA |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED — Verified LINE_OA_PROVIDER_CODE='LINE_OA'; line-registry-service.js uses lowercase 'line-oa'; listPhase1Integrations filters strictly on LINE_OA_PROVIDER_CODE; tests/unit/line-registry-service.test.js contains no reference to LINE_OA_PROVIDER_CODE. |

##### D4-in-repo-connectors-06 — Three of the fifteen models the integration charter claims have zero writers anywhere in the repository

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | MEDIUM |
| ประเภท | DECLARED_NOT_BUILT |
| หลักฐาน | docs/domains/integration/CHARTER.md:15,16,17 (owns_models lists SyncCursor, ExternalEntityRef, DeadLetterRecord — full 15-entry owns_models block at :9-24); prisma/schema.prisma:1666,1688,1717 (models defined; grep for create/update/upsert on each = zero hits); docs/domains/integration/features/FR-081-raw-external-ingestion.md:104 ('DeadLetterRecord is likewise still unwritten... both need the scheduler/replay surface this requirement declares out of scope') |
| สิ่งที่ควรเป็น | รายการ owns_models ของ charter สื่อว่าโมเดลเหล่านี้เป็น (หรือกำลังจะเป็น) ส่วนหนึ่งของ substrate ที่ทำงานจริง; สัญญาของ FR-081 กำหนดว่า 'A failure becomes a DeadLetterRecord naming the failing stage and the owner responsible for it.' |
| สิ่งที่เป็นจริง | ไม่มีโมเดลใดในสามโมเดลนี้เคยถูกเขียนโดยโค้ดพาธใดในเรโพนี้เลย การขาดหายของ DeadLetterRecord ถูกยอมรับไว้แล้วในเอกสาร FR-081; ส่วน SyncCursor/ExternalEntityRef ไม่มีการบันทึกไว้ (ยังไม่มี pull-adapter ที่ต้องใช้ cursor ยังไม่มี adapter ที่ map external id ดังนั้นการขาดหายของทั้งสองจึงเป็นผลตรงจาก finding 03/07) หมายเหตุ: mapping ของ Integration charter (ExternalEntityRef) เป็นคนละชุดกับ mapping ที่ใช้งานจริงสำหรับ LINE ในวันนี้ — ChannelIdentity ภายใต้ FR-094/FR-097 (ดู D4-in-repo-connectors-11) ผูก external subject เข้ากับ Person ได้จริงแล้ว การขาดผู้เขียนของ ExternalEntityRef จึงไม่เท่ากับ "ไม่มี external-identity mapping ใดๆ ทำงานอยู่เลย" |
| ข้อเสนอแนะ | ไม่ต้องทำอะไรเพิ่มเติมนอกจากติดตามไว้ตาม 'Not in scope' ที่ FR-081 ประกาศไว้แล้ว — แต่ควรอ่านรายการ owns_models ของ charter คู่กับหมายเหตุ scope นั้น เพื่อไม่ให้ผู้อ่าน preflight เข้าใจผิดว่า 'charter อ้างสิทธิ์' เท่ากับ 'มีผู้เขียนอยู่จริง' |
| เกี่ยวข้อง | D4-in-repo-connectors-03, D4-in-repo-connectors-07 |
| การตรวจสอบ | CONFIRMED — Verified docs/domains/integration/CHARTER.md:9-24 lists all three; grep for writer calls (.syncCursor., .externalEntityRef., .deadLetterRecord. — create/update/upsert patterns) = zero results. |

##### D4-in-repo-connectors-07 — No route, page, or script anywhere in this repository can create a LINE_OA or SMARTGIFT_DOCUMENT_INTAKE connection; both are provisioned entirely out-of-band

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/platform/integrations/core/integration-registry.js:261 (registerIntegrationProvider), :110 (createIntegrationConnection) — grep for callers outside tests = zero; docs/domains/integration/features/FR-081-raw-external-ingestion.md:96 ('Provisioning is still an operator step — there is no UI for it...'); supabase/migrations/20260820212547_smartgift_document_intake_connection.sql:61-62 (only SMARTGIFT_DOCUMENT_INTAKE connection ever created is hardcoded to Business id 834fa869-..., Tenant id 77cdbe70-...) |
| สิ่งที่ควรเป็น | เอกสารของ FR-081 เองระบุว่าการ provision LINE_OA เป็น 'outstanding work'; หาก Business ที่สองต้องการ onboard document intake แบบ SmartGift ก็ต้องการความสามารถแบบเดียวกันที่ทำให้ทั่วไปได้ |
| สิ่งที่เป็นจริง | ยืนยันด้วย grep แล้วว่าฟังก์ชันทั้งสองที่ควรทำสิ่งนี้แบบทั่วไปเป็น dead code นอกเทสต์ และตัวอย่างเดียวที่ใช้งานได้จริง (SmartGift) ก็เป็น migration แบบมือเดี่ยว single-tenant |
| ข้อเสนอแนะ | สร้างเส้นทางสร้าง connection ที่ operator ใช้งานได้ตามที่ FR-081/FR-080 ระบุไว้แล้วว่ายังค้างอยู่: route หรือ admin script ที่เรียก registerIntegrationProvider + createIntegrationConnection โดยรับ externalAccountId/businessId จาก operator ทำให้ pattern ที่ migration เดี่ยว hardcode ไว้กลายเป็นแบบทั่วไป |
| เกี่ยวข้อง | D4-in-repo-connectors-01 |
| การตรวจสอบ | CONFIRMED — Verified both functions have zero call sites under src/app; SmartGift migration inserts into Prisma-mapped default-schema tables (not zuri_core), confirming it is hand-written and single-tenant; registerIntegrationProvider/createIntegrationConnection are called only from tests. |

##### D4-in-repo-connectors-11 — ChannelIdentity (FR-094/FR-097) ซึ่งเป็นโมเดลที่ทำหน้าที่ผูก external subject ของ LINE เข้ากับ Person ตาม BR-002 ในการทำงานจริง ไม่มีแถว Inventory ในรายงานนี้เลย

| ฟิลด์ | รายละเอียด |
|--------|-------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | prisma/schema.prisma:446 (model ChannelIdentity), :1078 (model ExternalRef); src/modules/identity/channel-identity.js, src/modules/identity/resolve-line-identity.js, src/modules/identity/link-line-identity.js, src/modules/agent/auth-context.js (ผู้บริโภค); docs/PRD-SDD-v1.0.md:304 (FR-094 "ทุก provider/credential/channel identity ที่เชื่อถือได้ resolve เข้า Person ภายในหนึ่งเดียวผ่าน external binding แบบ namespaced", 🟠), :307 (FR-097 "🟠 ChannelIdentity lifecycle implemented and wired through webhook/turn/ingest with integration tests; provider-side onboarding evidence pending") |
| สิ่งที่ควรเป็น | BR-002 ("external ids are never primary keys; internal UUID + human code + ExternalRef mapping") เป็นกฎที่ไม่ยอมให้ผ่อนปรนของงานตรวจนี้ และหน่วยนี้ตรวจสอบ ExternalEntityRef ของ Integration charter อยู่แล้ว (D4-in-repo-connectors-06) จึงควรตรวจสอบโมเดลตัวจริงที่ทำหน้าที่ผูก external id เข้ากับ Person สำหรับ LINE ไปพร้อมกันด้วย เพื่อให้ภาพรวมของ external-id mapping ในเรโพนี้ครบถ้วน |
| สิ่งที่เป็นจริง | รายงานนี้ไม่มีแถว Inventory หรือ finding ใดกล่าวถึง ChannelIdentity, FR-094 หรือ FR-097 เลย ทั้งที่เป็นโมเดลและ service ชุดที่ทำงานจริงใน production สำหรับผูก external subject (LINE user/group) เข้ากับ Person ภายในหนึ่งเดียว ผ่าน resolve-line-identity.js/link-line-identity.js ที่ถูกต่อสายเข้า webhook/turn/ingest แล้ว (ตามสถานะ 🟠 ของ FR-097) ผลที่ตามมาคือ D4-in-repo-connectors-06 (ซึ่งระบุว่า ExternalEntityRef ของ Integration charter มีผู้เขียนเป็นศูนย์) อาจถูกอ่านผิดว่า "ไม่มี external-identity mapping ใดๆ ทำงานอยู่เลย" ทั้งที่มี mapping อีกชุดหนึ่ง (ภายใต้ FR-094/FR-097 คนละตระกูล id) ทำงานอยู่จริงและมีสถานะ production ของตัวเอง |
| ข้อเสนอแนะ | เพิ่มแถว Inventory ใหม่สำหรับ ChannelIdentity/FR-094/FR-097 ระบุ PARTIAL พร้อมหลักฐานข้างต้น และเพิ่มประโยคขยายความใน D4-in-repo-connectors-06 ว่า mapping ของ Integration charter (ExternalEntityRef) เป็นคนละชุดกับ mapping ที่ใช้งานจริงสำหรับ LINE (ChannelIdentity ภายใต้ FR-094/FR-097) เพื่อไม่ให้ผู้อ่านสรุปว่าไม่มี external-identity mapping ใดๆ ทำงานอยู่เลย |
| เกี่ยวข้อง | D4-in-repo-connectors-06 |
| การตรวจสอบ | critic-added — ยืนยันแล้วว่า prisma/schema.prisma:446,1078 มีโมเดลทั้งสองจริง, ไฟล์ service ทั้งสี่ไฟล์มีอยู่จริง, และ docs/PRD-SDD-v1.0.md:304,307 มีข้อความสถานะตรงตามที่ยกมา |

##### D4-in-repo-connectors-08 — 3 of 5 publicly-connectable LLM providers have no browsable catalog tile

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | LOW |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/modules/agent/model-provider.js:7 (PUBLIC_LINE_PROVIDERS = ['openrouter','openai','anthropic','gemini','groq']); src/platform/integrations/core/connector-catalog.js:73 (CONNECTOR_CATALOG has only 2 AI_MODELS entries: openrouter, google-gemini); src/app/(pm)/platform/integrations/page.jsx:1202 (MODEL_SETTINGS dropdown lists all 5, reachable only via openrouter/google-gemini tile click) |
| สิ่งที่ควรเป็น | connector catalog ที่ตั้งใจสื่อว่า 'เป็นรายการ connector ของผลิตภัณฑ์นี้' ควรแสดงทุก provider ที่ port ต้นทางรองรับจริง |
| สิ่งที่เป็นจริง | OpenAI, Anthropic และ Groq ถูกต่อสายไว้ครบทั้งระดับ port และ dropdown ในฟอร์ม แต่ไม่มีไทล์ ไอคอน หรือคำอธิบายของตัวเองใน catalog เลย — เข้าถึงได้เพียงทางเดียวคือคลิกไทล์อื่นที่ไม่เกี่ยวข้องแล้วสังเกตว่า dropdown มีตัวเลือกอื่นให้ |
| ข้อเสนอแนะ | เพิ่มรายการ AI_MODELS อีก 3 รายการใน CONNECTOR_CATALOG (openai, anthropic, groq) ด้วย providerCodes ที่ตรงกับ PUBLIC_LINE_PROVIDERS หรือไม่ก็บันทึกให้ชัดเจนว่า catalog ตั้งใจแสดงเพียง 2 จาก 5 เป็นการเลือก curation หมายเหตุ: 9 จาก 11 ไทล์ถูกติดป้าย CONNECTOR_NOT_IMPLEMENTED ตามที่บันทึกไว้ว่าเป็นการแก้ไข FR-130 จาก literal 'CONNECTED' ที่ไม่ตรงความจริงเดิม ดังนั้นความไม่ครบถ้วนของ catalog เป็นการออกแบบที่รู้อยู่แล้วสำหรับส่วนใหญ่ ส่วน OpenAI/Anthropic/Groq เป็น connector ที่ใช้งานได้จริงผ่าน PUBLIC_LINE_PROVIDERS เพียงแต่ไม่มีไทล์ของตัวเองเท่านั้น |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED — Verified PUBLIC_LINE_PROVIDERS = 5 entries; CONNECTOR_CATALOG's AI_MODELS category contains exactly 2 entries; connector-catalog.js header explicitly documents most tiles carry providerCodes:[] as honest CONNECTOR_NOT_IMPLEMENTED design for FR-130 correction. |

##### D4-in-repo-connectors-09 — CONNECTION_KINDS defines only CHANNEL and MODEL_PROVIDER — no DATA_SOURCE kind exists for pull-based connectors

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | LOW |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/platform/integrations/core/connection-health.js:29 (CONNECTION_KINDS = ['CHANNEL','MODEL_PROVIDER']); src/modules/integration/application/integration-management-service.js:38 (zCreate only ever produces purpose=PHASE1_LINE_LLM — MODEL_PROVIDER-kind); docs/domains/integration/CHARTER.md:138 (candidate FR-125/ADR-053 describes 'a Business-scoped FlowAccount data-source adapter') |
| สิ่งที่ควรเป็น | pattern 'source-specific adapters' ของ FR-092/BR-019 และผู้สมัคร FR-125 ต่างอธิบายถึง connector kind ที่ไม่ใช่ทั้ง webhook CHANNEL และ LLM MODEL_PROVIDER |
| สิ่งที่เป็นจริง | วันนี้ยังไม่มี kind แบบ DATA_SOURCE (หรือใกล้เคียง) อยู่ในคำศัพท์ด้าน health/connection เลย ดังนั้นเมื่อ FR-125 หรือ adapter ของ market-intelligence ถูกต่อสายขึ้นมาจริง จะไม่มีหมวด health-evaluation หรือ route สร้าง connection ที่ออกแบบมาให้พอดีกับมัน |
| ข้อเสนอแนะ | เมื่อ FR-125 หรือ adapter ของ market-intelligence (finding 03) ถูกจัดลำดับให้ต่อสายจริง ให้ขยาย CONNECTION_KINDS และการจัดประเภทของ connectionKind() (ปัจจุบันเป็นแบบ binary LINE_OA-vs-everything-else) แทนการยัด data-pull connector เข้าไปในรูปแบบ MODEL_PROVIDER |
| เกี่ยวข้อง | D4-in-repo-connectors-03 |
| การตรวจสอบ | CONFIRMED — Verified CONNECTION_KINDS = ['CHANNEL','MODEL_PROVIDER']; zCreate schema only produces purpose=PHASE1_LINE_LLM connections. |

##### D4-in-repo-connectors-10 — The LOCAL_FILE secret backend's only write method is called nowhere except its own unit test

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | LOW |
| ประเภท | TEST_GAP |
| หลักฐาน | src/platform/integrations/core/credential-vault.js:33 (createFileCredentialVault), :103 (`async put(secretRef, secret) {` is the only way to populate the encrypted local vault file), :120 (createEnvCredentialVault); tests/unit/fr079-credential-vault.test.js:22 (vault.put(...) — the only call site in the repository); src/modules/integration/application/integration-management-service.js:169 (createPhase1Integration rejects any secretRef not matching supabase-vault:<uuid>); src/modules/agent/phase1-runtime.js:168 (createEnvCredentialVault wired as read-through GET adapter only) |
| สิ่งที่ควรเป็น | ADR-031 D3 บันทึกว่า LOCAL_FILE เป็น secret backend จริงที่เลือกใช้ได้ สื่อว่าควรมีเส้นทาง dev/test แบบครบวงจร (create connection → store secret → resolve secret) ที่ถูกใช้งานจริง |
| สิ่งที่เป็นจริง | ฝั่งเขียนมีอยู่แค่ภายใน unit test ของตัวเองเท่านั้น เนื่องจาก connection-creation service ตัวเดียวที่มีปฏิเสธ secretRef ใดๆ ที่ไม่ใช่ supabase-vault ในเรโพนี้จึงไม่มี route, script, หรือ seed path ใดสร้าง IntegrationConnection/Credential ที่มี secretRef ให้ LOCAL_FILE vault resolve ได้เลย — backend เป็นโค้ดจริงแต่เข้าถึงไม่ได้แบบ end-to-end นอกจาก test ที่เขียนขึ้นมาเอง |
| ข้อเสนอแนะ | ทำได้สองทาง: เพิ่ม script เล็กๆ สำหรับ operator/dev (เช่น scripts/local-vault-put.mjs) คู่กับการเลือก LOCAL_FILE backend เพื่อให้ local development ใช้เส้นทาง create-to-resolve แบบเต็มได้ หรือระบุให้ชัดเจนใน ADR-031/FR-079 ว่า LOCAL_FILE เป็น fixture สำหรับ unit test เท่านั้น และเส้นทาง LOCAL_DEV ที่ใช้งานจริงคือ legacy env-credential fallback |
| เกี่ยวข้อง | D4-in-repo-connectors-01, D4-in-repo-connectors-04 |
| การตรวจสอบ | verifier-added — Identified via independent search for unexercised write paths; confirmed vault.put has one call site (its own unit test) and the one connection-creation service rejects LOCAL_FILE-shaped secretRefs. |

#### ข้อจำกัดการตรวจ

Finder examined every file explicitly named in the unit-key file list (23 files, ~2,860 lines): src/platform/integrations/core/{connector-catalog,integration-registry,contracts,raw-ingest-service,raw-record-repository,idempotency,secret-manager,credential-vault,connection-health,document-intake-contract,cloud-sot-agent}.js, src/platform/integrations/llm/provider-catalog.js, src/platform/integrations/providers/line/{line-oa-webhook,line-oa-evidence}.js, src/modules/agent/{model-provider,openrouter-oauth}.js, src/modules/integration/adapters/{marketplace-listing-adapter,retail-price-adapter}.js, src/modules/integration/application/{integration-management-service,line-registry-service}.js — read in full. Additionally examined src/platform/integrations/core/{pipeline-tracking-service,pipeline-gate-compliance,knowledge-ingestion-executor}.js (partial), src/modules/agent/{phase1-runtime,index}.js, src/app/api/platform/integrations/{route,line-registry/route}.js, src/app/api/agent/{line-webhook,line-delivery}/route.js (grep-level), src/app/(pm)/platform/integrations/page.jsx (partial, ~350 lines), prisma/schema.prisma (relevant model blocks), prisma/schema.postgres.prisma (header + IntegrationProvider), supabase/migrations (3 files read in full: 20260818040000, 20260820212547; others grepped), docs/domains/integration/CHARTER.md (full), docs/domains/integration/features/{FR-079,FR-080,FR-081} (FR-081 full, others partial), docs/decisions/ADR-031 (partial), docs/PRD-SDD-v1.0.md (grep, specific FR-048/BR-019/SDD-049 rows).

ไม่ได้ตรวจสอบ: src/modules/agent/{line-channel-binding,line-binding-resolver,line-binding-activation,line-operator,canary-preflight,zuri-cli-canary-receipt,step-up,write-tools,tools,turn,runtime,context,msp-memory-port,msp-vault-resolver,scoped-memory,activation-readiness-contract,golden-evaluation,grounded-business-answer,auth-context,action-gate}.js (ดูเหมือนจะเป็นพื้นที่ external-ports/IAM/activation-gates แทนที่จะเป็น connector-specific); ไม่ได้รัน npm test, npm run build, docs:graph, docs:preflight (repository อยู่ในโหมด read-only); ไม่ได้อ่าน prisma/postgres 0001_init.sql line-by-line (grepped เพื่อยืนยันการมีอยู่ของตารางเท่านั้น); ไม่ได้ยืนยันพฤติกรรมที่รันไทม์ (ไม่ได้เริ่มเซิร์ฟเวอร์พัฒนา) — การค้นหาทั้งหมดเป็นแบบ static-analysis/grep-confirmed ข้อสรุปเรื่องการขาดหายจริง (absence) ทุกกรณีถูก cross-check จากสองทิศทาง (จุดนิยาม export lists และ repo-wide grep)

## external-ports

### external-ports

#### สรุปย่อ

- ระบบเชื่อมต่อกับแบ็กเอนด์จริง (MSP, GKS, GenesisBlockDB, Postgres RLS) มีแต่เป็นแค่ไลบรารีที่ทดสอบแล้ว — ไม่สามารถเข้าถึงได้จากเส้นทางการผลิตจริง
- หน่วยความจำ MSP และการอ่าน GKS ไม่มีผู้เรียกใช้นอกการทดสอบ; การนัดหมายแบบอยู่ระหว่างกระบวนการ (createInMemoryMemory, Prisma fallback) ทำงานบนทุกเทิร์นที่เป็นจริง
- เส้นทางการเขียน GenesisBlockDB (FR-024, projectKnowledgeGraph) ก็เหมือนกัน — ไม่มีเส้นทาง production API หรือ job ที่เรียกใช้เลย
- OpenRouter OAuth มีการนำไปใช้งานจริงและ RCA-hardened แต่ไม่มีเส้นทาง API หรือปุ่ม UI ให้เข้าถึงได้
- การสัญญาเจอโครงการข้ามที่เก็บ zuri-cli × zuri-ai (BR-011) ยืนยันโดยการทดสอบเท่านั้น — ไม่เคยทำงานใน CI
- การสร้างสคีมา Postgres ต้องการขั้นตอนด้วยตนเอง; ไม่มีการตรวจสอบการลอยหรือเกต CI เพื่อรักษาความซิงก์

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|------|--------|---------|
| MSP (Tier 2) memory port — contract/adapter | IMPLEMENTED | src/modules/agent/msp-memory-port.js:127-301, src/modules/agent/msp-vault-resolver.js:121-157 | Real API-010 + API-009 mapping, fail-closed on channel-scoped vaults. Unit/integration tested against mocked transport only. |
| MSP memory port — production wiring | MISSING | src/modules/agent/phase1-runtime.js:247-258; src/app/api/agent/line-webhook/route.js:65,201 | line-webhook uses createPhase1BusinessAgentPortsFromEnv, which never includes memory/mspTransport. createAgentPorts has zero production callers. Falls back to createInMemoryMemory(). |
| GKS (Tier 3) knowledge port — contract/adapter | IMPLEMENTED | src/modules/knowledge/graph-query.js:21-34; src/modules/knowledge/gbdb-rag-service.js:15-46 | Pure adapters; no engine spawned. Consistent with ADR-050. |
| GKS knowledge port — production wiring | MISSING | src/modules/agent/context.js:88; src/modules/agent/phase1-runtime.js:247-258 | No production caller passes knowledge into handleAgentTurn. Every turn uses Prisma queryKnowledge, never the graph. |
| GenesisBlockDB (Tier 4) sink | IMPLEMENTED | src/modules/knowledge/genesisblockdb-sink.js:1-60; tests/integration/knowledge-genesis-sink.test.js:1-31 | Translator-only adapter; tested against hand-written mock only. No production round-trip evidence. |
| Market-intelligence GKS identity resolver | DECLARED_ONLY | src/modules/market-intelligence/infrastructure/gks-market-identity-resolver.js:47-87 | Exported, unit-tested, zero callers in src/. Not wired into any application service. |
| Supabase/Postgres production runtime — schema/RLS | IMPLEMENTED | src/modules/knowledge/runtime-isolation-probe.js:44-156; prisma/postgres/0001_init.sql:1096; scripts/gen-postgres-schema.mjs:1-41 | Real RLS/role-isolation probe, tested against real Postgres. 71 models = 71 CREATE TABLE across all three schema files, in sync at HEAD. |
| Supabase/Postgres schema generation — governance gate | MISSING | package.json:15-16; package.json:30; .github/workflows/governance.yml | govern/verify never invoke db:pg:schema or diff generated files. No CI check. In sync by manual discipline only. |
| Runtime isolation probe — operational evidence | PARTIAL | scripts/verify-line-runtime-isolation.mjs:1-24; package.json:32 | Manual operator script only; not run by CI. |
| zuri-cli LINE transport contract (BR-011) | IMPLEMENTED | src/modules/agent/zuri-cli-canary-receipt.js:1-89; src/app/api/agent/line-delivery/route.js:1-90 | Strict Zod contract, hardcoded scope. line-delivery route records receipts. Real cross-repo code on both sides. |
| zuri-cli cross-repo round-trip proof | TEST_GAP | tests/integration/line-oa-cross-repo-round-trip.test.js:31-40; .github/workflows/governance.yml | Only test driving real payload through zuri-cli into zuri-ai route is opt-in via ZURI_CLI_DIST — not set in CI. Never executed automatically. |
| LLM providers — real transport code | IMPLEMENTED | src/modules/agent/model-provider.js:7-150; src/platform/integrations/llm/provider-catalog.js:1-30 | openrouter, openai, anthropic, gemini, groq, ollama all have real request-building + response-parsing. Catalog derived from same array (fail-at-import guard). |
| OpenRouter OAuth (PKCE) acquisition flow | MISSING | src/modules/agent/openrouter-oauth.js:11-43; src/modules/agent/index.js:28 | Real Authorization-Code+PKCE implementation, unit tested. Zero API-route callers. UI accepts only manually-pasted supabase-vault: reference. Operator PowerShell script reimplements PKCE natively. |
| Vercel — deployment target | OUTSIDE_REPO | vercel.json:1-4; docs/PRD-SDD-v1.0.md:315 (FR-105) | No Vercel API integration or webhook receiver in src/. Purely hosting target; production evidence is live URL. |
| GitHub connector | DECLARED_ONLY | src/platform/integrations/core/connector-catalog.js:178-192; docs/PRD-SDD-v1.0.md:163 (FR-130) | Catalog entry has providerCodes: []; FR-130 blocked on PII attestation. repository-service.js only stores metadata. |
| FlowAccount | DECLARED_ONLY | docs/decisions/ADR-053-FLOWACCOUNT-READ-ONLY-PULL-PIPELINE-AND-CREDENTIAL-PROVISIONING.md:13-14 | ADR status: Candidate — not yet approved for code/schema/secret manager. Zero code found. |
| Google OAuth (FR-121) | DECLARED_ONLY | docs/PRD-SDD-v1.0.md:331 (FR-121) | Declared blocked: no OAuth client credential, no tenant-less signup form. Zero code. |
| GoVibe integration | OUTSIDE_REPO | docs/GOVIBE-INTEGRATION.md:1-20; docs/GAP-ANALYSIS-ZURI-GOVIBE.md:36-38 | Dev-time governance meta-layer only; not a runtime tier. No runtime import in src/. |
| GKS interim :8888 serving surface (ADR-046) | OUTSIDE_REPO | docs/decisions/ADR-046-SOT-PIPELINE-INTERIM-SERVING-AND-PULLED-DECISIONS.md:1,40 | No code opens :8888 connection. Boundary respected: "zuri-ai holds decision record, never connects to GenesisBlockDB/:8888 store". |
| Python side (SmartGift data scripts + tests) | PARTIAL | tests/python/test_build_business_knowledge_import.py:1-13; scripts/build_business_knowledge_import.py | 3 unittest suites test 6 data migration scripts. Real TestCase files. Never invoked by package.json or .github/workflows/governance.yml. |
| MCP server port (/api/mcp) — PlanEnvelope intake (FR-069) + data_pipeline tools (FR-071) | IMPLEMENTED | src/app/api/mcp/route.js:5-10,25; src/modules/project-manager/mcp/transport.js:14,100,109,118,127,136 | Only machine-to-machine port in the product; authenticated via resolveRequestViewer; consumes data_pipeline.monitor_read/replay_request that D4-connector-governance-08 says has zero browser consumers — narrows that gap (finding 09) |
| Plugin authorization port (/api/plugin/auth/**, ADR-052/FR-123) | PARTIAL | src/app/api/plugin/auth/{authorize,token,capabilities,revoke}/route.js; src/modules/identity/plugin-auth-service.js:57-58,111-112 | Authorization-code+PKCE flow wired to real routes with a consent screen; PRD-SDD status 🟠 — production Supabase migration, client registration, device-binding/security evidence and maintenance invocation remain gated; client registry is one env var pair, no registry table (finding 10) |
| zuri-edge-device (Zuri Edge Device & Live Operations Console) | OUTSIDE_REPO | docs/decisions/ADR-044-UNIFIED-THREAD-ID-AND-OMNI-CHANNEL-CONSOLE.md:29 (Tier 1 tier table); CLAUDE.md hard-rule row citing ADR-041 | The in-repo port to this system is /api/agent/heartbeat, which D4-connector-governance-15 (HIGH) shows has no auth/tenant scoping (finding 11) |
| Omni-channel dispatcher (unified thread ID console, thread minting, dispatcher) | OUTSIDE_REPO | docs/decisions/ADR-044-UNIFIED-THREAD-ID-AND-OMNI-CHANNEL-CONSOLE.md:1-3,12,29,110 (Status: Approved); docs/roadmap/ROADMAP.md:295-297 | Console/thread-minting/dispatcher live outside this repo per ADR-044 D1; no in-repo FR yet for Conversation ↔ unified-thread join; Facebook Messenger/Instagram DM/Web Chat named as future channels with no in-repo seam or FR (finding 11) |

#### Findings

##### D4-external-ports-01 — FR-029 is marked done ("binds the agent to the REAL backends"), but the production LINE route never wires MSP memory — every live turn uses ephemeral in-process memory

| ฟิลด์ | รายละเอียด |
|-----|----------|
| ระดับ | CRITICAL |
| ประเภท | PRODUCTION_GATE_OPEN |
| หลักฐาน | src/modules/agent/runtime.js:27 (createAgentPorts takes mspTransport as parameter); src/modules/agent/phase1-runtime.js:247 (returned ports has no memory/mspTransport key); src/app/api/agent/line-webhook/route.js:65,201 (line-webhook uses createPhase1BusinessAgentPortsFromEnv, spreads phase1Ports into turn handler); src/modules/agent/context.js:79 (const memoryPort = memory ?? createInMemoryMemory()); repo-wide grep: createAgentPorts called only from tests/integration/agent-runtime.test.js and re-export in index.js — zero production callers |
| สิ่งที่ควรเป็น | ตาม FR-029 (✅) และ ADR-007 §P6 หน่วยความจำของ agent ใน production ควรอิงกับ MSP (createMspMemoryPort + API-010 vault resolution) ให้ได้หน่วยความจำแบบข้ามเทิร์นที่คงทนและ key ด้วย principal |
| สิ่งที่เป็นจริง | production factory (createPhase1BusinessAgentPortsFromEnv) ไม่เคยสร้างหรือ inject MSP transport เลย createAgentPorts มีอยู่จริง ทดสอบดีแล้ว และเป็น fail-closed — แต่ไม่มีผู้เรียกนอกจาก tests ไม่มี environment variable ใดจ่าย MSP transport ให้เลย ทุกเทิร์น LINE จริง ในทุก runtimeSource รวมถึง PRODUCTION_LINE จึง fallback ไปที่ createInMemoryMemory() อย่างเงียบๆ — เป็นเพียง Map ธรรมดาที่ scope อยู่ในโปรเซสเดียว หายไปทุกครั้งที่ serverless cold start/redeploy และไม่เคยเก็บข้อเท็จจริงที่ลูกค้าบอกบอทไว้ในเทิร์นก่อนหน้าเลย |
| ข้อเสนอแนะ | ทำได้สองทาง: (ก) ต่อสาย mspTransport/vaultSetResolver เข้าไปใน ports ที่ createPhase1BusinessAgentPortsFromEnv คืนค่า (ตาม pattern เดียวกับที่ต่อสาย businessKnowledge/model อยู่แล้ว) และเพิ่ม integration test ที่ยืนยันว่าเทิร์นของ route LINE webhook เรียก MSP port ที่ inject ไว้จริงเมื่อตั้งค่าไว้ หรือ (ข) หากการต่อ MSP ยังตั้งใจค้างไว้ก่อน (สอดคล้องกับหมายเหตุ "API-010 integration in progress" ของ FR-057 เอง) ก็ปรับสถานะ FR-029 จาก ✅ ลงเป็น 🟠 พร้อมเพิ่มหมายเหตุใน PRD/ROADMAP อย่างชัดเจนว่าการเชื่อมต่อมีอยู่แค่ในระดับไลบรารีแต่เข้าถึงไม่ได้จาก production route เดียวที่มี |
| เกี่ยวข้อง | D4-external-ports-02, D4-external-ports-03, D4-external-ports-08 |
| การตรวจสอบ | CONFIRMED |

##### D4-external-ports-02 — GenesisBlockDB-backed knowledge reader (createGraphKnowledgeReader) is never wired into the production LINE turn — every live turn reads Prisma relations, never the graph

| ฟิลด์ | รายละเอียด |
|-----|----------|
| ระดับ | HIGH |
| ประเภท | PRODUCTION_GATE_OPEN |
| หลักฐาน | src/modules/knowledge/graph-query.js:21 (createGraphKnowledgeReader requires injected traverse); src/modules/agent/context.js:88 (fallback to queryKnowledge when no reader injected); src/modules/agent/phase1-runtime.js:247 (returned ports has no knowledge/graphTraverse key); src/app/api/agent/line-webhook/route.js:201 (spreads phase1Ports); repo-wide grep: createGraphKnowledgeReader has zero non-test callers |
| สิ่งที่ควรเป็น | FR-029/FR-024 และ ADR-007 §P5 อธิบายว่า agent ควรอ่านย่านความรู้ (knowledge neighbourhood) ของ principal จาก GenesisBlockDB (GKS Tier 3) ผ่าน createGraphKnowledgeReader โดยให้การอ่านผ่าน Prisma เป็นเพียง fallback เมื่อ graph ไม่คืนอะไรกลับมา |
| สิ่งที่เป็นจริง | เนื่องจาก production runtime factory ไม่เคยจ่าย port knowledge/graphTraverse ให้เลย เส้นทาง graph จึงเป็นโค้ดที่เข้าไม่ถึงใน production ทุกเทิร์น LINE จริงใช้การอ่าน relation แบบ Prisma queryKnowledge เสมอ (src/modules/knowledge/query.js) ซึ่งคืนได้แค่ relation ของ customer/conversation/membership เท่านั้น — ไม่เคยเป็นย่านความรู้แบบ multi-hop ของ GKS ที่สมบูรณ์กว่าตามที่สถานะ ✅ ของ FR-029 ใน PRD สื่อว่ากำลังทำงานอยู่จริง |
| ข้อเสนอแนะ | รูปแบบเดียวกับ D4-01: ต่อสาย graphTraverse จริง (เมื่อ GKS เปิดให้ใช้ โดยเคารพขอบเขต Tier-1-non-writer ของ ADR-050 สำหรับการอ่านด้วย) เข้าไปใน ports ของ phase1-runtime.js หรือไม่ก็แก้สถานะ ✅ ของ FR-029 และ roadmap ให้ระบุว่าการดึงความรู้จาก GKS ยังเข้าไม่ถึงจาก agent จริง |
| เกี่ยวข้อง | D4-external-ports-01, D4-external-ports-03, D4-external-ports-08 |
| การตรวจสอบ | CONFIRMED |

##### D4-external-ports-03 — FR-029's ✅ status is doc drift against the actual production wiring gap in D4-01/02

| ฟิลด์ | รายละเอียด |
|-----|----------|
| ระดับ | HIGH |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/PRD-SDD-v1.0.md:239 (FR-029 status reads "✅" with no caveat, unlike FR-057/FR-071/FR-079/FR-080/FR-081); src/modules/agent/index.js:20 (@req FR-029 annotation refers to library, not production route); docs/PRD-SDD-v1.0.md:234 (FR-024 has identical unqualified-✅ pattern, mirroring doc-drift for the write-side counterpart) |
| สิ่งที่ควรเป็น | ตามธรรมเนียมของเรโพนี้เอง (FR-057, FR-071, FR-079, FR-080, FR-081) requirement ใดที่มีการเชื่อมต่อ backend จริงอยู่แค่ในระดับไลบรารีที่ทดสอบแล้ว แต่เข้าไม่ถึงจาก production consumer เดียวที่มี ควรมีสถานะ 🟠/partial พร้อมประโยคสั้นๆ ระบุช่องว่างนั้น ตามจิตวิญญาณของ CLAUDE.md ที่ว่า "progress is always recomputed ... never report a number a page would disagree with" |
| สิ่งที่เป็นจริง | FR-029 แสดงเป็น ✅ แบบไม่มีข้อแม้ ซึ่งผู้อ่าน (รวมถึง ROADMAP.md และการให้คะแนน FR-124 ของ Product Readiness) จะเข้าใจว่า "agent ถูกต่อเข้ากับ MSP+GKS แล้วใน production" — ซึ่ง D4-01/02 แสดงให้เห็นแล้วว่าไม่จริง FR-024 ก็มีรูปแบบ doc-drift แบบ ✅-ไม่มีข้อแม้เหมือนกันเป๊ะ ตอกย้ำว่านี่เป็นปัญหาเชิงระบบสำหรับคู่ P5/P6 |
| ข้อเสนอแนะ | เปลี่ยนสถานะของ FR-029 และ FR-024 เป็น 🟠 พร้อมประโยคระบุว่า createAgentPorts/projectKnowledgeGraph ไม่มีผู้เรียกใน production เลย ตามสำนวนที่ใช้กับ FR-057/FR-079/FR-080/FR-081 อยู่แล้ว |
| เกี่ยวข้อง | D4-external-ports-01, D4-external-ports-02, D4-external-ports-08 |
| การตรวจสอบ | CONFIRMED |

##### D4-external-ports-05 — The only test proving the cross-repo LINE contract with zuri-cli never runs in CI

| ฟิลด์ | รายละเอียด |
|-----|----------|
| ระดับ | HIGH |
| ประเภท | TEST_GAP |
| หลักฐาน | tests/integration/line-oa-cross-repo-round-trip.test.js:39-40 (`const DIST = process.env.ZURI_CLI_DIST` / `const describeRoundTrip = DIST ? describe : describe.skip` — suite skips unless ZURI_CLI_DIST set, used at :60); .github/workflows/ contains exactly one file, governance.yml, with zero matches for ZURI_CLI_DIST; ZURI_CLI_DIST appears only in this test file (:33,:37,:39) and in docs/domains/integration/features/FR-081-raw-external-ingestion.md:159,164 — set in no workflow |
| สิ่งที่ควรเป็น | BR-011 (zuri-cli เป็นเจ้าของการตอบกลับ LINE เพียงรายเดียว) ควรถูกยืนยันแบบ end-to-end ด้วย payload ที่เซ็น HMAC จริง ขับผ่าน webhook server จริงของ zuri-cli เข้าสู่ route จริงของ zuri-ai คอมเมนต์ในไฟล์ test เองก็เรียกมันว่า "THE CROSS-REPO HARNESS" — และระบุว่าสัญญาอาจถูก pin ไว้ทั้งสองฝั่งแต่ยัง "ไม่เจอกันจริง" ได้ถ้าไม่มีตัวนี้ |
| สิ่งที่เป็นจริง | เนื่องจาก ZURI_CLI_DIST ไม่เคยถูกตั้งค่าใน CI เลย test นี้จึงถูก skip-by-name ทุกครั้งที่รัน governance ไฟล์ test เปิดเผยเรื่องนี้ไว้แล้วว่าเป็นความตั้งใจ (zuri-cli ไม่ใช่ dependency ของเรโพนี้ CI จึงไม่มีสำเนา) ไม่ใช่การซ่อนไว้ — แต่ tradeoff นี้ไม่มีกลไกชดเชยใน CI/บันทึกแบบ manual หรือหมายเหตุสาธารณะใน ROADMAP เลย |
| ข้อเสนอแนะ | ทำได้สองทาง: (ก) checkout/build zuri-cli อ้างอิงที่ pin ไว้เข้า CI (submodule, release artifact หรือ cached dist/) แล้วตั้งค่า ZURI_CLI_DIST ใน governance.yml หรือ (ข) บันทึกไว้ใน ROADMAP/PRD อย่างชัดเจนว่าการพิสูจน์ BR-011 round trip เป็นแบบ manual-only เท่านั้น พร้อมระบุชื่อผู้รันและวันที่ล่าสุด เพื่อไม่ให้ผู้อ่านเข้าใจผิดว่า CI ครอบคลุมสัญญานี้ |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D4-external-ports-08 — The GenesisBlockDB write/projection path (FR-024's own contract) has zero production callers — projectKnowledgeGraph and createGenesisBlockDBSink are exercised only by tests

| ฟิลด์ | รายละเอียด |
|-----|----------|
| ระดับ | HIGH |
| ประเภท | PRODUCTION_GATE_OPEN |
| หลักฐาน | src/modules/knowledge/project-graph.js (exports projectKnowledgeGraph); src/modules/knowledge/genesisblockdb-sink.js:1 (real adapter with injected GenesisDatabase client contract); src/modules/knowledge/index.js:9 (both exported from public surface); docs/PRD-SDD-v1.0.md:234 (FR-024 status ✅, no caveat); repo-wide search (src/, scripts/, tests/): projectKnowledgeGraph and createGenesisBlockDBSink called only from tests/integration/{knowledge-genesis-sink,knowledge-project}.test.js and re-export in index.js |
| สิ่งที่ควรเป็น | ตาม FR-024 (✅) และ ADR-007 §P5 relation ของ Zuri (Customer/Business/Conversation/Membership) ควรถูก project เข้ากราฟ GenesisBlockDB จริงอย่างต่อเนื่องหรือเป็นระยะ เพื่อให้เส้นทางอ่าน graph ของ agent (createGraphKnowledgeReader ดู D4-02) มีอะไรให้อ่านใน production |
| สิ่งที่เป็นจริง | ไม่มี API route, script, หรือ scheduled job ใดในเรโพนี้เรียก projectKnowledgeGraph เข้ากับ sink จริงเลย หมายความว่าแม้จะแก้ช่องว่างฝั่งอ่านของ D4-02 และต่อสาย graphTraverse เข้าไปแล้ว กราฟก็ยังว่างเปล่าใน production อยู่ดี — ฝั่งเขียนของสายโซ่ FR-024/FR-029/GKS ก็เข้าไม่ถึงเช่นเดียวกัน ✅ ของ FR-024 ที่ไม่มีข้อแม้มีรูปแบบ doc-drift เดียวกับของ FR-029 (D4-03) |
| ข้อเสนอแนะ | ทำได้สองทาง: เพิ่ม route/script/job ที่เรียก projectKnowledgeGraph คู่กับ createGenesisBlockDBSink ตามตารางเวลาจริง (หรือ trigger จาก relation-write event) แล้วพิสูจน์ด้วย integration test ที่ยืนยันว่ามีการเรียกนอก test harness หรือไม่ก็ปรับสถานะ FR-024 ลงเป็น 🟠 พร้อมหมายเหตุว่าฟังก์ชัน projection มีอยู่และทดสอบแล้วแต่ไม่มี trigger ใน production |
| เกี่ยวข้อง | D4-external-ports-01, D4-external-ports-02, D4-external-ports-03 |
| การตรวจสอบ | verifier-added |

##### D4-external-ports-10 — Plugin authorization port (/api/plugin/auth/**, ADR-052/FR-123) มี production gate เปิดอยู่จริงที่รายงานนี้ไม่เคยกล่าวถึง และเป็นตัวอย่างในเรโพที่แย้งกับคำแนะนำ "ไม่มีตัวอย่าง PKCE ผ่าน route"

| ฟิลด์ | รายละเอียด |
|-----|----------|
| ระดับ | HIGH |
| ประเภท | PRODUCTION_GATE_OPEN |
| หลักฐาน | src/app/api/plugin/auth/authorize/route.js:11-14 (`@req FR-123 ... @spec ADR-052 D4, SDD-074, SEC-022`); token/route.js:5-8; capabilities/route.js:5-8; revoke/route.js:5-7; src/modules/identity/plugin-auth-service.js:57-58 (`env.ZURI_PLUGIN_CLIENT_ID`, `env.ZURI_PLUGIN_REDIRECT_URIS` — client registry ทั้งหมดคือ env var ชุดเดียว), :111-112 (assertClientAndRedirect เทียบ client_id/redirect_uri แบบตรงตัว); prisma/schema.prisma:326 (model PluginInstallation), :368 (model PluginSession); docs/PRD-SDD-v1.0.md:333 (สถานะ FR-123: "🟠 implemented locally; consent gate and replay-safe expired-code/session maintenance tested; production Supabase migration, client registration, device-binding/security evidence and maintenance invocation remain gated"); tests/e2e/fr123-plugin-consent.spec.js |
| สิ่งที่ควรเป็น | รายงานฉบับนี้อ้างขอบเขตว่าครอบคลุมระบบภายนอกทุกรายการที่ผลิตภัณฑ์กล่าวถึงหรือพึ่งพา จึงควรตรวจพบทุกรายการที่มี production gate เปิดอยู่ในเลน connector/port เช่นเดียวกับที่ตรวจพบ FR-029/FR-024/FR-071 |
| สิ่งที่เป็นจริง | เส้นทาง authorization-code + PKCE ของ FR-123 ต่อสายกับ route จริงครบทั้งสี่ตัว (authorize/token/capabilities/revoke) ผ่านหน้า consent จริง และมี e2e test คลุมอยู่ แต่ PRD-SDD เองระบุสถานะ 🟠 ว่า production Supabase migration, การลงทะเบียน client, หลักฐานด้าน device-binding/security และการเรียก maintenance ยังถูก gate อยู่ทั้งหมด "client registry" ทั้งหมดคือ env var ชุดเดียว (ZURI_PLUGIN_CLIENT_ID/ZURI_PLUGIN_REDIRECT_URIS) ไม่มีตาราง registry หรือ lifecycle surface ใดๆ รองรับการเพิ่ม client ที่สอง รายงานนี้ไม่เคยกล่าวถึงพอร์ตนี้เลยแม้จะมีลักษณะเดียวกับ D4-external-ports-01/02/08 ทุกประการ และยังเป็นตัวอย่างที่แย้งกับคำแนะนำใน D4-in-repo-connectors-02/D4-external-ports-04 (ที่เสนอว่า OpenRouter OAuth ไม่มีตัวอย่าง PKCE-ผ่าน-route ในเรโพให้ mirror) เพราะเรโพนี้มี PKCE flow ที่เปิดผ่าน route พร้อม consent screen จริงอยู่แล้ว |
| ข้อเสนอแนะ | เพิ่มแถว Inventory ใหม่ระบุ FR-123 เป็น PARTIAL/PRODUCTION_GATE_OPEN พร้อมหลักฐานข้างต้น และเพิ่มการอ้างอิงไขว้ใน D4-in-repo-connectors-02 ว่า /api/plugin/auth/authorize คือรูปแบบ route ที่ OpenRouter OAuth ควร mirror ตาม สำหรับ FR-123 เอง ควรติดตามการปิด production gate (Supabase migration, การลงทะเบียน client, หลักฐาน device-binding) แยกเป็นรายการของตัวเอง เช่นเดียวกับที่ทำกับ FR-079/080/081 |
| เกี่ยวข้อง | D4-in-repo-connectors-02, D4-external-ports-04 |
| การตรวจสอบ | critic-added — ยืนยันแล้วว่า route ทั้งสี่ไฟล์มี @req FR-123 ตามที่อ้างจริง, plugin-auth-service.js:57-58,111-112 ตรงกับที่อ้าง, prisma/schema.prisma:326,368 มีโมเดลทั้งสองจริง, และ docs/PRD-SDD-v1.0.md:333 มีข้อความสถานะตรงตามที่ยกมา |

##### D4-external-ports-04 — OpenRouter OAuth+PKCE acquisition flow is fully implemented and unit-tested but has no API route or UI trigger — it is unreachable in the running product

| ฟิลด์ | รายละเอียด |
|-----|----------|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/modules/agent/openrouter-oauth.js:11 (createOpenRouterAuthorization builds real PKCE URL against https://openrouter.ai/auth); src/modules/agent/openrouter-oauth.js:27 (exchangeOpenRouterCode POSTs to https://openrouter.ai/api/v1/auth/keys, RCA-hardened); src/modules/agent/index.js:28 (exported from public surface); src/app/(pm)/platform/integrations/page.jsx:146 (only live UI accepts manually pasted supabase-vault:<uuid> reference, no OAuth button); grep: createOpenRouterAuthorization/exchangeOpenRouterCode called only from tests/unit/phase1-business-agent-runtime.test.js and re-export |
| สิ่งที่ควรเป็น | business owner ที่ตั้งค่าไทล์ connector 'OpenRouter (LLM Models)' (src/platform/integrations/core/connector-catalog.js:84-93) ควรคาดหวัง connect flow ได้อย่างสมเหตุสมผล; FR-048 ระบุ OAuth credential references เป็น input ที่ normalize แล้ว |
| สิ่งที่เป็นจริง | ไม่มี route ใดใต้ src/app/api เรียก createOpenRouterAuthorization หรือ exchangeOpenRouterCode เลย เส้นทางจริงที่ operator ใช้ไปหา OpenRouter key คือ scripts/openrouter-oauth-login.ps1 แยกต่างหาก (ที่ reimplement PKCE เองใน native PowerShell โดยไม่เรียกโมดูล JS นี้เลย) หรือไม่ก็สร้าง Supabase Vault secret ด้วยมือแล้ววาง UUID ของมัน ผู้เรียกเดียวของโมดูล OAuth ฝั่ง JS คือ unit test ของตัวเองเท่านั้น |
| ข้อเสนอแนะ | ทำได้สองทาง: เพิ่ม route /api/platform/integrations/openrouter/callback (หรือเทียบเท่า) ที่เรียกโมดูลนี้ซึ่งทดสอบไว้แล้ว เพื่อให้ UI มีปุ่ม connect จริงได้ หรือไม่ก็ลบ/เปลี่ยนป้ายโมดูลนี้ให้เป็น reference implementation สำหรับ operator-CLI เพื่อไม่ให้อ่านผิดว่าเป็นความสามารถที่ shipped ในแอปแล้ว |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D4-external-ports-06 — No automated check that prisma/schema.postgres.prisma and prisma/postgres/0001_init.sql stay in sync with prisma/schema.prisma

| ฟิลด์ | รายละเอียด |
|-----|----------|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP |
| หลักฐาน | package.json:15 ("db:pg:schema": "node scripts/gen-postgres-schema.mjs" — manual script, not referenced by any other script); package.json:30 ("govern": "npm run docs:graph && npm run docs:check && npm run docs:preflight" — no db:pg step); package.json:23 ("verify": "npm test && npm run build && npm run govern && npm run test:e2e" — same omission); .github/workflows/governance.yml (no db:pg reference) |
| สิ่งที่ควรเป็น | docs/DB-MIGRATION-NOTES.md ระบุว่า schema/DDL ของ Postgres ถูก generate เท่านั้น ไม่เคยแก้ด้วยมือ เพื่อให้ทั้งสองไฟล์ 'can never drift' (scripts/gen-postgres-schema.mjs:4) — สื่อว่าการรับประกันนี้ควรถูกบังคับใช้อย่างต่อเนื่อง |
| สิ่งที่เป็นจริง | ที่ HEAD ปัจจุบัน prisma/schema.postgres.prisma และ prisma/postgres/0001_init.sql sync กับ prisma/schema.prisma อยู่ (71 models = 71 CREATE TABLE statements ทั้งสามไฟล์ถูกแก้ในคอมมิตเดียวกัน 2fe5615) แต่ไม่มีอะไรใน govern, verify หรือ .github/workflows/governance.yml ที่ regenerate หรือ diff ไฟล์ที่ generate เหล่านี้เลย การรับประกันนี้คงอยู่ได้เพราะการแก้ schema.prisma ครั้งล่าสุดจำได้ที่จะรัน npm run db:pg:sql เท่านั้น การแก้ schema.prisma ครั้งต่อไปที่พลาดขั้นตอนนี้จะ merge ผ่านได้เฉยๆ แล้วไปโผล่เป็นความล้มเหลวใน production/Supabase แทน |
| ข้อเสนอแนะ | เพิ่มขั้นตอนใน CI (หรือ docs:preflight check) ที่รัน npm run db:pg:sql แล้ว fail build ถ้าเกิด diff กับ prisma/schema.postgres.prisma / prisma/postgres/0001_init.sql ที่ commit ไว้ ตาม pattern การป้องกัน drift ที่ใช้กับ docs:graph อยู่แล้ว (docs:check fail เมื่อ graph ล้าสมัย) |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D4-external-ports-09 — MCP server port (/api/mcp) ไม่ปรากฏในรายงานนี้เลย ทั้งที่เป็นพอร์ต machine-to-machine เดียวของผลิตภัณฑ์และเป็นผู้บริโภคจริงของ FR-071 ledger

| ฟิลด์ | รายละเอียด |
|-----|----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | src/app/api/mcp/route.js:5-10 (`// @req FR-069 — expose the approved PlanEnvelope intake through MCP ...`; `// @req FR-071 — expose the approved data_pipeline tools through the same authenticated MCP session ...`; `@spec ADR-029, ADR-040, SEC-001, SEC-008`); :25 (`viewer = await resolveRequestViewer(request)` — เกตยืนยันตัวตนก่อนเข้าถึง, 401/503 เมื่อล้มเหลว); src/modules/project-manager/mcp/transport.js:14 (import จาก pipeline-tracking-service), :100 `data_pipeline.run_create`, :109 `data_pipeline.document_stage`, :118 `data_pipeline.event_record`, :127 `data_pipeline.monitor_read`, :136 `data_pipeline.replay_request`; tests/unit/pipeline-mcp-transport.test.js, tests/unit/project-manager-mcp.test.js; `grep -o -i mcp` ทั่วรายงานนี้ก่อนการแก้ไขนี้ = 0 hits |
| สิ่งที่ควรเป็น | ขอบเขตของมิตินี้คือ "สำรวจ connector, provider, port และระบบภายนอกทุกรายการที่ผลิตภัณฑ์กล่าวถึงหรือพึ่งพา" MCP server เป็น external protocol port ที่ยืนยันตัวตน viewer แล้วเปิดทั้ง PlanEnvelope intake (FR-069) และเครื่องมือ data_pipeline ทั้ง 5 ตัว (FR-071) ให้ harness ภายนอก (Codex) เรียกใช้ ควรมีแถว Inventory ของตัวเองและควรถูกนำมาพิจารณาเมื่อประเมินว่า ledger ของ FR-071 มีผู้บริโภคหรือไม่ |
| สิ่งที่เป็นจริง | รายงานฉบับนี้ไม่มีแถว Inventory ไม่มี finding และไม่กล่าวถึง MCP เลยแม้แต่ครั้งเดียวก่อนการแก้ไขนี้ (`grep -o -i mcp` = 0 hits) การขาดหายนี้ยังทำให้ D4-connector-governance-08 ให้ภาพที่แคบกว่าความจริง: finding นั้นระบุว่า FR-071 pipeline run ledger "ไม่มีผู้บริโภคฝั่ง browser เลย" ซึ่งถูกต้องเฉพาะฝั่ง browser แต่ data_pipeline.monitor_read และ data_pipeline.replay_request ถูกบริโภคจริงผ่าน MCP transport ผู้อ่านที่ไม่เห็นบรรทัดนี้จึงอาจสรุปผิดว่า ledger ทั้งชุดไม่มีใครใช้เลย |
| ข้อเสนอแนะ | เพิ่มแถว Inventory ใหม่ในหน่วย external-ports ระบุ MCP server port เป็น IMPLEMENTED พร้อมหลักฐานข้างต้น และเพิ่มประโยคอ้างอิงในตัว D4-connector-governance-08 ว่า "ฝั่ง machine-to-machine ผ่าน /api/mcp มีผู้บริโภคจริงสำหรับ monitor_read/replay_request (ดู D4-external-ports-09) ช่องว่างที่แท้จริงจึงจำกัดเฉพาะฝั่ง browser เท่านั้น" |
| เกี่ยวข้อง | D4-connector-governance-08 |
| การตรวจสอบ | critic-added — ยืนยันแล้วว่า src/app/api/mcp/route.js:5-10,25 และ src/modules/project-manager/mcp/transport.js:14,100,109,118,127,136 ตรงกับที่อ้าง และ `grep -c -i mcp` ทั่วรายงานนี้ก่อนแก้ไขได้ 0 |

##### D4-external-ports-11 — zuri-edge-device (ADR-041) และ omni-channel dispatcher (ADR-044) ไม่เคยถูกระบุเป็นระบบภายนอกในรายงานนี้ ทั้งที่ D4-connector-governance-15 (HIGH) คือช่องว่างของพอร์ตที่เชื่อมไปหาระบบนั้นโดยตรง

| ฟิลด์ | รายละเอียด |
|-----|----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/decisions/ADR-044-UNIFIED-THREAD-ID-AND-OMNI-CHANNEL-CONSOLE.md:1-3 (Status: Approved, 2026-08-22), บรรทัด 29 (ตาราง D1 วาง "🏢 Tier 1: Zuri Edge Device & Live Operations Console (d:\workspace)" ไว้นอกเรโพนี้), บรรทัด 12 และ 110 (ระบุ Facebook Messenger, Instagram DM, Web Chat เป็นช่องทางเพิ่มเติมที่จะ hook เข้า Unified Thread ID); docs/roadmap/ROADMAP.md:295-297 ("ADR-044 in-repo seam — ยังไม่มี FR สำหรับ Conversation ↔ unified-thread join และ group-thread isolation rule; งานหลัก (console, thread minting, dispatcher) อยู่นอก repo นี้ตาม ADR-044 D1"); src/app/api/agent/heartbeat/route.js:12-22 (zHeartbeatPayload พร้อม contractVersion '0.1.0b'), :25-29 (globalForDevices.__zuriEdgeDevices — process-global Map ไม่ persist); CLAUDE.md แถวกฎเหล็กที่อ้าง ADR-041 สำหรับ edge device; `grep -rn "Facebook Messenger\|Instagram DM" docs/PRD-SDD-v1.0.md docs/FEATURES.md` = 0 hits (ไม่มี FR รองรับช่องทางเหล่านี้) |
| สิ่งที่ควรเป็น | ตามหลักที่งานตรวจนี้กำหนดไว้เอง ระบบนอกเรโพไม่ใช่ช่องว่างในตัวมันเอง แต่ "พอร์ต/สัญญา/พฤติกรรม fail-closed ของเรโพนี้ต่อระบบนั้น มีอยู่และถูกทดสอบหรือไม่" คือสิ่งที่ต้องตรวจ รายงานควรระบุให้ชัดว่า heartbeat route เป็นพอร์ตไปยังระบบใด (zuri-edge-device ตาม ADR-041) อยู่ภายใต้ ADR ใด (ADR-044 D1) และช่องทางแชทเพิ่มเติมที่ ADR-044 ตั้งชื่อไว้มีสถานะอย่างไร |
| สิ่งที่เป็นจริง | D4-connector-governance-15 (HIGH) วิพากษ์ว่า /api/agent/heartbeat ไม่มีการตรวจสอบสิทธิ์หรือขอบเขตผู้เช่า แต่ไม่เคยระบุว่า route นี้เป็นพอร์ตไปยัง zuri-edge-device ตาม ADR-041 หรืออยู่ภายใต้ ADR-044 D1 เลย ผู้อ่านจึงแยกไม่ออกว่า in-memory registry นี้เป็นแค่ stub ชั่วคราวหรือเป็นสัญญาจริงที่ต้องรักษาไว้ ROADMAP.md เองยังตั้งข้อสังเกตว่า in-repo seam ของ ADR-044 (Conversation ↔ unified-thread join, group-thread isolation) ยังไม่มี FR รองรับ และช่องทางแชทเพิ่มเติมที่ ADR-044 ตั้งชื่อไว้ (Facebook Messenger, Instagram DM, Web Chat) ไม่มี seam ในเรโพนี้เลยและไม่มี FR ของตัวเอง แต่รายงานนี้ไม่เคยกล่าวถึงพื้นที่นี้เลย |
| ข้อเสนอแนะ | เพิ่มแถว Inventory สอง OUTSIDE_REPO: (1) zuri-edge-device (ADR-041) — พอร์ตคือ /api/agent/heartbeat ยังไม่มี auth/tenant scoping (ดู D4-connector-governance-15) และ (2) omni-channel dispatcher (ADR-044) — console/thread minting/dispatcher อยู่นอกเรโพตาม D1 ในเรโพยังไม่มี FR สำหรับการ join รวมถึงช่องทางใหม่ (Messenger/Instagram/Web Chat) พร้อมเพิ่มย่อหน้าบริบทนี้ต่อท้าย D4-connector-governance-15 เพื่อให้ผู้อ่านเห็นทั้งขอบเขตของ ADR และช่องว่างในโค้ดอยู่ในที่เดียวกัน |
| เกี่ยวข้อง | D4-connector-governance-15 |
| การตรวจสอบ | critic-added — ยืนยันแล้วว่า ADR-044 มีสถานะ Approved (2026-08-22), บรรทัด 29 วาง Zuri Edge Device ไว้นอกเรโพจริง, บรรทัด 12 และ 110 ระบุ Facebook Messenger/Instagram DM/Web Chat จริง, ROADMAP.md:295-297 มีข้อความตรงตามที่ยกมา, heartbeat/route.js:12-22,25-29 ตรงกับที่อ้าง, และ grep หา FR ที่รองรับช่องทางเหล่านี้ได้ 0 |

##### D4-external-ports-07 — Python test suite for SmartGift data-migration scripts is never executed by any automated gate

| ฟิลด์ | รายละเอียด |
|-----|----------|
| ระดับ | LOW |
| ประเภท | TEST_GAP |
| หลักฐาน | tests/python/test_build_business_knowledge_import.py:1 (real unittest.TestCase suite); repo-wide grep of package.json and .github/workflows/*.yml for 'python'/'pytest' returns zero matches |
| สิ่งที่ควรเป็น | ตามที่ CLAUDE.md เน้นย้ำว่า test suite ต้องรันจริงจึงจะนับได้ ("a green exit code must mean the work ran and passed, never that it did not run") ไฟล์ Python test ทั้ง 3 ไฟล์ (tests/python/) ที่ครอบคลุมสคริปต์ one-off 6 ตัว ควรเป็นส่วนหนึ่งของ gate บางอย่างก่อนที่สคริปต์เหล่านั้นจะถูกไว้ใจให้ใช้กับข้อมูล SmartGift จริง |
| สิ่งที่เป็นจริง | ไม่พบ npm script, CI workflow หรือขั้นตอนที่บันทึกไว้ใดๆ ที่รัน python -m unittest หรือ pytest บน tests/python/ เลย test มีอยู่จริงและดูเขียนมาดี (ใช้ business_knowledge fixture จริง) แต่ไม่มีกลไกบังคับใช้แบบเดียวกับ scripts/assert-tests-ran.mjs ของชุด JS (หมายเหตุ: จำนวนสคริปต์ที่แท้จริงคือ 6 ไม่ใช่ 5: build_business_knowledge_import.py, apply_smartgift_customer_backfill.py, build_smartgift_customer_backfill.py, build_smartgift_customer_review_queue.py, export_smartgift_business_knowledge.py, rollback_smartgift_customer_backfill.py) |
| ข้อเสนอแนะ | เพิ่ม npm script test:python (หรือขั้นตอนใน governance.yml) ที่รันทั้งสามไฟล์นี้เมื่อ scripts/*.py ในเลน SmartGift data มีการเปลี่ยนแปลง หรือไม่ก็บันทึกไว้ใน docs/DB-MIGRATION-NOTES.md / runbook ที่เกี่ยวข้องว่าใครเป็นผู้รันด้วยมือก่อนการทำ data operation แต่ละครั้ง |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

#### ข้อจำกัดการตรวจ

**การค้นหา:** โฟกัสเพียงเรื่องของพอร์ตภายนอก (MSP, GKS, GenesisBlockDB, Supabase/Postgres, zuri-cli, ผู้ให้บริการ LLM, Vercel, GitHub, FlowAccount, Google OAuth, GoVibe, Python side) ตามการมอบหมาย; ไม่ค้นคืนกลไกการทำงาน connector-catalog ในเรโพ (ทิ้งให้ตัวค้นหา in-repo-connectors) หรือคำถามกระบวนการ connector-governance ที่กว้างนอกเหนือจากสิ่งที่จำเป็นต้องมีหลักฐานสำหรับช่องว่าง MSP/GKS

**ไฟล์ที่อ่าน:** 27 ไฟล์ — ทุกการอ้างอิงข้างต้นยืนยันจากเนื้อหาไฟล์จริง ไม่ใช่อนุมาน รวม: src/modules/agent/{memory-port,msp-memory-port,msp-vault-resolver,scoped-memory,context,turn,runtime,phase1-runtime,index,model-provider,openrouter-oauth}.js; src/modules/knowledge/{gbdb-rag-service,graph-query,genesisblockdb-sink,project-graph,sink,runtime-isolation-probe,postgres-business-knowledge,supabase-business-knowledge,query}.js; src/modules/market-intelligence/infrastructure/gks-market-identity-resolver.js; src/platform/integrations/core/connector-catalog.js, src/platform/integrations/llm/provider-catalog.js; src/app/api/agent/{line-webhook,line-delivery}/route.js; scripts/{gen-postgres-schema,verify-line-runtime-isolation}.mjs; docs (PRD-SDD-v1.0.md rows FR-024/FR-029/FR-048/FR-057/FR-079/FR-080/FR-081/FR-105/FR-121/FR-130, DB-MIGRATION-NOTES.md, ADR-046/ADR-050/ADR-053, GOVIBE-INTEGRATION.md, GAP-ANALYSIS-ZURI-GOVIBE.md); tests/integration/{agent-runtime,knowledge-genesis-sink,line-oa-cross-repo-round-trip}.test.js; tests/python/test_build_business_knowledge_import.py; prisma/schema.prisma, prisma/schema.postgres.prisma (นับโมเดล), prisma/postgres/0001_init.sql (นับ CREATE TABLE); .github/workflows/governance.yml, package.json (ส่วนสคริปต์), vercel.json

**ไม่ได้เปิด:** supabase/migrations/*.sql แบบเต็ม (30 ไฟล์; ตัวอย่างผ่าน grep แทนการอ่านเต็ม); tests/unit/platform/connector-catalog.test.js แบบเต็ม (เชื่อถือหมายเหตุแหล่งที่มา); docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md (พึ่ง ADR-050 ตารางสรุป); ADR-053 FlowAccount ส่วนหัวสถานะเท่านั้น

**ความแม่นยำการนับ:** prisma/schema.prisma และ prisma/schema.postgres.prisma = 71 โมเดล, prisma/postgres/0001_init.sql = 71 CREATE TABLE statements — ยืนยันที่ HEAD (commit 2fe5615), ไม่ใช่อนุมาน

**ความไม่แน่นอนหลัก:** ไม่สามารถยืนยันจากการวิเคราะห์แบบคงที่ได้ว่าช่องว่าง FR-029 (D4-01/02) เป็นสถานะระดับกลาง/ยอมรับหรือการมองข้าม — บรรพาก่อน PRD (FR-057, FR-079/080/081) บ่งชี้ว่าทีมโดยปกติสงวนข้อจำกัดนี้ ซึ่งเป็นเหตุผลที่ระบุ FR-029 ✅ ที่ไม่มีคำสงวนเป็นการลอย (doc drift) แทนสมมติว่าเป็นเจตนา

## connector-governance

### connector-governance

#### สรุปย่อ

- โครงสร้างแบบเต็ม: Integration domain มี 15 models ในการรับความเป็นเจ้าของ (owns_models) โดย 12 มีผู้เขียนแบบใช้งาน; 3 รูปแบบ (SyncCursor, ExternalEntityRef, DeadLetterRecord) ประกาศเท่านั้นมีศูนย์ผู้เขียนสำหรับแบบจำลอง
- ฐานราก LINE_OA ที่มี: Webhook resolver, health check, connector-catalog อยู่ แต่ขาด provisioning UI, lifecycle route ที่บัญชี 5 รายการ (rotate/revoke/promote/disable/test), และตัวตรวจสอบความถูกต้องของรหัสผู้ให้บริการ
- SoT pipeline ledger (FR-099/100/101) สำเร็จการติดตั้งด้วยเส้นทาง/หน้า/การทดสอบ แต่ไม่มี UI หลักฐานสำหรับการควบคุมการไหลของการเรียกใช้ และไม่มีเส้นทางการอนุมัติ PipelineGateDecision ที่ผ่านการอนุญาต
- ละเมิดขอบเขตที่ร้ายแรง 3 รายการ: (ก) listLineRegistry ส่งคืนข้อมูลผู้เช่าทั้งหมดเมื่อ businessId ละเว้น (ข) heartbeat route ไม่มีการตรวจสอบ/ขอบเขต (ค) provider code 'line-oa' ไม่ตรงกับ 'LINE_OA' ที่ใช้ที่อื่น
- ความสามารถมี 5 รายการถูกประกาศแต่ไม่มีการสำเร็จการติดตั้ง: LINE_OA provisioning, lifecycle CRUD, gate authorization policy, LINE automation scheduler, pipeline run detail viewer
- การปกครองแบบ enum: ไม่มีค่าคงที่ integration-domain ในเก็บ src/lib/validation/enums.js; GATE_STATUSES ชนกันระหว่างสองชุดค่าที่ไม่เหมือนกัน

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|------|--------|---------|
| docs/domains/integration/CHARTER.md — owns_routes, owns_models, owns_code, Public contracts | บางส่วน | CHARTER.md:1–33 (owns_models), :86–127 (Public contracts) | เส้นทาง/โมเดลส่วนใหญ่ตรงกับรหัส แต่ Public contracts หายไป marketplace-listing-adapter.js, retail-price-adapter.js (FR-081/092) |
| IntegrationProvider / IntegrationConnection / IntegrationCredential writers | ดำเนินการแล้ว | integration-management-service.js; line-registry-service.js; integration-registry.js | ผู้เขียน 'LINE' มีตัวตนรหัสผู้ให้บริการที่แตกต่างกันสองแบบ (ดู finding 04) |
| IngestionRun / RawExternalRecord writers | ดำเนินการแล้ว | raw-ingest-service.js; raw-record-repository.js; integration-registry.js:279; cloud-sot-agent.js | เส้นทาง LINE_OA webhook ไม่เปิด IngestionRun (ingestionRunId null ต่อ FR-081); เฉพาะ cloud-sot-agent.js ใช้ end-to-end |
| SyncCursor / ExternalEntityRef / DeadLetterRecord | ประกาศเท่านั้น | schema.prisma:1666,1688,1717 | ไม่มี .create/.update/.upsert/.delete ที่อื่นใน src/; กล่าวถึงเฉพาะใน backup-service.js ตัวอย่างที่ทั่วไป |
| SotDecision (FR-100) submit/decide/export | ดำเนินการแล้ว | sot-decision-service.js; /api/platform/sot/decisions/** | มีนโยบายการให้สิทธิ์ที่กำหนด (requireDecider: owner or operator) ไม่เหมือน FR-129 sibling |
| PipelineRun/Step/EventReceipt/RecordEvent/Reconciliation/GateDecision (FR-071 ledger) | บางส่วน | pipeline-tracking-service.js:398–600, :757+ | ผู้เขียนเดียว; PipelineReconciliation.evidenceJson hardcoded '{}' (finding 06); ไม่มี Business-scoped signing route (finding 07) |
| /platform/integrations page — create MODEL_PROVIDER connection | ดำเนินการแล้ว | page.jsx:266–291 (submitModel); route.js:15–25 | Vault-ref-only, fixed purpose=PHASE1_LINE_LLM, ตรงกับ FR-080 contract |
| /platform/integrations page — disable/rotate/revoke/promote/delete/test connection | ขาด | page.jsx (POST 3 call sites เท่านั้น); route.js ไม่มี [id] sub-route | ADR-032 D5 ออกแบบ 5 lifecycle routes; ไม่มี |
| LINE_OA channel connection creation path | ขาด | integration-registry.js:110 createIntegrationConnection; grep callers = tests/integration/*.test.js เท่านั้น | ไม่มี UI, API route, seed script; FR-081 doc: 'Provisioning is still an operator step' |
| /api/platform/integrations/line-registry (LINE group/user directory) | ดำเนินการแล้ว | line-registry/route.js; line-registry-service.js | เขียน IntegrationConnection rows; provider code 'line-oa' (lowercase-hyphen) แตกต่างจากคำตั้งหลัก 'LINE_OA'; audit events ไม่เก็บถาวร (findings 03, 04) |
| SoT plan board (FR-099) — /platform/sot-pipeline + /api/platform/sot/plan | ดำเนินการแล้ว | sot-pipeline/page.jsx; /api/platform/sot/plan/route.js; sot-plan-service.js | Frontmatter status ล้าสมัย ('proposed') vs PRD ✅ (finding 09); run evidence เป็นข้อความธรรมชาติ ไม่ลิงค์ (finding 08) |
| SoT approval inbox (FR-100) — /platform/sot-pipeline/inbox | ดำเนินการแล้ว | sot-pipeline/inbox/page.jsx; /api/platform/sot/decisions/** | Frontmatter status ล้าสมัย ('proposed') vs PRD ✅ |
| SoT pipeline graph dashboard (FR-101) — /platform/sot-pipeline/graph | ดำเนินการแล้ว | sot-pipeline/graph/page.jsx; tests/unit/sot-pipeline-graph.test.js | Frontmatter status ล้าสมัย ('proposed') vs PRD ✅; ไม่มี e2e spec สำหรับ board/inbox/graph |
| /api/pipelines/runs, /[id], /[id]/events, /[id]/replay | ดำเนินการแล้ว | route.js; [executionRunId]/route.js; [executionRunId]/events/route.js; [executionRunId]/replay/route.js | Replay สร้าง immutable QUEUED row; ไม่มีหน้า src/app แสดงการตอบสนอง (finding 08) |
| Connector catalog on /platform/integrations | ดำเนินการแล้ว | connector-catalog.js; tests/unit/platform/connector-catalog.test.js | สร้างและทดสอบได้ดี; สถานะมาจาก listPhase1Integrations ไม่ตามตัวอักษร |
| FlowAccount pull pipeline (FR-125 / ADR-053) | ประกาศเท่านั้น | grep FlowAccount across src/ = zero; FR-125 'Delivery state' section | Doc-consistent: 'Documentation candidate only — implementation is not authorized' |
| Pipeline Builder canvas (FR-082..085 / ADR-035 / FEAT-007) | ประกาศเท่านั้น | ADR-035:15–16 ('Status: Proposed'); docs/PRD-SDD-v1.0.md:292–295 (🔜 design only) | Doc-consistent, ไม่มีการเบี่ยงเบน |
| GitHub repository projection (FR-130) | ติดอยู่ที่เงื่อนไข | FR-130 'The PII question, which is the blocker' section | ติดอยู่ในการตัดสินใจ product/data-protection ที่มีชื่ออย่างชาญฉลาด ไม่ใช่ความพยายาม; เฉพาะ catalog false-green fix ส่ง |
| ADR-038 D3 market-source Integration provider adapters (8 ตลาด) | บางส่วน | ADR-038:70–76 (D3); marketplace-listing-adapter.js, retail-price-adapter.js | ฟังก์ชัน formatting บริสุทธิ์ 2 รายการ zero callers; ไม่อยู่ใน charter's Public contracts |
| src/lib/validation/enums.js coverage of integration-domain enums | ขาด | enums.js (zero matches CONNECTION_KIND/CONNECTOR_STATE/etc); ค่าคงที่กำหนดเอง locally in 5 ไฟล์ | GATE_STATUSES ชนกันจาก 2 ชุดค่า incompatible (finding 10) |
| Automation scheduler for LINE group 'daily report' jobs | ขาด | metadataJson.automationJobs เก็บแต่ไม่อ่าน; grep PUSH_DAILY_SALES_REPORT = page.jsx + line-registry-service.js เท่านั้น | ไม่มี scheduler/cron infra ที่ไหน (finding 14) |
| Edge heartbeat route attribution to FR-080 | ละเมิดขอบเขต | /api/agent/heartbeat/route.js:6–8 (@req FR-080); docs/TRACE.md:632 | In-memory-only registry ไม่เกี่ยวข้อง FR-080 secret management; ลง FR-080 trace (finding 12) |
| MSP / GKS / GenesisBlockDB / zuri-cli boundary (out-of-repo systems) | นอกเก็บข้อมูล | CHARTER.md boundary section; FR-081 'Signature verification' section | Documented boundary (BR-011); in-repo side (contract test) มี; round-trip cross-repo opt-in ZURI_CLI_DIST |
| SotDataPlaneKey (FR-102) — external SoT data-plane credential | ดำเนินการแล้ว | sot-data-plane-auth.js:4-13,15,31,49; /api/platform/sot/decisions/route.js:23; scripts/mint-sot-data-plane-key.mjs | mint/revoke ผ่าน CLI เท่านั้น ไม่มี route, listing, rotation หรือ expiry surface; sibling ของช่องว่าง lifecycle ที่ finding 02 ชี้ไว้แล้ว (finding 16) |
| ApiAccessKey (FR-106) — Enterprise API tenant credential | ดำเนินการแล้ว | api-access-keys/route.js:5-11,15-20; api-access-keys/[id]/route.js:15-20; grep "api-access-keys" src/app/**/*.jsx = 0 | mint (POST) + revoke (DELETE) route มีจริงแต่ไม่มีผู้บริโภคฝั่ง browser เลย ไม่มี list endpoint (finding 17) |

#### Findings

##### D4-connector-governance-03 — line-registry-service.js เรียก recordAudit() ผิด signature — ทำให้ audit event ของ LINE group/user ล้มเหลวอย่างเงียบทุกครั้ง

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | CRITICAL |
| **ประเภท** | BROKEN_FLOW |
| **หลักฐาน** | `src/modules/integration/application/line-registry-service.js:184` — saveLineGroup: `recordAudit({ tenantId, businessId, ... })` passes ONE object (saveLineUser มีรูปแบบเดียวกันที่บรรทัด 271); `src/modules/project-manager/application/audit.js:6` — real signature is `recordAudit(db, {...})` requires db as FIRST argument (imported at `line-registry-service.js:8`); ทุก 60+ caller อื่นผ่าน prisma/db/tx first; `tests/unit/line-registry-service.test.js` contains zero audit refs |
| **สิ่งที่ควรเป็น** | CLAUDE.md: 'Every write goes through a service in application/, which records an audit event.' saveLineGroup/saveLineUser เรียก recordAudit เพื่อบันทึก CREATE_LINE_GROUP/UPDATE_LINE_GROUP/CREATE_LINE_USER/UPDATE_LINE_USER |
| **สิ่งที่เป็นจริง** | recordAudit เรียก options object ใน `db` parameter position และไม่มี argument ที่สอง ใน recordAudit destructuring `undefined` throws TypeError ก่อน db.auditEvent.create ถึง `.catch(() => {})` บนเซต call site ตัดข้อผิดพลาดนี้ทั้งหมด ทุก LINE group/user registration/update ไม่เคยสร้าง audit event มั่นคง |
| **ข้อเสนอแนะ** | แก้ทั้งสองเซต call sites เป็น `recordAudit(prisma, { ... })` ตรงกับ caller อื่นๆ ทั้งหมด เพิ่ม assertion ใน tests/unit/line-registry-service.test.js ที่ AuditEvent row ถูกสร้าง หลังจาก saveLineGroup/saveLineUser จึงลักษณะเดียวกันไม่ได้ regress เงียบ |
| **เกี่ยวข้อง** | D4-connector-governance-04 |
| **การตรวจสอบ** | CONFIRMED — ทั้งหมดกรณี และพบ bug ที่สอง: parameter name ผิด (`changes:` vs `payload:`) ทำให้ audit record จะถูกเขียนด้วย empty payload แม้หลังจากแก้ arg-position |

##### D4-connector-governance-13 — listLineRegistry ส่งคืนการเชื่อมต่อ LINE Group/User ทั้งหมดของผู้เช่าทั้งหมดเมื่อละเว้น businessId query param

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | CRITICAL |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | `line-registry-service.js:57` — `if (businessId) assertScope(viewer, businessId)` ตรวจสอบการให้สิทธิ์เฉพาะเมื่อ businessId truthy; `:61` — `where: { ..., ...(businessId ? { businessId } : {}) }` ไม่มี businessId ไม่มี filter; `src/app/api/platform/integrations/line-registry/route.js:17` — GET ผ่าน `businessId: params.businessId \|\| null` straight through; `page.jsx:140` — UI สร้าง request ไม่มี businessId เมื่อ businessId state falsy จึงสามารถเข้าถึงเส้นทาง unscoped ได้โดยผ่านผลิตภัณฑ์ของตัวเอง UI |
| **สิ่งที่ควรเป็น** | Per BR-002/SEC-001 tenant isolation และ sibling listPhase1Integrations' safe pattern, unscoped list request ควรส่งคืนข้อมูลของ viewer's own ownedBusinessIds เท่านั้น ไม่เคยทุก tenant |
| **สิ่งที่เป็นจริง** | Viewer ที่สามารถเข้าถึง GET /api/platform/integrations/line-registry โดยไม่มี businessId query parameter ได้รับทุก LINE_GROUP และ LINE_USER IntegrationConnection row: ชื่อ, LINE external group/user ids, department types, personal alert lists, tenant and business names, automation job schedules ทั่ว every tenant ใน deployment tests/unit/line-registry-service.test.js เฉพาะ 2 Zod validation error paths เท่านั้น never listLineRegistry |
| **ข้อเสนอแนะ** | Mirror listPhase1Integrations' safe pattern: businessId omitted ขอบเขต where clause เป็น `businessId: { in: viewer.ownedBusinessIds }` (หรือ reject 400 ถ้า viewer ไม่มี resolvable scope), เพิ่ม regression test ที่ non-platform-dev viewer ไม่มี businessId never sees another tenant's rows |
| **เกี่ยวข้อง** | D4-connector-governance-04 |
| **การตรวจสอบ** | verifier-added |

##### D4-connector-governance-04 — LINE Group/User registrations ใช้ IntegrationProvider.code='line-oa' ขณะที่ส่วนอื่นใช้ 'LINE_OA' — ตัวตนรหัสผู้ให้บริการที่แตกต่างกันสองแบบ

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | HIGH |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | `line-registry-service.js:62,121` — query/upsert `provider: { code: 'line-oa' }` (lowercase-hyphen); `integration-registry.js:224` — `export const LINE_OA_PROVIDER_CODE = 'LINE_OA'` canonical; `integration-management-service.js:70,146` — webhook resolution/connectionKind/listPhase1Integrations ใช้ LINE_OA_PROVIDER_CODE; `connector-catalog.js:82` — `providerCodes: ['LINE_OA']` |
| **สิ่งที่ควรเป็น** | 'LINE_OA' ควรระบุ IntegrationProvider row เดียวที่ webhook resolution, connection-kind classification, health, connector catalog, และ registry UI เห็นด้วย per charter's single-provider model |
| **สิ่งที่เป็นจริง** | line-registry-service.js consistently upserts/queries `IntegrationProvider{code:'line-oa'}` (lowercase-hyphen) — row entirely distinct from 'LINE_OA' ใช้ที่อื่น ได้ผล: LINE_GROUP/LINE_USER connections มี `purpose='LINE_GROUP'`/`'LINE_USER'` และ `provider.code='line-oa'` ไม่ match `purpose='PHASE1_LINE_LLM' OR provider.code='LINE_OA'` ไม่ปรากฏใน /api/platform/integrations metadata/health listing ไม่ classified, invisible เพื่อ connection health และ connector catalog |
| **ข้อเสนอแนะ** | เปลี่ยน line-registry-service.js provider-code literals ('line-oa') เป็น `LINE_OA_PROVIDER_CODE`, run one-time data migration รวม/repoint 'line-oa' provider rows ที่มีอยู่ เป็นคำตั้งหลัก 'LINE_OA' (หรือตัดสินใจ LINE groups/users คือ deliberately separate provider identity — document ชัดแจ้ง) |
| **เกี่ยวข้อง** | D4-connector-governance-03 |
| **การตรวจสอบ** | CONFIRMED — 3 literals confirmed at line 62, 121, 208-ish for saveLineUser; no migration/normalization anywhere bridges the two codes |

##### D4-connector-governance-14 — LINE Group 'daily report' automation jobs fully round-trippable UI/DB state โดยไม่มี scheduler หรือ executor ที่ไหนในเก็บ

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | HIGH |
| **ประเภท** | BROKEN_FLOW |
| **หลักฐาน** | `page.jsx:299` — enableDailyReport checkbox สร้าง `automationJobs: [{ action: 'PUSH_DAILY_SALES_REPORT', schedule: reportSchedule }]`; `:1037` — same array rendered back read-only; `line-registry-service.js:15` — zAutomationJob schema validated/persisted ใน IntegrationConnection.metadataJson never read back; grep 'PUSH_DAILY_SALES_REPORT' across src/ (exclude this file + page) = zero results |
| **สิ่งที่ควรเป็น** | ตาราง cron-style schedule ('0 9 * * *') คู่กับชื่อ action ('PUSH_DAILY_SALES_REPORT') ที่เก็บไว้กับ LINE Group ควรทำให้เกิด scheduled push ตามเวลาจริงในที่สุด — นี่คือจุดประสงค์ทั้งหมดที่ผู้ใช้มองเห็น |
| **สิ่งที่เป็นจริง** | automationJobs ถูก validate เป็น JSON รูปแบบ Zod แล้วเก็บลง DB และแสดงกลับแบบ static เท่านั้น User ที่เปิด daily report ผ่าน UI ของผลิตภัณฑ์จะไม่ได้รับ error ใดๆ และก็ไม่ได้รับรายงานตลอดไปเช่นกัน — ข้อมูลถูกเขียนแต่ไม่เคยถูกบริโภคเลย |
| **ข้อเสนอแนะ** | สร้าง executor ที่ยังขาดอยู่ (scheduled job ที่อ่าน automationJobs ที่ active แล้ว dispatch PUSH_DAILY_SALES_REPORT) โดยติดตามผูกกับ FR/AC ของตัวเอง หรือไม่ก็ถอด UI/schema ออกจนกว่าจะมี executor จริง |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | verifier-added |

##### D4-connector-governance-15 — /api/agent/heartbeat ยอมรับ device registration ที่ไม่มีการตรวจสอบสิ้นสุด + ไม่มี tenant/business scoping

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | HIGH |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | `heartbeat/route.js:58-94` — ทั้งบล็อก POST ไม่มีการเรียก resolveRequestViewer เลย; `:96-104` — DELETE, บรรทัด `:103` `edgeDevices.clear()` wipes every tenant's devices in one unauthenticated request; `:25` — `globalForDevices.__zuriEdgeDevices` process-global Map keyed deviceId only ไม่ partitioned by tenantId/businessId; `:33-39` — แม้แต่ GET ก็ตั้งใจ fallback `viewerId = 'anonymous'` เมื่อ resolveRequestViewer ล้มเหลว แล้วยังคืนค่าอุปกรณ์ทั้งหมดในทะเบียน (unauthenticated read เป็นอีกด้านหนึ่งของ finding เดียวกัน); `page.jsx:193` — deleteEdgeDevice() ใน product's UI เรียก endpoint live/reachable feature |
| **สิ่งที่ควรเป็น** | Route ให้ operator ลงทะเบียน/ดู/ลบ edge-device ที่ embedded ในปกครอง integrations surface ควร require trusted-viewer boundary + ไม่ disclose another tenant's devices |
| **สิ่งที่เป็นจริง** | POST/DELETE ไม่ require authentication, no tenant/business identity; script ที่รู้ deployment URL เท่านั้น สามารถ inject fake devices หรือ issue unauthenticated DELETE ล้าง entire registry ทั้ง every business tests/unit ไม่มี reference heartbeat route บริบทที่หายไป: route นี้คือพอร์ตไปยัง zuri-edge-device (ADR-041) ซึ่งอยู่นอกเรโพนี้ตาม ADR-044 D1 (ดู D4-external-ports-11) — ADR-044 ยังตั้งชื่อ Facebook Messenger/Instagram DM/Web Chat เป็นช่องทางเพิ่มเติมที่จะต่อเข้า Unified Thread ID เดียวกันในอนาคต ซึ่งยังไม่มี seam หรือ FR ในเรโพนี้เลย ดังนั้นช่องโหว่นี้ไม่ใช่แค่ปัญหาของ heartbeat route ตัวเดียว แต่เป็นจุดเข้าเดียวของทั้งสายโซ่ omni-channel ที่ยังไม่มีการป้องกันขอบเขตใดๆ |
| **ข้อเสนอแนะ** | Require resolveRequestViewer + ownsBusiness/isInstallationOperator check POST/DELETE, key registry โดย (tenantId, businessId, deviceId) ไม่ deviceId alone, add test coverage auth boundary + scoping — หรือ gate behind isInstallationOperator ถ้า stub/demo |
| **เกี่ยวข้อง** | D4-connector-governance-12, D4-external-ports-11 |
| **การตรวจสอบ** | verifier-added |

##### D4-connector-governance-01 — LINE_OA channel connection ไม่มี application-code creation path — เฉพาะ test harnesses เรียก createIntegrationConnection

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | MISSING_SURFACE |
| **หลักฐาน** | `integration-registry.js:110` createIntegrationConnection — only function capable; `line-oa-connection-health.test.js:72` one of three call sites all test files; `integration-management-service.js:38` zCreate.provider validated against PUBLIC_LINE_PROVIDERS (openrouter/openai/anthropic/gemini/groq) only — LINE_OA refused; `FR-081-raw-external-ingestion.md` 'Provisioning is still an operator step' |
| **สิ่งที่ควรเป็น** | FR-081/FR-080 operator provisions channel connection once หลังจาก live LINE ingress records evidence automatically |
| **สิ่งที่เป็นจริง** | ไม่มี UI form, API route, seed script ใน repo สร้าง LINE_OA IntegrationConnection createIntegrationConnection exported + correct แต่ callers เฉพาะ 3 integration test files Deployment ได้รับ LINE_OA row ผ่าน hand-run script หรือ direct SQL เท่านั้น |
| **ข้อเสนอแนะ** | เพิ่ม operator-only provisioning route/CLI command calls createIntegrationConnection + registerIntegrationProvider with audit trail tracked under FR-081/FR-080, หรือ (b) ถ้า provisioning intentionally ops runbook write it down (FR-081 note หรือ scripts/ file) documented procedure ไม่ silent hole |
| **เกี่ยวข้อง** | D4-connector-governance-02 |
| **การตรวจสอบ** | ADJUSTED — severity HIGH → MEDIUM: FR-081 'Resolution and provisioning' section (lines 102–106) already names gap + spells out two calls operator must make; this tracked limitation not undocumented. Missing is runnable script/CLI or AC line item, not documentation of gap. Note separately: line-registry-service.js saveLineGroup/saveLineUser DO create IntegrationConnection rows in production code (direct prisma calls, not createIntegrationConnection) — but those use 'line-oa' for LINE_GROUP/LINE_USER, different connection than LINE_OA channel this finding is about |

##### D4-connector-governance-02 — /platform/integrations exposes no disable, rotate, revoke, promote, delete, หรือ test-connection action

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | DECLARED_NOT_BUILT |
| **หลักฐาน** | `page.jsx:266` submitModel — only write action; 3 POST call sites ทั้งหมด (lines 274, 309, 338) ไม่มี rotate/revoke/promote/disable/test; `route.js:15` GET/POST only ไม่มี [id] sub-route; `ADR-032-INTEGRATION-SECRET-MANAGEMENT-UI.md:85` D5 names PATCH /[id], /[id]/secret, /rotate, /revoke, /promote |
| **สิ่งที่ควรเป็น** | ตาราง 'Implemented and deferred server operations' ของ ADR-032 D5 และ FR-080 ประกาศไว้ว่าควรมี lifecycle operation ครบทั้ง 5 รายการสำหรับจัดการ connection หลังจากสร้างแล้ว |
| **สิ่งที่เป็นจริง** | มีเพียง create + list เท่านั้นที่ทำงานได้จริง connection ที่ misconfigured หรือถูก compromise ไม่สามารถ disable ได้ secret ไม่สามารถ rotate/revoke ได้ connection ที่ไม่ใช่ primary ก็ promote ไม่ได้ ทั้งหมดนี้สอดคล้องกับสถานะ 'deferred follow-up port' ที่ FR-080/ADR-032 ระบุไว้แล้ว จึงไม่ใช่ doc drift แต่ connection ที่สร้างไปแล้วก็ยังจัดการต่อไม่ได้อยู่ดี |
| **ข้อเสนอแนะ** | ADR-032 ระบุรูปแบบ route ไว้แล้ว ขั้นต่อไปคือกำหนดตารางเวลาการสร้างจริงเป็น FR/AC แยกต่างหากอย่างชัดเจน (ควรทำ revoke ซึ่งสำคัญด้าน security ก่อน rotate/promote) ไม่ควรปล่อยให้เงียบหายไปเฉยๆ |
| **เกี่ยวข้อง** | D4-connector-governance-01 |
| **การตรวจสอบ** | CONFIRMED — verified exactly as stated; both ADR-032 D5 and FR-080 'Implemented and deferred' table (lines 120–132) explicitly list PATCH/secret/rotate/revoke/promote as deferred |

##### D4-connector-governance-05 — SyncCursor, ExternalEntityRef และ DeadLetterRecord declared owns_models โดยมี zero application writers

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | DECLARED_NOT_BUILT |
| **หลักฐาน** | `CHARTER.md:15,16,17` owns_models lists SyncCursor/ExternalEntityRef/DeadLetterRecord with the other 12 (full list `CHARTER.md:9-24`, 15 entries); `schema.prisma:1666,1688,1717` models declared; `backup-service.js:58` only app-code mention generic SNAPSHOT_MODELS list; `FR-081-raw-external-ingestion.md` 'DeadLetterRecord is likewise still unwritten' |
| **สิ่งที่ควรเป็น** | โมเดลใน owns_models ควรถูก read/write โดย substrate ของ domain นี้จริงๆ — SyncCursor ควร advance ทุกครั้งที่ pull สำเร็จ, ExternalEntityRef ควร map external id, DeadLetterRecord ควรบันทึกความล้มเหลวของการ ingest (ตาม FR-081 contract item 5) |
| **สิ่งที่เป็นจริง** | grep หา .create/.update/.upsert/.delete ของทั้งสามโมเดลทั่ว src/ ได้ผลลัพธ์เป็นศูนย์ เอกสาร FR-081 เองก็ระบุไว้แล้วว่า DeadLetterRecord ยังไม่ถูกเขียน ส่วน SyncCursor/ExternalEntityRef ก็เจอชะตากรรมเดียวกัน |
| **ข้อเสนอแนะ** | ต่อสายทั้งสามโมเดลเข้ากับช่องทาง acquisition ที่ใช้งานจริงช่องทางเดียว (LINE_OA webhook evidence) โดยเขียน DeadLetterRecord เมื่อ `ingestRawExternalRecord` ล้มเหลว (ตาม FR-081 contract item 5) หรือไม่ก็เพิ่มหมายเหตุชัดเจนใน FR-081 ว่าทั้งสามโมเดลยังเป็นแค่ schema จนกว่าจะมี pull-based adapter (FlowAccount, FR-125) ที่ต้องใช้งานจริง |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED — grep for .create/.update/.upsert/.delete on syncCursor/externalEntityRef/deadLetterRecord = zero results; only backup-service.js line 58 generic SNAPSHOT_MODELS loop |

##### D4-connector-governance-06 — PipelineReconciliation.evidenceJson hardcoded literal '{}' ไม่ว่า caller input

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | BROKEN_FLOW |
| **หลักฐาน** | `pipeline-tracking-service.js:548` literal `evidenceJson: '{}',` หลังจาก spreading caller-supplied `value`; `:573` contrast `evidenceJson: json(event.gate.evidence, {})` pipelineGateDecision.create DOES persist; `FR-129-catalog-publication-approval-gate.md` 'evidenceJson still written as \\'{}\\'' |
| **สิ่งที่ควรเป็น** | ตั้งแต่ SDD-075 เป็นต้นมา reconciliation record ควรพ่วง evidence ที่ caller แนบมาด้วย เหมือนกับที่ PipelineGateDecision.evidenceJson ทำอยู่ |
| **สิ่งที่เป็นจริง** | reconciliation writer เขียนค่า literal '{}' เสมอ ไม่ว่า caller จะส่งอะไรมาก็ตาม หมายเหตุของ FR-129 ยอมรับเรื่องนี้ไว้แล้วอย่างเปิดเผยว่าตั้งใจยังไม่แก้ |
| **ข้อเสนอแนะ** | นำ pattern `json(event.reconciliation?.evidence, {})` แบบเดียวกับที่ gate decision ใช้อยู่แล้ว (บรรทัด 573) มาใช้กับ reconciliation writer ภายใต้ AC ของตัวเองที่ติดตามแยกไว้ (หมายเหตุระบุว่าตั้งใจ defer ไว้รอการตัดสินใจ) ไม่ควรกลืนเข้าไปเงียบๆ กับ FR-129 |
| **เกี่ยวข้อง** | D4-connector-governance-07 |
| **การตรวจสอบ** | CONFIRMED — verified directly in code line 548 writes literal '{}' after spreading `...value` at line 547; sibling line 573 correctly persists json(event.gate.evidence, {}) |

##### D4-connector-governance-07 — ไม่มี authorization policy who may sign PipelineGateDecision — ไม่มี route create APPROVED catalog-publication decision

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | MISSING_SURFACE |
| **หลักฐาน** | `pipeline-tracking-service.js:404` recordPipelineEvent calls requireOperator only; `:46` definition checks isInstallationOperator ไม่มี Business-scoped signatory; `sot-decision-service.js:41` contrast requireDecider defines policy (isInstallationOperator OR ownsBusiness/ownsTenant); `FR-129-catalog-publication-approval-gate.md` 'No route creates decision... authorization policy a signing surface would implement is the blocker' |
| **สิ่งที่ควรเป็น** | run ของ DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1 ควรลงนามได้โดย authority ที่ policy กำหนดชื่อไว้ชัดเจน (แบบเดียวกับที่ FR-100 SotDecision ทำอยู่แล้ว) และควรผลิต PipelineGateDecision แบบ APPROVED/REJECTED ที่ตรวจสอบได้หลัง DPS-PUBLISH |
| **สิ่งที่เป็นจริง** | เส้นทางเดียวที่เขียน PipelineGateDecision ได้คือ POST /api/pipelines/runs/{id}/events ด้วย envelope แบบ GATE_UPDATED ซึ่งกันด้วย requireOperator — เฉพาะ installation operator เท่านั้น ไม่มี role ระดับ Business เลย ไม่มี browser surface ใดๆ รองรับ เหลือแค่ installation operator เรียก raw events API ตรงๆ ซึ่งตรวจพบได้ก็ต่อเมื่อเกิดขึ้นแล้ว (ผ่าน gateCompliance/PUBLISH_WITHOUT_APPROVAL) แต่ป้องกันล่วงหน้าไม่ได้ |
| **ข้อเสนอแนะ** | นี่คือการตัดสินใจของผลิตภัณฑ์ที่ยังค้างอยู่จริง ไม่ใช่ข้อบกพร่องของโค้ด — ต้องมีผู้มีอำนาจด้านผลิตภัณฑ์ตัดสินใจว่า (ก) ต้องมี gate ต่อ-definition หรือต่อ-run และ (ข) Membership/PlatformGrant ใดมีสิทธิ์ลงนามการ publish DPL ได้บ้าง โดย mirror pattern requireDecider ของ sot-decision-service.js แล้วจึงเพิ่ม signing route |
| **เกี่ยวข้อง** | D4-connector-governance-06, D4-connector-governance-08 |
| **การตรวจสอบ** | ADJUSTED — severity HIGH → MEDIUM: docs/PRD-SDD-v1.0.md FR-129 row (line 339) already documents exactly 'No route that creates an APPROVED decision exposed... Still blocked on that unmade product decision' rates FR-129 🟠 partial explicitly by design. Self-aware tracked blocker (matching finder's own recommendation 'genuine open product decision not code defect') MEDIUM fits better than HIGH |

##### D4-connector-governance-08 — FR-071 pipeline run ledger (steps, gates, gateCompliance violations, reconciliation) มี zero browser consumers

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | MISSING_SURFACE |
| **หลักฐาน** | `route.js:13` getPipelineMonitor returns steps/gates/gateCompliance/reconciliation rich response no page fetches (grep 'api/pipelines/runs' across pages = route files only); `sot-pipeline/page.jsx:75` only place run appears `{run.status} (<code>{run.executionRunId}</code>)` plain text ไม่ link; `product-readiness/page.jsx` unrelated dashboard |
| **สิ่งที่ควรเป็น** | ตาม FR-099 contract item 4 'per-phase evidence links (runs, pending decisions)' ควรมีลิงก์เชื่อมไปยังรายละเอียดจริง |
| **สิ่งที่เป็นจริง** | ครึ่งหนึ่งของ pending-decisions ทำงานได้จริง (ลิงก์เข้า FR-100 inbox) แต่ครึ่งของ runs ไม่มีลิงก์เลย — เป็นแค่ข้อความเฉยๆ executionRunId ไม่มีทางไปถึงรายละเอียด step/gate/reconciliation ได้ทางฝั่ง browser gateCompliance เป็น API-only ไม่มี browser ใดแสดงผลเลย หมายเหตุ: ช่องว่างนี้จำกัดเฉพาะฝั่ง browser เท่านั้น — ฝั่ง machine-to-machine ผ่าน MCP server (/api/mcp) มีผู้บริโภคจริงสำหรับ data_pipeline.monitor_read และ data_pipeline.replay_request อยู่แล้ว (ดู D4-external-ports-09) ledger นี้จึงไม่ได้ไร้ผู้บริโภคโดยสิ้นเชิง |
| **ข้อเสนอแนะ** | เพิ่มลิงก์ที่ขาดหายไปสู่ GET /api/pipelines/runs/{executionRunId} แล้ว render เป็นหน้ารายละเอียดแบบเบาๆ ใน /platform/sot-pipeline สำหรับ FR-099 item 4 หรือไม่ก็ลดขอบเขต contract ของ FR-099 ให้เป็นแค่ inform-only |
| **เกี่ยวข้อง** | D4-connector-governance-07 |
| **การตรวจสอบ** | CONFIRMED — grep across pages for 'api/pipelines/runs' finds no page consumer; sot-pipeline/page.jsx line 75 plain-text only; FR-099 line 48 promises 'per-phase evidence links (runs, pending decisions)' |

##### D4-connector-governance-10 — GATE_STATUSES ถูก export เป็นสองชุดค่าที่ไม่เหมือนกันจากสองไฟล์คนละที่ — เกิด source of truth ที่สอง

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | `src/lib/validation/enums.js:90` export `GATE_STATUSES = ['OPEN', 'PASSED', 'BLOCKED', 'WAIVED']` project-manager Gate model; `pipeline-tracking-contract.js:139` export `GATE_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED', 'WAIVED'])` pipeline gate decision completely different vocabulary; `:29` CONNECTION_KINDS defined locally; `:41` CONNECTOR_STATES/REASONS locally; `contracts.js:13` DATA_LANES locally |
| **สิ่งที่ควรเป็น** | ตาม CLAUDE.md: 'Enums are strings... src/lib/validation/enums.js as single source of truth... never hand-copy' |
| **สิ่งที่เป็นจริง** | enums.js ไม่มี entry ของ integration-domain เลยแม้แต่รายการเดียว (grep CONNECTION_KIND/CONNECTOR_STATE/DATA_LANES/PROVIDER_CODE/INTEGRATION ได้ศูนย์ match) ค่าคงที่ทั้งหมดของ integration/pipeline enum ถูกประกาศแยกกันในไฟล์ท้องถิ่น 5 ไฟล์ GATE_STATUSES ใช้ชื่อ export เดียวกันแต่ให้ความหมายคนละอย่างกันโดยสิ้นเชิง ไม่มี re-export หรือ namespace ใดแยกความกำกวม ไม่มีอะไร guard กันการ import ผิดตัวใน Zod schema เลย |
| **ข้อเสนอแนะ** | ทำได้สองทาง: (ก) แก้กฎใน CLAUDE.md อย่างเป็นทางการว่า enums.js เป็น authoritative สำหรับ domain project-manager/CRM/identity ส่วน enum ของ integration/pipeline ตั้งใจให้เป็น domain-local หรือ (ข) ย้ายค่าคงที่เข้า enums.js ด้วยชื่อที่มี prefix ของ domain (เช่น PIPELINE_GATE_STATUSES แทน GATE_STATUSES) เพื่อขจัดการชนกันของชื่ออย่างน้อยที่สุด |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED — src/lib/validation/enums.js:90 vs pipeline-tracking-contract.js:139 same name disjoint values only 'WAIVED' overlaps; grep enums.js CONNECTION_KIND/CONNECTOR_STATE/DATA_LANES/PROVIDER_CODE/INTEGRATION zero real matches |

##### D4-connector-governance-16 — FR-102 SotDataPlaneKey (เครดิตของ external data plane ของ SoT pipeline) ไม่มีแถว Inventory หรือ finding ใดๆ และ mint/revoke ได้เฉพาะจาก CLI script เท่านั้น ไม่มี listing, rotation หรือ expiry surface

| ฟิลด์ | รายละเอียด |
|--------|-------|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/modules/identity/sot-data-plane-auth.js:4-13 (`@req FR-102 ... @spec ADR-047, SEC-019`), :15 (`SOT_DATA_PLANE_KEY_PREFIX = 'sdpk'`), :31 (mintSotDataPlaneKey), :49 (revokeSotDataPlaneKey); src/app/api/platform/sot/decisions/route.js:23 (`viewer: (await resolveSotDataPlaneViewer(request)) ?? await resolveRequestViewer(request)` — POST ยอมรับ data-plane key viewer แทนที่ session viewer ได้); scripts/mint-sot-data-plane-key.mjs:2,44,55 (ผู้เรียกที่ไม่ใช่ test เพียงรายเดียว เป็น CLI ไม่มี route ไม่มีหน้าเว็บ); prisma/schema.prisma:1826 (model SotDataPlaneKey); docs/PRD-SDD-v1.0.md:312 (แถว FR-102) |
| สิ่งที่ควรเป็น | สายโซ่ของหน่วยนี้เองคือ "catalog ↔ adapter ↔ credential ↔ health ↔ ..." และ external data plane ที่ submit เข้า FR-100 ก็เป็นระบบภายนอกชั้นหนึ่งเช่นกัน เครดิตของมัน (SotDataPlaneKey ซึ่งเป็น bearer key `sdpk_...`) จึงควรมีแถว Inventory และควรถูกประเมิน lifecycle surface เช่นเดียวกับที่ D4-connector-governance-02 ประเมิน connection lifecycle ของ /platform/integrations |
| สิ่งที่เป็นจริง | รายงานนี้ระบุ policy การให้สิทธิ์ของ SotDecision (FR-100) ว่า `requireDecider: owner or operator` ซึ่งไม่ครบถ้วน เพราะ POST ที่ /api/platform/sot/decisions ยอมรับ data-plane key viewer แทนที่ session viewer ได้ด้วย (`resolveSotDataPlaneViewer(request) ?? await resolveRequestViewer(request)`) เครดิตตัวนี้ mint/revoke ได้เฉพาะผ่าน `scripts/mint-sot-data-plane-key.mjs` ซึ่งเป็น CLI เท่านั้น ไม่มี route ไม่มีหน้าเว็บ ไม่มี listing endpoint ให้ Tenant เห็น key ที่ยังใช้งานอยู่ของตัวเอง และไม่มี rotation หรือ expiry surface เลย — เป็นช่องว่างประเภทเดียวกับที่ D4-connector-governance-02 ชี้ไว้แล้วสำหรับ connection lifecycle แต่ยังไม่เคยถูกยกเป็น finding สำหรับเครดิตตัวนี้ |
| ข้อเสนอแนะ | เพิ่มแถว Inventory ใหม่ระบุ SotDataPlaneKey เป็น PARTIAL/MISSING_SURFACE และพิจารณาเพิ่ม route สำหรับ list/rotate key ของ Tenant ตนเอง (เทียบเคียงกับ pattern ของ ApiAccessKey ใน FR-106 ที่อย่างน้อยมี mint/revoke ผ่าน route แล้ว ดู D4-connector-governance-17) หรือบันทึกไว้อย่างชัดเจนว่า CLI-only เป็นความตั้งใจสำหรับเครดิตระดับนี้ |
| เกี่ยวข้อง | D4-connector-governance-02, D4-connector-governance-17 |
| การตรวจสอบ | critic-added — ยืนยันแล้วว่า sot-data-plane-auth.js:4-13,15,31,49 ตรงกับที่อ้าง, decisions/route.js:23 มี logic ตามที่ยกมาจริง, scripts/mint-sot-data-plane-key.mjs เป็นผู้เรียกเดียวนอก test, prisma/schema.prisma:1826 มีโมเดลจริง, docs/PRD-SDD-v1.0.md:312 มีแถว FR-102 ตรงตามที่ยกมา |

##### D4-connector-governance-17 — FR-106 ApiAccessKey (เครดิตของ Enterprise API ระดับ Tenant) มี route mint/revoke แต่ไม่มีผู้บริโภคฝั่ง browser เลย — API-with-no-UI

| ฟิลด์ | รายละเอียด |
|--------|-------|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | src/app/api/platform/api-access-keys/route.js:5-11 (`@req FR-106 ... @spec SEC-006, SEC-001, SEC-008, ADR-047`), :15-20 (POST mintApiAccessKey); src/app/api/platform/api-access-keys/[id]/route.js:15-20 (DELETE revokeApiAccessKey); `grep -rn "api-access-keys" src/app --include=*.jsx` = 0 hits; scripts/mint-api-access-key.mjs (CLI ทดแทน); prisma/schema.prisma:1854 (model ApiAccessKey); docs/PRD-SDD-v1.0.md:316 (แถว FR-106) |
| สิ่งที่ควรเป็น | briefing ของงานตรวจนี้ระบุ "API with no UI" เป็นประเภท finding ที่ต้องรายงานอย่างชัดเจน และรายงานฉบับนี้เองก็ยกรูปแบบเดียวกันไว้แล้วสำหรับ pipeline ledger (D4-connector-governance-08) และ OpenRouter OAuth (D4-in-repo-connectors-02) FR-106 ซึ่งเป็นเครดิตระดับ service-account ต่อ Tenant สำหรับ Enterprise API — ประตูสำหรับผู้เชื่อมต่อภายนอกที่ไม่ใช่ LINE ทุกราย — ควรถูกตรวจในลักษณะเดียวกัน |
| สิ่งที่เป็นจริง | route mint (POST) และ revoke (DELETE) มีอยู่จริงและมี @req FR-106 annotation ถูกต้อง แต่ `grep -rn "api-access-keys" src/app --include=*.jsx` ให้ผลลัพธ์เป็นศูนย์ — ไม่มี .jsx ใดใน src/app อ้างอิงถึงเลย หมายความว่า owner ต้อง hand-craft HTTP request เองเพื่อขอหรือเพิกถอน key และเนื่องจากไม่มี list endpoint ด้วย Tenant จึงไม่สามารถดูรายการ key ที่ตนเองมีอยู่ได้แม้แต่ทางเดียว ทางเดียวที่ใช้งานได้จริงคือ CLI (`scripts/mint-api-access-key.mjs`) |
| ข้อเสนอแนะ | เพิ่มแถว Inventory ใหม่ระบุ ApiAccessKey เป็น PARTIAL/MISSING_SURFACE และเพิ่มหน้า UI (เช่นใต้ /platform/integrations หรือหน้า Enterprise API settings ของตัวเอง) ที่เรียก mint/revoke route ที่มีอยู่แล้ว พร้อม list endpoint ใหม่ให้ Tenant เห็น key ของตนเอง หรือบันทึกไว้อย่างชัดเจนว่า CLI-only เป็นความตั้งใจสำหรับช่วง Phase นี้ |
| เกี่ยวข้อง | D4-connector-governance-16 |
| การตรวจสอบ | critic-added — ยืนยันแล้วว่า route.js:5-11,15-20 และ [id]/route.js:15-20 ตรงกับที่อ้าง, grep หา "api-access-keys" ใน src/app/**/*.jsx ได้ 0 hits จริง, scripts/mint-api-access-key.mjs มีอยู่จริง, prisma/schema.prisma:1854 มีโมเดลจริง, docs/PRD-SDD-v1.0.md:316 มีแถว FR-106 ตรงตามที่ยกมา |

##### D4-connector-governance-18 — heartbeat route ติด @tested ชี้ไปยัง test file ที่ไม่มีการอ้างอิงถึง heartbeat แม้แต่บรรทัดเดียว — หลักฐานการทดสอบเท็จ

| ฟิลด์ | รายละเอียด |
|--------|-------|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP |
| หลักฐาน | src/app/api/agent/heartbeat/route.js:8 (`// @tested tests/unit/fr080-ui-contract.test.js`); `grep -c -i "heartbeat" tests/unit/fr080-ui-contract.test.js` = 0; `grep -rli heartbeat tests/` คืนเฉพาะ tests/unit/pipeline-mcp-transport.test.js และ tests/unit/platform/pipeline-tracking-service.test.js ซึ่งตรงกับ event STEP_HEARTBEAT ของ pipeline ที่ไม่เกี่ยวข้องกัน ไม่ใช่ route นี้ |
| สิ่งที่ควรเป็น | `docs:graph` สร้างคอลัมน์ Tests ต่อ-FR ใน TRACE.md จาก annotation @tested แบบกลไกล้วนๆ เช่นเดียวกับที่ D4-connector-governance-12 ระบุไว้สำหรับ @req ดังนั้น @tested ก็ควรชี้ไปยัง test ที่ทดสอบไฟล์นั้นจริง |
| สิ่งที่เป็นจริง | D4-connector-governance-12 ชี้ถูกแล้วว่า @req FR-080 ของ route นี้ผิด และทำให้ TRACE.md ของ FR-080 ปนเปื้อน แต่ header เดียวกันนั้นยังมี `@tested tests/unit/fr080-ui-contract.test.js` ซึ่งไฟล์นั้นไม่มีการอ้างอิงถึง heartbeat เลยแม้แต่บรรทัดเดียว เนื่องจาก docs:graph เชื่อ annotation ตรงตัว สิ่งนี้ทำให้เกิดหลักฐานการทดสอบเท็จ (false test-evidence) อยู่หลัง route ที่ไม่มีการตรวจสอบสิทธิ์เลย (D4-connector-governance-15) — เป็นความล้มเหลวด้าน governance ที่ร้ายแรงกว่าการลอยของ @req เพราะการแก้ @req เพียงอย่างเดียวจะไม่ลบ @tested เท็จนี้ออกไป |
| ข้อเสนอแนะ | แก้ `@tested` ของ route นี้ให้ตรงกับความจริง (เช่น ระบุว่ายังไม่มี test หากยังไม่มีการเขียนทดสอบ หรือชี้ไปยัง test ที่เขียนขึ้นใหม่จริงสำหรับ FR ที่ประกาศใหม่ตามคำแนะนำของ D4-connector-governance-12) แล้วรัน `npm run docs:graph` ใหม่เพื่อให้ TRACE.md สะท้อนความจริง |
| เกี่ยวข้อง | D4-connector-governance-12, D4-connector-governance-15 |
| การตรวจสอบ | critic-added — ยืนยันแล้วว่า heartbeat/route.js:8 มี @tested บรรทัดนี้จริง, `grep -c -i heartbeat tests/unit/fr080-ui-contract.test.js` ได้ 0 จริง, และ `grep -rli heartbeat tests/` คืนเฉพาะสองไฟล์ที่ไม่เกี่ยวข้องกับ route นี้จริง |

##### D4-connector-governance-09 — FR-099/FR-100/FR-101 feature-note frontmatter status ล้าสมัย ('proposed') PRD-SDD marks implemented + code fully built

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | `FR-099-sot-pipeline-plan-board.md:7` status: proposed; `FR-100-sot-approval-inbox.md:7` status: proposed; `FR-101-sot-pipeline-graph-dashboard.md:7` status: proposed; `docs/PRD-SDD-v1.0.md:309-311` '✅ implemented; plan board + derived status + tests' etc; `docs/.preflight-report.json` summary 0 CRITICAL/0 WARNING confirms no check compares feature note frontmatter status to PRD-SDD status column or code presence |
| **สิ่งที่ควรเป็น** | สถานะใน frontmatter ของ feature note ควรติดตามว่าโค้ดที่อธิบายไว้มีอยู่จริงหรือไม่ เช่นเดียวกับที่ ADR-039 id-ledger คอย pin subject ของแต่ละ id ไว้ |
| **สิ่งที่เป็นจริง** | feature note ทั้ง 3 ฉบับยังคง 'proposed' ใน YAML frontmatter ทั้งที่โค้ดสร้างเสร็จสมบูรณ์แล้ว (หน้าเว็บ, route, service, test) และ PRD registry ก็ระบุ ✅ แล้ว ไม่มี automated check ใดเปรียบเทียบความไม่ตรงกันนี้เลย จึงเป็นช่องว่างที่มองไม่เห็นในเครื่องมือ governance |
| **ข้อเสนอแนะ** | อัปเดต frontmatter ทั้ง 3 บล็อกเป็น `status: implemented` และพิจารณาเพิ่ม preflight check ที่ตรวจว่าสถานะ frontmatter ของ feature note ไม่ตรงกับคอลัมน์สถานะใน PRD-SDD แบบเดียวกับที่ Check 12 คอยตรวจ id-subject drift |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED — all 3 notes' frontmatter 'status: proposed'; docs/PRD-SDD-v1.0.md rows 309–311 '✅ implemented' with closure details; docs/.preflight-report.json summary {critical:0, warning:0, info:23, overall:'PASS'} |

##### D4-connector-governance-11 — ADR-038's named market-source Integration adapters exist 2 unwired formatting functions untracked FR absent charter Public contracts

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | LOW |
| **ประเภท** | MISSING_SURFACE |
| **หลักฐาน** | `ADR-038-MARKET-INTELLIGENCE-DOMAIN-BOUNDARY.md:74` D3: 'Market sources such as Facebook, Lotus's, 7-Eleven, Makro, Big C, Shopee, Lazada TikTok Shop are Integration provider adapters'; `marketplace-listing-adapter.js:2` @req FR-081, FR-092; `retail-price-adapter.js:1` companion adapter; `CHARTER.md:86` 'Public contracts' 10 files neither adapter among |
| **สิ่งที่ควรเป็น** | provider adapter ตามหมวดที่ ADR ตั้งชื่อไว้ควร traceable กลับไปยัง lane ที่ charter อ้างสิทธิ์ และควรเข้าถึงได้ผ่าน registry entry/route จริง |
| **สิ่งที่เป็นจริง** | grep หา adapter ทั้งสองไฟล์ได้ผู้เรียกเป็นศูนย์นอกจาก unit test ของตัวเอง ไม่มี route, ไม่มีแถว seed ของ IntegrationProvider, ไม่มี entry ใน connector-catalog และไม่มี scheduler ใดเรียกใช้ เป็นเพียงฟังก์ชัน formatting payload ล้วนๆ ที่ไม่ได้ต่อสายเข้าช่องทาง acquisition ใดเลย และไม่ปรากฏในรายการ 'Public contracts' ของ charter ด้วย |
| **ข้อเสนอแนะ** | เพิ่มไฟล์ adapter ทั้งสองเข้าในรายการ Public contracts ของ charter (เป็นสิ่งประดิษฐ์จริงของ @req FR-081/FR-092) และเปิด FR note ที่ติดตามแยกไว้ว่าฝั่ง acquisition ของ FR-092/ADR-038 market-source ยังเป็น design-only นอกเหนือจากฟังก์ชัน formatting เพื่อไม่ให้ช่องว่างระหว่างรายการ provider ที่ ADR ตั้งชื่อไว้กับการต่อสายจริงถูกค้นพบได้แค่ผ่าน grep เท่านั้น |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED — grep adapters across src/ (excluding tests) = zero callers; docs/domains/integration/CHARTER.md lines 80–115 (Public contracts list neither present); ADR-038 D3 line 74 names market-source provider list |

##### D4-connector-governance-12 — src/app/api/agent/heartbeat/route.js annotated @req FR-080 pollutes FR-080's generated TRACE.md

| ฟิลด์ | รายละเอียด |
|------|----------|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | `/api/agent/heartbeat/route.js:6` `// @req FR-080 — Device Pairing & Real-time Edge Heartbeat Gate`; `:25` in-memory `globalForDevices.__zuriEdgeDevices` Map not Prisma resets per process; `docs/TRACE.md:632` generated FR-080 entry's Code list includes heartbeat route purely annotation; `FR-080-integration-secret-management-ui.md` FR contract entirely IntegrationProvider/Connection/Credential metadata management no mention device pairing heartbeats edge runtime |
| **สิ่งที่ควรเป็น** | @req annotation ควรชี้ไปยัง requirement ที่ไฟล์นั้นอธิบาย contract จริงๆ เพราะ docs:graph สร้าง Code list ต่อ-FR ใน TRACE.md จาก annotation เหล่านี้แบบกลไกล้วนๆ |
| **สิ่งที่เป็นจริง** | FR-080 'Integration Secret Manager management UI' คือ surface สำหรับจัดการ connection metadata ระดับ Business แต่ route heartbeat นี้ทำเรื่องคนละเรื่องเลย (probe วัดความมีชีวิตของ edge-device แบบ in-memory ไม่ persist) ไม่มีความเกี่ยวข้องกับ Zod contract หรือ acceptance criteria ของ FR-080 เลย docs:graph เชื่อ annotation ตรงตัว ทำให้ TRACE.md ตอนนี้แสดงไฟล์นี้เป็นหลักฐาน 'Code' ของ FR-080 ซึ่งทำให้ผู้อ่าน TRACE.md เข้าใจผิดว่า FR-080 ถูกสร้างครบแล้ว หมายเหตุ: header เดียวกันนี้ยังมี `@tested tests/unit/fr080-ui-contract.test.js` ซึ่งไม่มีการอ้างอิงถึง heartbeat เลยแม้แต่บรรทัดเดียว — เป็นหลักฐานการทดสอบเท็จอีกชั้นหนึ่งที่ร้ายแรงกว่า @req drift เพราะการแก้ @req เพียงอย่างเดียวจะไม่ลบ @tested เท็จนี้ออกไป (ดู D4-connector-governance-18) |
| **ข้อเสนอแนะ** | แก้ annotation โดยประกาศ FR ใหม่สำหรับ edge-device pairing/heartbeat (ตาม CLAUDE.md การใช้ id ที่ยังไม่ประกาศใน @req จะถูก preflight ตีเป็น CRITICAL ดังนั้นการใช้ FR-080 ค้างไว้อาจถูกยอมรับชั่วคราวเพราะไม่มี id ของตัวเอง แต่นั่นก็บดบังช่องว่างจริงที่ edge-heartbeat ยังไม่มี requirement เป็นของตัวเอง) แล้วจึงรัน docs:graph ใหม่เพื่อ regenerate TRACE.md พร้อมแก้ `@tested` ให้ตรงกับความจริงไปพร้อมกัน (ดู D4-connector-governance-18) |
| **เกี่ยวข้อง** | D4-connector-governance-18 |
| **การตรวจสอบ** | CONFIRMED — heartbeat/route.js line 6 carries @req FR-080; file implements in-memory globalForDevices unrelated FR-080 secret management; docs/TRACE.md line 632 lists heartbeat under FR-080 Code; grep 'heartbeat\|device pairing\|edge' FR-080 feature note = zero matches |

#### ข้อจำกัดการตรวจ

**ตัวค้นหา:** อ่านเต็มที่ docs/domains/integration/CHARTER.md; ทั้ง 9 feature notes ที่ชื่อ (FR-079,080,081,099,100,101,125,129,130); ADR-032, ADR-035, ADR-038, ADR-053; PRD-SDD rows FR-079/080/081/099–102/125/129/130; docs/TRACE.md FR-080/081 entries; docs/roadmap/ROADMAP.md TASK-FR-080/130 rows; docs/.preflight-report.json summary อ่านเต็มที่: src/platform/integrations/core 12 ไฟล์หลัก (~600/900+ lines); src/modules/integration/application 3 ไฟล์; src/modules/integration/adapters 2 ไฟล์; src/app/api/platform/integrations route ทั้งหมด; src/app/(pm)/platform/sot-pipeline page.jsx ทั้งหมด (1245 lines) + sot-pipeline/page.jsx ทั้งหมด; src/app/api/agent/heartbeat/route.js บางส่วน; src/lib/validation/enums.js ทั้งหมด (297 lines); src/modules/project-manager/application/audit.js บางส่วน + backup-service.js บางส่วน

**Grep-only** (ไฟล์ไม่เปิด line-by-line แต่ grep hit lists ตรวจสอบ): Prisma models ทั้งหมด charter's owns_models across src/ สำหรับ .create/.update/.upsert/.delete usage; @req annotations FR-099/100/101/129/130 ใน tests/; provider-name strings (LINE_OA, line-oa, FlowAccount, 8 ตลาด) across src/

**ไม่เปิด:** full body pipeline-tracking-service.js นอก writer/gate/reconciliation/replay sections (~900+ lines total; getPipelineMonitor, listPipelineRuns, replay-selection logic past ~820 skimmed grep context only); full test bodies tests/unit/platform/pipeline-tracking-service.test.js, tests/integration/sot-decisions-route.test.js, tests/integration/fr129-catalog-publication-gate.test.js, tests/integration/line-oa-cross-repo-round-trip.test.js (existence confirmed grep ไม่อ่าน); prisma/seed.js ทั้งหมด (only grepped "LINE_OA"); docs/change-requests/CR-003/CR-004 (referenced FR-129/130 ไม่เปิด content quoted secondhand); ADR-053 sections 6–15 (past D-decision headers); full sot-pipeline inbox/graph page.jsx bodies (confirmed exist via `find` + feature notes ไม่ read line-by-line)

**ขอบเขต sibling audit:** deliberately ไม่ derive full connector-by-connector build status table (in-repo-connectors/external-ports units own that scope) focused governance-shaped gaps (authorization, scoping, dead-end data flows, doc-vs-code drift)

**นับ:** 9 feature notes read full; 4 ADRs (2 full — ADR-032, ADR-038; ADR-035 header+table only design-only; ADR-053 header+D-list only) 14 owns_models grepped writers (11 found writers 3 zero) 12 findings original all direct file:line evidence opened; preflight report (0 critical/0 warning) confirms 12 ไม่ caught existing governance **Verifier:** opened every cited file region grep/sed 12 findings; targeted greps src/ (+ migrations) independently confirm 'zero callers/writers/tests' claims all 12 core evidence held under direct inspection nothing REFUTED 2 ADJUSTED downward (D4-01, D4-07) remaining 10 CONFIRMED as stated 3 new findings (D4-13, D4-14, D4-15) governance-shaped gaps (authorization, scoping, dead-end) within unit scope

## ข้อเสนอแนะเรียงตามลำดับความสำคัญ

### ทำได้ทันทีในโค้ด

1. แก้ signature การเรียก `recordAudit()` ใน `src/modules/integration/application/line-registry-service.js` (saveLineGroup บรรทัด 184 และ saveLineUser บรรทัด 271) ให้ส่ง `db`/`prisma` เป็น argument แรกตามที่ `src/modules/project-manager/application/audit.js:6` กำหนด และแก้ชื่อ field `changes:` เป็น `payload:` พร้อมเพิ่ม assertion ใน `tests/unit/line-registry-service.test.js` ว่ามี AuditEvent row ถูกสร้างจริง — ปิด **D4-connector-governance-03**
2. แก้ `listLineRegistry` (`line-registry-service.js:57,61`) ให้ scope where-clause เป็น `businessId: { in: viewer.ownedBusinessIds }` เมื่อไม่ระบุ `businessId` แทนการไม่กรองเลย (mirror pattern ของ `listPhase1Integrations`) และเพิ่ม regression test ที่ยืนยันว่า viewer จากผู้เช่าหนึ่งไม่เห็นแถวของผู้เช่าอื่น — ปิด **D4-connector-governance-13**
3. เพิ่ม `resolveRequestViewer` และการตรวจสอบสิทธิ์/ขอบเขตให้ POST และ DELETE ของ `src/app/api/agent/heartbeat/route.js` และเปลี่ยน key ของ `globalForDevices.__zuriEdgeDevices` จาก `deviceId` เดี่ยวเป็น `(tenantId, businessId, deviceId)` — ปิด **D4-connector-governance-15**
4. แก้ผู้เขียน `PipelineReconciliation` ใน `pipeline-tracking-service.js:548` ให้ persist `evidenceJson` จริงตาม pattern เดียวกับ `pipelineGateDecision.create` ที่บรรทัด 573 (`json(event.reconciliation?.evidence, {})`) แทนการ hardcode `'{}'` — ปิด **D4-connector-governance-06**
5. แก้ annotation `@req FR-080` ใน `src/app/api/agent/heartbeat/route.js:6` ให้ตรงกับ requirement จริงของไฟล์ (ประกาศ FR ใหม่สำหรับ edge-device heartbeat หากยังไม่มี id) แล้วรัน `npm run docs:graph` ใหม่เพื่อล้าง `docs/TRACE.md` — ปิด **D4-connector-governance-12**
6. อัปเดต frontmatter `status:` ของ `docs/domains/integration/features/FR-099-*.md`, `FR-100-*.md`, `FR-101-*.md` จาก `proposed` เป็น `implemented` ให้ตรงกับ `docs/PRD-SDD-v1.0.md` แถว 309–311 และโค้ดที่สร้างเสร็จแล้ว — ปิด **D4-connector-governance-09**
7. เพิ่ม 3 ไทล์ `AI_MODELS` (openai, anthropic, groq) ใน `CONNECTOR_CATALOG` (`connector-catalog.js`) ให้ครบตาม `PUBLIC_LINE_PROVIDERS` หรือบันทึกไว้อย่างชัดเจนว่าเป็นการเลือก curation ที่ตั้งใจแสดงเพียง 2 ไทล์ — ปิด **D4-in-repo-connectors-08**

### ต้องมี migration/production gate

8. เพิ่ม CI gate สองรายการใน `.github/workflows/governance.yml`: (ก) รัน `npm run db:pg:schema` แล้ว diff กับ `prisma/schema.postgres.prisma`/`prisma/postgres/0001_init.sql` ที่ commit ไว้ ให้ fail เมื่อมีผลต่าง (ข) รัน `python -m unittest` บน `tests/python/` เมื่อไฟล์ใน SmartGift data lane เปลี่ยน — ปิด **D4-external-ports-06, D4-external-ports-07**
9. คืนดีเส้นทางอ่าน-เขียนของ connection ใน production: ทำให้เส้นทางสร้าง/promote/rotate ของ FR-080 (`integration-management-service.js`, `integration-registry.js`) เขียนเข้า `zuri_core.integration_connection/_provider/_credential` โดยตรง หรือเปลี่ยน `resolvePhase1PrimaryConnectionByQuery` ให้ query ตาราง Prisma-mapped แทน พร้อม integration test ที่ขับ `POST /api/platform/integrations` แล้วยืนยันว่า runtime resolve แถวนั้นได้จริง — ปิด **D4-in-repo-connectors-01**
10. ต่อสาย MSP memory port (`createAgentPorts`/`mspTransport`) เข้ากับ `createPhase1BusinessAgentPortsFromEnv` (production factory ใน `phase1-runtime.js`) แล้วปรับสถานะ FR-029 เป็น 🟠 พร้อมหมายเหตุจนกว่าจะเสร็จ — ปิด **D4-external-ports-01, D4-external-ports-03**
11. ต่อสาย GKS knowledge reader (`createGraphKnowledgeReader`) เข้ากับ production LINE turn ใน `phase1-runtime.js`/`context.js` แทนการพึ่ง Prisma `queryKnowledge` เพียงอย่างเดียว — ปิด **D4-external-ports-02**
12. เพิ่ม `crons` entry ใน `vercel.json` (ปัจจุบันมีเพียง `$schema`/`regions` ไม่มี `crons` เลย) ที่ยิงไปยัง POST route ใหม่ที่ผ่าน `resolveRequestViewer`/operator-authenticated เรียก `projectKnowledgeGraph` กับ `createGenesisBlockDBSink` ตามตารางเวลาจริง (หรือ trigger จาก relation-write event แทนก็ได้) พร้อม integration test ยืนยันการเรียกนอก test harness — ก่อน route ใหม่นี้จะติด `@req` ได้ ต้องประกาศ requirement ใหม่ใน `docs/PRD-SDD-v1.0.md` แล้ว pin ด้วย `npm run docs:ids -- --write` ก่อน มิฉะนั้น preflight จะ fail เพราะเป็น id ที่ยังไม่ประกาศ — ปิด **D4-external-ports-08**
13. ทำ one-time data migration รวม `IntegrationProvider` rows ที่มี `code:'line-oa'` (lowercase) เข้ากับ `LINE_OA_PROVIDER_CODE='LINE_OA'` และแก้ literal ใน `line-registry-service.js` (บรรทัด 62, 121, ~208) ให้ import ค่าคงที่แทนการ hardcode string — ปิด **D4-connector-governance-04, D4-in-repo-connectors-05**
14. สร้าง operator-facing provisioning route หรือ CLI ที่เรียก `registerIntegrationProvider` + `createIntegrationConnection` พร้อม audit trail สำหรับสร้าง connection `LINE_OA` และ `SMARTGIFT_DOCUMENT_INTAKE` แบบทั่วไป (generalize จาก migration เดี่ยวที่ hardcode Business UUID เดียว) — ปิด **D4-in-repo-connectors-07, D4-connector-governance-01**
15. เพิ่ม lifecycle routes สำหรับ connection ตาม ADR-032 D5: `PATCH /api/platform/integrations/:id`, `/:id/secret`, `/:id/rotate`, `/:id/revoke`, `/:id/promote` เรียก `promotePhase1PrimaryConnection`/`upsertIntegrationCredentialMetadata` ที่มีอยู่แล้วพร้อมบันทึก audit event — ปิด **D4-connector-governance-02, D4-in-repo-connectors-04**
16. ตั้งค่า `ZURI_CLI_DIST` ใน `.github/workflows/governance.yml` (checkout/build zuri-cli อ้างอิงที่ pin เวอร์ชันไว้) เพื่อให้ `tests/integration/line-oa-cross-repo-round-trip.test.js` รันจริงใน CI แทนการ skip ตลอดไป หรือถ้ายังทำไม่ได้ในตอนนี้ ให้บันทึกใน ROADMAP/PRD อย่างชัดเจนว่าการพิสูจน์ BR-011 เป็นแบบ manual-only พร้อมชื่อผู้รันและวันที่ล่าสุด — ปิด **D4-external-ports-05**

### ต้องการการตัดสินใจจากเจ้าของผลิตภัณฑ์

17. ตัดสินใจ authorization policy ว่าใครมีสิทธิ์ลงนาม `PipelineGateDecision` สำหรับ catalog-publication approval (per-definition หรือ per-run, Membership/PlatformGrant ใดบ้าง) โดย mirror pattern `requireDecider` ที่มีอยู่แล้วใน `sot-decision-service.js:41` จากนั้นจึงเปิด signing route — ปิด **D4-connector-governance-07** (เชื่อมกับ D4-connector-governance-08 เรื่อง UI แสดงผล run ledger)
18. ตัดสินใจอนาคตของ automation "daily report" ใน LINE Group: ลงทุนสร้าง scheduler/executor จริง — เช่นเดียวกับข้อ 12 ให้เพิ่ม `crons` entry ใน `vercel.json` ยิงไปยัง POST route ใหม่ที่อ่าน `automationJobs` ที่ active แล้ว dispatch `PUSH_DAILY_SALES_REPORT` โดยต้องประกาศ requirement ใหม่ใน `docs/PRD-SDD-v1.0.md` แล้ว pin ด้วย `npm run docs:ids -- --write` ก่อนจึงจะติด `@req` บน route นั้นได้ (มิฉะนั้น preflight จะ fail เพราะเป็น id ที่ยังไม่ประกาศ) หรือถอด UI/schema ที่ทำให้ผู้ใช้เข้าใจผิดว่าเปิดใช้งานได้จริงออกจนกว่าจะพร้อม — ปิด **D4-connector-governance-14**
19. ตัดสินใจอนาคตของเส้นทางที่ "สร้างแล้วแต่ไม่ต่อสาย" สามจุด: (ก) OpenRouter OAuth (PKCE) — เพิ่ม callback route/ปุ่ม UI จริง หรือแก้สถานะ FR-048 ให้ตรงกับความเป็นจริง (ข) Market Intelligence raw-ingestion adapters (marketplace-listing-adapter, retail-price-adapter) — แปลง payload ให้เข้ากับ `zIngestionEnvelope` แล้วต่อเข้า `ingestRawExternalRecord` จริง หรือลดสถานะ FR-092/BR-019 ฝั่ง acquisition ใน PRD-SDD (ค) ADR-038 D3 market-source adapters ที่ไม่อยู่ใน charter's Public contracts — เพิ่มเข้ารายการหรือเปิด FR ติดตามแยก — ปิด **D4-in-repo-connectors-02, D4-in-repo-connectors-03, D4-external-ports-04, D4-connector-governance-11**
20. ทบทวนและมอบหมายเจ้าของให้กับกลุ่มช่องว่างระดับต่ำที่เหลือซึ่งเป็น backlog ที่ยังไม่มี FR/AC ของตัวเอง ได้แก่: SyncCursor/ExternalEntityRef/DeadLetterRecord ยังเป็น schema-only จนกว่าจะมี pull-based adapter (FR-081/FR-125) ต้องใช้งานจริง (**D4-in-repo-connectors-06, D4-connector-governance-05**); เพิ่ม `DATA_SOURCE` kind ใน `CONNECTION_KINDS` เมื่อ FR-125 หรือ market adapters ถูก prioritize (**D4-in-repo-connectors-09**); เพิ่ม dev script exercise เส้นทาง `LOCAL_FILE` vault แบบ end-to-end หรือระบุว่าเป็น unit-test fixture เท่านั้น (**D4-in-repo-connectors-10**); เพิ่มหน้า detail เชื่อม `GET /api/pipelines/runs/{id}` เข้ากับ `/platform/sot-pipeline` สำหรับ FR-099 item 4 (**D4-connector-governance-08**); และตัดสินใจว่าจะรวม/แยก `GATE_STATUSES` ที่ชนกันระหว่าง `src/lib/validation/enums.js` กับ `pipeline-tracking-contract.js` อย่างไร — แก้ชื่อให้ไม่ชนกันหรือแก้ไข CLAUDE.md ให้ยอมรับ domain-local enum อย่างเป็นทางการ (**D4-connector-governance-10**)

## ภาคผนวก ก — รายการที่ถูกตัดออกหลังตรวจสอบ

ทั้งสามหน่วยตรวจ (in-repo-connectors, external-ports, connector-governance) รายงานว่า **ไม่มี finding ที่ถูกตัดออก** (dropped=[]) ในขั้นตอน adversarial-verifier ของมิตินี้ — ทุก candidate finding ที่ finder เสนอผ่านเข้าสู่รายการ finding สุดท้าย อย่างไรก็ตาม verifier ได้ **ปรับลดระดับความรุนแรง (ADJUSTED)** ของ 2 finding ในหน่วย connector-governance โดยไม่ได้ตัดออก:

- **D4-connector-governance-01** — ปรับจาก HIGH เป็น MEDIUM เพราะ `docs/domains/integration/features/FR-081-raw-external-ingestion.md` (บรรทัด 102–106) ได้บันทึกช่องว่างนี้ไว้แล้วอย่างชัดเจนพร้อมระบุขั้นตอนที่ operator ต้องทำ ทำให้เป็น "tracked limitation" ไม่ใช่ "silent hole" ที่ไม่มีใครรู้
- **D4-connector-governance-07** — ปรับจาก HIGH เป็น MEDIUM เพราะ `docs/PRD-SDD-v1.0.md` แถว FR-129 (บรรทัด 339) ได้ระบุไว้แล้วอย่างตรงไปตรงมาว่า "No route that creates an APPROVED decision exposed... Still blocked on that unmade product decision" และให้สถานะ 🟠 partial โดยเจตนา — เป็นการตัดสินใจผลิตภัณฑ์ที่ยังไม่เกิดขึ้น ไม่ใช่ข้อบกพร่องของโค้ดที่ถูกซ่อนไว้

การปรับทั้งสองครั้งเป็นไปในทิศทางเดียวกัน คือ finder ประเมินความรุนแรงจากมุมมอง "โค้ดยังไม่มี" อย่างเดียว ในขณะที่ verifier ตรวจสอบเพิ่มเติมว่าเอกสารของ FR/PRD ได้เปิดเผยข้อจำกัดนี้ไว้แล้วหรือไม่ — เมื่อพบว่าเปิดเผยไว้แล้วอย่างชัดเจน ระดับความรุนแรงจึงลดลงจาก "ช่องว่างที่ซ่อนอยู่" เป็น "ภาระงานที่ทราบอยู่แล้วและรอการตัดสินใจ/ลงมือทำ" แต่ finding ยังคงอยู่ในรายงานเนื่องจากช่องว่างที่แท้จริง (ไม่มีโค้ดที่ทำงานได้) ยังไม่ได้รับการแก้ไข

## ภาคผนวก ข — ข้อจำกัดของการวิเคราะห์

การวิเคราะห์ในมิตินี้เป็นการตรวจสอบแบบ **static analysis เท่านั้น** — ไม่มีการรันเซิร์ฟเวอร์พัฒนา (`npm run dev`), ไม่มีการรัน `npm test`/`npm run test:e2e`/`npm run build`, ไม่มีการรัน `docs:graph`/`docs:preflight`, และไม่มีการเข้าถึงสภาพแวดล้อม production หรือ Supabase จริงใดๆ (สอดคล้องกับข้อกำหนด read-only ของงานนี้) ข้อสรุปทั้งหมดมาจากการอ่านซอร์สโค้ด, grep แบบ repo-wide, และการอ่านเอกสารที่ HEAD ของวันที่ 2026-09-02 เท่านั้น ต่อไปนี้เป็นข้อจำกัดเฉพาะที่รวมจากทั้งสามหน่วยตรวจ:

**ขอบเขตการอ่านไฟล์ (รวมจากทั้ง 3 หน่วย):**
- หน่วย in-repo-connectors อ่านไฟล์หลัก 23 ไฟล์แบบเต็ม (~2,860 บรรทัด) และไฟล์เสริมอีกจำนวนหนึ่งแบบ partial/grep-level ไม่ได้ตรวจสอบไฟล์ที่ดูเหมือนเป็นพื้นที่ external-ports/IAM/activation-gates (เช่น `line-channel-binding`, `line-binding-resolver`, `step-up`, `write-tools`, `msp-memory-port` ฯลฯ) เพราะอยู่นอกขอบเขตที่มอบหมาย
- หน่วย external-ports อ่านไฟล์ 27 ไฟล์แบบเต็มหรือ targeted ไม่ได้เปิด `supabase/migrations/*.sql` ทั้ง 30 ไฟล์แบบเต็ม (grep แทน), ไม่ได้เปิด `tests/unit/platform/connector-catalog.test.js` แบบเต็ม, ไม่ได้เปิด `docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md` แบบเต็ม
- หน่วย connector-governance อ่านเต็ม 9 feature notes, 2 ADR แบบเต็ม (ADR-032, ADR-038; ADR-035/ADR-053 อ่านเฉพาะส่วนหัว/ตาราง status) และไฟล์หลักของ integration/pipeline lane; ไม่ได้เปิด `pipeline-tracking-service.js` ทั้งไฟล์ (เฉพาะส่วน writer/gate/reconciliation/replay, ~900+ บรรทัดทั้งหมด), ไม่ได้เปิด test bodies แบบเต็มของ 4 test suites หลัก (ยืนยันการมีอยู่ผ่าน grep เท่านั้น), ไม่ได้เปิด `prisma/seed.js` แบบเต็ม (grep เฉพาะ "LINE_OA")

**พฤติกรรม runtime ที่ยืนยันไม่ได้:** ทุกข้อสรุปเรื่อง "ไม่มีผู้เรียก" หรือ "ไม่เคยถูกต่อสายใน production" มาจาก repo-wide grep แบบ cross-check สองทิศทาง (จุดนิยาม export ↔ grep หา call site ทั่วเรโพ) ไม่ใช่การสังเกตพฤติกรรมจริงขณะรัน เพราะไม่มีการเริ่มเซิร์ฟเวอร์หรือเชื่อมต่อ MSP/GKS/GenesisBlockDB/Supabase ของจริง ดังนั้นความเป็นไปได้ที่เหลืออยู่ (แม้จะต่ำมาก) คือมี dynamic import, feature flag runtime, หรือ environment variable ที่ไม่ปรากฏจาก static grep ซึ่งเปิดใช้เส้นทางเหล่านี้ในบางค่า config ที่ไม่ได้ตรวจพบ

**การตีความสถานะ PRD-SDD:** สถานะ (✅/🟠/🔜) ในตารางแผงหน้าของ `docs/PRD-SDD-v1.0.md` ถูกนำมาใช้ตามตัวอักษรตามที่ระบุไว้ (face value) **ยกเว้น** กรณีที่โค้ดจริงขัดแย้งอย่างชัดเจน ซึ่งกรณีนั้นถูกยกเป็น finding ประเภท DOC_DRIFT แทนการแก้ไขสถานะเอง (เช่น D4-external-ports-03, D4-external-ports-08, D4-connector-governance-09) ไม่มีการตรวจสอบว่าสถานะ ✅ อื่นๆ ที่ไม่ถูกหยิบยกเป็น finding มีช่องว่างซ่อนอยู่ในลักษณะเดียวกันหรือไม่ เนื่องจากอยู่นอกขอบเขต connector/integration ของมิตินี้

**ความไม่แน่นอนที่ยังไม่คลี่คลาย:** ไม่สามารถยืนยันจากการวิเคราะห์แบบ static ได้ว่าช่องว่างการต่อสาย production ของ FR-029/FR-024 (MSP/GKS/GenesisBlockDB) เป็นการยอมรับความเสี่ยงระดับกลางที่ตั้งใจ (เหมือน FR-057/FR-079/FR-080/FR-081 ที่มีคำสงวนชัดเจน) หรือเป็นการมองข้ามในเอกสาร — รายงานนี้เลือกจัดเป็น doc drift ตามรูปแบบที่ทีมใช้กับ requirement อื่นที่มีลักษณะคล้ายกัน แทนการสันนิษฐานว่าเป็นเจตนา ผู้อ่านควรยืนยันกับเจ้าของผลิตภัณฑ์ก่อนตัดสินใจเปลี่ยนสถานะ PRD-SDD จริง
