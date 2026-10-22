---
doc_type: code-requirements-assessment
status: reviewed
version: "0.1.0"
assessed_at: "2026-10-23"
code_revision: "e3474ef3c16b5cc5b6e797c63e69d6dc202c191f"
---

# Zuri code / requirements gap assessment

ยังสรุปว่าเอกสารและ implementation ครบไม่ได้ แม้ FR ที่กราฟจัดเป็น current
จะมี code/test bindings ครบ รายงานนี้พบทั้งพฤติกรรมที่ยังขาด ข้อมูลสถานะที่ขัดกัน
และหลักฐาน runtime/deployment ที่ยังไม่ได้ตรวจ จึงไม่ใช้ roadmap หรือเครื่องหมาย
เสร็จในเอกสารเป็นผล acceptance

นี่คือการประเมินจาก source ไม่ใช่แผนพัฒนา ไม่มีการเพิ่ม requirement, เปลี่ยน ID,
กำหนดเวลาใหม่ หรือแก้ application code ในงานนี้ การลบแผนและปรับ skill เป็น
documentation changes ใน working tree บน code revision ข้างต้น

## 1. แหล่งข้อมูล วิธีตรวจ และขอบเขต

- Resolve ทุก ID จาก [canonical registry](../../registry/document-registry/index.json)
  และอ่าน per-ID record ตาม path จริง; canonical wrapper lifecycle ไม่ใช่ delivery state
- Enumerate domain charters, routes, source และ tests ก่อนสรุปว่ามีหรือไม่มี
- ใช้ accepted ADR โดยเฉพาะ ADR-024/025/106/110/113 ควบคุม scope;
  DDC และ Edge device/harness ที่เลิกใช้ไม่กลายเป็นงานที่ต้องสร้างคืน
- ตรวจ semantics แบบเจาะลึกใน Core/PM/Agent, Asset/CRM, Knowledge/LINE/Runtime
  และตรวจ source/evidence boundary ใน Commerce, Inventory, Procurement, Marketing/MI
- แยก reviewer Luna Max สามขอบเขตแบบ read-only; root รวมผลและรัน checks
- ตาราง [requirements-matrix.json](requirements-matrix.json) ครบ 552 canonical records
  เก็บ IDs, source hashes, lifecycle, explicit membership และ binding paths;
  ไม่คัดลอก normative statements เป็นอีก SoT

**ขอบเขตที่ยังไม่รับรอง:** ยังไม่ได้พิสูจน์ acceptance ทุก clause ของ current FR
ทั้ง 247 รายการ, ทุก route/writer, browser E2E, Postgres RLS/migration ใน environment
จริง, hosted CI, image ที่ deploy, LINE live cohort หรือ MSP/GKS live services
คำว่า current ในกราฟหมายถึง lifecycle ที่ parser จัดจาก source ไม่ได้หมายถึงเสร็จ

## 2. Inventory ที่อ่านจริง

| Family | ทั้งหมด | Current | Planned | Superseded |
|---|---:|---:|---:|---:|
| FR | 287 | 247 | 30 | 10 |
| NFR | 25 | 23 | 2 | 0 |
| BR | 44 | 44 | 0 | 0 |
| SDD | 113 | 107 | 5 | 1 |
| SEC | 37 | 28 | 8 | 1 |
| FEAT | 46 | 44 | 0 | 2 |
| **รวม** | **552** | **493** | **45** | **14** |

- Current FR: 247/247 มี current implementation binding และ 247/247 มี test binding
- Current NFR/BR/SDD/SEC: 182/202 มี implementation หรือ rule annotation;
  187/202 มี test binding นี่เป็น mapping coverage ไม่ใช่ acceptance percentage
- Code annotations ที่ยังไม่ map 20 รายการ และ test bindings ที่ยังไม่ map 15 รายการ
  อยู่ใน matrix การไม่มี annotation อาจเป็น evidence gap โดยเฉพาะ NFR ที่ต้องวัด
  benchmark/operational evidence; ห้ามเปลี่ยนให้เป็นข้อสรุปว่าไม่มี implementation
- Planned FR ทั้ง 30 ต้องแยกตรวจ code กับ source status เพราะบางรายการมี implementation
  อยู่แล้ว การกรองเฉพาะ current evidence จะซ่อนหลักฐานเหล่านั้น

## 3. ช่องว่างพฤติกรรมที่ยืนยันจาก source

Finding labels ต่อไปนี้เป็น local labels ของรายงาน ไม่ใช่ requirement IDs ใหม่
Tests ที่อ้างในตารางเป็นไฟล์ที่ตรวจพบ; ผลที่รันจริงแยกอยู่ใน §8

| Finding | Canonical source | สิ่งที่พบใน code / สิ่งที่ยังขาด |
|---|---|---|
| **F01 PARTIAL — Scope CRUD** | [FR-001](../../docs/requirements/FR-001.md) ประกาศ CRUD และแสดง ✅ | [scope-service.js:103](../../apps/server/src/modules/project-manager/application/scope-service.js#L103) มี create ของ scope entities แต่ update/archive มีเฉพาะ Workspace ที่ [line 430](../../apps/server/src/modules/project-manager/application/scope-service.js#L430); inventory ของ routes ไม่มี general update/archive ของ Portfolio/Tenant/Business/Branch/LegalEntity. Creation/Workspace authorization tests ไม่พิสูจน์ operations ที่ยังไม่มี |
| **F02 MISSING invariant — Asset person scope** | [FR-135](../../docs/features/FEAT-015/requirements/FR-135.md) ต้อง fail closed เมื่อ person ข้าม Business | [asset-lifecycle-service.js:58](../../apps/server/src/modules/asset-management/application/asset-lifecycle-service.js#L58) lookup Person ด้วย ID อย่างเดียว; [asset-register-service.js:371](../../apps/server/src/modules/asset-management/application/asset-register-service.js#L371) เขียน person IDs โดยไม่มี same-Business association check ที่ระบุใน requirement. Tests ปัจจุบันไม่มี foreign-Business person case |
| **F03 MISSING invariant — Exclusive allocation overlap** | [FR-135](../../docs/features/FEAT-015/requirements/FR-135.md) ห้าม overlapping exclusive intervals | [asset-lifecycle-service.js:271](../../apps/server/src/modules/asset-management/application/asset-lifecycle-service.js#L271) ปิดเฉพาะ ACTIVE/open-ended rows แล้วสร้าง interval ตาม effectiveFrom ที่ caller ส่ง; ไม่ตรวจ overlap กับ historical closed intervals จึงไม่รับประกัน backdated allocation invariant |
| **F04 PARTIAL — Project Inventory assets** | FR-135 ระบุ read-only allocation projection | มี transactional allocation persistence แล้ว แต่ [project-inventory-read-model.js:251](../../apps/server/src/modules/project-manager/application/project-inventory-read-model.js#L251) ไม่มี asset section/DTO. Existing inventory tests ครอบคลุม sections อื่น ไม่ใช่ asset projection |
| **F05 MISSING — Consent/erasure propagation** | [FR-232](../../docs/features/FEAT-037/requirements/FR-232.md), ADR-091 D6 | ไม่มี writer ของ KnowledgeCandidate.tombstonedAt ใน source; [erase-principal.js:72](../../apps/server/src/modules/identity/erase-principal.js#L72) ไม่มี candidate/source withdrawal; [customer-consent-service.js:65](../../apps/server/src/modules/crm/customer-consent-service.js#L65) บันทึก consent แต่ไม่ dispatch erasure. Approval recheck consent ป้องกัน future admission แต่ไม่ถอน source ที่ admit ไปแล้ว |
| **F06 PARTIAL — Context/receipt coverage** | [FR-234](../../docs/features/FEAT-037/requirements/FR-234.md), [SDD-100](../../docs/requirements/SDD-100.md) | [context-composer.js:27–45](../../apps/server/src/modules/agent/context-composer.js#L27) ระบุว่า CRM/ERP records ยังว่างและ non-opt-in path bypass composer. Runtime [turn-runtime.js:311](../../services/conversation-runtime/src/turn-runtime.js#L311) สร้าง knowledge slices ภายใต้ episodic condition แต่ evidence ยังส่งแยกเข้า model ที่ line 367; ต้องพิสูจน์ว่า budget/receipt ครอบคลุมทุก evidence จริง ไม่ใช่เพียง composer unit tests |
| **F07 PARTIAL / RECONCILIATION — Specific graph integration** | [FR-024](../../docs/requirements/FR-024.md), [FR-029](../../docs/requirements/FR-029.md) | Generic [runtime.js:194](../../apps/server/src/modules/agent/runtime.js#L194) เลือก graph reader เมื่อ inject graphTraverse; [phase1-runtime.js:310](../../apps/server/src/modules/agent/phase1-runtime.js#L310) ใช้ Postgres knowledge reader. FR-235 corpus adapter เป็นคนละ contract. ADR-063 และ ADR-043/050 กำหนด external access ผ่าน MSP/GKS จึงต้อง reconcile graph-port authority ก่อน ไม่สร้าง direct GenesisBlock client คืนเพื่อทำตามข้อความเก่า. ไม่ได้อนุมานว่า LINE ทุก cohort หรือ production ไม่มี knowledge |

ผล unit tests ที่ผ่านไม่ได้หักล้าง F02/F03/F05/F06 เพราะกรณีที่ขาดยังไม่มี test
พิสูจน์ครบในชุดที่ตรวจ การแก้ implementation ต้องอ้าง requirement เดิมและเพิ่ม
case ที่ตรวจ invariant จริง ไม่ใช่เพิ่ม annotation ให้ coverage ดูเต็ม

## 4. ข้อมูลเอกสารที่ต้อง reconcile

| Finding | หลักฐานที่ขัดกัน | ข้อสรุปที่ทำได้ |
|---|---|---|
| **D01 — FR-072 สถานะหนี้ authorization เก่า** | [FR-072](../../docs/requirements/FR-072.md) ยังบอก scope/backup import เป็นหนี้ค้าง แต่ FR-074/075, current routes และ [.route-viewer-baseline.json](../../docs/.route-viewer-baseline.json) บันทึก repayment | เป็น stale delivery text; ไม่ใช่ช่องโหว่ authorization ที่ยืนยันจาก baseline นี้ |
| **D02 — Business KPI/WIG** | [FR-269](../../docs/features/FEAT-002/requirements/FR-269.md), [FR-270](../../docs/features/FEAT-002/requirements/FR-270.md) บอก design-only แต่ services, routes, [Overview UI:450](../../apps/server/src/app/%28pm%29/overview/page.jsx#L450) และ integration tests มีอยู่ | ต้องแยก source implementation / executed test / deployment; ไม่ใช้ข้อความเก่าตัดสินว่าไม่มี code |
| **D03 — CRM reply writer authority** | [FR-246](../../docs/features/FEAT-041/requirements/FR-246.md) กล่าวถึง member ที่มี CRM write แต่ [reply-record-service.js:252](../../apps/server/src/modules/crm/reply-record-service.js#L252) บังคับ owner; test ก็ reject non-owner | Contract ยังไม่ระบุ reply-specific permission ชัด ต้องตัดสิน allowed writer ก่อนขยายสิทธิ์; ไม่เดาให้ SALES_REP ส่งข้อความได้ |
| **D04 — Charter grounding/gap status** | Knowledge และ LINE charters ยังกล่าว FR-235/237 ว่า not built แต่ canonical rows และ [corpus-knowledge-reader.js](../../apps/server/src/modules/knowledge/corpus-knowledge-reader.js), gap-report route/service/tests มีอยู่ | Reconcile charter กับ code/current records; code presence ไม่ยืนยัน live deployment |
| **D05 — Composer ownership wording** | FR-234/SDD-100/ADR-091 บอก agent-lane module; later accepted ADR-106/SDD-110 ย้าย context assembly ไป Runtime | ADR-106 ควบคุม extraction; Server legacy composer กับ Runtime adapter อาจเป็นคนละ cohort ได้ จึงเป็น source reconciliation ไม่ใช่ข้อบกพร่องเพียงเพราะมีสองไฟล์. พฤติกรรมที่ยังขาดแยกใน F06 |
| **D06 — Legacy placement under plans** | เก้าไฟล์ที่เหลือเป็น approved contract/design/spec หรือ evidence; NFR-020/FR-254 และ code readers ยังใช้ paths เหล่านั้น | ย้ายแบบลบทั้งหมดไม่ได้โดยไม่ reconcile pinned rows/readers. [Plans index](../../docs/plans/README.md) ระบุข้อยกเว้นตรง ๆ; ไม่สร้าง pointer files หรือ requirement ซ้ำ |
| **D07 — Governance warning baseline** | ก่อน cleanup graph มี dangling FR-998 จาก doc-links test fixture และ preflight baseline มี broken-document links | เป็น documentation/tooling evidence gap; ผล post-cleanup จริงอยู่ §8 ห้ามนับ fixture เป็น product requirement ใหม่ |

การแก้ delivery/status text ใน pinned canonical row ต้องใช้ reviewed migration เดิม
รายงานนี้จึงบันทึก conflict โดยไม่เปลี่ยน statement/hash/ID เพื่อทำให้ผลตรวจดูเขียว

## 5. หลักฐาน acceptance ที่ยังไม่ยืนยัน

| Finding | Scope | ขอบเขตหลักฐาน |
|---|---|---|
| **E01** | FR-024/029 adapters และ current LINE routing | Injection/library tests ไม่เท่ากับ active deployed route; FR-029 ยังมีข้อความเก่าว่าไม่สร้าง MSP transport ทั้งที่ factory สร้างได้ภายใต้ flags |
| **E02** | FR-272 Approval Gateway | Source และ tests มี; source record ระบุ local-only/release pending. งานนี้ไม่ตรวจ hosted/release/production |
| **E03** | Inventory FR-155/156 | Documents ระบุ production migration pending; code/test paths มี. ไม่ได้ตรวจฐาน production ปัจจุบัน จึงไม่ยืนยันว่า migration ยัง unapplied วันนี้ |
| **E04** | Commerce FR-163/166/183/186 | Local payment/order/POS code มี; deployment notes มีข้อจำกัด. PromptPay payload ไม่ใช่ bank settlement และเอกสาร local ไม่ใช่ statutory certification |
| **E05** | Procurement FR-164/165 | Local order/receipt writers และ tests มี; deployment/migration claims ต้องพิสูจน์แยก environment |
| **E06** | Marketing FR-281/282/283 | Receiver code และ test harness มี แต่ live cross-system cases gated ด้วย QA/provisioning config; งานนี้ไม่ตั้ง credentials หรือ activate source |
| **E07** | MSP/GKS และ FR-235 | Flags, fake-port tests และ source note ไม่พิสูจน์ live service/corpus/cohort; ไม่อ่านหรือเขียนฐาน/credentials ของ external repositories |

## 6. Planned records และ proposal boundaries

ตรวจ planned canonical FR ครบ **30/30 รายการแบบ bounded source review**.
SOURCE_PRESENT ไม่เท่ากับ full acceptance; NOT_FOUND_AFTER_ENUMERATION เป็นผลของ
ขอบเขต source ที่ enumerate แล้ว ไม่ใช่ผลจาก graph/search miss อย่างเดียว.
NEEDS_DECISION ไม่ถูกเติม requirement หรือเปลี่ยนสิทธิ์ให้เอง. ADR-099/FR-290
ที่อนุมัติเพียง design/record ไม่กลายเป็น implementation authorization.

| Canonical FR | Classification | Source evidence / remaining boundary |
|---|---|---|
| [FR-050](../../docs/requirements/FR-050.md) | NEEDS_DECISION | Server single-reply/deduplication code exists, but attribution of the old forwarding ID versus ADR-061/110 replacement clauses is unresolved; do not restore the retired Edge path. [line-conversation-jobs.js](../../apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js) · [ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md](../../docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md) |
| [FR-082](../../docs/features/FEAT-007/requirements/FR-082.md) | NEEDS_DECISION | WBS canvas remains read-only; add/reparent direct manipulation belongs to proposed ADR-035. [WbsCanvas.jsx](../../apps/server/src/modules/project-manager/views/WbsCanvas.jsx) |
| [FR-083](../../docs/features/FEAT-007/requirements/FR-083.md) | NEEDS_DECISION | Dependency form creation exists; canvas drag creation and handoff dialog do not. ADR-035 remains proposed. [DependencyMap.jsx](../../apps/server/src/modules/project-manager/views/DependencyMap.jsx) · [DependenciesView.jsx](../../apps/server/src/modules/project-manager/views/universal/DependenciesView.jsx) |
| [FR-084](../../docs/features/FEAT-007/requirements/FR-084.md) | NEEDS_DECISION | Dependency schema does not persist the proposed handoff contract; ADR-035 is not accepted implementation authority. [schema.prisma](../../apps/server/prisma/schema.prisma) |
| [FR-085](../../docs/features/FEAT-007/requirements/FR-085.md) | NEEDS_DECISION | Board/work status changes do not enforce the proposed inbound-contract hold. [KanbanBoard.jsx](../../apps/server/src/modules/project-manager/views/KanbanBoard.jsx) · [work-service.js](../../apps/server/src/modules/project-manager/application/work-service.js) |
| [FR-121](../../docs/requirements/FR-121.md) | NEEDS_DECISION | No Google sign-in flow in enumerated auth routes; provider credentials and tenant-less binding decision are explicitly blocked. [auth](../../apps/server/src/app/api/auth) · [schema.prisma](../../apps/server/prisma/schema.prisma) |
| [FR-125](../../docs/requirements/FR-125.md) | NEEDS_DECISION | Old REST Client Credentials proposal is unimplemented and distinct from official MCP FR-290; provider facts/connection-kind design remain unresolved. [ADR-053-FLOWACCOUNT-READ-ONLY-PULL-PIPELINE-AND-CREDENTIAL-PROVISIONING.md](../../docs/decisions/ADR-053-FLOWACCOUNT-READ-ONLY-PULL-PIPELINE-AND-CREDENTIAL-PROVISIONING.md) |
| [FR-126](../../docs/features/FEAT-014/requirements/FR-126.md) | NOT_FOUND_AFTER_ENUMERATION | No AI-inferred CustomerProfile row/writer; FR-127 ConversationAnalysis is a different implemented capability. [CHARTER.md](../../docs/domains/crm/CHARTER.md) |
| [FR-128](../../docs/features/FEAT-014/requirements/FR-128.md) | NOT_FOUND_AFTER_ENUMERATION | No DailyBrief aggregate/recompute/delivery lifecycle in enumerated CRM schema/services/tests. [CHARTER.md](../../docs/domains/crm/CHARTER.md) |
| [FR-131](../../docs/requirements/FR-131.md) | NEEDS_DECISION | Commerce shipping matrix exists, but typed Knowledge publication/source provenance and ADR-098 ownership wording require reconciliation. [pricing-rules.js](../../apps/server/src/modules/commerce/domain/pricing-rules.js) · [ADR-098-COMMERCE-PRICING-RULES-AND-KNOWLEDGE-PUBLICATION.md](../../docs/decisions/ADR-098-COMMERCE-PRICING-RULES-AND-KNOWLEDGE-PUBLICATION.md) |
| [FR-132](../../docs/requirements/FR-132.md) | NOT_FOUND_AFTER_ENUMERATION | No FR-132 Gate E descriptor; role metadata and FR-181 SmartGift quote tool do not implement this contract. Trigger design remains blocked. [tools.js](../../apps/server/src/modules/agent/tools.js) · [role-registry.js](../../apps/server/src/modules/agent/role-registry.js) |
| [FR-140](../../docs/features/FEAT-016/requirements/FR-140.md) | RETIRED_BY_ADR | ADR-110/current LINE SRS retire the trusted CLI/Edge-specific adapter; generic asset intake is not its replacement. [ADR-110-RETIRE-EDGE-DEVICE-AND-HARNESS-SURFACES.md](../../docs/decisions/ADR-110-RETIRE-EDGE-DEVICE-AND-HARNESS-SURFACES.md) · [asset-intake-service.js](../../apps/server/src/modules/asset-management/application/asset-intake-service.js) |
| [FR-189](../../docs/features/FEAT-026/requirements/FR-189.md) | NEEDS_DECISION | Published-generation modes/fallback and tests exist despite no-code prose; reconcile intended surviving consumer with ADR-110 before cutover claims. [published-rag.ts](../../apps/edge/src/rag/genesisrag17/published-rag.ts) · [genesisrag17-edge.test.ts](../../apps/edge/tests/unit/genesisrag17-edge.test.ts) |
| [FR-231](../../docs/features/FEAT-037/requirements/FR-231.md) | PARTIAL | Local policy snapshots, eligibility and receipts/settlement exist; current MSP pin/live tool acceptance is not established by this repo. [line-memory-projection.js](../../apps/server/src/modules/line-oa-studio/application/line-memory-projection.js) · [line-memory-delivery.js](../../apps/server/src/modules/line-oa-studio/application/line-memory-delivery.js) |
| [FR-232](../../docs/features/FEAT-037/requirements/FR-232.md) | MISSING | Candidate tombstone and admitted-source withdrawal on consent decline/erasure are missing; see F05, not a claim that every erasure path is absent. [knowledge-candidate-service.js](../../apps/server/src/modules/knowledge/application/knowledge-candidate-service.js) · [customer-consent-service.js](../../apps/server/src/modules/crm/customer-consent-service.js) |
| [FR-255](../../docs/features/FEAT-043/requirements/FR-255.md) | PARTIAL | Provider credentials exist, but not node enrollment, destination approval or pool qualification. ADR-099 approval is design-only. [model-provider-credential-service.js](../../apps/server/src/modules/integration/application/model-provider-credential-service.js) |
| [FR-256](../../docs/features/FEAT-043/requirements/FR-256.md) | PARTIAL | Private configured endpoint model port exists; qualified inference-pool execution does not. [model-provider.js](../../apps/server/src/modules/agent/model-provider.js) |
| [FR-257](../../docs/features/FEAT-043/requirements/FR-257.md) | NOT_FOUND_AFTER_ENUMERATION | No node observation/per-engine capacity lease/spill router found; conversation-job lease is a different mechanism. Design-only target. [ADR-099-SERVER-OWNED-SELF-HOSTED-INFERENCE-POOL.md](../../docs/decisions/ADR-099-SERVER-OWNED-SELF-HOSTED-INFERENCE-POOL.md) |
| [FR-258](../../docs/features/FEAT-043/requirements/FR-258.md) | NOT_FOUND_AFTER_ENUMERATION | No inference-pool operator readiness/capacity projection found. Existing Platform Control surfaces serve other contracts; design-only target. [ADR-099-SERVER-OWNED-SELF-HOSTED-INFERENCE-POOL.md](../../docs/decisions/ADR-099-SERVER-OWNED-SELF-HOSTED-INFERENCE-POOL.md) |
| [FR-259](../../docs/features/FEAT-043/requirements/FR-259.md) | PARTIAL | Provider/model selection exists; account pool reference, immutable model-profile snapshot and pool cutover do not. [model-provider-credential-service.js](../../apps/server/src/modules/integration/application/model-provider-credential-service.js) · [schema.prisma](../../apps/server/prisma/schema.prisma) |
| [FR-269](../../docs/features/FEAT-002/requirements/FR-269.md) | SOURCE_PRESENT | KPI service/API/UI exist and selected integration tests passed in this assessment; source design-only label is stale. Deployment not verified. [fr269-business-kpi-mutation.test.js](../../apps/server/tests/integration/fr269-business-kpi-mutation.test.js) |
| [FR-270](../../docs/features/FEAT-002/requirements/FR-270.md) | SOURCE_PRESENT | WIG service/API/UI exist and selected integration tests passed; source design-only label is stale. Deployment not verified. [fr270-business-wig-execution.test.js](../../apps/server/tests/integration/fr270-business-wig-execution.test.js) |
| [FR-276](../../docs/requirements/FR-276.md) | PARTIAL | Domain refresh/retry policy exists, but no refresh HTTP routes, production orchestrator/status persistence or snapshot-safe integration. [sync-orchestrator-port.js](../../apps/server/src/modules/marketing/insights/ports/sync-orchestrator-port.js) · [insights-runtime.js](../../apps/server/src/modules/marketing/insights/application/insights-runtime.js) |
| [FR-281](../../docs/requirements/FR-281.md) | SOURCE_PRESENT | Report-only credential receiver code/harness exist; native provisioning and live source acceptance were not run. [marketing-report-receiver.js](../../apps/server/src/modules/marketing/application/marketing-report-receiver.js) |
| [FR-282](../../docs/requirements/FR-282.md) | SOURCE_PRESENT | Atomic external-report intake code/harness exist; current cross-system acceptance is not established here. [marketing-report-receiver.js](../../apps/server/src/modules/marketing/application/marketing-report-receiver.js) |
| [FR-283](../../docs/requirements/FR-283.md) | SOURCE_PRESENT | Private source-preserving read code/harness exist; live acceptance not established here. [marketing-report-receiver.js](../../apps/server/src/modules/marketing/application/marketing-report-receiver.js) |
| [FR-284](../../docs/requirements/FR-284.md) | SOURCE_PRESENT | Drive/UNC/POSIX path handling and atomic promotion exist with tests; mounted runtime behavior not tested here. [path-security.js](../../apps/server/src/modules/project-manager/local-files/path-security.js) · [filesystem-port.js](../../apps/server/src/modules/project-manager/local-files/filesystem-port.js) |
| [FR-288](../../docs/requirements/FR-288.md) | PARTIAL | Bounded PDF/DOCX/HTML worker parser and lineage tests exist; native Stage 9+, full publication and production acceptance remain separately qualified. [knowledge-binary-parser.js](../../apps/server/src/modules/knowledge/knowledge-binary-parser.js) · [knowledge-binary-parser-lineage.test.js](../../apps/server/tests/integration/knowledge-binary-parser-lineage.test.js) |
| [FR-289](../../docs/requirements/FR-289.md) | SOURCE_PRESENT | Operator page/bridge/projection and browser tests exist; external loopback renderer host/deployed flow were not verified. [page.jsx](../../apps/server/src/app/%28control%29/control/knowledge-studio/page.jsx) · [KnowledgeStudioBridge.jsx](../../apps/server/src/modules/platform-control/knowledge-studio/components/KnowledgeStudioBridge.jsx) |
| [FR-290](../../docs/requirements/FR-290.md) | NOT_FOUND_AFTER_ENUMERATION | Official MCP connector/tests not found; approval is a planned record only and excludes implementation/provider access until its gates. [TASK017-FLOWACCOUNT-MCP-FR290-REASSESSMENT-20261022.md](../../docs/change-requests/integration/TASK017-FLOWACCOUNT-MCP-FR290-REASSESSMENT-20261022.md) |

PMR-033/general workflow authoring และ workforce proposal schemas ไม่ใช่ canonical FR
ที่อนุมัติแล้ว; MI price/watch/research concepts ยังเป็น candidates. HR payroll/leave/
attendance และ Finance posting ที่ governing scope กันออก ไม่ถูกเพิ่มเป็น missing
requirements. ADR-044 omnichannel prose ต้อง reconcile กับ later LINE/Core/ADR-110;
ไม่เพิ่ม Facebook/Instagram/Web Chat requirement จากชื่อแชตหรือเมนู

## 7. Plan cleanup และ skill alignment

- ลบ 11 execution/candidate/DDC plans ตาม [inventory](../../docs/plans/README.md)
  และ pin historical approval links ไปที่ exact pre-cleanup Git commit
- เก็บเก้า contract/design/spec/evidence files; ชี้ข้อยกเว้นด้าน placement ตรงไปตรงมา
- ปรับ zuri-doc-writing จาก 0.5.0 เป็น 0.6.0 ให้เริ่มอ่าน profiles และ filesystem
  registers, เลือก owning family, อัปเดต indexes หลังลบ/ย้าย และเก็บ dated assessments
  ใต้ reports พร้อมหลักฐาน exact revision
- Skill อ้าง proposed documentation profile โดยรักษา proposed lifecycle;
  accepted ADR/canonical format คงเป็น authority ไม่มี DDC หรือ gate ใหม่
- Baseline pressure scenarios พบ report placement และ index maintenance ยัง implicit;
  independent Luna Max ตรวจ skill ใหม่: A linked SRS / B deletion classification /
  C mapping-versus-execution **PASS**, local Markdown links ใน skill **13/13 resolve**

## 8. Verification ที่รันจริง

| Check | ผล | ข้อจำกัด |
|---|---|---|
| Strict canonical reader + matrix census | PASS, 552 records | Declaration/binding census เท่านั้น |
| docs:services + baseline docs:graph | PASS generation; 4,732 nodes / 18,990 edges / 1 dangling fixture edge | ไม่ใช่ clean governance result |
| Selected existing unit suites | PASS, 7 files / 94 tests | Asset lifecycle/routes, Project Inventory, Agent Factory, composer, corpus reader, candidate zero-PII. Requested unit agent-runtime path ไม่มีอยู่จริง จึงไม่ถูกนับ; actual runtime suite แยกรันด้านล่าง |
| Supplemental runtime/authorization/KPI/WIG tests | PASS, 6 files / 48 tests | Isolated SQLite test DB; Phase1 and generic Agent Runtime, FR-074/075, FR-269/270. No deployment evidence |
| docs:migration:test | PASS, 98 tests / 0 skipped | Reader/profile/query/migration contracts; isolated fixtures |
| Final docs:graph + docs:views | PASS generation; 4,721 nodes / 18,916 edges; 96 views / 46 features | 11 plan nodes removed; one pre-existing fixture dangling edge remains |
| npm run govern | Exit 0; **WARN: 0 critical, 4 warnings, 43 info** | 552 canonical records verified; inventory/identity, views/check and strict preflight ran. Not a warning-free result |
| docs:llms + docs:llms:check | PASS | Ignored local corpus rebuilt and freshness checked |
| Skill creator quick_validate.py | PASS — Skill is valid | Initial system/bundled Python lacked PyYAML; rerun used PyYAML 6.0.3 in a task-specific temporary dependency directory, without changing repository dependencies |
| git diff --check + manual index/report link and matrix binding checks | PASS | Five changed manual entrypoints resolve; all matrix binding paths exist; graph SHA matches |
| Independent completed-patch review | PASS — Luna Max | Read-only scope, cleanup, skill and evidence-boundary review. Initial matrix dangling-edge omission corrected and independently confirmed against graph.dangling_edges; reviewer did not rerun tests/generators. Reviewed is not full acceptance or owner approval |
| Browser E2E, full Server/Edge suites, hosted CI, production acceptance | NOT_RUN | ไม่อ้างว่าเป็น PASS |

คำสั่ง unit ชุดแรก: npm --prefix apps/server test -- tests/unit/asset-lifecycle-service.test.js
tests/unit/asset-lifecycle-routes.test.js tests/unit/project-inventory-read-model.test.js
tests/unit/agent-runtime.test.js tests/unit/agent-business-factory.test.js
tests/unit/context-composer.test.js tests/unit/corpus-knowledge-reader.test.js
tests/unit/knowledge-candidate-zero-pii.test.js

Supplemental command: npm --prefix apps/server test --
tests/unit/phase1-business-agent-runtime.test.js tests/integration/agent-runtime.test.js
tests/integration/fr269-business-kpi-mutation.test.js
tests/integration/fr270-business-wig-execution.test.js
tests/integration/fr074-scope-creation-authorization.test.js
tests/integration/fr075-restore-authorization.test.js

Warnings ที่ยังคงอยู่: Document 20 ลิงก์ไป candidate receipts สองไฟล์ที่ไม่มี,
ZURI-GO-RECORD-AUTHORING ลิงก์ AUTHORED-VERIFICATION ที่ไม่มี, และ doc-links
test fixture อ้าง FR-998 ซึ่งไม่ใช่ issued requirement. งานนี้ไม่เปลี่ยน canonical
IDs หรือ fabricated receipt เพื่อปิด warning เหล่านี้

Matrix uses the existing strict loadDocumentQueryContext/queryReadiness readers,
current typed implementation/test edges and separately labelled @spec follows
annotations. Reproduce an individual binding query with:

```powershell
node tools/document-readiness.mjs ZAI:FR-135 --json
node tools/impact.mjs ZAI:FR-234 --json
```

No binding or report row is a test outcome. Unreviewed requirements retain
NOT_INDIVIDUALLY_CERTIFIED in the matrix even when annotations are complete.

## Change history

0.0 → 0.1.0 (2026-10-23): first current-revision inventory, bounded semantic
review, cleanup/skill reconciliation and explicitly scoped verification.
