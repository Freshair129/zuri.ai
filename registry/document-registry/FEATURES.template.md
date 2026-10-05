---
id: ZAI:FEATURES
version: "1.68.0b"
status: active
last_update: "2026-10-03T20:30:00+07:00,RWANG"
relations:
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:ADR-101
  - type: relates_to
    target: ZAI:ADR-109
  - type: relates_to
    target: ZAI:ADR-110
  - type: relates_to
    target: ZAI:PLAN-FEAT-019-PHASES
---

# Features (FEAT registry)

Version diff 1.67.0b → 1.68.0b: distinguish explicit Feature bundles from Standalone FRs under ADR-025 revision 3. No IDs, requirement subjects, memberships, use cases or domain claims change.

Version diff 1.66.0b → 1.67.0b (2026-09-27): readiness metadata gains **FR-277** (primary domain `agent`) — the LINE grounding shadow-compare harness (ADR-090 Phase 3, TASK-ZAI-095): disabled by default, a fire-and-forget comparison generation against the paired grounding mode, never customer-visible. A Standalone FR; no FEAT row is added.

Version diff 1.65.0b → 1.66.0b (2026-09-27): readiness metadata gains **FR-275** and **FR-276** (primary domain `marketing`), the Marketing Insights read surface and refresh declared for #554. Each is a Standalone FR; no FEAT row is added.

Version diff 1.64.0b → 1.65.0b (2026-09-27): ADR-110 D1 retires the harness pairing/plugin bundle and Edge-specific LINE transport; historical usage/device records and the server-side PRP key path are preserved. FEAT-018, FEAT-019, FEAT-035, FEAT-039 and FEAT-045 reflect the current boundary; FEAT-017 retirement remains deferred until the residual apps/edge extraction client is removed.

Version diff 1.63.0b -> 1.64.0b (2026-09-26): FEAT-046 declares Business-scoped Notion OAuth token custody and signed receipt-only webhook ingress under ADR-109; implementation and production gates remain separate.

Version diff 1.62.0b -> 1.63.0b (2026-09-22): FEAT-002's "Goals & KPIs" sub-page — FR-268 and FR-271 — moves from declared to Phase 1 implemented under ADR-101 D6: `BusinessKeyResult`(+`CheckIn`) model, write-through progress (SDD-107, BR-044), SMART checklist, StrategyCard UI, attention-queue row. FR-269/FR-270 (KPIs, 4DX) remain declared, Phase 2/3. FEAT-002 stays `building` — see ADR-101's own consequence note. Implementation on `feat/task-zai-122-goal-service-phase1-key-results`; PR pending merge.

Version diff 1.61.0b -> 1.62.0b (2026-09-22): FEAT-002 gains its long-reserved "Goals & KPIs" sub-page — FR-268..FR-271 declared under ADR-101, ownership staying inside FEAT-002 rather than a new bundle because FR-060's own feature note already named this scope ("Out, and each needs its own FR when built: Goals & KPIs, Risks & Alerts and Reports sub-pages"). Declaration only, on `feat/task-zai-122-goal-service-phase0-docs`; FEAT-002 stays `building`.

Version diff 1.60.0b -> 1.61.0b (2026-09-19): Added FEAT-044 for Mission Control DAG orchestration observability, bundling FR-260..FR-264. The implementation remains adapter-only and production is not claimed.

Version diff 1.59.0b -> 1.60.0b: compose Knowledge Console as FR-254 in FEAT-013, preserving published FR-253 Commerce pricing. Console scope unchanged; release verification pending.

Version diff 1.58.0b → 1.59.0b: declare FR-253 Commerce pricing rules and formula engine, owner approved 2026-09-17; TASK-ZAI-055/056/059. Implementation in progress, no production activation.
Version diff 1.57.0b → 1.58.0b: register owner-approved FR-252 Project Feature authority as a project-manager Standalone FR under ADR-097. Cross-domain P1–P4 slices share that requirement; no new FEAT bundle or runtime completion.

Version diff 1.56.0b → 1.57.0b: register owner-approved FR-251 as a project-manager Standalone FR for the read-only Project Execution Domains view, now implemented and verified locally; FEAT-033's FR-215 live overlay is implemented locally with four bounded owning-domain reads.

Version diff 1.55.0b → 1.56.0b: register FR-250 as a project-manager Standalone FR for hierarchical Projects & Work navigation. No new FEAT bundle or runtime completion is asserted.

| Field | Value |
|-------|-------|
| **Version** | 1.68.0b |
| **Status** | Active — hand-maintained source of truth |

A **Feature (`FEAT-xxx`) is a product capability**; a **Functional Requirement
(`FR-xxx`) is a precise system behavior**. They are different id families
(ADR-025 rev 2): a feature bundles one or more FRs, and an FR belongs to at most
one feature. `FEAT` ids follow the same contract as every other id (AGENTS.md
§18): never renumbered, never reused, gaps stay burnt. The duplicate-id guard in
preflight covers this table, and Check 12 (ADR-039) additionally pins each row's
SUBJECT in `.id-ledger.json`, so a FEAT number cannot quietly come to mean a
different capability the way SDD-049 did on 2026-08-20.

## Capability classification

The Product Capability Registry has two readiness-visible entity types:

- **Explicit Feature Bundle:** a product capability declared as `FEAT-xxx`,
  bundling one or more related FRs. A Feature answers “What product capability
  does the user get?”
- **Standalone FR:** an independently deliverable system capability expressed
  directly as an `FR-xxx` Functional Requirement with no explicit FEAT membership.
  An FR answers “What exact behavior must the system provide?” It remains a
  requirement; it is not an implicit or synthetic Feature.

```text
Product Capability Registry
├── Explicit Feature (FEAT)
│   └── bundled Functional Requirements (FR)
└── Standalone Functional Requirement (FR)
```

An FR belongs to **0..1 explicit FEAT**: zero means `standalone-fr`; one means
`bundled-fr` with `featureId = FEAT-xxx`; more than one is invalid. FEAT and FR
are separate semantic types and namespaces. Later bundling preserves the FR ID
and its requirement meaning forever. No synthetic FEAT IDs are allocated.

Create a FEAT when related FRs jointly form a recognizable capability, when
product-level framing is useful, when several surfaces/workflows/domains form
one capability, or when roadmap/readiness needs capability-level tracking.
Keep an FR standalone when it is bounded and independently useful and no broader
grouping adds product meaning. Do not mechanically wrap every FR in a FEAT.
A deliberate one-FR Feature is valid when its product framing adds meaning;
existing one-FR bundles remain unchanged.

Verified examples: **FEAT-023 Commerce — Orders & Payments** bundles **FR-166**
and **FR-163** (bundled FRs). **FR-046 Production viewer entry contract** has no FEAT membership
and is a Standalone FR; its readiness primary domain is `identity`. These
examples describe membership, not a production-readiness claim.

The graph reads this table (`feat:` nodes, `bundles` edges). TRACE includes a
deterministic inventory of every canonical FR: classification, FEAT membership,
charter/note ownership, readiness primary domain, metadata/use-case presence and
code/test evidence state. Presentation domain is not an ownership claim.

| ID | Feature | FRs | Status |
|---|---|---|---|
{{CANONICAL_ROW:FEAT-001}}{{CANONICAL_ROW:FEAT-002}}{{CANONICAL_ROW:FEAT-003}}{{CANONICAL_ROW:FEAT-004}}{{CANONICAL_ROW:FEAT-005}}{{CANONICAL_ROW:FEAT-006}}{{CANONICAL_ROW:FEAT-007}}{{CANONICAL_ROW:FEAT-008}}{{CANONICAL_ROW:FEAT-009}}{{CANONICAL_ROW:FEAT-010}}{{CANONICAL_ROW:FEAT-011}}{{CANONICAL_ROW:FEAT-012}}{{CANONICAL_ROW:FEAT-013}}{{CANONICAL_ROW:FEAT-014}}{{CANONICAL_ROW:FEAT-015}}{{CANONICAL_ROW:FEAT-016}}{{CANONICAL_ROW:FEAT-017}}{{CANONICAL_ROW:FEAT-018}}{{CANONICAL_ROW:FEAT-019}}{{CANONICAL_ROW:FEAT-020}}{{CANONICAL_ROW:FEAT-021}}{{CANONICAL_ROW:FEAT-022}}{{CANONICAL_ROW:FEAT-023}}{{CANONICAL_ROW:FEAT-024}}{{CANONICAL_ROW:FEAT-025}}{{CANONICAL_ROW:FEAT-026}}{{CANONICAL_ROW:FEAT-027}}{{CANONICAL_ROW:FEAT-028}}{{CANONICAL_ROW:FEAT-029}}{{CANONICAL_ROW:FEAT-030}}{{CANONICAL_ROW:FEAT-031}}{{CANONICAL_ROW:FEAT-032}}{{CANONICAL_ROW:FEAT-033}}{{CANONICAL_ROW:FEAT-034}}{{CANONICAL_ROW:FEAT-035}}{{CANONICAL_ROW:FEAT-036}}{{CANONICAL_ROW:FEAT-037}}{{CANONICAL_ROW:FEAT-038}}{{CANONICAL_ROW:FEAT-039}}{{CANONICAL_ROW:FEAT-040}}{{CANONICAL_ROW:FEAT-041}}{{CANONICAL_ROW:FEAT-042}}{{CANONICAL_ROW:FEAT-043}}{{CANONICAL_ROW:FEAT-044}}{{CANONICAL_ROW:FEAT-045}}{{CANONICAL_ROW:FEAT-046}}
Version diff 1.39.0b → 1.40.0b (2026-09-12): FEAT-030 declared and implemented in the same change — audit events carry queryable scope (FR-198) and identity gains the two read models an access review needs (FR-199), under ADR-080. Closes the gap ADR-077's grant lifecycle assumed was already open.

Version diff 1.13.0b → 1.14.0b (2026-09-01): FEAT-015 is building with local domain, validation, schema, backup, pipeline and dashboard foundations. Provider-backed OCR/Vision, LINE binary handoff, live Google Sheet sync, Procurement/Finance adapters and Project Inventory projection are not claimed live.

Version diff 1.14.0b → 1.15.0b (2026-09-02): FEAT-016 is owner-approved for implementation. It enables private evidence upload, candidate extraction/review, workbook/Sheet snapshot convergence and trusted LINE FileAsset handoff, while registration, Procurement and Finance writes remain excluded.

Version diff 1.15.0b → 1.16.0b (2026-09-02): FEAT-016 is implemented and fully verified in the local delivery branch. The OpenAI and Supabase adapters are live code but require server credentials/private bucket configuration; no claim is made that a real provider call or production migration has run. Asset registration, Procurement writes and Finance posting remain excluded.

Version diff 1.16.0b → 1.17.0b (2026-09-04): FEAT-017 is declared under ADR-059. It moves the FR-138 extraction call off the platform OpenAI key and onto the customer's own Zuri Edge Device by queueing a job the device pulls, claims under a lease, and completes through the same candidate schema and the same write path. Nothing is claimed built: this entry is the declaration lane's output — requirements, ADR, feature notes, charter ownership and the wire contract — and the implementation lanes follow. The OpenAI provider stays selectable, the Supabase migration is written but not applied, and the edge runtime itself lives in the zuri-edge-device repository.

Version diff 1.17.0b → 1.18.0b (2026-09-05): FEAT-018 is declared under ADR-060 as Phase 1's first slice. It bundles FR-146, the `LineOaAccount` aggregate — the operating record for one LINE Official Account, many per Business, joined by reference to the integration lane's LINE_OA connection, the agent lane's binding code and the account's transport owner. Nothing is claimed built: no model, route, migration, navigation or code. The rich-menu designer, the transport-job lane, the publisher role and the crm thread-key prerequisite follow as their own FRs inside the same feature.

Version diff 1.18.0b → 1.19.0b (2026-09-05): FEAT-018 is building. FR-146's first slice is implemented locally — the `LineOaAccount` model, its only writer, the two account routes, the confirmed `LINE_OA_PUBLISHER` role and the reserved `line-oa` domain slot — with an integration suite against a real database. Not claimed: the agent binding reader (so no account can read LIVE yet), the `/line-oa` pages, transport jobs, quota, and production application of the migration.

Version diff 1.19.0b → 1.20.0b (2026-09-05): FEAT-018 gains FR-147, the agent lane's read-only binding status contract, wired as FR-146's default binding port — an account can now read LIVE when the read role sees an ACTIVE, in-window binding. The contract reports ACTIVE / NOT_ACTIVE / NO_BINDING / UNKNOWN and nothing finer, because the read policy cannot see more. Still not claimed: the `/line-oa` pages, transport jobs, quota, production application of the migration, and a per-Tenant read policy (today pinned to SmartGift).

Version diff 1.20.0b → 1.21.0b (2026-09-06): FEAT-018 gains FR-151, the rich menu designer — `LineOaRichMenu` with numbered `LineOaRichMenuVersion` bodies that freeze into immutable versions, LINE layout and image-size rules, allow-listed tap actions, `FileAsset` image references and the same publisher-only, 404-shaped, compare-and-swap write discipline as the account. Not claimed: the designer page, publishing a frozen version to LINE (the transport-job requirement), default/alias/link jobs, and production application of the migration.

Version diff 1.21.0b → 1.22.0b (2026-09-06): FEAT-018 gains FR-152, the server-owned publish jobs that carry a frozen rich menu version to LINE under ADR-061 — queued by a publisher, claimed by the server worker with compare-and-set and a lease, executed through the Integration lane's rich menu port, settled by the provider's acceptance with ambiguity classified by idempotency (an unconfirmed create is UNKNOWN; upload, default and alias retry). Not claimed: a real LINE canary, the designer page, LIFF URL resolution, production application of the migration.

Version diff 1.23.0b → 1.24.0b (2026-09-06): FEAT-018 gains FR-153, the LIFF app registry — what LIFF apps an account has, with the LINE-issued liffId as an attribute, so a rich menu LIFF action publishes as a liff.line.me link through an ACTIVE app instead of being refused. Not claimed: creating the app on LINE (needs a LINE Login credential contract), the designer's LIFF tab, flow LIFF nodes, production application of the migration.

Version diff 1.24.0b → 1.25.0b (2026-09-06): FEAT-020 is declared and building — the Inventory domain (`DOM-INVENTORY`, คลังสินค้า) the owner asked for, bundling FR-154 (catalogue identity: category, family, factory, product master, SKU with a fixed counted / uncounted policy, bundle) and FR-155 (the append-only stock ledger with lots and serial units, on-hand always recomputed). Implemented locally with both migrations written; the owner's node/edge ontology is recorded in `docs/domains/inventory/ONTOLOGY.md` with offers, tiers, segments and orders deferred to a Commerce lane. Not claimed: Excel/LINE intake, warehouse locations, reservations, costing, production application of the migration.

Version diff 1.25.0b → 1.26.0b (2026-09-06): FEAT-020 gains FR-156, the recipe / bill of materials at a batch size — the legacy product's "Culinary" recipes-per-class-size relabelled as the general BOM they are (one recipe per output SKU and batch size, fixed lines that do not scale, explosion and shortages against the ledger, an atomic build that issues components FEFO and receives the output). FR-155 gains FEFO consumption. The domain's display label is Warehouse. Not claimed: a recipe editor page, costing, yield loss, multi-level explosion, production application of the migration.

Version diff 1.26.0b → 1.27.0b (2026-09-07): FEAT-021 gains FR-162 Marketing Operations coordination — Business-scoped intake with audited CAS writes and one aggregate over Marketing approvals, protected PM schedule and validated handoff receipts. No duplicate PM, CRM, Commerce or provider write path is introduced.
Version diff 1.27.0b → 1.28.0b (2026-09-07): FEAT-022 is declared and building — Sales Tasks, the legacy ERD's "Tasks" adapted on the owner's instruction into a CRM sales activity record (ADR-064) bundling FR-161: a Business-scoped follow-up owed to a customer with a generated `TSK-YYYYMMDD-NNN` code, links to the CRM Customer and Conversation through the tenant, an assignee with a covering Membership, a status machine and a due state computed on read. Not claimed: creating a task from a LINE chat, reminders, Notion/calendar sync, production application of the migration.
Version diff 1.28.0b → 1.29.0b (2026-09-07): Reconcile published main's FEAT-022 / FR-161 CRM Sales Tasks with FEAT-021's Marketing Operations slice moved to FR-162; preserve both feature subjects and their separate domain ownership.

Version diff 1.28.0b → 1.29.0b (2026-09-07): FEAT-023 is declared and building — Commerce's first slice under ADR-065, bundling FR-166 (sales orders with lines, exact money, an origin that a Conversation makes CHAT, fulfilment through the Inventory contract) and FR-163 (payments and refunds verified by a second hat, revenue counted from verified money only by origin and day). The `commerce` slot leaves `soon`. Not claimed: the offer / price catalogue, slip OCR, invoices and receipts, store credit, production application of the migration.


Version diff 1.29.0b → 1.30.0b (2026-09-07): FEAT-024 is declared and building — the Procurement lane under ADR-066, the "Procurement" module of the owner's SCM row (`docs/ERP-MODULE-MAP.md`), bundling FR-164 (suppliers, purchase orders with lines at the agreed cost, SEND / CLOSE / CANCEL, everything about quantities and money computed on read) and FR-165 (goods receipts posted line by line against a sent order, counted lines landing in the Inventory ledger with lot, expiry and serials, the order received by the receipt that completes it). The `procurement` slot is live. Not claimed: purchase requests and approvals, RFQs, returns and credit notes, supplier invoices, landed cost, production application of the migration.


Version diff 1.32.0b → 1.33.0b (2026-09-10): FEAT-025 is declared and building — the SmartGift SCM slice under ADR-074, bundling FR-174 (warehouse locations and the located ledger), FR-175 (landed cost in satang with the flat single-drop truck absorbed into unit valuation), FR-176 (customization work orders and the irreversible customer-dedicated lock), FR-177 (kitting work orders with a declared scrap allowance and the FlowAccount finished-set SKU), FR-178 (de-kitting), FR-179 (the shelf-life storage guard), FR-180 (Available-to-Promise with two-tier reservations) and FR-181 (six agent tools on the existing Gate E / Gate F registries). Not claimed: FlowAccount catalogue and stock synchronisation, cycle counting and stocktake campaigns, HTTP routes and console pages for locations, work orders and reservations, and production application of migration `20260910120000_smartgift_scm_wip`.

Version diff 1.33.0b → 1.34.0b (2026-09-10): FEAT-025 gains FR-182 — the console and API surface ADR-074 consequence 5 deferred. Thirteen `/api/inventory/**` route files and four pages (`/inventory`, `/inventory/locations`, `/inventory/work-orders`, `/inventory/reservations`) over the services FR-174..FR-181 already shipped: no new model, no migration, no new authority, and Inventory becomes the third module to render in-canvas tabs (FR-170). Still not claimed: FlowAccount synchronisation, cycle counting and stocktake campaigns.

Version diff 1.34.0b → 1.35.0b (2026-09-11): FEAT-025 gains owner-approved FR-184 — the existing Inventory surface's durable NONE/LOT stocktake preview and atomic fenced commit, with strict stale/idempotency outcomes and feature-specific recovery. SERIAL observation, bins, campaigns, and production migration remain outside the slice.

Version diff 1.35.0b → 1.36.0b (2026-09-11): FEAT-021 gains approved FR-185 — Business-scoped LINE broadcast planning identity and append-only revisions with strict owner references, deterministic read projections and unavailable dispatch. The slice does not add provider metrics, audience resolution, consent snapshots, sends or workers.

Version diff 1.37.0b → 1.38.0b (2026-09-11): FEAT-026 readiness note updated — Phase 1 implemented (PR #324), owner answered ADR-075 questions 2–4 and opened the Phase 2 gate (Option A, contract revision 2). The FEAT-026 row itself is unchanged.

Version diff 1.35.0b → 1.36.0b (2026-09-11): ADR-075 approved by the owner on PR #321; FEAT-026 moves to `approved`, Phase 1 (FR-187) authorized, no code yet.

Version diff 1.34.0b → 1.35.0b (2026-09-11): FEAT-026 is declared `proposed` — the SmartGift Catalog Convergence slice under **ADR-075**, which is itself `status: proposed` and owner-unapproved. Bundles FR-187 (structured-record source adapter before Stage 1), FR-188 (structured parser profile and `ontology_v2` contract) and FR-189 (edge reads the published generation through MSP, with Genesis RAG v4 as a time-boxed transitional fallback). Docs only: no code, no schema, no migration, no production deployment. Declines CR-002's `Workspace.catalogVaultId`/`vaultNamespace` proposal per `PLAN-PENDING-KNOWLEDGE-20260831` D7.
## Readiness Dashboard presentation metadata

This block is the hand-maintained presentation contract for FR-124. It carries
one entry for every **readiness item**: each explicit `FEAT` row in the table
above, plus each Standalone FR (ADR-025 revision 3). It declares no new ids and moves no requirement
ownership; `primaryDomain` is a presentation choice about which lane's card a
readiness item appears on, not a charter claim.

It exists because one field here cannot be derived from anything: `useCase` is
the sentence saying what a Human can do with the readiness item, and no generator can
infer it. `npm run docs:graph` therefore **fails** — rather than quietly
projecting a shorter list — when an entry is missing, duplicated, names an id
that is not projected, names a domain with no charter, or has an empty use case.
The practical cost is real and deliberate: declaring a new Standalone FR also means
writing one sentence here, or the governance chain stops.

### Readiness type contract

`ReadinessItem = FeatureReadinessItem | StandaloneFrReadinessItem`.
Hand-maintained rows stay `{ id, primaryDomain, useCase }`: type is derived from
validated membership and ID, never a second editable registry field.
`FEAT-* → kind: feature`; projected `FR-* → kind: standalone-fr`.

For compatibility, generated schema 2.0 retains `features`, `featureCount`,
`readyFeatureCount` and wire `kind: bundle | requirement`. These are readiness
item containers/counts, not a claim that every item is a Feature. The server read
model normalizes kind to `feature | standalone-fr` from the ID prefix; both
Product Readiness and its Platform Domain Map consumer label the types explicitly.
The wire schema ties each prefix to its kind. Metadata is required for each FEAT
and Standalone FR; bundled FRs inherit their bundle's presentation entry and
must not retain a separate standalone entry. Readiness/evidence calculations,
use cases, authorization and charter ownership remain unchanged.

Graph generation rejects unknown/repeated FRs in a bundle, multiple FEAT
membership, empty bundles, missing/extra metadata and blank use cases. Preflight
also rejects retired classification terminology in live authoritative documents.

<!-- readiness-metadata:start -->
```json
[
  {
    "id": "FR-171",
    "primaryDomain": "agent",
    "useCase": "Inspect exact context, model usage and delivery evidence for a native SERVER LINE turn without repeating side effects."
  },
  {
    "id": "FEAT-001",
    "primaryDomain": "project-manager",
    "useCase": "ผู้จัดการโครงการเปิดไฟล์ระดับ Business และ Project เพื่อตรวจตำแหน่ง ลิงก์ และสถานะ reconcile จากหน้าเดียว"
  },
  {
    "id": "FEAT-002",
    "primaryDomain": "project-manager",
    "useCase": "ผู้บริหารเลือก Business แล้วดู project health, domain health และรายการที่ต้องจัดการในหน้า Home เดียว"
  },
  {
    "id": "FEAT-003",
    "primaryDomain": "project-manager",
    "useCase": "เจ้าของงานระบุ objective แล้วตรวจ Blueprint และ Roadmap เดียวกันที่ Human และ Agent ใช้ส่งแผน"
  },
  {
    "id": "FEAT-004",
    "primaryDomain": "integration",
    "useCase": "Owner เลือก LINE model provider และ Vault reference ของ Business โดยไม่เปิดเผย secret ใน browser"
  },
  {
    "id": "FEAT-005",
    "primaryDomain": "project-manager",
    "useCase": "PM เปิด Project Inventory ก่อน review เพื่อเห็น work, gates, files, repositories, team และ progress พร้อมกัน"
  },
  {
    "id": "FEAT-006",
    "primaryDomain": "crm",
    "useCase": "Data steward นำเข้าประวัติลูกค้าโดยเก็บ provenance และพักกลุ่ม duplicate ให้ผู้มีสิทธิ์ตัดสินใจ"
  },
  {
    "id": "FEAT-007",
    "primaryDomain": "project-manager",
    "useCase": "PM ลากโครงสร้างงาน เชื่อม dependency พร้อม Handoff Contract และให้ Board ถือรายการจน Gate ผ่าน"
  },
  {
    "id": "FEAT-008",
    "primaryDomain": "project-manager",
    "useCase": "Head of Development ดู KPI, Top-5 priority, PIC และ Teams แล้วเปิด Project ที่ต้องเร่งต่อ"
  },
  {
    "id": "FEAT-009",
    "primaryDomain": "crm",
    "useCase": "Operator เปิด CRM Inbox แล้วเห็นทั้งข้อความขาเข้าและข้อความขาออกที่ส่งถึงลูกค้าจริง"
  },
  {
    "id": "FEAT-010",
    "primaryDomain": "identity",
    "useCase": "ผู้ดูแลติดตั้งระบบผูก Person เดียวกับหลายช่องทางเข้าใช้ กำหนด Membership ที่ยังใช้งานอยู่ และจำกัด scope ของ agent/tool ด้วยนโยบายชุดเดียวกัน"
  },
  {
    "id": "FEAT-011",
    "primaryDomain": "project-manager",
    "useCase": "ผู้ดูแล SoT Pipeline เปิดกระดานแผน อนุมัติรายการที่ค้างในกล่องรออนุมัติ แล้วดูสถานะ node/edge ของทั้ง pipeline จากมุมมองกราฟ"
  },
  {
    "id": "FEAT-012",
    "primaryDomain": "project-manager",
    "useCase": "ผู้วางแผนนำเข้า programme ทั้งชุด — กลยุทธ์ หลาย Project และ dependency ข้าม Project — ผ่าน dry-run เดียวและการยืนยันครั้งเดียว"
  },
  {
    "id": "FEAT-013",
    "primaryDomain": "knowledge",
    "useCase": "ผู้ดูแลความรู้ตรวจ catalog ของ 17 stage, ไล่ trace ของ job หนึ่งจนจบ และรู้ว่า snapshot ใดที่คำตอบหนึ่งอ่านมา ภายใต้นโยบายความอ่อนไหวที่กำหนดว่าอะไร index ได้และประมวลผลที่ไหนได้"
  },
  {
    "id": "FEAT-014",
    "primaryDomain": "crm",
    "useCase": "ทีมขายเปิดโปรไฟล์ลูกค้าที่ AI สรุปจากบทสนทนา LINE ดูผลวิเคราะห์รายบทสนทนา และรับ Daily Sales Brief ของ Business ในแต่ละวัน"
  },
  {
    "id": "FEAT-015",
    "primaryDomain": "asset-management",
    "useCase": "เจ้าหน้าที่รับอุปกรณ์แนบใบเสร็จและหลักฐานจ่ายเงิน ตรวจ OCR ผูก PR/PO ระบุผู้รับผิดชอบ สถานที่ Project และดูค่าเสื่อมตัวอย่างก่อนขึ้นทะเบียนทรัพย์สิน"
  },
  {
    "id": "FEAT-016",
    "primaryDomain": "asset-management",
    "useCase": "เจ้าหน้าที่อัปโหลดรูปหรือ PDF หลักฐาน ให้ OCR/Vision เสนอข้อมูล ตรวจแก้โดยมนุษย์ และนำเข้าหรือส่งออก Excel/Google Sheets/LINE ผ่าน intake เดียวกันจนพร้อมขึ้นทะเบียน"
  },
  {
    "id": "FEAT-017",
    "primaryDomain": "asset-management",
    "useCase": "เจ้าของธุรกิจออกกุญแจให้ Zuri Edge Device ของตนเองหนึ่งครั้ง แล้วอุปกรณ์ที่หน้างานดึงงานอ่านหลักฐานทรัพย์สินไปประมวลผลด้วยโมเดลในเครื่องตนเอง ส่งผลกลับมาให้คนตรวจในหน้าเดิม โดยคลาวด์ไม่เก็บ API key ของผู้ให้บริการและไม่เก็บความลับของอุปกรณ์"
  },
  {
    "id": "FEAT-018",
    "primaryDomain": "line-oa-studio",
    "useCase": "เจ้าของธุรกิจเชื่อมบัญชี LINE Official Account หลายบัญชีเข้ากับ Business เดียว เห็นสถานะการเชื่อมต่อ binding และ webhook ล่าสุดของแต่ละบัญชีในที่เดียว และใช้ transport ที่ server เป็นเจ้าของกับทุกบัญชี โดยไม่เห็นความลับของ LINE"
  },
  {
    "id": "FR-001",
    "primaryDomain": "project-manager",
    "useCase": "ผู้ดูแลสร้าง Portfolio, Tenant, Business, Branch และ Space ด้วย UUID และ human code ที่ตรวจย้อนกลับได้"
  },
  {
    "id": "FR-002",
    "primaryDomain": "project-manager",
    "useCase": "ผู้ใช้สลับ Portfolio, Business, Space และ Project แล้วกลับมาเจอ context ล่าสุด"
  },
  {
    "id": "FR-003",
    "primaryDomain": "project-manager",
    "useCase": "PM สร้าง แก้ไข เปิด และ archive Project โดยไม่ลบประวัติ"
  },
  {
    "id": "FR-004",
    "primaryDomain": "project-manager",
    "useCase": "PM สร้าง Workstream พร้อม execution mode, progress strategy และน้ำหนักที่เหมาะกับงาน"
  },
  {
    "id": "FR-005",
    "primaryDomain": "project-manager",
    "useCase": "ทีมเปิด All Work เพื่อค้นหาและเปลี่ยนสถานะ WorkItem ข้าม Project หรือภายใน Project เดียว"
  },
  {
    "id": "FR-006",
    "primaryDomain": "project-manager",
    "useCase": "PM สร้าง Milestone และ Gate พร้อมหลักฐาน แล้วติดตามว่าจุดควบคุมใดผ่านหรือค้าง"
  },
  {
    "id": "FR-007",
    "primaryDomain": "project-manager",
    "useCase": "PM เชื่อม dependency ระหว่างงานและเห็น cycle หรือ blocker ก่อนบันทึก"
  },
  {
    "id": "FR-008",
    "primaryDomain": "project-manager",
    "useCase": "ทีมบันทึก repository metadata และผูก repository เดียวกับหลาย Project อย่างมีขอบเขต"
  },
  {
    "id": "FR-009",
    "primaryDomain": "project-manager",
    "useCase": "ทีมเปิดมุมมอง Sprint, Migration, Sales หรือโหมดอื่นจาก work model กลางเดียวกัน"
  },
  {
    "id": "FR-010",
    "primaryDomain": "project-manager",
    "useCase": "PM เปิด Explain เพื่อดูว่าค่า progress ของ Workstream มาจาก strategy และ evidence ใด"
  },
  {
    "id": "FR-011",
    "primaryDomain": "project-manager",
    "useCase": "ผู้บริหารดู Project progress ที่ roll up จาก Workstream ตามน้ำหนักแทนการนับ task ตรงๆ"
  },
  {
    "id": "FR-012",
    "primaryDomain": "project-manager",
    "useCase": "ทีม preview Agent JSON plan ตรวจ conflict แล้ว commit ทั้งแผนใน transaction เดียว"
  },
  {
    "id": "FR-013",
    "primaryDomain": "project-manager",
    "useCase": "Operator export snapshot และ preview ผลกระทบก่อนยืนยัน restore"
  },
  {
    "id": "FR-014",
    "primaryDomain": "project-manager",
    "useCase": "Auditor ค้นเหตุการณ์เพื่อดูว่าใครเปลี่ยนอะไร เมื่อใด และใน scope ไหน"
  },
  {
    "id": "FR-015",
    "primaryDomain": "project-manager",
    "useCase": "ผู้ใช้กด Ctrl+K เพื่อค้นหา route หรือคำสั่งโดยไม่ไล่เมนู"
  },
  {
    "id": "FR-016",
    "primaryDomain": "project-manager",
    "useCase": "ทีมเดโม reset และ seed ข้อมูลครบเจ็ด execution modes ซ้ำได้โดยไม่สร้างข้อมูลซ้อน"
  },
  {
    "id": "FR-017",
    "primaryDomain": "project-manager",
    "useCase": "ผู้ใช้เริ่ม Project จาก objective แล้วให้ wizard สร้างแผนเข้าสู่ pipeline กลาง"
  },
  {
    "id": "FR-018",
    "primaryDomain": "project-manager",
    "useCase": "ทีมกรอก Excel template แล้วเห็น error ระดับแถวก่อนนำเข้าแผน"
  },
  {
    "id": "FR-019",
    "primaryDomain": "project-manager",
    "useCase": "ระบบภายนอก upsert Project ด้วย external id ผ่าน Enterprise API โดยไม่ใช้ external id เป็น primary key"
  },
  {
    "id": "FR-020",
    "primaryDomain": "project-manager",
    "useCase": "เจ้าของธุรกิจเดียวเข้าใช้งานโดยไม่เห็น switcher ที่ไม่จำเป็น ขณะที่เจ้าของหลายธุรกิจเลือก context ได้"
  },
  {
    "id": "FR-021",
    "primaryDomain": "identity",
    "useCase": "LINE user คนเดิมถูก resolve เป็น Person เดิมภายใน Tenant เดิมโดยไม่สร้าง identity ซ้ำ"
  },
  {
    "id": "FR-022",
    "primaryDomain": "identity",
    "useCase": "สมาชิกใช้ token ครั้งเดียวเพื่อ link LINE กับบัญชี และขอ revoke หรือ erase ตาม PDPA"
  },
  {
    "id": "FR-023",
    "primaryDomain": "crm",
    "useCase": "ข้อความ LINE แรกสร้าง Customer, Conversation และ Message แบบ tenant-scoped ใน transaction เดียว"
  },
  {
    "id": "FR-024",
    "primaryDomain": "knowledge",
    "useCase": "Agent ขอ neighbourhood ของลูกค้าและธุรกิจจากกราฟ โดยราคาสดและข้อมูลปฏิบัติการยังอ่านจากเจ้าของข้อมูล"
  },
  {
    "id": "FR-025",
    "primaryDomain": "agent",
    "useCase": "Agent ประกอบ read context จาก Identity, MSP, Knowledge และ read-only tools ก่อนตอบคำถาม"
  },
  {
    "id": "FR-026",
    "primaryDomain": "agent",
    "useCase": "Agent ขอทำ action ที่มีความเสี่ยงสูงและระบบบังคับ step-up token ก่อน execute และ audit"
  },
  {
    "id": "FR-027",
    "primaryDomain": "agent",
    "useCase": "ข้อความหนึ่งรอบไหลจาก ingest ผ่าน context/action gate ไปสู่คำตอบ โดย refusal ไม่ทำให้ runtime ล้ม"
  },
  {
    "id": "FR-028",
    "primaryDomain": "agent",
    "useCase": "zuri-cli ส่ง normalized LINE event เข้า webhook ที่ปฏิเสธ scope ซึ่งไม่ได้ resolve จาก server"
  },
  {
    "id": "FR-029",
    "primaryDomain": "agent",
    "useCase": "ทีมสลับ MSP memory และ GKS adapters ผ่าน ports โดยไม่ผูก agent กับ storage ตัวเดียว"
  },
  {
    "id": "FR-030",
    "primaryDomain": "integration",
    "useCase": "Operator export/import snapshot ไป Postgres พร้อม guard ไม่ให้ Zuri DB ชี้ฐานเดียวกับ MSP"
  },
  {
    "id": "FR-031",
    "primaryDomain": "identity",
    "useCase": "ทุก request resolve viewer เป็น OWNER, MEMBER หรือ DEV พร้อม Business และ domain ที่มองเห็นได้"
  },
  {
    "id": "FR-032",
    "primaryDomain": "project-manager",
    "useCase": "ผู้ใช้เปิด Home แล้วเลือกเฉพาะ Group หรือ Business ที่ viewer มีสิทธิ์เห็น"
  },
  {
    "id": "FR-033",
    "primaryDomain": "project-manager",
    "useCase": "ผู้ใช้เห็น domain, lens, command palette และ profile บน Topbar โดยไม่มี scope dropdown ซ้ำ"
  },
  {
    "id": "FR-034",
    "primaryDomain": "project-manager",
    "useCase": "ผู้ใช้คลิก breadcrumb เพื่อย้อนกลับไปเปลี่ยน Business หรือเปิดรายการ Space และ Project"
  },
  {
    "id": "FR-035",
    "primaryDomain": "project-manager",
    "useCase": "เจ้าของ Business เปิด Overview เพื่อดู execution KPIs, strategy และ shortcut ของ domain ที่เปิดใช้"
  },
  {
    "id": "FR-036",
    "primaryDomain": "project-manager",
    "useCase": "PM เพิ่มสมาชิก Business เข้า Project Team และดู active work load ของแต่ละคน"
  },
  {
    "id": "FR-038",
    "primaryDomain": "identity",
    "useCase": "สมาชิกดู Profile และ Owner จัด role/domain visibility โดยไม่เปิดเผยข้อมูลที่ UI ไม่ใช้"
  },
  {
    "id": "FR-039",
    "primaryDomain": "project-manager",
    "useCase": "BusinessShell แสดง Workspace, Organization และ Business โดยไม่ยก Space หรือ Project เป็น global scope"
  },
  {
    "id": "FR-040",
    "primaryDomain": "project-manager",
    "useCase": "ทีมเปิด Structure Plan และ Dependency Map ที่จำกัดเฉพาะ Project ปัจจุบัน"
  },
  {
    "id": "FR-042",
    "primaryDomain": "project-manager",
    "useCase": "HR เปิด People Directory เพื่อค้นหาคนที่มี Membership ใน Business ปัจจุบัน"
  },
  {
    "id": "FR-043",
    "primaryDomain": "project-manager",
    "useCase": "ระบบผูก Project กับ Business owner โดยตรงและแสดง Space เป็น grouping context เท่านั้น"
  },
  {
    "id": "FR-044",
    "primaryDomain": "identity",
    "useCase": "ผู้ใช้เดินจาก Landing ไป Login, Business Routing และ BusinessShell โดยไม่เห็นข้อมูลก่อนผ่าน gate"
  },
  {
    "id": "FR-046",
    "primaryDomain": "identity",
    "useCase": "production request ใช้ trusted session เพื่อคืน Business Routing payload ที่กรองบน server แล้ว"
  },
  {
    "id": "FR-047",
    "primaryDomain": "knowledge",
    "useCase": "Agent ตอบจาก curated product projection โดยไม่ส่ง PII, cost, margin หรือ local path ไปยัง model"
  },
  {
    "id": "FR-049",
    "primaryDomain": "agent",
    "useCase": "ลูกค้าถามราคาและ Agent ตอบเฉพาะตัวเลขที่มี bounded evidence มิฉะนั้นใช้ fallback ภาษาไทย"
  },
  {
    "id": "FR-050",
    "primaryDomain": "agent",
    "useCase": "LINE event หนึ่งรายการเรียก model และส่ง reply ได้ไม่เกินหนึ่งครั้งแม้มี retry"
  },
  {
    "id": "FR-051",
    "primaryDomain": "agent",
    "useCase": "runtime อ่าน SmartGift knowledge เฉพาะ Tenant/Business ที่ผูกไว้ผ่าน forced RLS และเก็บ import lineage"
  },
  {
    "id": "FR-052",
    "primaryDomain": "agent",
    "useCase": "LINE webhook resolve Tenant/Business จาก active binding และปฏิเสธ id ที่ client ส่งมาเอง"
  },
  {
    "id": "FR-053",
    "primaryDomain": "agent",
    "useCase": "ทีมรัน golden questions 20 ข้อและตรวจ unsupported numbers ก่อนเปิด provider จริง"
  },
  {
    "id": "FR-054",
    "primaryDomain": "agent",
    "useCase": "Operator รัน isolation probe และสร้าง dry-run canary plan โดยยังไม่ activate หรือส่ง LINE"
  },
  {
    "id": "FR-055",
    "primaryDomain": "agent",
    "useCase": "Operator activate binding แบบ expiring CAS และบันทึก receipt ที่แยก accepted ออกจาก displayed/read"
  },
  {
    "id": "FR-056",
    "primaryDomain": "project-manager",
    "useCase": "ผู้ใช้ใหม่เห็น Zuri Heritage landing ที่ responsive และเข้าสู่ login ผ่าน action เดียว"
  },
  {
    "id": "FR-057",
    "primaryDomain": "agent",
    "useCase": "ทุก LINE turn resolve authorized MSP vaults จาก principal และ scope ก่อน retrieval"
  },
  {
    "id": "FR-059",
    "primaryDomain": "project-manager",
    "useCase": "Business Owner แก้ Roadmap, Goals และ Project links พร้อม audit ภายใน Business ที่ตนเป็นเจ้าของ"
  },
  {
    "id": "FR-061",
    "primaryDomain": "identity",
    "useCase": "สมาชิกเห็น CRM ใน Business A แต่ไม่เห็นใน Business B ตาม grant ของแต่ละ Membership"
  },
  {
    "id": "FR-062",
    "primaryDomain": "identity",
    "useCase": "Owner เปิด Users & Permissions แล้วแก้ได้เฉพาะ Membership ของ Business ที่ตนดูแล"
  },
  {
    "id": "FR-063",
    "primaryDomain": "project-manager",
    "useCase": "ทีมเปิด Board ที่มีครบทุก work status และแก้ WorkItem ผ่าน editor เดิม"
  },
  {
    "id": "FR-064",
    "primaryDomain": "project-manager",
    "useCase": "PM ดู Project และ Milestone บน timeline แบบ global หรือ project-scoped โดยไม่เขียนวันที่จากหน้านี้"
  },
  {
    "id": "FR-065",
    "primaryDomain": "project-manager",
    "useCase": "ระบบตรวจสิทธิ์ Workspace ก่อน dry-run หรือ commit แผนที่ผู้ใช้นำเข้า"
  },
  {
    "id": "FR-066",
    "primaryDomain": "identity",
    "useCase": "สมาชิกใหม่สร้าง Profile และอยู่ Waiting Room ได้โดยยังไม่ต้องสร้าง Business หรือ Project"
  },
  {
    "id": "FR-067",
    "primaryDomain": "identity",
    "useCase": "Workspace owner ส่ง invite แบบหมดอายุและใช้ครั้งเดียวโดยไม่ให้สิทธิ์ Business อัตโนมัติ"
  },
  {
    "id": "FR-071",
    "primaryDomain": "knowledge",
    "useCase": "Operator ดู pipeline stage ที่ล้มแล้ว replay เฉพาะ record นั้นโดยรักษา lineage และ idempotency"
  },
  {
    "id": "FR-072",
    "primaryDomain": "project-manager",
    "useCase": "mutating route ปฏิเสธการแก้ Project หรือ dependency เมื่อ viewer ไม่ได้เป็นเจ้าของ Business ที่เกี่ยวข้อง"
  },
  {
    "id": "FR-073",
    "primaryDomain": "project-manager",
    "useCase": "Owner สร้าง repository ใต้ Business และ link กับ Project เมื่อมีสิทธิ์ทั้งสองฝั่ง"
  },
  {
    "id": "FR-074",
    "primaryDomain": "project-manager",
    "useCase": "ระบบอนุญาตสร้าง Branch, Business หรือ Workspace ตาม authority tier ที่ตรงกับ scope จริง"
  },
  {
    "id": "FR-075",
    "primaryDomain": "identity",
    "useCase": "installation operator preview และ restore snapshot โดย ordinary Business Owner ทำไม่ได้"
  },
  {
    "id": "FR-076",
    "primaryDomain": "identity",
    "useCase": "ผู้ดูแลมอบ Product Owner role เฉพาะ Business โดยไม่ขยายสิทธิ์ Platform หรือ secret"
  },
  {
    "id": "FR-081",
    "primaryDomain": "integration",
    "useCase": "LINE event ถูกเก็บเป็น raw evidence แบบ idempotent ก่อน translation โดยตัด reply token ออก"
  },
  {
    "id": "FR-090",
    "primaryDomain": "identity",
    "useCase": "Operator เปรียบเทียบ schema โดยไม่ให้เครื่องมือเสนอ DROP ตาราง credential ที่มีอยู่จริง"
  },
  {
    "id": "FR-092",
    "primaryDomain": "market-intelligence",
    "useCase": "ระบบแปล raw marketplace record เป็น MarketObservation พร้อม source lineage และ unresolved identity ที่ซื่อสัตย์"
  },
  {
    "id": "FR-102",
    "primaryDomain": "integration",
    "useCase": "data plane ภายนอกของ SoT Pipeline ยิงเข้า submit/export ด้วย service-account key ที่ผูก Tenant เดียว โดยไม่ต้องมี browser session และเพิกถอนได้ทันทีในคำขอถัดไป"
  },
  {
    "id": "FR-103",
    "primaryDomain": "crm",
    "useCase": "เจ้าของธุรกิจบันทึกในคอนโซล CRM ว่าลูกค้ารายนี้ให้หรือปฏิเสธ consent พร้อมเวลาและผู้บันทึก โดยแถวเดิมที่มีก่อนคอลัมน์นี้ไม่ถูกปิดกั้นย้อนหลัง"
  },
  {
    "id": "FR-104",
    "primaryDomain": "identity",
    "useCase": "เจ้าของธุรกิจออก reset token ใช้ครั้งเดียวอายุหนึ่งชั่วโมงให้สมาชิกที่ล็อกอินไม่ได้ และ session เดิมทั้งหมดถูกตัดเมื่อผู้ใช้ตั้งรหัสใหม่"
  },
  {
    "id": "FR-105",
    "primaryDomain": "platform-control",
    "useCase": "installation operator เปิด /control/roadmap เพื่ออ่านแผนงาน 24 สัปดาห์ที่ส่งไว้ โดยอยู่นอก BusinessShell และไม่มี Business scope ใดปะปน"
  },
  {
    "id": "FR-106",
    "primaryDomain": "integration",
    "useCase": "ระบบภายนอกเรียก Enterprise API ด้วย ApiAccessKey ที่ผูก Tenant เดียว และคำขอที่ไม่มีกุญแจถูกปฏิเสธทั้งหมด"
  },
  {
    "id": "FR-107",
    "primaryDomain": "identity",
    "useCase": "ผู้ดูแลมอบและเพิกถอนสิทธิ์ installation operator ให้ Person หนึ่งได้จริงในโปรดักชัน โดยทุกคำขออ่านสิทธิ์นั้นใหม่จาก grant store"
  },
  {
    "id": "FR-112",
    "primaryDomain": "knowledge",
    "useCase": "เอกสารหนึ่งถูกแบ่งตามโครงสร้างของตัวเอง document → section → chunk โดยทุก chunk ยังบอกได้ว่ามาจากหัวข้อใดและลำดับที่เท่าไร"
  },
  {
    "id": "FR-113",
    "primaryDomain": "knowledge",
    "useCase": "ระบบดึง entity candidate จาก chunk และ record พร้อมค่า confidence และ chunk ต้นทาง เพื่อให้ตรวจย้อนกลับได้ว่าชื่อนี้มาจากตรงไหน"
  },
  {
    "id": "FR-114",
    "primaryDomain": "knowledge",
    "useCase": "ค่าที่ normalize แล้วยังคืนค่าดิบคู่กันเสมอ ผู้ตรวจสอบจึงเทียบรูปแบบมาตรฐานกับสิ่งที่ผู้ส่งพิมพ์มาจริงได้"
  },
  {
    "id": "FR-115",
    "primaryDomain": "knowledge",
    "useCase": "เอกสารดิบถูก parse เป็น artifact ที่มีโครงสร้าง ตาราง และ warning พร้อมลิงก์กลับไปยังไฟล์ต้นทางที่เก็บไว้"
  },
  {
    "id": "FR-116",
    "primaryDomain": "knowledge",
    "useCase": "ผู้ตรวจสอบไล่สายจากคำตอบกลับไปถึงแหล่งที่มา รุ่นของ pipeline และ checksum ของ artifact ต้นทางได้ครบสาย"
  },
  {
    "id": "FR-117",
    "primaryDomain": "knowledge",
    "useCase": "artifact ที่นำเข้าซ้ำถูกจัดเป็นฉบับซ้ำหรือฉบับแก้ไขของเดิมภายใน Tenant เดียวกัน ไม่ใช่สร้างรายการใหม่ทุกครั้ง"
  },
  {
    "id": "FR-118",
    "primaryDomain": "knowledge",
    "useCase": "ผู้ดูแลสั่งประมวลผลเอกสารหนึ่งครั้งเดียวแล้วได้ครบทั้งเจ็ด stage ของ Tier 1 ตามลำดับที่กำหนด"
  },
  {
    "id": "FR-119",
    "primaryDomain": "knowledge",
    "useCase": "เอกสารที่ล้มกลาง pipeline เข้าคิว quarantine พร้อมบอกว่า stage ไหน error อะไร และควร retry หรือให้คนตรวจ"
  },
  {
    "id": "FR-120",
    "primaryDomain": "identity",
    "useCase": "ผู้เยี่ยมชมสมัครบัญชีเองที่ /signup แล้วเข้าสู่ขั้นตอน Profile ต่อได้ทันที โดยไม่ต้องรอคำเชิญจากใคร"
  },
  {
    "id": "FR-121",
    "primaryDomain": "identity",
    "useCase": "ผู้ใช้เลือกเข้าสู่ระบบด้วยบัญชี Google และถูก resolve เป็น Person เดิมคนเดียวกัน ไม่ใช่บัญชีใหม่คนละใบ"
  },
  {
    "id": "FR-122",
    "primaryDomain": "identity",
    "useCase": "ขั้นตอน Profile เก็บชื่อ นามสกุล และเบอร์โทรศัพท์ เพื่อให้ระบุตัวคนได้จริง ไม่ใช่แค่ชื่อที่ใช้เรียก"
  },
  {
    "id": "FR-123",
    "primaryDomain": "identity",
    "useCase": "นักพัฒนาผูก Codex/Claude Code harness เข้ากับ installation ผ่าน authorization code อายุสั้นครั้งเดียว โดยไม่ต้องกรอกรหัสผ่านหรือคัดลอก cookie"
  },
  {
    "id": "FR-124",
    "primaryDomain": "project-manager",
    "useCase": "ผู้บริหารเปิด Product Readiness เพื่อดูความคืบหน้าของทุกโดเมน แล้ว drill down ถึง feature, ตัวอย่าง use case, หลักฐาน code/test และสิ่งที่ยังติดอยู่"
  },
  {
    "id": "FR-125",
    "primaryDomain": "integration",
    "useCase": "Owner เชื่อม FlowAccount ของ Business ผ่าน wizard ที่รับ Client ID/Secret แบบเขียนอย่างเดียว แล้วดึงข้อมูลบัญชีแบบอ่านอย่างเดียวโดยไม่เปิดเผย secret กลับมาที่ browser"
  },
  {
    "id": "FR-129",
    "primaryDomain": "integration",
    "useCase": "ผู้มีอำนาจอนุมัติตรวจ catalog version ที่ยังไม่เผยแพร่พร้อมยอดที่เพิ่ม เปลี่ยน และไม่เปลี่ยน แล้วลงชื่ออนุมัติหรือปฏิเสธ โดยลายเซ็นและหลักฐานที่เห็นถูกบันทึกไว้กับ run เดียวกัน"
  },
  {
    "id": "FR-130",
    "primaryDomain": "integration",
    "useCase": "Owner ผูก repository GitHub เข้ากับ Business ที่ตนดูแล แล้วเปิดอ่านโครงสร้างไฟล์และเนื้อไฟล์ในคอนโซลแบบอ่านอย่างเดียว เฉพาะ path ที่ประกาศไว้ โดยระบบไม่เก็บสำเนาเนื้อไฟล์ไว้เลย"
  },
  {
    "id": "FR-131",
    "primaryDomain": "knowledge",
    "useCase": "ผู้ดูแลนำเข้าใบอัตราค่าขนส่งของซัพพลายเออร์เป็นเอกสาร แล้วอัตราตามระดับสมาชิกถูกเผยแพร่เป็น business knowledge ที่บอกได้ว่ามีผลเมื่อใด ใครอนุมัติ และมาจากไฟล์ต้นทางใด ไม่ใช่ตารางที่แก้ทับได้เงียบ ๆ"
  },
  {
    "id": "FR-132",
    "primaryDomain": "agent",
    "useCase": "ลูกค้าถามราคาในห้องแชท LINE เดิม แล้วได้ใบเสนอราคาแบบขั้นบันไดที่ปัดขึ้นเป็นสิบบาทกลับไปในคำตอบ โดยกำไรขั้นต่ำถูกบังคับก่อนตอบและไม่ถูกส่งออกไปกับราคา"
  },
  {
    "id": "FR-141",
    "primaryDomain": "agent",
    "useCase": "เจ้าของธุรกิจเปิดหน้า Platform Integrations แล้วเห็นว่า Edge Device ของธุรกิจตนออนไลน์อยู่หรือไม่จากสัญญาณ heartbeat ล่าสุด และถอดอุปกรณ์ออกได้เฉพาะของธุรกิจที่ตนเป็นเจ้าของ ผู้ที่ไม่มี session ถูกปฏิเสธทุกคำขอ และ token ของอุปกรณ์ไม่ถูกเก็บไว้บนคลาวด์"
  },
  {
    "id": "FR-142",
    "primaryDomain": "platform-control",
    "useCase": "ผู้ดูแลระบบรัน docker compose up -d บนเครื่องของตนเอง แล้ว Compose รู้เองว่า web พร้อมให้บริการจาก GET /api/health ก่อนจะเปิด ngrok ออกสู่อินเทอร์เน็ต และหน้า Platform Integrations แสดง webhook URL จาก origin ที่เปิดอยู่จริง (https://<NGROK_DOMAIN>/api/agent/line-webhook) โดยไม่ต้องพึ่ง Vercel"
  },
  {
    "id": "FR-145",
    "primaryDomain": "platform-control",
    "useCase": "ผู้ดูแลระบบรัน docker compose up -d แล้ว query ทุกตัวไปหา Supabase ผ่าน session pooling ที่เร็วเป็นค่า default โดยไม่ต้องตั้งค่าอะไรเพิ่ม เพราะระบบรู้เองว่าตัวเองรันเป็น container เดียวยาว ๆ ไม่ใช่ serverless function บน Vercel"
  },
  {
    "id": "FEAT-019",
    "primaryDomain": "line-oa-studio",
    "useCase": "ธุรกิจใช้ LINE และ CRM ได้โดยไม่ต้องมี Edge และเลือกใช้อุปกรณ์เฉพาะงาน local โดยไม่ย้ายสิทธิ์ส่งข้อความออกจาก server"
  },
  {
    "id": "FEAT-020",
    "primaryDomain": "inventory",
    "useCase": "ธุรกิจตั้งหมวดหมู่ สินค้าหลัก และ SKU ของตนเอง เลือกว่า SKU ไหนนับสต๊อก (ตามจำนวน / Lot / Serial) หรือไม่นับ (บริการ สั่งผลิต) รับเข้า จ่ายออก ปรับยอดลง ledger แล้วเห็นยอดคงเหลือและ SKU ที่ต่ำกว่า safety stock จากหน้า /inventory โดยตัวเลขคำนวณจาก ledger ทุกครั้ง"
  },
  {
    "id": "FEAT-021",
    "primaryDomain": "marketing",
    "useCase": "A Business drafts, independently reviews and approves an exact Marketing strategy revision, then previews and hands execution to Project Manager with an auditable receipt."
  },
  {
    "id": "FEAT-022",
    "primaryDomain": "crm",
    "useCase": "ทีมขายบันทึกงานติดตามลูกค้า (โทร ส่ง LINE นัดพบ เดโม ใบเสนอราคา) ผูกกับลูกค้าและบทสนทนาใน CRM มอบหมายให้สมาชิก เห็นว่างานไหนวันนี้หรือเกินกำหนดจากหน้า /customer/sales-tasks แล้วปิดงานพร้อมผลลัพธ์ โดยไม่ปนกับงานของ Development"
  },
  {
    "id": "FEAT-023",
    "primaryDomain": "commerce",
    "useCase": "ทีมขายสร้างออเดอร์จากหน้า /commerce/orders (รายการที่ผูก SKU ในคลัง ราคาตอนขาย ผูกบทสนทนาแล้วรู้ว่ามาจากแชท) บันทึกสลิปที่ลูกค้าโอน ให้ผู้ตรวจยืนยัน แล้วเห็นยอดชำระ ยอดคงค้าง และรายได้ที่ตรวจสอบแล้วแยกตามที่มาบนหน้า /commerce โดยตัวเลขทั้งหมดคำนวณจากรายการและการชำระที่ตรวจสอบแล้วทุกครั้ง ปิดออเดอร์แล้วตัดสต๊อกผ่านคลังสินค้าได้"
  },
  {
    "id": "FEAT-024",
    "primaryDomain": "procurement",
    "useCase": "ฝ่ายจัดซื้อสร้างผู้ขายจากหน้า /procurement ออกใบสั่งซื้อจากหน้า /procurement/purchase-orders (รายการที่ผูก SKU ในคลัง ต้นทุนที่ตกลง) ส่งให้ผู้ขาย แล้วบันทึกรับของทีละรายการเมื่อของมาถึง (Lot วันหมดอายุ Serial) โดยของที่นับสต๊อกเข้า ledger ของคลังทันทีและใบสั่งซื้อรับครบเองเมื่อทุกรายการมาครบ ยอดค้างรับและมูลค่าคำนวณจากใบรับของทุกครั้ง"
  },
  {
    "id": "FEAT-025",
    "primaryDomain": "inventory",
    "useCase": "ฝ่ายคลังเห็นว่าของอยู่จุดไหนของซัพพลายเชน (โรงงานจีน เรือ ท่าเรือ คลังวัตถุดิบ ห้องยิงเลเซอร์ ไลน์ประกอบ คลังสินค้าสำเร็จรูป ของเสีย) ย้ายของข้ามจุดแบบตัดต้นทาง-เพิ่มปลายทางในธุรกรรมเดียว เปิดใบสั่งสกรีน/ยิงเลเซอร์ที่ล็อกของให้ลูกค้ารายนั้นถาวร เปิดใบสั่งประกอบที่ระเบิด BOM พร้อมเผื่อของเสียตามที่สูตรประกาศไว้ และได้ต้นทุนต่อชุดเป็นสตางค์ที่รวมค่ารถส่งเหมาคันไว้แล้ว ส่วนฝ่ายขายถามผ่านผู้ช่วย AI ได้ว่ารับออเดอร์กี่ชุดได้ทันที ราคาต่อชุดเท่าไร แล้วจองสต๊อกให้ลูกค้า 7 วันโดยไม่ชนกับใบเสนอราคาอื่น"
  },
  {
    "id": "FR-167",
    "primaryDomain": "inventory",
    "useCase": "ผู้ใช้กดช่อง SCM ช่องเดียวในแถบโดเมน แล้วเห็น Inventory, Warehouse, Procurement และ Order Management เรียงเป็นสี่กลุ่มในเมนูด้านซ้าย จึงข้ามจากคลังไปจัดซื้อไปคำสั่งขายได้โดยไม่ต้องกลับขึ้นแถบบน ส่วน Warehouse ที่ยังไม่ได้สร้างจะแสดงเป็นช่องที่กดไม่ได้ แทนที่จะหายไปเฉย ๆ"
  },
  {
    "id": "FR-168",
    "primaryDomain": "inventory",
    "useCase": "เจ้าของธุรกิจสร้าง SKU แล้วเลือกได้ว่าเป็นสินค้านับสต๊อก สินค้าไม่นับสต๊อก หรือบริการ พอเลือกบริการหรือไม่นับสต๊อก ฟอร์มจะตัดช่องการระบุหน่วยและ safety stock ออกทันทีเพราะใช้ไม่ได้ และระบบจะปฏิเสธการรับของเข้าคลังสำหรับบริการ เพราะบริการเป็นสิ่งที่ทำให้ ไม่ใช่ของที่ส่งมอบเข้าคลัง"
  },
  {
    "id": "FR-169",
    "primaryDomain": "inventory",
    "useCase": "เจ้าของธุรกิจที่ขายเฉพาะบริการเข้าไปที่ตั้งค่า แล้วปิดสวิตช์ Physical Stock ทันทีที่ปิด โมดูล Warehouse หายไปจากแถบเมนูบนและเมนูซ้ายของ SCM ทั้งหมด ไม่ใช่แค่กดไม่ได้ ธุรกิจอื่นที่มีสต๊อกจริงยังเห็น Warehouse เหมือนเดิมเพราะค่าเริ่มต้นเปิดไว้"
  },
  {
    "id": "FR-170",
    "primaryDomain": "procurement",
    "useCase": "ผู้ใช้เปิดหน้าจัดซื้อแล้วเห็นแท็บ Dashboard กับ Purchase Orders อยู่ในกรอบเดียวกันด้านบน กดสลับแท็บเพื่อดูใบสั่งซื้อโดยไม่ต้องกลับไปที่เมนูซ้าย เช่นเดียวกับหน้า Order Management ที่มีแท็บ Dashboard กับ Orders สลับกันได้ในกรอบเดียว"
  },
  {
    "id": "FR-172",
    "primaryDomain": "crm",
    "useCase": "ผู้ใช้กดช่อง CRM ช่องเดียวในแถบโดเมน แล้วเห็น Customer กับ Market Intelligence เรียงกันในเมนูด้านซ้าย จึงข้ามจากลูกค้าไปข้อมูลตลาดได้โดยไม่ต้องกลับขึ้นแถบบน เหมือนกับที่ SCM ทำไว้กับคลัง จัดซื้อ และคำสั่งขาย"
  },
  {
    "id": "FR-186",
    "primaryDomain": "commerce",
    "useCase": "Business owner configures authoritative issuer, tax and PromptPay settings, then an authorized user previews or durably issues an immutable invoice, receipt or Thai tax document with an exact money snapshot and no fabricated identity"
  },
  {
    "id": "FR-183",
    "primaryDomain": "commerce",
    "useCase": "An authorized cashier submits a manually priced walk-in sale for a selected Branch and WarehouseLocation, and one transaction records the order, pending payment, exact change and Inventory ledger issue without claiming verification"
  },
  {
    "id": "FEAT-026",
    "primaryDomain": "knowledge",
    "useCase": "Approved 2026-09-11 (ADR-075); Phase 1 (FR-187) implemented in PR #324; Phase 2 gate open with contract revision 2: SmartGift's catalog data would enter the governed 17-stage pipeline through one adapter instead of three separate writers, so an agent's product answer can finally name the published generation and citation it came from"
  },
  {
    "id": "FR-190",
    "primaryDomain": "line-oa-studio",
    "useCase": "Tell a silent LINE channel from a misrouted one: how long a serverEnabled account has gone without an inbound delivery, and whether the webhook endpoint LINE has configured is still this deployment own account route."
  },
  {
    "id": "FEAT-027",
    "primaryDomain": "identity",
    "useCase": "An owner removes someone's access from the product instead of asking for SQL: suspend, reinstate, revoke or offboard a person with a stated reason, the dependent role bindings following and the evidence that the grant existed surviving the withdrawal"
  },
  {
    "id": "FEAT-028",
    "primaryDomain": "project-manager",
    "useCase": "The HR People Directory finally answers 'who works here' honestly — a suspended staff member stays listed as staff whose access is suspended, a shareholder with no employment relationship stops appearing as one, and a warehouse Branch with no VAT branch code registered against its legal entity can still sell, just never issue a tax invoice"
  },
  {
    "id": "FEAT-029",
    "primaryDomain": "identity",
    "useCase": "An owner invites someone into a Tenant or Business who has no account yet, with an expiring token instead of typing an exact email; a buyer cannot also receive their own purchase order and a rep cannot verify their own payment, even the owner, unless they say so on the record; and a lost operator credential no longer means editing production by hand"
  },
  {
    "id": "FEAT-030",
    "primaryDomain": "identity",
    "useCase": "An owner reads who has access to their own Business right now, who granted it and why, and what changed and when — the access review a reason on every access-grant transition was only ever worth writing for"
  },
  {
    "id": "FEAT-031",
    "primaryDomain": "inventory",
    "useCase": "เจ้าของธุรกิจเปิดแท็บ SKU Hygiene แล้วเห็นทันทีว่า SKU ตัวไหนซ้ำกัน บริการตัวไหนถูกสร้างไว้ใต้สินค้า สินค้าหลักตัวไหนยังไม่ประกาศแกน variant และ SKU ตัวไหนนิ่งมานาน กดรวม SKU ที่ซ้ำเข้าด้วยกันโดยยอดคงเหลือและบาร์โค้ดย้ายตามไปและไม่มีอะไรถูกลบ ส่วนฝ่ายรับของสแกนบาร์โค้ดแล้วระบบบอกได้ว่าเป็น SKU ไหนก่อนจะเผลอสร้างซ้ำ"
  },
  {
    "id": "FEAT-032",
    "primaryDomain": "inventory",
    "useCase": "เจ้าของธุรกิจดาวน์โหลดแม่แบบ Excel ของ Business ตัวเอง กรอกสินค้า 200 แถวแล้วอัปโหลด ระบบบอกทีละแถวว่าแถวไหนเป็น SKU ใหม่ แถวไหนตรงกับ SKU เดิมจากบาร์โค้ด (และจะเพิ่มแค่บาร์โค้ด/หน่วยแปลงที่ยังไม่มี) แถวไหนซ้ำหรือผิด แล้วกดยืนยันครั้งเดียวบันทึกทั้งไฟล์ หรือพิมพ์ #sku ใน LINE จากบัญชีที่ยืนยันตัวตนแล้วเพื่อทำแบบเดียวกันจากมือถือ"
  },
  {
    "id": "FR-211",
    "primaryDomain": "platform-control",
    "useCase": "installation operator เปิดแท็บ Domain map & inventory ใน /control/roadmap แล้วเห็นทุกโดเมนเป็นแผนผังพร้อมสถานะ เลือกโดเมนหนึ่งเพื่อดู feature, FR และ NFR ของโดเมนนั้นว่าตัวไหนพร้อมใช้ ตัวไหนยังติดอะไร โดยไม่ต้องเปิด PRD หรือรันคำสั่งเอง"
  },
  {
    "id": "FEAT-033",
    "primaryDomain": "knowledge",
    "useCase": "เจ้าของธุรกิจเปิดแท็บ Knowledge (GKS) แล้วเห็นแผนที่ว่าข้อมูลของธุรกิจเข้ามาจากไหน ถูกรวมที่ไหน และถูกส่งต่อให้ใคร เลือก chain เช่น LINE turn เพื่อไล่ดูทีละ hop ว่าแต่ละขั้นเป็นของโดเมนไหน FEAT ไหน มีหน้าจอหรือ endpoint แล้วหรือยัง และขึ้น production แล้วหรือยังพร้อมหลักฐาน"
  },
  {
    "id": "FEAT-034",
    "primaryDomain": "platform-control",
    "useCase": "installation operator เปิด /control/roadmap แล้วเห็นว่าแต่ละ phase มีกี่ sprint กี่ task ขนาดเท่าไร ใช้เวลาประมาณเท่าไร และงานที่ done แล้วใช้เวลาจริงกับ token จริงไปเท่าไรจาก log ของ agent ที่วัดได้ ไม่ใช่ค่าประมาณ พร้อม badge บนการ์ด task ว่าเอกสาร โค้ด เทสต์ FR NFR FEAT ของงานนั้นเสร็จ รอรีวิว ต้องแก้ หรือยังว่าง และ progress bar ของ subtask"
  },
  {
    "id": "FEAT-035",
    "primaryDomain": "identity",
    "useCase": "Retired by ADR-110 D5. Historical behavior: a Zuri plugin paired Claude Code or Codex installations through browser approval and attributed session usage to a person, device and lane; existing report rows remain historical."
  },
  {
    "id": "FEAT-036",
    "primaryDomain": "integration",
    "useCase": "เจ้าของธุรกิจเปิดหน้าเชื่อมต่อ LINE OA ยืนยันตัวตนด้วยรหัส TOTP แล้วกรอก Channel ID กับ Channel secret จาก LINE Developers Console ครั้งเดียว ระบบตรวจกับ LINE ดึงชื่อบอทมาให้ ตั้งและทดสอบ Webhook ให้เอง แล้วกดเปิดใช้งานได้ทันทีโดยไม่ต้องให้ผู้ดูแลระบบใส่ไฟล์บนเครื่องเซิร์ฟเวอร์ และหลังบันทึกไม่มีหน้าไหนแสดง secret ซ้ำอีก"
  },
  {
    "id": "FEAT-037",
    "primaryDomain": "crm",
    "useCase": "พนักงานเปิด Inbox แล้วเห็นบทสนทนา LINE ครบทั้งข้อความ สติกเกอร์ รูปที่ลูกค้าส่ง และเหตุการณ์อย่างการเพิ่มเพื่อนหรือบล็อก ค้นหาข้อความเก่าได้ ส่วนเจ้าของธุรกิจกำหนดได้ว่าบัญชีไหนให้ agent จำบริบทได้ รู้ว่าข้อมูลแต่ละชั้นเก็บนานเท่าไร และเมื่อลูกค้าขอลบข้อมูลก็เห็นว่าลบครบทุกชั้นแล้วหรือยังรออยู่ที่ไหน"
  },
  {
    "id": "FEAT-038",
    "primaryDomain": "knowledge",
    "useCase": "เจ้าของธุรกิจสลับบัญชี LINE OA ให้ตอบลูกค้าจากคลังความรู้ที่ publish แล้วใน GKS ดู trace ได้ว่าคำตอบอ้างเอกสารไหน อนุมัติคำถาม-คำตอบที่ได้จากแชทลูกค้าเข้าเป็นความรู้ของธุรกิจโดยไม่มีข้อมูลส่วนตัวของลูกค้าติดไป และเห็นรายงานว่าลูกค้าถามเรื่องสินค้าตัวไหนที่ระบบยังตอบไม่ได้"
  },
  {
    "id": "FEAT-039",
    "primaryDomain": "platform-control",
    "useCase": "installation operator เปิดการ์ด phase บน /control/roadmap แล้วเห็น token แยกเป็น input, output, thinking และ cache, tool ที่เรียกและ error, จำนวน prompt และ compaction จาก operator-local logs และ deployment-bearer reports โดยไม่เก็บข้อความของงาน; person/device attribution ของ report เก่ายังอ่านได้ แต่ไม่มี Zuri harness plugin สำหรับส่งข้อมูลใหม่"
  },
  {
    "id": "FEAT-040",
    "primaryDomain": "crm",
    "useCase": "เจ้าของธุรกิจเปิด inbox แล้วเห็นบทสนทนา LINE ของลูกค้าแบ่งเป็น session ตามช่วงที่คุยกัน โดย session ปิดเองเมื่อเงียบเกิน 30 นาที ตั้งค่าได้ 10–120 นาทีต่อบัญชี ย้อนดู job และ trace ของแต่ละ session ได้ ส่วน model บนเครื่อง edge โหลดไว้เฉพาะเวลาทำการของบัญชี และนอกเวลาทำการลูกค้าได้รับข้อความตอบกลับที่ตั้งไว้"
  },
  {
    "id": "FEAT-041",
    "primaryDomain": "crm",
    "useCase": "เมื่อลูกค้าอ้างว่าเคยได้รับส่วนลดเมื่อสองปีก่อน เจ้าของธุรกิจยืนยันตัวตนสองชั้นแล้วดึงข้อความของลูกค้าคนนั้นตามช่วงวันที่จาก archive ที่เข้ารหัสบนดิสก์ในเครื่อง พร้อม hash ที่พิสูจน์ว่าไม่ถูกแก้ ข้อความที่พนักงานตอบจาก inbox อยู่ในหลักฐานด้วย และข้อมูลที่อยู่ภายใต้ legal hold ไม่ถูกลบจนกว่าข้อพิพาทจะจบ"
  },
  {
    "id": "FR-241",
    "primaryDomain": "platform-control",
    "useCase": "ใครก็ตามที่ login zuri-ai แล้ว เปิด /roadmap ได้ในช่วง 30 วันจนถึง 15 ต.ค. 2026 เพื่ออ่านแผนงาน 24 สัปดาห์กับ Domain map แบบอ่านอย่างเดียว โดยไม่เห็นยอดการใช้งานแยกตามคนหรือเครื่อง ชื่อ tool/model หรือรายการเครื่องที่จับคู่ ส่วน /control/roadmap ยังเปิดได้เฉพาะ operator"
  },
  {
    "id": "FR-242",
    "primaryDomain": "integration",
    "useCase": "ทีมพัฒนาต่อยอด vault เดิมที่เก็บ LINE channel secret ให้เก็บ OAuth client (เช่น FlowAccount ในอนาคต) และ model provider API key ได้ด้วย ผ่านขั้นตอนเขียน-ยืนยัน-หมุน-เพิกถอน-อ่านแบบเดียวกัน โดยเขียนทับ credential ผิดประเภทลง connection เดิมไม่ได้ (ระบบปฏิเสธก่อนข้อมูลลับจะถูกเก็บ) และอ่านข้าม kind กันไม่ให้เอา OAuth key ไปอ่านเป็น LINE channel secret"
  },
  {
    "id": "FR-250",
    "primaryDomain": "project-manager",
    "useCase": "ผู้ใช้เปิด Projects & Work แล้วเลือกหมวด Project Management, Work Management หรือ Resource Coordination จาก sidebar และเลือกแท็บภายในหมวดนั้น โดยยังอยู่ในโปรเจกต์เดิม เปิด Inventory, Team และ Work views เดิมได้ครบ ใช้ Import plan จากปุ่มเดียว และเห็น Requirements, Risks, Resources กับ Agent Delivery ว่าส่วนใดยัง Planned โดยเมนูไม่เพิ่มสิทธิ์"
  },
  {
    "id": "FR-252",
    "primaryDomain": "project-manager",
    "useCase": "ผู้ใช้เปิด Features ภายใน Project เพื่อดูผลลัพธ์ที่ต้องส่งมอบ แยกเจ้าของ Domain กับผู้สนับสนุน เชื่อมงานและหลักฐาน requirement โดยเจ้าของ Business จัดการข้อมูลได้ตามสิทธิ์ มีการตรวจเวอร์ชันและบันทึก audit งานที่ใช้ร่วมกันไม่นับซ้ำและไม่เปลี่ยนสูตร progress เดิม"
  },
  {
    "id": "FR-251",
    "primaryDomain": "project-manager",
    "useCase": "ผู้ใช้ที่มีสิทธิ์อ่าน Project เปิด Delivery Design แล้วดู Execution Domains ตาม Workstream จริง แยกเจ้าของหลัก ส่วนสนับสนุน และ technical owner นับงานไม่ซ้ำ เห็นงานที่ยังไม่ผูก domain และ ID ที่ยังไม่รู้จัก พร้อมระบุข้อมูล feature และหลักฐานที่ยังไม่มีอย่างชัดเจน"
  },
  {
    "id": "FEAT-042",
    "primaryDomain": "platform-control",
    "useCase": "operator เปิดหน้า error ใหม่บน /control/errors แล้วเห็น error ที่เกิดจริงจัดกลุ่มตาม fingerprint พร้อมจำนวนครั้งและเวลาที่เกิดล่าสุด กดปิดเมื่อแก้แล้ว และเปิดอีกหน้าเพื่อดูว่าหน้าไหน/ฟีเจอร์ไหนถูกใช้บ่อยแค่ไหน แยกตามคน"
  },
  {
    "id": "FEAT-043",
    "primaryDomain": "agent",
    "useCase": "Business owner or Operator configures self-hosted vLLM inference pool (12GB/16GB GPU nodes) without mandatory Edge device for Zuri Server LINE OA responses, including node registration, credential qualification, capacity routing, and safe cutover"
  },
  {
    "id": "FEAT-044",
    "primaryDomain": "platform-control",
    "useCase": "installation operator opens Mission Control and sees the canonical roadmap DAG by wave together with only provenance-bound worker, thread, branch, worktree, commit, check and evidence observations; same-wave work is marked candidate-parallel until merge-safety gates pass, while stale or absent records remain visibly unknown and members never receive operator orchestration detail"
  },
  {
    "id": "FEAT-045",
    "primaryDomain": "line-oa-studio",
    "useCase": "Business OWNER ใส่ API key ของโมเดลเองจากหน้าเว็บ แบบเขียนอย่างเดียว ตรวจกับผู้ให้บริการก่อนบันทึก แล้ว LINE OA ตอบลูกค้าโดยเรียกโมเดลด้วยคีย์นั้นบนเซิร์ฟเวอร์ของ Zuri โดยไม่ต้องมี Edge device อีกต่อไป"
  },
  {
    "id": "FEAT-046",
    "primaryDomain": "integration",
    "useCase": "Business owner connects a Notion public connection through server-side OAuth token custody, while signed Notion webhooks record only minimal idempotent receipts and never copy workspace content into business domains"
  },
  {
    "id": "FR-253",
    "primaryDomain": "commerce",
    "useCase": "Business OWNER ใส่สูตรและตัวแปรราคา ทดลองเทียบรุ่นเดิม อนุมัติรุ่นใหม่และตรวจที่มาของผลคำนวณ ก่อนส่งราคาขายที่อนุมัติแล้วเข้า Knowledge"
  },
  {
    "id": "FR-272",
    "primaryDomain": "project-manager",
    "useCase": "ผู้จัดการโครงการตรวจและอนุมัติผลกระทบของ Agent/Fleet ต่อ Project จาก digest เดียวกัน โดยระบบตรวจ scope, สิทธิ์ reviewer, expiry, input hash และ lease ซ้ำก่อนเปิดทางให้ executor"
  },
  {
    "id": "FR-275",
    "primaryDomain": "marketing",
    "useCase": "ทีมการตลาดเปิดหน้า /growth/insights ดูสรุปตัวชี้วัด กราฟรายวัน ผลงานคอนเทนต์ และ export CSV ของแบรนด์ จาก snapshot เดียวกัน โดยทุกค่ามีสถานะคุณภาพ ค่าที่ไม่รู้ไม่แสดงเป็น 0 และการอ่านไม่เรียก provider"
  },
  {
    "id": "FR-276",
    "primaryDomain": "marketing",
    "useCase": "ทีมการตลาดสั่ง refresh ข้อมูล Insights และติดตามสถานะรอบ sync ได้ คำขอซ้ำในช่วงเดียวกันถูกรวมเป็นรอบเดียว และรอบที่ล้มหรือได้ข้อมูลไม่ครบไม่แทนที่ snapshot ที่สมบูรณ์ล่าสุด"
  },
  {
    "id": "FR-277",
    "primaryDomain": "agent",
    "useCase": "ผู้ดูแล LINE OA เปิด shadow-compare ให้บัญชีหนึ่งบัญชี ระบบตอบลูกค้าตามโหมดเดิมเหมือนทุกครั้ง แล้วสร้างคำตอบเปรียบเทียบจากโหมดคู่ตรงข้ามในพื้นหลังแบบไม่บล็อกและไม่ส่งให้ลูกค้าเห็น เพื่อดูหลักฐานว่าอีกโหมดจะตอบต่างกันแค่ไหนก่อนสั่งสวิตช์จริงในช่วงแคมเปญ"
  }
  ,
  {
    "id": "FR-278",
    "primaryDomain": "identity",
    "useCase": "Zuri-Go ใช้ credential สำหรับส่งรายงานเท่านั้น โดยตรวจ binding และสิทธิ์ growth ปัจจุบันซ้ำทุกครั้งก่อนรับข้อมูลหรือคืน receipt"
  },
  {
    "id": "FR-279",
    "primaryDomain": "marketing",
    "useCase": "รับรายงาน revision 1 เป็น reported evidence พร้อม receipt และ audit ใน transaction เดียว คำขอซ้ำได้ receipt เดิม และไม่เปลี่ยนแผนหรือยอดที่ยืนยันแล้ว"
  },
  {
    "id": "FR-280",
    "primaryDomain": "marketing",
    "useCase": "ทีมการตลาดอ่าน reported evidence ตามสิทธิ์เดิมของ Business เก็บหลักฐานกับ receipt ขั้นต่ำ 90 วัน โดยคง UNKNOWN และไม่มีการลบอัตโนมัติ"
  }
]
```
<!-- readiness-metadata:end -->

Version diff 1.41.0b → 1.42.0b (2026-09-13): FEAT-029 gains owner-approved FR-200, separate Superadmin lifecycle and scope resolution (ADR-082).

## FEAT-019 phase documentation — 2026-09-06

[FR-148 / FR-149 / FR-150 domain phase map](roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md) adds navigation and handoff detail while preserving registry subjects and delivery status. Phase IDs are document children, not new global FRs. Server source/CI, Edge branch/release and production activation remain separate evidence gates.

Version diff 1.21.0b → 1.22.0b: Added explicit FEAT-019 phase links and current server/Edge evidence boundaries; no runtime or ownership manifest changes.

Version diff 1.25.0b → 1.26.0b: FEAT-021 includes FR-157 Content and Creative from approved CR-018.

Version diff 1.36.0b → 1.37.0b: reconcile PR #321 approved FEAT-026 with the retained FR-184/FR-185 extensions; preserve both parallel revision histories and all published subjects.

Version diff 1.38.0b → 1.39.0b (2026-09-12): Added **FEAT-029** (FR-195, FR-196, FR-197) under **ADR-079** — AccessInvite generalises WorkspaceInvite to Tenant/Business scope; segregation of duties gets a role-conflict writer and a self-verification transaction refusal; operator access becomes time-boxed, issuable and its use recorded. Implemented locally; migration not yet applied to production.

Version diff 1.40.0b → 1.41.0b (2026-09-12): **FEAT-029 moves from `implemented locally` to `implemented`** — its migration `20260912140000_access_invite_sod_operator.sql` is applied on production (PRD-SDD 1.192.0b records the whole five-migration apply). No feature text changed; the status column was simply describing a state that had ended.

Version diff 1.42.0b → 1.43.0b (2026-09-13): Added **FEAT-031** (FR-201..FR-207) under **ADR-083** — SKU governance: nature at the master, variant identity as the anti-bloat key, identifiers with a resolve step, unit conversions, the SKU lifecycle with merge, the hygiene report and replenishment parameters. Implemented locally; migration written in both trees and not applied to production.

Version diff 1.43.0b → 1.44.0b (2026-09-13): **FEAT-031 moves from `building` to `implemented`** — its migration `20260913120000_inventory_sku_governance` is applied on production and main 52c9881e (PR #372) is deployed. No feature text changed.

Version diff 1.44.0b → 1.45.0b (2026-09-13): Added **FEAT-032** (FR-208, FR-209, FR-210) under **ADR-084** — catalogue intake that resolves before it creates: one envelope and planner, the Excel converter and Import tab, and the LINE `#sku` command. Implemented locally; migration written in both trees and not applied to production.

Version diff 1.45.0b → 1.46.0b (2026-09-13): readiness metadata gains **FR-211** (primary domain `platform-control`) — the Domain map & inventory tab on `/control/roadmap`. A Standalone FR; no FEAT row is added.

Version diff 1.46.0b → 1.47.0b (2026-09-13): **FEAT-032 moves from `building` to `implemented`** — migration `20260913200000_inventory_catalog_intake` is applied on production and main ada5188b (PR #375) is deployed. No feature text changed.

Version diff 1.47.0b → 1.48.0b (2026-09-13): Added **FEAT-033** (FR-212..FR-215) under **ADR-085** — the Data Pipeline Map in a Knowledge (GKS) navigation slot. FR-212..FR-214 implemented locally; FR-215 declared only.

Version diff 1.48.0b → 1.49.0b (2026-09-13): Added **FEAT-034** (FR-216..FR-219) under **ADR-086** — programme delivery telemetry and task card evidence badges on `/control/roadmap`. Declared; building.

Version diff 1.49.0b → 1.50.0b (2026-09-14): Added **FEAT-035** (FR-220..FR-222) under **ADR-087** — the Zuri harness usage plugin with browser-paired devices and a report-only credential. Declared; building.

Version diff 1.50.0b → 1.51.0b (2026-09-14): Added **FEAT-036** (FR-223..FR-228) under **ADR-089** — connect LINE OA yourself; **FEAT-037** (FR-229..FR-234) under **ADR-091** — chat record, memory tiers and retention; and **FEAT-038** (FR-235..FR-238) under **ADR-090** — LINE grounding and knowledge candidates. Owner-approved design, declared only: no code, model, route or migration.

Version diff 1.51.0b → 1.52.0b (2026-09-14): Added **FEAT-039** (FR-239, FR-240) under **ADR-086 D7** — agent usage detail from agent logs: token types, tool calls, prompts and compactions per lane, person and device. Declared; building.

Version diff 1.52.0b → 1.53.0b (2026-09-14): **FEAT-034**, **FEAT-035** and **FEAT-039** move from building to live — every FR they bundle is merged and deployed (#383, #386, #393; running image `zuri-ai-web:release-daca80fb`) with its migrations applied on production. No feature text changed.

Version diff 1.53.0b → 1.54.0b (2026-09-14): readiness metadata for **FR-241** (a Standalone FR, ADR-092) — the 30-day roadmap member view for signed-in people.

Version diff 1.54.0b → 1.55.0b (2026-09-16): **FEAT-040** (FR-243, FR-244; ADR-094) and **FEAT-041** (FR-245, FR-246; ADR-093) declared with readiness metadata, on the owner's acceptance of both ADRs.

Version diff 1.55.0b → 1.56.0b (2026-09-16): Added **FEAT-042** (FR-247..FR-249, NFR-023) under **ADR-095** — error tracking and per-person feature usage, both extending the existing logger; FR-247 implemented locally, FR-248/FR-249 declared only. Also reconciles the '**Version**' document-control cell, which had drifted behind this table (read 1.47.0b, table already at 1.55.0b).

Version diff 1.56.0b → 1.57.0b (2026-09-16): FEAT-033's FR-215 live overlay is implemented locally with four bounded owning-domain reads and truthful unavailable/null states. The Knowledge Documents surface is narrowed to Text/Markdown admission; no production activation is claimed.

Version diff 1.58.0b → 1.59.0b (2026-09-17): adds FR-253 Commerce pricing rules/engine readiness entry; local implementation only, no production activation.
