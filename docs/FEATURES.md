# Features (FEAT registry)

| Field | Value |
|-------|-------|
| **Version** | 1.5.0b |
| **Status** | Active — hand-maintained source of truth |

A **Feature (`FEAT-xxx`) is a product capability**; a **Functional Requirement
(`FR-xxx`) is a precise system behavior**. They are different id families
(ADR-025 rev 2): a feature bundles one or more FRs, and an FR belongs to at most
one feature. `FEAT` ids follow the same contract as every other id (AGENTS.md
§18): never renumbered, never reused, gaps stay burnt. The duplicate-id guard in
preflight covers this table.

An FR with no FEAT row is implicitly a feature of one — add a row only when a
capability genuinely spans FRs or needs product-level framing. The graph reads
this table (`feat:` nodes, `bundles` edges) and TRACE shows the bundle per FR.

| ID | Feature | FRs | Status |
|---|---|---|---|
| FEAT-001 | File Manager — Business/Project files with managed local workspace | FR-037, FR-045, FR-058 | live |
| FEAT-002 | Business Home — shell-level cross-domain aggregation (Dashboard now; Goals & KPIs, Risks & Alerts, Reports later) | FR-041, FR-060 | building |
| FEAT-003 | Execution Planning — Human-visible Roadmap, Blueprint intake and stable identity bindings | FR-068, FR-069, FR-070 | live |
| FEAT-004 | Phase 1 LINE Runtime Connections — Business-scoped provider selection, production secret resolution, local evaluation providers and secret-safe Platform management | FR-048, FR-079, FR-080 | building |
| FEAT-005 | Project Inventory — authorized, read-only Project-wide operational snapshot | FR-077 | live |
| FEAT-006 | Customer Data Backfill — scoped, provenance-preserving Customer Profile contract with entity resolution, PDPA gates and explicit duplicate review | FR-078 | building |
| FEAT-007 | Pipeline Builder — direct-manipulation structure and edge creation on one canvas, with a mandatory Handoff Contract on every edge and contract-gated release on the Board | FR-082, FR-083, FR-084, FR-085 | proposed |
| FEAT-008 | Projects Dashboard — a KPI band and enriched Project list for the Development domain, with the priority, accountable-owner and Team entities it needs to be honest | FR-086, FR-087, FR-088, FR-089 | proposed |
| FEAT-009 | CRM Conversation Inbox — the first reader surface over the LINE ingress, and the delivery receipt that makes it show both sides of a conversation rather than only what the customer said | FR-091, FR-093 | building |

## Readiness Dashboard presentation metadata

This block is the hand-maintained presentation contract for FR-094. It contains
one entry for every projected feature: each explicit FEAT bundle plus each FR
that is not bundled by a FEAT row above. It adds no new feature ids and does not
change requirement ownership. Graph generation fails when an entry is missing,
duplicated, points at an unknown projected id, names an unknown domain, or has
no concrete use-case example.

<!-- readiness-metadata:start -->
```json
[
  { "id": "FEAT-001", "primaryDomain": "project-manager", "useCase": "ผู้จัดการโครงการเปิดไฟล์ระดับ Business และ Project เพื่อตรวจตำแหน่ง ลิงก์ และสถานะ reconcile จากหน้าเดียว" },
  { "id": "FEAT-002", "primaryDomain": "project-manager", "useCase": "ผู้บริหารเลือก Business แล้วดู project health, domain health และรายการที่ต้องจัดการในหน้า Home เดียว" },
  { "id": "FEAT-003", "primaryDomain": "project-manager", "useCase": "เจ้าของงานระบุ objective แล้วตรวจ Blueprint และ Roadmap เดียวกันที่ Human และ Agent ใช้ส่งแผน" },
  { "id": "FEAT-004", "primaryDomain": "integration", "useCase": "Owner เลือก LINE model provider และ Vault reference ของ Business โดยไม่เปิดเผย secret ใน browser" },
  { "id": "FEAT-005", "primaryDomain": "project-manager", "useCase": "PM เปิด Project Inventory ก่อน review เพื่อเห็น work, gates, files, repositories, team และ progress พร้อมกัน" },
  { "id": "FEAT-006", "primaryDomain": "crm", "useCase": "Data steward นำเข้าประวัติลูกค้าโดยเก็บ provenance และพักกลุ่ม duplicate ให้ผู้มีสิทธิ์ตัดสินใจ" },
  { "id": "FEAT-007", "primaryDomain": "project-manager", "useCase": "PM ลากโครงสร้างงาน เชื่อม dependency พร้อม Handoff Contract และให้ Board ถือรายการจน Gate ผ่าน" },
  { "id": "FEAT-008", "primaryDomain": "project-manager", "useCase": "Head of Development ดู KPI, Top-5 priority, PIC และ Teams แล้วเปิด Project ที่ต้องเร่งต่อ" },
  { "id": "FEAT-009", "primaryDomain": "crm", "useCase": "Operator เปิด CRM Inbox แล้วเห็นทั้งข้อความขาเข้าและข้อความขาออกที่ส่งถึงลูกค้าจริง" },
  { "id": "FR-001", "primaryDomain": "project-manager", "useCase": "ผู้ดูแลสร้าง Portfolio, Tenant, Business, Branch และ Space ด้วย UUID และ human code ที่ตรวจย้อนกลับได้" },
  { "id": "FR-002", "primaryDomain": "project-manager", "useCase": "ผู้ใช้สลับ Portfolio, Business, Space และ Project แล้วกลับมาเจอ context ล่าสุด" },
  { "id": "FR-003", "primaryDomain": "project-manager", "useCase": "PM สร้าง แก้ไข เปิด และ archive Project โดยไม่ลบประวัติ" },
  { "id": "FR-004", "primaryDomain": "project-manager", "useCase": "PM สร้าง Workstream พร้อม execution mode, progress strategy และน้ำหนักที่เหมาะกับงาน" },
  { "id": "FR-005", "primaryDomain": "project-manager", "useCase": "ทีมเปิด All Work เพื่อค้นหาและเปลี่ยนสถานะ WorkItem ข้าม Project หรือภายใน Project เดียว" },
  { "id": "FR-006", "primaryDomain": "project-manager", "useCase": "PM สร้าง Milestone และ Gate พร้อมหลักฐาน แล้วติดตามว่าจุดควบคุมใดผ่านหรือค้าง" },
  { "id": "FR-007", "primaryDomain": "project-manager", "useCase": "PM เชื่อม dependency ระหว่างงานและเห็น cycle หรือ blocker ก่อนบันทึก" },
  { "id": "FR-008", "primaryDomain": "project-manager", "useCase": "ทีมบันทึก repository metadata และผูก repository เดียวกับหลาย Project อย่างมีขอบเขต" },
  { "id": "FR-009", "primaryDomain": "project-manager", "useCase": "ทีมเปิดมุมมอง Sprint, Migration, Sales หรือโหมดอื่นจาก work model กลางเดียวกัน" },
  { "id": "FR-010", "primaryDomain": "project-manager", "useCase": "PM เปิด Explain เพื่อดูว่าค่า progress ของ Workstream มาจาก strategy และ evidence ใด" },
  { "id": "FR-011", "primaryDomain": "project-manager", "useCase": "ผู้บริหารดู Project progress ที่ roll up จาก Workstream ตามน้ำหนักแทนการนับ task ตรงๆ" },
  { "id": "FR-012", "primaryDomain": "project-manager", "useCase": "ทีม preview Agent JSON plan ตรวจ conflict แล้ว commit ทั้งแผนใน transaction เดียว" },
  { "id": "FR-013", "primaryDomain": "project-manager", "useCase": "Operator export snapshot และ preview ผลกระทบก่อนยืนยัน restore" },
  { "id": "FR-014", "primaryDomain": "project-manager", "useCase": "Auditor ค้นเหตุการณ์เพื่อดูว่าใครเปลี่ยนอะไร เมื่อใด และใน scope ไหน" },
  { "id": "FR-015", "primaryDomain": "project-manager", "useCase": "ผู้ใช้กด Ctrl+K เพื่อค้นหา route หรือคำสั่งโดยไม่ไล่เมนู" },
  { "id": "FR-016", "primaryDomain": "project-manager", "useCase": "ทีมเดโม reset และ seed ข้อมูลครบเจ็ด execution modes ซ้ำได้โดยไม่สร้างข้อมูลซ้อน" },
  { "id": "FR-017", "primaryDomain": "project-manager", "useCase": "ผู้ใช้เริ่ม Project จาก objective แล้วให้ wizard สร้างแผนเข้าสู่ pipeline กลาง" },
  { "id": "FR-018", "primaryDomain": "project-manager", "useCase": "ทีมกรอก Excel template แล้วเห็น error ระดับแถวก่อนนำเข้าแผน" },
  { "id": "FR-019", "primaryDomain": "project-manager", "useCase": "ระบบภายนอก upsert Project ด้วย external id ผ่าน Enterprise API โดยไม่ใช้ external id เป็น primary key" },
  { "id": "FR-020", "primaryDomain": "project-manager", "useCase": "เจ้าของธุรกิจเดียวเข้าใช้งานโดยไม่เห็น switcher ที่ไม่จำเป็น ขณะที่เจ้าของหลายธุรกิจเลือก context ได้" },
  { "id": "FR-021", "primaryDomain": "identity", "useCase": "LINE user คนเดิมถูก resolve เป็น Person เดิมภายใน Tenant เดิมโดยไม่สร้าง identity ซ้ำ" },
  { "id": "FR-022", "primaryDomain": "identity", "useCase": "สมาชิกใช้ token ครั้งเดียวเพื่อ link LINE กับบัญชี และขอ revoke หรือ erase ตาม PDPA" },
  { "id": "FR-023", "primaryDomain": "crm", "useCase": "ข้อความ LINE แรกสร้าง Customer, Conversation และ Message แบบ tenant-scoped ใน transaction เดียว" },
  { "id": "FR-024", "primaryDomain": "knowledge", "useCase": "Agent ขอ neighbourhood ของลูกค้าและธุรกิจจากกราฟ โดยราคาสดและข้อมูลปฏิบัติการยังอ่านจากเจ้าของข้อมูล" },
  { "id": "FR-025", "primaryDomain": "agent", "useCase": "Agent ประกอบ read context จาก Identity, MSP, Knowledge และ read-only tools ก่อนตอบคำถาม" },
  { "id": "FR-026", "primaryDomain": "agent", "useCase": "Agent ขอทำ action ที่มีความเสี่ยงสูงและระบบบังคับ step-up token ก่อน execute และ audit" },
  { "id": "FR-027", "primaryDomain": "agent", "useCase": "ข้อความหนึ่งรอบไหลจาก ingest ผ่าน context/action gate ไปสู่คำตอบ โดย refusal ไม่ทำให้ runtime ล้ม" },
  { "id": "FR-028", "primaryDomain": "agent", "useCase": "zuri-cli ส่ง normalized LINE event เข้า webhook ที่ปฏิเสธ scope ซึ่งไม่ได้ resolve จาก server" },
  { "id": "FR-029", "primaryDomain": "agent", "useCase": "ทีมสลับ MSP memory และ GKS adapters ผ่าน ports โดยไม่ผูก agent กับ storage ตัวเดียว" },
  { "id": "FR-030", "primaryDomain": "integration", "useCase": "Operator export/import snapshot ไป Postgres พร้อม guard ไม่ให้ Zuri DB ชี้ฐานเดียวกับ MSP" },
  { "id": "FR-031", "primaryDomain": "identity", "useCase": "ทุก request resolve viewer เป็น OWNER, MEMBER หรือ DEV พร้อม Business และ domain ที่มองเห็นได้" },
  { "id": "FR-032", "primaryDomain": "project-manager", "useCase": "ผู้ใช้เปิด Home แล้วเลือกเฉพาะ Group หรือ Business ที่ viewer มีสิทธิ์เห็น" },
  { "id": "FR-033", "primaryDomain": "project-manager", "useCase": "ผู้ใช้เห็น domain, lens, command palette และ profile บน Topbar โดยไม่มี scope dropdown ซ้ำ" },
  { "id": "FR-034", "primaryDomain": "project-manager", "useCase": "ผู้ใช้คลิก breadcrumb เพื่อย้อนกลับไปเปลี่ยน Business หรือเปิดรายการ Space และ Project" },
  { "id": "FR-035", "primaryDomain": "project-manager", "useCase": "เจ้าของ Business เปิด Overview เพื่อดู execution KPIs, strategy และ shortcut ของ domain ที่เปิดใช้" },
  { "id": "FR-036", "primaryDomain": "project-manager", "useCase": "PM เพิ่มสมาชิก Business เข้า Project Team และดู active work load ของแต่ละคน" },
  { "id": "FR-038", "primaryDomain": "identity", "useCase": "สมาชิกดู Profile และ Owner จัด role/domain visibility โดยไม่เปิดเผยข้อมูลที่ UI ไม่ใช้" },
  { "id": "FR-039", "primaryDomain": "project-manager", "useCase": "BusinessShell แสดง Workspace, Organization และ Business โดยไม่ยก Space หรือ Project เป็น global scope" },
  { "id": "FR-040", "primaryDomain": "project-manager", "useCase": "ทีมเปิด Structure Plan และ Dependency Map ที่จำกัดเฉพาะ Project ปัจจุบัน" },
  { "id": "FR-042", "primaryDomain": "project-manager", "useCase": "HR เปิด People Directory เพื่อค้นหาคนที่มี Membership ใน Business ปัจจุบัน" },
  { "id": "FR-043", "primaryDomain": "project-manager", "useCase": "ระบบผูก Project กับ Business owner โดยตรงและแสดง Space เป็น grouping context เท่านั้น" },
  { "id": "FR-044", "primaryDomain": "identity", "useCase": "ผู้ใช้เดินจาก Landing ไป Login, Business Routing และ BusinessShell โดยไม่เห็นข้อมูลก่อนผ่าน gate" },
  { "id": "FR-046", "primaryDomain": "identity", "useCase": "production request ใช้ trusted session เพื่อคืน Business Routing payload ที่กรองบน server แล้ว" },
  { "id": "FR-047", "primaryDomain": "knowledge", "useCase": "Agent ตอบจาก curated product projection โดยไม่ส่ง PII, cost, margin หรือ local path ไปยัง model" },
  { "id": "FR-049", "primaryDomain": "agent", "useCase": "ลูกค้าถามราคาและ Agent ตอบเฉพาะตัวเลขที่มี bounded evidence มิฉะนั้นใช้ fallback ภาษาไทย" },
  { "id": "FR-050", "primaryDomain": "agent", "useCase": "LINE event หนึ่งรายการเรียก model และส่ง reply ได้ไม่เกินหนึ่งครั้งแม้มี retry" },
  { "id": "FR-051", "primaryDomain": "agent", "useCase": "runtime อ่าน SmartGift knowledge เฉพาะ Tenant/Business ที่ผูกไว้ผ่าน forced RLS และเก็บ import lineage" },
  { "id": "FR-052", "primaryDomain": "agent", "useCase": "LINE webhook resolve Tenant/Business จาก active binding และปฏิเสธ id ที่ client ส่งมาเอง" },
  { "id": "FR-053", "primaryDomain": "agent", "useCase": "ทีมรัน golden questions 20 ข้อและตรวจ unsupported numbers ก่อนเปิด provider จริง" },
  { "id": "FR-054", "primaryDomain": "agent", "useCase": "Operator รัน isolation probe และสร้าง dry-run canary plan โดยยังไม่ activate หรือส่ง LINE" },
  { "id": "FR-055", "primaryDomain": "agent", "useCase": "Operator activate binding แบบ expiring CAS และบันทึก receipt ที่แยก accepted ออกจาก displayed/read" },
  { "id": "FR-056", "primaryDomain": "project-manager", "useCase": "ผู้ใช้ใหม่เห็น Zuri Heritage landing ที่ responsive และเข้าสู่ login ผ่าน action เดียว" },
  { "id": "FR-057", "primaryDomain": "agent", "useCase": "ทุก LINE turn resolve authorized MSP vaults จาก principal และ scope ก่อน retrieval" },
  { "id": "FR-059", "primaryDomain": "project-manager", "useCase": "Business Owner แก้ Roadmap, Goals และ Project links พร้อม audit ภายใน Business ที่ตนเป็นเจ้าของ" },
  { "id": "FR-061", "primaryDomain": "identity", "useCase": "สมาชิกเห็น CRM ใน Business A แต่ไม่เห็นใน Business B ตาม grant ของแต่ละ Membership" },
  { "id": "FR-062", "primaryDomain": "identity", "useCase": "Owner เปิด Users & Permissions แล้วแก้ได้เฉพาะ Membership ของ Business ที่ตนดูแล" },
  { "id": "FR-063", "primaryDomain": "project-manager", "useCase": "ทีมเปิด Board ที่มีครบทุก work status และแก้ WorkItem ผ่าน editor เดิม" },
  { "id": "FR-064", "primaryDomain": "project-manager", "useCase": "PM ดู Project และ Milestone บน timeline แบบ global หรือ project-scoped โดยไม่เขียนวันที่จากหน้านี้" },
  { "id": "FR-065", "primaryDomain": "project-manager", "useCase": "ระบบตรวจสิทธิ์ Workspace ก่อน dry-run หรือ commit แผนที่ผู้ใช้นำเข้า" },
  { "id": "FR-066", "primaryDomain": "identity", "useCase": "สมาชิกใหม่สร้าง Profile และอยู่ Waiting Room ได้โดยยังไม่ต้องสร้าง Business หรือ Project" },
  { "id": "FR-067", "primaryDomain": "identity", "useCase": "Workspace owner ส่ง invite แบบหมดอายุและใช้ครั้งเดียวโดยไม่ให้สิทธิ์ Business อัตโนมัติ" },
  { "id": "FR-071", "primaryDomain": "knowledge", "useCase": "Operator ดู pipeline stage ที่ล้มแล้ว replay เฉพาะ record นั้นโดยรักษา lineage และ idempotency" },
  { "id": "FR-072", "primaryDomain": "project-manager", "useCase": "mutating route ปฏิเสธการแก้ Project หรือ dependency เมื่อ viewer ไม่ได้เป็นเจ้าของ Business ที่เกี่ยวข้อง" },
  { "id": "FR-073", "primaryDomain": "project-manager", "useCase": "Owner สร้าง repository ใต้ Business และ link กับ Project เมื่อมีสิทธิ์ทั้งสองฝั่ง" },
  { "id": "FR-074", "primaryDomain": "project-manager", "useCase": "ระบบอนุญาตสร้าง Branch, Business หรือ Workspace ตาม authority tier ที่ตรงกับ scope จริง" },
  { "id": "FR-075", "primaryDomain": "identity", "useCase": "installation operator preview และ restore snapshot โดย ordinary Business Owner ทำไม่ได้" },
  { "id": "FR-076", "primaryDomain": "identity", "useCase": "ผู้ดูแลมอบ Product Owner role เฉพาะ Business โดยไม่ขยายสิทธิ์ Platform หรือ secret" },
  { "id": "FR-081", "primaryDomain": "integration", "useCase": "LINE event ถูกเก็บเป็น raw evidence แบบ idempotent ก่อน translation โดยตัด reply token ออก" },
  { "id": "FR-090", "primaryDomain": "identity", "useCase": "Operator เปรียบเทียบ schema โดยไม่ให้เครื่องมือเสนอ DROP ตาราง credential ที่มีอยู่จริง" },
  { "id": "FR-092", "primaryDomain": "market-intelligence", "useCase": "ระบบแปล raw marketplace record เป็น MarketObservation พร้อม source lineage และ unresolved identity ที่ซื่อสัตย์" },
  { "id": "FR-094", "primaryDomain": "project-manager", "useCase": "ผู้บริหารเปิด Product Readiness เพื่อดูเปอร์เซ็นต์ทุกโดเมน แล้ว drill down ถึง feature, use case, tests และ blocker" }
]
```
<!-- readiness-metadata:end -->
