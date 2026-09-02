# มิติที่ 2 — Domain-driven gap analysis ทีละ domain (charter ↔ code ↔ models ↔ routes ↔ FR registry ↔ tests ↔ roadmap)

| ฟิลด์ | ค่า |
|---|---|
| รายงาน | มิติที่ 2 — Domain-driven gap analysis ทีละ domain (charter ↔ code ↔ models ↔ routes ↔ FR registry ↔ tests ↔ roadmap) |
| วันที่ | 2026-09-02 |
| ขอบเขต | ตรวจสอบทีละ domain แยก 10 หน่วย (agent, crm, identity, integration, knowledge, market-intelligence, platform-control, project-manager, business, people) โดยเปรียบเทียบสิ่งที่ charter ของแต่ละ domain ประกาศว่าเป็นเจ้าของ กับสิ่งที่ code, Prisma schema, API/page routes, คอลัมน์สถานะใน docs/PRD-SDD-v1.0.md, feature notes, docs/TRACE.md, docs/FEATURE-MAP.md/DOMAIN-MAP.md และ tests แสดงอยู่จริง — รายงานสิ่งที่ประกาศแต่ไม่สร้าง (declared-but-unbuilt), สร้างแต่ไม่ประกาศ (built-but-undeclared), การละเมิดขอบเขต domain (cross-domain writes/imports ที่ข้ามสัญญาสาธารณะที่ประกาศไว้), ประตูการผลิตที่ยังเปิดอยู่ (open production gates), เส้นทางที่ตัน (data เขียนแล้วไม่มีใครอ่าน หรือ UI ไม่มี API/API ไม่มี UI) และช่องว่างของการทดสอบ |
| วิธีการ | 10 หน่วยงาน (หนึ่งหน่วยต่อหนึ่ง domain) แต่ละหน่วยรัน pipeline: finder (ไล่อ่าน charter/code/schema/routes/PRD/TRACE/tests เพื่อรวบรวมหลักฐาน) → adversarial verifier (ยืนยัน/ปรับระดับความรุนแรง/เพิ่ม finding ใหม่ด้วยการอ่านไฟล์ตรงและ grep อิสระ ไม่เชื่อ finder เปล่าๆ) → section (ประกอบ Inventory + Findings ของหน่วยนั้น) → assemble (รวมทั้ง 10 หน่วยเป็นรายงานเดียว พร้อมตารางสรุป/ข้อเสนอแนะ/ภาคผนวก) → critic (ตรวจสอบว่า finding id ทุกตัวจากทุก section ปรากฏในตารางสรุปครบ และนับสถิติใหม่ด้วยตัวเอง ไม่เชื่อตัวเลขที่ unit สรุปไว้เอง) หลักฐานทุกจุดอ้าง file:line จาก repository ที่ HEAD ณ วันที่ 2026-09-02 (commit ล่าสุดที่ตรวจคือ 4306a29) การวิเคราะห์นี้เป็น static analysis ล้วน — ไม่มีการรัน npm test/build/docs:preflight จริง อาศัยไฟล์ที่ commit ไว้แล้ว (docs/.preflight-report.json, docs/.doc-graph.json, docs/.domain-state.json, docs/.id-ledger.json) แทนการรันสด |
| แหล่งอ้างอิงหลัก | docs/PRD-SDD-v1.0.md, docs/roadmap/ROADMAP.md, docs/domains/<d>/CHARTER.md (10 ไฟล์: agent, crm, identity, integration, knowledge, market-intelligence, platform-control, project-manager — ครอบคลุม business และ people ในฐานะ satellite module), docs/domains/<d>/features/*.md, docs/TRACE.md, docs/FEATURE-MAP.md, docs/DOMAIN-MAP.md, docs/FEATURES.md, docs/INTERFACE-INVENTORY.md, docs/SITEMAP-DOMAIN-NAV.md, docs/ROUTES-SITEMAP.md, docs/.preflight-report.json, docs/.doc-graph.json, docs/.domain-state.json, docs/.id-ledger.json, docs/.route-anchor-baseline.json, docs/.client-mutation-baseline.json, docs/decisions/ADR-*.md, prisma/schema.prisma และ schema.postgres.prisma, src/config/domains.js, .github/workflows/governance.yml |
| ความสัมพันธ์กับเอกสารเดิม | docs/GAP-ANALYSIS-ZURI-GOVIBE.md เป็นการวิเคราะห์ช่องว่างข้ามระบบ (zuri-ai ↔ GoVibe/MSP/GKS/GenesisBlockDB ที่อยู่นอก repo) คนละมิติกับรายงานนี้ — ไฟล์นี้ (มิติที่ 2) ตรวจสอบเฉพาะภายใน repo zuri-ai เอง แยกตาม domain charter เท่านั้น ไม่ทับซ้อนเนื้อหา ไม่คัดลอกซ้ำจากเอกสารดังกล่าว และไม่ยึด "V1/Zuri V2 parity" เป็นเกณฑ์ช่องว่าง (ตาม ADR-024 — คำศัพท์ประวัติศาสตร์เป็นเพียงป้ายชื่อ ไม่ใช่คำสั่งงาน) |

## บทสรุปผู้บริหาร

การตรวจสอบทีละ domain ทั้ง 10 หน่วย (agent, crm, identity, integration, knowledge, market-intelligence, platform-control, project-manager, business, people) พบช่องว่างรวม **190 รายการ** ครอบคลุมตั้งแต่ระดับ CRITICAL (2 รายการ) ไปจนถึง INFO (8 รายการ) — ไม่มีข้อค้นพบใดถูกตัดทิ้ง (dropped=0 ทุกหน่วย) รูปแบบที่พบซ้ำมากที่สุดข้ามทั้ง 10 domain ไม่ใช่โค้ดที่ขาดหายหรือเขียนผิด แต่เป็น **"ช่องว่างของการเชื่อมต่อ" (wiring gap)**: ความสามารถที่ implement ครบและมี unit/integration test ผ่านแล้วในระดับไฟล์ กลับไม่มีเส้นทางเรียกใช้จากระบบที่ทำงานจริง (BROKEN_FLOW/MISSING_SURFACE) ประกอบกับการเขียนข้ามขอบเขต domain ที่ไม่ได้ประกาศไว้ในสัญญาสาธารณะ (BOUNDARY_VIOLATION) ที่กระจายอยู่แทบทุก domain ช่องว่างที่สำคัญที่สุดมีดังนี้:

- **D2-domain-agent-01** (CRITICAL) — MSP (หน่วยความจำตามช่วงเวลา) และ GenesisBlockDB (กราฟความรู้ GKS) ไม่เคยเชื่อมต่อกับเส้นทาง LINE webhook ที่ใช้งานจริงเลย แม้ docs/PRD-SDD-v1.0.md จะระบุ FR-029 ว่า ✅ เสร็จสมบูรณ์แล้ว — ทุก LINE turn ในโปรดักชันตกกลับไปใช้หน่วยความจำชั่วคราวในโปรเซสเดียว (หายเมื่อ restart) แทน
- **D2-domain-identity-09** (CRITICAL) — ฟังก์ชัน `erasePrincipal` ที่รองรับ PDPA erasure (FR-022/FR-095) ไม่มีเส้นทางเรียกใช้ใดๆ ในระบบที่ทำงานจริงเลย (ไม่มี route, UI หรือ script) ทำให้คำขอลบข้อมูลส่วนบุคคลจริงไม่มีทางดำเนินการได้นอกจากแก้ผ่าน console ฐานข้อมูลโดยตรง
- **D2-domain-integration-verifier-29 / -30** (HIGH, ช่องโหว่ความปลอดภัยที่ยืนยันแล้ว) — `saveLineGroup`/`saveLineUser` ตรวจสอบ scope ด้วย `tenantId` เท่านั้น ทำให้ Business หนึ่งสามารถแย่งชิง (reassign) LINE registry connection ของอีก Business ในเดียวกัน Tenant มาเป็นของตัวเองได้ และช่องโหว่นี้ไม่ถูกจับเพราะ test ของฟังก์ชันนี้ไม่เคยเข้าถึง persistence code จริงเลย
- **D2-domain-market-intelligence-04/05/06/07/16** (HIGH) — เมนู `/market` ถูกเปิดใช้งานจริงแล้ว (`soon:false`) ทั้งที่ `MarketDashboard.jsx` เป็น mock ข้อมูลคงที่ทั้งหมด ไม่มี API route ใดๆ ให้เรียก และทุก service (รวมถึง FR-092 เอง) ไม่มี production trigger — ขัดกับเงื่อนไข "truthful navigation" ของ ADR-038 โดยตรง
- **D2-domain-identity-23** (HIGH) — per-Business domain allow-list (FR-061/FR-062, `Membership.domainKeysJson`) ไม่ถูกตรวจสอบฝั่ง server บน API route ใดในทั้ง repo เลย (`grep -rln 'domainsForBusiness' src/app/api/` = ศูนย์ผลลัพธ์) มีเพียง client-side guard ใน 3 component — MEMBER ที่ไม่ได้รับสิทธิ์ domain ใด ๆ ยังคงเรียก API ของ Business ที่ตนเห็นได้โดยตรงและได้ข้อมูลเต็มรูปแบบเสมอ; `GET /api/people` (D2-domain-people-08) เป็นเพียงหนึ่งใน instance ของช่องว่างนี้ ไม่ใช่ทั้งหมด
- **D2-domain-agent-03 / D2-domain-agent-04** (HIGH/MEDIUM) — Gate F (write-action) และ Gate E (tool-calling) ของ agent implement ครบและมี test ผ่านแล้ว แต่ไม่มีกลไกจริงใดเรียกใช้งานจาก LINE turn เพราะไม่มีการส่ง tool-calling schema ให้ LLM provider เลย — ทำให้ FR-026 เป็นความสามารถที่ "มีจริงแต่เข้าไม่ถึง" ทั้งหมด (ผลตามมาคือ crm-03/04's arbitrary-string write เป็นความเสี่ยง latent ไม่ใช่ live จนกว่า Gate F จะถูกเชื่อมต่อ)
- **D2-domain-agent-17** (HIGH) — `DELETE /api/agent/heartbeat` ไม่มีการตรวจสอบผู้เรียกเลย ทำให้ผู้เรียกที่ไม่ระบุตัวตนล้าง edge device registry ทั้งหมดได้ด้วย request เดียว (`edgeDevices.clear()` เมื่อไม่ระบุ `deviceId`) และทุก error path ของ route นี้คืน HTTP 200 เสมอ ทำให้ไม่มี monitor ใดเห็น failure จริง
- **D2-domain-identity-08 / -10 / -20** (HIGH) — ความสามารถระดับ IAM สามชิ้น (FR-076 RoleBinding assignment, PlatformGrant revocation, agent-tool IAM authorizer ใหม่ตาม FEAT-010) implement ครบแต่ไม่มีผู้เรียกใช้งานจากการผลิตเลยแม้แต่ชิ้นเดียว — pattern เดียวกันซ้ำ 3 ครั้งในโดเมนเดียว
- **D2-domain-knowledge-01/02/03** (HIGH) — CHARTER.md ของ knowledge ยังบอกว่า FR-110 "ไม่มีโค้ด" ทั้งที่มีโค้ด 154 บรรทัดมาแล้ว 2 วัน และเส้นทาง GKS graph ทั้งเขียน (FR-024 write) และอ่าน (FR-024 read) implement ครบแต่ไม่เคยถูกเรียกจากระบบจริง
- **D2-domain-knowledge-09** (HIGH) — การทดสอบ RLS/role-isolation จริงบน Postgres เพียงชุดเดียวที่มีสำหรับ FR-051/052/054 self-skip เสมอใน CI เพราะ `.github/workflows/governance.yml` ไม่เคยตั้งค่า `ZURI_TEST_POSTGRES_URL`
- **D2-domain-knowledge-16** (HIGH) — FR-111 ถึง FR-119 (Tier-1 knowledge-ingestion stage ทั้ง 9 FR ที่ PRD ทำเครื่องหมาย ✅) ผูกเข้าด้วยกันผ่าน `stage-runner.js` ซึ่งมีผู้เรียกจริงเพียงรายเดียวคือ `knowledge-ingestion-executor.js` ที่ไม่มี production trigger — pattern เดียวกันกับ FR-029/FR-024 แต่ครอบคลุมถึง 9 FR ที่ไม่เคยถูกเปรียบเทียบกับสถานะ PRD ในหน่วยนี้มาก่อน
- **D2-domain-market-intelligence-01/02/03** (HIGH) — 5 slice ของ market-intelligence (Phase 2–5) ถูก ship โดยไม่สำรอง FR id ใหม่ตามที่ SRS ของ domain เองกำหนดไว้ ทำให้ FEATURE-MAP/TRACE misattribute 20 ไฟล์ให้ FR-092 อย่างผิดๆ และ `ProcurementRecommendationService` วางตรรกะที่ควรเป็นของ Commerce ไว้ในโมดูลนี้
- **D2-domain-project-manager-01 / -02** (HIGH) — owns_routes catch-all ของ project-manager ดูดกลืนหน้า UI ของ CRM/market-intelligence/identity ขัดกับข้อความ charter เอง และ FEAT-002 ยังคงสถานะ 'building' ทั้งที่ FR-041/FR-060 เสร็จ 100% แล้ว — ตัวอย่างของ "ตัวเลขสีเขียวที่โกหก" ที่ FR-124 ถูกสร้างมาเพื่อป้องกันโดยตรง
- **D2-domain-business-02** (HIGH) — e2e test ของ FR-060 assert จำนวน domain แบบ hardcode (`/of 7 domains/`) ซึ่งจะ fail ทันทีหลัง commit เพิ่ม domain `market` เมื่อวันก่อน (2026-09-01)
- **D2-domain-integration-03** (HIGH) — `DeadLetterRecord` (FR-081(d)) มี schema แต่ไม่มี production writer เลย หมายความว่า guarantee "ความล้มเหลวจะถูกบันทึกไว้เสมอ" ไม่เป็นจริงในทางปฏิบัติ

**ข้อสรุปโดยรวมของมิตินี้**: ช่องว่างที่ครอบงำทั้ง 10 domain ไม่ใช่โค้ดที่เขียนผิดหรือขาดหายไปเป็นส่วนใหญ่ — โค้ดถูกเขียนและทดสอบอย่างมีวินัยในระดับหน่วย (unit) เกือบทุกจุด — แต่เป็นช่องว่างของการเชื่อมต่อ (wiring gap): ความสามารถที่ complete และ tested ในระดับไฟล์เดียวจำนวนมาก (Gate E/F ของ agent, RoleBinding/PlatformGrant/agent-tool-authorizer ของ identity, GKS graph read/write ของ knowledge, Tier-1 ingestion stage ทั้ง 9 FR ของ knowledge, ทุก service ของ market-intelligence Phase 2–5) ไม่เคยถูกเรียกจากเส้นทางที่ระบบจริงใช้งาน ทำให้สถานะ ✅ ใน docs/PRD-SDD-v1.0.md หลายรายการ (โดยเฉพาะ FR-024, FR-026, FR-029, FR-076, FR-111..FR-119) เกินจริงเมื่อเทียบกับความสามารถที่ผู้ใช้จริงเข้าถึงได้ ประกอบกับช่องว่างด้านขอบเขต domain ที่กระจายทั่วไป (agent และ identity เขียนโมเดลของ crm/identity ข้าม charter โดยไม่ประกาศเป็น shared-write exception) และช่องโหว่ความปลอดภัยที่ยืนยันแล้วในทางปฏิบัติ 2 จุด (LINE registry cross-business ownership takeover ที่ D2-domain-integration-verifier-29 และ per-Business domain allow-list ที่ไม่ถูกตรวจสอบฝั่ง server เลยที่ D2-domain-identity-23) ทำให้มิตินี้อยู่ในสถานะที่ต้องดำเนินการแก้ไขเร่งด่วนในบาง domain (agent, identity, integration, knowledge, market-intelligence) ควบคู่ไปกับงานทำความสะอาดเอกสาร/governance ที่กระจายอยู่แทบทุก domain โดยไม่มี domain ใดปลอดช่องว่างโดยสิ้นเชิง แม้แต่ domain ที่เล็กที่สุด (platform-control, 1 FR) ก็ยังพบช่องว่างเชิงเอกสาร/การทดสอบ 10 รายการ (Customer/Conversation write ของ agent's write-tools.js — D2-domain-crm-03/04 — ถูกปรับลงเหลือ MEDIUM หลังพบว่าเส้นทางนี้ยังไม่มี production trigger ในปัจจุบัน (D2-domain-agent-03) ไม่ใช่ live-reachable ตามที่ระบุไว้เดิม)

## ตารางสรุปตามหน่วยตรวจ

| หน่วย | รายการที่ตรวจ | CRITICAL | HIGH | MEDIUM | LOW | INFO | สถานะโดยรวม |
|---|---|---|---|---|---|---|---|
| domain-agent | 19 | 1 | 4 | 5 | 8 | 1 | วิกฤต — ความสามารถหลัก (MSP/GKS wiring, Gate F write-action) ไม่เชื่อมต่อกับเส้นทางที่ใช้งานจริง แม้ PRD ระบุ ✅; heartbeat DELETE ไม่มี auth ล้าง registry ทั้งหมดได้ |
| domain-crm | 22 | 0 | 0 | 13 | 7 | 2 | มีช่องว่างสำคัญระดับ MEDIUM — agent เขียนข้าม boundary เข้าถึง Customer/Conversation ได้ (latent จนกว่า Gate F จะถูกเชื่อมต่อ) |
| domain-identity | 24 | 1 | 5 | 10 | 6 | 2 | วิกฤต — PDPA erasure ไม่มีเส้นทางเรียกใช้, per-Business domain grant ไม่ถูกตรวจฝั่ง server เลย และมี broken-flow ซ้ำ 3 จุดในชั้น IAM |
| domain-integration | 31 | 0 | 6 | 13 | 12 | 0 | มีช่องว่างสำคัญจำนวนมาก — รวมช่องโหว่ cross-business ownership takeover ที่ยืนยันแล้ว |
| domain-knowledge | 17 | 0 | 5 | 8 | 4 | 0 | มีช่องว่างสำคัญ — เอกสารล้าสมัย + เส้นทาง GKS graph ไม่เชื่อมต่อ + Tier-1 ingestion 9 FR ไม่มี production caller + RLS test ข้ามใน CI |
| domain-market-intelligence | 23 | 0 | 8 | 13 | 2 | 0 | มีช่องว่างสำคัญจำนวนมาก — UI เปิดใช้งานจริงแต่เป็น mock ทั้งหมด ไม่มี API/persistence จริง |
| domain-platform-control | 10 | 0 | 0 | 5 | 4 | 1 | ส่วนใหญ่มั่นคง — โดเมนเล็กที่สุด (1 FR) มีเพียงช่องว่างระดับกลาง/เอกสารเท่านั้น |
| domain-project-manager | 18 | 0 | 2 | 10 | 6 | 0 | มีช่องว่างสำคัญ — route ownership catch-all + registry status drift (FEAT-002) + FR-108 ไม่มี UI + 7 ไฟล์ไม่มี annotation |
| domain-business | 7 | 0 | 1 | 2 | 4 | 0 | มีช่องว่างสำคัญหนึ่งจุด (e2e จะพัง) ส่วนที่เหลือเป็นเอกสารล้าสมัยเล็กน้อย |
| domain-people | 19 | 0 | 0 | 4 | 13 | 2 | มีช่องว่างสำคัญหนึ่งจุด (authorization ฝั่ง server — instance ของ D2-domain-identity-23) ส่วนที่เหลือเป็น dead field/เอกสาร |
| **รวมทั้งหมด** | **190** | **2** | **31** | **83** | **66** | **8** | — |

## ตารางสรุปช่องว่างทั้งหมด

| ID | ระดับ | ประเภท | หัวข้อ | หน่วย |
|---|---|---|---|---|
| D2-domain-agent-01 | CRITICAL | PRODUCTION_GATE_OPEN | MSP/GenesisBlockDB ไม่เคยเชื่อมต่อกับเส้นทาง LINE webhook จริง | domain-agent |
| D2-domain-identity-09 | CRITICAL | BROKEN_FLOW | erasePrincipal (PDPA erasure) ไม่มีเส้นทางเรียกใช้ในการผลิต | domain-identity |
| D2-domain-agent-16 | HIGH | BROKEN_FLOW | OpenRouter OAuth PKCE ครบแต่ไม่มี route เรียกใช้ | domain-agent |
| D2-domain-agent-03 | HIGH | BROKEN_FLOW | Gate F write-action pipeline ไม่มีเส้นทางเรียกใช้จริง | domain-agent |
| D2-domain-agent-02 | HIGH | BUILT_NOT_DECLARED | heartbeat route มี FR/ADR/test annotation ปลอม ไม่มี auth | domain-agent |
| D2-domain-agent-17 | HIGH | BOUNDARY_VIOLATION | heartbeat DELETE ไม่มี auth ล้าง device registry ทั้งหมดได้ + error ทุกกรณีคืน 200 | domain-agent |
| D2-domain-identity-02 | HIGH | BOUNDARY_VIOLATION | agent/step-up.js เขียน IdentityLinkToken ตรง ไม่ประกาศ | domain-identity |
| D2-domain-identity-08 | HIGH | BROKEN_FLOW | FR-076 RoleBinding assignment ไม่มีผู้เรียกใช้ในการผลิต | domain-identity |
| D2-domain-identity-10 | HIGH | MISSING_SURFACE | PlatformGrant ไม่มีเส้นทาง revoke/list เลย | domain-identity |
| D2-domain-identity-20 | HIGH | BROKEN_FLOW | authorizeAgentToolExecution สร้างแล้วแต่ไม่ถูกเรียกจาก tool dispatcher | domain-identity |
| D2-domain-identity-23 | HIGH | BOUNDARY_VIOLATION | per-Business domain grant (FR-061/062) ไม่ถูกตรวจฝั่ง server บน API route ใดเลย | domain-identity |
| D2-domain-integration-verifier-29 | HIGH | BOUNDARY_VIOLATION | saveLineGroup/saveLineUser ถูกแย่งชิง connection ข้าม Business ได้ | domain-integration |
| D2-domain-integration-verifier-30 | HIGH | TEST_GAP | test ของ line-registry-service ไม่เคยถึง persistence code | domain-integration |
| D2-domain-integration-05 | HIGH | BROKEN_FLOW | provider code 'line-oa' vs 'LINE_OA' ทำให้ identity หลุดคู่กัน | domain-integration |
| D2-domain-integration-06 | HIGH | BUILT_NOT_DECLARED | LINE registry feature ไม่มี FR/FEAT declaration | domain-integration |
| D2-domain-integration-20 | HIGH | TEST_GAP | Vault resolver ไม่มี real-Postgres test เลย | domain-integration |
| D2-domain-integration-03 | HIGH | DECLARED_NOT_BUILT | DeadLetterRecord มี schema แต่ไม่มี production writer | domain-integration |
| D2-domain-knowledge-01 | HIGH | DOC_DRIFT | CHARTER.md บอก FR-110 ไม่มีโค้ด ทั้งที่มีโค้ด 154 บรรทัดแล้ว | domain-knowledge |
| D2-domain-knowledge-02 | HIGH | BROKEN_FLOW | FR-024 GKS write path ครบ+ทดสอบ แต่ไม่มีผู้เรียกใช้ในการผลิต | domain-knowledge |
| D2-domain-knowledge-03 | HIGH | BROKEN_FLOW | FR-024 GKS read path เข้าถึงผ่าน createAgentPorts ที่ไม่มีผู้เรียกเช่นกัน | domain-knowledge |
| D2-domain-knowledge-09 | HIGH | TEST_GAP | RLS/role-isolation test บน Postgres self-skip เสมอใน CI | domain-knowledge |
| D2-domain-knowledge-16 | HIGH | BROKEN_FLOW | FR-111..FR-119 (9 FR ✅) ผูกผ่าน stage-runner ที่ไม่มี production caller | domain-knowledge |
| D2-domain-market-intelligence-01 | HIGH | BUILT_NOT_DECLARED | ship 5 slice โดยไม่สำรอง FR id ใหม่ตามที่ SRS กำหนด | domain-market-intelligence |
| D2-domain-market-intelligence-02 | HIGH | DOC_DRIFT | FEATURE-MAP/TRACE misattribute 20 ไฟล์ให้ FR-092 ผิดๆ | domain-market-intelligence |
| D2-domain-market-intelligence-03 | HIGH | BOUNDARY_VIOLATION | ProcurementRecommendationService วางตรรกะ Commerce ไว้ผิด module | domain-market-intelligence |
| D2-domain-market-intelligence-04 | HIGH | PRODUCTION_GATE_OPEN | /market nav เปิดใช้จริงขัด ADR-038 truthful-navigation | domain-market-intelligence |
| D2-domain-market-intelligence-05 | HIGH | BROKEN_FLOW | MarketDashboard.jsx เป็น static mock ทั้งหมด ไม่เรียก service จริง | domain-market-intelligence |
| D2-domain-market-intelligence-06 | HIGH | MISSING_SURFACE | ไม่มี API route ใดๆ ให้ market-intelligence services เลย | domain-market-intelligence |
| D2-domain-market-intelligence-07 | HIGH | BROKEN_FLOW | แม้ FR-092 เองก็ไม่มี production trigger | domain-market-intelligence |
| D2-domain-market-intelligence-16 | HIGH | PARTIAL | ทุก service Phase 2-5 ใช้ in-memory repository เท่านั้น ไม่มี Prisma | domain-market-intelligence |
| D2-domain-project-manager-01 | HIGH | BOUNDARY_VIOLATION | owns_routes catch-all ดูดกลืนหน้า UI ของ crm/market/identity | domain-project-manager |
| D2-domain-project-manager-02 | HIGH | DOC_DRIFT | FEAT-002 ค้างสถานะ 'building' ทั้งที่ FR เสร็จ 100% แล้ว | domain-project-manager |
| D2-domain-business-02 | HIGH | TEST_GAP | e2e ของ FR-060 assert domain count คงที่ จะ fail หลังเพิ่ม domain ใหม่ | domain-business |
| D2-domain-agent-04 | MEDIUM | PARTIAL | Gate E tool registry ไม่ถูก dispatch จาก live turn เลย | domain-agent |
| D2-domain-agent-05 | MEDIUM | BOUNDARY_VIOLATION | agent tools เขียน/อ่าน Customer/Conversation ตรงข้าม contract | domain-agent |
| D2-domain-agent-06 | MEDIUM | BOUNDARY_VIOLATION | step-up.js เขียน IdentityLinkToken ไม่มี contract ประกาศ | domain-agent |
| D2-domain-agent-07 | MEDIUM | TEST_GAP | test FR-055 activation/isolation self-skip ทุก routine run | domain-agent |
| D2-domain-agent-08 | MEDIUM | PARTIAL | agent-tool IAM authorizer ใหม่ไม่เชื่อมกับ gate ของ agent เอง | domain-agent |
| D2-domain-crm-03 | MEDIUM | BOUNDARY_VIOLATION | agent write-tools เขียน Customer/Conversation ข้าม contract ของ crm (latent — ยังไม่มี trigger) | domain-crm |
| D2-domain-crm-04 | MEDIUM | BOUNDARY_VIOLATION | set_customer_lifecycle เขียนค่าไม่ validate เข้า enum lifecycleStage (latent — ยังไม่มี trigger) | domain-crm |
| D2-domain-crm-05 | MEDIUM | DOC_DRIFT | close_conversation เขียน status ที่ไม่มี enum ขัด feature note เอง | domain-crm |
| D2-domain-crm-06 | MEDIUM | DOC_DRIFT | erasePrincipal เขียน Customer/ConversationAnalysis ไม่ประกาศ | domain-crm |
| D2-domain-crm-07 | MEDIUM | DOC_DRIFT | link-line-identity repoint Customer.personId ไม่ประกาศ | domain-crm |
| D2-domain-crm-08 | MEDIUM | BROKEN_FLOW | MERGE_PENDING audit event ไม่มีใครอ่าน/resolve เลย | domain-crm |
| D2-domain-crm-09 | MEDIUM | BUILT_NOT_DECLARED | crm charter ไม่มี owns_routes ทำให้ route นับเป็น 0 | domain-crm |
| D2-domain-crm-11 | MEDIUM | DOC_DRIFT | hand-copy direction enum แทน import MESSAGE_DIRECTIONS | domain-crm |
| D2-domain-crm-12 | MEDIUM | TEST_GAP | ingestLineMessage ยอมรับ direction:'OUTBOUND' ไม่ถูกป้องกัน | domain-crm |
| D2-domain-crm-13 | MEDIUM | TEST_GAP | Postgres adapter ของ FR-078 review queue ไม่มี test เลย | domain-crm |
| D2-domain-crm-21 | MEDIUM | DOC_DRIFT | review decision action values hand-copy สองที่ ไม่มี enum กลาง | domain-crm |
| D2-domain-crm-22 | MEDIUM | TEST_GAP | Customer.version ไม่มี writer ใด read/increment | domain-crm |
| D2-domain-crm-02 | MEDIUM | BROKEN_FLOW | snapshot restore ไม่รู้จัก PDPA erasure ทำให้ PII ฟื้นคืนได้ | domain-crm |
| D2-domain-identity-01 | MEDIUM | BOUNDARY_VIOLATION | ExternalRef อ้างเป็นของ identity แต่ writer ทั้งหมดอยู่ project-manager | domain-identity |
| D2-domain-identity-03 | MEDIUM | BOUNDARY_VIOLATION | erasePrincipal เขียน crm models ไม่ประกาศเป็น exception | domain-identity |
| D2-domain-identity-05 | MEDIUM | MISSING_SURFACE | 8 route ของ identity ไม่มี charter glob ใดอ้างสิทธิ์ | domain-identity |
| D2-domain-identity-06 | MEDIUM | BUILT_NOT_DECLARED | viewer-authority.js (32+ imports) ไม่อยู่ใน Public contract | domain-identity |
| D2-domain-identity-13 | MEDIUM | DOC_DRIFT | FR-076 PRD status บอก local ใช้ได้ ทั้งที่ unreachable | domain-identity |
| D2-domain-identity-14 | MEDIUM | PRODUCTION_GATE_OPEN | FR-123 plugin auth ยังรอ Supabase/registration/device-binding | domain-identity |
| D2-domain-identity-15 | MEDIUM | TEST_GAP | FR-102/106 migration test เป็น static-only ทั้งที่ PRD บอก 'applied' | domain-identity |
| D2-domain-identity-18 | MEDIUM | BOUNDARY_VIOLATION | onboarding-service สร้าง Portfolio ตรง ข้าม createPortfolio | domain-identity |
| D2-domain-identity-21 | MEDIUM | BROKEN_FLOW | canManageProduct (FR-076 consumption) ไม่มีผู้เรียกเลย | domain-identity |
| D2-domain-identity-22 | MEDIUM | MISSING_SURFACE | ApiAccessKey ไม่มี list/GET endpoint กู้ id ไม่ได้ | domain-identity |
| D2-domain-integration-01 | MEDIUM | DECLARED_NOT_BUILT | SyncCursor ไม่มี application-layer writer | domain-integration |
| D2-domain-integration-02 | MEDIUM | DECLARED_NOT_BUILT | ExternalEntityRef ไม่มี application-layer writer | domain-integration |
| D2-domain-integration-04 | MEDIUM | BROKEN_FLOW | marketplace/retail-price adapters เป็น dead code | domain-integration |
| D2-domain-integration-07 | MEDIUM | BROKEN_FLOW | automation jobs เขียน/อ่านได้แต่ไม่มี scheduler จริง | domain-integration |
| D2-domain-integration-08 | MEDIUM | DOC_DRIFT | owns_routes ขาด api/pipelines/** | domain-integration |
| D2-domain-integration-10 | MEDIUM | BOUNDARY_VIOLATION | credential-vault.js cross-domain import ไม่อยู่ใน Public Contracts | domain-integration |
| D2-domain-integration-11 | MEDIUM | BOUNDARY_VIOLATION | cloud-sot-agent.js cross-domain ไม่อยู่ใน Public Contracts | domain-integration |
| D2-domain-integration-16 | MEDIUM | TEST_GAP | sot-pipeline/graph page ไม่มี component render test | domain-integration |
| D2-domain-integration-17 | MEDIUM | TEST_GAP | SoT plan/inbox pages ทดสอบด้วย substring เท่านั้น | domain-integration |
| D2-domain-integration-19 | MEDIUM | TEST_GAP | SoT console + connection-creation form ไม่มี e2e เลย | domain-integration |
| D2-domain-integration-21 | MEDIUM | DOC_DRIFT | ROADMAP.md 'not really built' list ล้าสมัย | domain-integration |
| D2-domain-integration-22 | MEDIUM | PRODUCTION_GATE_OPEN | FR-129 ไม่มี route สร้าง APPROVED decision | domain-integration |
| D2-domain-integration-13 | MEDIUM | BROKEN_FLOW | ingestKnowledgeDocument มีแต่ test caller | domain-integration |
| D2-domain-knowledge-04 | MEDIUM | BROKEN_FLOW | SmartGift/GenesisBlockDB RAG pipeline ครบแต่ไม่มีผู้เรียกใช้ | domain-knowledge |
| D2-domain-knowledge-06 | MEDIUM | MISSING_SURFACE | ingestion executor 7-stage ไม่มี route/script trigger | domain-knowledge |
| D2-domain-knowledge-07 | MEDIUM | BUILT_NOT_DECLARED | charter ตั้งชื่อ public contract แค่ 2 แต่ export จริง 13+ | domain-knowledge |
| D2-domain-knowledge-08 | MEDIUM | PARTIAL | Supabase adapter ของ FR-047 เป็น dead code | domain-knowledge |
| D2-domain-knowledge-10 | MEDIUM | PRODUCTION_GATE_OPEN | FR-052 มี activation/canary gate ค้างอยู่ (external) | domain-knowledge |
| D2-domain-knowledge-11 | MEDIUM | PRODUCTION_GATE_OPEN | FR-054 มี external NOT_RUN gate ค้างอยู่ | domain-knowledge |
| D2-domain-knowledge-13 | MEDIUM | DOC_DRIFT | NFR-020 glyph ✅ ทั้งที่ข้อความบอกว่า metric ส่วนใหญ่ 'unwired' | domain-knowledge |
| D2-domain-knowledge-14 | MEDIUM | DOC_DRIFT | tool 'answer_from_knowledge' อ้าง GKS graph แต่เรียก Prisma ธรรมดา | domain-knowledge |
| D2-domain-market-intelligence-08 | MEDIUM | DOC_DRIFT | charter ตั้งชื่อ 10 ฟังก์ชันที่ไม่มีในโค้ดจริง | domain-market-intelligence |
| D2-domain-market-intelligence-09 | MEDIUM | DECLARED_NOT_BUILT | CompetitorSignal/DemandSignal เป็น schema stub เท่านั้น | domain-market-intelligence |
| D2-domain-market-intelligence-10 | MEDIUM | BROKEN_FLOW | Integration adapters ของ marketplace/retail-price ไม่มีผู้เรียก | domain-market-intelligence |
| D2-domain-market-intelligence-11 | MEDIUM | MISSING_SURFACE | charter ไม่มี owns_routes ทั้งที่ระบุ target route key | domain-market-intelligence |
| D2-domain-market-intelligence-12 | MEDIUM | DOC_DRIFT | module README.md ยังบอกว่าไม่มี runtime code เลย | domain-market-intelligence |
| D2-domain-market-intelligence-13 | MEDIUM | DOC_DRIFT | SITEMAP-DOMAIN-NAV.md ไม่มี Market Intelligence เลย | domain-market-intelligence |
| D2-domain-market-intelligence-14 | MEDIUM | DOC_DRIFT | INTERFACE-INVENTORY.md อ้างความสามารถเกินจริงของ /market | domain-market-intelligence |
| D2-domain-market-intelligence-15 | MEDIUM | TEST_GAP | ไม่มี e2e/reachability test สำหรับ /market ที่เปิดใหม่ | domain-market-intelligence |
| D2-domain-market-intelligence-17 | MEDIUM | MISSING_SURFACE | ไม่มี cross-domain consumer จริงตามที่ CONTEXT-MAP ประกาศ | domain-market-intelligence |
| D2-domain-market-intelligence-18 | MEDIUM | PARTIAL | SupplierIntelligenceService ไม่ใช้ observation-evidence dependency | domain-market-intelligence |
| D2-domain-market-intelligence-19 | MEDIUM | DOC_DRIFT | ROADMAP.md ไม่มี task สำหรับ 5 slice ที่ ship จริงแล้ว | domain-market-intelligence |
| D2-domain-market-intelligence-21 | MEDIUM | PARTIAL | getRankedSuppliersForProduct ไม่ใช้ productQuery parameter | domain-market-intelligence |
| D2-domain-market-intelligence-22 | MEDIUM | BOUNDARY_VIOLATION | ไม่มี service ใดใน market-intelligence บันทึก audit event | domain-market-intelligence |
| D2-domain-platform-control-01 | MEDIUM | BOUNDARY_VIOLATION | charter owns_code ขาด 2 ไฟล์ที่เป็น guard logic จริง | domain-platform-control |
| D2-domain-platform-control-02 | MEDIUM | BOUNDARY_VIOLATION | project-manager's glob ทับซ้อน platform-control's shell files | domain-platform-control |
| D2-domain-platform-control-07 | MEDIUM | TEST_GAP | ไม่มี check อัตโนมัติ sync PROGRAMME_* snapshot กับ source doc | domain-platform-control |
| D2-domain-platform-control-03 | MEDIUM | TEST_GAP | ไม่มี integration/e2e ทดสอบ PlatformControlGuard จริง | domain-platform-control |
| D2-domain-platform-control-09 | MEDIUM | PARTIAL | guard รวม session-outage (503) เป็น redirect เดียวกับ logged-out | domain-platform-control |
| D2-domain-project-manager-03 | MEDIUM | BOUNDARY_VIOLATION | onboarding-service bypass scope-service.createPortfolio | domain-project-manager |
| D2-domain-project-manager-04 | MEDIUM | BOUNDARY_VIOLATION | profile-permission-service เขียน Membership.role ตรง | domain-project-manager |
| D2-domain-project-manager-05 | MEDIUM | BUILT_NOT_DECLARED | components/useApi.js เป็น public contract โดยพฤตินัยแต่ไม่ประกาศ | domain-project-manager |
| D2-domain-project-manager-06 | MEDIUM | DOC_DRIFT | backup-service.js แตะทุก domain model โดยไม่ประกาศ exception | domain-project-manager |
| D2-domain-project-manager-07 | MEDIUM | DOC_DRIFT | 9 feature notes สถานะเก่า Candidate/Proposed/Declared | domain-project-manager |
| D2-domain-project-manager-09 | MEDIUM | BROKEN_FLOW | FileLink เขียนทุกครั้งแต่ไม่มีใครอ่านเลย | domain-project-manager |
| D2-domain-project-manager-10 | MEDIUM | DECLARED_NOT_BUILT | LegalEntityIdentifier เป็น dead model ไม่มี reader/writer | domain-project-manager |
| D2-domain-project-manager-13 | MEDIUM | TEST_GAP | หลายหน้า swallow mutation error เงียบ | domain-project-manager |
| D2-domain-project-manager-17 | MEDIUM | MISSING_SURFACE | FR-108 ExecutionPlanBundle intake ไม่มี UI consumer เลย | domain-project-manager |
| D2-domain-project-manager-18 | MEDIUM | BUILT_NOT_DECLARED | 7 component/view files ไม่มี @req annotation เลย | domain-project-manager |
| D2-domain-business-01 | MEDIUM | DOC_DRIFT | charter อธิบาย business module ล้าสมัย ขาด FR-060 ไปทั้งหมด | domain-business |
| D2-domain-business-03 | MEDIUM | DOC_DRIFT | INTERFACE-INVENTORY.md ขัดแย้งกับ marker ของตัวเอง (7 vs 8 domain) | domain-business |
| D2-domain-people-08 | MEDIUM | BOUNDARY_VIOLATION | GET /api/people ไม่ตรวจ per-Business domain grant ฝั่ง server (instance ของ identity-23) | domain-people |
| D2-domain-people-05 | MEDIUM | MISSING_SURFACE | ไม่มี write surface เพิ่มคนใหม่เข้า Business เลย | domain-people |
| D2-domain-people-06 | MEDIUM | BOUNDARY_VIOLATION | profile-permission-service เขียน Membership ไม่มี charter disclosure | domain-people |
| D2-domain-people-10 | MEDIUM | TEST_GAP | test ของ route/component ตรวจ raw source text ไม่ใช่ behavior จริง | domain-people |
| D2-domain-agent-09 | LOW | DOC_DRIFT | env-configured LINE binding resolver เป็น orphaned code พร้อม @tested ผิด | domain-agent |
| D2-domain-agent-10 | LOW | DOC_DRIFT | agent's barrel re-export symbol ของ integration domain โดยไม่ประกาศ | domain-agent |
| D2-domain-agent-11 | LOW | BOUNDARY_VIOLATION | integration import agent's internal file ตรงแทนผ่าน barrel | domain-agent |
| D2-domain-agent-12 | LOW | BOUNDARY_VIOLATION | Postgres helper ที่ tag เป็น agent FR อยู่จริงใน knowledge module | domain-agent |
| D2-domain-agent-13 | LOW | DOC_DRIFT | DOMAIN-MAP.md undercounts FR ที่ owned route ของ agent ทำ | domain-agent |
| D2-domain-agent-14 | LOW | TEST_GAP | ไม่มี e2e test ใดๆ เลยสำหรับ agent domain | domain-agent |
| D2-domain-agent-18 | LOW | DOC_DRIFT | 4 design doc ของ agent ไม่ถูก inventory แยกรายฉบับ + path ล้าสมัย | domain-agent |
| D2-domain-agent-19 | LOW | DOC_DRIFT | charter ขาด Version/Status control block | domain-agent |
| D2-domain-crm-10 | LOW | BUILT_NOT_DECLARED | FR-078 routes ตกไป project-manager catch-all เช่นกัน | domain-crm |
| D2-domain-crm-01 | LOW | DOC_DRIFT | project-manager charter อ้าง 'ไม่แตะ CRM' แต่ backup-service แตะทั้งหมด | domain-crm |
| D2-domain-crm-14 | LOW | TEST_GAP | FR-078 UI+API ไม่มี e2e ต่างจาก FR-091/103 | domain-crm |
| D2-domain-crm-15 | LOW | BUILT_NOT_DECLARED | charter ไม่ตั้งชื่อ FR-078 exported function จริง | domain-crm |
| D2-domain-crm-16 | LOW | TEST_GAP | truncated flag ของ conversation inbox เป็น heuristic ที่ผิดได้ ไม่ทดสอบ | domain-crm |
| D2-domain-crm-17 | LOW | MISSING_SURFACE | recordConversationAnalysis/getConversationAnalyses ไม่มีผู้เรียกจริง | domain-crm |
| D2-domain-crm-20 | LOW | DOC_DRIFT | crm charter ขาด Version/Status control fields (shared debt) | domain-crm |
| D2-domain-identity-07 | LOW | BUILT_NOT_DECLARED | request-viewer/gate/channel-identity/rbac ไม่อยู่ใน Public contract | domain-identity |
| D2-domain-identity-04 | LOW | DOC_DRIFT | Person writers ไม่ครบใน exceptions list ของทั้งสอง charter | domain-identity |
| D2-domain-identity-16 | LOW | TEST_GAP | FR-066/067 onboarding ไม่มี e2e Playwright เฉพาะ | domain-identity |
| D2-domain-identity-17 | LOW | TEST_GAP | ไม่มี .postgres.test.js สำหรับ identity model ใดเลย | domain-identity |
| D2-domain-identity-19 | LOW | DOC_DRIFT | charter ขาด Version/Status control block | domain-identity |
| D2-domain-identity-24 | LOW | DECLARED_NOT_BUILT | FR-121 (Google second way-in) ไม่มีโค้ด; FR-121/122 ไม่เคยอยู่ใน Inventory | domain-identity |
| D2-domain-integration-09 | LOW | DOC_DRIFT | owns_routes ขาด api/ingest/documents/** | domain-integration |
| D2-domain-integration-12 | LOW | BOUNDARY_VIOLATION | document-intake-contract.js cross-domain ไม่อยู่ใน Public Contracts | domain-integration |
| D2-domain-integration-14 | LOW | DOC_DRIFT | FR-099/100/101 feature note status ยังเป็น 'proposed' | domain-integration |
| D2-domain-integration-15 | LOW | DOC_DRIFT | FEAT-011 primaryDomain ไม่ตรงกับ generated per-FR domain | domain-integration |
| D2-domain-integration-18 | LOW | TEST_GAP | pipeline-monitor-ui.test.js เป็น substring-only | domain-integration |
| D2-domain-integration-23 | LOW | DOC_DRIFT | Public Contracts list ไม่ครบ | domain-integration |
| D2-domain-integration-24 | LOW | PARTIAL | registerIntegrationProvider มีแต่ test caller | domain-integration |
| D2-domain-integration-26 | LOW | PARTIAL | PipelineReconciliation.evidenceJson hardcode '{}' | domain-integration |
| D2-domain-integration-27 | LOW | DECLARED_NOT_BUILT | FR-125 blocked เพราะ DATA_SOURCE ไม่อยู่ใน CONNECTION_KINDS | domain-integration |
| D2-domain-integration-28 | LOW | BOUNDARY_VIOLATION | knowledge-ingestion-executor cross-domain ไม่มี reciprocal charter | domain-integration |
| D2-domain-integration-verifier-31 | LOW | BOUNDARY_VIOLATION | integration import agent's MODEL_PROVIDER โดยไม่ประกาศ | domain-integration |
| D2-domain-integration-25 | LOW | DOC_DRIFT | CHARTER.md ขาด Version/Status control block (shared debt) | domain-integration |
| D2-domain-knowledge-05 | LOW | PARTIAL | FR-110 rule เข้ารหัสซ้ำสองที่ ไม่มีอะไร sync กัน | domain-knowledge |
| D2-domain-knowledge-12 | LOW | BOUNDARY_VIOLATION | /api/pipelines/runs ไม่มี charter ใด claim | domain-knowledge |
| D2-domain-knowledge-15 | LOW | PARTIAL | FR-110 rule มี 2 implementation อิสระไม่ sync กัน | domain-knowledge |
| D2-domain-knowledge-17 | LOW | DOC_DRIFT | charter ขาด Version/Status control block (shared debt) | domain-knowledge |
| D2-domain-market-intelligence-20 | LOW | DOC_DRIFT | market-observation-service.js ขาด @tested annotation | domain-market-intelligence |
| D2-domain-market-intelligence-23 | LOW | DOC_DRIFT | charter ขาด Version/Status control block (shared debt) | domain-market-intelligence |
| D2-domain-platform-control-04 | LOW | DOC_DRIFT | guard's 'loading' state เป็น dead code สำหรับ caller จริง | domain-platform-control |
| D2-domain-platform-control-05 | LOW | DOC_DRIFT | INTERFACE-INVENTORY.md ยังบอก 'implemented locally' หลัง deploy จริง | domain-platform-control |
| D2-domain-platform-control-06 | LOW | DOC_DRIFT | ADR-048's baseline commit ไม่ตรงกับ snapshot ที่ ship จริง | domain-platform-control |
| D2-domain-platform-control-10 | LOW | DOC_DRIFT | charter ขาด Version/Status control block (shared debt) | domain-platform-control |
| D2-domain-project-manager-08 | LOW | PRODUCTION_GATE_OPEN | PROGRESS_METHODOLOGY ยังไม่ ratified แต่ render ในโปรดักชัน | domain-project-manager |
| D2-domain-project-manager-11 | LOW | DECLARED_NOT_BUILT | Workstream.laneId declared-only ไม่มีใครอ่าน/เขียน | domain-project-manager |
| D2-domain-project-manager-12 | LOW | PARTIAL | Repository.externalRepoId ไม่สอดคล้องกับ ExternalRef ที่ generalize แล้ว | domain-project-manager |
| D2-domain-project-manager-14 | LOW | DOC_DRIFT | CHARTER.md ขาด Version/Status control fields | domain-project-manager |
| D2-domain-project-manager-15 | LOW | TEST_GAP | FR-063 Project Board มีแค่ unit test ไม่มี integration/e2e | domain-project-manager |
| D2-domain-project-manager-16 | LOW | PARTIAL | PlanImportReceipt เขียนอย่างเดียว ไม่มี read surface | domain-project-manager |
| D2-domain-business-04 | LOW | TEST_GAP | test ของ business-strategy-service ไม่ครอบ cross-Business exclusion จริง | domain-business |
| D2-domain-business-05 | LOW | DOC_DRIFT | charter ไม่ตั้งชื่อ export ใดของ src/modules/business เลย | domain-business |
| D2-domain-business-06 | LOW | PARTIAL | FEAT-002 ค้าง 'building' ไม่มี FR id ติดตาม scope ที่เหลือ | domain-business |
| D2-domain-business-07 | LOW | PARTIAL | attentionQueue()'s domainKey field คำนวณแต่ไม่มีใครใช้เลย | domain-business |
| D2-domain-people-01 | LOW | PARTIAL | project-manager charter อธิบาย people แค่ย่อหน้าเดียว ไม่ตั้งชื่อ route | domain-people |
| D2-domain-people-02 | LOW | BROKEN_FLOW | Membership.employeeRef ประกาศแต่ไม่มี writer เติมค่า | domain-people |
| D2-domain-people-03 | LOW | BROKEN_FLOW | employeeRef ส่งกลับจาก API แต่ UI ไม่ render | domain-people |
| D2-domain-people-04 | LOW | DOC_DRIFT | Dashboard และ People Directory render เนื้อหาเหมือนกันทุกตัวอักษร | domain-people |
| D2-domain-people-07 | LOW | DOC_DRIFT | knowledge อ่าน Membership โดยไม่มี disclosure ใน charter | domain-people |
| D2-domain-people-09 | LOW | TEST_GAP | listPeople 'not found'/ARCHIVED branch ไม่มี test | domain-people |
| D2-domain-people-11 | LOW | TEST_GAP | ไม่มี integration test สำหรับ /api/people กับ Prisma จริง | domain-people |
| D2-domain-people-12 | LOW | DOC_DRIFT | crm charter ไม่ disclose ว่า people อ่าน Person model | domain-people |
| D2-domain-people-13 | LOW | PARTIAL | project-manager charter ไม่ตั้งชื่อ listPeople export | domain-people |
| D2-domain-people-15 | LOW | DOC_DRIFT | TRACE.md's FR-042 test list รวม generic test ที่ไม่เกี่ยว | domain-people |
| D2-domain-people-16 | LOW | PARTIAL | listPeople ไม่ filter Membership.status | domain-people |
| D2-domain-people-18 | LOW | DOC_DRIFT | hardcode 'ARCHIVED' string แทน enum กลาง | domain-people |
| D2-domain-people-19 | LOW | TEST_GAP | ไม่มี test สำหรับ missing-businessId error path | domain-people |
| D2-domain-agent-15 | INFO | DOC_DRIFT | FR-051 feature note อยู่ domain agent แต่ code ทั้งหมดอยู่ knowledge | domain-agent |
| D2-domain-crm-19 | INFO | BUILT_NOT_DECLARED | crm depend on seesBusiness/ownsBusiness ที่ไม่อยู่ใน identity contract | domain-crm |
| D2-domain-crm-18 | INFO | DOC_DRIFT | ROADMAP.md list ล้าสมัยก่อน FEAT-014 | domain-crm |
| D2-domain-identity-11 | INFO | PRODUCTION_GATE_OPEN | FR-094/095/096/098 รอ Issue #99 Phase 0 P0 (เปิดเผยแล้ว) | domain-identity |
| D2-domain-identity-12 | INFO | PRODUCTION_GATE_OPEN | FR-097 รอ provider-side evidence (เปิดเผยแล้ว) | domain-identity |
| D2-domain-platform-control-08 | INFO | DOC_DRIFT | charter ขาด owns_models: [] ที่ชัดเจน | domain-platform-control |
| D2-domain-people-14 | INFO | TEST_GAP | doc-preflight ไม่ตรวจ cross-domain writer จริงในซอร์ส | domain-people |
| D2-domain-people-17 | INFO | TEST_GAP | ผลกระทบต่ำเพราะยังไม่มี code path เปลี่ยน Membership.status | domain-people |

## รายละเอียดตามหน่วยตรวจ

## domain-agent

### domain-agent

#### สรุปย่อ

- **เส้นทางการขยายตัว**: domain-agent เป็นเจ้าของ 3 routes ที่วิ่งในการผลิต (POST /api/agent/line-webhook, POST /api/agent/line-delivery, GET/POST/DELETE /api/agent/heartbeat) และนำ 18+ FR ไปใช้ โดยครอบคลุมการอ่าน (Gate E) / การเขียน (Gate F) / การรันไทม์
- **ช่องว่างวิกฤตที่สุด**: MSP (หน่วยความจำตามช่วงเวลา) และ GenesisBlockDB (กราฟความรู้) ไม่เคยเชื่อมต่อกับเส้นทาง webhook สดใจ `createAgentPorts()` ที่มีวัตถุประสงค์นี้ไม่มีเรียกใช้ในการผลิต — ทำให้ FR-029 สถานะ ✅ เป็นการเรียกร้องมากเกินไป
- **โค้ดที่สมบูรณ์ แต่ไม่สามารถเข้าถึงได้**: Gate F (FR-026) OpenRouter OAuth (FR-048) นำไปใช้อย่างเต็มที่ + ทดสอบ แต่ไม่มีเรียกจากเส้นทาง UI หรือสคริปต์
- **ช่องว่างการส่งมอบ**: Gate E tools ลงทะเบียน แต่ไม่มีกลไกส่งมอบ — แบบจำลองไม่สามารถกำหนดตัวเลือกเรียกใช้ได้
- **การละเมิดขอบเขต domain**: agent-write-tools.js เขียน CRM's Conversation/Customer โดยตรง step-up.js เขียน identity's IdentityLinkToken โดยตรง ทั้งคู่ไม่ได้ประกาศในสัญญาสาธารณะ
- **ผลรวม**: ช่องว่าง 19 รายการ (1 CRITICAL, 4 HIGH, 5 MEDIUM, 8 LOW, 1 INFO) ไม่มี refuted findings ไม่มี dropped — จำนวนหลัง critic review เพิ่มจาก 17 เป็น 19 รายการ (เพิ่ม D2-domain-agent-18, D2-domain-agent-19) และ D2-domain-agent-17 ถูกปรับจาก MEDIUM เป็น HIGH

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|--------|---------|--------|
| docs/domains/agent/CHARTER.md | IMPLEMENTED | docs/domains/agent/CHARTER.md:1-43 | owns_models: [] by design; owns_routes: src/app/api/agent/** |
| POST /api/agent/line-webhook | IMPLEMENTED | src/app/api/agent/line-webhook/route.js:1-291 | FR-028,050,052,081,093,097 |
| POST /api/agent/line-delivery | IMPLEMENTED | src/app/api/agent/line-delivery/route.js:1-131 | FR-093 reply receipt |
| GET/POST/DELETE /api/agent/heartbeat | BUILT_NOT_DECLARED | src/app/api/agent/heartbeat/route.js:1-114 | @req/@spec/@tested citations mismatch; no auth POST/DELETE |
| FR-025 Gate E read-only context | PARTIAL | src/modules/agent/context.js:36-107 | Assembly works; tool dispatch missing |
| FR-026 Gate F write/action gate | PARTIAL | src/modules/agent/action-gate.js:79-153 | Complete + tested; zero call sites |
| FR-027 handleAgentTurn turn | IMPLEMENTED | src/modules/agent/turn.js:33-131 | End-to-end turn logic |
| FR-029 createAgentPorts (MSP+GKS) | DECLARED_NOT_BUILT | src/modules/agent/runtime.js:27-38 | Function exists; never called |
| FR-048 ModelProviderPort | IMPLEMENTED | src/modules/agent/model-provider.js:1-166 | OpenRouter OAuth PKCE untrigged |
| FR-049 grounded-business-answer | IMPLEMENTED | src/modules/agent/grounded-business-answer.js:1-101 | Evidence verification + Thai fallback |
| FR-051 production Supabase tenant isolation | IMPLEMENTED | src/modules/knowledge/postgres-business-knowledge.js | Feature note under agent; code under knowledge |
| FR-052 LINE scope binding (live) | IMPLEMENTED | src/modules/agent/line-binding-resolver.js:1-67 | Postgres resolver live |
| FR-052 LINE binding (env config) | MISSING_SURFACE | src/modules/agent/line-channel-binding.js:1-57 | Superseded; stale @tested |
| FR-053 golden question eval | IMPLEMENTED | src/modules/agent/golden-evaluation.js:1-197 | Deterministic PASS 20/20 |
| FR-054 canary preflight | GATED_PRODUCTION | src/modules/agent/canary-preflight.js:1-143 | Dry-run only by design |
| FR-055 LINE activation/rollback | GATED_PRODUCTION | src/modules/agent/line-binding-activation.js:1-231 | Postgres test self-skips by default |
| line-operator.js operator port | MISSING_SURFACE | src/modules/agent/line-operator.js:1-15 | Built; zero imports (except own test) |
| FR-057 authorized context+MSP API-010 | PARTIAL | src/modules/agent/auth-context.js:1-312 | Policy correct; msp_vault_resolve unreached |
| FR-079/080 Phase 1 runtime | IMPLEMENTED | src/modules/agent/phase1-runtime.js:108-259 | Port composition |
| FR-093 line-delivery receipt | IMPLEMENTED | src/app/api/agent/line-delivery/route.js:39-129 | Delivery receipt record |
| FR-096/098 shared policy | PARTIAL | src/modules/agent/tools.js:61-81 | Agent gates self-contained; identity authorizer unwired |
| FR-132 ladder quotation tool | DECLARED_NOT_BUILT | docs/domains/agent/features/FR-132-line-ladder-quotation-tool.md | Blocked by FR-131 |
| Gate E tool registry dispatch | MISSING_SURFACE | src/modules/agent/context.js:95 | Zero call sites |
| MSP live wiring | MISSING_SURFACE | src/modules/agent/runtime.js:27 | Never invoked |
| GenesisBlockDB live wiring | MISSING_SURFACE | src/modules/agent/context.js:87-93 | Never invoked |
| OpenRouter OAuth | IMPLEMENTED | src/modules/agent/openrouter-oauth.js:1-43 | PKCE complete; no route |
| Design docs (4 non-charter files) | DECLARED_ONLY | docs/domains/agent/{intent-pipeline,ethics-governance,prompt-engineering,model-lifecycle}.md | ยุบรวมเป็นบรรทัดเดียวก่อนหน้านี้; ดูข้อวินิจฉัย 18 |
| intent-pipeline.md (LINE intent-extraction pipeline) | DECLARED_NOT_BUILT | docs/domains/agent/intent-pipeline.md:6 — "Draft — not implemented (`TASK-V2-LINE-INTENT`)" v1.3.0 | ดูข้อวินิจฉัย 18 |
| ethics-governance.md (PDPA governance questions) | PARTIAL | docs/domains/agent/ethics-governance.md:6 — 4 open questions block TASK-V2-LINE-INTENT | ดูข้อวินิจฉัย 18 |
| prompt-engineering.md (stale path reference) | DOC_DRIFT | docs/domains/agent/prompt-engineering.md:10 — cites deleted zuri-v2-lab path | ดูข้อวินิจฉัย 18 |
| MSP/GKS/GenesisBlockDB (external) | OUTSIDE_REPO | docs/domains/agent/CHARTER.md:19-22 | By design |
| Test suite mapping | IMPLEMENTED | tests/unit: 12 files; tests/integration: 15 files | No e2e |

#### Findings

##### D2-domain-agent-01 — MSP (หน่วยความจำตามเหตุการณ์) และ GenesisBlockDB (ความรู้ GKS) ไม่เคยถูกเชื่อมเข้ากับเส้นทาง LINE webhook ที่ใช้งานจริงเลย

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | CRITICAL |
| ประเภท | PRODUCTION_GATE_OPEN |
| หลักฐาน | `src/modules/agent/runtime.js:27` — createAgentPorts() is only caller-side is never invoked from any route/script `src/app/api/agent/line-webhook/route.js:150-220` — webhook spreads `...(phase1Ports ?? {})` which has no memory/knowledge `src/modules/agent/phase1-runtime.js:245-253` — returned ports object omits memory/knowledge `src/modules/agent/context.js:79` — falls back to `memory ?? createInMemoryMemory()` every turn `docs/PRD-SDD-v1.0.md:239` — FR-029 marked unqualified ✅ `docs/TRACE.md:225-230` — status "done" |
| สิ่งที่ควรเป็น | ตาม FR-029 ✅ และ requirement ที่ชัดเจนของ FR-057, LINE turn จริงควรอ่าน/เขียนผ่าน MSP transport จริงและ GenesisBlockDB graph reader จริงก่อนเรียก API ใด ๆ |
| สิ่งที่เป็นจริง | createAgentPorts (ออกแบบมาเพื่อเชื่อม MSP+GKS จริง) ถูก define และ unit-test ไว้แล้ว แต่ไม่มีที่ไหนในระบบที่ทำงานจริงเรียกมันเลย webhook จริงสร้าง port ผ่าน createPhase1BusinessAgentPortsFromEnv ซึ่ง output ไม่มี field memory/knowledge ดังนั้นทุก turn ในการผลิตจะ fallback เงียบ ๆ ไปที่ process-local Map (หายเมื่อ restart มองไม่เห็นข้าม instance) สำหรับ memory และ Prisma-relation reader (ไม่ใช่กราฟ) สำหรับ knowledge ผลที่ร้ายแรงที่สุด: msp_vault_resolve (call ที่ FR-057 บังคับให้มี authorization) ไม่มีทางถูกเรียก execute ได้เลยวันนี้ นอกจากนี้ docs/PRD-SDD-v1.0.md บรรทัด 239 ทำเครื่องหมาย FR-029 เป็น ✅ แบบไม่มีเงื่อนไข และ docs/TRACE.md บรรทัด 227 บอกว่า "done" — ทั้งคู่อ้างว่าการเชื่อม createAgentPorts เสร็จสมบูรณ์แล้วทั้งที่ไม่มี call site ในการผลิตเลยแม้แต่จุดเดียว — เป็นการอ้างเกินจริงที่รุนแรงกว่า "API-010 integration in progress" ของ FR-057 เสียอีก |
| ข้อเสนอแนะ | เชื่อม createAgentPorts (พร้อม mspTransport/graphTraverse จริงที่ดึงมาแบบเดียวกับที่ phase1-runtime.js ดึง config Phase 1 อื่น ๆ) เข้ากับ ports object ที่ createPhase1BusinessAgentPortsFromEnv คืนค่า; แยกต่างหาก: แก้ข้อความสถานะ PRD ของ FR-029 และสถานะ TRACE.md จาก ✅/"done" ให้ระบุชัดเจนว่าการเชื่อม MSP/GKS ยังไม่เชื่อมต่อกับเส้นทางที่ใช้งานจริงใด ๆ ในการผลิตวันนี้ |
| เกี่ยวข้อง | D2-domain-agent-04 |
| การตรวจสอบ | CONFIRMED; severity_after CRITICAL |

##### D2-domain-agent-16 — OpenRouter OAuth PKCE flow ของ FR-048 implement และ unit-test แล้ว แต่ไม่มี route ใดในแอปเลย

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | HIGH |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | `src/modules/agent/openrouter-oauth.js:1-43` — createOpenRouterAuthorization/exchangeOpenRouterCode implement full PKCE flow @req FR-048 @tested phase1-business-agent-runtime.test.js `src/modules/agent/index.js:25` — re-exports as public surface `src/app/(pm)/platform/integrations/page.jsx:146` — only reference is `useState('openrouter')` in manual-credential form default; no OAuth initiation button callback route redirect handling `docs/PRD-SDD-v1.0.md:258` — FR-048 status "Phase 1 active - owner-approved 2026-08-14" |
| สิ่งที่ควรเป็น | ตามข้อความ registry ของ FR-048 "OpenRouter OAuth credential references" เป็นโหมด normalize ที่ ModelProviderPort รองรับ และสถานะ "Phase 1 active - owner-approved" บ่งบอกว่า business owner สามารถทำ OAuth flow นี้จนจบเพื่อเชื่อม OpenRouter ได้ |
| สิ่งที่เป็นจริง | grep ทั่วทั้ง src/app tree หา createOpenRouterAuthorization / exchangeOpenRouterCode / 'openrouter' + 'callback' / route ใต้ platform/integrations คืนค่าศูนย์ — ไม่มี route ใดเริ่ม PKCE หรือรับ callback การกล่าวถึง OpenRouter เดียวใน UI คือ form กรอก API-key/model-name ด้วยมือ (form เดียวกันสำหรับทุก provider) ที่มี dropdown ตั้งค่าเริ่มต้นเป็น string 'openrouter' — ไม่มี OAuth affordance เลย module นี้ unit-test ครบในตัวเองแต่ไม่เคยเชื่อมกับสิ่งใดที่ผู้ใช้จริงกดได้ นี่คือ pattern เดียวกันซ้ำอีกครั้ง: implement+test แล้ว แต่ zero production call site |
| ข้อเสนอแนะ | เพิ่ม route initiation/callback (เช่น /api/platform/integrations/openrouter/*) พร้อม UI affordance ที่ขับเคลื่อน flow หรือแก้ข้อความสถานะ FR-048 ให้เป็น "manual API-key credential mode live, OAuth mode unwired" — เป็นช่องว่างประเภทเดียวกับ D2-domain-agent-01/03/09 |
| เกี่ยวข้อง | D2-domain-agent-01, D2-domain-agent-03, D2-domain-agent-09 |
| การตรวจสอบ | verifier-added |

##### D2-domain-agent-03 — Gate F write-action pipeline ไม่มีเส้นทางเรียกใช้จริงในการผลิตเลย

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | HIGH |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | `src/modules/agent/turn.js:72` — 'action' branch fires only when caller supplies 'action' object `src/app/api/agent/line-webhook/route.js:191` — only production call to handleAgentTurn never constructs action field `src/modules/agent/action-gate.js:79` — grep executeAgentAction returns call sites in action-gate.js + turn.js only `src/modules/agent/write-tools.js:119` — 5 registered actions (close_conversation set_customer_lifecycle update_own_display_name deactivate_customer refund_order) reachable from nowhere |
| สิ่งที่ควรเป็น | FR-026 ✅ ใน PRD บ่งบอกว่าเส้นทางเขียนเป็นความสามารถที่ใช้งานได้จริงของ agent ที่ ship แล้ว |
| สิ่งที่เป็นจริง | Pipeline authorize→step-up→transaction→audit ทั้งหมด implement ถูกต้อง + มี tests/integration/agent-action-gate.test.js ครอบคลุม แต่ไม่มีอะไรในระบบที่ทำงานจริงเลย (ไม่มี route ไม่มี model output ไม่มี script) ที่จะสร้าง input 'action' เพื่อ trigger มัน — ถูกต้องสมบูรณ์แต่เข้าถึงไม่ได้เลย |
| ข้อเสนอแนะ | เชื่อม trigger จริงสำหรับ action ของ Gate F (เช่น layer model/tool-calling ที่ populate 'action' จากคำขอลูกค้า ซึ่งวันนี้ยังไม่มี — ดู D2-domain-agent-04) หรือระบุไว้ชัดเจนใน PRD/roadmap ว่า FR-026 "implemented, unreachable pending FR-132-class tool-calling wiring" แทนที่จะเป็น ✅ แบบไม่มีเงื่อนไข |
| เกี่ยวข้อง | D2-domain-agent-04 |
| การตรวจสอบ | CONFIRMED; severity_after HIGH |

##### D2-domain-agent-02 — Route heartbeat/device-pairing มี @req/@spec/@tested ที่ไม่ตรงความจริง และไม่ถูกประกาศตรงกับความสามารถจริงของมัน

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | HIGH |
| ประเภท | BUILT_NOT_DECLARED |
| หลักฐาน | `src/app/api/agent/heartbeat/route.js:6-8` — @req FR-080 @spec ADR-032 @tested tests/unit/fr080-ui-contract.test.js `docs/PRD-SDD-v1.0.md:290` — FR-080 registry text "Platform Integrations UI... IntegrationProvider/Connection/Credential metadata" zero heartbeat/device mentions `docs/decisions/ADR-032` — "Integration Secret Management UI"; grep -i heartbeat = zero `tests/unit/fr080-ui-contract.test.js` — grep heartbeat/deviceId = zero; route never tested by cited test `src/app/api/agent/heartbeat/route.js:25,58,96` — state stored in globalThis.__zuriEdgeDevices ephemeral Map POST/DELETE have zero authentication `docs/appendices/A-api-spec.md:342` — documents "GET/POST /api/agent/heartbeat" bundled under "FR-080: Edge Device pairing"; docs/TRACE.md FR-080 section cites same |
| สิ่งที่ควรเป็น | @req/@spec/@tested ควรตั้งชื่อ requirement/decision/test ที่มีอยู่จริง; ความสามารถที่เชื่อมกับ production UI ควรปรากฏใน registry ให้ตรงกับพฤติกรรมจริง; state ที่ UI พึ่งพาควรอยู่รอด restart ได้; endpoint ที่เขียนข้อมูลต้องมี authentication |
| สิ่งที่เป็นจริง | Route implement edge-device-heartbeat/pairing (ความสามารถจริงที่ไม่ถูกประกาศ) ติดป้ายเป็น FR-080/ADR-032 ซึ่งข้อความ registry จริงพูดถึง Platform Integrations metadata UI (ไม่เกี่ยวข้องกันเลย) ไม่มี FR/test เกี่ยวกับ heartbeat จริงที่ไหนใน docs/PRD-SDD-v1.0.md หรือ docs/FEATURES.md เก็บไว้แค่ใน globalThis Map ชั่วคราว POST/DELETE ไม่มี authentication เลย อย่างไรก็ตาม: route นี้ถูก bundle เข้า FR-080 จริงใน docs/appendices/A-api-spec.md + docs/TRACE.md + doc-graph ที่ generate แล้ว ดังนั้นช่องว่างนี้ไม่ใช่ "ไม่ถูกประกาศต่อ governance" แต่เป็น "ถูก bundle ผิดที่ภายใต้ FR/ADR ที่เนื้อหาไม่ตรงกับสิ่งที่มันทำ" + "ไม่มี test จริง" + "เขียนโดยไม่มี auth" + "state ชั่วคราวป้อน UI จริง" |
| ข้อเสนอแนะ | ประกาศ FR จริงสำหรับ edge-device pairing/heartbeat (แก้ @req/@spec/@tested + เพิ่ม feature note) หรือย้าย route ไปยัง domain ที่เป็นเจ้าของ UI consumer ของมัน (integration) เพิ่ม test จริง/durable storage/auth หรือลบทิ้งถ้าเป็นแค่ scaffolding ที่ไม่ตั้งใจ ship |
| เกี่ยวข้อง | D2-domain-agent-17 |
| การตรวจสอบ | ADJUSTED; severity_after HIGH; correction: ความสามารถนี้ถูก attribute เข้า FR-080 จริงใน generated appendices/TRACE/doc-graph แต่เนื้อหาของ registry FR-080 และ ADR-032 (ทั้งคู่เป็นเรื่อง Platform Integrations metadata / Secret Management UI) ไม่ตรงกับสิ่งที่ route นี้ทำ (edge device heartbeat) นี่คือข้อบกพร่องแบบ bundled-under-mismatched-FR ไม่ใช่ invisible-to-governance |

##### D2-domain-agent-04 — Gate E read-only tool registry ไม่เคยถูก dispatch จาก turn จริงเลย — tool metadata เป็นเพียงของตกแต่ง

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | MEDIUM |
| ประเภท | PARTIAL |
| หลักฐาน | `src/modules/agent/context.js:95` — `.list()` returns only {name, description}; handlers never invoked `src/modules/agent/tools.js:89` — defaultReadOnlyTools registers answer_from_knowledge read_customer_profile search_conversations with real handler() functions `src/modules/agent/model-provider.js:29` — requestFor() builds provider request bodies with no function/tool-calling schema for any provider `src/modules/agent/turn.js:91` — only non-action response paths are DUPLICATE + answerBusinessQuestion(); zero branch calls registry.get(name).handler(...) `tests/integration/iam-authorization.test.js:89` — only '.handler(' call site exercises registry in isolation not via live turn |
| สิ่งที่ควรเป็น | ข้อความ framing ของ FR-025 "binds the agent to... Zuri read-only tools" บ่งบอกว่าเครื่องมือเหล่านี้เป็นสิ่งที่ agent เรียกใช้ได้ระหว่างการสนทนา |
| สิ่งที่เป็นจริง | Gate E tools ทั้ง 3 ตัวได้รับ authorize อย่างถูกต้องและทดสอบแยกเป็นอิสระแล้ว turn จริงไม่เคยเปลี่ยน model output ให้กลายเป็นการเรียกเครื่องมือเลย — context.tools เป็นแค่ metadata ที่ไม่ทำงาน grep ยืนยันว่าไม่มี call site '.handler(' ใน src/modules/agent หรือ src/app/api/agent เลย model ไม่สามารถเลือกเรียกเครื่องมือได้เพราะ requestFor() ไม่ส่ง function-calling schema ให้ LLM provider ใดเลย |
| ข้อเสนอแนะ | นี่คือช่องว่างเชิงระบบที่ feature note ของ FR-132 เองก็ระบุไว้แล้วสำหรับ intent recognition ("whether that is model-selected tool or matcher is unmade decision") ควร generalize การตัดสินใจนั้นให้ครอบคลุม Gate E tools ทั้งหมด ไม่ใช่แค่ ladder-quote ในอนาคต บันทึกสถานะปัจจุบันว่า "tool registry สร้างแล้ว แต่ยังไม่ออกแบบกลไก dispatch" แทนที่จะบ่งบอกว่ามี live tool-calling อยู่แล้ว |
| เกี่ยวข้อง | D2-domain-agent-03 |
| การตรวจสอบ | CONFIRMED; severity_after MEDIUM |

##### D2-domain-agent-05 — write-tools.js และ tools.js ของ agent เขียน/อ่าน Customer และ Conversation ที่ crm เป็นเจ้าของโดยตรง ข้ามสัญญาสาธารณะที่ crm ประกาศไว้

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | MEDIUM |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | `src/modules/agent/write-tools.js:74,87,102,115` — tx.conversation.update({...status: 'CLOSED'}) tx.customer.update({...lifecycleStage}) tx.customer.update({...displayName}) tx.customer.update({...deletedAt, lifecycleStage: 'LOST'}) — direct writes no service layer `docs/domains/crm/CHARTER.md:37` — Public contract lists ingestLineMessage recordLineReply getConversationInbox getConversationThread recordCustomerConsent recordConversationAnalysis/getConversationAnalyses — none of these 4 write operations `docs/domains/crm/CHARTER.md:74` — "Known shared-write exceptions" names only Person writes — no agent `src/modules/agent/tools.js:113` — read_customer_profile queries prisma.customer directly with hand-rolled scopedBusinessFilter instead of calling CRM's getConversationInbox |
| สิ่งที่ควรเป็น | ตาม CLAUDE.md "every write goes through a service in application/" และ convention ของโปรเจกต์: Customer/Conversation ควรถูกแก้ไขผ่านสัญญาสาธารณะที่ crm ตั้งชื่อไว้เท่านั้น |
| สิ่งที่เป็นจริง | grep ยืนยันว่า write-tools.js เป็นผู้เขียนเดียวของ Conversation.status และ Customer.lifecycleStage/displayName/deletedAt ที่ใดก็ตามนอกจาก customer-consent-service.js (จำกัดเฉพาะ field consent*) — เป็นเส้นทางเขียนที่สองที่ไม่ถูกประกาศเข้าสู่โมเดลของ crm |
| ข้อเสนอแนะ | ปัจจุบันเข้าไม่ถึงได้ (D2-domain-agent-03) ดังนั้นความเสี่ยงเป็น latent ไม่ใช่ live — แก้พร้อมกัน: เพิ่มการเขียนทั้ง 4 เข้า public contract ของ crm (crm implement เป็น service) แล้วให้ write-tools.js เรียกใช้ หรือเพิ่มเข้าส่วน "Known shared-write exceptions" ของ crm อย่างชัดเจน เพื่อให้ช่องว่างนี้มองเห็นได้โดยตั้งใจตาม convention ของโปรเจกต์ |
| เกี่ยวข้อง | D2-domain-agent-03 |
| การตรวจสอบ | CONFIRMED; severity_after MEDIUM |

##### D2-domain-agent-06 — step-up.js เขียนเข้า IdentityLinkToken ที่ identity เป็นเจ้าของโดยตรง โดยไม่มีสัญญาที่ประกาศไว้

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | MEDIUM |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | `src/modules/agent/step-up.js:30,50,61` — prisma.identityLinkToken.create({...provider: 'STEPUP',...}) ... findUnique ... update({...consumedAt}) `docs/domains/identity/CHARTER.md:17` — owns_models includes IdentityLinkToken `docs/domains/identity/CHARTER.md:51` — Public contract names only issueLinkToken/redeemLinkToken (LINE account-linking) `docs/domains/identity/CHARTER.md:113` — "Known shared-write exceptions" names only Person — no STEPUP provider mention |
| สิ่งที่ควรเป็น | Model ที่อยู่ใน owns_models ของ domain หนึ่งควรถูกเขียนผ่านสัญญาที่ประกาศไว้เท่านั้น หรือเป็นข้อยกเว้น shared-write ที่ระบุไว้ชัดเจน |
| สิ่งที่เป็นจริง | agent จงใจใช้ IdentityLinkToken ซ้ำในรูปทรง single-use/expiring/(tenant,person)-scoped เดิม โดยใส่ค่า provider แยกเป็น 'STEPUP' (เป็นการตัดสินใจออกแบบที่มีเหตุผลและมี comment กำกับ) แต่สิทธิ์การเขียนนี้ไม่ถูกประกาศไว้ใน charter ของ identity |
| ข้อเสนอแนะ | เพิ่มบรรทัด "Known shared-write exceptions" ใน docs/domains/identity/CHARTER.md ระบุชื่อการใช้ IdentityLinkToken ของ step-up.js ด้วย provider 'STEPUP' หรือสร้างฟังก์ชันสัญญาแคบ ๆ ที่ identity เป็นเจ้าของ (issueStepUpToken/consumeStepUpToken) ให้ agent เรียกใช้แทน |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED; severity_after MEDIUM |

##### D2-domain-agent-07 — หลักฐานระดับ integration เพียงชุดเดียวของการ activate FR-055 และ runtime isolation self-skip ทุกครั้งในการรัน test ตามปกติ

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP |
| หลักฐาน | `tests/integration/controlled-line-activation.postgres.test.js:21` — const runPostgres = adminUrl ? describe : describe.skip; gated on ZURI_FR055_TEST_POSTGRES_URL `tests/integration/line-binding-activation.postgres.test.js:29` — gated ZURI_FR055_TEST_POSTGRES_URL + ZURI_FR055_TEST_DESTRUCTIVE_OPT_IN + ZURI_FR055_TEST_CLUSTER_MARKER `tests/integration/runtime-isolation-probe.postgres.test.js:18` — gated ZURI_TEST_POSTGRES_URL |
| สิ่งที่ควรเป็น | ตาม CLAUDE.md "a green exit code must mean the work ran and passed never that it did not run" — scripts/assert-tests-ran.mjs มีไว้เพื่อจับ suite ที่รันเป็นศูนย์ test |
| สิ่งที่เป็นจริง | assert-tests-ran.mjs fail เฉพาะเมื่อ suite ทั้งหมดรันเป็นศูนย์เท่านั้น ทั้ง 3 ไฟล์นี้ self-skip แยกกันเองผ่าน describe.skip เมื่อไม่มี env var เฉพาะ (ค่าเริ่มต้นในการรัน npm test/CI แบบ SQLite ตามที่ CLAUDE.md อธิบาย) — เส้นทางเขียนที่สำคัญต่อความปลอดภัย (การเปลี่ยนแปลงจริงของ LINE-activation ในการผลิต + probe การแยก tenant) ไม่มีหลักฐานว่าผ่านการทดสอบเลยในการรันอัตโนมัติตามปกติใด ๆ |
| ข้อเสนอแนะ | เพิ่ม governance check หรือ CI job ที่ตั้งค่า env var กับ Postgres แบบใช้แล้วทิ้ง ที่จะ fail เมื่อไฟล์เหล่านี้ไม่ได้ถูกรันเมื่อเร็ว ๆ นี้ แทนที่จะพึ่งให้คนจำได้ว่าต้องรันเองก่อนอนุมัติ activation gate |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED; severity_after MEDIUM |

##### D2-domain-agent-08 — agent-tool IAM authorizer ใหม่ของ identity ไม่ถูกเชื่อมเข้ากับ gate เครื่องมือ/action ใด ๆ ของ agent เองเลย

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | MEDIUM |
| ประเภท | PARTIAL |
| หลักฐาน | `src/modules/identity/agent-tool-authorizer.js:1` — exports authorizeAgentToolExecution @req FR-094 FR-096 FR-098 explicitly framed "agent tool execution" `tests/unit/identity/agent-tool-authorizer.test.js` — only importer in entire repo (grep confirmed) `src/modules/agent/tools.js:61` — requireToolAuthorization agent's live Gate E does not call `src/modules/agent/action-gate.js:27` — authorizeAgentAction agent's live Gate F does not call |
| สิ่งที่ควรเป็น | FR-096/FR-098 "shared policy enforcement... Web/API requests agent turns actions tools" บ่งบอกว่าควรมีจุดบังคับใช้ร่วมจุดเดียวที่ gate ของ agent เองเรียกใช้ |
| สิ่งที่เป็นจริง | ตอนนี้มี authorizer 'agent tool execution' ตัวที่สองคู่ขนานกันอยู่ใน identity module ทดสอบครบในตัวเองแล้ว แต่ gate จริงทั้งสองของ agent ไม่เรียกใช้เลย — authorization implementation สองชุดสำหรับ operation แนวคิดเดียวกันอยู่ร่วมกันโดยไม่ได้ integrate |
| ข้อเสนอแนะ | รวม logic ของ authorizeAgentToolExecution เข้า tools.js/action-gate.js (เลิกใช้ตัวซ้ำ) หรือเชื่อมมันเข้าไปแล้วลบ check เก่าทิ้ง — ติดตามเป็น scope ที่เหลือของ Issue #99 Phase 0 อย่างชัดเจน แทนที่จะปล่อยให้ authorizer สองตัวเบี่ยงเบนกันเงียบ ๆ |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED; severity_after MEDIUM |

##### D2-domain-agent-17 — DELETE ของ heartbeat/route.js ไม่มี authentication ล้าง device registry ทั้งหมดได้ด้วย request เดียว และทุก error path คืน HTTP 200

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | HIGH |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | `src/app/api/agent/heartbeat/route.js:58,96` — POST/DELETE handler เขียนเข้า edgeDevices Map ตรง ๆ ในตัว handler — ไม่มีการเรียก service layer เลย; `src/app/api/agent/heartbeat/route.js:1` — grep recordAudit/audit = ศูนย์; `src/modules/agent/step-up.js:30` — เปรียบเทียบ: ทุกการเขียนอื่นใน domain เรียก recordAudit จาก '@/modules/project-manager/application/audit' — shared audit utility ที่ใช้โดย writer file ทั้ง 23 ไฟล์ทั่ว identity/crm/agent/integration; **`src/app/api/agent/heartbeat/route.js:96-104`** — DELETE อ่าน `deviceId` จาก `searchParams` และเมื่อไม่มีค่านั้น เรียก `edgeDevices.clear()` ตรง ๆ โดยไม่มีการ resolve viewer เลยในทั้ง handler; **`:92` และ `:112`** ทั้งคู่คืน `Response.json({error: ...}, { status: 200 })` — error ทุกกรณี masked เป็น 200 OK; `resolveRequestViewer` ถูก import ที่บรรทัด 3 แต่ถูกเรียกใช้เฉพาะใน GET (บรรทัด 35) ภายใน try/catch ที่ swallow ความล้มเหลวแล้วดำเนินต่อเป็น 'anonymous' (บรรทัด 34-39); `prisma` ถูก import ที่บรรทัด 4 แต่ไม่ถูกใช้เลยในไฟล์ |
| สิ่งที่ควรเป็น | ตาม CLAUDE.md "every write goes through a service in application/ which records audit event" — convention ทั่วทั้งโปรเจกต์ที่ writer file อีก 22 ไฟล์ของ repo นี้ทำตามทั้งหมดด้วย recordAudit ที่ใช้ร่วมกัน; endpoint ที่ลบข้อมูลควรตรวจสอบสิทธิ์ผู้เรียกก่อนเสมอ และ error path ควรคืน HTTP status ที่ถูกต้องเพื่อให้ monitor ตรวจจับความล้มเหลวได้ |
| สิ่งที่เป็นจริง | POST/DELETE ของ heartbeat/route.js เป็น route handler ที่เปลี่ยนแปลง state ตรง ๆ โดยไม่มีการผ่าน service เลยและไม่มี audit trail เลย — เป็น writer route เดียวใน domain (และหนึ่งในไม่กี่แห่งทั่วทั้ง repo) ที่ข้าม convention ทั้งสองพร้อมกัน; **ที่ร้ายแรงกว่านั้น**: ผู้เรียกที่ไม่ระบุตัวตนสามารถล้าง edge device registry ทั้งหมดด้วย request เดียว (`DELETE /api/agent/heartbeat` ไม่มี `?deviceId=`) เพราะไม่มีการ resolve viewer ใด ๆ ใน handler นี้เลย และทุก error path ถูก mask เป็น 200 OK ทำให้ไม่มี monitor ใดเห็น failure จริง |
| ข้อเสนอแนะ | ถ้า route นี้ตั้งใจจะ ship จริง ให้ย้ายการเขียนเข้า application/ service พร้อมเพิ่มการเรียก recordAudit สำหรับการลงทะเบียน/ลบ device ให้สอดคล้องกับ writer อื่นทุกตัว เพิ่มการตรวจสอบ `resolveRequestViewer` ก่อน POST/DELETE ทุกครั้ง และแก้ error path ให้คืน status code ที่ถูกต้อง (4xx/5xx) แทน 200 หากเป็นแค่ scaffolding ให้ลบทิ้งตามคำแนะนำของ D2-domain-agent-02 |
| เกี่ยวข้อง | D2-domain-agent-02 |
| การตรวจสอบ | ADJUSTED (ปรับความรุนแรงจาก MEDIUM → HIGH: ผู้เรียกที่ไม่ระบุตัวตนสามารถล้าง device registry ทั้งหมดได้ด้วย request เดียว และทุก error ถูก mask เป็น 200 OK) |

##### D2-domain-agent-09 — LINE binding resolver แบบตั้งค่าผ่าน env เป็นโค้ดที่ไม่มีผู้เรียกใช้แล้ว และมี @tested annotation ที่ล้าสมัย

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | LOW |
| ประเภท | DOC_DRIFT |
| หลักฐาน | `src/modules/agent/line-channel-binding.js:8` — header @tested tests/unit/line-channel-binding.test.js tests/integration/agent-webhook-route.test.js `tests/integration/agent-webhook-route.test.js` — grep createConfiguredLineBindingResolver/ZURI_LINE_BINDING_ID/line-channel-binding = zero; second cited test does not test this file `src/modules/agent/index.js` — createConfiguredLineBindingResolver not re-exported `src/modules/agent/phase1-runtime.js:3` — actual runtime imports different file line-binding-resolver.js |
| สิ่งที่ควรเป็น | Annotation @tested ควรตั้งชื่อเฉพาะไฟล์ที่ทดสอบโค้ดจริง ตามสัญญา doc-code ของ CLAUDE.md |
| สิ่งที่เป็นจริง | createConfiguredLineBindingResolver implement FR-052/FR-097 ทดสอบแยกเป็นอิสระแล้ว แต่ไม่เคยถูก import ในการผลิตเลย (ถูกแทนที่ด้วย resolver ที่อิง Postgres แล้ว) การอ้างอิง @tested ตัวที่สองเป็นเท็จ |
| ข้อเสนอแนะ | ลบการอ้างอิง @tested ที่ล้าสมัยทิ้ง ลบ resolver ที่ถูกแทนที่แล้วออก หรือระบุให้ชัดเจนว่าเก็บไว้เป็น compatibility/dev fallback พร้อมการอ้างอิง test ที่ถูกต้อง |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED; severity_after LOW |

##### D2-domain-agent-10 — package barrel ของ agent re-export symbol ที่ integration domain ประกาศเป็นสัญญาสาธารณะของตัวเองไว้แล้ว โดยไม่ประกาศ

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | LOW |
| ประเภท | DOC_DRIFT |
| หลักฐาน | `src/modules/agent/index.js:30,37` — re-exports RUNTIME_SOURCES SecretManagerError createSecretManagerPort createVaultSecretManagerAdapter PHASE1_LINE_LLM_PURPOSE selectPhase1PrimaryConnection resolvePhase1PrimaryConnection resolvePhase1PrimaryConnectionByQuery promotePhase1PrimaryConnection `docs/domains/integration/CHARTER.md:100,104` — secret-manager integration-registry separately named Public contract `docs/domains/agent/CHARTER.md:33-36` — Public contract section 2 items; neither re-export mentioned |
| สิ่งที่ควรเป็น | Barrel ของ domain ควร expose สัญญาของ domain ตัวเองเท่านั้น; ความเป็นเจ้าของไฟล์ที่ใช้ร่วมกันควร attribute ไปยังเอกสารของ domain เดียว |
| สิ่งที่เป็นจริง | ผู้เรียก import '@/modules/agent' จะได้รับ surface ขนาดใหญ่ของ symbol ที่ domain อื่นประกาศเป็น public-contract ของตัวเองไปโดยไม่รู้ตัว ทั้งที่ charter ของ agent ไม่ได้บันทึกไว้ |
| ข้อเสนอแนะ | ตัด re-export ออกจาก index.js ของ agent (ให้ผู้เรียก import จาก '@/platform/integrations/core/...' ของ integration โดยตรงแทน) หรือระบุ re-export ไว้ใน charter ของ agent อย่างชัดเจนถ้าจำเป็นต้องคง backward compatibility ไว้ |
| เกี่ยวข้อง | D2-domain-agent-11 |
| การตรวจสอบ | CONFIRMED; severity_after LOW |

##### D2-domain-agent-11 — ไฟล์ของ integration-domain import ไฟล์ภายในของ agent (model-provider.js) โดยตรง แทนที่จะผ่าน package barrel

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | LOW |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | `src/modules/integration/application/integration-management-service.js:6` — import PUBLIC_LINE_PROVIDERS from '@/modules/agent/model-provider' `src/platform/integrations/llm/provider-catalog.js:8` — same direct import `src/modules/agent/index.js:22` — PUBLIC_LINE_PROVIDERS already re-exported through barrel `docs/domains/agent/CHARTER.md:33` — not named Public contract |
| สิ่งที่ควรเป็น | การบริโภคข้าม domain ควรผ่าน entry point ของ package ที่ export ไว้ ซึ่งตั้งชื่อไว้ใน Public contract ของ domain ที่ export |
| สิ่งที่เป็นจริง | ไฟล์ 2 ไฟล์จาก domain อื่นเข้าถึง src/modules/agent/model-provider.js โดยตรง — symbol นี้ไม่ถูกบันทึกไว้ใน charter ของ agent |
| ข้อเสนอแนะ | เปลี่ยน import ให้เป็น 'from @/modules/agent' แล้วเพิ่ม PUBLIC_LINE_PROVIDERS เข้ารายการ Public contract ของ charter agent |
| เกี่ยวข้อง | D2-domain-agent-10 |
| การตรวจสอบ | CONFIRMED; severity_after LOW |

##### D2-domain-agent-12 — Helper สำหรับเชื่อมต่อ Postgres ที่ใช้ร่วมกันซึ่ง annotate ด้วย FR ของ agent อาศัยอยู่จริงในโมดูล knowledge

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | LOW |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | `src/modules/knowledge/runtime-postgres-config.js:3` — header '@req FR-052 FR-054' agent FRs `src/modules/agent/phase1-runtime.js:16` — imports relative path '../knowledge/runtime-postgres-config.js' bypassing '@/modules/knowledge' entry `docs/domains/knowledge/CHARTER.md:139` — Public contract section doesn't name `docs/domains/agent/CHARTER.md:33` — neither |
| สิ่งที่ควรเป็น | โค้ดที่ implement requirement ของ agent ควรอยู่ใน module ของ agent หรือเป็นสัญญา shared/cross-domain ที่ตั้งชื่อไว้ |
| สิ่งที่เป็นจริง | ไฟล์นี้อยู่ใต้ src/modules/knowledge/ แต่ annotate ด้วย FR ของ agent เข้าถึงได้ผ่าน relative import ตรง ๆ ที่ไม่ถูกประกาศในทั้งสอง charter |
| ข้อเสนอแนะ | ย้ายไปที่ตำแหน่งกลาง (src/lib/) เนื่องจากเป็น logic connection-string/CA ของ Postgres ล้วน ๆ ไม่มีเนื้อหาของ knowledge-domain หรือประกาศเป็นสัญญาที่ใช้ร่วมกันในทั้งสอง charter อย่างชัดเจน |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED; severity_after LOW |

##### D2-domain-agent-13 — รายการ FR ต่อ domain ของ DOMAIN-MAP.md นับ requirement ของ route ที่ agent เป็นเจ้าของเองต่ำกว่าความจริง

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | LOW |
| ประเภท | DOC_DRIFT |
| หลักฐาน | `docs/DOMAIN-MAP.md:22` — "FRs implemented in lane" omits FR-028 FR-050 FR-081 `docs/.doc-graph.json:1140` — line-webhook route node @req array explicitly includes them `scripts/doc-views.mjs:29` — domainMap() codeInLane filter only matches 'src/modules/\${m}/' excluding domain's owned route files FR-aggregation even "Routes owned" line correctly counts them |
| สิ่งที่ควรเป็น | รายการ "FRs implemented in lane" ที่ generate ของ domain ควรรวมทุก requirement ที่โค้ดของ domain เอง (รวม route ด้วย) implement |
| สิ่งที่เป็นจริง | FR สองถึงสามตัวที่ route การผลิตเดียวของ domain implement ถูกตัดทิ้งเงียบ ๆ เพราะ generator scan เฉพาะ src/modules/\${name}/ ไม่รวม route ที่ domain เป็นเจ้าของใต้ src/app/api/\${name}/** |
| ข้อเสนอแนะ | แก้ scripts/doc-views.mjs ให้ domainMap() รวม route file ที่ domain เป็นเจ้าของ (คำนวณไว้แล้วเป็น 'routes' ในบรรทัดเดียวกัน) เข้าไปในการรวม FR ของ codeInLane รัน npm run docs:graph เพื่อ regenerate |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED; severity_after LOW |

##### D2-domain-agent-14 — ไม่มี end-to-end test coverage เลยสำหรับ surface ใดของ agent domain

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | LOW |
| ประเภท | TEST_GAP |
| หลักฐาน | `tests/e2e` — 17 Playwright specs, none matching line/agent/heartbeat `src/app/(pm)/platform/integrations/page.jsx:143` — heartbeat panel this page renders (browser-facing surface) also no e2e |
| สิ่งที่ควรเป็น | ตามมาตรฐานของโปรเจกต์ "for anything visible in browser... opened checked" heartbeat/device panel ที่ผู้ใช้เห็นในเบราว์เซอร์ + การแสดง webhook URL ใน Platform Integrations ควรมี e2e |
| สิ่งที่เป็นจริง | Coverage ของ agent-domain อยู่ที่ระดับ unit/integration เท่านั้น ไม่มีอะไรทดสอบ route ของ domain ผ่าน HTTP client ในเบราว์เซอร์แบบ e2e เลย |
| ข้อเสนอแนะ | Route webhook/delivery เป็น backend-to-backend (LINE/zuri-cli ไม่ใช่เบราว์เซอร์) จึงมีความสำคัญต่ำกว่า; heartbeat panel เป็น surface ในเบราว์เซอร์จริง ต้องการ e2e เมื่อ D2-domain-agent-02 ได้รับการแก้ไขแล้วและความสามารถถูกประกาศอย่างถูกต้อง |
| เกี่ยวข้อง | D2-domain-agent-02 |
| การตรวจสอบ | CONFIRMED; severity_after LOW |

##### D2-domain-agent-15 — Feature note ของ FR-051 ถูกจัดไว้ใน agent domain แต่ implementation ทั้งหมดอยู่นอก src/modules/agent

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | INFO |
| ประเภท | DOC_DRIFT |
| หลักฐาน | `docs/domains/agent/features/FR-051-production-supabase-tenant-isolation.md:2` — frontmatter domain: agent `docs/TRACE.md:1` — FR-051 section cites Code: src/modules/knowledge/postgres-business-knowledge.js exclusively no file src/modules/agent |
| สิ่งที่ควรเป็น | ผู้อ่านที่ตาม path "agent domain -> feature notes -> code" ควรพบ implementation ของ FR-051 อยู่ใน src/modules/agent |
| สิ่งที่เป็นจริง | grep -rln FR-051 src/modules/agent = ศูนย์; implementation เดียวของ requirement นี้อยู่ใน knowledge module และ scripts/ ผ่านการตรวจสอบของ preflight ที่ว่า domain/folder ตรงกัน (frontmatter ตรงกับ folder) แต่สร้างความประหลาดใจในการนำทางจริง |
| ข้อเสนอแนะ | ไม่ต้องดำเนินการอะไรนอกจากรับทราบไว้ — สอดคล้องกับที่ FR-051 เป็น concern ร่วมของการ bootstrap การผลิต ไม่ใช่ความสามารถเฉพาะของ agent-module พิจารณาเพิ่ม cross-reference หนึ่งบรรทัดใน feature file ชี้ไปยังตำแหน่งโค้ดจริง |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED; severity_after INFO |

##### D2-domain-agent-18 — เอกสาร design ที่ไม่ใช่ charter ของ agent domain 4 ฉบับไม่เคย inventory แยกรายฉบับ; ฉบับหนึ่งประกาศความสามารถที่ยังไม่สร้าง อีกฉบับอ้าง path ที่ถูกลบไปแล้วตั้งแต่การ flatten repo วันที่ 2026-08-12

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | LOW |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/domains/agent/intent-pipeline.md:6 — "Status \| Draft — not implemented (`TASK-V2-LINE-INTENT`)", v1.3.0, ระบุว่า LINE ควร converge เข้า BR-009/SDD-009 pipeline; docs/domains/agent/ethics-governance.md:6 — "Draft — question #4 closed at MVP scope (FR-103); #1, #2, #3, #6 still block `TASK-V2-LINE-INTENT`"; docs/domains/agent/prompt-engineering.md:10 อ้าง `zuri-v2-lab/src/modules/project-manager/import/plan-schema.js` ซึ่งไม่มีอยู่แล้ว (`ls zuri-v2-lab` → No such file or directory — ไฟล์จริงย้ายไปที่ src/modules/project-manager/import/plan-schema.js ตั้งแต่การ flatten repo วันที่ 2026-08-12); เดิมรายงานฉบับนี้ยุบทั้ง 4 เอกสารเป็นบรรทัดเดียวใน Inventory ("Design docs \| DECLARED_ONLY \| docs/domains/agent/ \| Charter promises only") ไม่มีการอ้างชื่อเอกสารรายฉบับเลย |
| สิ่งที่ควรเป็น | เอกสาร design ที่ไม่ใช่ charter ควรถูก inventory แยกรายฉบับ เพื่อให้ declared-but-unbuilt capability (intent-pipeline.md) และ open governance gate (ethics-governance.md) ปรากฏในรายงาน ไม่ถูกยุบรวมจนมองไม่เห็น |
| สิ่งที่เป็นจริง | intent-pipeline.md ประกาศความสามารถ LINE intent-extraction ที่ยังไม่ implement — เป็น capability gap เดียวกับที่รายงานนี้พูดถึง 3 ครั้งแล้ว (D2-domain-agent-03, D2-domain-agent-04, ข้อเสนอแนะ 19) แต่ไม่เคยอ้างอิงเอกสารที่ประกาศมันไว้เลย; ethics-governance.md บันทึกคำถาม governance ที่ยังเปิดอยู่ 4 ข้อซึ่งบล็อกงานเดียวกัน — เป็น open gate ที่รายงานฉบับนี้ไม่เคยลิสต์ไว้; prompt-engineering.md อ้าง path ที่ถูกลบไปแล้ว |
| ข้อเสนอแนะ | แยก Inventory row ของทั้ง 4 เอกสาร; อ้างอิง intent-pipeline.md จาก D2-domain-agent-03/04; อัปเดต prompt-engineering.md:10 ให้ชี้ไปที่ src/modules/project-manager/import/plan-schema.js; ติดตาม 4 คำถามที่เปิดอยู่ใน ethics-governance.md เป็น checklist item แยกก่อนปลด TASK-V2-LINE-INTENT |
| เกี่ยวข้อง | D2-domain-agent-03, D2-domain-agent-04 |
| การตรวจสอบ | critic-added |

##### D2-domain-agent-19 — CHARTER.md ขาด Version/Status control block (shared debt ทั้ง 8 domain charter)

| ฟิลด์ | รายละเอียด |
|------|----------|
| ระดับ | LOW |
| ประเภท | DOC_DRIFT |
| หลักฐาน | grep -cE '^version:\|^status:' docs/domains/agent/CHARTER.md = 0; เหมือนกันทั้ง 8 charter (agent, crm, identity, integration, knowledge, market-intelligence, platform-control, project-manager) |
| สิ่งที่ควรเป็น | ทุก charter ควรมี Version/Status control block ตาม convention ของโปรเจกต์ |
| สิ่งที่เป็นจริง | Key นี้ไม่มีในทั้ง 8 charter — ก่อนหน้านี้รายงานเฉพาะ crm (INFO), identity (LOW), integration (INFO), project-manager (LOW) เท่านั้น ทำให้ agent ดูเหมือนปฏิบัติตาม convention นี้แล้วทั้งที่ไม่ใช่ |
| ข้อเสนอแนะ | เพิ่ม Version/Status frontmatter ให้ครบทั้ง 8 charter ในการแก้ไขครั้งถัดไป |
| เกี่ยวข้อง | — |
| การตรวจสอบ | critic-added |

#### ข้อจำกัดการตรวจ

**Finder scope**: อ่าน docs/domains/agent/CHARTER.md เต็ม ทั้ง 7 feature notes docs/domains/agent/features/ (FR-051,052,053,054,055,057,132) ทั้ง 26 files src/modules/agent/** (3,346 lines wc -l ตรวจสอบแล้ว) ทั้ง 3 route.js src/app/api/agent/** (line-webhook line-delivery heartbeat — confirmed by find ไม่มี agent route อื่น) ตรวจสอบแนว docs/PRD-SDD-v1.0.md rows ทุก FR agent code อ้างอิง (FR-025..029,047-055,057,079-081,093,096-098,132 — ทั้ง present registry ไม่มี orphan ids) ตรวจสอบแนว docs/TRACE.md sections grep entire src/ ทุก call site createAgentPorts handleAgentTurn executeAgentAction .handler( mspTransport graphTraverse ทั้ง prisma write Conversation/Customer/IdentityLinkToken — establish reachability (dead-code) claims certainty ไม่ใช่ inference ตรวจสอบทั้ง 3 *.postgres.test.js files self-skip guards ตรวจสอบ docs/roadmap/ROADMAP.md docs/decisions/ADR-032 heartbeat/device-pairing (ศูนย์ mentions)

**Not examined**: identity crm knowledge integration modules' own internal correctness (charters + specific agent-touching files only — ไม่ audited end-to-end) ไม่มี npm test/docs:preflight (read-only; relied committed docs/.doc-graph.json direct grep/read) D:\msp D:\gks (outside repo correctly out of scope — gap here repo's own wiring ไม่ใช่ MSP/GKS internal)

**Verifier method**: Read docs/domains/agent/CHARTER.md full ทั้ง 7 feature notes ทั้ง 26 module files (spot-read + targeted greps) ทั้ง 3 route.js cross-checked docs/PRD-SDD-v1.0.md docs/TRACE.md docs/DOMAIN-MAP.md docs/appendices/A-api-spec.md D-traceability.md docs/.doc-graph.json identity/crm/integration/knowledge charters ทุก cross-domain touch. ทั้ง 15 finder findings substantiated direct file/line reads + greps; none refuted outright. D2-domain-agent-02 ADJUSTED: heartbeat capability IS bundled FR-080/SEC-016 generated appendices TRACE doc-graph under FR/ADR text ไม่เกี่ยวข้องหน่วยกลาง. Two verifier-added findings: FR-048 OpenRouter OAuth + audit-convention violation heartbeat writes. ไม่มี dropped findings (ไม่มี REFUTED verdicts).

## domain-crm

### domain-crm

#### สรุปย่อ

- **โมเดล**: Person, Customer, Conversation, Message, ConversationAnalysis และชุด CustomerImportReview สี่ตัว ใช้งานได้ครบตามสเก็ตช์ส่วนใหญ่ ยกเว้นการใช้งาน ConversationAnalysis ที่ยังไม่มีผู้ผลิต และขัดข้องจาก agent + identity ที่เขียนข้อมูลโดยไม่ประกาศ
- **สัญญาสาธารณะ**: ฟังก์ชันหลัก 6 ตัว (ingestLineMessage, recordLineReply, getConversationInbox/getConversationThread, recordCustomerConsent, FR-078 review-queue) ใช้งานได้ถูกต้อง แต่ agent/write-tools.js เขียน Customer/Conversation โดยตรงผ่าน raw Prisma โดยไม่ผ่านสัญญาใด ๆ
- **ขอบเขตเส้นทาง**: charter ขาดประกาศ `owns_routes` ทำให้เส้นทาง API 3 เส้น (FR-091 x2, FR-103 x1) และกลุ่มเส้นทาง FR-078 review-queue ถูกนับเข้าไป project-manager แทน crm
- **ความสอดคล้องทะเบียน**: identity เขียนได้ชอบด้วย 3 รุ่น (Person, Customer soft-delete+redact, ConversationAnalysis hard-delete) แต่เฉพาะ Person เท่านั้นที่ระบุในข้อยกเว้น 'shared-write' ของทั้งสอง charter
- **ระเบียบโครงสร้าง**: Enum CUSTOMER_LIFECYCLE, MESSAGE_DIRECTIONS, CUSTOMER_IMPORT_REVIEW_ACTIONS ไม่เรียนรู้มาจากแหล่งเดียว; Conversation.status มีคอลัมน์ที่ไม่ใช้งาน; Customer.version optimistic-concurrency column อยู่ แต่ไม่มี writer ใด ๆ อ่านหรือ increment มัน
- **ประกาศแต่ไม่สร้าง**: FEAT-014 ยังขาดผู้ผลิตและเส้นทาง UI สำหรับ FR-126 (CustomerProfile), FR-128 (DailyBrief) และส่วนที่เหลือของ FR-127

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|--------|---------|---------|
| Person (model) | IMPLEMENTED | prisma/schema.prisma:154-193 | Global, tenant-scoped ตามการประกาศ charter; เขียนโดย crm และ identity ตามข้อยกเว้น shared-write ที่ประกาศแล้ว |
| Customer (model) | IMPLEMENTED | prisma/schema.prisma:1097-1131 | เขียนโดย crm, identity (undocumented), agent (undocumented), project-manager backup (undocumented) — ดูข้อวินิจฉัย 03,06,07,01 |
| CustomerImportBatch/Provenance/ReviewCase/ReviewDecision (models) | IMPLEMENTED | prisma/schema.prisma:1135-1240 | Postgres adapter (createZuriCoreCustomerReviewStore) ไม่มีการทดสอบหน่วย — ดูข้อวินิจฉัย 13 |
| Conversation (model) | IMPLEMENTED | prisma/schema.prisma:1241-1263 | เขียนโดย crm และ agent write-tools (status='CLOSED', undocumented) — ดูข้อวินิจฉัย 05 |
| Message (model) | IMPLEMENTED | prisma/schema.prisma:1264-1281 | สองนักเขียน: line-ingest-service (INBOUND), reply-record-service (OUTBOUND); ประกาศแล้ว |
| ConversationAnalysis (model) | PARTIAL | prisma/schema.prisma:1283-1305 | ส่วนเสริม + reader/writer มีอยู่ แต่ไม่มีผู้เรียกมาจากการผลิต/เส้นทาง/UI — ดูข้อวินิจฉัย 17 |
| CustomerProfile (FEAT-014, FR-126) | DECLARED_ONLY | docs/PRD-SDD-v1.0.md:336 | ประกาศถูกต้องทั่วทั้ง PRD/charter; ไม่มีสเก็ตช์/บริการ/พื้นผิว |
| DailyBrief (FEAT-014, FR-128) | DECLARED_ONLY | docs/PRD-SDD-v1.0.md:338 | เช่นเดียวกับข้างบน |
| ingestLineMessage (FR-023 public contract) | IMPLEMENTED | src/modules/crm/line-ingest-service.js:38-121 | ปรากฏที่เส้นทางที่ระบุ แต่ยังคงยอมรับ direction:'OUTBOUND' — ดูข้อวินิจฉัย 12 |
| recordLineReply (FR-093 public contract) | IMPLEMENTED | src/modules/crm/reply-record-service.js:68-130 | ตรงกับรายละเอียด charter (idempotent on reply:<inboundMessageId>) |
| getConversationInbox/getConversationThread (FR-091) | IMPLEMENTED | src/modules/crm/conversation-read-model.js:128-297 | Read-only ตามที่ประกาศ; truncation-flag bug ตัวเล็กน้อย — ดูข้อวินิจฉัย 16 |
| recordCustomerConsent (FR-103 public contract) | IMPLEMENTED | src/modules/crm/customer-consent-service.js:62-118 | Owner-gated, tenant-scoped ถูกต้อง; UI wired ที่ src/app/(pm)/customer/conversations/page.jsx:75 |
| recordConversationAnalysis/getConversationAnalyses (FR-127) | PARTIAL | src/modules/crm/conversation-analysis-service.js:154-221 | มีต่อ contract; ไม่มีผู้เรียก — ดูข้อวินิจฉัย 17 |
| FR-078 review-queue functions (3 functions) | IMPLEMENTED | src/modules/crm/customer-import-review-service.js:61-146 | Built & wired; ไม่ได้ตั้งชื่อโดยฟังก์ชันในพูดเพียง prose — ดูข้อวินิจฉัย 15 |
| GET/POST /api/crm/conversations routes (3 routes) | IMPLEMENTED | src/app/api/crm/** | ปรากฏ, annotated, แต่ attributed ไป project-manager — ดูข้อวินิจฉัย 09 |
| /api/platform/customer-import-reviews routes (FR-078) | IMPLEMENTED | src/app/api/platform/** | Route ownership drift เช่นเดียวกัน — ดูข้อวินิจฉัย 10 |
| crm charter owns_routes | MISSING | docs/domains/crm/CHARTER.md:1-14 | Frontmatter ขาดคีย์ owns_routes — ดูข้อวินิจฉัย 09, 10 |
| /customer, /customer/conversations UI (FR-091/103) | IMPLEMENTED | src/config/domains.js:48-51; src/app/(pm)/customer/** | soon:false, live in nav, e2e-covered |
| agent/write-tools.js direct writes | IMPLEMENTED (undeclared) | src/modules/agent/write-tools.js:66-117 | Reachable via handleAgentTurn → executeAgentAction — ดูข้อวินิจฉัย 03, 04, 05 |
| MERGE_PENDING customer-merge path | PARTIAL | src/modules/identity/link-line-identity.js:130-139 | Write-only audit trail, nothing reads it — ดูข้อวินิจฉัย 08 |
| FR-013 snapshot backup/restore (crm models) | IMPLEMENTED (undeclared) | src/modules/project-manager/application/backup-service.js:51-106,230-236 | PDPA-erasure risk — ดูข้อวินิจฉัย 01, 02 |
| MESSAGE_DIRECTIONS/CUSTOMER_LIFECYCLE enum discipline | PARTIAL | src/lib/validation/ | Hand-copy ใน entities.js line 84 แทนการ import — ดูข้อวินิจฉัย 11 |
| Tests: unit, integration, e2e | PARTIAL | tests/unit/*crm*, tests/integration/*crm*, tests/e2e/fr091* | Coverage แข็งแรง FR-091/093/103 local; ขาด Postgres adapter (13) & FR-078 e2e (14) |

#### Findings

##### D2-domain-crm-03 — agent/write-tools.js writes directly to Customer and Conversation via raw Prisma, bypassing crm's entire public contract (currently unreachable — no live trigger constructs the action input)

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | MEDIUM |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | write-tools.js:74 `tx.conversation.update({ status: 'CLOSED' })`; :87 `tx.customer.update({ lifecycleStage })`; :102 `tx.customer.update({ displayName })`; :115 `tx.customer.update({ deletedAt, lifecycleStage: 'LOST' })`; src/app/api/agent/line-webhook/route.js — grep 'action' = 0 matches, ผู้เรียก handleAgentTurn ในการผลิตรายเดียวไม่เคยสร้าง input `action` เลย (เส้นทางนี้ latent ไม่ใช่ live — ดู D2-domain-agent-03 HIGH ที่ยืนยันเรื่องเดียวกันแล้ว); agent/CHARTER.md:19 "Owns no Prisma models by design"; crm/CHARTER.md:76 shared-write-exceptions ตั้งชื่อเฉพาะ Person จาก identity |
| สิ่งที่ควรเป็น | Per crm charter, Customer/Conversation writes ไปผ่าน public contract (ingestLineMessage, recordLineReply, recordCustomerConsent) หรือลงทะเบียนเป็น documented shared-write exception เหมือน Person |
| สิ่งที่เป็นจริง | FR-026 write-tool registry จำเป็นต้องทำ 4 การเขียน raw Prisma เป็น crm-owned models โดยไม่เกี่ยวข้องกับ crm module function ใด ๆ และไม่เปิดเผยใน charters ทั้ง crm และ agent — แต่เส้นทางนี้ยังไม่ live เพราะไม่มี production trigger ใดสร้าง `action` input ให้ handleAgentTurn เลย (D2-domain-agent-03) ความเสี่ยงนี้จะเปิดใช้งานทันทีที่ Gate F dispatch ถูกเชื่อมต่อ (D2-domain-agent-03/04) |
| ข้อเสนอแนะ | Route การเขียนทั้ง 4 ผ่าน crm-owned service functions (e.g., `setCustomerLifecycle`/`closeConversation`) ที่ write-tools.js เรียกใช้ หรือ explicitly document เป็นข้อยกเว้น shared-write ที่สี่ใน crm charter โดยใช้ caveat เดียวกันกับ Person — ควรแก้ก่อน Gate F dispatch ถูกเชื่อมต่อ |
| เกี่ยวข้อง | D2-domain-crm-04, D2-domain-crm-05, D2-domain-agent-03 |
| การตรวจสอบ | ADJUSTED (severity HIGH → MEDIUM; correction: title/evidence เดิมอ้างว่า "live-reachable from a LINE turn" และอ้าง turn.js:77 เป็นหลักฐานการเชื่อมต่อจริง ซึ่งขัดแย้งโดยตรงกับ D2-domain-agent-03 (HIGH) และ D2-domain-agent-05 ในรายงานฉบับเดียวกันที่ยืนยันว่าเส้นทางนี้ "no live invocation path in production"; grep 'action' บน line-webhook/route.js คืนค่าศูนย์ ยืนยันว่า unreachable) |

##### D2-domain-crm-04 — set_customer_lifecycle writes an unvalidated payload string into Customer.lifecycleStage, bypassing the canonical CUSTOMER_LIFECYCLE enum (currently unreachable — same latent trigger as crm-03)

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | MEDIUM |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | write-tools.js:84 อ่าน payload.lifecycleStage ไม่มีการตรวจสอบ; :87 ค่าดิบถูกเก็บไว้เป็นมี; entities.js:156 zExecuteAgentActionInput payload เป็น z.record(z.any()).default({}) — ไม่มี per-action payload schema; :181 zHandleAgentTurnInput เช่นกัน; enums.js:134 CUSTOMER_LIFECYCLE = ['LEAD','ACTIVE','DORMANT','LOST'] ไม่เคยสอบถาม; tests/integration/agent-action-gate.test.js:68 ทดสอบเฉพาะค่าที่ถูกต้อง 'ACTIVE'; src/app/api/agent/line-webhook/route.js — grep 'action' = 0 matches เช่นเดียวกับ D2-domain-crm-03 เส้นทางนี้ latent ไม่ live |
| สิ่งที่ควรเป็น | CLAUDE.md: "Enums are strings... never hand-copy" และ BR-009/SDD-009 "every write goes through one disciplined path"; การเขียนไปยัง Customer.lifecycleStage ควรได้รับการตรวจสอบ CUSTOMER_LIFECYCLE |
| สิ่งที่เป็นจริง | เมื่อ Gate F dispatch ถูกเชื่อมต่อในอนาคต (D2-domain-agent-03/04) ผู้เรียกใช้งาน LINE turn ที่ได้รับอนุญาตจะสามารถเขียนสตริงตามอำเภอใจ (ไม่ใช่ LEAD/ACTIVE/DORMANT/LOST) เข้าไปใน Customer.lifecycleStage ได้ทันที เนื่องจาก action-gate Zod schema และ execute() ฟังก์ชันไม่มีการตรวจสอบ — วันนี้ยังไม่มีเส้นทางเรียกใช้จริง (D2-domain-agent-03) จึงเป็นความเสี่ยง latent ไม่ใช่ live |
| ข้อเสนอแนะ | เพิ่ม `zCustomerLifecycle.parse(payload.lifecycleStage)` ใน set_customer_lifecycle execute() และเพิ่มการทดสอบที่ยืนยันว่าค่าที่ไม่ถูกต้องถูกปฏิเสธแล้ว — ควรแก้ก่อน Gate F dispatch ถูกเชื่อมต่อ |
| เกี่ยวข้อง | D2-domain-crm-03, D2-domain-agent-03 |
| การตรวจสอบ | ADJUSTED (severity HIGH → MEDIUM; same latent-vs-live correction as D2-domain-crm-03) |

##### D2-domain-crm-05 — close_conversation writes Conversation.status='CLOSED' though no CONVERSATION_STATUSES enum exists, contradicting crm's own feature-note claim that nothing writes this field

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | write-tools.js:74 `tx.conversation.update({ status: 'CLOSED' })`; docs/domains/crm/features/FR-091-conversation-inbox.md:93 "Nothing writes the field... no enum declared"; docs/PRD-SDD-v1.0.md:301 duplicate สำเนาของการอ้างสิทธิ์ที่เก่า; enums.js:132 CHANNELS และ MESSAGE_DIRECTIONS ประกาศแต่ไม่มี CONVERSATION_STATUSES export |
| สิ่งที่ควรเป็น | ไม่มีอะไรเขียน Conversation.status (ตามข้อกล่าว FR-091, scoped ไปที่ 'this slice') หรือหาก code ทำ enums.js ควรเก็บค่าตั้ง canonical per repo convention |
| สิ่งที่เป็นจริง | agent/write-tools.js ทำเขียน Conversation.status (hardcoded 'CLOSED', ไม่ user-controlled) ดังนั้นข้อกล่าวของ feature note ('nothing writes') เป็นเท็จที่ระดับ repo แม้ว่าจะเป็นจริงภายใน FR-091 |
| ข้อเสนอแนะ | ประกาศ CONVERSATION_STATUSES (ขั้นต่ำ ['OPEN','CLOSED']) ใน enums.js; อัปเดตข้อกล่าว FR-091 feature note และ PRD row ให้ scope ถูกต้อง |
| เกี่ยวข้อง | D2-domain-crm-03 |
| การตรวจสอบ | CONFIRMED; correction: สำเนาของข้อกล่าวสองอย่างนี้ปรากฏใน PRD/feature note เช่นกัน |

##### D2-domain-crm-06 — identity/erase-principal.js writes Customer (soft-delete + redact) and hard-deletes ConversationAnalysis directly; only Person is documented as identity's shared-write exception in either charter

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | erase-principal.js:55 `tx.customer.findMany`; :61-64 `tx.conversationAnalysis.deleteMany`; :66-70 `tx.customer.update({ deletedAt, displayName: REDACTED, lifecycleStage })`; crm/CHARTER.md:76 shared-write-exceptions ตั้งชื่อเฉพาะ Person; identity/CHARTER.md:115 เช่นกัน |
| สิ่งที่ควรเป็น | shared-write-exceptions sections ควรลงรายการ model ทั้งหมดที่ domain code เขียนบน behalf ของ domain อื่น ตามรูปแบบที่ใช้สำหรับ Person |
| สิ่งที่เป็นจริง | erasePrincipal (identity) mutate สอง crm-owned models เพิ่มเติม (soft-delete/redact Customer, hard-delete ConversationAnalysis) ที่ charter shared-write-exceptions list ทั้งสองรายการไม่ระบุ |
| ข้อเสนอแนะ | Extend shared-write-exceptions bullet เป็น "Person, Customer (soft-delete+redact) and ConversationAnalysis (hard delete) are written by identity's erasePrincipal"; code นี้เหมาะสมแล้ว เพียงแต่ต้องบันทึกไว้ที่ pattern มีอยู่ |
| เกี่ยวข้อง | D2-domain-crm-07 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-crm-07 — identity/link-line-identity.js repoints Customer.personId directly during a principal merge; undocumented in either charter

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | link-line-identity.js:117-122 `tx.customer.update({ personId: targetPersonId })`; crm/CHARTER.md:76 shared-write-exceptions ตั้งชื่อเฉพาะ Person |
| สิ่งที่ควรเป็น | crm-owned model ใด ๆ ที่ identity code แตะต้องควรตั้งชื่อใน shared-write-exceptions list |
| สิ่งที่เป็นจริง | link-line-identity.js repoint Customer row personId เมื่อการ merge หา orphaned Customer โดยไม่มีการประกาศ |
| ข้อเสนอแนะ | เพิ่มไปยังบุลเลตเดียวกันที่ recommended ใน finding 06 |
| เกี่ยวข้อง | D2-domain-crm-06, D2-domain-crm-08 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-crm-08 — The 'both principals already have a Customer' merge-conflict branch only logs a MERGE_PENDING audit event that nothing ever reads, resolves, or tests

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | MEDIUM |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | link-line-identity.js:130-136 แสดง audit write MERGE_PENDING ใน else-if orphanCustomer && targetCustomer; grep 'MERGE_PENDING' repo-wide จำแนนจำเพียง site เดียว; ไม่มี route/UI/script/test อ่านอยู่ |
| สิ่งที่ควรเป็น | Per code comment, 'true merge... needs CRM's preview/confirm path (BR-009)' — ระบุตัวจริงการ resolve ควรอยู่ |
| สิ่งที่เป็นจริง | grep 'MERGE_PENDING' เพิ่มเติมหา write site เดียว — ไม่มี route, UI, report หรือ script อ่าน; สอง Customer rows (และ split conversation/message history) ถูกทิ้ง permanently unreconciled |
| ข้อเสนอแนะ | Build BR-009 preview/confirm merge surface ที่ comment คาดการณ์ หรือที่ต่ำสุดทำให้เห็น unresolved MERGE_PENDING เหตุการณ์ (เช่นข้าง FR-078 review queue); เพิ่มการทดสอบ integration สร้าง orphanCustomer+targetCustomer collision case |
| เกี่ยวข้อง | D2-domain-crm-07 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-crm-09 — crm's charter declares no owns_routes at all, so DOMAIN-MAP.md shows 'Routes owned: 0' for crm despite 3 real, correctly-annotated API routes implementing its own public contract

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | MEDIUM |
| ประเภท | BUILT_NOT_DECLARED |
| หลักฐาน | crm/CHARTER.md:1 frontmatter ไม่มี owns_routes key; DOMAIN-MAP.md:32 "Routes owned \| 0 (0 api · 0 pages)" สำหรับ crm; project-manager/CHARTER.md:46,49 owns_routes includes catch-all 'src/app/api/**'; src/app/api/crm/conversations/route.js:8 @req FR-091 present; /customers/[customerId]/consent/route.js:5 @req FR-103 present |
| สิ่งที่ควรเป็น | Domain's own API routes ใช้งาน public contract ฟังก์ชันควร attribute ไปยัง domain นั้นใน DOMAIN-MAP.md |
| สิ่งที่เป็นจริง | Because crm charter ไม่มี owns_routes, doc-graph generator longest-prefix-glob rule fallback ไป project-manager catch-all, ดังนั้น crm's 3 real routes (2 for FR-091, 1 for FR-103) attribute ไป project-manager แทน crm; crm route count undercounted as zero |
| ข้อเสนอแนะ | เพิ่ม `owns_routes:\n  - src/app/api/crm/**` ไปยัง crm/CHARTER.md frontmatter แล้ว `npm run docs:graph` เพื่อ regenerate DOMAIN-MAP.md/TRACE.md |
| เกี่ยวข้อง | D2-domain-crm-10 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-crm-10 — FR-078's review-queue routes and page also fall under project-manager's catch-all instead of crm, for the same missing-owns_routes reason

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | LOW |
| ประเภท | BUILT_NOT_DECLARED |
| หลักฐาน | src/app/api/platform/customer-import-reviews/route.js:3 import listCustomerImportReviewQueue from crm service; page.jsx:9 @req FR-078; DOMAIN-MAP.md:32 crm routes remains 0 |
| สิ่งที่ควรเป็น | เหมือน finding 09 |
| สิ่งที่เป็นจริง | Paths เหล่านี้ที่อยู่ภายใต้ src/app/(pm)/platform/** และ src/app/api/platform/** resolve ไปยัง project-manager catch-all globs แทน crm |
| ข้อเสนอแนะ | หากการแก้ไข finding 09 เพิ่มเพียง 'src/app/api/crm/**' finding นี้ยังคง resolve ไป project-manager (อยู่ /platform ไม่ใช่ /crm) — ต้องการตัดสินใจว่า FR-078 surface ควร move ลงมา crm charter (add paths) หรือ stay attribute ไป project-manager |
| เกี่ยวข้อง | D2-domain-crm-09 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-crm-11 — zIngestLineMessageInput hand-copies the direction enum instead of importing the canonical MESSAGE_DIRECTIONS/zMessageDirection

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | entities.js:84 `direction: z.enum(['INBOUND','OUTBOUND']).default('INBOUND')` — literal array; enums.js:133 MESSAGE_DIRECTIONS export; :189 zMessageDirection export ที่ entities.js ไม่ import; :16 zConversationAnalysisContactType IS imported — file follow ถูกต้อง pattern สำหรับ other enums |
| สิ่งที่ควรเป็น | CLAUDE.md: "Enums are strings... never hand-copy" |
| สิ่งที่เป็นจริง | entities.js import zConversationAnalysisContactType/State ถูกต้อง แต่ hand-copy ['INBOUND','OUTBOUND'] สำหรับ FR-023 schema แทน import zMessageDirection |
| ข้อเสนอแนะ | Import zMessageDirection และแทนที่ hand-copied enum ที่ line 84 |
| เกี่ยวข้อง | D2-domain-crm-12 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-crm-12 — ingestLineMessage's schema still accepts direction:'OUTBOUND', though FR-093's entire design assumes no caller will ever pass it — and nothing enforces that invariant in code

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP |
| หลักฐาน | entities.js:84 ทั้ง values accepted; line-ingest-service.js:38 ไม่มี direction restriction; docs/domains/crm/features/FR-091-conversation-inbox.md:542 "a search... finds no caller that passes OUTBOUND" — safety เป็น empirical absence; reply-record-service.js:11 "WHY THIS IS NOT ingestLineMessage({direction:'OUTBOUND'})" — design rationale |
| สิ่งที่ควรเป็น | Per reply-record-service design, outbound message ต้องไม่เคยสร้าง Person/Customer/Conversation ใหม่ |
| สิ่งที่เป็นจริง | FR-023 ingest seam schema และ function body place ไม่มีข้อ restriction preventing caller invoke ingestLineMessage with direction:'OUTBOUND', ซึ่งจะสร้าง 'invented conversation' scenario FR-093 built เพื่อ prevent; no test asserts rejection |
| ข้อเสนอแนะ | Restrict zIngestLineMessageInput direction ไปยัง literal 'INBOUND' (dropping enum/default), เพิ่ม test proving OUTBOUND ingest attempt rejected |
| เกี่ยวข้อง | D2-domain-crm-11 |
| การตรวจสอบ | CONFIRMED; additional: only one production caller (turn.js) currently exists |

##### D2-domain-crm-13 — The actual production Postgres adapter for the FR-078 review queue (createZuriCoreCustomerReviewStore) has zero test coverage — only pure helpers and store-selection logic are tested

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP |
| หลักฐาน | customer-import-review-store.js:309 createZuriCoreCustomerReviewStore ~160 lines raw SQL; :289 withRuntimeRole SET LOCAL ROLE safety check; tests/unit/customer-import-review-store-contract.test.js:19 only test helpers/selection logic |
| สิ่งที่ควรเป็น | Production write path สำหรับ PII-adjacent, RBAC-gated, optimistic-concurrency queue ควรมี test coverage |
| สิ่งที่เป็นจริง | No test call createZuriCoreCustomerReviewStore หรือ exercise SQL query strings, row-locking (`for update`), optimistic-concurrency version check, หรือ SET LOCAL ROLE identity-mismatch guard |
| ข้อเสนอแนะ | เพิ่ม unit test with mocked pg.Pool ครอบ version-conflict 409 path, LINK_EXISTING cross-scope rejection, runtime-role-mismatch throw |
| เกี่ยวข้อง | (ไม่มี) |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-crm-21 — Customer import review decision action values are hand-copied twice inside customer-import-review-store.js with no canonical declaration in enums.js

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | customer-import-review-store.js:54 `caseStatus()` inline ['CREATE_SEPARATE','LINK_EXISTING','REJECT']; :105 `validateDecisionInput()` inline ['CREATE_SEPARATE','LINK_EXISTING','REJECT','DEFER'] — second, differently-formed copy ใน file เดียว; enums.js — no export exists; prisma/schema.prisma:1224 CustomerImportReviewDecision.action plain String column |
| สิ่งที่ควรเป็น | Per CLAUDE.md, action vocabulary ประกาศ once ใน enums.js referenced ทั่วทั้ง |
| สิ่งที่เป็นจริง | สี่ action values listed independently ที่ two call sites ใน file เดียว, ไม่ที่ไหน enums.js |
| ข้อเสนอแนะ | เพิ่ม e.g. CUSTOMER_IMPORT_REVIEW_ACTIONS และ zCustomerImportReviewAction schema ไปยัง enums.js; แทนที่ both inline arrays ด้วย references |
| เกี่ยวข้อง | D2-domain-crm-11 |
| การตรวจสอบ | verifier-added |

##### D2-domain-crm-22 — Customer.version exists as an optimistic-concurrency column but no writer across agent, crm or identity ever reads or increments it

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP |
| หลักฐาน | prisma/schema.prisma:1108 Customer.version Int @default(1) — field-naming pattern ใช้สำหรับ real optimistic concurrency (Session, ChannelIdentity, CustomerImportReviewCase); write-tools.js:87 `tx.customer.update({ lifecycleStage })` — no version read/increment; customer-consent-service.js:106 เช่นกัน; erase-principal.js:67 increment version บน Session/ChannelIdentity แต่ไม่ Customer; link-line-identity.js:122 เช่นกัน |
| สิ่งที่ควรเป็น | `version` column present ที่ 6 independent update call sites ควรทำงาน optimistic-concurrency guard เหมือนกับ Session, ChannelIdentity, CustomerImportReviewCase |
| สิ่งที่เป็นจริง | grep for Customer.version read/increment across src/ จำแนนจำเพียง zero — every 6 Customer-updating call site blind-write โดยไม่ check/bump |
| ข้อเสนอแนะ | Wire `version: { increment: 1 }` plus `where: { id, version: expectedVersion }` guard ลงไป Customer writers, หรือ remove column หาก optimistic concurrency ไม่เคยมี intent สำหรับ Customer |
| เกี่ยวข้อง | (ไม่มี) |
| การตรวจสอบ | verifier-added |

##### D2-domain-crm-02 — Snapshot restore has no PDPA-erasure awareness; restoring an older backup can resurrect a person's already-erased PII

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | MEDIUM |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | backup-service.js:230-238 delete+recreate loop กับไม่มี erasure/PDPA filtering; erase-principal.js:67 redact Customer.displayName + soft-delete — mutation เฉพาะ live DB state; tests/integration/crm-conversation-analysis.test.js:326 prove PII survives export/import verbatim |
| สิ่งที่ควรเป็น | FR-022/FR-095 erasure guarantee ควร hold regardless ของ backup/restore — erased person ควร stay erased |
| สิ่งที่เป็นจริง | Snapshot export เมื่อ PDPA erasure, restore afterward จะ resurrect pre-erasure Person/Customer, เนื่องจาก importSnapshot perform verbatim delete-and-recreate โดยไม่มี erasure-state check |
| ข้อเสนอแนะ | Record erasure event cutoff ดังนั้น restore สามารถ refuse/filter snapshots เก่ากว่า erasedAt, หรือ explicitly document เป็น accepted operational risk ใน charter + FR-013/BR-008 spec |
| เกี่ยวข้อง | D2-domain-crm-01 |
| การตรวจสอบ | ADJUSTED severity MEDIUM (was HIGH); correction: mechanism real but inherent property ของ point-in-time snapshot/restore, gated ไปยัง installation-operator authority, rare disaster-recovery action, ไม่ routine flow |

##### D2-domain-crm-01 — project-manager's charter claims it "does not touch" CRM models, but its own backup-service.js reads and writes all 9 crm-owned models directly

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | LOW |
| ประเภท | DOC_DRIFT |
| หลักฐาน | project-manager/CHARTER.md:83 "Does not touch CRM's Person/Customer/..."; backup-service.js:51-108 SNAPSHOT_MODELS array include 9 crm models; :235-238 delete+recreate loop กับทั้งหมด; @req annotations FR-013/FR-078/FR-127 ใน code; assertRestoreOperator gate :35-46; tests/integration/backup.test.js, crm-conversation-analysis.test.js tested |
| สิ่งที่ควรเป็น | Per project-manager's charter, module never touch CRM Person/Customer/Conversation/Message |
| สิ่งที่เป็นจริง | backup-service.js (part ของ project-manager) delete/recreate 9 crm models via raw tx calls, gated ไปยัง installation-operator, extensively @req-annotated |
| ข้อเสนอแนะ | Narrow charter boundary line ไป explicitly exclude FR-013 engine ("does not touch CRM models in domain logic; FR-013 snapshot engine is repo-wide exception"), หรือ move engine ไปยัง neutral location; document เป็น named cross-cutting capability |
| เกี่ยวข้อง | D2-domain-crm-02 |
| การตรวจสอบ | ADJUSTED severity LOW (was HIGH); correction: accuracy กำหนดไว้ (9 models, delete+recreate) แต่ framing overstates risk — ไม่ routine domain logic, single FR-013 engine, gated, annotated, tested; documentation drift, ไม่ boundary breach |

##### D2-domain-crm-14 — FR-078's review-queue UI+API has no end-to-end (Playwright) test, unlike sibling FR-091/FR-103 which do

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | LOW |
| ประเภท | TEST_GAP |
| หลักฐาน | tests/e2e/fr091-conversation-inbox.spec.js:65 FR-091/FR-103 have Playwright spec; tests/unit/customer-import-review-ui.test.js:1 FR-078 UI unit-level; no tests/e2e/ matching file exists |
| สิ่งที่ควรเป็น | Multi-actor, RBAC-gated, optimistic-concurrency review-and-decide flow (sibling CRM features have coverage) |
| สิ่งที่เป็นจริง | No file tests/e2e/ reference FR-078 |
| ข้อเสนอแนะ | เพิ่ม Playwright spec exercise opening queue, append decision, confirm stale expectedVersion rejected |
| เกี่ยวข้อง | D2-domain-crm-13 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-crm-15 — Charter's Public contract section never names FR-078's actual exported function surface, unlike every other bullet

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | LOW |
| ประเภท | BUILT_NOT_DECLARED |
| หลักฐาน | crm/CHARTER.md:69 FR-078 bullet prose-only, ไม่มี function names; :39 other bullets ตั้งชื่อ exact exported functions; customer-import-review-service.js:61,88,110 listCustomerImportReviewQueue, listCustomerImportReviewTargets, appendCustomerImportReviewDecisions |
| สิ่งที่ควรเป็น | Consistency — ตั้งชื่อ exact function identifiers |
| สิ่งที่เป็นจริง | FR-078 paragraph describe behavior ไม่มี function name |
| ข้อเสนอแนะ | เพิ่ม one-line bullet naming ฟังก์ชัน 3 เดียวกับ others |
| เกี่ยวข้อง | (ไม่มี) |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-crm-16 — getConversationInbox's truncated flag is a false-positive-prone heuristic, and untested

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | LOW |
| ประเภท | TEST_GAP |
| หลักฐาน | conversation-read-model.js:134 `take: limit` cap query; :230 `truncated: rows.length === limit` — heuristic; rows.length never exceed limit; no test assert `truncated` field |
| สิ่งที่ควรเป็น | `truncated` true เมื่อมี conversations ปรากฏเพิ่มเติมอยู่นอกหน้า returned |
| สิ่งที่เป็นจริง | query guarantee rows.length never exceed limit, ดังนั้น condition true ทั้ง exactly-limit (no more) และ more-than-limit (correctly truncated) — cannot distinguish |
| ข้อเสนอแนะ | Fetch `limit + 1` rows, set `truncated = fetched.length > limit` (trim extra), หรือ run separate `count()` query; เพิ่ม test exact-boundary case |
| เกี่ยวข้อง | (ไม่มี) |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-crm-17 — recordConversationAnalysis/getConversationAnalyses have zero production callers anywhere in the codebase

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | LOW |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | conversation-analysis-service.js:154,200 defined; only tests/integration/crm-conversation-analysis.test.js reference; grep entire repo confirms; docs/FEATURES.md:36 FEAT-014 status 'building' |
| สิ่งที่ควรเป็น | Match feature note declared scope — matches exactly ('Worker/LLM/provider... out of scope') |
| สิ่งที่เป็นจริง | No worker, cron, route, script, UI อ่าน either function outside test file — capability correct แต่ unreachable production deployment |
| ข้อเสนอแนะ | No immediate action (matches plan); when FEAT-014 next increment lands producer, confirm closing; track ROADMAP.md not-yet-built ที่ไม่ explicitly mention FR-127 gap |
| เกี่ยวข้อง | D2-domain-crm-18 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-crm-20 — crm's charter is missing standard Version/Status control fields (shared debt across all 8 domain charters)

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | LOW |
| ประเภท | DOC_DRIFT |
| หลักฐาน | crm/CHARTER.md:1 frontmatter has domain/module/owns_models — no version/status/created_at/last_update fields; docs/.preflight-report.json finding I6: "Missing control fields" for crm charter; feature notes have control blocks; grep -cE '^version:\|^status:' returns 0 for all 8 domain charters (agent, crm, identity, integration, knowledge, market-intelligence, platform-control, project-manager) — this is not crm-specific |
| สิ่งที่ควรเป็น | Per project doc-control convention, charter file carry version/status fields |
| สิ่งที่เป็นจริง | Already preflight tracked as INFO non-blocking; ปรับระดับเป็น LOW ให้สอดคล้องกับ identity-19/project-manager-14 ที่รายงานข้อบกพร่องเดียวกันในระดับเดียวกัน |
| ข้อเสนอแนะ | Low priority; add ที่ next revision (e.g. adding owns_routes) |
| เกี่ยวข้อง | D2-domain-crm-09 |
| การตรวจสอบ | ADJUSTED (severity INFO → LOW: normalized to match identical defect reported elsewhere as LOW) |

##### D2-domain-crm-19 — crm's read/write services depend directly on seesBusiness/ownsBusiness from identity/viewer-authority.js, which identity's own charter's Public contract section never names

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | INFO |
| ประเภท | BUILT_NOT_DECLARED |
| หลักฐาน | conversation-read-model.js:4 import seesBusiness; customer-consent-service.js:4 import ownsBusiness; conversation-analysis-service.js:4 import both; identity/CHARTER.md:37 Public contract names 16 exports ไม่ seesBusiness/ownsBusiness |
| สิ่งที่ควรเป็น | ฟังก์ชัน 32 files repo-wide depend ควร name ใน owning domain Public contract |
| สิ่งที่เป็นจริง | seesBusiness/ownsBusiness real, heavily-used แต่ absent identity charter contract list |
| ข้อเสนอแนะ | Fix once ใน identity charter (add bullet naming per-Business authority predicates) resolve สำหรับ crm และ every consumer |
| เกี่ยวข้อง | (ไม่มี) |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-crm-18 — ROADMAP.md's 'สิ่งที่ยังไม่ได้สร้างจริง' (not-yet-really-built) list predates FEAT-014 and does not mention FR-126/FR-128/FR-127's remaining producer-and-surface gap

| ฟิลด์ | รายละเอียด |
|--------|------------|
| ระดับ | INFO |
| ประเภท | DOC_DRIFT |
| หลักฐาน | ROADMAP.md:275 dated 'gap analysis 2026-08-26' ก่อน FEAT-014; :287 7 items ไม่ mention FR-126/128/127; docs/PRD-SDD-v1.0.md:336 FR-126 correctly 🔜 |
| สิ่งที่ควรเป็น | List enumerate ทุก 'declared but not coded' เพื่อให้ completion percentages ถูก |
| สิ่งที่เป็นจริง | FR-126/128 และ FR-127 remainder tracked ใน PRD/FEATURES, ไม่ specific roadmap summary list |
| ข้อเสนอแนะ | เพิ่ม FEAT-014 scope เป็น 8th item next refresh สำหรับ single reader-friendly view |
| เกี่ยวข้อง | D2-domain-crm-17 |
| การตรวจสอบ | CONFIRMED |

#### ข้อจำกัดการตรวจ

**ขอบเขตการค้นหา**: Read เต็มจำนวน docs/domains/crm/CHARTER.md และ 5 files โดยใน docs/domains/crm/features/ (FR-078, FR-091, FR-093, FR-103, FR-127); ทั้ง 7 files ใน src/modules/crm/** (1,549 lines); 9 owns_models blocks ใน prisma schemas; 3 crm-owned routes + platform/customer-import-reviews route/page; agent/write-tools.js, agent/action-gate.js, agent/turn.js; identity/erase-principal.js, identity/link-line-identity.js (เต็ม); relevant sections src/lib/validation/entities.js และ enums.js; src/config/domains.js nav entries; docs/DOMAIN-MAP.md, docs/TRACE.md, docs/PRD-SDD-v1.0.md, docs/FEATURES.md, docs/roadmap/ROADMAP.md; docs/.doc-graph.json, docs/.preflight-report.json, docs/.route-anchor-baseline.json; project-manager charter boundary/public-contract sections; identity charter เต็ม; src/modules/project-manager/application/backup-service.js SNAPSHOT_MODELS และ importSnapshot.

**ไม่ได้เปิด / out of scope**: Full identity module (เฉพาะ erase-principal.js, link-line-identity.js, rbac.js, viewer-authority.js signatures); full project-manager module beyond backup-service.js (30+ files ไป project-manager domain); 22 Python/JS backfill scripts under scripts/ (CLI/script-only surface, extensively documented approval-gated design); live Postgres/Supabase runtime (ไม่มี DB reachable จาก static repo audit). ไม่ execute test suite (npm test rule) — test-coverage claims based reading test files + grepping.

**วิธีการตรวจสอบ**: (1) Read crm/CHARTER.md เต็ม + 5 feature notes; (2) Confirmed ทั้ง 9 owns_models byte-for-byte ใน both prisma files; (3) grep every writer across src/ ของ person/customer/conversation/message/conversationAnalysis — ไม่มี undocumented cross-domain writers เพิ่มเติม; (4) verified 20 finder findings กับ actual file/line content — 20 held factually, 2 ADJUSTED down severity; (5) checked PRD rows FR-023/078/091/093/097/103/127 — statuses/caveats matched exactly; (6) searched 2 additional real gaps ใน crm's module (hand-copied review-action enum, unused Customer.version optimistic-concurrency); (7) verified no models written by platform-control/market-intelligence/integration/knowledge/business/people.

## domain-identity

### domain-identity

#### สรุปย่อ

- **ฟีเจอร์ชั้นสูง 4 รายการขาดเส้นทางการเรียกใช้**: FR-022 (PDPA erasure), FR-076 (RoleBinding assignment), FR-107/FR-010 (PlatformGrant revocation), FR-094–FR-098 (agent tool IAM authorization) มีการใช้งานเพียงในหน่วยทดสอบเท่านั้น — ขึ้นอยู่กับประตูเปิด Issue #99 Phase 0 P0
- **ขอบเขตโดเมนละเมิด 3 ประเภท**: agent/step-up.js เขียน IdentityLinkToken โดยตรง; erase-principal.js เขียน Customer/ConversationAnalysis โดยตรง; onboarding-service.js สร้าง Portfolio โดยไม่เรียก createPortfolio — ไม่ถูกบันทึกว่าเป็นข้อยกเว้นที่ประกาศ
- **สัญญาติดต่อสัญญาที่สร้างแต่ไม่ประกาศ**: viewer-authority.js (นำเข้าโดย 32+ ไฟล์), request-viewer/gate/rbac/channel-identity ไม่ปรากฏในส่วน Public contract ของ charter
- **8 endpoint ที่เป็นเจ้าของ identity หลงทิศทาง**: /api/viewer, /api/profile, /api/platform/users/* ไม่อยู่ใน owns_routes glob ของ charter ทำให้ DOMAIN-MAP.md ไม่ครอบครัวและเปิดรับพื้นที่สำหรับการติดตามผลกระทบที่ขาดหายไป
- **ช่องว่างการทดสอบ**: ไม่มี e2e สำหรับ FR-066/067 workspace invite/onboarding flow; ไม่มี .postgres.test.js สำหรับโมเดล identity ใด; Supabase migration tests (FR-102/FR-106) เป็นแบบสถิตย์เท่านั้น (ไม่สามารถเรียกใช้กับ live Postgres ได้)
- **ประตูการผลิตเปิด**: FR-123 plugin auth, FR-094–FR-098 IAM canonical boundary ขึ้นอยู่กับบริหารจัดการตามกำหนดการ; FR-097 verified channel onboarding ต้องหลักฐานจากผู้ให้บริการ; canManageProduct (FR-076 consumption side) ไม่มีเสียงเรียกผลิตภัณฑ์ใด ๆ เลย

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|-------|--------|--------|
| Model: ExternalIdentity | IMPLEMENTED | prisma/schema.prisma:1039 | ใช้โดย resolve-line-identity.js |
| Model: IdentityLinkToken | PARTIAL | prisma/schema.prisma:1061 | เขียนโดย agent/step-up.js:30,61 (D2-01-02) |
| Model: ExternalRef | PARTIAL | prisma/schema.prisma:1078 | ทั้งหมดจาก project-manager import/external-ref.js (D2-01-01) |
| Model: RoleBinding | PARTIAL | prisma/schema.prisma:469 | เขียนโดย rbac-service.js แต่ไม่มีผู้เรียกผลิตภัณฑ์ (D2-domain-identity-08) |
| Model: PersonCredential | IMPLEMENTED | prisma/schema.prisma:296 | ใช้โดย auth-service, signup-service |
| Model: PasswordResetToken | IMPLEMENTED | prisma/schema.prisma:306 | ใช้โดย auth-service (FR-104) |
| Model: Session | IMPLEMENTED | prisma/schema.prisma:422 | ใช้โดย auth-service |
| Model: ChannelIdentity | IMPLEMENTED | prisma/schema.prisma:446 | ใช้โดย channel-identity.js (FR-097) |
| Model: SotDataPlaneKey | IMPLEMENTED | prisma/schema.prisma:1826 | ใช้โดย sot-data-plane-auth.js (FR-102) |
| Model: WorkspaceMembership | IMPLEMENTED | prisma/schema.prisma:234 | ใช้โดย onboarding/workspace-membership services (FR-066/067) |
| Model: WorkspaceInvite | IMPLEMENTED | prisma/schema.prisma:261 | ใช้โดย workspace-membership-service.js (FR-067) |
| Model: ApiAccessKey | IMPLEMENTED | prisma/schema.prisma:1854 | Supabase migration 2026-08-26 (FR-106) |
| Model: PlatformGrant | PARTIAL | prisma/schema.prisma:208–223 | สร้างเท่านั้น ไม่มีการเรียกใช้ยกเลิก (D2-domain-identity-10) |
| Model: PluginInstallation | IMPLEMENTED | prisma/schema.prisma:326 | ใช้โดย plugin-auth-service.js (FR-123) |
| Model: PluginAuthorizationCode | IMPLEMENTED | prisma/schema.prisma:344 | ใช้โดย plugin-auth-service.js (FR-123) |
| Model: PluginSession | IMPLEMENTED | prisma/schema.prisma:368 | ใช้โดย plugin-auth-service.js (FR-123) |
| Route: (entry)/** | IMPLEMENTED | ทั้งหมดbusinesses, onboarding/profile, plugin/authorize เป็นต้น | อ้างสิทธิ์โดย FR-044/FR-046 |
| Route: /login, /signup, /reset-password /** | IMPLEMENTED | src/app/{login,signup,reset-password}/page.jsx | อ้างสิทธิ์โดย FR-044, FR-120 |
| Route: /api/{auth,entry,onboarding,workspace-invites,workspace-memberships,plugin/auth}/** | IMPLEMENTED | 16 route.js files ตรงกับ DOMAIN-MAP.md:24 count | กำหนดไป identity |
| Undeclared identity routes | MISSING_SURFACE | /api/{viewer,profile,platform/users*}, /(pm)/{profile,platform/users} | 8 endpoint ไม่อยู่ใน charter glob (D2-domain-identity-05) |
| Public contract: resolveLineIdentity, classifyPrincipal, erasePrincipal, authorizeScope | IMPLEMENTED | resolve-line-identity, classify-principal, erase-principal, authorization-context | ทั้งหมด @ export verified |
| De facto contract: viewer-authority.js | BUILT_NOT_DECLARED | นำเข้า 32+ ไฟล์, ไม่ใช่ใน Public contract (D2-domain-identity-06) | ownsBusiness, seesBusiness, isInstallationOperator เป็นต้น |
| De facto contract: request-viewer, gate, channel-identity, rbac | BUILT_NOT_DECLARED | นำเข้า PlatformControlGuard, agent/action-gate, crm/customer-import-review | ไม่ปรากฏใน charter (D2-domain-identity-07) |
| FR-021 LINE identity resolution | IMPLEMENTED | docs/PRD-SDD-v1.0.md:231 ✅ | src/modules/identity/resolve-line-identity.js |
| FR-022 LINE identity provider + PDPA erasure | PARTIAL | docs/PRD-SDD-v1.0.md:232 ✅ | erasePrincipal ไม่มีเส้นทางผลิตภัณฑ์ (D2-domain-identity-09) |
| FR-031 Viewer gate | IMPLEMENTED | docs/PRD-SDD-v1.0.md:241 ✅ | tests/unit/viewer-gate.test.js |
| FR-038 Profile & Permissions | IMPLEMENTED | docs/PRD-SDD-v1.0.md:248 ✅ | src/app/(pm)/profile, /api/profile |
| FR-044 Entry routing | IMPLEMENTED | docs/PRD-SDD-v1.0.md:254 ✅ | fr044-entry-routing.spec.js |
| FR-046 Production viewer entry contract | IMPLEMENTED | docs/PRD-SDD-v1.0.md:256 ✅ | fr046-entry-contract.spec.js |
| FR-066 Profile-first onboarding | IMPLEMENTED | docs/PRD-SDD-v1.0.md:276 ✅ | onboarding-service.js; ไม่มี e2e (D2-domain-identity-16) |
| FR-067 Workspace invitation | IMPLEMENTED | docs/PRD-SDD-v1.0.md:277 ✅ | workspace-membership-service.js; ไม่มี e2e (D2-domain-identity-16) |
| FR-102 SoT data-plane service-account auth | IMPLEMENTED | docs/PRD-SDD-v1.0.md:312 ✅ | Supabase migration 2026-08-27; static test only (D2-domain-identity-15) |
| FR-104 Owner-assisted password reset | IMPLEMENTED | docs/PRD-SDD-v1.0.md:314 ✅ | auth-service.js; e2e coverage |
| FR-106 Enterprise API access key | IMPLEMENTED | docs/PRD-SDD-v1.0.md:316 ✅ | Supabase migration 2026-08-27; ไม่มี GET/list (D2-domain-identity-22) |
| FR-120 Self-serve account creation | IMPLEMENTED | docs/PRD-SDD-v1.0.md:330 ✅ | signup-service.js; e2e coverage |
| FR-061 Per-Business domain visibility | BUILT_NOT_ENFORCED | src/lib/business-shell-guard.js:19-26; src/modules/identity/viewer-domains.js | Client-side only ทุกที่ — ไม่มี API route ใดตรวจสอบ (D2-domain-identity-23) |
| FR-062 Permissions read scope | BUILT_NOT_ENFORCED | docs/domains/identity/features/FR-062-permissions-read-scope.md | Companion ของ FR-061; server-side enforcement เดียวกันขาดหาย (D2-domain-identity-23) |
| FR-121 Google second way-in | DECLARED_ONLY | docs/PRD-SDD-v1.0.md:331 🔜 blocked | ศูนย์โค้ด — รอ Google OAuth ภายนอก (D2-domain-identity-24) |
| FR-122 Profile identity fields | IMPLEMENTED | docs/PRD-SDD-v1.0.md:332 ✅; src/modules/identity/onboarding-service.js:38,116 | ไม่เคยถูกตรวจสอบก่อนหน้านี้ (D2-domain-identity-24) |
| FR-123 Plugin authentication | GATED_PRODUCTION | docs/PRD-SDD-v1.0.md:333 🟠 | ท้องถิ่น; Supabase/client registration/device-binding/scheduler รออยู่ (D2-domain-identity-14) |
| Test coverage: unit/integration identity | IMPLEMENTED | ~50+ test files | viewer-gate, auth-service, signup, password-reset, plugin-auth, workspace-invite |
| Test coverage: e2e identity entry flows | PARTIAL | fr044, fr046, fr104, fr120, fr123 e2e exist | ไม่มี e2e สำหรับ FR-066/067 (D2-domain-identity-16) |
| Test coverage: .postgres.test.js identity models | MISSING | find tests -name '*.postgres.test.js' | 3 files ทั้งหมด ไม่ใช่ identity (D2-domain-identity-17) |

#### Findings

##### D2-domain-identity-09 — erasePrincipal (PDPA erasure, FR-022/FR-095) has no production caller anywhere

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | CRITICAL |
| **ประเภท** | BROKEN_FLOW |
| **หลักฐาน** | src/modules/identity/erase-principal.js:25; tests/integration/identity-erase.test.js — เพียงสองผู้เรียก; grep -rn erasePrincipal src/ scripts/ ส่งคืนเฉพาะการอ้างอิงภายใน |
| **สิ่งที่ควรเป็น** | FR-022/FR-095 ประกาศการล้างข้อมูล PDPA เป็นความสามารถที่ส่งมอบแล้ว (✅); charter กำหนดการล้างข้อมูลว่า "จำหน่ายข้อมูลประจำตัว" — หมายถึงอยู่ที่ตัวดำเนินการ |
| **สิ่งที่เป็นจริง** | ไม่มี route, UI page หรือ CLI script ใด ๆ ที่เรียกใช้ erasePrincipal — ปัจจุบันการร้องขอลบข้อมูล PDPA ทั้งหมดไม่มีทางดำเนินการนอกจากรหัสที่เขียนด้วยมือหรือ console ฐานข้อมูล |
| **ข้อเสนอแนะ** | เพิ่ม operator/owner-facing route (เช่น /api/platform/users/[id]/erase หรือ scripts/erase-principal.mjs) ที่เรียก erasePrincipal |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-identity-02 — agent/step-up.js writes IdentityLinkToken directly, undeclared cross-domain

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | HIGH |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | src/modules/agent/step-up.js:30 — prisma.identityLinkToken.create; src/modules/agent/step-up.js:61 — tx update; docs/domains/agent/CHARTER.md:18 — 'Owns no Prisma models by design'; docs/domains/identity/CHARTER.md:115 — shared exceptions name only Person |
| **สิ่งที่ควรเป็น** | Per agent's charter, no Prisma models; per identity's charter, IdentityLinkToken writes should be declared exceptions |
| **สิ่งที่เป็นจริง** | src/modules/agent/step-up.js เขียน IdentityLinkToken โดยตรงพร้อมกับ `import prisma` — ไม่มีการนำเข้าจากฟังก์ชันสัญญา identity |
| **ข้อเสนอแนะ** | เพิ่มฟังก์ชัน identity-module (เช่น issueStepUpToken) ที่ agent เรียกใช้; บันทึก dual use ใน identity's 'Known shared-write exceptions' |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-identity-08 — FR-076 Product Owner RoleBinding assignment has zero production callers

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | HIGH |
| **ประเภท** | BROKEN_FLOW |
| **หลักฐาน** | src/modules/identity/rbac-service.js:80,122 — export assignRoleBinding/updateRoleBindingStatus; tests/unit/fr076-product-owner-business-assignment.test.js — sole caller |
| **สิ่งที่ควรเป็น** | FR-076 states a Person may hold active RoleBinding per Business as operator-usable capability |
| **สิ่งที่เป็นจริง** | ไม่มี page, API route หรือ CLI script ใด ๆ ที่สามารถสร้าง/suspend RoleBinding ในแอปพลิเคชันที่ทำงาน |
| **ข้อเสนอแนะ** | เพิ่ม API route หรือ CLI script ที่เรียก assignRoleBinding/updateRoleBindingStatus |
| **เกี่ยวข้อง** | D2-domain-identity-13, D2-domain-identity-21 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-identity-10 — PlatformGrant revocation unreachable; read-side check wired but write-side missing

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | HIGH |
| **ประเภท** | MISSING_SURFACE |
| **หลักฐาน** | prisma/schema.prisma:208 — revokedAt, revokeReason fields; src/modules/identity/operator-bootstrap.js — create-only; grep -rn revokePlatformGrant src/ scripts/ = nothing; src/modules/identity/session-port.js hasOperatorGrant() checks status/revokedAt immediately |
| **สิ่งที่ควรเป็น** | Schema implies designed lifecycle where PlatformGrant can be revoked; FR-107: 'revoking denies the very next request' |
| **สิ่งที่เป็นจริง** | ไม่มีเส้นทางโค้ดใด ๆ เพื่อยกเลิก; ยิ่งไปกว่านั้น ไม่มี list/read surface สำหรับ PlatformGrant เลย (ตัวดำเนินการไม่สามารถดูใครถือ OPERATOR ได้) — สิทธิสูงสุด แต่ยกเลิกทั้งหมดไม่อยู่ |
| **ข้อเสนอแนะ** | เพิ่มเส้นทาง GET และ DELETE ไป /api/platform/operator-grants/** |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | ADJUSTED — upgraded HIGH, revocation check wired but unreachable |

##### D2-domain-identity-20 — authorizeAgentToolExecution (FR-094/096/098) built but never wired into actual tool dispatcher

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | HIGH |
| **ประเภท** | BROKEN_FLOW |
| **หลักฐาน** | src/modules/identity/agent-tool-authorizer.js:8,23 — export authorizeAgentToolExecution, TOOL_PERMISSION_MAP; @tested only in unit test; src/modules/agent/tools.js — imports authorizeScope from authorization-context instead, never imports agent-tool-authorizer |
| **สิ่งที่ควรเป็น** | FR-094/096/098 (FEAT-010 agent/tool IAM authorization) implies TOOL_PERMISSION_MAP is actual mechanism gating tool calls |
| **สิ่งที่เป็นจริง** | grep -rln authorizeAgentToolExecution src/ = only agent-tool-authorizer.js; src/modules/agent/tools.js uses coarser authorizeScope gate instead (no per-tool-name permission map) — newer authorizer is dead code |
| **ข้อเสนอแนะ** | เรียก authorizeAgentToolExecution จาก src/modules/agent/tools.js ก่อนส่งแต่ละเครื่องมือ; หรือลบมันพร้อม test ถ้า authorizeScope ซ้อนกันแล้ว |
| **เกี่ยวข้อง** | D2-domain-identity-11, D2-domain-identity-12 |
| **การตรวจสอบ** | verifier-added |

##### D2-domain-identity-23 — FR-061/FR-062 per-Business domain grant is enforced on ZERO server-side routes — not just /api/people

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | HIGH |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | `grep -rln 'visibleDomains\|domainsForBusiness' src/app/api/` คืนค่า **ศูนย์ไฟล์** — ทุกเส้นทาง API ในระบบ ไม่มีเส้นทางใดตรวจสอบ per-Business domain grant เลย; ผู้เรียก `domainsForBusiness` มีเพียง `src/lib/business-shell-guard.js:19-26` (`visibleDomain()`), นำเข้าโดย `src/components/layouts/BusinessShellGuard.jsx:8` เท่านั้น, บวก `src/components/layouts/DomainBar.jsx:31` และ `src/components/layouts/CommandPalette.jsx:4` — ทั้งหมดเป็น client component; `src/modules/identity/viewer-domains.js:10` ระบุใน comment ของตัวเองว่ามีผู้เรียกใช้เพียง 2 ที่คือ `business-shell-guard.js` และ `DomainBar.jsx`; `src/app/api/people/route.js:17-18` ส่งเพียง `viewer.visibleBusinessIds` ให้ `listPeople`; `src/modules/people/application/people-service.js:12` ตรวจสอบเพียง `visibleBusinessIds` เท่านั้น; `docs/domains/identity/features/FR-061-per-business-domain-visibility.md` มีอยู่จริงแต่ไม่เคยถูกอ้างถึงในรายงานฉบับนี้เลยแม้แต่ครั้งเดียว |
| **สิ่งที่ควรเป็น** | FR-061/FR-062 (identity เป็นเจ้าของ) ประกาศ per-Business domain allow-list (`Membership.domainKeysJson`) เป็น authorization boundary จริง ไม่ใช่ UX filter — ทุกเส้นทาง API ที่ Business-scoped ควรตรวจสอบ `domainsForBusiness(viewer, businessId).includes(<domain>)` ฝั่ง server ก่อนคืนข้อมูล |
| **สิ่งที่เป็นจริง** | กลไก per-Business domain grant มีการ implement เพียงใน 3 client component เท่านั้น (`business-shell-guard.js` ที่ทำงานฝั่ง client ผ่าน `BusinessShellGuard.jsx`, `DomainBar.jsx`, `CommandPalette.jsx`) — ไม่มี API route ใดใน `src/app/api/` เรียกใช้ฟังก์ชันนี้เลย ดังนั้น MEMBER ที่ Membership ของตนไม่มี grant สำหรับ domain ใด ๆ (people, crm, market, ฯลฯ) ยังคงเรียก API endpoint ของ Business ที่ตนเห็นได้โดยตรงและได้ข้อมูลเต็มรูปแบบเสมอ — client-side guard ป้องกันแค่การเห็นแท็บ ไม่ได้ป้องกันการเรียก API; นี่คือช่องว่าง authorization ที่ใหญ่ที่สุดในมิตินี้ และถูกรายงานผิดที่ผิดขอบเขตในรายงานฉบับก่อนหน้า (ดู D2-domain-people-08 ซึ่งเป็นเพียงหนึ่งใน instance ของช่องว่างนี้ ไม่ใช่ทั้งหมด) |
| **ข้อเสนอแนะ** | สร้าง shared helper (เช่น `requireDomainGrant(viewer, businessId, domainKey)`) แล้วเพิ่มการเรียกใช้ในทุกเส้นทาง API ที่ Business-scoped ทั่วทั้ง repo (people, crm, market, project-manager ฯลฯ) ไม่ใช่แค่ `/api/people`; พิจารณาเพิ่ม governance check ที่ grep หา Business-scoped GET/POST route ที่ไม่เรียก helper นี้ |
| **เกี่ยวข้อง** | D2-domain-people-08 |
| **การตรวจสอบ** | critic-added |

##### D2-domain-identity-24 — FR-121 (Google second way-in) has zero code; FR-121/FR-122 never appear in this section's Inventory

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | DECLARED_NOT_BUILT |
| **หลักฐาน** | `ls docs/domains/identity/features/` มี 17 feature notes รวมถึง `FR-121-google-second-way-in.md` และ `FR-122-profile-identity-fields.md`; `docs/PRD-SDD-v1.0.md:331` (FR-121) สถานะ 🔜 blocked บน Google OAuth และ `:332` (FR-122) สถานะ ✅; โค้ด FR-122 มีจริง: `src/app/(entry)/onboarding/profile/page.jsx:7`, `src/app/api/onboarding/profile/route.js:10,18`, `src/modules/identity/onboarding-service.js:38,116`; `grep -rn 'FR-121' src/` = ศูนย์ผลลัพธ์ |
| **สิ่งที่ควรเป็น** | Inventory ของ domain-identity ควรครอบคลุมทุก feature note ใน `docs/domains/identity/features/` (17 ไฟล์) ไม่ใช่เพียง 14 FR ids ที่ปรากฏในหน่วยนี้ |
| **สิ่งที่เป็นจริง** | FR-121 declared แต่ไม่มีโค้ดใด ๆ เลย (blocked บน Google OAuth ภายนอก) — เป็นตัวอย่าง declared-but-unbuilt ที่ตรงไปตรงมา; FR-122 มีโค้ดครบและ ✅ แต่ไม่เคยถูกตรวจสอบในหน่วยนี้เลย — รวมกับ FR-061/FR-062 (ดู D2-domain-identity-23) เป็น 4 จาก 17 feature notes ของโดเมนที่ไม่เคยถูกเปิดอ่าน |
| **ข้อเสนอแนะ** | เพิ่มแถว Inventory สำหรับ FR-121 (DECLARED_ONLY, blocked) และ FR-122 (IMPLEMENTED); ไม่ต้องมี code action สำหรับ FR-121 นอกจากรอ external gate |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | critic-added |

##### D2-domain-identity-01 — ExternalRef claimed owned by identity but all writers are project-manager

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | docs/domains/identity/CHARTER.md:18 — owns_models lists ExternalRef; src/modules/project-manager/import/external-ref.js — all reads/writes; grep '.externalRef.' src/modules/identity = nothing |
| **สิ่งที่ควรเป็น** | Identity's charter claims ExternalRef ownership and 'mapping discipline' |
| **สิ่งที่เป็นจริง** | ทุกการอ่าน/เขียน ExternalRef อยู่ใน project-manager เท่านั้น — โมเดลอยู่ระหว่าง claim + implementation โดยไม่มีสัญญา |
| **ข้อเสนอแนะ** | ย้าย external-ref.js logic ไปที่ identity หรือแก้ไข charter มอบความเป็นเจ้าของให้ project-manager |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-identity-03 — erasePrincipal writes Customer/ConversationAnalysis (crm models) undeclared as exception

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | BOUNDARY_VIOLATION (known deliberate pattern) |
| **หลักฐาน** | src/modules/identity/erase-principal.js:55,62,67 — reads Customer, deletes ConversationAnalysis, updates Customer; .brain/rca/2026-08-31-conversation-analysis-tenant-binding.md — deliberate hardened design from FR-127 fix |
| **สิ่งที่ควรเป็น** | Cross-domain writes should appear in both charters' declared exceptions |
| **สิ่งที่เป็นจริง** | ลบ/ทำให้เสื่อม crm models โดยตรง — รูปแบบที่รู้จักและตั้งใจ (เหมือนข้อยกเว้น Person ที่ยอมรับแล้ว) ไม่ใช่การละเมิดใหม่ |
| **ข้อเสนอแนะ** | เพิ่ม Customer และ ConversationAnalysis ไปที่ 'Known shared-write exceptions' ของทั้ง charter |
| **เกี่ยวข้อง** | D2-domain-identity-04 |
| **การตรวจสอบ** | ADJUSTED — downgraded HIGH to MEDIUM, known deliberate pattern |

##### D2-domain-identity-05 — 8 identity-implementing routes unclaimed by any charter owns_routes glob

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | MISSING_SURFACE |
| **หลักฐาน** | /api/{viewer,profile,platform/users*}, /(pm)/{profile,platform/users} — all carry @req FR; docs/domains/identity/CHARTER.md:4 — glob omits them; verified zero matches across all 17 domain charters |
| **สิ่งที่ควรเป็น** | DOMAIN-MAP.md 'Routes owned: 24' should reflect actual identity-implementing routes |
| **สิ่งที่เป็นจริง** | 8 routes genuinely un-owned in doc-graph — all work/annotated, only traceability gap |
| **ข้อเสนอแนะ** | เพิ่ม globs ไปที่ identity charter; รัน `npm run docs:graph` |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | ADJUSTED — downgraded HIGH to MEDIUM, governance gap only |

##### D2-domain-identity-06 — viewer-authority.js (32+ imports) not named in charter's Public contract

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | BUILT_NOT_DECLARED |
| **หลักฐาน** | grep -rl "from '@/modules/identity/viewer-authority'" src/ = 32 files; docs/domains/identity/CHARTER.md:51 — Public contract never names this file |
| **สิ่งที่ควรเป็น** | Charter should name every sanctioned cross-domain import |
| **สิ่งที่เป็นจริง** | 32+ files นำเข้า viewer-authority predicates — charter reader wouldn't know it's sanctioned |
| **ข้อเสนอแนะ** | เพิ่ม bullet ไปที่ Public contract naming viewer-authority.js และ 6 exports |
| **เกี่ยวข้อง** | D2-domain-identity-07 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-identity-13 — FR-076 PRD status misleading; local write path also unreachable

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/PRD-SDD-v1.0.md:286 — '🟠 local contract implemented; remote...'; D2-domain-identity-08 — assignRoleBinding has zero production callers |
| **สิ่งที่ควรเป็น** | Status text implies local contract is usable |
| **สิ่งที่เป็นจริง** | 'Local contract' (assignRoleBinding) ไม่มีเส้นทางผลิตภัณฑ์ — FR-076 ไม่อยู่ที่สถานีผลิตภัณฑ์ |
| **ข้อเสนอแนะ** | แก้ไข FR-076 PRD status เพื่อให้ชื่อเรื่องการเรียกใช้ที่ขาดหายไป |
| **เกี่ยวข้อง** | D2-domain-identity-08, D2-domain-identity-21 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-identity-14 — FR-123 plugin auth: Supabase, client registration, device-binding, scheduler gated

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | PRODUCTION_GATE_OPEN |
| **หลักฐาน** | docs/PRD-SDD-v1.0.md:333 — '🟠 ... production Supabase migration, client registration, device-binding/security evidence and maintenance invocation remain gated'; grep -rln reapExpiredPluginAuthRecords = only test |
| **สิ่งที่ควรเป็น** | N/A — factual disclosure of open gate |
| **สิ่งที่เป็นจริง** | Code + tests landed; maintenance reaper unscheduled |
| **ข้อเสนอแนะ** | ติดตาม 4 sub-gates เป็น checklist items แยกต่างหากเพื่อหลีกเลี่ยงการกำหนดส่วนหนึ่งเป็นจำนวน |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-identity-15 — FR-102/106 Supabase migration tests static-only, yet PRD says 'applied'

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | tests/unit/{sot-data-plane-key,api-access-key}-migration.test.js:6 — 'Static contract test only'; docs/PRD-SDD-v1.0.md:312,316 — '✅ ... migration applied' |
| **สิ่งที่ควรเป็น** | '✅ implemented ... applied' status implies live Postgres behavior proven |
| **สิ่งที่เป็นจริง** | ทดสอบ in-repo ยืนยันเฉพาะรูปแบบ regex ต่อกับ migration SQL — ไม่พิสูจน์กับ live Postgres; หลักฐาน rests on out-of-repo ledger (RSK-016) |
| **ข้อเสนอแนะ** | หากการเชื่อมต่อ live Supabase เป็นไปได้ ให้เพิ่ม real test; จนกว่า ให้เก็บ wording ซื่อสัตย์ |
| **เกี่ยวข้อง** | D2-domain-identity-17 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-identity-18 — onboarding-service.js creates Portfolio directly, bypassing createPortfolio

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | BOUNDARY_VIOLATION (known pattern) |
| **หลักฐาน** | src/modules/identity/onboarding-service.js:212 — tx.portfolio.create; src/modules/project-manager/application/scope-service.js:56–66 — createPortfolio calls assertOperator, throws for non-operator |
| **สิ่งที่ควรเป็น** | Per charter, every domain creates Portfolio through contract function |
| **สิ่งที่เป็นจริง** | createOnboardingWorkspace (FR-066 self-serve) does direct insert — BUT createPortfolio would require operator authority, breaking self-serve Person onboarding; two different authz problems (operator provisioning vs. first-workspace creation) |
| **ข้อเสนอแนะ** | เอกสาร Portfolio เป็น named shared-write exception (self-serve, non-operator path) — ไม่ refactor เข้า createPortfolio |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | ADJUSTED — downgraded HIGH to MEDIUM, would break FR-066 |

##### D2-domain-identity-21 — canManageProduct (FR-076 consumption) has zero callers

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | BROKEN_FLOW |
| **หลักฐาน** | src/modules/identity/product-owner-authority.js:17 — export canManageProduct; grep -rln canManageProduct src/ = only its own file |
| **สิ่งที่ควรเป็น** | FR-076 implies some route/service gates Product action behind canManageProduct |
| **สิ่งที่เป็นจริง** | ไม่มีผู้เรียก; combined with D2-domain-identity-08, FR-076 completely inert (no assignment + no consumption) |
| **ข้อเสนอแนะ** | ระบุ Product-scoped route this should gate; หรือบันทึกใน FR-076 feature note ว่าไม่ใช้งาน |
| **เกี่ยวข้อง** | D2-domain-identity-08, D2-domain-identity-13 |
| **การตรวจสอบ** | verifier-added |

##### D2-domain-identity-22 — ApiAccessKey (FR-106) no list/GET endpoint — lost key id unrecoverable

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | MISSING_SURFACE |
| **หลักฐาน** | src/app/api/platform/api-access-keys/route.js — POST only (mint); [id]/route.js — DELETE only; no listApiAccessKeys export |
| **สิ่งที่ควรเป็น** | FR-106: 'revocable with effect on next request'; revoking requires knowing key id |
| **สิ่งที่เป็นจริง** | ไม่มี route/UI page ใด ๆ list Tenant's issued keys — ถ้า one-time mint id ไม่ถูกบันทึก key ไม่สามารถระบุได้ที่จะยกเลิก |
| **ข้อเสนอแนะ** | เพิ่ม GET handler ไปที่ /api/platform/api-access-keys/route.js ส่งคืน id/label/createdAt/status (no secret) |
| **เกี่ยวข้อง** | D2-domain-identity-10 |
| **การตรวจสอบ** | verifier-added |

##### D2-domain-identity-07 — request-viewer, gate, channel-identity, rbac undeclared in Public contract

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | BUILT_NOT_DECLARED |
| **หลักฐาน** | PlatformControlGuard.jsx:7, product-readiness-access.js:3 — resolveRequestViewer; action-gate.js:3 — resolveLinePrincipal; auth-context.js:4 — channelIdentityIsVerified; customer-import-review-service.js:5 — rbac imports; charter line 51 — none named |
| **สิ่งที่ควรเป็น** | Sanctioned cross-domain imports should be in Public contract |
| **สิ่งที่เป็นจริง** | 5+ functions from these files imported by other domains, none listed |
| **ข้อเสนอแนะ** | Fold into D2-domain-identity-06 update, or mark internal-only and redirect |
| **เกี่ยวข้อง** | D2-domain-identity-06 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-identity-04 — Person writers missing from both charters' exceptions list

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | src/modules/identity/{resolve-line-identity,operator-bootstrap}.js — tx.person.create; docs/domains/identity/CHARTER.md:115 — lists 4 writers, omits these 2; crm/CHARTER.md:75 — mirror list even more out of sync |
| **สิ่งที่ควรเป็น** | All Person writers enumerated consistently |
| **สิ่งที่เป็นจริง** | 5 writers exist; identity lists 4, crm lists 3 |
| **ข้อเสนอแนะ** | อัปเดต both charters' exceptions ให้ list all 5 consistently |
| **เกี่ยวข้อง** | D2-domain-identity-03 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-identity-16 — FR-066/067 workspace onboarding no dedicated e2e Playwright spec

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | tests/integration/workspace-onboarding-flow.test.js exists (integration); tests/e2e/ has fr044/046/104/120/123 but none for invites/accept; docs/TRACE.md FR-067 Tests = unit/integration only |
| **สิ่งที่ควรเป็น** | FR-066/067 user-facing pages; matching coverage with fr044/104/120 |
| **สิ่งที่เป็นจริง** | ไม่มี e2e spec สำหรับ workspace-invites/accept journey |
| **ข้อเสนอแนะ** | เพิ่ม tests/e2e/fr067-workspace-invite.spec.js |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-identity-17 — No .postgres.test.js for any identity model

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | find tests -iname '*.postgres.test.js' = 3 files (none identity); FR-102/106/076/123 name production Postgres gates |
| **สิ่งที่ควรเป็น** | Optional real-Postgres test (self-skipping) would prove RLS/grants |
| **สิ่งที่เป็นจริง** | ไม่มี *.postgres.test.js สำหรับ identity |
| **ข้อเสนอแนะ** | เพิ่ม for ApiAccessKey/SotDataPlaneKey (self-skipping pattern) |
| **เกี่ยวข้อง** | D2-domain-identity-15 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-identity-19 — Charter missing Version/Status control block (shared info-level debt)

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/.preflight-report.json finding I7 — shared with agent/crm/integration/knowledge charters |
| **สิ่งที่ควรเป็น** | Per preflight, every document carries Version/Status block |
| **สิ่งที่เป็นจริง** | Pre-existing accepted debt, not identity-specific |
| **ข้อเสนอแนะ** | Low priority: add on next charter revision |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-identity-11 — FR-094/095/096/098 share Issue #99 Phase 0 P0 gate (factual disclosure)

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | INFO |
| **ประเภท** | PRODUCTION_GATE_OPEN |
| **หลักฐาน** | docs/PRD-SDD-v1.0.md:304–308 all quote '🟠 Issue #99 Phase 0 P0'; code/tests landed per TRACE.md |
| **สิ่งที่ควรเป็น** | N/A — factual, already-transparent record |
| **สิ่งที่เป็นจริง** | Code and tests landed; only external Issue #99 gate remains |
| **ข้อเสนอแนะ** | No code needed; owner confirms Issue #99 scope when closing |
| **เกี่ยวข้อง** | D2-domain-identity-12, D2-domain-identity-20 |
| **การตรวจสอบ** | ADJUSTED — downgraded MEDIUM to INFO |

##### D2-domain-identity-12 — FR-097 verified channel onboarding: provider-side evidence pending (factual)

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | INFO |
| **ประเภท** | PRODUCTION_GATE_OPEN |
| **หลักฐาน** | docs/PRD-SDD-v1.0.md:307 — '🟠 ... provider-side onboarding evidence pending'; code/tests landed |
| **สิ่งที่ควรเป็น** | N/A — factual, already-transparent record |
| **สิ่งที่เป็นจริง** | Code + tests landed; only live-provider evidence remains |
| **ข้อเสนอแนะ** | Track missing artifact as checklist item |
| **เกี่ยวข้อง** | D2-domain-identity-11 |
| **การตรวจสอบ** | ADJUSTED — downgraded MEDIUM to INFO |

#### ข้อจำกัดการตรวจ

ผู้ค้นหา (finder) — อ่านทั้งหมด: docs/domains/identity/CHARTER.md, 17 ไฟล์ feature notes, ทุกไฟล์ใน src/modules/identity/ ผ่าน grep อย่างน้อย + spot-read sections สำคัญ (rbac-service.js, gate.js, erase-principal.js, viewer-authority.js, onboarding-service.js, step-up.js, agent-tool-authorizer.js, plugin-auth-service.js, api-access-auth.js); ตรวจสอบ model existence/parity ทั้ง schema; ตรวจสอบ owns_routes globs ทั้งหมด; cross-check all 17 charters สำหรับ 8 orphaned routes; ดึง 28 FR rows; cross-check TRACE.md sections; ตรวจสอบ .preflight-report.json, route-anchor-baseline.json, ROADMAP.md; ~50+ test files matched; ไม่ได้อ่านทั้งหมด feature notes หรือทั้งหมด test files; ไม่รัน tests/build/govern (read-only mandate).

ผู้ตรวจสอบ (verifier) — Method: อ่าน charter เต็ม, cross-reference owns_models/cited files ทั้งหมดกับ source via grep/full reads; checked docs/PRD-SDD-v1.0.md/DOMAIN-MAP.md/.preflight-report.json/scripts; 19 findings ออกมาถูกต้องสูง ไม่มี REFUTED; corrections mainly severity calibration (findings 11/12 → INFO: factual records), accuracy (findings 03/18 = known patterns), recommendation soundness (finding 18's literal fix would break FR-066). Added 3 findings (D2-20, 21, 22); D2-20 particularly valuable — fresh concrete instance of FEAT-010 gap (newly-added agent-tool-authorizer never called from actual tool dispatcher src/modules/agent/tools.js).

## domain-integration

### domain-integration

#### สรุปย่อ

- โดเมนครบจำนวน 15 models + 10 routes (4 pages, 6 api) บนแพลตฟอร์มประสาน LINE OA ↔ SoT pipeline board/inbox/graph ↔ execution ledger
- **ความปลอดภัยข้อมูล**: saveLineGroup/saveLineUser อนุญาตให้เปลี่ยน ownership ของ LINE registry connection ของธุรกิจอื่นภายในเดียวกัน Tenant ได้ (verifier-29)
- **ข้อมูลเซ้ :**: LINE registry ใช้ provider code 'line-oa' (lowercase-hyphen) แต่ส่วนอื่น ใช้ 'LINE_OA' (uppercase-underscore) จึงตัวแปลง/credential หลงทาง
- **ทดสอบ**: SoT pages/inbox ทดสอบด้วย substring assertions เท่านั้น ไม่มี React Testing Library render หรือ e2e; production Vault resolver ไม่มี real-Postgres test
- **ไม่เสร็จ**: FR-081 tail (DeadLetterRecord/SyncCursor/ExternalEntityRef schema-only, no production writer); FR-125 zero code; ingestKnowledgeDocument test-only caller
- **เขียน**: LINE registry + automation-job scheduler ไม่มี FR/FEAT declaration แม้ว่าสร้างเสร็จ; charter owns_routes ขาด 4 routes ที่เรียก domain core code

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|--------|---------|----------|
| CHARTER.md | IMPLEMENTED | docs/domains/integration/CHARTER.md:1-135 | ขาด Version/Status control block (preflight I8) |
| Feature notes (9 files) | PARTIAL | docs/domains/integration/features/ | FR-079,080,081,099,100,101,125,129,130 all present; FR-099/100/101 status stale ('proposed' vs PRD '✅ implemented') |
| IntegrationProvider, IntegrationConnection, IntegrationCredential, IngestionRun, RawExternalRecord | IMPLEMENTED | prisma/schema.prisma:1527–1621 | ครบในทั้ง SQLite + Postgres schema |
| SyncCursor, ExternalEntityRef | DECLARED_ONLY | prisma/schema.prisma:1666, 1688 | Schema defined; direct-write persistence/backup tests only; no application-layer writer |
| DeadLetterRecord | DECLARED_NOT_BUILT | prisma/schema.prisma:1717 | Schema defined; direct-write tests only; no production writer — FR-081(d) failure-preservation unmet |
| SotDecision, Pipeline* (6 models) | IMPLEMENTED | src/platform/integrations/core/pipeline-tracking-service.js:114–894 | Written by pipeline-tracking-service only per charter; PipelineReconciliation.evidenceJson hardcoded '{}' |
| owns_routes: platform/integrations, platform/sot-pipeline | IMPLEMENTED | src/app/(pm)/platform/integrations/**; src/app/api/platform/** | 10 routes (4 pages + 6 api) |
| Un-owned routes: api/pipelines/runs/**, api/ingest/documents | MISSING_SURFACE | src/app/api/pipelines/runs/route.js; src/app/api/ingest/documents/route.js | 4 routes call domain core exclusively; not in owns_routes |
| src/platform/integrations/core/** | IMPLEMENTED | 15 files | substrate + LINE OA webhook + provider catalog |
| marketplace-listing-adapter, retail-price-adapter | PARTIAL | src/modules/integration/adapters/ | unit-tested; zero production callers |
| LINE Groups/Users registry + automation-job scheduler | BUILT_NOT_DECLARED | src/modules/integration/application/line-registry-service.js; src/app/(pm)/platform/integrations/page.jsx | ไม่มี FR/FEAT; only tagged FR-080 (unrelated) |
| FR-071/079/080/081/092/099/100/101/109/125/129/130 | MIXED | docs/PRD-SDD-v1.0.md; code/tests | FR-081 PARTIAL (tail unbuilt); FR-125 DECLARED_ONLY; FR-129/130 GATED |
| Supabase Vault resolver | TEST_GAP | supabase/migrations/20260818050000_phase1_line_supabase_vault_resolver.sql | zero real-Postgres test; all mocked |
| Tests: unit/integration/e2e | PARTIAL | ~40 files; tests/e2e/fr130-connector-catalog.spec.js only | SoT pages/connection-creation e2e missing; render tests missing |

#### Findings

##### D2-domain-integration-verifier-29 — saveLineGroup/saveLineUser ถูกแย่งชิง (reassign) LINE registry connection ของธุรกิจอื่นได้

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | HIGH |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | src/modules/integration/application/line-registry-service.js:145-150 (lookup `where: { tenantId, providerId, externalAccountId }` no businessId, saveLineGroup); :159 unconditionally reassigns `businessId: validated.businessId` inside the update; :232-236 saveLineUser's twin lookup (same shape); :246 saveLineUser's twin reassignment; :117 assertScope checks target businessId only, never the existing row's businessId |
| สิ่งที่ควรเป็น | viewer owning Business B ไม่สามารถเปลี่ยน IntegrationConnection row ของ Business A ได้ |
| สิ่งที่เป็นจริง | existing-row lookup tenant-scoped only; assertScope checks target businessId only → any Business in Tenant can reassign another's LINE registry connection to self |
| ข้อเสนอแนะ | scope lookup by businessId also; treat different-businessId match as conflict (409); add regression test |
| เกี่ยวข้อง | D2-domain-integration-05, 06, verifier-30 |
| การตรวจสอบ | verifier-added |

##### D2-domain-integration-verifier-30 — line-registry-service.test.js never reaches persistence code

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | HIGH |
| ประเภท | TEST_GAP |
| หลักฐาน | tests/unit/line-registry-service.test.js:19-32 (2 tests, both fail validation before prisma); 43 lines total, no valid payload |
| สิ่งที่ควรเป็น | test file should exercise happy path (create, update, list) against real/fake database |
| สิ่งที่เป็นจริง | both tests fail before reaching provider-upsert/connection-create code → why verifier-29 + finding 05 undetected |
| ข้อเสนอแนะ | add integration-style tests using real test database (matching tests/integration/platform/integration-persistence.test.js pattern) |
| เกี่ยวข้อง | D2-domain-integration-verifier-29, 05, 06 |
| การตรวจสอบ | verifier-added |

##### D2-domain-integration-05 — provider code 'line-oa' vs 'LINE_OA' → orphaned identity

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | HIGH |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | line-registry-service.js:62,121,207 (`code: 'line-oa'`); integration-registry.js:224 (`LINE_OA_PROVIDER_CODE = 'LINE_OA'`); prisma:1527 (code @unique → two distinct rows) |
| สิ่งที่ควรเป็น | LINE Group/User should attach to IntegrationProvider identity that LINE OA webhook + connector-catalog resolve against |
| สิ่งที่เป็นจริง | line-oa (lowercase-hyphen) ≠ LINE_OA (uppercase-underscore) → registered groups/users disconnected from actual channel |
| ข้อเสนอแนะ | change three code: 'line-oa' → LINE_OA_PROVIDER_CODE imported; add regression test |
| เกี่ยวข้อง | 06, 07 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-06 — LINE registry feature ไม่มี FR/FEAT declaration

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | HIGH |
| ประเภท | BUILT_NOT_DECLARED |
| หลักฐาน | line-registry-service.js tagged '@req FR-080' (but FR-080 = provider/connection/credential metadata, not LINE_GROUP registries); code + route + UI shipped; grep docs = zero hits for 'line-registry'/'LINE Group' |
| สิ่งที่ควรเป็น | distinct capability should have declared FR/FEAT id before landing |
| สิ่งที่เป็นจริง | exists in code/route/UI, not registry → cannot verify behavior matches intent (why finding 05's bug undetected) |
| ข้อเสนอแนะ | declare new FR/FEAT for LINE contact registry + automation-job scheduling; re-tag @req; run docs:ids --write |
| เกี่ยวข้อง | 05, 07 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-20 — Vault resolver zero real-Postgres test

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | HIGH |
| ประเภท | TEST_GAP |
| หลักฐาน | supabase/migrations/20260818050000_phase1_line_supabase_vault_resolver.sql (named Public Contract); tests/unit/fr080-*.test.js (all queryFn = vi.fn() mocked); grep tests/ for resolve_phase1_line_secret = only mocked files |
| สิ่งที่ควรเป็น | given FR-055 has .postgres.test.js (env-var-gated opt-in), production secret-resolution path should have equivalent real-database proof available |
| สิ่งที่เป็นจริง | no .postgres.test.js exists for Vault resolver/zuri_line_runtime role |
| ข้อเสนอแนะ | add tests/integration/phase1-vault-resolver.postgres.test.js (env-var opt-in, verifies RLS/role/function against disposable Postgres) |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-03 — DeadLetterRecord schema exists, production writer = 0

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | HIGH |
| ประเภท | DECLARED_NOT_BUILT |
| หลักฐาน | prisma:1717; FR-081 PRD (d): "failure is preserved as DeadLetterRecord"; raw-ingest-service.js only throws, no DeadLetterRecord write |
| สิ่งที่ควรเป็น | FR-081(d) present-tense guarantee: failure captured as DeadLetterRecord |
| สิ่งที่เป็นจริง | no production/application-layer writer; direct-write tests only → failure unrecorded |
| ข้อเสนอแนะ | update FR-081 status: explicitly name DeadLetterRecord as unwired; prioritize (exactly failure mode FR-081(d) prevents) |
| เกี่ยวข้อง | 01, 02 |
| การตรวจสอบ | ADJUSTED: tests/integration/{backup.test.js:131, integration-persistence.test.js} write DeadLetterRecord directly (persistence/backup tests only). No production/application-layer writer; substantive gap stands. Severity unchanged HIGH. |

##### D2-domain-integration-01 — SyncCursor application-layer writer = 0

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | DECLARED_NOT_BUILT |
| หลักฐาน | prisma:1666 (unique connectionId/resourceType); tests/integration/{backup.test.js:121, integration-persistence.test.js:97} direct-write tests only |
| สิ่งที่ควรเป็น | charter/FR-081 imply SyncCursor part of acquisition substrate (watermark/pull-based sync) |
| สิ่งที่เป็นจริง | no application-layer service/connector writes; inert in production |
| ข้อเสนอแนะ | wire into real pull-connector (FR-125 candidate) or mark as declared-for-future-use |
| เกี่ยวข้อง | 02, 03, 27 |
| การตรวจสอบ | ADJUSTED: tests write directly (backup/restore pattern only). Corrected: exercised only by persistence/backup tests; no application-layer writer as part of real acquisition flow. Gap stands. Severity unchanged MEDIUM. |

##### D2-domain-integration-02 — ExternalEntityRef application-layer writer = 0

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | DECLARED_NOT_BUILT |
| หลักฐาน | prisma:1688; BR-002 + charter describe external-id mapping mechanism; FR-130 names ExternalEntityRef as GitHub-id resolution |
| สิ่งที่ควรเป็น | external-id-mapping mechanism BR-002 boundary rests on should work |
| สิ่งที่เป็นจริง | no production writer (direct-write tests only) → mechanism unimplemented |
| ข้อเสนอแนะ | treat as real blocker on FR-130(b)/(c) + future adapters; add to FR-081 PRD status as 4th unbuilt piece |
| เกี่ยวข้อง | 01, 03 |
| การตรวจสอบ | ADJUSTED: tests write directly (persistence/backup). Corrected: no production/application-layer writer; direct-write tests only. Gap stands. Severity unchanged MEDIUM. |

##### D2-domain-integration-04 — marketplace/retail-price adapters dead code

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | src/modules/integration/adapters/*.js (formatMarketplaceListingRawRecord, formatRetailPriceRawRecord); only test file imports; market-intelligence uses own in-memory PriceObservation path instead |
| สิ่งที่ควรเป็น | adapter should feed raw-ingest-service.js (per FR-081 single path rule) |
| สิ่งที่เป็นจริง | nothing calls ingestRawExternalRecord with output; market-intelligence took separate path |
| ข้อเสนอแนะ | wire adapters into real scraper/cron, or reconcile with market-intelligence (one path from external data to stored observation, not two) |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-07 — automation jobs read-only (no scheduler)

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | page.jsx:299 (builds automationJobs POST to line-registry); :1037 (reads back only for display); line-registry-service.js:18 (stores in metadataJson, no scheduler) |
| สิ่งที่ควรเป็น | schedule field implies something dispatches (cron sends daily report at configured time) |
| สิ่งที่เป็นจริง | data written/read for UI only, never acted on (config form with no engine) |
| ข้อเสนอแนะ | build dispatcher (scheduled job reading metadataJson.automationJobs, sending via LINE API) or remove fields until real |
| เกี่ยวข้อง | 05, 06 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-08 — owns_routes ขาด api/pipelines/**

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | charter:4 (owns_routes omits api/pipelines); src/app/api/pipelines/runs/route.js:7 (imports from pipeline-tracking-service — domain core); DOMAIN-MAP:54 ('Routes owned: 10' excludes these 4 routes) |
| สิ่งที่ควรเป็น | reader using charter owns_routes should locate execution-ledger API |
| สิ่งที่เป็นจริง | 4 routes fall to project-manager catch-all glob (longest-prefix) despite 100% domain core code |
| ข้อเสนอแนะ | add src/app/api/pipelines/** to owns_routes, or explicit cross-reference note |
| เกี่ยวข้อง | 09 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-10 — credential-vault.js cross-domain import, not in Public Contracts

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | credential-vault.js:120 (export createEnvCredentialVault); src/modules/agent/phase1-runtime.js:9 (import by agent domain); charter:98 (Public Contracts omit it) |
| สิ่งที่ควรเป็น | cross-domain consumers call only Public Contract files (exhaustive + reviewable) |
| สิ่งที่เป็นจริง | agent imports internal core file charter never names → reader auditing 'what can other domains call' misses live dependency |
| ข้อเสนอแนะ | add to Public Contracts (note local/dev/test-only) or move dependency onto already-named contract |
| เกี่ยวข้อง | 11, 12 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-11 — cloud-sot-agent.js cross-domain, not in Public Contracts

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | cloud-sot-agent.js:338 (export stageDocumentIntakeForPipeline); project-manager/mcp/transport.js:15 + api/ingest/documents/route.js:7 (two cross-domain callers); charter:98 (omitted) |
| สิ่งที่ควรเป็น | file two trees import directly should be documented contract |
| สิ่งที่เป็นจริง | 14KB core, 4 exported functions consumed cross-domain with no charter entry |
| ข้อเสนอแนะ | add cloud-sot-agent.js exported functions to Public Contracts (naming stable vs. internal-only) |
| เกี่ยวข้อง | 10, 09 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-16 — sot-pipeline/graph/page.jsx no component render test

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP |
| หลักฐาน | page.jsx:7 (@tested tests/unit/sot-pipeline-graph.test.js); test file:3 (imports only pure functions, never renders page.jsx) |
| สิ่งที่ควรเป็น | @tested annotation implies test file proves page component |
| สิ่งที่เป็นจริง | 153-line page (SVG NODE_W/NODE_H math, badge links, click/hover) never exercised; annotation covers only pure data functions |
| ข้อเสนอแนะ | add React Testing Library render test or Playwright e2e spec for /platform/sot-pipeline/graph |
| เกี่ยวข้อง | 17, 19 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-17 — SoT plan/inbox pages tested via substring only

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP |
| หลักฐาน | tests/unit/sot-plan-board-ui.test.js:9 (fs.readFileSync page source); :19 (expect(page).toContain(...)  text grep); same pattern for inbox |
| สิ่งที่ควรเป็น | UI test should render/drive component to prove behavior |
| สิ่งที่เป็นจริง | text grep only; false-pass if broken but comment contains string |
| ข้อเสนอแนะ | replace/supplement with React Testing Library render tests or Playwright specs |
| เกี่ยวข้อง | 16, 18, 19 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-19 — SoT console + connection-creation form zero e2e

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | TEST_GAP |
| หลักฐาน | tests/e2e/fr130-connector-catalog.spec.js (only e2e touching domain UI — read-only); ls tests/e2e/ (no spec for SoT pages or connection-creation form) |
| สิ่งที่ควรเป็น | FR-099/100/101 (SoT '✅ implemented') + FR-080 (Platform Integrations form) should have e2e path proven in real browser |
| สิ่งที่เป็นจริง | no SoT board/inbox/graph/connection-creation e2e coverage |
| ข้อเสนอแนะ | add e2e per SoT page (board → inbox → decide → graph reflects) + one for connection-creation happy path |
| เกี่ยวข้อง | 16, 17 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-21 — ROADMAP.md 'not really built' list stale

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | ROADMAP.md:275 (dated '2026-08-26'); :290 (item 4 names 'FR-071 tail' only, omits FR-081 pieces); FR-125 '🔜 design candidate only' absent from list |
| สิ่งที่ควรเป็น | section should track every FR with open production gate or unbuilt scope |
| สิ่งที่เป็นจริง | not regenerated since cutoff; FR-081's own pieces + FR-125 missing |
| ข้อเสนอแนะ | regenerate to name FR-081's unbuilt substrate distinct from FR-071 tail; add FR-125 as design-only |
| เกี่ยวข้อง | 01, 02, 03 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-22 — FR-129 no route creates APPROVED decision

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | PRODUCTION_GATE_OPEN |
| หลักฐาน | src/app/api/pipelines/runs/[executionRunId]/events/route.js:1 (generic worker-evidence endpoint only); docs/PRD-SDD-v1.0.md:339 (quoted: 'No route creates APPROVED decision...authorization policy is blocker') |
| สิ่งที่ควรเป็น | n/a — verification that PRD's self-reported gap is accurate |
| สิ่งที่เป็นจริง | grep for route creating PipelineGateDecision status=APPROVED finds only generic events route |
| ข้อเสนอแนะ | no action beyond PRD; tracked with direct code evidence |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-13 — ingestKnowledgeDocument test-only caller

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | MEDIUM |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | knowledge-ingestion-executor.js:134 (export); only test file import; FR-109 status cites AC-109.2 as closed |
| สิ่งที่ควรเป็น | AC-109.2 'provably ingested' implies operational path, not test-only |
| สิ่งที่เป็นจริง | grep src/ finds only definition + test file; no route/script/cron calls it |
| ข้อเสนอแนะ | wire real caller, or amend FR-109 status: AC-109.2 proven only by test harness, no production trigger yet |
| เกี่ยวข้อง | — |
| การตรวจสอบ | ADJUSTED: FR-081/FR-109/FR-110 already document scheduler/production trigger/external-reporter-authorization as not-yet-built — this named example of already-disclosed pending work, not hidden defect. HIGH overstates. Downgraded MEDIUM. Recommendation stands. |

##### D2-domain-integration-09 — owns_routes ขาด api/ingest/documents**

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | LOW |
| ประเภท | DOC_DRIFT |
| หลักฐาน | src/app/api/ingest/documents/route.js:7 (imports from cloud-sot-agent); charter:4 (owns_routes omits api/ingest entry) |
| สิ่งที่ควรเป็น | route 100% this domain's substrate should be discoverable from charter |
| สิ่งที่เป็นจริง | falls to project-manager catch-all glob (longest-prefix) |
| ข้อเสนอแนะ | add src/app/api/ingest/documents/** to owns_routes, or explicit cross-reference |
| เกี่ยวข้อง | 08 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-12 — document-intake-contract.js cross-domain, not in Public Contracts

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | LOW |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | document-intake-contract.js:14 (export DOCUMENT_INTAKE_DOMAINS); api/ingest/documents/route.js:8 (cross-tree import); charter:98 (omitted) |
| สิ่งที่ควรเป็น | validation contract consumed outside tree should be in charter |
| สิ่งที่เป็นจริง | no charter entry |
| ข้อเสนอแนะ | add to Public Contracts alongside cloud-sot-agent.js |
| เกี่ยวข้อง | 10, 11 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-14 — FR-099/100/101 feature notes status stale

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | LOW |
| ประเภท | DOC_DRIFT |
| หลักฐาน | FR-099/100/101 feature notes:7 (status: proposed); docs/PRD-SDD-v1.0.md:309-310 (FR-099/100 '✅ implemented') |
| สิ่งที่ควรเป็น | feature note status should track requirement's delivery state |
| สิ่งที่เป็นจริง | still 'proposed' while PRD/DOMAIN-MAP/TRACE show live code |
| ข้อเสนอแนะ | update to 'beta' or 'implemented' to match PRD |
| เกี่ยวข้อง | 15 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-15 — FEAT-011 primaryDomain mismatch

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | LOW |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/FEATURES.md:70 (primaryDomain='project-manager'); FEATURE-MAP.md:114 (FR-099 Domain='integration'); DOMAIN-MAP.md:54 (integration route count matches SoT pages) |
| สิ่งที่ควรเป็น | hand-maintained primaryDomain should agree with auto-generated per-FR domain |
| สิ่งที่เป็นจริง | FEAT-011 tagged project-manager while other artifacts say integration |
| ข้อเสนอแนะ | correct FEATURES.md:70 primaryDomain to 'integration' |
| เกี่ยวข้อง | 14 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-18 — pipeline-monitor-ui.test.js substring-only

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | LOW |
| ประเภท | TEST_GAP |
| หลักฐาน | tests/unit/pipeline-monitor-ui.test.js:9 (fs.readFileSync); :12 (expect(view).toContain('/api/pipelines/runs?businessId=')) |
| สิ่งที่ควรเป็น | UI test should render/drive component |
| สิ่งที่เป็นจริง | 181-286 line monitor view never rendered |
| ข้อเสนอแนะ | replace/supplement with render tests or e2e |
| เกี่ยวข้อง | 17 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-23 — Public Contracts list incomplete

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | LOW |
| ประเภท | DOC_DRIFT |
| หลักฐาน | charter:98 (Public Contracts lists only integration-management-service.js); src/modules/integration/application/ (sot-decision-service.js, sot-plan-service.js absent) |
| สิ่งที่ควรเป็น | section could clarify 'contracts other domains may call' vs. 'this domain's own application layer' |
| สิ่งที่เป็นจริง | reader cannot discover sot-decision-service.js/sot-plan-service.js from Public Contracts |
| ข้อเสนอแนะ | broaden framing to note cross-domain-relevant only (not exhaustive index), or add entries for remaining files |
| เกี่ยวข้อง | 10, 11, 12 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-24 — registerIntegrationProvider test-only

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | LOW |
| ประเภท | PARTIAL |
| หลักฐาน | integration-registry.js:261 (export); only test caller |
| สิ่งที่ควรเป็น | FR-130(b) describes registration as idempotent step needed |
| สิ่งที่เป็นจริง | no seed/route calls for 'github' provider code |
| ข้อเสนอแนะ | evidence supporting FR-130's 'blocked, not unbuilt' status; no separate action |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-26 — PipelineReconciliation.evidenceJson hardcoded '{}'

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | LOW |
| ประเภท | PARTIAL |
| หลักฐาน | pipeline-tracking-service.js:548 (evidenceJson: '{}' literal); docs/PRD-SDD-v1.0.md:339 (FR-129 status names as known unclosed item) |
| สิ่งที่ควรเป็น | n/a — PRD already documents |
| สิ่งที่เป็นจริง | verified: every row created with empty evidence payload |
| ข้อเสนอแนะ | tracked with direct code evidence |
| เกี่ยวข้อง | 22 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-27 — FR-125 blocked: DATA_SOURCE not in CONNECTION_KINDS

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | LOW |
| ประเภท | DECLARED_NOT_BUILT |
| หลักฐาน | connection-health.js:29 (CONNECTION_KINDS = ['CHANNEL', 'MODEL_PROVIDER']); docs/PRD-SDD-v1.0.md:335 (FR-125 status names this gap exactly) |
| สิ่งที่ควรเป็น | n/a — confirmatory |
| สิ่งที่เป็นจริง | verified: no DATA_SOURCE value |
| ข้อเสนอแนะ | CONNECTION_KINDS is first file to touch when FR-125 authorized; tracked as verified evidence |
| เกี่ยวข้อง | 01 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-28 — knowledge-ingestion-executor cross-domain without reciprocal charter

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | LOW |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | knowledge-ingestion-executor.js:2–5 (imports 4 functions from @/modules/knowledge/); docs/domains/knowledge/CHARTER.md:139 (Public contract omits those files) |
| สิ่งที่ควรเป็น | dependency on another domain's internal file should be reciprocally documented in that domain's charter |
| สิ่งที่เป็นจริง | dependency real + one-directional-documented (by this domain) but not by knowledge |
| ข้อเสนอแนะ | cross-reference for knowledge finder: add those four files to knowledge's Public Contract section |
| เกี่ยวข้อง | — |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-integration-verifier-31 — integration-management-service + provider-catalog import agent's MODEL_PROVIDER

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | LOW |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | integration-management-service.js:6 (import PUBLIC_LINE_PROVIDERS from @/modules/agent/model-provider); provider-catalog.js:8 (same); docs/domains/agent/CHARTER.md:33 (Public contract omits model-provider.js) |
| สิ่งที่ควรเป็น | live dependency on another domain's internal file should be named on one of the charters |
| สิ่งที่เป็นจริง | two files inside this domain import non-public export of agent module with no charter entry (undocumented-boundary pattern) |
| ข้อเสนอแนะ | add PUBLIC_LINE_PROVIDERS to agent's Public Contract list, or note in this charter's Boundaries section |
| เกี่ยวข้อง | 10, 11, 28 |
| การตรวจสอบ | verifier-added |

##### D2-domain-integration-25 — CHARTER.md missing Version/Status control block (shared debt across all 8 domain charters)

| ฟิลด์ | รายละเอียด |
|--------|----------|
| ระดับ | LOW |
| ประเภท | DOC_DRIFT |
| หลักฐาน | docs/.preflight-report.json (finding I8: doc-control 'Missing control fields' for CHARTER.md); grep -cE '^version:\|^status:' returns 0 for all 8 domain charters (agent, crm, identity, integration, knowledge, market-intelligence, platform-control, project-manager) — this is not integration-specific |
| สิ่งที่ควรเป็น | other charters carry control block |
| สิ่งที่เป็นจริง | flagged as INFO (non-blocking) by preflight; ปรับระดับเป็น LOW ให้สอดคล้องกับ identity-19/project-manager-14 ที่รายงานข้อบกพร่องเดียวกันในระดับเดียวกัน |
| ข้อเสนอแนะ | add at next real revision per preflight's suggested action |
| เกี่ยวข้อง | — |
| การตรวจสอบ | ADJUSTED (severity INFO → LOW: normalized to match identical defect reported elsewhere as LOW) |

#### ข้อจำกัดการตรวจ

**Finder scope**: อ่านเต็ม CHARTER.md (135 บรรทัด), feature notes 9 ไฟล์, substrate 15 ไฟล์ (src/platform/integrations/{core,providers/line,llm}), application 8 ไฟล์. Cross-checked prisma (15 models), PRD-SDD-v1.0.md (FRs 028/048/052/071/079/080/081/092/099/100/101/102/109/110/118/125/129/130/131), TRACE (FR-071/099/109/129), FEATURE-MAP/FEATURES/DOMAIN-MAP/ROADMAP, preflight + doc-graph + route-baseline. Enumerated ~35 test files, opened ~20.

**Verifier scope**: read CHARTER.md in full; grepped owns_models writers; diffed schema SQLite vs. Postgres (parity confirmed); verified owns_routes glob; checked cross-domain model writers; verified each finding's cited file/line.

**Corrections**: Findings 01–03 original claim 'grep returns nothing' false — tests/integration/{backup.test.js:121, integration-persistence.test.js:97} write models directly (persistence/backup pattern). Substantive gap (no production/application-layer writer) survives; corrected to 'direct-write tests only'.

**Biggest new finding**: verifier-29 — saveLineGroup/saveLineUser lookup tenant-scoped only (not businessId), assertScope validates target only → any viewer owning any Business in Tenant can reassign another Business's LINE registry connection to self. Why undetected: verifier-30 — line-registry-service.test.js (43 lines, 2 tests) never reaches persistence code.

**Did not verify**: preflight label 'I8' (file + title confirmed, not label). Did not run tests or build. Did not audit market-intelligence/knowledge fully (cross-domain only).

## domain-knowledge

### domain-knowledge

#### สรุปย่อ

- **มี 12 ความสามารถที่เสร็จแล้วแต่ไม่มีผู้เรียกใช้** ใน FR-047, FR-051-052, FR-054, FR-109-119, FR-131 ตามลำดับ เนื่องจากขาดตัวเรียกใช้งาน: โครงการสร้างกราฟ GKS (FR-024) และ RAG SmartGift ยังไม่มีผู้เรียกใช้จากการผลิต
- **เอกสารขาดการอัปเดต: CHARTER.md ยังคงกล่าวว่า FR-110 ไม่มีโค้ด** แต่จริง ๆ แล้วมีไฟล์ 154 บรรทัด (published-snapshot-contract.js) เพิ่มมา 2 วันหลังจากที่ charter ถูกแก้ไข
- **เส้นทางอ่าน GKS สำหรับ LINE ยังไม่เชื่อมต่อกับรันไทม์ที่ใช้งานจริง** ตัวอ่านกราฟ (createGraphKnowledgeReader) มีเฉพาะผ่าน createAgentPorts ซึ่งไม่มีผู้เรียกใช้เลย
- **evaluateKnowledgePublication (FR-110) ไม่ถูกเรียกใช้เลย** แต่กฎเดียวกันถูกบังคับใช้อยู่แล้วในอีกตำแหน่งหนึ่ง (pipeline-tracking-contract.js superRefine) — เป็นความเสี่ยงจากโค้ดซ้ำซ้อนที่ไม่ได้ซิงค์กัน ไม่ใช่ประตูการผลิตที่เปิดอยู่
- **สัญญาสาธารณะไม่สมบูรณ์: index.js ส่งออก 13+ รายการ แต่ CHARTER.md มีเพียง 2 รายการ** ในรายการสัญญาสาธารณะ
- **การทดสอบ RLS ของ Postgres ถูกข้ามใน CI** เมื่อ ZURI_TEST_POSTGRES_URL ไม่ได้ถูกกำหนด (ตรวจสอบ governance.yml แล้ว)

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|-------|---------|---------|
| docs/domains/knowledge/CHARTER.md | PARTIAL | CHARTER.md:130-133 vs published-snapshot-contract.js (154 lines) | CHARTER FR-110 section stale — code added 2 days later 2026-08-31 |
| owns_models: [] | IMPLEMENTED | CHARTER.md:4; prisma/schema.prisma | No Prisma model owned (verified) |
| business-contract.js (FR-047) | IMPLEMENTED | src/modules/knowledge/business-contract.js:1-148 | Curated read contract |
| postgres-business-knowledge.js (FR-051) | IMPLEMENTED | postgres-business-knowledge.js:1-50; phase1-runtime.js:249 | Wired to production |
| supabase-business-knowledge.js (FR-047 alt) | PARTIAL | supabase-business-knowledge.js:1-40; not in index.js | Dead code — not exported or called |
| runtime-postgres-config.js (FR-052/054) | IMPLEMENTED | runtime-postgres-config.js; phase1-runtime.js:18 | Live |
| runtime-isolation-probe.js (FR-054) | GATED_PRODUCTION | runtime-isolation-probe.js; runtime-isolation-probe.postgres.test.js:10-18 | RLS proof self-skips without ZURI_TEST_POSTGRES_URL |
| project-graph.js (FR-024 write) | MISSING_SURFACE | project-graph.js:59; index.js:6 | Zero production callers |
| sink.js / genesisblockdb-sink.js (FR-024) | MISSING_SURFACE | sink.js:47; genesisblockdb-sink.js:62; index.js:8-9 | Zero production callers |
| query.js (FR-024 read) | IMPLEMENTED | query.js; context.js:88 fallback | Live via default path |
| graph-query.js (FR-024 GKS read) | MISSING_SURFACE | graph-query.js:21; only in createAgentPorts (no callers) | Unreachable from production |
| live-facts.js (assertNoLiveFacts guard) | IMPLEMENTED | live-facts.js | Used by 5+ files |
| smartgift-knowledge-catalog.js | MISSING_SURFACE | smartgift-knowledge-catalog.js:1-103 | Only imported by smartgift-rag-pipeline.js (no callers) |
| smartgift-rag-pipeline.js | MISSING_SURFACE | smartgift-rag-pipeline.js:12+ | grep finds zero non-test callers |
| gbdb-rag-service.js | MISSING_SURFACE | gbdb-rag-service.js:15 | Zero production callers |
| ingestion-job.js (FR-109) | PARTIAL | ingestion-job.js | Consumed by knowledge-ingestion-executor.js (no caller) |
| stage-runner.js (FR-118/119) | PARTIAL | stage-runner.js | Consumed only by non-called executor |
| quarantine.js (FR-119) | PARTIAL | quarantine.js | Consumed only by non-called executor |
| Stages 2-8 processing | IMPLEMENTED | chunking/classification/dedup/entity-extraction/normalization/parsing/provenance.js | Pure, unit-tested; in-memory composition only |
| FR-111 sensitivity lattice + processing policy | IMPLEMENTED | classification.js; docs/PRD-SDD-v1.0.md:321 ✅ | 24 unit tests; composed only by non-called executor — ดูข้อวินิจฉัย 16 |
| FR-112 structural chunking (parent-child) | IMPLEMENTED | chunking.js; docs/PRD-SDD-v1.0.md:322 ✅ | 12 unit tests; ดูข้อวินิจฉัย 16 |
| FR-113 entity candidate extraction | IMPLEMENTED | entity-extraction.js; docs/PRD-SDD-v1.0.md:323 ✅ | 29 unit tests; ดูข้อวินิจฉัย 16 |
| FR-114 canonical normalization | IMPLEMENTED | normalization.js; docs/PRD-SDD-v1.0.md:324 ✅ | 29 unit tests; ดูข้อวินิจฉัย 16 |
| FR-115 document parsing (ParsedArtifact) | IMPLEMENTED | parsing.js; docs/PRD-SDD-v1.0.md:325 ✅ | 17 unit tests; ดูข้อวินิจฉัย 16 |
| FR-116 derived-object provenance/lineage | IMPLEMENTED | provenance.js; docs/PRD-SDD-v1.0.md:326 ✅ | 23 unit tests; ดูข้อวินิจฉัย 16 |
| FR-117 deduplication/version relationships | IMPLEMENTED | dedup.js; docs/PRD-SDD-v1.0.md:327 ✅ | 18 unit tests; ดูข้อวินิจฉัย 16 |
| FR-118 Tier-1 stage composition (stage-runner) | IMPLEMENTED | stage-runner.js; docs/PRD-SDD-v1.0.md:328 ✅ | 15 unit tests; ผู้เรียกจริงเดียวคือ knowledge-ingestion-executor.js ที่ไม่มี production trigger (D2-domain-knowledge-06) — ดูข้อวินิจฉัย 16 |
| FR-119 per-stage failure attribution (BR-022 quarantine) | IMPLEMENTED | quarantine.js, stage-runner.js; docs/PRD-SDD-v1.0.md:329 ✅ | 15 unit + 8 integration tests; เส้นทางเดียวกับ FR-118 ไม่มี production trigger — ดูข้อวินิจฉัย 16 |
| published-snapshot-contract.js (FR-110 KNO-01) | PARTIAL | published-snapshot-contract.js:32-154 | evaluateKnowledgePublication untriggered |
| index.js public surface | PARTIAL | index.js:6-25 vs CHARTER.md:139-146 | 13+ exports vs 2-item declared contract |
| scripts/build_business_knowledge_import.py | IMPLEMENTED | scripts/build_business_knowledge_import.py:1-5 | Matches charter; tested |
| scripts/export_smartgift_business_knowledge.py | IMPLEMENTED | scripts/export_smartgift_business_knowledge.py:1-9 | Exists; not named in charter |
| FR-131 shipping rate card | DECLARED_ONLY | docs/domains/knowledge/features/FR-131.md:7 | Declared only; no code found |
| /api/pipelines/runs route surface | PARTIAL | TRACE.md:872-876; integration CHARTER.md:4-8 | Not covered by any owns_routes glob |
| Postgres RLS test (SEC-011) | GATED_PRODUCTION | runtime-isolation-probe.postgres.test.js:10-18 | governance.yml never sets ZURI_TEST_POSTGRES_URL |

#### Findings

##### D2-domain-knowledge-01 — ส่วน FR-110 ของ CHARTER.md ล้าสมัย: บอกว่า 'ไม่มี route, model หรือ code ใดได้รับอนุญาต' ทั้งที่มีโค้ด FR-110 จริง 154 บรรทัดแล้ว

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | HIGH |
| ประเภท | DOC_DRIFT |
| หลักฐาน | CHARTER.md:130 ('Declared, not implemented'); CHARTER.md:133 ('no route, model or code is authorized'); published-snapshot-contract.js:16 (154-line @req FR-110); FR-110 feature note dated 2026-08-31 (status: partial) |
| สิ่งที่ควรเป็น | CHARTER.md เป็นเอกสารที่เชื่อถือได้สูงสุด (CLAUDE.md: "Read this first") ผู้อ่านที่ทำตามคำแนะนำนั้นไม่ควรถูกบอกว่าโค้ดไม่มีอยู่ ทั้งที่จริง ๆ มีแล้ว |
| สิ่งที่เป็นจริง | git log: CHARTER.md แก้ครั้งล่าสุด 2026-08-29 (ced1fba); published-snapshot-contract.js ถูกเพิ่ม 2026-08-31 (11267bd) — 2 วันหลังจากนั้น charter ไม่เคยถูกแก้หลังจาก FR-110 ship แล้ว ขัดแย้งกับสถานะของ feature note (partial) และการ mark ใน PRD |
| ข้อเสนอแนะ | อัปเดตส่วน FR-110 ของ CHARTER.md ให้อธิบาย KNO-01 slice ที่ ship แล้ววันนี้ (zKnowledgeStageReport, zKnowledgeStage17Decision, evaluateKnowledgePublication) และย้าย caveat 'no route/model' ไปเฉพาะส่วนที่ยังเปิดอยู่จริง (external reporter, atomic publication, retrieval) |
| เกี่ยวข้อง | D2-domain-knowledge-05 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-knowledge-02 — เส้นทาง WRITE ของ FR-024 ที่ project เข้า GKS (projectKnowledgeGraph → writeGraph → sink) เขียนโค้ดและทดสอบครบแล้ว แต่ไม่มีผู้เรียกใช้จากการผลิตเลย

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | HIGH |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | index.js:6,8,9 (exports); project-graph.js:59; sink.js:47; PRD-SDD-v1.0.md:234 (FR-024 marked ✅); grep src/ excluding src/modules/knowledge returns zero callers for projectKnowledgeGraph, writeGraph, createJsonSink, createGenesisBlockDBSink |
| สิ่งที่ควรเป็น | PRD ทำเครื่องหมาย FR-024 ว่า ✅ เสร็จแล้ว — requirement ที่เสร็จสมบูรณ์ควรมีผู้เรียกใช้จริงอย่างน้อยหนึ่งจุดนอกเหนือจาก test ของตัวเอง |
| สิ่งที่เป็นจริง | domain การ project จาก relations เข้ากราฟที่สร้างขึ้นมาไม่เคยถูกเรียกใช้เลยนอกจาก unit/integration test ของตัวเอง ไม่มีผู้เรียกใน src/app, src/modules/agent, scripts/ หรือ entry point ใด ๆ |
| ข้อเสนอแนะ | เชื่อม trigger จริง (script, cron, admin action ที่เรียก projectKnowledgeGraph + writeGraph ตามตารางเวลาหรือเมื่อข้อมูลเปลี่ยน) หรือแก้สถานะ PRD/TRACE ของ FR-024 ให้ระบุว่า projection เป็น library-complete แต่ยังไม่ได้ operate จริง ให้สอดคล้องกับความซื่อสัตย์ของ charter ที่มีต่อ FR-109/118 |
| เกี่ยวข้อง | D2-domain-knowledge-03, 04 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-knowledge-03 — เส้นทาง READ ของ FR-024 ที่อิง GKS (createGraphKnowledgeReader) เข้าถึงได้ผ่าน createAgentPorts เท่านั้น ซึ่งตัวมันเองก็ไม่มีผู้เรียกใช้เลย

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | HIGH |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | context.js:88 (fallback: knowledgeReader ?? queryKnowledge); runtime.js:27,36 (createAgentPorts only constructs createGraphKnowledgeReader); phase1-runtime.js:247 (production wiring has no knowledge/graphTraverse key); line-webhook/route.js:3 (imports createPhase1BusinessAgentPortsFromEnv, never createAgentPorts) |
| สิ่งที่ควรเป็น | ADR-007 และ FR-024 นำเสนอ createGraphKnowledgeReader ว่าเป็น 'สัญญาที่ agent ใช้บริโภค' บ่งบอกว่าการ traverse กราฟที่อิง GKS เป็นเส้นทางอ่านจริงสำหรับ LINE turn ในการผลิต |
| สิ่งที่เป็นจริง | Entry point ในการผลิต (line-webhook) สร้าง port ผ่าน createPhase1BusinessAgentPortsFromEnv (ไม่มี key knowledge) createAgentPorts ไม่มีผู้เรียกใช้เลยใน src/app ดังนั้น assembleAgentContext จะ resolve ไปที่ queryKnowledge (Prisma ธรรมดา) เสมอ; การ traverse GenesisBlockDB ไม่เคยถูก execute บน traffic จริงเลย |
| ข้อเสนอแนะ | ตัดสินใจว่าการเชื่อมต่อ GKS ตั้งใจจะ ship เร็ว ๆ นี้หรือไม่ (เชื่อม graphTraverse เข้า createPhase1BusinessAgentPortsFromEnv เมื่อ GenesisBlockDB เข้าถึงได้แล้ว) หรือระบุใน FR-024/ADR-007 ว่าเส้นทางอ่านที่อิงกราฟเป็น seam ที่ออกแบบล่วงหน้าไว้แต่ยังไม่มีเส้นทาง activation |
| เกี่ยวข้อง | D2-domain-knowledge-02 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-knowledge-09 — หลักฐานเดียวที่มีของ RLS/role-isolation บน Postgres จริงสำหรับ FR-051/052/054 (SEC-010/011) self-skip เสมอใน CI

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | HIGH |
| ประเภท | TEST_GAP |
| หลักฐาน | runtime-isolation-probe.postgres.test.js:10,18 (const adminUrl = process.env.ZURI_TEST_POSTGRES_URL; runPostgres = adminUrl ? describe : describe.skip); .github/workflows/governance.yml:101 (no ZURI_TEST_POSTGRES_URL anywhere in file; grep confirms no Postgres service container declared) |
| สิ่งที่ควรเป็น | CLAUDE.md: 'a green CI run must mean the work ran and passed, never that it did not run' SEC-010/011 ต้องการให้ scope-bound DB role และ forced RLS ถูกพิสูจน์ด้วย test จริง ไม่ใช่ mock |
| สิ่งที่เป็นจริง | governance.yml ไม่เคยตั้งค่า ZURI_TEST_POSTGRES_URL เลย (ยืนยันโดย grep ทั่วทั้งไฟล์ workflow) branch describe.skip จึงทำงานเสมอใน CI assert-tests-ran.mjs ป้องกันเฉพาะกรณี test ทั้งหมดเป็นศูนย์ ไม่ครอบคลุมกรณีไฟล์ integration เฉพาะจุดถูกข้ามถาวร |
| ข้อเสนอแนะ | เพิ่ม Postgres service เข้า governance.yml (หรือ job แยกต่างหาก) ที่ตั้งค่า ZURI_TEST_POSTGRES_URL ชี้ไปที่ loopback database zuri_fr054_test แล้วรัน suite นี้ เพื่อให้หลักฐาน RLS/role-isolation ของ FR-051/052/054 ถูกบังคับใช้ทุก PR แทนที่จะรันเฉพาะเมื่อคนสั่งด้วยมือ |
| เกี่ยวข้อง | ไม่มี |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-knowledge-04 — ไฟล์ SmartGift/GenesisBlockDB RAG pipeline implement และทดสอบครบแล้ว แต่ไม่มีผู้เรียกใช้จากการผลิตเลย

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | smartgift-rag-pipeline.js:170 (export handleSmartGiftCustomerTurn); gbdb-rag-service.js:15 (export createGenesisBlockDbRagService); smartgift-knowledge-catalog.js:1 (seed only imported by pipeline.js); phase1-runtime.js:249 (production uses createPostgresBusinessKnowledgeReader); grep src/app and src/modules/agent returns zero non-test callers |
| สิ่งที่ควรเป็น | TRACE.md:192 ระบุทั้งสามไฟล์นี้อยู่ใน Code column ของ FR-024 พร้อมกับ 8 test suite บ่งบอกว่าเป็นส่วนหนึ่งของระบบที่ทำงานจริง |
| สิ่งที่เป็นจริง | ไม่มีไฟล์ใดถูก import โดย LINE webhook handler จริง หรือ script ใด ๆ ทั้งสามไฟล์เป็นของตัวเองและ test file ของตัวเองเท่านั้น |
| ข้อเสนอแนะ | เชื่อมต่อให้เป็น SmartGift turn handler จริง (ตอนนี้ assembleAgentContext แบบทั่วไปให้บริการ LINE) หรือระบุใน charter ให้ชัดเจนว่าเป็น parallel/experimental เพื่อไม่ให้ผู้อ่านคิดว่าเป็นโครงสร้างหลักเพียงเพราะ FR-024 เป็น ✅ |
| เกี่ยวข้อง | D2-domain-knowledge-02, 03 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-knowledge-06 — Ingestion executor 7 stage ของ Tier-1 (ingestKnowledgeDocument) ไม่มี route หรือ script trigger เลย

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | MISSING_SURFACE |
| หลักฐาน | knowledge-ingestion-executor.js:134 (export ingestKnowledgeDocument); src/app/api/ingest/documents/route.js:1 (no reference to it); ROADMAP.md:202 (self-disclosure: no production MSP→GKS deployment yet); grep src/ and scripts/ returns only 2 test file callers |
| สิ่งที่ควรเป็น | Charter ของ FR-109 อธิบาย 'บันทึกการรัน' ว่าเป็นความสามารถที่ทำงานได้จริง; roadmap ติดตาม PHASE-ZAI-KNOWLEDGE ที่ 60% |
| สิ่งที่เป็นจริง | ไม่มีทางที่เอกสารจริงจะไปถึง Tier 1 composition 7 stage นอกจาก test file เรียกฟังก์ชันโดยตรง entry point ที่น่าจะเป็นไปได้ (/api/ingest/documents) ไม่เคยอ้างอิงถึงมันเลย |
| ข้อเสนอแนะ | เพิ่ม trigger 'ledger-writing wiring' ที่ charter ระบุว่ายังขาดอยู่ — route, admin action หรือ queue consumer ที่เรียก ingestKnowledgeDocument สำหรับ raw record ของ FR-081 จริง — หรือคง framing ของ ROADMAP ไว้ (ซื่อสัตย์อยู่แล้ว) แต่เพิ่ม caveat เดียวกันนี้ในส่วน ingestion-lane ของ CHARTER |
| เกี่ยวข้อง | ไม่มี |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-knowledge-07 — ส่วน 'Public contract' ของ charter ตั้งชื่อไว้เพียง 2 รายการ แต่ module ส่งออกจริง 13+ bindings

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | BUILT_NOT_DECLARED |
| หลักฐาน | CHARTER.md:144-145 (2 items listed); index.js:6-25 (13+ bindings across 6 groups); knowledge-ingestion-executor.js:2 (imports knowledgeIngestionRunInput and 3 more directly, bypassing index.js); integration CHARTER.md:135 (names this exact cross-import pattern but knowledge's does not reciprocate) |
| สิ่งที่ควรเป็น | 'Public contract' ควรเป็น allow-list ที่สมบูรณ์ของสิ่งที่ domain อื่นพึ่งพา (CLAUDE.md: "Read CHARTER.md first, it states what you own") |
| สิ่งที่เป็นจริง | Charter ครอบคลุมเพียงประมาณ 2 จาก 6 กลุ่มที่ export จริง ผู้อ่านที่พึ่ง charter อย่างเดียวจะไม่รู้ว่า createGraphKnowledgeReader, createGenesisBlockDBSink หรือฟังก์ชัน ingestion-lane อีก 4 ตัวเป็นส่วนหนึ่งของ surface จริง |
| ข้อเสนอแนะ | ขยาย Public contract ของ CHARTER.md ให้ enumerate ทุก export ของ index.js บวกฟังก์ชัน ingestion-lane ที่ integration import โดยตรง ให้รายการตรงกับสิ่งที่ index.js และ direct-file import เปิดเผยจริง |
| เกี่ยวข้อง | D2-domain-knowledge-01 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-knowledge-08 — supabase-business-knowledge.js (Supabase adapter ที่ FR-047 ตั้งชื่อไว้) เป็น dead code

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | PARTIAL |
| หลักฐาน | supabase-business-knowledge.js:30 (export createSupabaseBusinessKnowledgeReader); index.js:18 (exports createPostgresBusinessKnowledgeReader only); phase1-runtime.js:249 (uses Postgres reader exclusively); PRD-SDD-v1.0.md:257 (FR-047 reads present-tense: 'DuckDB and Supabase are adapters'); grep outside own file and test returns zero callers |
| สิ่งที่ควรเป็น | FR-047 นำเสนอ DuckDB และ Supabase เป็น adapter ปัจจุบันคู่ขนานกันภายใต้ BusinessKnowledgeReadPort |
| สิ่งที่เป็นจริง | การ migration ในการผลิตของ FR-051 (Postgres โดยตรงพร้อม forced RLS) ดูเหมือนจะแทนที่เส้นทาง Supabase Data-API ไปแล้ว แต่ไม่มีที่ไหนในข้อความ PRD ของ FR-047, TRACE.md หรือ charter บอกว่ามันไม่ทำงานแล้ว |
| ข้อเสนอแนะ | เชื่อม fallback/multi-adapter selection จริงสำหรับ Supabase หรือแก้คำอธิบาย FR-047 ให้ระบุว่า Supabase adapter ถูกแทนที่โดยเส้นทาง direct-Postgres ของ FR-051 แล้ว และเก็บไว้เพียงเป็น reference code ที่ทดสอบแล้ว |
| เกี่ยวข้อง | ไม่มี |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-knowledge-10 — FR-052 ระบุ production activation gate ที่ยังไม่คลี่คลายไว้อย่างชัดเจน

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | PRODUCTION_GATE_OPEN |
| หลักฐาน | PRD-SDD-v1.0.md:262 ('Binding reserved remotely as PENDING; live role isolation passes, activation destination/canary gates remain') |
| สิ่งที่ควรเป็น | (รายงานข้อเท็จจริงของ gate ที่เปิดอยู่ ไม่ใช่ข้อบกพร่องในโค้ด) |
| สิ่งที่เป็นจริง | สถานะ PRD ระบุ 'activation destination/canary gates remain' ว่าเป็นตัวบล็อกการใช้งานจริงเต็มรูปแบบของ LINE scope binding ที่ server เป็นเจ้าของใน FR-052 ถึงแม้โค้ดฝั่ง knowledge domain (runtime-postgres-config.js, runtime-isolation-probe.js) ที่ implement ครึ่งหนึ่งของ isolation จะเสร็จสมบูรณ์แล้ว |
| ข้อเสนอแนะ | ติดตามเป็น standing release blocker ที่เป็นของผู้ควบคุมการอนุมัติ LINE canary/destination (นอก repo นี้); ไม่มี code change ที่ต้องทำสำหรับ knowledge domain |
| เกี่ยวข้อง | D2-domain-knowledge-11 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-knowledge-11 — FR-054 ระบุ external NOT_RUN gate ที่บล็อกการ activate เต็มรูปแบบไว้อย่างชัดเจน

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | PRODUCTION_GATE_OPEN |
| หลักฐาน | PRD-SDD-v1.0.md:264 ('Implemented (beta): secret-redacted live probe passes exact 74-row scope; approved provider evaluation and signed LINE canary remain external NOT_RUN gates') |
| สิ่งที่ควรเป็น | (รายงานข้อเท็จจริงของ gate ที่เปิดอยู่) |
| สิ่งที่เป็นจริง | ยืนยันว่า runtime-isolation-probe.js (domain นี้) เสร็จสมบูรณ์ตามหน้าที่สำหรับ scope ของตัวเอง แต่การ activate FR-054 เต็มรูปแบบถูกบล็อกด้วยการอนุมัติภายนอกที่ยังไม่รัน 2 รายการ ซึ่งไม่เกี่ยวกับโค้ดเพิ่มเติมใน domain นี้ |
| ข้อเสนอแนะ | ไม่มี code action สำหรับ knowledge domain; ติดตามเป็น external release gate อ้างอิงร่วมกับ D2-domain-knowledge-09 เนื่องจากหลักฐานอัตโนมัติก็ถูก gate เช่นกัน (โดย CI env ไม่ใช่ policy) |
| เกี่ยวข้อง | D2-domain-knowledge-10, 09 |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-knowledge-13 — glyph สถานะ PRD ของ NFR-020 เป็น ✅ (เสร็จแล้ว) ทั้งที่ข้อความสถานะบอกว่า metric ส่วนใหญ่ 'declined'/'unwired'

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | PRD-SDD-v1.0.md:372 (Status begins '✅ implemented 2026-08-28 for four of six per-stage metrics' then names 10 of 13 total metrics as 'unwired'/'declined'); CHARTER.md:103 (charter prose calls this 'partial') |
| สิ่งที่ควรเป็น | Convention ของ repo สงวน 🟠 ไว้สำหรับ requirement ที่ยังไม่เสร็จ (FR-071, FR-076, FR-079-081 ฯลฯ ใช้ 🟠 ทั้งหมด) ✅ สงวนไว้สำหรับ requirement ที่ไม่มี scope เปิดค้าง |
| สิ่งที่เป็นจริง | NFR-020 ต้องการ metric รวม 13 ตัว (6 per-stage + 7 pipeline-level) มีเพียง 4 per-stage metric ที่เชื่อมแล้ว; 10 จาก 13 (เกินสามในสี่) ถูกระบุชัดว่า 'unwired'/'declined' narrative ของ charter เอง (บรรทัด 103) เรียกมันว่า 'partial' แต่ตาราง PRD ทำเครื่องหมายเป็น ✅ ธรรมดา — เป็น requirement เดียวที่ glyph กับข้อความไม่ตรงกันอย่างเห็นได้ชัด |
| ข้อเสนอแนะ | เปลี่ยน glyph ของ NFR-020 ใน PRD เป็น 🟠 ให้ตรงกับลักษณะที่ charter อธิบาย และตาม convention ของ repo นี้สำหรับ requirement หลายส่วนที่ยังมี sub-scope ค้างอยู่ |
| เกี่ยวข้อง | D2-domain-knowledge-01 |
| การตรวจสอบ | verifier-added |

##### D2-domain-knowledge-14 — เครื่องมือ agent 'answer_from_knowledge' ระบุผิดว่า query 'GKS knowledge graph' ทั้งที่เรียก Prisma relations reader ธรรมดา

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | MEDIUM |
| ประเภท | DOC_DRIFT |
| หลักฐาน | tools.js:94 (description: 'Answer using the GKS knowledge graph'); tools.js:98 (handler calls queryKnowledge — no graphTraverse or GenesisBlockDB); knowledge/query.js:24 (queryKnowledge: 'Query a principal's relation neighbourhood via prisma.customer.findMany/prisma.membership.findMany' — plain relational read, not graph traversal) |
| สิ่งที่ควรเป็น | คำอธิบายเครื่องมือ (ที่ LLM เห็นบนเส้นทาง LINE จริง) ควรตั้งชื่อ backing store ที่แท้จริง เพราะคำอธิบายคือสิ่งที่ LLM ใช้ตัดสินใจว่าจะเรียกเมื่อไหร่ |
| สิ่งที่เป็นจริง | defaultReadOnlyTools ถูกเชื่อมเข้า assembleAgentContext (context.js:95) ซึ่ง turn.js เรียกใช้บนเส้นทาง LINE จริง เครื่องมือที่ชื่อ 'GKS knowledge graph' คือ queryKnowledge (Prisma ธรรมดา) — ช่องว่างเดียวกับ D2-domain-knowledge-03 แต่มองเห็นได้เป็น mislabel ที่ user/model เห็นตรง ๆ ไม่ใช่แค่ seam ภายใน |
| ข้อเสนอแนะ | เปลี่ยนคำอธิบายเครื่องมือให้ตรงกับความจริง ('Answer using the customer's known relations in this tenant') จนกว่า createGraphKnowledgeReader จะถูกเชื่อมเข้าจริง เพื่อไม่ให้คำอธิบายอ้างความสามารถที่ runtime ยังไม่มี |
| เกี่ยวข้อง | D2-domain-knowledge-03 |
| การตรวจสอบ | verifier-added |

##### D2-domain-knowledge-05 — กฎธุรกิจการเผยแพร่ของ FR-110 ถูกเข้ารหัสไว้สองครั้งอย่างเป็นอิสระต่อกัน โดยไม่มีอะไรทำให้สองที่นี้ sync กัน

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | LOW |
| ประเภท | PARTIAL |
| หลักฐาน | published-snapshot-contract.js:138 (evaluateKnowledgePublication — pure function, called by nothing); pipeline-tracking-contract.js:530 (zPipelineEvent superRefine — second, independent encoding enforced on every write); grep for evaluateKnowledgePublication returns zero callers outside its file and unit test |
| สิ่งที่ควรเป็น | กฎหนึ่งกฎควรมี implementation ที่เชื่อถือได้เพียงหนึ่งเดียว เพื่อให้การแก้ไขในอนาคตที่จุดหนึ่งบังคับให้อีกจุดตามไปด้วย ป้องกันการเบี่ยงเบน |
| สิ่งที่เป็นจริง | knowledge domain เข้ารหัส evaluateKnowledgePublication เป็น AC-110.2/.3 แต่ zPipelineEvent superRefine ของ integration domain สร้างการตรวจสอบเดียวกันขึ้นมาใหม่โดยอิสระเพื่อ gate การเขียนจริง วันนี้มีเพียงสำเนาของ integration เท่านั้นที่ทำงานจริง finder ตรวจพบถูกต้องว่านี่คือ dead code แต่สรุปผิดว่ากฎนี้ไม่ถูกบังคับใช้ — ที่จริงมันถูกบังคับใช้อยู่ เพียงแต่อยู่คนละที่ |
| ข้อเสนอแนะ | ให้ superRefine ของ integration เรียก evaluateKnowledgePublication ของ knowledge (หรือ export เฉพาะ boolean predicate ให้ import ไปใช้) หรือลบ evaluateKnowledgePublication ทิ้งเพราะไม่ได้ใช้ — ไม่ว่าทางไหนก็ควรหยุด maintain กฎนี้สองที่ |
| เกี่ยวข้อง | ไม่มี |
| การตรวจสอบ | ADJUSTED — กฎถูกบังคับใช้จริงผ่าน superRefine ของ zPipelineEvent.parse ใน pipeline-tracking-service.js:405 ยืนยันโดย trace recordPipelineEvent → parsePipelineEvent → zPipelineEvent.parse → superRefine block ที่บล็อก APPROVED gate ที่มี verdict FAIL/QUARANTINE หรือ critical dimension อย่างชัดเจน gate ไม่ได้เปิดอยู่ evaluateKnowledgePublication เป็นโค้ดซ้ำที่ไม่ถูก trigger (ความเสี่ยงด้านการดูแลรักษา) ไม่ใช่ requirement ที่ไม่ถูกบังคับใช้ ปรับลงจาก HIGH production-gate-open เป็น LOW code-duplication risk |

##### D2-domain-knowledge-12 — กลุ่มเส้นทาง /api/pipelines/runs ไม่มี owns_routes glob ของ domain charter ใดอ้างสิทธิ์เลย

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | LOW |
| ประเภท | BOUNDARY_VIOLATION |
| หลักฐาน | TRACE.md:872 (FR-109's Surface: `/api/pipelines/runs`); integration CHARTER.md:4 (owns_routes globs do not match src/app/api/pipelines/**); knowledge CHARTER.md:1 (no owns_routes key declared) |
| สิ่งที่ควรเป็น | ทุก route ใน src/app/api ควร trace ไปยัง owns_routes glob ของ charter เพียงหนึ่งเดียวได้ ตาม convention ของ DOMAIN-MAP.md |
| สิ่งที่เป็นจริง | src/app/api/pipelines/runs/route.js และ [executionRunId]/{events,replay} implement FR-071 (integration) และ FR-109 (knowledge) แต่อยู่นอกทุก glob ที่ประกาศไว้ นี่เป็นช่องว่างความสมบูรณ์เล็กน้อยมากกว่าความขัดแย้งจริง (route มี @req annotation ถูกต้อง ไม่ได้ถูกจัดหมวดผิด) |
| ข้อเสนอแนะ | เพิ่ม src/app/api/pipelines/** เข้า owns_routes ของ integration (โค้ด integration-lane ตาม import ของแต่ละไฟล์) หรือบันทึกไว้ในทั้งสอง charter ว่านี่เป็น surface ที่ตั้งใจให้ใช้ร่วมกันโดยไม่มี glob |
| เกี่ยวข้อง | ไม่มี |
| การตรวจสอบ | CONFIRMED |

##### D2-domain-knowledge-15 — กฎธุรกิจการเผยแพร่ของ FR-110 มีอยู่ใน 2 implementation ที่เป็นอิสระต่อกันและไม่ sync กัน

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | LOW |
| ประเภท | PARTIAL |
| หลักฐาน | published-snapshot-contract.js:138 (evaluateKnowledgePublication); pipeline-tracking-contract.js:530 (zPipelineEvent superRefine); grep confirms no synchronization or shared logic between them; each independently encodes: block APPROVED on FAIL verdict/critical dimension |
| สิ่งที่ควรเป็น | กฎหนึ่งกฎควรมีการเข้ารหัสเดียวตามตรรกะ BR-021 ของ repo นี้ — กฎอยู่ที่เดียวเพื่อให้การแก้ไขในอนาคตที่จุดหนึ่งบังคับให้อีกจุดตามไปด้วย |
| สิ่งที่เป็นจริง | knowledge เขียน evaluateKnowledgePublication เป็นการเข้ารหัส AC-110.2/.3; integration สร้างการตรวจสอบเดียวกันขึ้นมาใหม่โดยอิสระใน zPipelineEvent superRefine เพื่อ gate การเขียนจริง ไม่มีฝั่งไหนเรียกอีกฝั่ง มีเพียงสำเนาของ integration ที่ทำงานจริง การแก้ไขในอนาคตที่จุดหนึ่งไม่มีกลไกบังคับให้อีกจุดตามไปด้วย สร้างความเสี่ยงด้านการดูแลรักษา/ความสอดคล้อง |
| ข้อเสนอแนะ | ให้ superRefine ของ integration เรียก evaluateKnowledgePublication ของ knowledge (หรือ export เฉพาะ predicate ให้ integration import ไปใช้) หรือลบ evaluateKnowledgePublication ทิ้งถ้า integration ตั้งใจเป็นเจ้าของการบังคับใช้ — ไม่ว่าทางไหนก็ควร maintain กฎนี้ที่เดียวเท่านั้น |
| เกี่ยวข้อง | D2-domain-knowledge-05 |
| การตรวจสอบ | verifier-added |

##### D2-domain-knowledge-16 — FR-111 ถึง FR-119 (9 FR ✅ ของ Tier-1) ไม่มีผู้เรียกใช้จากการผลิตเลย; แถว Inventory เดียวที่รวมทุกอย่างไว้บดบัง overclaim ระดับ 9 FR

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | HIGH |
| ประเภท | BROKEN_FLOW |
| หลักฐาน | docs/PRD-SDD-v1.0.md:321-329 ทั้ง 9 แถว (FR-111..FR-119) มีสถานะ "✅ implemented" พร้อมจำนวน unit test กำกับ (เช่น FR-112 "✅ implemented; 12 unit tests", FR-117 "✅ implemented; 18 unit tests"); โค้ดมีจริงใน src/modules/knowledge/{classification,chunking,entity-extraction,normalization,parsing,provenance,dedup,stage-runner,quarantine}.js; stage-runner.js:1-5 ผูก 7 stage เข้าด้วยกัน (FR-118/119) และผู้เรียกจริงเพียงรายเดียวคือ src/platform/integrations/core/knowledge-ingestion-executor.js ซึ่งตัวรายงานนี้เองระบุแล้วว่าไม่มี production trigger (D2-domain-knowledge-06, MEDIUM) |
| สิ่งที่ควรเป็น | FR ที่มีสถานะ ✅ implemented ใน PRD ควรมี production caller อย่างน้อยหนึ่งจุด ไม่ใช่แค่ unit test เรียกตรง — เช่นเดียวกับที่รายงานนี้ยึดถือสำหรับ FR-029 (D2-domain-agent-01, CRITICAL) และ FR-024 (D2-domain-knowledge-02/03, HIGH) |
| สิ่งที่เป็นจริง | โค้ดทั้ง 9 FR (Tier 1 stage ทั้งหมด) implement ครบและมี unit test ผ่านหมด แต่ผูกเข้าด้วยกันผ่าน stage-runner.js ซึ่งมีผู้เรียกเดียวคือ knowledge-ingestion-executor.js ที่ไม่มี route/script/cron trigger ใด ๆ ใน production — Inventory เดิมของหน่วยนี้ (แถว "Stages 2-8 processing") รวมทั้งหมดเป็นบรรทัดเดียวไม่มี FR id กำกับ ไม่มีการเทียบกับสถานะ PRD เลย จึงบดบัง overclaim ระดับ 9 FR ไว้ |
| ข้อเสนอแนะ | เพิ่ม trigger จริง (route, admin action หรือ queue consumer) ให้ knowledge-ingestion-executor.js ตามที่ D2-domain-knowledge-06 แนะนำไว้แล้ว ก่อนถือว่า FR-111..FR-119 เสร็จสมบูรณ์ในทางปฏิบัติ หรือแก้ไข PRD status ของทั้ง 9 แถวให้ระบุชัดว่า "library-complete, unwired to production" |
| เกี่ยวข้อง | D2-domain-knowledge-06 |
| การตรวจสอบ | critic-added |

##### D2-domain-knowledge-17 — CHARTER.md ขาด Version/Status control block (shared debt ทั้ง 8 domain charter)

| ฟิลด์ | รายละเอียด |
|------|-----------|
| ระดับ | LOW |
| ประเภท | DOC_DRIFT |
| หลักฐาน | grep -cE '^version:\|^status:' docs/domains/knowledge/CHARTER.md = 0; เหมือนกันทั้ง 8 charter (agent, crm, identity, integration, knowledge, market-intelligence, platform-control, project-manager) — ไม่ใช่เฉพาะ knowledge |
| สิ่งที่ควรเป็น | ทุก charter ควรมี Version/Status control block ตาม convention ของโปรเจกต์ |
| สิ่งที่เป็นจริง | Key นี้ไม่มีในทั้ง 8 charter — ก่อนหน้านี้รายงานเฉพาะ crm (INFO), identity (LOW), integration (INFO), project-manager (LOW) เท่านั้น ทำให้ผู้อ่านเข้าใจผิดว่า agent, knowledge, market-intelligence, platform-control charter ปฏิบัติตาม convention นี้แล้ว |
| ข้อเสนอแนะ | เพิ่ม Version/Status frontmatter ให้ครบทั้ง 8 charter ในการแก้ไขครั้งถัดไป |
| เกี่ยวข้อง | — |
| การตรวจสอบ | critic-added |

#### ข้อจำกัดการตรวจ

ผู้ค้นหา อ่านเต็มทั้งหมด: CHARTER.md (ครบ); 12 ไฟล์คุณลักษณะในfeaturesフォルダ; 24 ไฟล์ใน src/modules/knowledge/**; index.js (ครบ); context.js, runtime.js, phase1-runtime.js, tools.js (ที่เกี่ยวข้อง); line-webhook/route.js, pipelines/runs/route.js, ingest/documents/route.js (import lines); knowledge-ingestion-executor.js, pipeline-tracking-service.js, pipeline-tracking-contract.js (ส่วนที่เกี่ยวข้อง); scripts/build_business_knowledge_import.py, export_smartgift_business_knowledge.py (ส่วนหัว); integration CHARTER.md (ขอบเขตเต็มและ knowledge cross-refs); runtime-isolation-probe.postgres.test.js (ตรรมชาติของการข้าม); .github/workflows/governance.yml (ไฟล์ทั้งหมด สำหรับ postgres/env); PRD-SDD-v1.0.md (rows FR-024, FR-047, FR-051-052, FR-054, FR-109-119, FR-131, NFR-020, BR-021-022); TRACE.md (blocks สำหรับ FR ดังกล่าว); DOMAIN-MAP.md (ส่วน knowledge); ROADMAP.md (knowledge-lane revision notes via grep, not full file); .preflight-report.json (grep knowledge — 1 info-level finding only); git log (CHARTER.md and published-snapshot-contract.js)

ไม่ได้อ่านเต็มทั้งหมด: ROADMAP.md (grep only); KNOWLEDGE-INGESTION-17-STAGE-SPEC.md (feature notes only); appendices/A-api-spec.md (ไม่ตรวจสอบ); test bodies (24 knowledge test files — existence and headers only); docs/.domain-state.json, docs/.doc-graph.json (grep only)

การดำเนินการ: ทั้งหมด read-only (cat/grep/git log/find); ไม่มีการเขียน git, npm test, npm build หรือ npm run docs:preflight — อาศัย committed docs/.preflight-report.json และ docs/TRACE.md แทน

ผู้ตรวจสอบ: (1) อ่าน CHARTER.md ครบ บันทึกคุณลักษณะ 12 ไฟล์ src/modules/knowledge 24 ไฟล์ (อ่านเต็มสำหรับ published-snapshot-contract.js, query.js, index.js, business-contract.js; ที่เกี่ยวข้องสำหรับส่วนอื่น); (2) ตรวจสอบความเป็นเจ้าของ — ยืนยัน owns_models: [] ถูกต้อง (grep prisma calls in module shows reads only); ยืนยัน no owns_routes glob; (3) ติดตาม FR-024, FR-047, FR-051-052, FR-054, FR-109-119, FR-131, NFR-020 กับ PRD status text และ TRACE.md rows

ผล: 11 ของ 12 ข้อค้นพบยืนยัน 1 ข้อ (05) ปรับปรุง — กฎบังคับใช้โดย zPipelineEvent.parse superRefine ใน pipeline-tracking-service.js (verified: recordPipelineEvent → parsePipelineEvent → zPipelineEvent.parse → superRefine block explicitly blocks APPROVED gate with FAIL verdict or critical dimension)

ไม่มีการเขียน git, test run หรือ build; verify all read-only grep/cat/git log

## domain-market-intelligence

### domain-market-intelligence

#### สรุปย่อ

- **FR-092 (translation core) ครบตามประกาศ** แต่ 5 slice ของ Phase 2–5 (Price Intelligence, Watch MVP, Supplier Ranking, Competitor/Demand Signals, Market Research, Procurement Recommendations) ถูก ship ในสองคอมมิต (d05da11, 4306a29) โดยทั้งหมดติด `@req FR-092` ขาดการสำรอง FR id ใหม่ ตรงข้ามกับ SRS ของโดเมนเอง (§15–16)
- **Navigation `/market` ถูกเปิดใจ (`soon:false`) แต่ MarketDashboard คือ static mock ไม่เชื่อมต่อ service** — fixture data เท่านั้น ปุ่ม "New Watch Rule" เรียก alert() ใช้ useEffect อย่างไม่สมเด็จ ไม่มี caller ไปยัง PriceIntelligenceService, SupplierIntelligenceService หรือ MarketResearchService
- **Service 4 ตัว (Price, Supplier, Research, Procurement) ยังมี in-memory repository เท่านั้น** — ไม่มี Prisma model ในฐานข้อมูล ไม่มี route ใต้ `/api/market/` ไม่มี FR id ของตัวเอง ข้อมูลหายไปทุกครั้งที่ restart
- **ไม่มี audit event record จากเลย** ว่า FR-092 persisted write path ปฏิเสธกฎบ้าน CLAUDE.md ที่ "Every write goes through a service in application/, which records an audit event"
- **Doc drift แพร่กระจาย**: CHARTER ตั้งชื่อ public contract 10 function ที่ไม่มีใน code · FEATURE-MAP/TRACE ให้เครดิต 19 file ไปยัง FR-092 ที่ FR-092 ไม่ยืนยัน · SITEMAP-DOMAIN-NAV ยังคง omit DOM-MARKET-INTELLIGENCE · ROADMAP.md ยังมี TASK-FR-092 เท่านั้น ไม่มี task สำหรับ #77–#84 · README.md ยังเล่าเรื่องจำนวน Phase 0

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|---|---|---|---|
| CHARTER.md | PARTIAL | docs/domains/market-intelligence/CHARTER.md:1–119 | สถานะ owns_models (MarketObservation) ถูกต้อง ขอบเขต prose ถูกต้อง แต่ไม่มี owns_routes field ถึงแม้ว่าตั้งชื่อ 'Target route key: market' · Public contract section (79–90) ตั้งชื่อ function ที่ไม่มีใน code |
| CONTEXT-MAP.md | DECLARED_ONLY | docs/domains/market-intelligence/CONTEXT-MAP.md:26–165 | อธิบายความสัมพันธ์ Integration/Knowledge/Commerce/Marketing/Business-Home/Agent · 0 ของ downstream consumer relationships ทำให้จริงใน code |
| SRS.md delivery sequence (§15) & Phase-0 exit criteria (§16) | PARTIAL | docs/domains/market-intelligence/SRS.md:598–618 | Items 4–8 ถูก implement ในคอมมิต d05da11/4306a29 โดยไม่ทำซ้ำ '2. Global requirement reservation' step ที่ exit criterion ของตัวเองกำหนด |
| FR-092-market-translation-core.md feature note | IMPLEMENTED | docs/domains/market-intelligence/features/FR-092-market-translation-core.md:1–91 | Scoped ให้ translation core เท่านั้น · ปฏิเสธอย่างชัดเจน PriceObservation/SupplierCandidate/WatchRule (86–90) |
| src/modules/market-intelligence/README.md | DOC_DRIFT | src/modules/market-intelligence/README.md:5–13 | ยังคง 'no runtime implementation in Phase 0' · 16 file, 1 route, 1 nav entry มีอยู่แล้ว |
| MarketObservation model (Prisma) | IMPLEMENTED | prisma/schema.prisma:1754–1781 | ที่ schema.prisma และ schema.postgres.prisma เหมือนกัน · unique lineageKey · migration + RLS ยืนยัน |
| Market translation core (FR-092) | PARTIAL | src/modules/market-intelligence/application/market-observation-service.js:67–96 | integration-tested ปฏิบัติการ live Prisma DB · 0 caller ใต้ src/app หรือ src/modules/agent |
| PriceObservation domain + service | PARTIAL | src/modules/market-intelligence/application/price-intelligence-service.js:85–138 | Zod schema + matching logic · default repository = in-memory เท่านั้น · ไม่มี route ไม่มี FR id |
| WatchRule domain + evaluation | PARTIAL | src/modules/market-intelligence/domain/watch-rule.js:1–95 | Matching algorithm unit-tested · ไม่มี persistence ไม่มี route ไม่มี FR id |
| SupplierCandidate + SupplierIntelligenceService | PARTIAL | src/modules/market-intelligence/application/supplier-intelligence-service.js:1–57 | Scoring logic tested · in-memory เท่านั้น · ไม่มี FR id |
| CompetitorSignal / DemandSignal | DECLARED_ONLY | src/modules/market-intelligence/domain/market-signals.js:1–54 | Zod schema + normalize/calculate function เท่านั้น · 0 application service ไม่มี Prisma model |
| MarketResearchRun / service | PARTIAL | src/modules/market-intelligence/application/market-research-service.js:1–77 | In-memory repository · unit-tested · ไม่มี route ไม่มี FR id |
| ProcurementRecommendationService | BOUNDARY_VIOLATION | src/modules/market-intelligence/application/procurement-recommendation-service.js:1–87 | Procurement-intelligence logic ใต้ market-intelligence module ขัดขวาง charter |
| MarketDashboard.jsx UI | MISSING_SURFACE | src/modules/market-intelligence/components/MarketDashboard.jsx:1–227 | 100% hardcoded useState fixtures · imports useEffect ไม่เคยใช้ · "New Watch Rule" button เรียก alert() |
| /market route + nav entry | GATED_PRODUCTION | src/config/domains.js:55–58; src/app/(pm)/market/page.jsx:1–8 | soon:false ตั้งอยู่ ขัดขวาง ADR-038 · page ไม่สะท้อน FR-092 |
| Integration adapters: marketplace-listing, retail-price | DECLARED_ONLY | src/modules/integration/adapters/marketplace-listing-adapter.js:1–58; retail-price-adapter.js:1–61 | Pure formatter function · 0 caller นอก test ของตัวเอง |
| Charter's Public contract functions (10 names) | DECLARED_ONLY | docs/domains/market-intelligence/CHARTER.md:80–89 | ไม่มีชื่อ/signature เหล่านี้ใน export |
| Agent → Market Intelligence tool | MISSING | grep src/modules/agent for 'market' (0 hits) | CONTEXT-MAP.md ประกาศความสัมพันธ์ · ไม่มี Market tool |
| Marketing / Business Home / Commerce consumption | MISSING | grep `from '@/modules/market-intelligence` (1 hit) | ไม่มีตัวจริง · CONTEXT-MAP.md ประกาศ 3 consumer relationships |
| Test coverage — unit | IMPLEMENTED | tests/unit/market-intelligence/ (12 file) + schema-migration + adapters | ทั้งหมด pass ปฏิบัติการ in-memory/mocked |
| Test coverage — integration | PARTIAL | tests/integration/market-intelligence-persistence.test.js + GKS-resolution | FR-092 translation/persistence slice เท่านั้น |
| Test coverage — e2e | MISSING | tests/e2e/ (0 market-named spec) | ไม่มี click-through หรือ rendering regression coverage |
| ROADMAP.md tracking | PARTIAL | docs/roadmap/ROADMAP.md:259 | TASK-FR-092 เท่านั้น · #77–#84 shipped ไม่มี task row |
| SITEMAP-DOMAIN-NAV.md | DOC_DRIFT | docs/SITEMAP-DOMAIN-NAV.md:34–56 | Tier-2 list + FR-070 table omit DOM-MARKET-INTELLIGENCE |
| FEATURE-MAP.md / TRACE.md attribution | DOC_DRIFT | docs/FEATURE-MAP.md:107; docs/TRACE.md:732,734 | 19 file marked '✅ live' ที่ FR-092 ไม่ได้อธิบาย |
| INTERFACE-INVENTORY.md /market row | DOC_DRIFT | docs/INTERFACE-INVENTORY.md:126 | page = static mock data ไม่มี capabilities ที่อธิบาย |

#### Findings

##### D2-domain-market-intelligence-01 — Delivery-sequence items 4–8 shipped without reserving new global requirement ids

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | HIGH |
| **ประเภท** | BUILT_NOT_DECLARED |
| **หลักฐาน** | docs/domains/market-intelligence/SRS.md:601 '2. Global requirement reservation for the first implementation slice.' · docs/domains/market-intelligence/SRS.md:603 delivery sequence item 4: 'Price Intelligence + Watch MVP.' · docs/domains/market-intelligence/SRS.md:617 Phase-0 exit criterion: 'global FR/NFR/BR/SEC/SDD IDs are reserved only when an implementation slice is authorized' · docs/domains/market-intelligence/features/FR-092-market-translation-core.md:88 'This FR intentionally does not introduce PriceObservation, ExternalOffer, SupplierCandidate, WatchRule or source-specific Facebook/retail adapters' · src/modules/market-intelligence/domain/price-observation.js:3 tagged '@req FR-092' · src/modules/market-intelligence/domain/watch-rule.js:3 tagged '@req FR-092' · src/modules/market-intelligence/domain/supplier-candidate.js:3 tagged '@req FR-092' · src/modules/market-intelligence/application/procurement-recommendation-service.js:1 tagged '@req FR-092' |
| **สิ่งที่ควรเป็น** | Per SRS §15/§16 แต่ละ delivery-sequence slice สำรองของตัวเอง FR/NFR/BR/SEC/SDD id ใน docs/PRD-SDD-v1.0.md ก่อน code annotated หรือ shipped |
| **สิ่งที่เป็นจริง** | Commit d05da11 และ 4306a29 (2026-09-01) implement ทั้ง 5 remaining slices + tag ทุก new file '@req FR-092' — id ที่มีอยู่แล้ว · ไม่มี new id สำรอง |
| **ข้อเสนอแนะ** | สำรอง FR-1xx ids (หนึ่ง per slice หรือ bundling id หนึ่ง) ใน docs/PRD-SDD-v1.0.md สำหรับ Price/Watch, Supplier, Competitor/Demand, Market Research, Procurement-recommendation; re-tag files; รัน docs:ids -- --write |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-02, D2-domain-market-intelligence-03 |
| **การตรวจสอบ** | ADJUSTED: governance/id-discipline lapse ไม่ใช่ BR/SEC/SDD-009 pipeline/audit/tenant-scope violation หรือ broken primary user journey |

##### D2-domain-market-intelligence-02 — Generated FEATURE-MAP.md/TRACE.md misattribute Phase 2–5 files to FR-092 as '✅ live'

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | HIGH |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/FEATURE-MAP.md:107 FR-092 row lists `app/(pm)/market/page.jsx` +19 (1 named file + 19 more in the "+19" notation = 20 files total) marked '✅ live' · docs/TRACE.md:732 lists 20 file paths in the same Code column (verified count: 1. page.jsx, 2-3 integration adapters, 4-9 six application services, 10 MarketDashboard.jsx, 11-16 six domain modules, 17-19 three infrastructure modules, 20 backup-service.js) · `grep -rln 'FR-092' src/` = 20 files, matching · docs/PRD-SDD-v1.0.md:302 FR-092 text describe translation RawExternalRecord → MarketObservation เท่านั้น |
| **สิ่งที่ควรเป็น** | Generated trace view attribute files เฉพาะ FR ที่ declared statement ครอบคลุมสิ่งที่ file ทำ |
| **สิ่งที่เป็นจริง** | Graph built from @req annotations เท่านั้น · ทุก Phase 2–5 file inherit FR-092 '✅ live' status ถึงแม้ FR-092 ไม่ได้อธิบาย |
| **ข้อเสนอแนะ** | หลังจาก finding 01 resolved regenerate docs:graph เพื่อ split ถูก FEATURE-MAP/TRACE |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-01 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-03 — ProcurementRecommendationService places Commerce/Procurement-owned logic inside market-intelligence module

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | HIGH |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | docs/domains/market-intelligence/CHARTER.md:31 'Procurement Intelligence is downstream under Commerce/Procurement' · docs/PRD-SDD-v1.0.md:341 FR-131: 'market-intelligence reserves commercial state for a "Commerce authority" that has no charter in this repository' · src/modules/market-intelligence/application/procurement-recommendation-service.js:9 class lives ใต้ src/modules/market-intelligence/application/ |
| **สิ่งที่ควรเป็น** | procurement-recommendation logic (BUY_NOW/BUY_MINIMUM/HOLD decisions) = Commerce/Procurement authority ควรใช้ Market read contracts จากข้างนอก |
| **สิ่งที่เป็นจริง** | ProcurementRecommendationService added โดยตรงใต้ src/modules/market-intelligence/application/ combining inventory + market price logic |
| **ข้อเสนอแนะ** | Hold service นี้นอก src/modules/market-intelligence (pending chartered Commerce/Procurement domain) หรือแก้ charter ให้ระบุว่า procurement-recommendation เป็นข้อยกเว้นที่อนุมัติแล้ว |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-01 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-04 — /market navigation was enabled (soon:false) contrary to ADR-038's 'truthful navigation' gate

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | HIGH |
| **ประเภท** | PRODUCTION_GATE_OPEN |
| **หลักฐาน** | docs/decisions/ADR-038-MARKET-INTELLIGENCE-DOMAIN-BOUNDARY.md:205 'Runtime navigation remains disabled until an implementation FR makes it truthful' · src/config/domains.js:55 key:'market', ... soon:false · src/modules/market-intelligence/components/MarketDashboard.jsx:10 page renders static fixture data |
| **สิ่งที่ควรเป็น** | ADR-038 condition enable market navigation on 'an implementation FR' making truthful |
| **สิ่งที่เป็นจริง** | Navigation flipped soon:false · dashboard (watch rules, live price feed, alerts) reflect 0 ของ FR-092 (the only implemented FR = translation ไม่ UI) |
| **ข้อเสนอแนะ** | Revert soon:true หรือ replace MarketDashboard.jsx ด้วย page reflect FR-092 เท่านั้น |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-01, D2-domain-market-intelligence-05 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-05 — MarketDashboard.jsx is fully static/mocked and calls none of the module's real services

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | HIGH |
| **ประเภท** | BROKEN_FLOW |
| **หลักฐาน** | src/modules/market-intelligence/components/MarketDashboard.jsx:3 imports useEffect ไม่เคยเรียก · src/modules/market-intelligence/components/MarketDashboard.jsx:12 watchRules seeded hardcoded useState array · src/modules/market-intelligence/components/MarketDashboard.jsx:36 observations fake relative timestamps · src/modules/market-intelligence/components/MarketDashboard.jsx:92 'New Watch Rule' button เรียก alert() |
| **สิ่งที่ควรเป็น** | Page ติดป้าย 'Live Feed' 'Lineage Integrity 100%' imply อ่าน real MarketObservation/PriceObservation/WatchRule data |
| **สิ่งที่เป็นจริง** | ทุก number = hardcoded literal · no fetch/useEffect · ไม่ import/call service ใด ๆ |
| **ข้อเสนอแนะ** | Wire page ถึง real read API (ยังไม่มี — finding 06) หรือ remove 'Live Feed' chrome |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-04, D2-domain-market-intelligence-06 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-06 — Zero API routes exist for this domain; every application service is unreachable from src/app

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | HIGH |
| **ประเภท** | MISSING_SURFACE |
| **หลักฐาน** | docs/DOMAIN-MAP.md:76 'Routes owned | 0 (0 api · 0 pages)' · src/modules/market-intelligence/application/price-intelligence-service.js:8 PriceIntelligenceService — grep src/app 0 hits · src/modules/market-intelligence/application/supplier-intelligence-service.js:7 SupplierIntelligenceService — 0 hits · src/modules/market-intelligence/application/market-research-service.js:7 MarketResearchService — 0 hits |
| **สิ่งที่ควรเป็น** | Capability shown ใน UI ควร reachable ผ่าน at least one API route |
| **สิ่งที่เป็นจริง** | ไม่มี src/app/api/market/** directory · ไม่มี route.js เรียก service ใด ๆ |
| **ข้อเสนอแนะ** | เพิ่ม API routes ใต้ src/app/api/market/** สำหรับ service แต่ละตัว following BR-009/SDD-009 pattern |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-01, D2-domain-market-intelligence-05 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-07 — Even FR-092's own translation pipeline has no production trigger — the seam is dead code outside tests

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | HIGH |
| **ประเภท** | BROKEN_FLOW |
| **หลักฐาน** | src/modules/market-intelligence/application/market-observation-service.js:67 loadTranslateAndPersistRawMarketRecord — 'preferred cross-domain entry point' · grep src/app + src/modules/agent 0 hits นอก module + test · docs/PRD-SDD-v1.0.md:302 FR-092 marked '✅ implemented' |
| **สิ่งที่ควรเป็น** | '✅ implemented' translation seam ควร invoked by something ใน running system whenever Integration writes eligible RawExternalRecord |
| **สิ่งที่เป็นจริง** | ไม่มี cron/worker/API route/webhook handler invoke translation entry points · only callers = integration tests |
| **ข้อเสนอแนะ** | เพิ่ม trigger (worker step หรือ call ภายใน Integration ingestion path) ก่อน treat FR-092 end-to-end delivered |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-06 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-16 — Every Phase 2–5 service defaults to an in-memory-only repository; no Prisma persistence exists for any of them

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | HIGH |
| **ประเภท** | PARTIAL |
| **หลักฐาน** | src/modules/market-intelligence/application/price-intelligence-service.js:85 class InMemoryPriceObservationRepository · src/modules/market-intelligence/application/price-intelligence-service.js:110 class InMemoryWatchRuleRepository · src/modules/market-intelligence/application/supplier-intelligence-service.js:37 class InMemorySupplierRepository · src/modules/market-intelligence/application/market-research-service.js:58 class InMemoryMarketResearchRepository · prisma/schema.prisma:1781 0 PriceObservation/SupplierCandidate/WatchRule/MarketResearchRun/CompetitorSignal/DemandSignal model |
| **สิ่งที่ควรเป็น** | Service for real use ต้อง persistence adapter ดังนั้น state survive process restart + share across requests |
| **สิ่งที่เป็นจริง** | ทั้ง 4 service fall back in-memory · ไม่มี Prisma-backed repository · data หายไป restart/serverless cold start |
| **ข้อเสนอแนะ** | Treat expected pre-FR prototype · ไม่ describe '✅ implemented' จนกว่า real repository ครอบคลุม per finding 01 |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-06, D2-domain-market-intelligence-01 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-08 — Charter's 'Public contract direction' names ten functions that do not exist in code under those names/signatures

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/domains/market-intelligence/CHARTER.md:81 'searchMarket(query)' — 0 export · docs/domains/market-intelligence/CHARTER.md:82 'getCurrentPrices(productRef, scope)' — 0 export · docs/domains/market-intelligence/CHARTER.md:86 'getCategorySnapshot(categoryRef, scope)' — 0 export · docs/domains/market-intelligence/CHARTER.md:87 'getCompetitorSignals(scope)' — 0 export · docs/domains/market-intelligence/CHARTER.md:88 'evaluateWatchRule(ruleId, observationId)' — actual export evaluateWatchRule(rule, observation) · src/modules/market-intelligence/application/price-intelligence-service.js:53 getPriceHistory destructured object ไม่ (productRef, scope) |
| **สิ่งที่ควรเป็น** | Charter's public contract match callable export |
| **สิ่งที่เป็นจริง** | เพียง translateRawRecordToMarketObservation loosely match · other 9 name absent หรือ renamed/reshaped |
| **ข้อเสนอแนะ** | implement thin wrapper export หรือ revise charter Public contract section describe actual API surface |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-01 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-09 — CompetitorSignal / DemandSignal are schema-only stubs, misrepresented in the commit message as delivered capabilities

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | DECLARED_NOT_BUILT |
| **หลักฐาน** | src/modules/market-intelligence/domain/market-signals.js:7 zCompetitorSignalDraft schema · src/modules/market-intelligence/domain/market-signals.js:22 zDemandSignalDraft schema · src/modules/market-intelligence/domain/market-signals.js:40 normalizeCompetitorSignalDraft — 0 caller |
| **สิ่งที่ควรเป็น** | Commit 4306a29 message 'Add CompetitorSignal and DemandSignal models with price change detection (Closes #79)' imply usable capability |
| **สิ่งที่เป็นจริง** | ไม่มี Prisma model · ไม่มี repository · ไม่มี application service · Zod validator + calculator = unit test เท่านั้น |
| **ข้อเสนอแนะ** | Build missing service/repository/consumer ใต้ reserved FR id หรือ correct record 'schema drafted not yet usable capability' |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-01 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-10 — Marketplace-listing and retail-price 'Integration adapters' are unused pure functions

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | BROKEN_FLOW |
| **หลักฐาน** | src/modules/integration/adapters/marketplace-listing-adapter.js:14 formatMarketplaceListingRawRecord — only test caller · src/modules/integration/adapters/retail-price-adapter.js:14 formatRetailPriceRawRecord — only test caller |
| **สิ่งที่ควรเป็น** | Commit d05da11 message 'Add Marketplace listing and Retail price Integration adapters (#82, #83)' imply feed real RawExternalRecord rows |
| **สิ่งที่เป็นจริง** | pure payload-formatting function ไม่มี caller ทั่ว running application · no RawExternalRecord produced นอก test |
| **ข้อเสนอแนะ** | Wire ถึง actual ingestion trigger หรือ clearly label scaffolding pending wiring ใต้ reserved FR id |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-07 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-11 — Charter has no owns_routes declaration despite naming a stable 'Target route key: market'

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | MISSING_SURFACE |
| **หลักฐาน** | docs/domains/market-intelligence/CHARTER.md:21 'Target route key: market' · docs/domains/market-intelligence/CHARTER.md:6 frontmatter has owns_models + owns_code ไม่มี owns_routes · docs/domains/agent/CHARTER.md:4 agent's charter declare 'owns_routes: - src/app/api/agent/**' |
| **สิ่งที่ควรเป็น** | Charter ตั้งชื่อ target route key + now live route ควร declare owns_routes ให้ governance track + enforce |
| **สิ่งที่เป็นจริง** | charter frontmatter ไม่มี owns_routes field · newly-wired route ไม่ใช่ governance-tracked ownership |
| **ข้อเสนอแนะ** | เพิ่ม 'owns_routes: - src/app/(pm)/market/**' ถึง charter frontmatter ในเดียวกับ slice reserve new FR ids |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-01 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-12 — Module README.md is stale — still describes a Phase 0 with no runtime code

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | src/modules/market-intelligence/README.md:5 'There is intentionally no runtime implementation in Phase 0.' · src/modules/market-intelligence/README.md:7 'Before adding JavaScript, routes, Prisma models or runtime navigation...' |
| **สิ่งที่ควรเป็น** | Module README describe pre-implementation constraints ควร update หลังจาก module มี real runtime code |
| **สิ่งที่เป็นจริง** | 16 JS/JSX file + page route + live nav entry exist · README ไม่ update |
| **ข้อเสนอแนะ** | Rewrite README.md describe current state (FR ไหน implement, phase-0 gated) |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-01 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-13 — SITEMAP-DOMAIN-NAV.md's Tier-2 domain list and FR-070 stable-ID table omit Market Intelligence entirely

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/SITEMAP-DOMAIN-NAV.md:38 Tier 2 list ไม่มี Market Intelligence · docs/SITEMAP-DOMAIN-NAV.md:49 stable-ID table ไม่มี DOM-MARKET-INTELLIGENCE · docs/domains/market-intelligence/CHARTER.md:19 charter declare 'Product domain: DOM-MARKET-INTELLIGENCE' |
| **สิ่งที่ควรเป็น** | Per SDD-040/FR-070 table = authoritative registry · domain now live ควร appear |
| **สิ่งที่เป็นจริง** | Table ไม่ update · disagree ระหว่าง live src/config/domains.js + charter |
| **ข้อเสนอแนะ** | เพิ่ม DOM-MARKET-INTELLIGENCE row (route key 'market') ถึง Tier-2 list + table docs/SITEMAP-DOMAIN-NAV.md |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-04 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-14 — INTERFACE-INVENTORY.md overstates /market's delivered capability and mis-cites it as FR-092 work

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/INTERFACE-INVENTORY.md:126 '/market | ... | real-time market price normalization, listing tracking, active watch rules, and price alerts | ... | implemented beta; ... FR-092' |
| **สิ่งที่ควรเป็น** | Interface inventory row describe page actually does attribute ถึง FR actually authorize |
| **สิ่งที่เป็นจริง** | 'real-time price normalization', 'listing tracking', 'watch rules', 'price alerts' ไม่ implement (finding 05) · FR-092 = translation เท่านั้น |
| **ข้อเสนอแนะ** | Rewrite row static mockup pending FR coverage หรือ correct หลังจาก finding 01/05/06 resolve |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-05 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-15 — No e2e/reachability test exists for the newly-enabled /market page

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | tests/unit/domain-navigation.test.js:68 assert config shape เท่านั้น · tests/e2e/navigation-reachability.spec.js:1 grep 0 'market' |
| **สิ่งที่ควรเป็น** | Per CLAUDE.md verify rule + domain newly-flipped soon:false gate /market ควร มี e2e spec หรือ addition navigation-reachability/smoke.spec.js |
| **สิ่งที่เป็นจริง** | tests/e2e ไม่มี 'market' mention · เพียง config-shape unit test |
| **ข้อเสนอแนะ** | เพิ่ม smoke/e2e case open /market assert something real ก่อน ship soon:false |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-04, D2-domain-market-intelligence-05 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-17 — Zero cross-domain consumers exist despite four declared consumer relationships in CONTEXT-MAP.md

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | MISSING_SURFACE |
| **หลักฐาน** | docs/domains/market-intelligence/CONTEXT-MAP.md:95 'Market Intelligence → Marketing' · docs/domains/market-intelligence/CONTEXT-MAP.md:103 'Market Intelligence → Business Home' · docs/domains/market-intelligence/CONTEXT-MAP.md:109 'Agent → Market Intelligence' · src/app/(pm)/market/page.jsx:1 grep exactly one file import |
| **สิ่งที่ควรเป็น** | Per context map Marketing, Business Home, Commerce/Procurement, Agent ควร consume domain's read contracts |
| **สิ่งที่เป็นจริง** | ไม่มี file src/modules/agent, src/app/(pm)/growth หรือ Business-Home import |
| **ข้อเสนอแนะ** | Track expected-but-unbuilt · ไม่ allow generated docs imply integration exist จนกว่า at least one consumer contract wired |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-08 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-18 — SupplierIntelligenceService accepts but never uses its observation-evidence dependency

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | PARTIAL |
| **หลักฐาน** | src/modules/market-intelligence/application/supplier-intelligence-service.js:8 constructor({ supplierRepo = null, priceObservationRepo = null } = {}) · src/modules/market-intelligence/application/supplier-intelligence-service.js:10 this.priceObservationRepo stored ไม่ read · docs/domains/market-intelligence/CHARTER.md:96 Evidence invariant |
| **สิ่งที่ควรเป็น** | calculateSupplierScore 'Evidence Volume' compute จาก real linked price/listing observations |
| **สิ่งที่เป็นจริง** | listSupplierCandidates/getRankedSuppliersForProduct call calculateSupplierScore no observations · score fall back candidate.reviewCount (self-reported) · priceObservationRepo dead code |
| **ข้อเสนอแนะ** | implement observation lookup (query priceObservationRepo) หรือ remove unused constructor parameter |
| **เกี่ยวข้อง** | (none) |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-19 — ROADMAP.md has no task entries for the five delivery-sequence slices actually shipped

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/roadmap/ROADMAP.md:259 TASK-FR-092 เท่านั้น · grep #77–#84 0 rows |
| **สิ่งที่ควรเป็น** | docs/roadmap/ROADMAP.md read GoVibe Mission Control ว่า live delivery-state · shipped slice ควร มี task row |
| **สิ่งที่เป็นจริง** | เพียง FR-092 tracked · Price/Watch, Supplier, Competitor/Demand, Market Research, Procurement ไม่มี roadmap visibility |
| **ข้อเสนอแนะ** | เพิ่ม TASK row หลังจาก FR ids reserved (finding 01) |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-01, D2-domain-market-intelligence-02 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-20 — market-observation-service.js is missing its @tested annotation

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | src/modules/market-intelligence/application/market-observation-service.js:6 header carry '@req FR-092, NFR-018' + '@spec BR-019, SDD-049, SEC-017, ADR-038' ไม่มี @tested · tests/unit/market-intelligence/market-observation-service.test.js:1 test file exist ไม่ reference |
| **สิ่งที่ควรเป็น** | Per AGENTS.md convention ทุก non-trivial source file carry @req/@spec/@tested |
| **สิ่งที่เป็นจริง** | File มี @req/@spec ไม่มี @tested tag ถึงแม้ dedicated unit test exist |
| **ข้อเสนอแนะ** | เพิ่ม '// @tested tests/unit/market-intelligence/market-observation-service.test.js' ถึง file header |
| **เกี่ยวข้อง** | (none) |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-market-intelligence-21 — SupplierIntelligenceService.getRankedSuppliersForProduct silently ignores its productQuery parameter

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | PARTIAL |
| **หลักฐาน** | src/modules/market-intelligence/application/supplier-intelligence-service.js:26 async getRankedSuppliersForProduct({ tenantId, businessId = null, productQuery }) productQuery destructured ไม่ read · src/modules/market-intelligence/application/supplier-intelligence-service.js:49 InMemorySupplierRepository.list({ tenantId, businessId, category }) ไม่มี productQuery |
| **สิ่งที่ควรเป็น** | Method getRankedSuppliersForProduct(productQuery) ควร rank/filter supplier สำหรับ named product |
| **สิ่งที่เป็นจริง** | return ทุก supplier candidate ร่วม rank · productQuery dead code · no service-level test |
| **ข้อเสนอแนะ** | filter supplierRepo.list() results product/category match productQuery ก่อน scoring หรือ rename method/drop parameter + add service-level test |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-16, D2-domain-market-intelligence-18 |
| **การตรวจสอบ** | verifier-added |

##### D2-domain-market-intelligence-22 — No application service in market-intelligence records an audit event on write

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | src/modules/market-intelligence/application/market-observation-service.js:1 grep 'audit' 0 hit ถึงแม้ = module's persisted FR-092 write path · src/modules/market-intelligence/application/price-intelligence-service.js:1 recordPriceObservation/save ไม่ audit · src/modules/market-intelligence/application/supplier-intelligence-service.js:12 recordSupplierCandidate ไม่ audit · src/modules/crm/reply-record-service.js:3 comparison: domain write service import recordAudit call |
| **สิ่งที่ควรเป็น** | Per CLAUDE.md convention ทุก write application/ service record audit event |
| **สิ่งที่เป็นจริง** | ทั้ง 4 market-intelligence application service ไม่เรียก audit function — ไม่แม้ Prisma-backed FR-092 write path |
| **ข้อเสนอแนะ** | Wire recordAudit ถึง market-observation-service.js persistence path ตอนนี้ extend other service หลังจาก real persistence + routes |
| **เกี่ยวข้อง** | D2-domain-market-intelligence-16, D2-domain-market-intelligence-06 |
| **การตรวจสอบ** | verifier-added |

##### D2-domain-market-intelligence-23 — CHARTER.md missing Version/Status control block (shared debt across all 8 domain charters)

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | grep -cE '^version:\|^status:' docs/domains/market-intelligence/CHARTER.md = 0; เหมือนกันทั้ง 8 charter (agent, crm, identity, integration, knowledge, market-intelligence, platform-control, project-manager) |
| **สิ่งที่ควรเป็น** | ทุก charter ควรมี Version/Status control block ตาม convention ของโปรเจกต์ |
| **สิ่งที่เป็นจริง** | Key นี้ไม่มีในทั้ง 8 charter — ก่อนหน้านี้รายงานเฉพาะ crm (INFO), identity (LOW), integration (INFO), project-manager (LOW) เท่านั้น ทำให้ market-intelligence ดูเหมือนปฏิบัติตาม convention นี้แล้วทั้งที่ไม่ใช่ |
| **ข้อเสนอแนะ** | เพิ่ม Version/Status frontmatter ให้ครบทั้ง 8 charter ในการแก้ไขครั้งถัดไป |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | critic-added |

#### ข้อจำกัดการตรวจ

**เครื่องมือ**: Read-only mandate honored — `npm run docs:graph`/`preflight`/tests ไม่ run · ใช้ committed docs/.doc-graph.json, docs/.preflight-report.json, existing test file instead · ไม่ run integration tests หรือ prisma migration verify (relied on schema file direct inspection + test files read)

**ช่วง**: Read in full — docs/domains/market-intelligence/CHARTER.md, CONTEXT-MAP.md, SRS.md targeted sections, FR-092-market-translation-core.md feature note, README.md · ทั้ง 16 file ใต้ src/modules/market-intelligence/** (6 application, 6 domain, 3 infrastructure, 1 component) · cross-checked against docs/PRD-SDD-v1.0.md (FR-090..FR-098, FR-130..FR-132, NFR-018, BR-019, SDD-040/049, SEC-017), FEATURE-MAP/TRACE/DOMAIN-MAP/INTERFACE-INVENTORY/ROUTES-SITEMAP/SITEMAP-DOMAIN-NAV/roadmap/ROADMAP.md, ADR-038, docs/.preflight-report.json, docs/.id-ledger.json, prisma/schema.prisma + schema.postgres.prisma, src/config/domains.js, src/app/(pm)/market/page.jsx, repo-wide grep ทุก exported symbol/class + `from '@/modules/market-intelligence` importer

**ไม่ทำ**: ไม่ open src/modules/identity/agent-tool-authorizer.js หรือ Integration adapter test ทั้งหมด (แต่ header/signature ทำ) · ไม่ read ทุก 16 test file line-by-line · sampled price-intelligence-service.test.js, procurement-recommendation.test.js, market-intelligence-schema-migration.test.js, market-intelligence-persistence.test.js full/substantial, others listed มี

**Verifier strategy**: reproduce ทั้ง 20 finder finding ใต้ cited file/line · verify quoted string byte-exact ใน repo (SRS sequence, FR-092 disclaimer, ADR-038 truthful navigation, FR-131 Commerce quote, commit message d05da11/4306a29 including #77–#84, DOMAIN-MAP Routes owned | 0, alert('New Watch Rule Modal'), missing @tested tag) · 0 evidence contradicting · 19/20 CONFIRMED · 1 (D2-01) ADJUSTED (severity HIGH, governance lapse ไม่ BR/SEC/SDD-009 pipeline/audit violation) · 2 new finding (21, 22) well-evidenced distinct · stopped at 2 rather than padding

## domain-platform-control

### domain-platform-control

#### สรุปย่อ

- **ขอบเขต**: โดเมนนี้เป็นหน่วยน้อยที่สุดในระบบ ครอบครอง 1 FR (FR-105), 1 เส้นทาง (/control/roadmap), ศูนย์โมเดล, ศูนย์เส้นทาง API โดยการออกแบบ
- **สิ่งที่ครบถ้วน**: เส้นทางผลิตภาพนิมนต์อ่านอย่างเดียว (read-only) ดำเนิน, รักษาความปลอดภัย SEC-020 ตัดสินใจสำหรับ isInstallationOperator, ไม่มีเพิ่มขึ้น (no writes) โดยการออกแบบ, การสนับสนุนข้อตกลงข้ามโดเมน identity ได้รับการทดสอบ
- **ช่องว่างการเป็นเจ้าของ**: src/lib/platform-control-guard.js และ src/app/(control)/layout.jsx ทั้งสองนำ @req FR-105 แต่อยู่นอกรายการ owns_code/owns_routes ของทุกโดเมน — ประเมินอยู่ที่ 5 ไฟล์ แต่จริง ๆ แล้วเป็น 7 ไฟล์ใน docs/.domain-state.json
- **ช่องว่างการทดสอบ**: ไม่มีการทดสอบ e2e หรือ integration ที่ใช้ PlatformControlGuard.jsx จริงฯลฯ — เพียงแต่การทดสอบสตริงและฟังก์ชันบริสุทธิ์เท่านั้น
- **การจัดการข้อผิดพลาด**: catch-all ทั่วไปในการรักษาความปลอดภัยซ่อน 503 SESSION_UNAVAILABLE เหมือนกับ 401 AUTH_REQUIRED — ไม่มีการบันทึก ผู้ดำเนินการจะไม่เห็นเครื่องหมายว่ามี outage การรักษาความปลอดภัย
- **ความเสื่อมของเอกสาร**: ตัวสแนปชอต PROGRAMME_* ซิงค์ด้วยตนเองจากเอกสารอ้างอิง (v0.2.0→v0.3.0), ไม่มีการตรวจสอบอัตโนมัติสำหรับการแตกหักในอนาคต ADR-048 พูดถึงรหัส commit เก่า, INTERFACE-INVENTORY.md บอกว่า "implemented locally" หลังจากการปรับใช้ production

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|---------|---------|----------|
| prisma model ownership (owns_models) | IMPLEMENTED | docs/domains/platform-control/CHARTER.md — zero models by design | ไม่มีการอ้างอิง prisma ใน src/modules/platform-control, shells, guard; PlatformGrant มีเจ้าของโดยถูกต้องจาก identity |
| owns_routes glob src/app/(control)/control/** | PARTIAL | docs/domains/platform-control/CHARTER.md:6; src/app/(control)/control/roadmap/page.jsx | page.jsx ตรงกับ glob; layout.jsx ไม่ถูกเลือกว่าเป็นโหนดเส้นทาง (scripts/doc-graph.mjs:271 กรองเฉพาะ page.jsx/route.js) |
| route /control/roadmap (FR-105) | IMPLEMENTED | src/app/(control)/control/roadmap/page.jsx; ProgramRoadmapBoard.jsx | ปรับใช้ production 2026-08-27 |
| PlatformControlShell.jsx | IMPLEMENTED | src/components/layouts/PlatformControlShell.jsx | เปลือกส่วนควบคุมแพลตฟอร์ม |
| PlatformControlGuard.jsx (server component) | IMPLEMENTED | src/components/layouts/PlatformControlGuard.jsx | ห่อ resolvePlatformControlDecision; ทดสอบโดยอ้อมเท่านั้นผ่านการยืนยันสตริง ไม่ได้รัน |
| src/lib/platform-control-guard.js (resolvePlatformControlDecision) | PARTIAL | src/lib/platform-control-guard.js:1-19 | ไฟล์นำ @req FR-105 แต่ไม่อยู่ใต้ owns_code ของโดเมนใด — ช่องว่างความเป็นเจ้าของ |
| isInstallationOperator cross-domain dependency | IMPLEMENTED | src/modules/identity/viewer-authority.js:87-89; src/lib/platform-control-guard.js:5 | สัญญาส่วนสาธารณะ ส่วนที่ใช้ถูกต้อง |
| API routes owned by platform-control | MISSING | docs/domains/platform-control/CHARTER.md | โดยการออกแบบ — FR-105 ไม่มีเขียน ไม่เปิดเผย API |
| Public contract exports | IMPLEMENTED | grep -rln "modules/platform-control" src/ → เฉพาะ roadmap/page.jsx | ไม่มีโดเมนอื่นใช้; charter ถูกต้องไม่มี 'Public contract' |
| PlatformControlShell/Guard ownership vs project-manager's glob | PARTIAL | project-manager/CHARTER.md:8 vs platform-control/CHARTER.md:9-10 | ทับซ้อน glob ไม่ถูกบังคับใช้ โดยการทำให้เครื่องมือ |
| Unit test coverage | IMPLEMENTED | tests/unit/platform-control-guard.test.js; tests/unit/platform-control-route-contract.test.js | ฟังก์ชันแยก + การยืนยันสัญญา static |
| Integration test coverage | MISSING | find tests/integration — ไม่มีผลลัพธ์ | ไม่มีการทดสอบ integration |
| E2E test coverage | MISSING | 23 spec files ใน tests/e2e — ไม่มีการอ้างอิง control/roadmap | ไม่มี e2e ที่ใช้เส้นทาง |
| Business navigation registry exclusion | IMPLEMENTED | src/config/domains.js:40-75 — ไม่มี 'platform-control' | ตรงกับการห้ามอย่างชัดแจ้ง ADR-048 D1 |
| Removal contract clarity | PARTIAL | docs/domains/platform-control/CHARTER.md:32-34 | ไม่ตั้งชื่อ platform-control-guard.js ซึ่งจะถูกละทิ้งแบบไร้เจ้าของ |
| PROGRAMME_* data sync status | PARTIAL | src/modules/platform-control/program-roadmap-data.js:1-14 vs docs/roadmap/ROADMAP-zuri-ai-24w-program.md | ซิงค์ด้วยตนเองแล้ว v0.2.0→v0.3.0; ไม่มีการตรวจสอบอัตโนมัติ |
| ADR-048 currency | IMPLEMENTED | docs/decisions/ADR-048-PLATFORM-CONTROL-SHELL.md | D1-D4 ตรงกับโค้ด ยกเว้นรหัส commit illustrative เก่า |
| FR-105 registry/TRACE/FEATURE-MAP consistency | IMPLEMENTED | PRD-SDD:315; TRACE:837; FEATURE-MAP:120; DOMAIN-MAP:79-86; ROADMAP:244 | ✅/done ที่สอดคล้องกัน |
| docs/.domain-state.json consistency | PARTIAL | .domain-state.json:1705-1716 (codeCount:5) vs :6885-6917 (codeCount:7) | ช่องว่าง 2 ไฟล์ traces ไปยัง owns_code gaps |
| INTERFACE-INVENTORY.md deployment status | PARTIAL | INTERFACE-INVENTORY.md:192 vs PRD-SDD:315 | "implemented locally" vs production deployment 2026-08-27 |
| resolvePlatformControlDecision LOADING state | PARTIAL | src/lib/platform-control-guard.js:15; PlatformControlGuard.jsx:15-24 | สาขา dead สำหรับผู้เรียกใช้เดียวเท่านั้น |
| Charter frontmatter schema | PARTIAL | CHARTER.md:1-11 — ไม่มี owns_models key | ขาดตัวบ่งชี้ชัดแจ้ง vs agent/knowledge charters |

#### Findings

##### D2-domain-platform-control-01 — Charter's owns_code list omits the two files that implement the domain's actual guard logic

| ฟิลด์ | รายละเอียด |
|------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | docs/domains/platform-control/CHARTER.md:7 (owns_code ระบุเฉพาะ 3 รายการ); src/lib/platform-control-guard.js:1 (@req FR-105, resolvePlatformControlDecision — predicates isOperator); src/app/(control)/layout.jsx:4 (@req FR-105, mounts guard+shell สำหรับ /control/**); scripts/doc-graph.mjs:271 (route nodes = page.jsx, route.js เท่านั้น, layout.jsx หายไป); scripts/domain-state.mjs:169 (domainCodeIds ไม่ตรงกับ src/lib/ ไฟล์); docs/.domain-state.json:1712 vs :6908 (codeCount 5 vs 7) |
| **สิ่งที่ควรเป็น** | ไฟล์ทั้งหมดที่นำ @req FR-105 ต้องถูกจัดอยู่ใน owns_code/owns_routes เพื่อให้ footprint นับถูกต้อง และให้การแก้ไข cross-domain ถูกจับว่าเป็นการละเมิดขอบเขต |
| **สิ่งที่เป็นจริง** | src/lib/platform-control-guard.js (ตัดสินใจ isOperator — แก่นของ ADR-048 D2/SEC-020) และ src/app/(control)/layout.jsx อยู่นอกทุก charter ของระบบ; ผลลัพธ์ที่มองเห็นได้คือช่องว่าง codeCount 5 vs 7 ใน docs/.domain-state.json เท่านั้น |
| **ข้อเสนอแนะ** | เพิ่ม src/lib/platform-control-guard.js และ src/app/(control)/layout.jsx ไปยัง owns_code ใน CHARTER.md หรือขยาย doc-graph.mjs เพื่ออนุญาต layout.jsx nodes ใน owns_routes globs; รีรัน npm run docs:graph และยืนยัน codeCount converge ที่ 7 |
| **เกี่ยวข้อง** | D2-domain-platform-control-02 |
| **การตรวจสอบ** | ADJUSTED (severity HIGH → MEDIUM: drift ภายใน docs/.domain-state.json เท่านั้น ไม่มี developer-facing view ผิด ไม่มี security harm) |

##### D2-domain-platform-control-02 — project-manager's owns_code glob silently overlaps platform-control's two explicitly-owned shell files

| ฟิลด์ | รายละเอียด |
|------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | project-manager/CHARTER.md:8 (owns_code glob `src/components/layouts/**`); platform-control/CHARTER.md:9-10 (explicit PlatformControlShell.jsx, PlatformControlGuard.jsx); docs/.domain-state.json:6896 (FR-105 contributorDomains ["platform-control","project-manager"] — project-manager เพิ่มเติมจาก glob เท่านั้น); scripts/doc-preflight.mjs:306 (เช็ค owns_models duplicate เท่านั้น ไม่มี owns_code glob collision) |
| **สิ่งที่ควรเป็น** | Charter invariant ('preflight enforces lanes') ต้องห้าม code file ถูกอ้าง 2 charters; platform-control's removal contract บอกว่าเป็น self-contained |
| **สิ่งที่เป็นจริง** | project-manager's broad glob + platform-control's explicit two-file list ตรง; FR-105 บันทึก project-manager เป็น contributorDomain; ProductReadinessDashboard.jsx:116 render 'Contributes: Project Manager' badge ปลอม บน FR-105 card |
| **ข้อเสนอแนะ** | ลดรูป project-manager CHARTER.md owns_code เพื่ออ除ยกเว้น PlatformControl*.jsx หรือเพิ่ม preflight check ใน doc-preflight.mjs ที่แฟลก code_file ถูกอ้างโดย >1 charter |
| **เกี่ยวข้อง** | D2-domain-platform-control-01 |
| **การตรวจสอบ** | CONFIRMED (ยิ่งไปกว่าที่พบ: ผลลัพธ์เห็นได้จริงบนแดชบอร์ด FR-124) |

##### D2-domain-platform-control-07 — No automated check keeps the shipped PROGRAMME_* snapshot in sync with its declared source document

| ฟิลด์ | รายละเอียด |
|------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | src/modules/platform-control/program-roadmap-data.js:5-8 (header: 'Re-projected 2026-08-26 v0.2.0→v0.3.0' — manual sync); docs/roadmap/ROADMAP-zuri-ai-24w-program.md:12 (source_of_truth: false); tests/unit/platform-control-route-contract.test.js:26 (เช็ค array lengths เท่านั้น ไม่ version/status/updated/baselineCommit); scripts/doc-preflight.mjs (ไม่มี 'program-roadmap' tie) |
| **สิ่งที่ควรเป็น** | ให้ source .md เปลี่ยน (version, task list) โดยไม่มี re-projection จะต้องถูกจับ เพราะเพจเห็น .js ใน deployed board เท่านั้น |
| **สิ่งที่เป็นจริง** | ซิงค์จาก .md → .js เป็นการ manual ดำเนินการแล้ว 1 ครั้ง และไม่มีการ tie อัตโนมัติสำหรับการแตกหักในอนาคต |
| **ข้อเสนอแนะ** | เพิ่มการทดสอบ unit ที่ parse YAML frontmatter ของ ROADMAP-zuri-ai-24w-program.md และยืนยัน PROGRAMME_SNAPSHOT.version/status/updated/baselineCommit ตรงกัน |
| **เกี่ยวข้อง** | D2-domain-platform-control-06 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-platform-control-03 — No integration or e2e test exercises the real PlatformControlGuard component or the full /control/roadmap request path

| ฟิลด์ | รายละเอียด |
|------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | tests/unit/platform-control-guard.test.js:8 (เรียก resolvePlatformControlDecision direct ด้วย hand-built viewers ไม่ PlatformControlGuard.jsx); tests/unit/platform-control-route-contract.test.js:16 (string matching source text ไม่ execute); src/components/layouts/PlatformControlGuard.jsx:8 (cookie serialization, try/catch, redirect/notFound ไม่ได้ run); tests/e2e (ไม่มีการอ้างอิง control/roadmap) |
| **สิ่งที่ควรเป็น** | เส้นทาง security model 'guard ทำงานก่อนเรนเดอร์' ต้องมี e2e ทดสอบเนื่องจาก anonymous (redirect /login) / authenticated non-op (404) / operator (render board) |
| **สิ่งที่เป็นจริง** | ทดสอบหยุดที่ฟังก์ชัน pure และ string matching; React Server Component (cookie, error, redirect/notFound calls) มี zero proof |
| **ข้อเสนอแนะ** | เพิ่ม tests/e2e/fr105-platform-control.spec.js ตาม pattern fr123-plugin-consent.spec.js |
| **เกี่ยวข้อง** | D2-domain-platform-control-04, D2-domain-platform-control-09 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-platform-control-09 — The guard collapses a genuine session-store outage into the same silent redirect as an ordinary logged-out visit

| ฟิลด์ | รายละเอียด |
|------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | PARTIAL |
| **หลักฐาน** | src/components/layouts/PlatformControlGuard.jsx:15 (try/catch ทั้งหมด → viewerError เดียว ไม่มี status inspection); src/modules/identity/request-viewer.js:16 (resolvePlatformControlDecision โยน httpError(401) หรือ httpError(503) — ความล้มเหลว 2 ชนิด); src/lib/platform-control-guard.js:15 (treat viewerError = AUTH_REQUIRED redirect ทั้งสอง 401/503); tests/unit/platform-control-guard.test.js:15 (test viewerError pass string 'unavailable' ไม่ httpError shape) |
| **สิ่งที่ควรเป็น** | Security route (SEC-020) ต้องให้ operator แยก 'not logged in' จาก 'identity service down' — ต่างวิธีแก้; ต้องมี logging observable สำหรับ outage นี้ |
| **สิ่งที่เป็นจริง** | AUTH_REQUIRED (401) และ SESSION_UNAVAILABLE (503) normalize ทั้งคู่ → redirect /login ไม่มี logging; outage สิ่งก่อสร้าง ≡ logged-out visit สำหรับ operator และมนิเตอร์ |
| **ข้อเสนอแนะ** | Forward distinction (return separate 'UNAVAILABLE' state + retry-later message) หรือ log caught error's status/message ใน catch block PlatformControlGuard.jsx เพื่อให้ 503 observable |
| **เกี่ยวข้อง** | D2-domain-platform-control-03 |
| **การตรวจสอบ** | verifier-added |

##### D2-domain-platform-control-04 — The guard's documented and tested 'loading' state is dead code for the only real caller

| ฟิลด์ | รายละเอียด |
|------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | src/lib/platform-control-guard.js:14 (viewerLoading = false → {state:'LOADING'}); src/components/layouts/PlatformControlGuard.jsx:15 (เรียก resolvePlatformControlDecision({viewer, viewerError}) ไม่ viewerLoading, server component ไม่มี loading phase); src/components/layouts/BusinessShellGuard.jsx:27 (client component ผ่า viewer.loading จริง); docs/INTERFACE-INVENTORY.md:192 ('loading' ระบุเป็น required state) |
| **สิ่งที่ควรเป็น** | State ที่ document และ test ต้องถูก reach โดยผู้เรียกจริง |
| **สิ่งที่เป็นจริง** | LOADING unreachable สำหรับ /control/roadmap; parameter copy จาก BusinessShellGuard pattern ที่ยังเป็น client |
| **ข้อเสนอแนะ** | ลบ viewerLoading parameter หรือเพิ่ม code comment ว่าสาขา dead และปรับ INTERFACE-INVENTORY.md ให้ระบุ 3 states เท่านั้น |
| **เกี่ยวข้อง** | D2-domain-platform-control-03 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-platform-control-05 — INTERFACE-INVENTORY.md still calls the route 'implemented locally' after PRD-SDD records a production deployment

| ฟิลด์ | รายละเอียด |
|------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/INTERFACE-INVENTORY.md:192 ('implemented locally' — เพียง occurrence เฉพาะ); docs/PRD-SDD-v1.0.md:315 ('✅ implemented; deployed to production 2026-08-27'); INTERFACE-INVENTORY.md:3 (last_update 2026-08-18 = 9 วันก่อน deployment) |
| **สิ่งที่ควรเป็น** | Status phrasing ต้องไม่ contradict ระหว่าง cross-referenced docs |
| **สิ่งที่เป็นจริง** | Inventory "locally" vs PRD "production" |
| **ข้อเสนอแนะ** | ปรับ INTERFACE-INVENTORY.md:192 ว่า 'implemented; deployed to production 2026-08-27' และ bump last_update |
| **เกี่ยวข้อง** | |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-platform-control-06 — ADR-048's illustrative baseline commit no longer matches the shipped snapshot

| ฟิลด์ | รายละเอียด |
|------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/decisions/ADR-048-PLATFORM-CONTROL-SHELL.md:67 (D3 state 'baseline commit (`6ad6ae9`)'); src/modules/platform-control/program-roadmap-data.js:14 (baselineCommit: '7d8c9d0' + header 're-projected 2026-08-26 v0.2.0→v0.3.0'); ADR-048:92 (CHANGELOG มีแค่ 1.0.0 entry ไม่ record re-projection) |
| **สิ่งที่ควรเป็น** | ADR's illustrative facts ต้อง traceable หรือมี changelog entry สำหรับ re-projection |
| **สิ่งที่เป็นจริง** | Baseline commit hash (6ad6ae9) ไม่ match shipped (7d8c9d0) ไม่มี note |
| **ข้อเสนอแนะ** | เพิ่ม ADR-048 CHANGELOG row 1.1.0 สำหรับ 2026-08-26 re-projection หรือ rephrase D3 generically |
| **เกี่ยวข้อง** | D2-domain-platform-control-07 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-platform-control-08 — Charter omits an explicit owns_models: [] declaration

| ฟิลด์ | รายละเอียด |
|------|-----------|
| **ระดับ** | INFO |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/domains/platform-control/CHARTER.md:1-11 (ไม่มี owns_models key); docs/domains/agent/CHARTER.md:3, docs/domains/knowledge/CHARTER.md:3 (explicit owns_models: []); docs/.preflight-report.json:145 (I12 info-level flag ขาด Version/Status) |
| **สิ่งที่ควรเป็น** | Consistency กับ other model-less domains explicit declaration |
| **สิ่งที่เป็นจริง** | Key absent ไม่ present-and-empty |
| **ข้อเสนอแนะ** | เพิ่ม owns_models: [] ไปยัง frontmatter ที่ next revision ควบคู่กับ fix Version/Status (I12) |
| **เกี่ยวข้อง** | |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-platform-control-10 — Charter missing Version/Status control block (shared debt across all 8 domain charters)

| ฟิลด์ | รายละเอียด |
|------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | grep -cE '^version:\|^status:' docs/domains/platform-control/CHARTER.md = 0; เหมือนกันทั้ง 8 charter (agent, crm, identity, integration, knowledge, market-intelligence, platform-control, project-manager) |
| **สิ่งที่ควรเป็น** | ทุก charter ควรมี Version/Status control block ตาม convention ของโปรเจกต์ |
| **สิ่งที่เป็นจริง** | Key นี้ไม่มีในทั้ง 8 charter — ก่อนหน้านี้รายงานเฉพาะ crm (INFO), identity (LOW), integration (INFO), project-manager (LOW) เท่านั้น ทำให้ platform-control ดูเหมือนปฏิบัติตาม convention นี้แล้วทั้งที่ไม่ใช่ |
| **ข้อเสนอแนะ** | เพิ่ม Version/Status frontmatter ให้ครบทั้ง 8 charter ในการแก้ไขครั้งถัดไป |
| **เกี่ยวข้อง** | D2-domain-platform-control-08 |
| **การตรวจสอบ** | critic-added |

#### ข้อจำกัดการตรวจ

โดเมนนี้ได้รับการตรวจสอบใน read-only mode บนต้นไม้ที่ commit 4306a29 ตามนโยบาย workflow งานนี้ — ไม่มีการรัน test หรือ build มีการเปิดอ่าน file ทุกไฟล์ใน src/modules/platform-control/**, src/app/(control)/** route, src/components/layouts/PlatformControl*.jsx, src/lib/platform-control-guard.js, tests/unit/platform-control-*.test.js (ทั้งหมด 2 ไฟล์), feature note FR-105, CHARTER.md, ADR-048 ทั้งหมดในเต็มจำนวน รวมทั้งตำแหน่งที่เกี่ยวข้องใน docs/PRD-SDD-v1.0.md, docs/TRACE.md, docs/FEATURE-MAP.md, docs/DOMAIN-MAP.md, docs/roadmap/ROADMAP.md, INTERFACE-INVENTORY.md, docs/.domain-state.json, ROADMAP-zuri-ai-24w-program.md (declared non-authoritative source), identity's public contracts (isInstallationOperator, resolveRequestViewer) สำหรับยืนยันข้ามโดเมนและความเป็นเจ้าของ model prisma/schema.prisma (confirmed PlatformGrant ∈ identity), scripts/doc-graph.mjs, scripts/domain-state.mjs, scripts/doc-preflight.mjs สำหรับเข้าใจว่า governance check มีอะไร แต่มีอะไรไม่มี ไม่มีการเข้าถึง tests/integration หรือ tests/e2e full execution — listed only; ไม่มี CI/CD workflow analysis โดเมนนี้มีขนาดเล็กที่สุด (1 FR, 1 route, 0 models, 0 API, 0 writes) ดังนั้น inventory items ที่มีโครงสร้างทั่วไป (data flow guards, model boundary checks, multi-write transactions) จึง N/A rather than gaps; total findings 9 (0 dropped) ordered by severity: MEDIUM(5) → LOW(3) → INFO(1)

## domain-project-manager

### domain-project-manager

#### สรุปย่อ

- Domain มี 30 models และ ~40 page.jsx routes บวก 82 API routes ครบ ทั้ง Portfolio/Tenant/LegalEntity จนถึง AuditEvent ถูก implement แล้ว
- **ขาด (HIGH)**: owns_routes glob catch-all `src/app/(pm)/**` ดูดซับหน้า CRM (FR-091, Conversation Inbox), Market Intelligence, Identity (FR-038 users) ขัดกับ CHARTER boundary text "Does not touch CRM's Conversation/Message"
- **ขาด (HIGH)**: FEAT-002 (Business Home) registry status ยังอยู่ 'building' แม้ว่า FR-041/060 verified ✅ 100% — ทำให้ /platform/product-readiness รายงานข้อมูลเท็จ (green number that lies)
- **ขาด (MEDIUM)**: 9 feature notes สถานะเก่า Candidate/Proposed/Declared ขัดกับ PRD/TRACE ที่ ✅; Portfolio/Membership เขียนข้ามโดเมนแต่ไม่ระบุใน charter exceptions
- **ปัญหา**: FileLink/PlanImportReceipt write-only; FR-063 Project Board ไม่มี e2e test; 7 pages swallow mutation errors
- **ขาด (MEDIUM)**: `POST /api/import/bundle/{dry-run,commit}` (FR-108 ExecutionPlanBundle intake, ✅ 2026-08-27 ตาม PRD) ไม่มี UI consumer ที่ไหนเลยในแอป — Public contract ที่ charter ประกาศไว้เอง (`EXECUTION-PLAN-BUNDLE.md`, ADR-049) และ pipeline BR-009/SDD-009 ไม่เคยถูกตรวจสอบกับโค้ดจริงในหน่วยนี้
- **ขาด (MEDIUM)**: ไฟล์ component/view 7 ไฟล์ใน src/modules/project-manager ไม่มี annotation `@req` เลย — รวมถึง PlanImportPanel.jsx ซึ่งเป็น browser surface เดียวของ FR-018/FR-065 intake

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|---|---|---|---|
| **Models — Scope (Portfolio ↔ Workspace)** |
| Model: Portfolio | IMPLEMENTED | scope-service.js:105 writer | identity/onboarding-service.js:212 bypasses scope-service; see finding 03 |
| Model: Tenant | IMPLEMENTED | scope-service.js:118 writer | |
| Model: LegalEntity | IMPLEMENTED | scope-service.js:130 writer | |
| Model: LegalEntityIdentifier | DECLARED_ONLY | schema.prisma:82–95 | zero find/create/update; backup-service.js only; see finding 10 |
| Model: Business | IMPLEMENTED | scope-service.js:153 writer | |
| Model: Branch | IMPLEMENTED | scope-service.js:265 writer | |
| Model: Workspace | IMPLEMENTED | scope-service.js:272,331,347 writer | |
| **Models — Project & Roadmap** |
| Model: Project | IMPLEMENTED | project-service.js:148,194,220 writer | |
| Model: BusinessRoadmap | IMPLEMENTED | business-strategy-mutation-service.js writer | |
| Model: BusinessRoadmapHorizon | IMPLEMENTED | business-strategy-mutation-service.js writer | |
| Model: BusinessGoal | IMPLEMENTED | business-strategy-mutation-service.js writer | |
| Model: ProjectGoal | IMPLEMENTED | business-strategy-mutation-service.js, plan-import-service.js writer | |
| **Models — Work Breakdown** |
| Model: Workstream | IMPLEMENTED | project-service.js, progress-service.js writer | laneId declared-only; see finding 11 |
| Model: WorkContainer | IMPLEMENTED | work-service.js, plan-import-service.js writer | |
| Model: WorkItem | IMPLEMENTED | work-service.js writer | |
| Model: Milestone | IMPLEMENTED | milestone-gate-service.js writer | |
| Model: Gate | IMPLEMENTED | milestone-gate-service.js writer | |
| Model: Dependency | IMPLEMENTED | dependency-service.js, bundle-commit-service.js, plan-import-service.js writer | |
| **Models — File & Repository** |
| Model: Repository | IMPLEMENTED | repository-service.js writer | bespoke externalRepoId column; see finding 12 |
| Model: ProjectRepository | IMPLEMENTED | repository-service.js, plan-import-service.js writer | |
| Model: ProjectFile | IMPLEMENTED | project-file-service.js writer | |
| Model: LocalWorkspaceMount | IMPLEMENTED | backup-service.js, file-asset-service.js writer | |
| Model: FileAsset | IMPLEMENTED | file-asset-service.js, backup-service.js writer | |
| Model: FileLink | PARTIAL | file-asset-service.js:123,296 writer | zero find*; see finding 09 |
| **Models — Team & Access** |
| Model: Team | IMPLEMENTED | team-service.js writer (FR-089) | grants nothing per BR-018 |
| Model: TeamMembership | IMPLEMENTED | team-service.js writer | |
| Model: ProjectTeam | IMPLEMENTED | team-service.js writer | |
| Model: Membership | PARTIAL | project-team-service.js writer | identity/profile-permission-service.js:145 bypasses; see finding 04 |
| **Models — Audit & Import** |
| Model: AuditEvent | IMPLEMENTED | audit.js sole creator | documented shared-write exception (CHARTER.md:111–113) |
| Model: PlanImportReceipt | IMPLEMENTED | plan-import-service.js:380, bundle-receipt.js:55 writer | idempotency only; see finding 16 |
| **Satellite Modules** |
| business (read-only) | IMPLEMENTED | business-strategy-service.js | zero write calls confirmed |
| people (read-only) | IMPLEMENTED | people-service.js | zero write calls confirmed |
| **Public Contracts & Exports** |
| scope-service (createPortfolio/Tenant/Business + resolution) | IMPLEMENTED | scope-service.js:99,112,145,68,371,387 | bypassed by identity (finding 03) |
| contracts/plan-envelope.schema.json | IMPLEMENTED | 16760 bytes | |
| contracts/execution-plan-bundle.schema.json | IMPLEMENTED | 7486 bytes; consumed by bundle-commit-service.js | |
| components/useApi.js (undeclared de facto export) | BUILT_NOT_DECLARED | imported by 4 identity entry pages | see finding 05 |
| **Routes & Pages** |
| owns_routes glob `src/app/(pm)/**` + `src/app/api/**` | PARTIAL | CHARTER.md:45–46 | absorbs CRM/market-intelligence/identity pages; see finding 01 |
| Page surfaces (40 page.jsx enumerated) | IMPLEMENTED | find output: overview, board, timeline, projects, etc. | |
| POST /api/import/bundle/dry-run, POST /api/import/bundle/commit (FR-108) | IMPLEMENTED (no UI) | src/app/api/import/bundle/dry-run/route.js:1-3; src/app/api/import/bundle/commit/route.js:1-3 | @req FR-108; zero UI consumer anywhere — see finding 17 |
| POST /api/import/xlsx, /dry-run, /commit, GET /api/import/template (FR-012/018) | IMPLEMENTED (with UI) | src/modules/project-manager/views/PlanImportPanel.jsx:42,79,107,169 via src/app/(pm)/projects/[projectId]/import/page.jsx:10 | contrast case — these DO have a UI; see finding 17 |
| 7 unannotated component/view files (no @req anywhere) | BUILT_NOT_DECLARED | ProgressExplain.jsx, StatusSelect.jsx, WorkItemModal.jsx, WorkpackageModal.jsx, WorkstreamModal.jsx, PlanImportPanel.jsx, universal/DependenciesView.jsx | see finding 18 |
| **Features & Roadmap** |
| FR-082/083/084/085 Pipeline Canvas | DECLARED_ONLY | PRD-SDD-v1.0.md:292 'design only' | no page/route; matches status |
| FR-124 Product Readiness dashboard | IMPLEMENTED | /platform/product-readiness/page.jsx | open gate (finding 08) + doc drift (finding 02) |
| Feature notes (27 docs/domains/project-manager/features/) | PARTIAL | all enumerated | 9 carry stale status; see finding 07 |
| Client-mutation error handling baseline | PARTIAL | docs/.client-mutation-baseline.json accepted debt | 7 pages swallow errors; see finding 13 |
| **Test Coverage** |
| Unit tests (PM FRs) | IMPLEMENTED | 19 fr0xx-prefixed test files | coverage confirmed |
| E2E tests (PM FRs) | PARTIAL | 17 *.spec.js in tests/e2e | FR-063 missing; see finding 15 |
| **Cross-Domain Infrastructure** |
| MCP transport (agent plan submission) | IMPLEMENTED | transport.js at src/app/api/mcp/route.js | unit-tested |
| Enterprise API OpenAPI docs (FR-019) | IMPLEMENTED | openapi.js at src/app/api/docs/route.js | |
| backup-service.js whole-installation snapshot/restore | PARTIAL | snapshots ~30 cross-domain models | not in CHARTER exceptions; see finding 06 |

#### Findings

##### D2-domain-project-manager-01 — owns_routes catch-all glob ดูดกลืนหน้า UI ของ CRM, market-intelligence และ identity ไปเป็นของตัวเอง

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | HIGH |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | CHARTER.md:45–46 `owns_routes: src/app/(pm)/** and src/app/api/**`; CHARTER.md:83 "Does not touch CRM's Person/Customer/Conversation/Message"; src/app/(pm)/customer/page.jsx @req FR-091; src/app/(pm)/customer/conversations/page.jsx; src/app/(pm)/market/page.jsx; src/app/(pm)/platform/users/page.jsx @req FR-038; docs/DOMAIN-MAP.md:98 "122 (82 api · 40 pages)" from glob |
| **สิ่งที่ควรเป็น** | Charter ระบุว่า "Does not touch CRM's Conversation/Message" บ่งบอกว่าสิ่งเหล่านั้นเป็นของที่อื่น; DOMAIN-MAP ควรสะท้อนความเป็นเจ้าของตามหน้าที่จริง |
| **สิ่งที่เป็นจริง** | เพราะ domain ข้างเคียงไม่ประกาศ owns_routes glob แบบเหมารวมของ project-manager จึงดูดกลืนหน้าของพวกมันไปและทำให้จำนวน route พองขึ้น ขัดกับขอบเขตที่ charter เขียนไว้เอง |
| **ข้อเสนอแนะ** | ลดขนาด owns_routes ด้วย exclusion หรือให้ domain ข้างเคียงประกาศ owns_routes ของตัวเอง เพื่อให้กฎ longest-prefix ของ doc-graph attribute ได้ถูกต้อง |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED ยืนยันแล้วว่า doc-graph.mjs routeOwner() implement กฎ longest-matching-glob-prefix; ยืนยันว่าทั้ง 4 หน้าอยู่ใต้ src/app/(pm)/** พร้อม @req ของ domain อื่น; ยืนยันว่า domain ข้างเคียงไม่มี owns_routes |

##### D2-domain-project-manager-02 — ทะเบียน FEAT-002 ค้างสถานะ 'building' ทั้งที่ FR-060/041 เสร็จ 100% แล้ว

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | HIGH |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/FEATURES.md:24 "FEAT-002 \| Business Home \| building"; docs/PRD-SDD-v1.0.md:270 FR-060 ✅; docs/TRACE.md:467 FR-060 done; docs/.domain-state.json:2667 progressPercent:100 yet ready:false, blockers:["FEAT-002 registry status is building"] |
| **สิ่งที่ควรเป็น** | ตาม FR-124: feature จะ ready ก็ต่อเมื่อทุก FR ที่รวมอยู่ verified แล้ว AND registry บอกว่า 'live' |
| **สิ่งที่เป็นจริง** | FEATURES.md:24 ไม่เคยถูกอัปเดตตอน FR-060 ship; .domain-state.json ที่ generate แล้วแสดง Business Home เป็น not_ready ที่ 100% — สถานการณ์ตรงเป๊ะที่ FR-124 มีไว้ป้องกัน |
| **ข้อเสนอแนะ** | flip docs/FEATURES.md FEAT-002 ให้เป็น 'live' แล้ว regenerate .domain-state.json |
| **เกี่ยวข้อง** | D2-domain-project-manager-07 |
| **การตรวจสอบ** | CONFIRMED ตรวจสอบทุกคู่ file/line ที่อ้างถึง; ยืนยัน FEAT-002 progressPercent:100 กับ ready:false แล้ว |

##### D2-domain-project-manager-03 — identity/onboarding-service ข้ามสัญญา scope-service.createPortfolio

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | src/modules/identity/onboarding-service.js:212 `tx.portfolio.create()`; CHARTER.md:88 "never by inserting scope rows directly"; CHARTER.md:109–113 exceptions list only AuditEvent; scope-service.js:99–109 createPortfolio gated to assertOperator |
| **สิ่งที่ควรเป็น** | Domain ใดที่สร้าง Portfolio ควรเรียก scope-service.createPortfolio |
| **สิ่งที่เป็นจริง** | FR-066 self-service เรียก tx.portfolio.create ตรง ๆ; ไม่มี charter ไหนบันทึกข้อยกเว้นนี้; operator gate ทำให้ self-service เรียก scope-service ตามรูปแบบเดิมไม่ได้ |
| **ข้อเสนอแนะ** | บันทึกเป็นข้อยกเว้นที่ชัดเจนในทั้งสอง charter โดยยอมรับว่า operator gate ทำให้ "route ผ่าน scope-service" เป็นไปไม่ได้หากไม่ออกแบบ gate ใหม่ |
| **เกี่ยวข้อง** | D2-domain-project-manager-04 |
| **การตรวจสอบ** | ADJUSTED ยืนยันการเรียก tx.portfolio.create ตรง ๆ แล้ว; ยืนยัน operator gate ของ scope-service.createPortfolio แล้ว (ตรวจสอบ assertOperator) ช่องว่างจริงคือ: ควรบันทึกเป็นข้อยกเว้นที่ยอมรับแล้วเนื่องจาก gate นี้ |

##### D2-domain-project-manager-04 — identity/profile-permission-service เขียน Membership.role ตรง ๆ

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | src/modules/identity/profile-permission-service.js:145 `db.membership.update({ data: { role, domainKeysJson } })`; src/modules/project-manager/application/project-team-service.js:1 "These four functions write Membership rows"; CHARTER.md:109–113 exceptions list only AuditEvent |
| **สิ่งที่ควรเป็น** | Membership เป็นของ project-manager แต่เพียงผู้เดียว; domain อื่นควรเรียก export หรือเป็นข้อยกเว้นที่ประกาศไว้ |
| **สิ่งที่เป็นจริง** | FR-038 updateUserPermissions ข้าม application layer ของ project-manager ไป — เป็นข้อยกเว้นที่ไม่ถูกบันทึกไว้ |
| **ข้อเสนอแนะ** | ย้าย updateUserPermissions เข้าไปเป็น export ของ project-manager หรือเพิ่มข้อยกเว้นใน CHARTER.md ระบุชื่อ FR-038/FR-062 |
| **เกี่ยวข้อง** | D2-domain-project-manager-03 |
| **การตรวจสอบ** | CONFIRMED ยืนยัน code site ทั้งสองแล้ว; ยืนยัน header ของ project-team-service.js แล้ว; ยืนยันว่า exceptions ของ CHARTER.md มีเพียง AuditEvent เท่านั้น |

##### D2-domain-project-manager-05 — components/useApi.js ทำหน้าที่เป็น public contract โดยพฤตินัยแต่ไม่เคยประกาศ

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | BUILT_NOT_DECLARED |
| **หลักฐาน** | src/modules/project-manager/components/useApi.js generic fetch hook; imported by identity's (entry)/businesses/page.jsx:20, onboarding/profile/page.jsx:19, waiting-room/page.jsx:18; CHARTER.md:86–94 Public contract lists only scope-service + two JSON schemas |
| **สิ่งที่ควรเป็น** | ไฟล์ที่ route ของ domain อื่นพึ่งพา ควรอยู่ใน Public contract หรือถูกย้ายไปที่ที่ไม่ผูกกับ domain ใด |
| **สิ่งที่เป็นจริง** | useApi.js อยู่ใน src/modules/project-manager/components/ แต่หน้าของ identity import โดยตรง — ไม่มีเอกสารรองรับ |
| **ข้อเสนอแนะ** | ย้ายไปที่ src/lib/use-api.js (ไม่มี logic ของ project-manager) หรือเพิ่มเข้า Public contract |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED เปิด useApi.js และทั้ง 3 หน้า entry แล้ว; ยืนยันว่ามันเป็น generic จริง; ยืนยันว่า Public contract ไม่มีมันอยู่ |

##### D2-domain-project-manager-06 — backup-service.js แตะโมเดลของทุก domain โดยไม่บันทึกไว้ในข้อยกเว้น

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | src/modules/project-manager/application/backup-service.js:51 SNAPSHOT_MODELS spans portfolio, integrationProvider, tenant, legalEntity ...; backup-service.js:20 imports isInstallationOperator; CHARTER.md:109–113 exceptions list only AuditEvent |
| **สิ่งที่ควรเป็น** | Charter ควรบันทึกทุกจุดที่โค้ดอ่าน/เขียนนอก owns_models ตาม pattern ของ AuditEvent |
| **สิ่งที่เป็นจริง** | backup-service.js เป็น cross-domain write surface ที่ใหญ่ที่สุด (ทุกตารางตอน restore) แต่ charter ไม่พูดถึงเลย |
| **ข้อเสนอแนะ** | เพิ่มบรรทัดใน CHARTER.md ส่วน Known shared-write ระบุชื่อ backup-service.js และ FR ที่เกี่ยวข้อง (FR-013, FR-075, FR-078, FR-081, FR-092, FR-123) |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED เปิด backup-service.js บรรทัด 15–60; ยืนยัน cross-domain model และ import ของ identity; ยืนยันซ้ำว่า exceptions ของ CHARTER.md มีเพียง AuditEvent |

##### D2-domain-project-manager-07 — feature note 9 ฉบับยังมีสถานะเก่า Candidate/Proposed/Declared

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | FR-058/059/060/063/064/068/069/070/077 notes show Candidate/Proposed/Declared vs PRD ✅ and TRACE done |
| **สิ่งที่ควรเป็น** | สถานะของ feature note ควรตรงกับสถานะจริงของ requirement ใน PRD/TRACE |
| **สิ่งที่เป็นจริง** | 9 จาก 27 ฉบับรายงานความสำเร็จต่ำกว่าจริง; ผู้อ่าน docs/domains/project-manager/features/ เพียงอย่างเดียวจะคิดว่ายังไม่ implement |
| **ข้อเสนอแนะ** | Flip สถานะทั้ง 9 ฉบับเป็น 'done'/'implemented'; feature note ของ FR-039–045/056/108/124 ถูกต้องอยู่แล้ว |
| **เกี่ยวข้อง** | D2-domain-project-manager-02 |
| **การตรวจสอบ** | CONFIRMED ตรวจสอบ field Status ของ feature note ทั้ง 9 ฉบับทีละฉบับ; cross-check กับแถว PRD และ TRACE แล้ว |

##### D2-domain-project-manager-08 — FR-124 PROGRESS_METHODOLOGY ยังไม่ได้รับการรับรอง แต่ render ในโปรดักชันแล้ว

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | LOW |
| **ประเภท** | PRODUCTION_GATE_OPEN |
| **หลักฐาน** | docs/PRD-SDD-v1.0.md:334 "20% declaration + 40% code + 40% test — awaiting owner sign-off"; scripts/domain-state.mjs:46 PROGRESS_METHODOLOGY wired into progressPercent; ProductReadinessDashboard.jsx:56–63 Methodology component renders weights in Thai on /platform/product-readiness |
| **สิ่งที่ควรเป็น** | ค่าคงที่ policy ที่กำหนดตัวเลข readiness ควรได้รับการรับรองจากเจ้าของก่อน |
| **สิ่งที่เป็นจริง** | 20/40/40 คำนวณตัวเลขทุกตัวอยู่แล้ว; PRD ระบุว่ายังไม่ได้รับรอง แต่ UI render Methodology อย่างโปร่งใสว่าเป็น policy ที่ประกาศแล้วแต่ยังไม่รับรอง ไม่ใช่ข้อเท็จจริงที่แน่นอน |
| **ข้อเสนอแนะ** | ขอการรับรองจากเจ้าของ (หรือบันทึกวันที่รับรอง); ความโปร่งใสมีอยู่แล้วผ่าน Methodology component ดังนั้นช่องว่างนี้เป็นเรื่องบริหาร/กระบวนการเท่านั้น |
| **เกี่ยวข้อง** | D2-domain-project-manager-02 |
| **การตรวจสอบ** | ADJUSTED PROGRESS_METHODOLOGY มีอยู่จริงและคำนวณ progressPercent; ยืนยันว่า PRD ระบุว่ายังไม่รับรอง; แต่ ยืนยันแล้วว่า ProductReadinessDashboard.jsx บรรทัด 56–63 render Methodology อย่างโปร่งใส ปรับลดความรุนแรงเป็น LOW (ช่องว่างเชิงบริหาร ไม่ใช่ trust gap) |

##### D2-domain-project-manager-09 — แถว FileLink ถูกเขียนทุกครั้งที่สร้าง FileAsset แต่ไม่มีใครอ่านเลย

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | BROKEN_FLOW |
| **หลักฐาน** | src/modules/project-manager/application/file-asset-service.js:123 `tx.fileLink.create()`; file-asset-service.js:296 same; file-manager-read-model.js:162 "Secondary FileLink rows not input to aggregation"; grep for fileLink.findMany/findFirst/findUnique outside tests returns zero |
| **สิ่งที่ควรเป็น** | Model ที่ถูกเขียนทุกครั้งที่สร้าง/migrate ไฟล์ควรมีเส้นทางอ่าน หรือไม่ก็ควรลบการเขียนนั้นทิ้ง |
| **สิ่งที่เป็นจริง** | แถว FileLink ถูกเขียนทุกครั้งที่ FileAsset ถูกสร้าง/migrate; ไม่มี read model, API route หรือ UI ใดตรวจสอบมันเลย |
| **ข้อเสนอแนะ** | สร้างผู้บริโภคแบบ multi-link ที่ตั้งใจไว้ตั้งแต่แรก หรือหยุดเขียนแถว FileLink; บันทึกไว้ว่า FileAsset ownership เป็นแบบ single-parent เท่านั้น |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED ยืนยันอิสระว่าไม่มี fileLink read query ใน src/ เลย; ยืนยัน writer site ทั้งสองที่บรรทัดที่อ้างถึง |

##### D2-domain-project-manager-10 — LegalEntityIdentifier เป็น model ที่ตายแล้ว ไม่มีทั้งผู้อ่านและผู้เขียน

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | DECLARED_NOT_BUILT |
| **หลักฐาน** | prisma/schema.prisma:82–95 model LegalEntityIdentifier; backup-service.js:52 only appearance — SNAPSHOT_MODELS only; docs/domains/project-manager/features/FR-019-enterprise-api.md:37 "ExternalRef generalizes จาก LegalEntityIdentifier" |
| **สิ่งที่ควรเป็น** | Model ใน owns_models ควรมีวัตถุประสงค์ที่ใช้งานจริง (มีผู้เขียน/ผู้อ่าน) หรือมีเครื่องหมาย superseded ที่ชัดเจน |
| **สิ่งที่เป็นจริง** | ไม่มี call create/update/delete/find ใน src/ เลย; FR-019 ของ domain เองบันทึกไว้ว่าบทบาทถูกยุบรวมเข้า ExternalRef แล้ว |
| **ข้อเสนอแนะ** | เชื่อมเข้าเส้นทางจริง หรือ deprecate อย่างเป็นทางการ: ลบออกจาก CHARTER.md, drop ตาราง, บันทึกการลบตาม convention |
| **เกี่ยวข้อง** | D2-domain-project-manager-12 |
| **การตรวจสอบ** | CONFIRMED ยืนยันว่าไม่มี query ใน src/; อ่าน note ของ FR-019 ที่บันทึกความล้าสมัยแล้ว |

##### D2-domain-project-manager-11 — Workstream.laneId ประกาศไว้เฉยๆ ไม่มีการอ่านหรือเขียนเลย

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | LOW |
| **ประเภท** | DECLARED_NOT_BUILT |
| **หลักฐาน** | prisma/schema.prisma:717 `laneId String?`; schema.prisma:743 `@@index([laneId])`; docs/PRD-SDD-v1.0.md:300 FR-090 "declared-only" — explicitly acknowledged |
| **สิ่งที่ควรเป็น** | FR-090 บันทึกไว้แล้วว่าเป็น declaration-only โดยตั้งใจ — สอดคล้องกันและเป็นที่รับรู้แล้ว |
| **สิ่งที่เป็นจริง** | Field และ index มีต้นทุนอยู่ทั้งที่ไม่ได้ใช้; ไม่มี service/route/UI ใดอ่านหรือเขียน laneId เลย |
| **ข้อเสนอแนะ** | ไม่ต้องดำเนินการเพิ่มเติมนอกจากที่ FR-090 ระบุไว้แล้ว; ติดตามเป็น feature ในอนาคตหรือ drop ถ้าถูกยกเลิกถาวร |
| **เกี่ยวข้อง** | D2-domain-project-manager-10 |
| **การตรวจสอบ** | CONFIRMED ยืนยัน schema และ index แล้ว; ยืนยันว่า 'laneId' ไม่มีใน src/ เลย; อ่านแถว PRD เต็มของ FR-090 แล้ว |

##### D2-domain-project-manager-12 — Repository.externalRepoId ไม่สอดคล้องกับ ExternalRef ที่ generalize แล้ว

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | LOW |
| **ประเภท** | PARTIAL |
| **หลักฐาน** | prisma/schema.prisma:899 Repository.externalRepoId bespoke column; schema.prisma:1080 ExternalRef.entityType omits Repository; docs/PRD-SDD-v1.0.md FR-130 uses integration's ExternalEntityRef (schema.prisma:1688) for webhook routing |
| **สิ่งที่ควรเป็น** | FR-019 ระบุว่า ExternalRef จะ generalize Repository.externalRepoId |
| **สิ่งที่เป็นจริง** | Project/Workstream/WorkContainer/WorkItem/Milestone/Gate ใช้ ExternalRef; Repository ยังเก็บ column เฉพาะของตัวเอง; FR-130 ใช้ ExternalEntityRef แยกต่างหาก — Repository มีกลไก external-id สองแบบ |
| **ข้อเสนอแนะ** | migrate Repository.externalRepoId เข้าสู่ ExternalRef หรือบันทึกไว้ว่า Repository เป็นข้อยกเว้นโดยตั้งใจพร้อมเหตุผล |
| **เกี่ยวข้อง** | D2-domain-project-manager-10 |
| **การตรวจสอบ** | ADJUSTED ยืนยันทั้ง Repository.externalRepoId และรายการ ExternalRef.entityType แล้ว; พบกลไก ExternalEntityRef แยกต่างหากของ FR-130 Repository มี pattern external-id สองแบบใช้งานจริงอยู่แล้ว — การ migrate ไม่ใช่เรื่องตรงไปตรงมา |

##### D2-domain-project-manager-13 — หลายหน้ากลืน mutation ที่ล้มเหลวอย่างเงียบ ๆ

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | src/app/(pm)/projects/[projectId]/page.jsx:49 `await api(...DELETE...); window.location.href = '/projects'` no try/catch; src/app/(pm)/projects/page.jsx:343 same; docs/.preflight-report.json:205 I18 "7 file(s) swallow failed mutation (accepted debt)" |
| **สิ่งที่ควรเป็น** | การเขียนที่ล้มเหลว (403/500/network) ควรแสดง error ให้ผู้ใช้เห็น |
| **สิ่งที่เป็นจริง** | Handler ของ archive/delete เรียก API แล้วดำเนินต่อ (navigate/reload) โดยไม่มี catch เลย — error แยกไม่ออกจาก success |
| **ข้อเสนอแนะ** | ห่อด้วย try/catch; แสดง error ผ่าน ErrorState/toast ที่มีอยู่แล้ว; ลด .client-mutation-baseline.json ลง |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED เปิดไฟล์ page.jsx ทั้งสองที่มี delete/archive handler แล้ว; ยืนยันว่าไม่มี error path เลย; ยืนยัน preflight-report.json I18 แล้ว |

##### D2-domain-project-manager-14 — CHARTER.md ขาด Version/Status control fields

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/.preflight-report.json:150 I13 "Missing control fields: Version, Status"; CHARTER.md:1 frontmatter lacks version/status |
| **สิ่งที่ควรเป็น** | เอกสารที่ scan ควรมี field ควบคุม Version และ Status (feature note มีอยู่แล้ว) |
| **สิ่งที่เป็นจริง** | CHARTER.md ไม่มี field เหล่านี้; preflight บันทึกเป็น INFO finding "add at next revision" |
| **ข้อเสนอแนะ** | เพิ่ม frontmatter version/status ให้ CHARTER.md ในการแก้ไขครั้งถัดไป ตามคำแนะนำของ preflight |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED grep preflight-report.json หา I13 แล้ว; ยืนยันว่า frontmatter ของ project-manager CHARTER.md ไม่มี field เหล่านี้ |

##### D2-domain-project-manager-15 — FR-063 Project Board มีเพียง unit test ไม่มี integration/e2e

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | LOW |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | docs/TRACE.md FR-063 Tests: tests/unit/fr063-board-columns.test.js · plan-status-vocabulary.test.js (both unit); src/app/(pm)/projects/[projectId]/board/page.jsx not referenced by tests/e2e or tests/integration; tests/e2e has 17 *.spec.js with none for board/fr063 |
| **สิ่งที่ควรเป็น** | Surface ที่ผู้ใช้เห็นและมีการเขียนข้อมูล (render board + เปิด editor) ควรมีหลักฐาน integration/e2e เหมือนที่ FR-040/041/045/058/059/060/077 มี |
| **สิ่งที่เป็นจริง** | Coverage จำกัดอยู่แค่ unit test การอนุมาน enum เท่านั้น; ไม่มี test ใดขับเคลื่อนหน้า board หรือยืนยัน WorkpackageModal ด้วย e2e |
| **ข้อเสนอแนะ** | เพิ่ม integration test สำหรับ KanbanBoard หรือ e2e spec เปิด /projects/{id}/board แล้ว assert ว่า column ตรงกับ WORK_STATUSES |
| **เกี่ยวข้อง** | D2-domain-project-manager-07 |
| **การตรวจสอบ** | CONFIRMED ตรวจสอบส่วน FR-063 ของ TRACE.md แล้ว; นับ tests/e2e/*.spec.js ได้ 17 ไฟล์ยืนยันแล้ว; ยืนยันว่า board/page.jsx มีอยู่จริง |

##### D2-domain-project-manager-16 — PlanImportReceipt เขียนอย่างเดียว ไม่มีเส้นทางอ่าน

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | LOW |
| **ประเภท** | PARTIAL |
| **หลักฐาน** | src/modules/project-manager/import/plan-import-service.js:380 planImportReceipt.findUnique on idempotencyKey only; bundle-receipt.js:55 same; docs/domains/project-manager/CHARTER.md:65 "trace record of a committed Project import"; grep for 'PlanImportReceipt' in src/app returns zero route.js or page.jsx |
| **สิ่งที่ควรเป็น** | Model ที่ถูกอธิบายว่าเป็น "trace record" ควรมีเส้นทางเรียกดู (list ตาม Project/วันที่) เหมือนที่ AuditEvent มี /audit |
| **สิ่งที่เป็นจริง** | มีเพียงการ lookup ด้วย idempotency-key เท่านั้น; ไม่มี findMany, API route หรือ UI ใด list PlanImportReceipt; audit ของการ import ถูกบันทึกผ่าน PLAN_IMPORTED AuditEvent (plan-import-service.js:655) ที่ /audit แทน |
| **ข้อเสนอแนะ** | เพิ่มเส้นทางอ่านแบบง่าย (GET /api/projects/{id}/import-receipts) หรืออัปเดต charter ให้ระบุว่าบทบาทของมันคือ idempotency เท่านั้น และการติดตามทำผ่าน AuditEvent |
| **เกี่ยวข้อง** | D2-domain-project-manager-09 |
| **การตรวจสอบ** | verifier-added grep ยืนยันว่าไม่มี findMany/findUnique นอกเหนือจาก idempotency lookup เลย; ยืนยันคำอธิบาย CHARTER.md:65 แล้ว; ยืนยันว่า PLAN_IMPORTED AuditEvent มี import trace อยู่แล้ว |

##### D2-domain-project-manager-17 — FR-108 ExecutionPlanBundle intake เป็น API-only; pipeline BR-009/SDD-009 ที่ domain ประกาศไว้เองไม่เคยถูกตรวจสอบกับ UI เลย

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | MISSING_SURFACE |
| **หลักฐาน** | src/app/api/import/bundle/dry-run/route.js:1-3 (@req FR-108, @spec ADR-049, SDD-056, BR-007, BR-009) และ src/app/api/import/bundle/commit/route.js:1-3 มีจริง; docs/PRD-SDD-v1.0.md:318 FR-108 สถานะ "✅ implemented 2026-08-27"; `grep -rn 'import/bundle' src/app/(pm)/ src/components/` = ศูนย์ผลลัพธ์ — จุดอ้างอิงเดียวนอก route คือ src/modules/project-manager/api-docs/openapi.js:23; ในทางตรงกันข้าม /api/import/xlsx, /api/import/template, /api/import/dry-run, /api/import/commit มี UI จริง (src/modules/project-manager/views/PlanImportPanel.jsx:42,79,107,169 ผ่าน src/app/(pm)/projects/[projectId]/import/page.jsx:10); docs/domains/project-manager/CHARTER.md:91-95 ตั้งชื่อ contracts/execution-plan-bundle.schema.json และ EXECUTION-PLAN-BUNDLE.md เป็น Public contract ของโดเมน |
| **สิ่งที่ควรเป็น** | Per BR-009/SDD-009 ทุก intake surface ควรถูกตรวจสอบตาม pipeline envelope → validate → semantic → dry-run → preview → transaction → audit; endpoint ที่ charter ประกาศเป็น Public contract ควรมี consumer (UI หรือ agent) ที่ตรวจสอบได้ในหน่วยนี้ |
| **สิ่งที่เป็นจริง** | FR-108 มีโค้ดครบและ ✅ ใน PRD แต่ทั้งสอง route (dry-run, commit) ไม่มี UI consumer ใด ๆ ในทั้ง src/app/(pm)/ และ src/components/ — เป็น API-with-no-UI dead-end ตรงตามหมวดที่มิตินี้ต้องตรวจสอบ แต่หน่วยงานนี้ไม่เคยตรวจเลย (grep 'EXECUTION-PLAN-BUNDLE'='dry-run'='xlsx'=0 ในรายงานฉบับนี้) |
| **ข้อเสนอแนะ** | ยืนยันว่า FR-108 ตั้งใจให้เป็น agent/API-only surface (ถ้าใช่ ให้บันทึกไว้ใน charter/feature note อย่างชัดเจน) หรือสร้าง UI consumer (เช่น multi-Project bundle import panel) ให้ตรงกับ FR-018/FR-065 ที่มี UI แล้ว |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | critic-added |

##### D2-domain-project-manager-18 — ไฟล์ component/view 7 ไฟล์ไม่มี @req annotation เลย รวมถึง UI surface เดียวของเส้นทาง intake ที่คู่กับ FR-108

| ฟิลด์ | รายละเอียด |
|---|---|
| **ระดับ** | MEDIUM |
| **ประเภท** | BUILT_NOT_DECLARED |
| **หลักฐาน** | ไฟล์ที่ไม่มีบรรทัด `@req` เลยทั่วทั้ง src/modules/** และ src/platform/**: src/modules/project-manager/components/ProgressExplain.jsx, StatusSelect.jsx, WorkItemModal.jsx, WorkpackageModal.jsx, WorkstreamModal.jsx, src/modules/project-manager/views/PlanImportPanel.jsx, src/modules/project-manager/views/universal/DependenciesView.jsx (ยืนยันแล้วว่าเป็น 7 จาก 216 ไฟล์ที่ตรวจทั่ว repo — 7 ของ 7 ไฟล์ที่ไม่มี annotation ทั้งหมดอยู่ในโดเมนนี้); CLAUDE.md: "Every non-trivial source file carries these [@req/@spec/@tested]" |
| **สิ่งที่ควรเป็น** | ทุกไฟล์ source ที่ไม่ trivial ควรมี @req annotation ตามสัญญา doc-code ของ repo — PlanImportPanel.jsx เป็น browser surface เดียวของ FR-018/FR-065 intake ที่หน่วยงานนี้ไม่เคยตรวจสอบเลย |
| **สิ่งที่เป็นจริง** | 7 ไฟล์นี้ (component/view ทั้งหมด) ไม่มี @req แม้แต่บรรทัดเดียว ทั้งที่ D2-domain-project-manager-05 รายงานเฉพาะ useApi.js ว่า "built-but-undeclared" — เป็นเพียง 1 instance ของช่องว่างที่กว้างกว่านั้น |
| **ข้อเสนอแนะ** | เพิ่ม @req/@spec/@tested annotation ให้ทั้ง 7 ไฟล์ตาม FR ที่แต่ละไฟล์ implement (WorkItemModal.jsx/WorkpackageModal.jsx/WorkstreamModal.jsx → FR-036/037; StatusSelect.jsx/ProgressExplain.jsx → progress calculators; PlanImportPanel.jsx → FR-012/018; DependenciesView.jsx → FR-040) |
| **เกี่ยวข้อง** | D2-domain-project-manager-05 |
| **การตรวจสอบ** | critic-added |

#### ข้อจำกัดการตรวจ

**Finder scope** — อ่านเต็ม CHARTER.md (113 บรรทัด), ทั้ง 27 ไฟล์ features/ (ตรวจ status field, อ่านเต็ม 12 ไฟล์), นับ 49 ไฟล์ .js ภายใต้ src/modules/project-manager/**, ตรวจ grep 21 application/import services สำหรับ Prisma write targets, ตรวจ 29 models ใน owns_models + ค้นหา writers ทั่ว src/, ตรวจ satellite modules ว่าไม่เขียน, แจงนับ 94 import sites นอกเขต, cross-query docs/PRD-SDD-v1.0.md, TRACE.md, FEATURES.md, DOMAIN-MAP.md, roadmap/, .domain-state.json, .preflight-report.json สำหรับ FR ids

**Not examined in depth** — ไม่ได้เปิด JSON schema contracts ทีละฟิลด์; ~40 page.jsx audit โดยระบุ + grep @req + อ่านเฉพาะ (overview, customer, market, platform/users, projects/[projectId]); tests/unit/integration survey โดยชื่อ + grep (ยกเว้น team-authorization); ไม่ได้นับ 82 API routes; repo briefing's 23 Playwright specs claim ไม่ตรง (17 ไฟล์จริง)

**Verifier method** — อ่านเต็ม CHARTER.md, ทั้ง 27 status fields, cross-check docs/PRD-SDD-v1.0.md/TRACE.md/FEATURES.md/.domain-state.json/.preflight-report.json; รัน grep อิสระบน 29 owns_models (พบ 2 cross-domain writers: Portfolio ใน identity, Membership ใน identity); ตรวจ doc-graph.mjs longest-prefix logic; ไม่พบ REFUTED; ปรับ 3 findings (D2-03/08/12); เพิ่ม 1 finding ใหม่ (PlanImportReceipt)

## domain-business

### domain-business

#### สรุปย่อ

- โมดูล `src/modules/business` ประกอบด้วย 2 ไฟล์ (364 บรรทัด): `business-strategy-service.js` (FR-041/043) และ `business-home-read-model.js` (FR-060) ซึ่งสมบูรณ์ใน code และ test
- Business Strategy read model และ Business Home Dashboard ทั้งคู่ implemented และ shipped ✅ (FRs FR-041, FR-043, FR-060 ทั้งหมด ✅ ใน PRD-SDD-v1.0.md)
- Documentation drift: charter ของ project-manager ยังไม่ได้อธิบาย FR-060/business-home-read-model.js แม้อัปเดตไปแล้ว 4 ครั้งตั้งแต่วันที่ module นี้ deliver (2026-08-17)
- E2E proof (tests/e2e/fr060-business-home.spec.js:29) hardcoded domain count ที่ '7 domains' และจะล้มเหลวหลังจากเพิ่ม market domain key เมื่อวาน (2026-09-01)
- FEAT-002 (Business Home) คงสถานะ 'building' แม้ทั้ง FR-041 และ FR-060 ✅ แล้ว เพราะ remaining scope ไม่มี FR id ติดตามได้
- ไม่พบการเข้าถึงข้ามโดเมน — module เป็น pure-read ตามที่ charter ระบุ

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|--------|---------|---------|
| `src/modules/business/application/business-strategy-service.js` (getBusinessStrategy — FR-041/FR-043) | IMPLEMENTED | Lines 1–145 | Serializes BusinessRoadmap/Goals/Projects for the Business Strategy card |
| `src/modules/business/application/business-home-read-model.js` (buildBusinessHomeReadModel — FR-060) | IMPLEMENTED | Lines 1–219 | Computes domain health, attention queue, coverage labels for Business Home dashboard |
| Model `Business` (owned by project-manager; read-only by business module) | IMPLEMENTED | `prisma/schema.prisma:97`, `.postgres.prisma:104` | Primary entity; no writes from src/modules/business |
| Model `BusinessRoadmap` | IMPLEMENTED | `prisma/schema.prisma:630`, `.postgres.prisma:637` | Roadmap-level grouping; migrations in Supabase match |
| Model `BusinessRoadmapHorizon` | IMPLEMENTED | `prisma/schema.prisma:650`, `.postgres.prisma:657` | 2–3 horizons per roadmap per FR-059 constraint |
| Model `BusinessGoal` | IMPLEMENTED | `prisma/schema.prisma:668`, `.postgres.prisma:675` | Goals tied to Business; writers inside project-manager only |
| Model `ProjectGoal` | IMPLEMENTED | `prisma/schema.prisma:695`, `.postgres.prisma:702` | Linking entity; no writes from src/modules/business |
| Route GET `/api/business/strategy` | IMPLEMENTED | `src/app/api/business/strategy/route.js:1–20` | Only route owned by src/modules/business code |
| Routes POST/PATCH `/api/business/goals` family (FR-059) | IMPLEMENTED | `src/app/api/business/goals/route.js` imports `business-strategy-mutation-service` | Mutations owned by project-manager, not src/modules/business |
| Route GET `/api/business/files` (FR-045) | IMPLEMENTED | `src/app/api/business/files/route.js` | File asset delegation; no src/modules/business code |
| UI `/overview` — Business Home Dashboard (FR-060) + Business Strategy card (FR-041/059) | IMPLEMENTED | `src/app/(pm)/overview/page.jsx:1–345` | Renders both read models; consumes getBusinessStrategy, buildBusinessHomeReadModel |
| Charter's 'Satellite modules in this lane' description | PARTIAL | `docs/domains/project-manager/CHARTER.md:100–104` | Mentions only FR-041/043; omits FR-060 entirely despite 219-line file |
| Charter's 'Public contract' section listing exports | MISSING | `docs/domains/project-manager/CHARTER.md:86–96` | No entry for `src/modules/business` exports; only `scope-service` and schemas listed |
| Cross-domain imports of `@/modules/business` (boundary enforcement) | IMPLEMENTED ✓ | 0 external importers found; only `src/app/(pm)/overview/page.jsx` and `src/app/api/business/strategy/route.js` (both inside project-manager's owns_routes globs) | No boundary violations |
| Writers to Business/BusinessRoadmap/BusinessGoal/ProjectGoal | IMPLEMENTED ✓ | All `.create()` calls in `src/modules/project-manager/application/` and `src/modules/project-manager/import/` | No writes from src/modules/business; module is pure-read |
| FR-041/043/060 PRD rows + TRACE + feature notes + roadmap rows | IMPLEMENTED | `docs/PRD-SDD-v1.0.md:251,253,270` (✅), `docs/TRACE.md:317,334,464`, feature notes exist, roadmap status 'done' | All FRs delivered and documented |
| FEAT-002 (Business Home) feature registry | PARTIAL | `docs/FEATURES.md:24` | Status 'building' though both FRs (041, 060) ✅; remaining scope has no FR id |
| E2E domain-count assertion (tests/e2e/fr060-business-home.spec.js) | PARTIAL | Line 29: hardcoded `/of 7 domains/` | Will fail after market domain added (commit 4306a29, 2026-09-01); now 8 domains, not 7 |
| `docs/INTERFACE-INVENTORY.md` marker vs. prose | PARTIAL | Marker (line 24): `operational_domain_keys=8` ✓; prose (lines 130, 200, 251): still say '7 operational domains' / '7 table' | Inconsistent; marker updated, prose stale |
| `tests/unit/business-strategy-service.test.js` coverage | PARTIAL | Lines 12–39 | Test title claims cross-Business project exclusion, but fixture has no foreign-businessId project; only <2 horizons guard tested, not >3 |
| `tests/unit/fr060-business-home-read-model.test.js` (DOMAIN_STATE/SEVERITY logic) | IMPLEMENTED | Lines 1–226 | Uses local fixture; covers attention-queue logic, domain health computation |
| `tests/integration/fr059-business-strategy-mutation.test.js` | IMPLEMENTED | Lines 25, 94 | Exercises GET `/api/business/strategy` against real Prisma test DB |
| `tests/e2e/fr041-business-first.spec.js` | IMPLEMENTED | Lines 44–51 | End-to-end API contract proof for FR-041 |
| `docs/DOMAIN-MAP.md` (project-manager section) | IMPLEMENTED | Lines 90–96 | Generated; lists src/modules/business accurately |
| `docs/FEATURE-MAP.md` rows for FR-041/043/059/060 | IMPLEMENTED | Lines 56, 58, 74–75 | Generated; module column includes 'business' |
| CLI/script usage of src/modules/business | MISSING (not a gap — module is UI/API-consumed only) | grep `scripts/` returns no matches | Confirmed expected; no scripts import this module |

#### Findings

##### D2-domain-business-02 — e2e ของ FR-060 assert domain count เก่า ('of 7 domains') หลัง market-intelligence ลงทะเบียนเป็น domain แล้ว — จะ fail

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | HIGH |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | • `tests/e2e/fr060-business-home.spec.js:29` — `await expect(page.getByText(/of 7 domains/).first()).toBeVisible()` hardcodes count<br>• `src/config/domains.js:55` — 'market' domain added commit 4306a29 (2026-09-01); now 9 total keys (was 8)<br>• `src/modules/business/application/business-home-read-model.js:82,213` — domainHealthRows() filters only SELF_KEY ('business-home'), leaving 8 rows; coverageLabel renders `${scored.length} of ${rows.length}` → 'of 8 domains' now<br>• `src/modules/business/application/business-home-read-model.js:210` — comment still says "a single number over 7 slots" (stale evidence of the 7-count assumption) |
| **สิ่งที่ควรเป็น** | E2E assertion ควรติดตามจำนวน domain จริงจาก src/config/domains.js (หรือคำนวณจากมัน) เพื่อให้ real-browser proof ของ FR-060 (docs/TRACE.md:464) ยังคงผ่านต่อไปเมื่อมี domain เพิ่ม |
| **สิ่งที่เป็นจริง** | literal ที่ hardcode ไว้ '/of 7 domains/' ไม่เคยถูกอัปเดตนับตั้งแต่ domain key 'market' ถูกเพิ่มเมื่อวานนี้ (2026-09-01); หน้าเว็บตอนนี้ render 'of 8 domains' ตามตรรกะของ read model เอง ดังนั้น Playwright selector นี้จะไม่ match (อนุมานจากคณิตศาสตร์การนับ domain ไม่ใช่จากการรัน test จริง ตามกฎ read-only ของงานนี้) |
| **ข้อเสนอแนะ** | แก้ `tests/e2e/fr060-business-home.spec.js:29` ให้ assert 'of 8 domains' (หรือคำนวณจำนวนที่คาดหวังจาก src/config/domains.js ตอน runtime); เพิ่ม 'Market Intelligence' เข้า loop label ของ domain ที่สงวนไว้ที่บรรทัด 36 ด้วยเพื่อความครบถ้วน แล้วรัน `npm run test:e2e` ใหม่เพื่อยืนยัน |
| **เกี่ยวข้อง** | D2-domain-business-03 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-business-01 — คำอธิบาย satellite module `business` ใน charter ล้าสมัย — ไม่กล่าวถึง FR-060/business-home-read-model.js เลย

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | • `docs/domains/project-manager/CHARTER.md:103` — prose ทั้งหมดของ charter เกี่ยวกับ module นี้: "`business` — the Business Strategy read model (FR-041/FR-043): serializes BusinessRoadmap/Goals/Projects, all owned here."<br>• `src/modules/business/application/business-home-read-model.js:1–219` — ไฟล์ 219 บรรทัด, @req FR-060, เป็นครึ่งหนึ่งของ module ทั้งจำนวนไฟล์และใหญ่กว่าด้วยจำนวนบรรทัด (219 vs. 145); ไม่ถูกกล่าวถึงเลยในส่วน satellite-modules ของ charter<br>• Git history: ส่วน satellite-modules ถูกเพิ่มใน commit 17b1dde (2026-08-16); FR-060 ship ใน commit 501a67a (2026-08-17, วันถัดมา); charter ถูกแก้อีก 4 ครั้งจนถึง 2026-08-26 โดยไม่เคยเพิ่มการอ้างอิง FR-060 |
| **สิ่งที่ควรเป็น** | คำอธิบาย prose เดียวของ charter สำหรับ src/modules/business ควรตั้งชื่อทุกสิ่งที่ผู้อ่านจะพบในนั้น เพราะ module นี้ไม่มี charter ของตัวเอง ดังนั้น CHARTER.md ของ project-manager จึงเป็นเอกสาร ownership/scope เดียวที่มี |
| **สิ่งที่เป็นจริง** | ส่วน satellite-modules อธิบายเฉพาะ business-strategy-service.js (FR-041/FR-043); business-home-read-model.js (FR-060 การคำนวณทั้งหมดของ Business Home Dashboard) และบทบาทของมันไม่ถูกอธิบายเลย |
| **ข้อเสนอแนะ** | ขยาย bullet satellite-modules ที่มีอยู่ให้ระบุชื่อ FR-060/business-home-read-model.js อย่างชัดเจน โดยเลียนแบบภาษาของ SDD-032/033 ที่ใช้อยู่แล้วในที่อื่นของ charter เดียวกัน |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-business-03 — docs/INTERFACE-INVENTORY.md ขัดแย้งกับ marker ที่ตรวจสอบด้วยเครื่องของตัวเอง: prose ยังบอกว่า '7 operational domains' แต่ marker บอกว่า 8

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | MEDIUM |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | • `docs/INTERFACE-INVENTORY.md:24` (HTML marker) — `operational_domain_keys=8; operational_subdomain_entries=26` ✓ updated by commit 4306a29<br>• Line 130 — "The operational registry has seven domain keys." (ล้าสมัย อยู่ใต้ส่วน '3.4 Market Intelligence' ใหม่ที่เพิ่มโดย commit เดียวกัน)<br>• Line 201 — `| Source \`DOMAINS\` entries | 8 | \`business-home\` plus seven operational domains |` (ล้าสมัย — `src/config/domains.js` ตอนนี้มี 9 keys ทั้งหมดหลังจากเพิ่ม `market` ดังนั้นควรเป็น 9)<br>• Line 202 (ไม่ใช่ 200 ซึ่งเป็นเส้นแบ่งตาราง `|---|---:|---|`) — แถวตาราง domain-key: `| Operational domain keys | 7 | commerce, customer, growth, operations, people, projects, platform |` (ขาด market, จำนวนล้าสมัย — ตรงกับ marker ที่บอก `operational_domain_keys=8`)<br>• Lines 204–205 — `| Source sub-domain entries | 23 |` และ `| Operational sub-domain entries | 22 |` (ล้าสมัย — ควรเป็น 27 / 26 ตาม marker's `operational_subdomain_entries=26` บวก 1 Business Home slot)<br>• Line 251 — แถวตาราง registry-source: `| src/config/domains.js | 7 operational domains, 22 operational sub-domains, 1 Business Home slot |` (ควรเป็น 8 / 26 ตาม marker)<br>• `scripts/doc-preflight.mjs:406–422` — marker regex ตรวจสอบเฉพาะตัวเลข 4 ตัวใน HTML-comment เทียบกับ src/config/domains.js เท่านั้น ไม่เคยตรวจสอบความสอดคล้องของ prose |
| **สิ่งที่ควรเป็น** | เอกสารที่อ้างว่า preflight เทียบ control marker กับ source ควรมี prose ที่สอดคล้องกับ marker นั้น; preflight ควรจับ prose ที่ล้าสมัยได้ทุกจุดที่ตัวเลขปรากฏ |
| **สิ่งที่เป็นจริง** | Marker ถูกปรับจาก 7→8 / 25→26 domains และมีการเพิ่มส่วน '3.4 Market Intelligence' ใหม่ แต่จุดอื่นอีก 5 จุดในเอกสาร (1 ประโยค + 4 แถวตาราง: บรรทัด 130, 201, 202, 204, 205, 251) ยังคงเขียนตัวเลขล้าสมัย '7'/'8'/'22'/'23' ทำให้เอกสารขัดแย้งกันเองโดยที่ preflight ตรวจจับไม่ได้เพราะตรวจแค่ marker |
| **ข้อเสนอแนะ** | อัปเดตบรรทัด 130, 201, 202, 204, 205, 251 ให้เป็น 9 source `DOMAINS` entries / 8 operational domains / 27 source sub-domain entries / 26 operational sub-domain entries และเพิ่ม `market` เข้ารายการ domain-key ที่ enumerate ไว้ พิจารณาขยาย doc-preflight.mjs ให้ grep หาคำนับจำนวน ('seven'/'7 operational') ในไฟล์นี้ด้วย เพื่อไม่ให้การเพิ่ม domain ในอนาคตหลุดการตรวจสอบ |
| **เกี่ยวข้อง** | D2-domain-business-02 |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-business-04 — test เดียวของ business-strategy-service.test.js ไม่ได้ทดสอบทั้ง cross-Business project exclusion และ horizon upper-bound ที่มันอ้างว่าทดสอบ

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | • `tests/unit/business-strategy-service.test.js:24` — ชื่อ test: "returns ordered horizons and excludes linked projects from another Business"<br>• Line 17 — fixture project มีเพียงตัวเดียว: `{ project: { id: 'p1', ..., workspace: { businessId: 'b1' } } }` (Business เดียวกับเป้าหมาย 'b1'); ไม่มี fixture project ที่มี businessId ต่างกัน<br>• `src/modules/business/application/business-strategy-service.js:8` — logic การกรอง `projectLink(project, businessId)`: `if (!project \|\| ownerId !== businessId) return null` — ไม่เคยถูก test นี้เรียกเข้า<br>• `tests/unit/business-strategy-service.test.js:36–38` — ทดสอบเฉพาะขอบล่างของจำนวน horizon (<2) ที่ layer นี้<br>• `src/modules/business/application/business-strategy-service.js:51` — ขอบบน (>3 horizons) ไม่มี unit test เฉพาะที่ layer นี้ ครอบคลุมทางอ้อมที่ layer ของ mutation-service ผ่าน assertHorizonCardinality เท่านั้น |
| **สิ่งที่ควรเป็น** | Test ที่อ้างว่าทดสอบ filtering behavior เฉพาะเจาะจง ควรมี fixture ที่จะ fail ถ้าไม่มีการกรองนั้นจริง; two-sided cardinality guard ควรมี coverage สมมาตรกันที่ layer ที่นิยามมันไว้ |
| **สิ่งที่เป็นจริง** | Fixture พิสูจน์ได้เพียงว่า goals/horizons ของ Business เดียวกัน serialize ถูกต้อง; เส้นทางการกรองข้าม Business และขอบบนของ horizon ยังไม่ถูกทดสอบที่ layer นี้ อาศัยเพียง write-time guard ใน module อื่นเพื่อป้องกัน state ที่จะทดสอบมันได้ |
| **ข้อเสนอแนะ** | เพิ่ม fixture project ที่สองด้วย `workspace: { businessId: 'b2' }` แล้ว assert ว่ามันถูกกรองออก; เพิ่ม case ที่มี 4 horizons ยืนยันว่า throw '2 or 3 horizons' เลียนแบบ case <2 ที่มีอยู่แล้ว |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-business-05 — ส่วน Public contract ของ charter ไม่ตั้งชื่อ export ใดของ src/modules/business เลย ต่างจาก pattern ที่ใช้ชัดเจนในที่อื่น

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | • `docs/domains/project-manager/CHARTER.md:88` — 'Public contract' ระบุเพียง `application/scope-service` และ envelope schema สองตัว ไม่มี entry สำหรับ export ของ src/modules/business<br>• Line 103 — bullet satellite-modules อธิบายว่า business ทำอะไร แต่ไม่บอกว่า domain อื่นควรเรียกมันอย่างไร (deep-import vs. named contract)<br>• ตรวจสอบขอบเขต: grep ทั่ว `src/` พบผู้ import `@/modules/business` เพียง 2 จุด (src/app/(pm)/overview/page.jsx และ src/app/api/business/strategy/route.js) ซึ่งทั้งคู่อยู่ใน owns_routes glob ของ project-manager อยู่แล้ว — ยังไม่มีการละเมิดขอบเขตข้าม domain วันนี้ |
| **สิ่งที่ควรเป็น** | เมื่อพิจารณา pattern เดิมของ charter (scope-service เป็น named public contract) ข้อความแบบเดียวกันสำหรับ getBusinessStrategy/buildBusinessHomeReadModel จะช่วยชี้ทางให้ผู้เรียกใช้ข้าม domain ในอนาคต |
| **สิ่งที่เป็นจริง** | วันนี้ไม่มีผู้ import ข้าม domain เลย ดังนั้นนี่เป็นเพียงช่องว่างด้านเอกสาร ไม่ใช่การละเมิดขอบเขตที่เกิดขึ้นจริง แต่การไม่มีคำแนะนำหมายความว่าการ import ในอนาคตอาจเกิดขึ้นได้โดยไม่มี context จาก charter เลย |
| **ข้อเสนอแนะ** | ถ้า export ของ src/modules/business ตั้งใจให้เป็น internal ของ project-manager เท่านั้น ให้ระบุไว้ใน charter อย่างชัดเจน; ถ้าตั้งใจให้ domain อื่นเรียกได้ในอนาคต (เช่น charter ของ market-intelligence คาดว่า Business Home จะ project market signals) ให้เพิ่มเข้ารายการ Public contract ตั้งแต่ตอนนี้ |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-business-06 — FEAT-002 (Business Home) ค้างสถานะ 'building' โดยไม่มี FR id ติดตาม scope ที่ยังเหลือ

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | PARTIAL |
| **หลักฐาน** | • `docs/FEATURES.md:24` — FEAT-002 สถานะ 'building'; รวม FR-041, FR-060; ระบุ "Goals & KPIs, Risks & Alerts, Reports later" (ไม่มี id)<br>• `docs/PRD-SDD-v1.0.md:251` — FR-041 สถานะ ✅<br>• Line 270 — FR-060 สถานะ ✅<br>• `docs/roadmap/ROADMAP.md` — ไม่พบ entry สำหรับ 'Goals & KPIs'/'Business Home' follow-up phase |
| **สิ่งที่ควรเป็น** | สถานะ FEAT ควรสะท้อน FR ที่รวมอยู่ (ทั้งคู่เสร็จแล้ว) หรือระบุชื่อสิ่งที่ยังเหลือด้วย id ตามวินัยของ ADR-039 ที่ใช้ในที่อื่น |
| **สิ่งที่เป็นจริง** | ทั้งสอง FR (041, 060) ✅ เสร็จสมบูรณ์แล้ว แต่ FEAT-002 ยังค้างที่ 'building' เพราะ scope ที่เหลือ ('Goals & KPIs, Risks & Alerts, Reports') ไม่มี FR/id — ไม่มีแถว registry ใดให้ flip เป็น 'live' ได้ ไม่มีทางให้ docs:preflight หรือ roadmap ตรวจจับการส่งมอบหรือการยกเลิกได้ |
| **ข้อเสนอแนะ** | ประกาศ FR id ชั่วคราวสำหรับ phase 'Goals & KPIs, Risks & Alerts, Reports' (แม้จะเป็น 🔜 not-started) เพื่อให้ FEAT-002 มี trigger ที่เป็นรูปธรรมสำหรับกลายเป็น 'live' หรือเพิ่มบรรทัดใน docs/roadmap/ROADMAP.md อธิบายว่าทำไม FEAT-002 ถูกจงใจค้างที่ 'building' อย่างไม่มีกำหนด |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED |

##### D2-domain-business-07 — field `domainKey` ของ attentionQueue() เป็น dead output — คำนวณแล้วแต่ไม่มี page หรือ test ใดใช้เลย

| ฟิลด์ | รายละเอียด |
|-------|-----------|
| **ระดับ** | LOW |
| **ประเภท** | PARTIAL |
| **หลักฐาน** | • `src/modules/business/application/business-home-read-model.js:123,134,148,157` — attentionQueue() ตั้งค่า `domainKey` ให้กับทุก queue item (gate/milestone/overdue-goal/unlinked-goal)<br>• `src/app/(pm)/overview/page.jsx:91` — AttentionCard's item.map อ่านเพียง item.href, item.severity, item.title, item.detail; ไม่เคยเข้าถึง item.domainKey เลย<br>• `tests/unit/fr060-business-home-read-model.test.js` — grep หา 'domainKey' ไม่พบผลลัพธ์เลย; field นี้ไม่มีการทดสอบ<br>• Line 148 ใน read model — goal-derived items hardcode `domainKey: 'projects'` ทั้งที่ item.detail บอกว่า "Strategy · ..." (ผิดความหมาย) |
| **สิ่งที่ควรเป็น** | Field ที่ read model คำนวณและใส่ไว้ใน output contract ควรถูกใช้โดยผู้เรียกเพียงรายเดียว หรือไม่ควรมีอยู่เลย เช่นเดียวกับ `health.covers` (line 212: `health.covers = scored.map(d => d.key)`) — page ไม่เคยอ่านมัน อ่านเพียง `health.coverageLabel` และ `health.domains` |
| **สิ่งที่เป็นจริง** | domainKey และ health.covers ถูกคำนวณทุกครั้งที่เรียกแต่ไม่เคยถูกอ่านโดย src/app/(pm)/overview/page.jsx; domainKey ยังผิดตามข้อเท็จจริงสำหรับ goal items ด้วย (hardcode 'projects' แทนที่จะเป็น sentinel 'strategy' หรือละไว้) รูปแบบนี้ตรงกับ silent drift ที่ non-owning-projection contract ของ SDD-033 มีไว้เพื่อป้องกัน |
| **ข้อเสนอแนะ** | เชื่อม domainKey เข้ากับ UI ของ attention list จริง (เช่น icon/badge หรือ filter ต่อ domain) และแก้ค่า goal-item ให้เป็น 'strategy' หรือไม่ก็ตัด field นี้ทิ้งพร้อมกับ health.covers จนกว่าจะมีผู้ใช้จริง ยืนยันโดยตาม trace ค่าที่ return ของ buildBusinessHomeReadModel เทียบกับผู้เรียกใช้เพียงรายเดียวใน src/app/(pm)/overview/page.jsx |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | verifier-added |

#### ข้อจำกัดการตรวจ

**Scope examined:** ไฟล์ 2 ไฟล์ใน src/modules/business (364 บรรทัด total) — business-strategy-service.js (145 บรรทัด) และ business-home-read-model.js (219 บรรทัด); ทั้ง charter ของ project-manager ที่อธิบายโมดูล (docs/domains/project-manager/CHARTER.md อ่านแบบ full); ทั้ง 3 FRs (FR-041, FR-043, FR-060) ตรวจสอบแบบ cross-check กับ PRD-SDD-v1.0.md, TRACE.md, FEATURE-MAP.md, DOMAIN-MAP.md, FEATURES.md และ feature notes ของแต่ละ FR; ไฟล์ 8 ไฟล์ใน src/app/api/business/** (อ่าน headers ของทั้ง 8); consuming page src/app/(pm)/overview/page.jsx (full read); src/config/domains.js ทั้งหมด (9 domain keys enumerated); ทั้ง 5 Prisma models ที่โมดูลนี้เข้าถึงใน schema.prisma และ schema.postgres.prisma (diffed — identical) บวก Supabase migration ที่เกี่ยวข้อง; unit tests ที่ import ไฟล์ของโมดูล (2 files); e2e spec ที่ชื่อว่า FR-060 evidence (full read) บวก fr041-business-first.spec.js API-contract test; integration test ที่ exercise read model route end-to-end; git log/show บน 3 commits (17b1dde, 501a67a, 4306a29) เพื่อยืนยันวันที่ charter section / e2e assertion / domain registry แต่ละอันเปลี่ยนครั้งสุดท้าย

**Not examined (out of scope — belongs to sibling finders):** Full project-manager charter's 24+ owned models อื่น ๆ (Portfolio, Workstream, WorkItem, Milestone, Gate, etc.); only 5 models ที่ src/modules/business จริง ๆ อ่าน (Business, BusinessRoadmap, BusinessRoadmapHorizon, BusinessGoal, ProjectGoal) ถูก audit สำหรับ ownership; `people` satellite module; full FR-059 mutation-service implementation (read enough to confirm it — not src/modules/business — เป็นเจ้าของ writes); market-intelligence's charter/model compliance (observed owns_models list ดูเหมือนล้าสมัยเมื่อเทียบกับ 2026-09-01 commit แต่นั่นเป็นการค้นหาของ domain-market-intelligence); identity's FR-061 feature note ที่มีตัวอย่างตาราล้าสมัย 'all 7 domains' (flagged สำหรับ domain-identity finder, ไม่ซ้ำที่นี่)

**Not run (read-only review rules):** npm test, npm run test:e2e, npm run docs:preflight, npm run docs:graph — Finding D2-domain-business-02 (stale e2e domain-count) is static/logical deduction from src/config/domains.js content และ read model logic, ไม่ได้ observed test failure

**Counts verified:** 2 files in src/modules/business (364 total lines); 3 FRs owned (FR-041, FR-043, FR-060); 9 Tier-2 domain keys in src/config/domains.js as of 2026-09-01 (8 non-self relative to Business Home); 0 cross-domain importers found; 0 writes from inside src/modules/business (confirmed pure-read/pure-calculator)

## domain-people

### domain-people

#### สรุปย่อ
- ✅ Core read-only directory ครบถ้วน: Service (listPeople), UI component, routes (GET /api/people, /people, /people/directory)
- ⚠️ Charter coverage ต่ำ: project-manager ระบุโมดูล/FR แต่ไม่เขียนชื่อ route/export/contract อย่างชัดเจน
- ❌ Write surface หายไป: ไม่มี UI ให้ OWNER เพิ่มคนใหม่ลงในฐาน Business แม้ว่า empty-state hint ชี้ไปที่ Platform
- ⚠️ Authorization gap: Server ไม่ตรวจสอบ per-Business domain grant (FR-061); guard อยู่ client-side เท่านั้น
- ⚠️ Test coverage: ขาด integration test (Prisma-backed); unit test บางส่วนเป็น string containment แทน behavioral test
- ⚠️ Membership.employeeRef: ประกาศไว้แต่ไม่มี writer ใดให้ค่า; ไม่เรนเดอร์บน UI

#### Inventory

| รายการ | สถานะ | หลักฐาน | หมายเหตุ |
|--------|-------|---------|---------|
| Charter coverage ของ src/modules/people (project-manager CHARTER.md 'Satellite modules' §) | PARTIAL | docs/domains/project-manager/CHARTER.md:98-107 | ประมาณ 10 บรรทัด ชื่อโมดูล/FR แต่ไม่มี route/export |
| Model: Membership (owns_models, ทั้ง schema) | IMPLEMENTED | prisma/schema.prisma:393-416 | ฟิลด์ที่สำคัญ: personId, tenantId, businessId, role, domainKeysJson, employeeRef, status |
| Model: Person (crm-owned, read-only join) | IMPLEMENTED | prisma/schema.prisma:154-186 | อ่านจาก crm; people-service ใช้เลือก id/code/displayName/email |
| Model: Branch (read โดย people-service) | IMPLEMENTED | src/modules/people/application/people-service.js:35 | นำค่า businessBranch/branchCode มาแสดง |
| Field: Membership.employeeRef | DECLARED_ONLY | prisma/schema.prisma:399 | ปรากฎในโครงสร้าง; ไม่มี writer แม่แบบใดเติมค่า |
| Service: listPeople | IMPLEMENTED | src/modules/people/application/people-service.js:7-55 | ฟังก์ชันเดียว; ตรวจสอบ visibleBusinessIds เท่านั้น |
| Component: PeopleDirectory.jsx | IMPLEMENTED | src/modules/people/components/PeopleDirectory.jsx:12-87 | ตารางคน 4 คอลัมน์ + KPI cards 3 ใบ |
| Route: GET /api/people | IMPLEMENTED | src/app/api/people/route.js:14-19 | เรียก listPeople(businessId) |
| Page: /people | PARTIAL | src/app/(pm)/people/page.jsx:1-9 | แสดง <PeopleDirectory /> เดียวกับ /people/directory |
| Page: /people/directory | IMPLEMENTED | src/app/(pm)/people/directory/page.jsx:1-9 | เรนเดอร์ <PeopleDirectory directoryOnly /> |
| Write surface: create membership | MISSING | src/app/api/platform/users/route.js (GET+PATCH only) | empty-state ของ People Directory ชี้ไปที่ Platform แต่ no POST handler |
| Server-side enforcement: per-Business domain grant | MISSING | src/app/api/people/route.js:16; src/app/api/_helpers.js | ไม่มี domainsForBusiness/isDomainVisible check |
| FR-042 ใน PRD-SDD registry | IMPLEMENTED | docs/PRD-SDD-v1.0.md:252 | "HR / People Directory: read-only Business view of Membership+Person" |
| FR-042 feature note | IMPLEMENTED | docs/domains/project-manager/features/FR-042-hr-people-peer-domain.md:1-23 | – |
| FR-042 row ใน TRACE.md | IMPLEMENTED | docs/TRACE.md:326-332 | – |
| FR-042 task ใน ROADMAP | IMPLEMENTED | docs/roadmap/ROADMAP.md:216 | – |
| Unit tests: people-service.test.js | IMPLEMENTED | tests/unit/people-service.test.js:1-45 | 2 cases (happy path, invisible Business); ยังขาด null/ARCHIVED business |
| Unit tests: people-route.test.js / people-directory.test.js | PARTIAL | tests/unit/people-route.test.js:1-13; people-directory.test.js:1-13 | String containment assertion; ไม่ได้ invoke handler/render component |
| Integration test: /api/people | MISSING | grep people tests/integration/ | ขาด Prisma-backed isolation test |
| E2E test: /api/people + UI | IMPLEMENTED | tests/e2e/fr041-business-first.spec.js:28-53 | Happy path เท่านั้น |
| crm charter disclosure ของ people's read | MISSING | docs/domains/crm/CHARTER.md (ค้นหา 'people') | ไม่มีกล่าวถึง |
| project-manager charter 'Known shared-write exceptions' | MISSING | docs/domains/project-manager/CHARTER.md:109-113 | เขียนแต่ AuditEvent เท่านั้น |
| identity charter 'Known shared-write exceptions' | MISSING | docs/domains/identity/CHARTER.md:113-121 | เขียนแต่ Person เท่านั้น |

---

#### Findings

##### D2-domain-people-08 — GET /api/people ไม่ตรวจสอบ per-Business domain grant; เพียง client-side guard เท่านั้น (หนึ่งใน instance ของช่องว่างทั้งโดเมน ดู D2-domain-identity-23)

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | MEDIUM |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | src/app/api/people/route.js:16 — ส่งเพียง viewer.visibleBusinessIds ไปให้ listPeople; ไม่มี domainsForBusiness/isDomainVisible check; src/modules/people/application/people-service.js:12 — gate เพียง visibleBusinessIds.includes(businessId); src/app/api/_helpers.js:19-36 — handle() ไม่มี domain logic; src/lib/business-shell-guard.js:17 — guard อยู่ client-side (pm layout) เท่านั้น; docs/PRD-SDD-v1.0.md:271 — FR-061 บอกว่า "route guard และ domain bar ต่างกันอ่าน per-Business answer" |
| **สิ่งที่ควรเป็น** | FR-061 กับ FR-038 และ SDD-017/034 ใช้ภาษาว่า "fails closed" / "denies domain visibility" สำหรับ per-domain grant — บ่งชี้ authorization boundary จริงๆ ไม่ใช่ UX filter เท่านั้น |
| **สิ่งที่เป็นจริง** | MEMBER ที่ Membership.domainKeysJson ไม่มี 'people' สำหรับ Business ที่เห็นได้ (businessId ใน visibleBusinessIds) ยังคงเรียก GET /api/people?businessId=<business นั้น> โดยตรง แล้วได้ข้อมูล People Directory เต็มๆ — นี่คือ instance เดียวของช่องว่างที่เป็นระบบทั้งโดเมน (ทุก Business-scoped API route ในระบบไม่ตรวจสอบ domain grant เลย เห็นได้จาก D2-domain-identity-23 ซึ่งเป็น root cause ที่แท้จริง — ไม่ใช่แค่ people) |
| **ข้อเสนอแนะ** | แก้ไข D2-domain-identity-23 (shared helper สำหรับทุก Business-scoped route) จะปิด finding นี้ไปด้วย; ถ้าต้องแก้เฉพาะ people ก่อน เพิ่ม domainsForBusiness(viewer, businessId).includes('people') check ใน route.js |
| **เกี่ยวข้อง** | D2-domain-identity-23 |
| **การตรวจสอบ** | ADJUSTED (severity HIGH → MEDIUM: demoted to a single instance of the domain-wide gap now filed as D2-domain-identity-23) |

---

##### D2-domain-people-05 — ไม่มี write surface ให้ OWNER เพิ่มคนใหม่เข้า Business workforce; empty-state hint ชี้ไปที่ Platform capability ที่ไม่มีตัวตน

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | MEDIUM |
| **ประเภท** | MISSING_SURFACE |
| **หลักฐาน** | src/modules/people/components/PeopleDirectory.jsx:46 — EmptyState: "Add a membership from Platform when workforce data is ready."; src/app/api/platform/users/route.js:13-21 — GET (listUserPermissions) + PATCH (updateUserPermissions) เท่านั้น, ไม่มี POST; src/app/(pm)/platform/users/page.jsx:32 — mutating call ชี้เพียง PATCH /api/platform/users กับ existing membershipId, ไม่มี 'add person' form; src/modules/identity/onboarding-service.js:213 — signup สร้าง WorkspaceMembership (ไม่ใช่ Membership), identity charter ว่า WorkspaceMembership "widens nothing"; src/modules/project-manager/application/project-team-service.js:110 — addProjectTeamMember เป็นเส้นทาง Membership.create เดียวนอก Business-creation, ต้อง Project + existing Person |
| **สิ่งที่ควรเป็น** | Directory ที่ empty-state บอกให้ไปที่ Platform เพื่อเพิ่ม membership ควรมี Platform surface ที่ทำได้ |
| **สิ่งที่เป็นจริง** | Platform > Users & permissions สามารถแก้ไข role/domainKeys ของ existing Membership เท่านั้น (PATCH); ไม่มีที่ไหนในผลิตภัณฑ์ (Platform, People, อื่นๆ) ที่ OWNER สร้าง fresh Membership โดยตรง; paths เดียว 2 สายคือ (a) automatic OWNER row ที่ Business-creation (b) Development > Project Team flow |
| **ข้อเสนอแนะ** | สร้าง 'add person to Business' surface ใน People หรือ Platform ให้จริง, หรือเปลี่ยนข้อความ hint ให้ชี้ไปที่ flow ที่มีจริง (Development > Project Team) จนกว่าจะสร้าง surface ตัวจริง |
| **เกี่ยวข้อง** | D2-domain-people-02 |
| **การตรวจสอบ** | CONFIRMED |

---

##### D2-domain-people-06 — identity's profile-permission-service เขียน Membership (project-manager-owned) โดยไม่มี charter disclosure เหมือนที่ใช้สำหรับ Person write

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | MEDIUM |
| **ประเภท** | BOUNDARY_VIOLATION |
| **หลักฐาน** | src/modules/identity/profile-permission-service.js:145 — await db.membership.update({ data: { role, domainKeysJson } }), audited at line 149; docs/domains/project-manager/CHARTER.md:41 — Membership ใน owns_models; lines 109-113 — Known shared-write exceptions ชื่อเพียง AuditEvent; docs/domains/identity/CHARTER.md:113-119 — identity's exceptions ชื่อเพียง Person, ไม่ชื่อ Membership |
| **สิ่งที่ควรเป็น** | Architecture นี้มี pattern ที่ทำงาน identity ประกาศ Person write ของตัวเอง (บันทึกในทั้ง charter); ควรใช้วินัยเดียวกันสำหรับ write ลงใน project-manager model |
| **สิ่งที่เป็นจริง** | Membership.role/domainKeysJson write มีจริง, zod-validated, audited, แต่ไม่ชื่อเป็น shared-write exception ใน charter ไหน; doc-preflight ตรวจ owns_models กับ schema เท่านั้น ไม่ scan source for cross-domain prisma writers, ดังนั้น gap นี้ไม่เห็นใน governance |
| **ข้อเสนอแนะ** | เพิ่ม 'Known shared-write exceptions' entry ใน project-manager + identity charter ชื่อ write นี้ (mirror Person exception wording), หรือย้าย mutation ไปใน project-manager service (เช่น scope-service export) ให้ identity เรียก แทนสัมผัส Prisma โดยตรง |
| **เกี่ยวข้อง** | D2-domain-people-14 |
| **การตรวจสอบ** | CONFIRMED |

---

##### D2-domain-people-10 — people-route.test.js และ people-directory.test.js ตรวจสอบ raw source text ไม่ใช่ running handler/rendered component

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | MEDIUM |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | tests/unit/people-route.test.js:5 — readFileSync → expect(route).toContain('resolveRequestViewer(request)') string containment; ไม่ invoke GET(); tests/unit/people-directory.test.js:5 — readFileSync → expect(view).toContain('People Directory') string containment; ไม่ render component |
| **สิ่งที่ควรเป็น** | Unit test สำหรับ route/component ordinarily invoke GET(request) ด้วย mock request และ assert JSON body, หรือ render() + assert DOM, ให้ match style ของ people-service.test.js |
| **สิ่งที่เป็นจริง** | Tests ยังคง pass ถ้า identifiers reorder/comment ต่างกัน, หรือถ้า handler silent return wrong data — ตราบใดที่ substrings อยู่ในไฟล์ text; พิสูจน์ annotation/wiring convention ไม่ใช่ behavior |
| **ข้อเสนอแนะ** | เพิ่ม behavioral test ที่เรียก GET(request) ด้วย mocked resolveRequestViewer + assert JSON body; เพิ่ม render() test สำหรับ PeopleDirectory ด้วย mocked useFetch/ScopeContext |
| **เกี่ยวข้อง** | D2-domain-people-11 |
| **การตรวจสอบ** | CONFIRMED |

---

##### D2-domain-people-01 — project-manager charter อธิบาย people แค่ 1 ย่อหน้า ไม่มีชื่อ route/contract อย่างชัดเจน

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | LOW |
| **ประเภท** | PARTIAL |
| **หลักฐาน** | docs/domains/project-manager/CHARTER.md:98-107 — 'Satellite modules' section บอก FR-042 + pattern เท่านั้น, ไม่ชื่อ route/export; lines 86-96 — Public contract ชื่อ scope-service + schema contracts แต่ไม่ชื่อ people-service/listPeople |
| **สิ่งที่ควรเป็น** | Charter ควรให้ reader ค้นหา module's routes และ exported surface โดยไม่ต้อง re-derive จาก source |
| **สิ่งที่เป็นจริง** | Charter ชื่อ pattern (read-only Membership+Person join) + FR แต่ route 3 สาย (/api/people, /people, /people/directory), export (listPeople), component (PeopleDirectory.jsx) ไม่ชื่อ; owns_routes glob ให้ coverage แต่ไม่ explicit charter text |
| **ข้อเสนอแนะ** | เพิ่มชื่อ 3 route paths + listPeople export ใน people paragraph ของ CHARTER.md ให้ module discoverable จาก charter โดยตรง |
| **เกี่ยวข้อง** | D2-domain-people-13 |
| **การตรวจสอบ** | CONFIRMED |

---

##### D2-domain-people-02 — Membership.employeeRef ประกาศแต่ไม่มี writer ใดเติมค่า ทำให้ null เสมอทุก environment

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | LOW |
| **ประเภท** | BROKEN_FLOW |
| **หลักฐาน** | prisma/schema.prisma:399 — employeeRef String?; src/modules/people/application/people-service.js:32, 44 — select + return employeeRef; src/modules/project-manager/application/project-team-service.js:119 — Membership.create data: { personId, tenantId, businessId, role } (no employeeRef); src/modules/project-manager/application/scope-service.js:231 — data: { personId, tenantId, role } (no employeeRef); grep employeeRef prisma/seed.js → ไม่ match |
| **สิ่งที่ควรเป็น** | Schema column ที่ query + surface ผ่าน API response ควร populate โดย writer อย่างน้อยที่สุด (seed, import, หรือ UI form) |
| **สิ่งที่เป็นจริง** | grep employeeRef ใน src/**, prisma/seed.js, scripts/ → เพียง schema declaration + read เท่านั้น; ทุก Membership.employeeRef null เสมอทุก environment |
| **ข้อเสนอแนะ** | ลวดเครื่องเขียน real (เช่น HR/employee-code field บน Platform 'add membership' surface), หรือลบ column + read จนกว่าจะมี surface นั้น |
| **เกี่ยวข้อง** | D2-domain-people-03, D2-domain-people-05 |
| **การตรวจสอบ** | CONFIRMED |

---

##### D2-domain-people-03 — employeeRef return จาก GET /api/people แต่ UI ที่ consume response ไม่ render มัน

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | LOW |
| **ประเภท** | BROKEN_FLOW |
| **หลักฐาน** | src/modules/people/application/people-service.js:44 — employeeRef: membership.employeeRef ใน people[] array; src/modules/people/components/PeopleDirectory.jsx:49-55 — table header เพียง Person/Role/Scope/Branch; lines 61-74 — row renderer อ่าน entry.person/role/businessScope/branch เท่านั้น, entry.employeeRef never referenced |
| **สิ่งที่ควรเป็น** | Field ที่ deliberately select + shape สำหรับ API response ควรเข้า UI consumer เพียงอย่างเดียว |
| **สิ่งที่เป็นจริง** | PeopleDirectory (GET /api/people consumer เพียงอย่างเดียว) drop employeeRef on floor — รวมกับ finding 02, field dead ต่าง write และ display |
| **ข้อเสนอแนะ** | Fix เดียวกับ D2-domain-people-02: เพิ่ม Employee ref column เมื่อ field populate จริงๆ, หรือลบจาก read model |
| **เกี่ยวข้อง** | D2-domain-people-02 |
| **การตรวจสอบ** | CONFIRMED |

---

##### D2-domain-people-04 — 'Dashboard' และ 'People Directory' nav entries render byte-identical content ขัดแย้ง doc ที่บอก distinct workforce summary

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/SITEMAP-DOMAIN-NAV.md:224 — 'HR / People' ชื่อ '1. Dashboard — Business workforce summary' + '2. People Directory — Person/Membership records' เป็น 2 distinct items; src/config/domains.js:74 — Dashboard → /people, People Directory → /people/directory; src/app/(pm)/people/page.jsx:8 — renders <PeopleDirectory /> (directoryOnly=false); src/app/(pm)/people/directory/page.jsx:8 — renders <PeopleDirectory directoryOnly /> (PeopleDirectory.jsx:29 ต่างแค่ title) |
| **สิ่งที่ควรเป็น** | Per doc + Development domain pattern (FR-086: Projects' Dashboard ≠ resource list, docs/PRD-SDD-v1.0.md:296), Dashboard ควรเป็น distinct workforce-summary view |
| **สิ่งที่เป็นจริง** | PeopleDirectory branch directoryOnly ต่างแค่ <PageHeader title>; 3 Kpi cards + full table เหมือนกันทั้ง /people + /people/directory |
| **ข้อเสนอแนะ** | สร้าง real Dashboard-level summary (เช่น headcount by branch/role trend) distinct จาก row-level Directory, หรือ collapse 2 nav entries เป็น 1 + fix SITEMAP |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED |

---

##### D2-domain-people-07 — knowledge's project-graph.js/query.js อ่าน Membership โดยไม่มี cross-domain-read disclosure ใน charter

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | src/modules/knowledge/project-graph.js:79 — prisma.membership.findMany(...); query.js:42 — prisma.membership.findMany(...); docs/domains/project-manager/CHARTER.md — ค้นหา 'knowledge' ไม่เจอ |
| **สิ่งที่ควรเป็น** | Per architecture §5.3 pattern project-manager charter เรียก, cross-domain read allowed แต่ต้อง visible + disclosed, ไม่เป็น incidental direct query |
| **สิ่งที่เป็นจริง** | Reads architecturally permitted ดังนั้นไม่ violation ตัวตนเอง, แต่ unlike people/Person read (named อย่างชัดเจน ใน project-manager charter lines 105-107), read นี้ undocumented ทั้ง project-manager + knowledge charter ดังนั้น doc graph ไม่เห็น dependencies |
| **ข้อเสนอแนะ** | เพิ่ม one-line disclosure ใน docs/domains/knowledge/CHARTER.md ชื่อ read นี้, mirror people's disclosure |
| **เกี่ยวข้อง** | D2-domain-people-06 |
| **การตรวจสอบ** | CONFIRMED |

---

##### D2-domain-people-09 — listPeople 'Business not found' + ARCHIVED-business branches ไม่มี test coverage

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | LOW |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | src/modules/people/application/people-service.js:20 — if (!business \|\| business.status === 'ARCHIVED') throw new Error('Business not found'); tests/unit/people-service.test.js:32 — 2 it() blocks (happy path + invisible Business) ไม่ exercise null/ARCHIVED |
| **สิ่งที่ควรเป็น** | Guard clause แต่ละสายใน security-relevant read path ordinarily ได้ direct test, sibling 'invisible Business' branch มีแล้ว |
| **สิ่งที่เป็นจริง** | dbFor() business.findUnique return live ACTIVE business; ไม่มี test supply null/ARCHIVED |
| **ข้อเสนอแนะ** | เพิ่ม 2 cases ใน people-service.test.js: null business (expect 'Business not found') + ARCHIVED status (เดียวกัน) |
| **เกี่ยวข้อง** | — |
| **การตรวจสอบ** | CONFIRMED |

---

##### D2-domain-people-11 — No tests/integration coverage exercise /api/people กับ real Prisma-backed database

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | LOW |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | tests/integration/ ค้นหา 'people' → unrelated projects-dashboard.test.js (matched on prose); tests/e2e/fr041-business-first.spec.js:44 — เพียง status 200 + business.code check เท่านั้น |
| **สิ่งที่ควรเป็น** | Business-scoped read endpoint ordinarily มี integration test verify tenant/business isolation ด้วย real Prisma (เช่น business-strategy-route.test.js FR-041 sibling มี tests/integration/fr059-business-strategy-mutation.test.js) |
| **สิ่งที่เป็นจริง** | People มี unit (fake db) + e2e (1 happy-path) แต่ไม่ integration-tier test verify isolation |
| **ข้อเสนอแนะ** | เพิ่ม tests/integration/people-directory.test.js seed 2 tenants/Businesses ด้วย real test DB, assert isolation end-to-end |
| **เกี่ยวข้อง** | D2-domain-people-10 |
| **การตรวจสอบ** | CONFIRMED |

---

##### D2-domain-people-12 — crm's charter ไม่ disclose ว่า people module อ่าน Person model

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/domains/crm/CHARTER.md:4-90 — owns_models: Person, ... ไม่มี Boundaries/reader section ชื่อ people; docs/domains/project-manager/CHARTER.md:105 — project-manager charter document read one-sidedly |
| **สิ่งที่ควรเป็น** | Cross-domain dependency disclosed ใน charter ไหนควรค้นหา from owning charter ด้วย เพื่อ change audit Person shape |
| **สิ่งที่เป็นจริง** | เพียง project-manager charter ชื่อ dependency; crm silent |
| **ข้อเสนอแนะ** | เพิ่ม cross-reference ใน crm CHARTER.md Boundaries ชื่อ people module read |
| **เกี่ยวข้อง** | D2-domain-people-01 |
| **การตรวจสอบ** | CONFIRMED |

---

##### D2-domain-people-13 — project-manager charter 'Public contract' list ไม่ชื่อ people's listPeople export

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | LOW |
| **ประเภท** | PARTIAL |
| **หลักฐาน** | docs/domains/project-manager/CHARTER.md:86 — Public contract ชื่อ application/scope-service + contracts, ไม่มี people-service; src/modules/people/application/people-service.js:7 — export listPeople ที่เดียว; grep '@/modules/people' across src/ → เพียงโมดูลส่วนตัว import เท่านั้น |
| **สิ่งที่ควรเป็น** | Charter Public contract section ควรเป็นที่ future consumer มองหา |
| **สิ่งที่เป็นจริง** | เพราะ charter silent ไม่มี charter-level signal บอก listPeople มี/ไม่มี meant to reuse |
| **ข้อเสนอแนะ** | เพิ่ม listPeople ใน Public contract (ถ้า meant to reuse) หรือเพิ่ม 'internal-only' note ให้ชัดว่า decision ไม่ใช่ oversight |
| **เกี่ยวข้อง** | D2-domain-people-01 |
| **การตรวจสอบ** | CONFIRMED |

---

##### D2-domain-people-15 — TRACE.md's FR-042 test list รวม generic entry-routing contract tests ที่ไม่ reference people/Membership logic

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | docs/TRACE.md:332 — FR-042 Tests include fr045/fr046-api-ui-contract.test.js; grep 'people' tests/unit/fr046-api-ui-contract.test.js → ไม่เจอ (test /api/entry + /api/auth/login); src/app/(pm)/overview/page.jsx:324 — inline comment 'FR-042 people' on FR-060 block → inflate union |
| **สิ่งที่ควรเป็น** | Reader trust TRACE.md Tests column เพื่อ gauge FR-042 proof coverage ควรว่า tests exercise People Directory |
| **สิ่งที่เป็นจริง** | TRACE.md generate-by-union-of-tagged-files → list tests inflate apparent breadth โดยไม่ add real people-specific coverage |
| **ข้อเสนอแนะ** | Worth note for anyone use TRACE.md Tests as coverage proxy — real people-specific tests คือ findings 09-11 เท่านั้น |
| **เกี่ยวข้อง** | D2-domain-people-10, D2-domain-people-11 |
| **การตรวจสอบ** | CONFIRMED |

---

##### D2-domain-people-16 — listPeople ไม่ filter Membership.status ดังนั้น non-ACTIVE Membership ยังคงแสดง active workforce row

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | LOW |
| **ประเภท** | PARTIAL |
| **หลักฐาน** | src/modules/people/application/people-service.js:22 — where clause filter tenantId/businessId เท่านั้น, ไม่ status, select ไม่ return status; src/modules/identity/resolve-viewer.js:161 — filter `status: 'ACTIVE'` โดย authorization resolver, line 62 เดียวกัน; prisma/schema.prisma:402 — @@index([personId, status]) + @@index([tenantId, status]) ที่สร้างสำหรับ filter status |
| **สิ่งที่ควรเป็น** | Membership.status = field ที่ rest codebase (resolve-viewer.js) ใช้ decide membership confer access, schema มี indexes สำหรับ filter นั้น, workforce listing built on same model ควรซ่อน deactivated Membership เหมือน authorization |
| **สิ่งที่เป็นจริง** | listPeople return ทุก Membership match tenant/business scope regardless status ดังนั้นถ้า status set away from ACTIVE ยังคง show as current person ใน People Directory แม้ resolveViewer treat same row as not conferring access |
| **ข้อเสนอแนะ** | เพิ่ม `status: 'ACTIVE'` ใน listPeople where clause, mirror resolve-viewer.js pattern, ทั้ง 2 views Membership ไม่ disagree |
| **เกี่ยวข้อง** | D2-domain-people-02 |
| **การตรวจสอบ** | verifier-added |

---

##### D2-domain-people-18 — people-service.js hardcode Business-status string 'ARCHIVED' แทน source จาก src/lib/validation/enums.js

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | LOW |
| **ประเภท** | DOC_DRIFT |
| **หลักฐาน** | src/modules/people/application/people-service.js:20 — `business.status === 'ARCHIVED'` bare string literal; src/lib/validation/enums.js — grep 'BUSINESS_STATUS' / 'MEMBERSHIP_STATUS' → ไม่เจอ, ไม่มี export สำหรับ Business/Membership status ต่างจาก PROJECT_STATUSES/WORKSTREAM_STATUSES/GOAL_STATUSES ฯลฯ |
| **สิ่งที่ควรเป็น** | Per CLAUDE.md convention 'Enums are strings in database, src/lib/validation/enums.js single source of truth', status value compared ใน application code ควร come from exported constant |
| **สิ่งที่เป็นจริง** | Business/Membership status ไม่มี enums.js entry; ทุก comparison (people-service.js, resolve-viewer.js) bare string literal, exception ต่อ convention |
| **ข้อเสนอแนะ** | เพิ่ม BUSINESS_STATUSES + MEMBERSHIP_STATUSES exports ใน enums.js, point people-service 'ARCHIVED' + resolve-viewer 'ACTIVE' comparisons ที่พวกมัน |
| **เกี่ยวข้อง** | D2-domain-people-09 |
| **การตรวจสอบ** | verifier-added |

---

##### D2-domain-people-19 — No test exercise listPeople missing-businessId error path

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | LOW |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | src/modules/people/application/people-service.js:11 — `if (!businessId) throw new Error('businessId is required')`; tests/unit/people-service.test.js:32 — ทั้ง 2 it() blocks call listPeople('b1', ...) businessId always supplied, ไม่มี undefined/empty call |
| **สิ่งที่ควรเป็น** | Guard clause แต่ละสายใน small security-relevant function ordinarily ได้ own test case |
| **สิ่งที่เป็นจริง** | Missing-businessId branch (+ GET /api/people ไม่มี ?businessId=) ไม่มี test coverage ที่ไหน |
| **ข้อเสนอแนะ** | เพิ่ม case ใน people-service.test.js call listPeople(undefined, ...) + assert 'businessId is required', ตัดกับ null/ARCHIVED cases จาก finding D2-domain-people-09 |
| **เกี่ยวข้อง** | D2-domain-people-09 |
| **การตรวจสอบ** | verifier-added |

---

##### D2-domain-people-14 — doc-preflight's boundary check validate owns_models against schema, ไม่ validate actual cross-domain writers in source

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | INFO |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | scripts/doc-preflight.mjs:301 — parse charter owns_models; :306 — check ว่าคำกล่าว model ที่ absent จาก prisma/schema.prisma |
| **สิ่งที่ควรเป็น** | Given codebase treat charter/model ownership as enforced (D2-domain-people-06 finding), governance check ที่ detect cross-domain prisma.<model>.write() call ทำให้ finding D2-domain-people-06 self-report |
| **สิ่งที่เป็นจริง** | ไม่มี check นี้; docs/.preflight-report.json zero 'people' mentions, identity's Membership write pass silent |
| **ข้อเสนอแนะ** | Extend doc-preflight.mjs grep each module's files สำหรับ `prisma.<ownedModel>` write calls (create/update/upsert/delete) นอก owning module, flag if not listed 'Known shared-write exceptions' |
| **เกี่ยวข้อง** | D2-domain-people-06 |
| **การตรวจสอบ** | CONFIRMED |

---

##### D2-domain-people-17 — Finding นี้ low-impact เพราะ no code path set Membership.status away from ACTIVE default

| ฟิลด์ | รายละเอียด |
|------|---------|
| **ระดับ** | INFO |
| **ประเภท** | TEST_GAP |
| **หลักฐาน** | src/modules/project-manager/application/project-team-service.js:133 — other Membership.update write role เท่านั้น, ไม่ status; src/modules/identity/profile-permission-service.js:147 — write role/domainKeysJson, ไม่ status |
| **สิ่งที่ควรเป็น** | Context note สำหรับผู้สร้าง 'remove person from Business' surface (implied by D2-domain-people-05): surface นั้นต้อง update listPeople path (หรือ read จะ silent drift จาก write) |
| **สิ่งที่เป็นจริง** | ไม่มี Membership deactivate/remove flow ใน src (เพียง WorkspaceMembership มี via workspace-membership-service.js) ดังนั้น D2-domain-people-16 dormant จนกว่า flow ship |
| **ข้อเสนอแนะ** | เมื่อ Business-scoped Membership removal/deactivation feature สร้าง, ลวด listPeople status filter (D2-domain-people-16) in same change, ไม่หลัง |
| **เกี่ยวข้อง** | D2-domain-people-16, D2-domain-people-05 |
| **การตรวจสอบ** | verifier-added |

---

#### ข้อจำกัดการตรวจ

**Coverage scope:** Finder ได้อ่าน src/modules/people/ source files ทั้งหมด (people-service.js, PeopleDirectory.jsx), routes/pages 3 ไฟล์, unit tests 3 ไฟล์, charter/docs 8 documents (TRACE, PRD-SDD, ROADMAP, SITEMAP, feature note, ADR-013), plus related charters (project-manager, identity, crm, knowledge). Total ~54 source lines ใน people module, ประมาณ 71 test lines.

**Verification method:** Verifier ได้ verify ทั้ง 15 finder findings via direct file:line inspection + broader codebase grep (zero external importers; zero API routes using domainsForBusiness; exactly 2 Membership.create call sites; doc-preflight.mjs boundary logic confirm). ทั้ง 15 findings CONFIRMED.

**Limitations:** 
- ไม่ run npm test, npm run build, docs:graph/preflight (read-only constraint) — ทุกหลักฐาน static (grep/read)
- ไม่ trace complete Person-write history (onboarding-service, signup-service) — verify เพียงพอว่าไม่ create Business-scoped Membership
- ไม่ open full resolve-viewer.js, classify-principal.js, rbac-service.js — grep confirm แต่ reader ไม่ reviewer

**Module characteristics:** Very small (2 source files = listPeople + PeopleDirectory, zero writers), chartered but minimally (1 paragraph 10 lines vs sibling module 100+ line charters). 15 findings from finder + 4 verifier-added = 19 total; none REFUTED/ADJUSTED — finder precision high. Most consequential: D2-domain-people-08 (HIGH, product-wide authorization gap), D2-domain-people-05/06 (MEDIUM, write surface + charter disclosure missing/gap).

## ข้อเสนอแนะเรียงตามลำดับความสำคัญ

### ก. ทำได้ทันทีในโค้ด (ไม่ต้องรอ migration หรือการอนุมัติจากเจ้าของผลิตภัณฑ์)

1. เพิ่มการตรวจสอบ enum ที่ `set_customer_lifecycle` (`zCustomerLifecycle.parse(payload.lifecycleStage)`) และประกาศ `CONVERSATION_STATUSES` ใน `src/lib/validation/enums.js` แล้วแก้ `close_conversation` ให้ใช้ค่าจาก enum — ปิด **D2-domain-crm-04, D2-domain-crm-05** (ไฟล์: `src/modules/agent/write-tools.js`, `src/lib/validation/enums.js`)
2. แก้ `saveLineGroup`/`saveLineUser` ให้ scope การค้นหาแถวเดิมด้วย `businessId` ไม่ใช่แค่ `tenantId`, และปฏิบัติต่อ businessId ที่ไม่ตรงกันเป็น conflict (409) พร้อมเพิ่ม regression test — ปิดช่องโหว่ความปลอดภัย **D2-domain-integration-verifier-29, D2-domain-integration-verifier-30** (ไฟล์: `src/modules/integration/application/line-registry-service.js`)
3. รวม provider code `'line-oa'` ให้ใช้ `LINE_OA_PROVIDER_CODE` (`'LINE_OA'`) เดียวกันทั่วทั้ง `line-registry-service.js` — ปิด **D2-domain-integration-05, D2-domain-integration-06**
4. สร้าง shared helper (เช่น `requireDomainGrant(viewer, businessId, domainKey)`) แล้วเพิ่มการเรียกใช้ในทุกเส้นทาง API ที่ Business-scoped ทั่ว repo ไม่ใช่แค่ `GET /api/people` — ปิด **D2-domain-identity-23, D2-domain-people-08** (ไฟล์เริ่มต้น: `src/app/api/people/route.js`; ต้องสำรวจเส้นทาง Business-scoped อื่นทั้งหมดด้วย)
5. เพิ่ม `owns_routes` glob ที่ขาดหายไปในหลาย charter (`src/app/api/crm/**`, `src/app/api/pipelines/**`, `src/app/api/ingest/documents/**`, `src/app/(pm)/market/**`) แล้วรัน `npm run docs:graph` — ปิด **D2-domain-crm-09, D2-domain-integration-08, D2-domain-integration-09, D2-domain-market-intelligence-11, D2-domain-knowledge-12** (หมายเหตุ: การเพิ่ม glob ของ sibling charter เหล่านี้ **ไม่ปิด** D2-domain-project-manager-01 — นั่นคือ catch-all ของ project-manager เอง (`src/app/api/**` + `src/app/(pm)/**`) ซึ่งต้องแก้แยกต่างหาก ดูข้อ ค.26)
6. แก้ไข `src/app/api/agent/heartbeat/route.js`: ลบ `@req FR-080`/`@spec ADR-032`/`@tested` ที่อ้างผิด, เพิ่ม `resolveRequestViewer` check ก่อน POST/DELETE ทุกครั้ง (ปัจจุบัน DELETE ไม่มี auth เลยและล้าง registry ทั้งหมดได้ถ้าไม่ระบุ `deviceId`), แก้ error path ให้คืน status code ที่ถูกต้องแทน 200 เสมอ, ย้าย write เข้า application service พร้อมเรียก `recordAudit` — ปิด **D2-domain-agent-02, D2-domain-agent-17**
7. แก้ `tests/e2e/fr060-business-home.spec.js:29` ให้ assert จำนวน domain แบบอ่านจาก `src/config/domains.js` แทน hardcode `/of 7 domains/`, และอัปเดตข้อความ prose ที่ยังบอก "7 operational domains" ใน `docs/INTERFACE-INVENTORY.md` ทั้ง 5 จุด (บรรทัด 130, 201 "Source `DOMAINS` entries" 8→9, 202 "Operational domain keys" 7→8, 204 "Source sub-domain entries" 23→27, 205 "Operational sub-domain entries" 22→26, และ 251) — และ `docs/SITEMAP-DOMAIN-NAV.md` — ปิด **D2-domain-business-02, D2-domain-business-03, D2-domain-market-intelligence-13**
8. อัปเดตทะเบียนสถานะที่ล้าสมัย: `docs/FEATURES.md` FEAT-002 → 'live' (FR-041/060 เสร็จแล้ว), แก้ 9 feature notes ของ project-manager ที่ยัง Candidate/Proposed/Declared, แก้ `FEATURES.md` FEAT-011 `primaryDomain`, แก้ feature note status ของ FR-099/100/101 — ปิด **D2-domain-project-manager-02, D2-domain-project-manager-07, D2-domain-business-06, D2-domain-integration-14, D2-domain-integration-15**
9. แก้ไข `docs/domains/knowledge/CHARTER.md` ให้ระบุว่า FR-110 มีโค้ดจริงแล้ว (`published-snapshot-contract.js`, 154 บรรทัด) และขยายส่วน Public contract ให้ครบ 13+ exports ที่ `index.js` ส่งออกจริง — ปิด **D2-domain-knowledge-01, D2-domain-knowledge-07**
10. ลบหรือ wire `marketplace-listing-adapter.js`/`retail-price-adapter.js` ที่เป็น dead code, ลบ/ใช้งาน `productQuery`/`priceObservationRepo` ที่ไม่ถูกใช้ใน `SupplierIntelligenceService` — ปิด **D2-domain-integration-04, D2-domain-market-intelligence-18, D2-domain-market-intelligence-21**
11. เพิ่ม Version/Status control block (frontmatter) ให้ครบทั้ง 8 domain charter (agent, crm, identity, integration, knowledge, market-intelligence, platform-control, project-manager) ในการแก้ไขครั้งเดียว — ปิด **D2-domain-agent-19, D2-domain-crm-20, D2-domain-identity-19, D2-domain-integration-25, D2-domain-knowledge-17, D2-domain-market-intelligence-23, D2-domain-platform-control-10, D2-domain-project-manager-14**
12. เพิ่ม `@req`/`@spec`/`@tested` annotation ให้ 7 ไฟล์ที่ไม่มีเลยใน src/modules/project-manager (ProgressExplain.jsx, StatusSelect.jsx, WorkItemModal.jsx, WorkpackageModal.jsx, WorkstreamModal.jsx, PlanImportPanel.jsx, universal/DependenciesView.jsx) — ปิด **D2-domain-project-manager-18**
13. เพิ่ม Inventory row สำหรับ FR-121 (DECLARED_ONLY) และ FR-122 (IMPLEMENTED) ใน domain-identity, และแก้ `docs/domains/agent/prompt-engineering.md:10` ให้ชี้ไปที่ `src/modules/project-manager/import/plan-schema.js` แทน path ที่ถูกลบไปแล้ว — ปิด **D2-domain-identity-24, D2-domain-agent-18**

### ข. ต้องมี migration หรือ production gate

14. เพิ่ม Postgres service container ใน `.github/workflows/governance.yml` (ตั้งค่า `ZURI_TEST_POSTGRES_URL` และตัวแปรที่เกี่ยวข้อง) เพื่อให้ `*.postgres.test.js` ทั้งหมดรันจริงในทุก PR แทนที่จะ self-skip เสมอ — ปิด **D2-domain-agent-07, D2-domain-knowledge-09, D2-domain-integration-20, D2-domain-identity-17**
15. ผูก `createAgentPorts()` (MSP transport + GenesisBlockDB graph reader) เข้ากับ `createPhase1BusinessAgentPortsFromEnv` ที่ webhook จริงใช้งาน ก่อนถือว่า FR-029/FR-024 เสร็จสมบูรณ์ในทางปฏิบัติ — ปิด **D2-domain-agent-01, D2-domain-knowledge-02, D2-domain-knowledge-03, D2-domain-knowledge-04**
16. เพิ่ม trigger จริง (route, admin action หรือ queue consumer) ให้ `knowledge-ingestion-executor.js` เรียก `runKnowledgeIngestionStagesWithTrace` (stage-runner.js) ก่อนถือว่า FR-109/FR-111..FR-119 เสร็จสมบูรณ์ในทางปฏิบัติ — ปิด **D2-domain-knowledge-06, D2-domain-knowledge-16**
17. เปิดเส้นทางเรียกใช้ `erasePrincipal` จริง (operator/owner-facing route เช่น `/api/platform/users/[id]/erase` หรือ script ที่มีการอนุมัติ) ก่อนถือว่า FR-022/FR-095 PDPA erasure ใช้งานได้จริงในโปรดักชัน — ปิด **D2-domain-identity-09**
18. เพิ่ม GET/list endpoint ให้ `PlatformGrant` และ `ApiAccessKey` (เพื่อให้ดูว่าใครถือสิทธิ์ และหา id เพื่อ revoke ได้) พร้อม DELETE endpoint สำหรับ `PlatformGrant` — ปิด **D2-domain-identity-10, D2-domain-identity-22**
19. เดินหน้าปิด external gate ที่เอกสารระบุไว้แล้วว่ายังไม่ทำ (FR-052 canary/destination gate, FR-054 provider evaluation + signed canary, FR-123 Supabase migration/client registration/device-binding, FR-097 provider-side evidence) — ปิด **D2-domain-knowledge-10, D2-domain-knowledge-11, D2-domain-identity-14, D2-domain-identity-11, D2-domain-identity-12**
20. เพิ่ม Prisma model จริงสำหรับ `PriceObservation`/`WatchRule`/`SupplierCandidate`/`MarketResearchRun`/`CompetitorSignal`/`DemandSignal` แทน in-memory repository (ต้อง migration ทั้ง SQLite และ Postgres schema) ก่อนเปิดใช้งานจริง — ปิดส่วนหนึ่งของ **D2-domain-market-intelligence-16, D2-domain-market-intelligence-09**

### ค. ต้องการการตัดสินใจจากเจ้าของผลิตภัณฑ์

21. ตัดสินใจว่า `/market` navigation ควร revert เป็น `soon:true` จนกว่า `MarketDashboard.jsx` จะเชื่อมกับ service จริงและมี API routes ตามเงื่อนไข "truthful navigation" ของ ADR-038 หรืออนุมัติทรัพยากรให้เดินหน้าสร้าง API/persistence จริงทันที — ปิด **D2-domain-market-intelligence-04, D2-domain-market-intelligence-05, D2-domain-market-intelligence-06, D2-domain-market-intelligence-07**
22. อนุมัติให้สำรอง FR id ใหม่สำหรับ Phase 2–5 ของ market-intelligence (Price/Watch, Supplier, Competitor/Demand, Market Research, Procurement-recommendation) ตาม SRS §15–16 ของ domain เอง และตัดสินใจว่า `ProcurementRecommendationService` ควรย้ายออกจาก module (รอ Commerce/Procurement domain มี charter) หรือรับเป็น exception ที่ประกาศไว้ — ปิด **D2-domain-market-intelligence-01, D2-domain-market-intelligence-02, D2-domain-market-intelligence-03**
23. ตัดสินใจกลไก dispatch ของ Gate F (write-action) และ Gate E (tool-calling) ของ agent — ต้องมี tool-calling schema ส่งให้ LLM provider ก่อนที่ FR-026 (Gate F) และเครื่องมือ Gate E จะเข้าถึงได้จริงจาก LINE turn ซึ่งเป็น prerequisite ของ FR-132 ด้วย — ปิด **D2-domain-agent-03, D2-domain-agent-04, D2-domain-agent-05, D2-domain-identity-20, D2-domain-crm-03, D2-domain-crm-04** (การเชื่อมต่อ Gate F ยังเปิดความเสี่ยง latent ของ D2-domain-crm-03/04 ให้กลายเป็น live — ต้องแก้ enum validation ของ D2-domain-crm-04 (ข้อ ก.1) ในเวลาเดียวกัน)
24. ตัดสินใจว่า `authorizeAgentToolExecution` (FEAT-010 agent-tool IAM authorizer ใหม่) ควรแทนที่ `authorizeScope` เดิมในเกทของ agent หรือถูก retire — ระบบ authorization คู่ขนานสองชุดสำหรับการดำเนินการเดียวกันต้องเลือกหนึ่งก่อนดำเนินการต่อ Issue #99 Phase 0 — ปิด **D2-domain-identity-20 (ร่วมกับข้อ 23), D2-domain-agent-08**
25. ตัดสินใจว่า People Directory ควรมี write surface จริง (เพิ่ม/ลบคนจาก Business) ที่ไหน (People หรือ Platform) และปรับข้อความ empty-state hint ใน `src/modules/people/components/PeopleDirectory.jsx:46` ให้ตรงกับ flow ที่มีจริง (Development > Project Team) ระหว่างที่ยังไม่มี surface นั้น — ปิด **D2-domain-people-05**
26. ตัดสินใจเจ้าของ narrow `owns_routes` catch-all ของ project-manager เอง (`src/app/(pm)/**` + `src/app/api/**`, docs/domains/project-manager/CHARTER.md:44-46) ที่ขัดแย้งกับข้อความ charter เอง (บรรทัด 83 "Does not touch CRM's...") — ต้องมีเจ้าของการตัดสินใจที่ชัดเจน (project-manager domain owner ร่วมกับ architecture lead) ว่าจะ (ก) เพิ่ม exclusion patterns ให้ catch-all ไม่ทับ owns_routes ของ domain อื่น หรือ (ข) บันทึก catch-all เป็นข้อยกเว้นที่อนุมัติแล้วอย่างชัดเจนใน charter — ปิด **D2-domain-project-manager-01**; แนะนำให้แก้พร้อมกับข้อ ค.27 (FR-108 UI decision) เนื่องจากทั้งคู่แตะ owns_routes ของ project-manager
27. ตัดสินใจว่า FR-108 (`POST /api/import/bundle/{dry-run,commit}`) ตั้งใจให้เป็น agent/API-only surface หรือควรมี UI consumer จริง — ถ้าตั้งใจให้เป็น API-only ให้บันทึกไว้ใน charter/feature note; ถ้าไม่ใช่ ให้อนุมัติสร้าง multi-Project bundle import panel ใน UI — ปิด **D2-domain-project-manager-17**

## ภาคผนวก ก — รายการที่ถูกตัดออกหลังตรวจสอบ

**ไม่มีข้อค้นพบใดถูกตัดทิ้ง (dropped) ในมิตินี้** — ทุกหน่วยรายงาน `dropped=[]` อย่างชัดเจน และไม่มี finding ใดได้ verdict REFUTED จากผู้ตรวจสอบ (verifier) ในทั้ง 10 หน่วย ทุกข้อค้นพบของ finder ผ่านการตรวจสอบและปรากฏในรายงานฉบับนี้ (บางส่วนถูก "ADJUSTED" คือปรับระดับความรุนแรงหรือแก้ไขคำอธิบายให้ถูกต้องขึ้น แต่ไม่ได้ถูกตัดออก) รายการที่ถูก ADJUSTED อย่างมีนัยสำคัญ (เพื่อความโปร่งใส แม้จะไม่ใช่ dropped) มีดังนี้:

- **domain-agent**: D2-domain-agent-02 (ปรับคำอธิบาย: capability ถูก bundle เข้า FR-080/ADR-032 ใน generated docs จริง แต่เนื้อหา FR/ADR ไม่ตรงกับสิ่งที่ route ทำ), D2-domain-agent-17 (critic review: ปรับ MEDIUM→HIGH — heartbeat DELETE ที่ไม่มี auth สามารถล้าง device registry ทั้งหมดได้ในคำขอเดียว และ error path ทุกกรณีคืน HTTP 200 ทำให้ monitor ตรวจจับความล้มเหลวไม่ได้เลย)
- **domain-crm**: D2-domain-crm-02 (ปรับ HIGH→MEDIUM: เป็นความเสี่ยงโดยธรรมชาติของ point-in-time snapshot/restore ไม่ใช่ routine flow), D2-domain-crm-01 (ปรับ HIGH→LOW: ระบุถูกต้องแต่ framing เกินจริง เพราะ gated/annotated/tested แล้ว), D2-domain-crm-03/-04 (critic review: ปรับ HIGH→MEDIUM — evidence เดิมอ้าง turn.js:77 และคำว่า "live-reachable from a LINE turn" ซึ่งขัดแย้งโดยตรงกับ D2-domain-agent-03/-05 ในรายงานฉบับเดียวกันที่ยืนยันว่าเส้นทางนี้ยังไม่มี production trigger; `grep 'action' src/app/api/agent/line-webhook/route.js` = 0 ยืนยันว่า unreachable — ความเสี่ยงเป็น latent ไม่ใช่ live)
- **domain-identity**: D2-domain-identity-10 (ปรับขึ้นเป็น HIGH: revocation check ต่อยอดแล้วแต่ unreachable), D2-domain-identity-03 (ปรับ HIGH→MEDIUM: known deliberate pattern), D2-domain-identity-05 (ปรับ HIGH→MEDIUM: governance gap เท่านั้น), D2-domain-identity-18 (ปรับ HIGH→MEDIUM: fix ตรงตัวจะทำ FR-066 พัง), D2-domain-identity-11/-12 (ปรับ MEDIUM→INFO: เป็นการเปิดเผยข้อเท็จจริงที่โปร่งใสอยู่แล้ว)
- **domain-integration**: D2-domain-integration-01/-02/-03 (แก้ไขข้อความหลักฐาน: มี direct-write test อยู่ ไม่ใช่ "ไม่มี test เลย" — ช่องว่างจริงยังคงอยู่คือไม่มี application-layer writer), D2-domain-integration-13 (ปรับ HIGH→MEDIUM: เป็นช่องว่างที่ FR-081/109/110 เปิดเผยไว้แล้วว่ายังไม่สร้าง)
- **domain-knowledge**: D2-domain-knowledge-05 (ปรับ HIGH production-gate-open → LOW code-duplication: กฎถูกบังคับใช้จริงที่ `pipeline-tracking-service.js` ผ่าน `superRefine`, `evaluateKnowledgePublication` เป็นโค้ดซ้ำที่ไม่ได้ใช้เท่านั้น)
- **domain-market-intelligence**: D2-domain-market-intelligence-01 (ปรับ: เป็นช่องว่างวินัย governance/id ไม่ใช่การละเมิด BR/SEC/SDD-009 หรือ user journey ที่พัง)
- **domain-platform-control**: D2-domain-platform-control-01 (ปรับ HIGH→MEDIUM: drift อยู่ใน `docs/.domain-state.json` เท่านั้น ไม่มี developer-facing view ผิดหรือความเสี่ยงความปลอดภัย)
- **domain-project-manager**: D2-domain-project-manager-03 (ปรับ: ระบุ exception ที่ยอมรับได้เนื่องจาก operator gate ทำให้ refactor ตรงไปตรงมาไม่ได้), D2-domain-project-manager-08 (ปรับ: PROGRESS_METHODOLOGY ที่ยังไม่ ratified แต่ UI แสดงความโปร่งใสอยู่แล้ว เป็นช่องว่างเชิงบริหารไม่ใช่ trust gap), D2-domain-project-manager-12 (ปรับ: พบว่า Repository มีกลไก external-id คู่ขนานอยู่แล้ว การ migrate ไม่ตรงไปตรงมา)
- **domain-business**: ไม่มีรายการ ADJUSTED — ทุก finding เป็น CONFIRMED หรือ verifier-added
- **domain-people**: D2-domain-people-08 (critic review: ปรับ HIGH→MEDIUM — demoted เป็น instance เดียวของช่องว่างที่เป็นระบบทั้งโดเมนซึ่งย้ายไปรายงานเป็น D2-domain-identity-23 (HIGH) แทน เนื่องจากพบว่า per-Business domain grant ไม่ถูกตรวจฝั่ง server บน API route ใดเลยในทั้ง repo ไม่ใช่แค่ /api/people)
- **การปรับความรุนแรงให้สอดคล้องกัน (severity normalisation)**: D2-domain-crm-20 และ D2-domain-integration-25 ปรับ INFO→LOW เพื่อให้ตรงกับ D2-domain-identity-19/D2-domain-project-manager-14 ที่รายงานข้อบกพร่องเดียวกัน (charter ขาด Version/Status control block) ในระดับเดียวกัน — และเพิ่มข้อค้นพบใหม่ระดับ LOW เดียวกันนี้ให้ครบทั้ง 8 charter (D2-domain-agent-19, D2-domain-knowledge-17, D2-domain-market-intelligence-23, D2-domain-platform-control-10) เพราะพบว่าทั้ง 8 charter ขาด field นี้เหมือนกันหมด ไม่ใช่แค่ 4 charter ที่รายงานไว้เดิม

## ภาคผนวก ข — ข้อจำกัดของการวิเคราะห์

การวิเคราะห์ทั้งฉบับนี้เป็น **static analysis ล้วน**: ไม่มีการรัน `npm test`, `npm run test:e2e`, `npm run build`, หรือ `npm run docs:preflight`/`docs:graph` จริง — ทุกหน่วยงานอาศัยการอ่านไฟล์ตรง (`cat`/`Read`), การค้นหา (`grep`), และ `git log`/`git show` เท่านั้น ตามข้อกำหนด read-only ของงานนี้ ผลลัพธ์ของการทดสอบและการ build ที่อ้างถึงในรายงาน (เช่น "จะ fail" ใน D2-domain-business-02) เป็นการอนุมานเชิงตรรกะจากเนื้อหาโค้ดที่อ่านได้ ไม่ใช่ผลลัพธ์ที่สังเกตได้จากการรันจริง หน่วยงานที่มี Postgres/Supabase-dependent test (เช่น `*.postgres.test.js`) ไม่สามารถยืนยันพฤติกรรมกับฐานข้อมูลจริงได้ เนื่องจากไม่มีการเชื่อมต่อฐานข้อมูล Postgres ที่ใช้งานได้จาก static repo audit

**สถานะข้อความใน PRD/TRACE/FEATURES ถูกยึดตามที่เขียนไว้ (taken at face value) ยกเว้นในจุดที่โค้ดขัดแย้งกับข้อความนั้นโดยตรง** — ตัวอย่างที่พบการขัดแย้งและได้รับการรายงานเป็น finding แยก ได้แก่: FR-029/FR-024 ที่ PRD ระบุ ✅ แต่โค้ดไม่มีผู้เรียกใช้จากการผลิต (D2-domain-agent-01, D2-domain-knowledge-02/03), NFR-020 ที่ glyph ✅ ขัดกับข้อความสถานะที่บอกว่า metric ส่วนใหญ่ 'unwired' (D2-domain-knowledge-13), และ FEAT-002 ที่ค้าง 'building' ทั้งที่ FR ย่อยเสร็จ 100% แล้ว (D2-domain-project-manager-02, D2-domain-business-06) ในทางกลับกัน ข้อความสถานะที่ระบุ gate ที่ยังเปิดอยู่อย่างตรงไปตรงมา (เช่น FR-052/FR-054/FR-097/FR-123's PRD text ที่บอกชัดว่ามี external NOT_RUN gate) ถูกรายงานเป็น INFO/MEDIUM ระดับ "factual disclosure" ไม่ใช่การปกปิด

**ขอบเขตการตรวจสอบข้ามโดเมน**: แต่ละหน่วยเน้นตรวจสอบ charter/code ของ domain ตนเองเป็นหลัก และตรวจสอบ domain อื่นเฉพาะที่จุดสัมผัสข้ามขอบเขต (cross-domain import/write) ที่ค้นพบเท่านั้น — ไม่มีหน่วยใดตรวจสอบความถูกต้องภายในของ domain อื่นแบบ end-to-end (เช่น หน่วย domain-agent ไม่ได้ audit ความถูกต้องภายในของ identity/crm/knowledge/integration แม้จะแตะโมเดลของ domain เหล่านั้น) สิ่งนี้อาจทำให้การละเมิดขอบเขตบางจุดที่ทั้งสองฝั่งไม่ตรวจพบ (ทั้ง finder ของ domain เจ้าของโมเดลและ domain ที่เขียนข้าม) ยังไม่ถูกค้นพบในรายงานนี้

**ระบบภายนอก repo** (MSP ที่ D:\msp, GKS ที่ D:\gks, GenesisBlockDB, zuri-cli) ถือเป็นขอบเขตนอก repo ตาม ADR-024/041-043 โดยชัดเจน — รายงานนี้ตรวจสอบเฉพาะ **ท่าเรือ (port)/สัญญา (contract)/พฤติกรรม fail-closed ฝั่ง repo นี้** ต่อระบบเหล่านั้น (เช่น `createAgentPorts()` ที่ตั้งใจเชื่อม MSP/GKS แต่ไม่ถูกเรียกใช้จริง) ไม่ใช่ความถูกต้องภายในของระบบภายนอกเหล่านั้นเอง

**การนับสถิติ**: ตัวเลขในตารางสรุป (ส่วนที่ 3 และ 4) คำนวณโดยผู้ประกอบรายงาน (assembler/critic) จากการนับ finding แต่ละรายการในทุกหน่วยด้วยตนเอง ไม่ได้คัดลอกตัวเลขสรุปที่แต่ละหน่วยรายงานไว้เอง — เดิมพบว่า prose สรุปของ domain-agent เขียนคลาดเคลื่อนว่า "5 LOW" ทั้งที่ตารางส่วนที่ 3/4 นับได้จริง 6 LOW ในขณะนั้น ข้อความ prose ได้รับการแก้ไขให้ตรงกับตารางแล้ว (ดูสรุปย่อ domain-agent) ตัวเลขที่ปรากฏในรายงานฉบับปัจจุบันเป็นผลจากการนับอิสระของ id ที่ปรากฏจริงในตารางสรุปทั้งหมด (ส่วนที่ 4) ซึ่งสอดคล้องกับผลรวม 190 finding ที่ทุกหน่วยประกาศรวมกันหลังการเพิ่มข้อค้นพบจาก critic review (ดูภาคผนวก ก)

**ข้อจำกัดของเครื่องมือ**: ไม่มีการเข้าถึง production/live Supabase/Postgres, ไม่มีการสังเกตพฤติกรรมจริงของ LINE webhook, ไม่มีการรัน CI workflow จริง — ข้อสรุปเกี่ยวกับ CI gate (เช่น `governance.yml` ไม่ตั้งค่า `ZURI_TEST_POSTGRES_URL`) มาจากการอ่านไฟล์ workflow โดยตรงเท่านั้น

