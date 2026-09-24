---
id: ZAI:SESSION-4-MARKET-INTELLIGENCE-PROMPT
version: "0.1.0b"
status: candidate
last_update: "2026-09-24T08:30:00+07:00,Claude"
attributes:
  domain: market-intelligence
  scope: market-intelligence-extraction-prompt
relations:
  - type: relates_to
    target: ZAI:ADR-038
---

# Codex — Session 4: Market Intelligence Service Extraction

วันที่จัดทำ: 24 กันยายน 2026  
Repository: `Freshair129/zuri.ai`  
สถานะเอกสาร: Implementation prompt ที่ผู้ใช้ร้องขอ ไม่ใช่หลักฐานว่าเริ่มงานแล้วหรือผ่าน acceptance  
ขอบเขต: Market Intelligence เฉพาะ capabilities ที่มี implementation จริง ไม่ขยายเป็นระบบวิจัยตลาดใหม่ทั้งชุด

## 0. ภารกิจและการเริ่มงาน

คุณเป็น implementation owner ของ Session 4 ให้แยก Market Intelligence เป็น independently buildable/runnable service ใน monorepo เดิม โดยเริ่มจาก **MarketObservation → translation → persistence → scoped feed** และ consumers ที่มีอยู่จริง

ค่าเริ่มต้นของตำแหน่งใหม่คือ `services/market-intelligence/`; ถ้า repository มี layout ที่ approved แล้ว ให้ reuse และบันทึก mapping ห้ามสร้าง service ซ้ำเพราะไม่ได้ตรวจของเดิม

อ่าน `AGENTS.md`, `CLAUDE.md`, instructions ตาม directory, domain charter/ADR/FR/SDD/SEC และ templates จริงก่อนแก้ อ่าน `REFACTOR-STATUS.md` และ `REFACTOR-STATUS-UPDATE-PROTOCOL.md` ที่แนบด้วย หากยังไม่ได้ใส่ใน repo ให้ใช้เนื้อหาที่ได้รับใน session และเสนอ patch ตาม canonical location ไม่แต่งว่าไฟล์มีอยู่แล้ว

เริ่มด้วยตรวจ actual worktree/branch/base/head และ existing PR/handoff งานนี้ ถ้ามี implementation อยู่แล้วให้ทำต่อจาก checkpoint ไม่เริ่มใหม่และไม่ reset งานเดิม Snapshot สำหรับเตรียม prompt คือ `fad8ec6252941ca3de01afdb3116484f86b366c3` ไม่ใช่คำสั่งให้ checkout ย้อนกลับ

หนึ่ง session ทำหลาย checkpoint/PR ได้ เป้าหมายคือ implementation ที่ตรวจสอบได้ ไม่หยุดแค่ ADR, interface, skeleton หรือ container ที่ยังเรียกให้ Next.js ประมวลผลแทน

## 1. ข้อตกลงการทำขนาน

- Session 1 ถือ Conversation Runtime/LINE execution และเป็น common-file integrator ตามแผนเดิม เว้นแต่มี explicit handoff เปลี่ยน owner
- Session 2 ถือ Work Management แต่ implementation ยังรอ Conversation Runtime extraction ที่ครบเกณฑ์ ผ่าน review/required checks และ merge แล้ว; งาน read-only preparation ทำได้ก่อน
- Session 3 ถือ File Management, MinIO/S3 adapters, file versions/attachments และ SOT Document Control
- Session 4 ถือ Market Intelligence core/service/routes-adapters/tests และ Market contract proposal
- Session 4 **ไม่ต้องรอ Session 1/3 เสร็จทั้งโครงการ** เพื่อทำ discovery, pure-core extraction และ isolated tests ใน owned paths แต่ shared integration ต้องผ่าน boundary/contract gate
- ห้ามเอางาน Market ไปปน Conversation Runtime PR #542 หรือ Files hotfix PR; integrator หมายถึงผู้ประสาน shared changes ไม่ใช่รวมทุก service ลง branch/PR เดียว
- Session 4 ไม่เริ่ม CRM/Identity/Integration/MSP/GKS/Files/Work Management extraction แทนเจ้าของงาน
- อ่านสถานะจาก commit/handoff จริง ไม่มี cross-session auto-sync; รับ handoff แล้วต้องตรวจใหม่

## 2. ค้นหา source และพิสูจน์ขอบเขต

Enumerate ด้วย tracked-file listing/tree ก่อนอ้างว่ามีหรือไม่มี ตรวจ incoming callers, routes, models, FK/cascade, transaction, authorization, backup/export/erasure, imports และ import-time side effects ไม่ดูเฉพาะชื่อโฟลเดอร์

Inspection pointers ที่พบใน snapshot อ้างอิง:

```text
docs/domains/market-intelligence/CHARTER.md
docs/domains/market-intelligence/SRS.md
docs/domains/market-intelligence/CONTEXT-MAP.md
docs/decisions/ADR-038-MARKET-INTELLIGENCE-DOMAIN-BOUNDARY.md
apps/server/src/modules/market-intelligence/application/market-observation-service.js
apps/server/src/modules/market-intelligence/application/translate-raw-record.js
apps/server/src/modules/market-intelligence/application/generic-candidate-extractor.js
apps/server/src/modules/market-intelligence/infrastructure/market-observation-repository.js
apps/server/src/modules/market-intelligence/infrastructure/market-raw-record-repository.js
apps/server/src/modules/market-intelligence/infrastructure/gks-market-identity-resolver.js
apps/server/src/modules/market-intelligence/domain/**
apps/server/src/modules/market-intelligence/components/**
apps/server/src/app/api/market/**
apps/server/src/app/(pm)/market/**
apps/server/tests/unit/market-intelligence/**
apps/server/tests/integration/market-intelligence-*.test.js
```

Patterns ข้างต้นเป็น pointers ไม่ใช่ผล enumeration ครบทุก path ให้ตรวจ root manifests, Prisma/Postgres schema/migrations, workflow, doc scanners และ actual API callers เพิ่มเอง

ข้อเท็จจริงตั้งต้นที่ต้องตรวจเทียบ HEAD:

1. `MarketObservation` เป็น persisted model ที่ charter ประกาศ ownership; ชื่อ ExternalOffer/Watchlist/MarketAlert/MarketResearchRun ฯลฯ ใน target concepts ไม่พิสูจน์ว่า implement แล้ว
2. Observation service inject repositories/extractor/knowledge resolver ได้ แต่ยัง import Identity predicates/domain visibility และ Project Manager audit; บาง use cases รับ DB เพื่ออ่าน Business
3. Raw adapter ยังเรียก Integration repository และอ่าน `rawExternalRecord` โดยตรงบางเส้นทาง ทั้งที่ raw evidence เป็นของ Integration
4. Canonical identity resolver ใช้ BusinessKnowledgeReadPort query `product_search`; ไม่ใช่สิทธิ์เรียก GKS ตรงหรือสร้าง canonical category/product เอง
5. Translation trigger เป็นการประมวลผล backlog ที่รับเข้าแล้ว มี bounded scan/batch และ partial per-record result; ไม่ใช่ acquisition scheduler/crawler
6. Lineage identity ใช้ rawRecordId + payloadHash + translationSchemaVersion + observationType; unique lineageKey เป็นจุดป้องกัน duplicate persistence

ทำตาราง `capability → current executor → data owner → consumers → target executor → MOVE/KEEP/ADAPTER/SHARED-TRANSITION → test proof` และแยก implemented/planned/unknown ก่อนย้าย

## 3. ผลลัพธ์ที่ต้องได้และสิ่งที่ไม่ทำ

### In scope

- Translation ของ trusted raw market evidence เป็น provider-neutral observations
- การบันทึก observations ที่มี scope/lineage ถูกต้องและ replay-safe
- Observation feed/read models และ analysis ที่ยืนยันแล้วว่าถูกเรียกใช้งานจริง
- Thin compatibility adapters สำหรับหน้า `/market` และ `/api/market/**` โดยรักษา behavior/security
- Explicit ScopeAuthority, RawEvidenceRead, KnowledgeIdentityRead และ Audit contracts ที่ต้องใช้
- Service entrypoint/configuration, owned persistence adapter, independent build/image/tests, health/readiness/shutdown
- Integration/recovery/compatibility proof และ migration/cutover runbook ที่ยังไม่ใช้ production

### Out of scope

- ไม่เขียน crawler, browser automation, polling scheduler, watchlist/alerts ใหม่เพื่อขยาย Market
- ไม่ทำ provider acquisition, credential store, cursor, raw-ingestion/dead-letter stack ใหม่
- ไม่ย้าย Files/MinIO, LINE transport, conversation executor, stock, procurement, pricing authority หรือ payment
- ไม่ทำ SupplierCandidate ให้เป็น approved Supplier และไม่ส่งคำแนะนำไปสร้าง PO/ปรับ stock/ราคาอัตโนมัติ
- ไม่ย้าย canonical facts/ontology/publication/17-stage knowledge pipeline มาอยู่ Market
- ไม่เปลี่ยนภาษาหรือ framework/ORM/package manager ของทั้ง repo ไม่เพิ่ม Kubernetes/service mesh/broker โดยไม่มีเหตุผลที่พิสูจน์ได้

ถ้า module ที่ดูเหมือน analysis/research ยังเป็น pure utility หรือไม่มี runtime caller ให้บันทึกตามจริง ไม่เปลี่ยน target feature เป็น delivered feature ด้วยการย้ายไฟล์

## 4. Target boundary

```text
Zuri Market UI / thin BFF
          │ Market service contract
          ▼
Market Intelligence process
   ├─ observation translation / persistence / scoped reads
   ├─ owned Market repository + migration owner
   ├─ ScopeAuthorityPort ─────→ existing Identity / Business authority
   ├─ RawEvidenceReadPort ────→ existing Integration owner
   ├─ KnowledgeIdentityReadPort → existing governed knowledge reader
   └─ Audit boundary ────────→ approved audit owner / durable handoff
```

ชื่อ ports เป็น conceptual contract ไม่อ้างว่ามี HTTP routes เหล่านี้แล้ว Reuse/version ของที่มีเมื่อ semantics ตรง ไม่สร้าง API ชื่อใหม่ทุกอย่างโดยอัตโนมัติ

- Domain/application ไม่ import Next.js, global Prisma singleton, process.env, route files หรือ foreign domain implementations
- Composition root เป็นผู้ประกอบ adapters; libraries ที่ใช้ร่วมต้องไม่ re-export apps/server หรือซ่อน global DB เข้า service
- Service ใหม่ต้องแปลงและเขียน/read MarketObservation เอง ไม่เป็น proxy ที่กลับไปให้ core รัน Market business logic
- Core façade ใช้ได้สำหรับ authority/raw evidence ที่ core เป็นเจ้าของจริง ไม่จำเป็นต้อง extract Integration ทั้ง domain
- Same monorepo/same host ใช้ได้ แต่ image ต้อง build โดยไม่ next build และ runtime ไม่ mount server source

## 5. Contract gate ก่อนเชื่อมระบบ

ตกลง exact contract revision/commit, owner, conformance fixtures และ changed-path ownership ของตารางนี้ก่อน shared integration:

| Contract | สิ่งที่ต้องกำหนด |
|---|---|
| Market API | scoped feed, existing translation operation, status/error/result ที่รักษา behavior เดิม |
| ScopeAuthorityPort | actor/delegation, current tenant/business authority, domain visibility, read/write decision, revoke/freshness |
| RawEvidenceReadPort | eligible MARKET_INTELLIGENCE evidence, tenant/business/connection scope, bounded list/read, immutable source identity, redaction/visibility |
| KnowledgeIdentityReadPort | registered query semantics, safe scope, resolution result, optional-unconfigured vs provider failure |
| Audit boundary | canonical event owner, actor/scope provenance, durable result and reconciliation; ไม่สร้าง synchronous PM dependency เพื่อ append audit |

การส่ง `viewer`, role, tenantId หรือ raw envelope จาก client/LLM ไม่ทำให้ได้รับสิทธิ์ Domain core อาจใช้ trusted DTO ที่ผ่าน boundary แล้ว แต่ network endpoint ต้องโหลด/ตรวจ authoritative state

Façade ที่ต้องเพิ่มใน core ให้ทำเป็น shared-integration patch แยกและประสาน integrator ไม่แก้ file ที่ lane อื่นกำลังถือ ขณะ gate ยังไม่พร้อมให้ทำ core/provider contract tests ต่อได้ แต่รายงานว่า production integration ยัง blocked

Knowledge port เป็น optional เฉพาะตาม behavior เดิม: ไม่ตั้ง resolver/ไม่มีผล → UNRESOLVED ได้ แต่ provider error/authorization failure ต้องมี semantics ชัด ไม่กลืน error แล้วอ้างว่าค้นจริงแล้วไม่พบ

## 6. Invariants ที่ต้องรักษา

### Scope / privacy

- Tenant เป็น hard isolation; MarketObservation สืบทอด Business ของ source connection ไม่เปิด Tenant-wide visibility เพราะอยู่ Tenant เดียวกัน
- API งาน Business ต้องระบุ Business ที่ตรวจแล้ว; legacy `businessId=null` ไม่เท่ากับ omitted/undefined และไม่ถูกนำเข้ารายการ A/B โดยอัตโนมัติ
- read ต้องผ่าน visibility/domain gate; translation write ต้องผ่าน write authority เดิม ไม่ยกระดับ member ให้เขียนเพื่อให้ test ผ่าน
- ป้องกัน confused-deputy: service credential ไม่ใช่สิทธิ์ทุก Business ต้องตรวจ subject/delegation/resource ทั้งก่อนอ่าน raw และก่อน protected write
- sourceUri เป็น provenance ไม่ใช่คำสั่ง fetch arbitrary URL; private evidence ไม่กลายเป็น public หลัง translation
- source ถูก redacted/revoked ต้องไม่ reconstruct จาก candidate cache หรือ historic raw โดยไม่มี policy; ใช้ authoritative redaction state และ projection invalidation ตามที่ออกแบบได้จริง

### Provenance / idempotency

- scope, rawRecordId, connectionId, provider, externalId และ sourcePayloadHash มาจาก trusted raw owner ไม่ให้ extractor override
- Preserve lineage-key algorithm/translationSchemaVersion ที่ยัง compatible; เปลี่ยน semantics ต้อง version migration ไม่ทับ historical identity
- `insertIfAbsent` ต้อง atomic ผ่าน unique constraint/approved primitive; ทดสอบ concurrent requests ด้วย connection/process ที่แข่งขันจริง ไม่ใช้ read-then-create
- หลัง collision ตรวจ scope ของ row ที่อ่านกลับ ห้าม idempotency leak ข้าม tenant/business
- source hash เป็น hash ที่ Integration นิยาม ห้ามเปลี่ยนวิธีคำนวณ raw hash เองหรือเอา redaction tombstone ไปเทียบกับ payload hash เดิมแล้ว revive content
- observedAt/translatedAt/createdAt คนละความหมาย รักษาเวลาต้นทางกับเวลาประมวลผล
- งาน translation replay/schema-version change ต้องตรวจว่าตัว candidate-filter ที่ใช้ rawRecordId ยังสอดคล้อง lineage key หรือไม่; หากพบ bug ให้แยก regression และรายงาน ไม่แก้ semantics เงียบ ๆ
- UNRESOLVED/PARTIAL/RESOLVED และ confidence ต้องมาจาก evidence; ไม่สร้าง canonical ID หรือ placeholder ที่ดูเหมือนยืนยันแล้ว

### Batch / failures / audit

- รักษา default/max batch, bounded scan และ response shape ของ current callers ไม่แอบเพิ่ม unbounded scan หรือ async scheduler
- per-record failures ไม่เท่ากับ batch atomic failure; รักษา partial-progress semantics หรือเสนอ explicit versioned contract พร้อม review
- DB commit แล้ว response หาย ใช้ stable operation/lineage receipt lookup ก่อน retry ไม่สร้าง observation ซ้ำ
- Audit ที่ต้อง atomic อยู่ใน owner transaction หรือ durable intent/outbox ที่มีผลที่นิยามชัด; อย่าอ้างว่าการเพิ่ม outbox ทำ raw read/DB/network ทั้งหมดเป็น ACID
- ไม่ย้าย audit infrastructure ของทุก domain มาอยู่ Market; event lineage ต้องถูกต้องและไม่ log raw payload/credential
- ถ้าเพิ่ม durable execution state ที่จำเป็นต่อ extraction ให้แยกกับ business MarketResearchRun ที่ยังไม่ได้ implement และห้ามสร้าง pipeline ledger คู่ขนาน

## 7. Data ownership และ migration

ตรวจ schema จริงก่อนเลือกวิธี: same physical DB ระหว่าง transition ใช้ได้ แต่ต้องมี owner ของ Market writes หนึ่งเดียว, restricted DB role ถ้า provider รองรับ, migration owner และ no-foreign-table access policy ที่ทดสอบได้

ไม่แชร์ global Prisma client ทั้งระบบเป็น contract; source refs/FK, erasure, backup/export/import และ code ที่อ่าน MarketObservation ต้องอยู่ใน consumer migration inventory ด้วย

ถ้า database adapter ยังอ่าน Business/RawExternalRecord ข้าม domain ให้ mark SHARED-TRANSITION พร้อม exact dependency ไม่รายงาน DATA_OWNERSHIP_ENFORCED=PASS

ไม่ drop FK/cascade หรือเปลี่ยน IDs เพียงเพื่อให้แยกง่าย ทำ expand/contract + repeatable backfill/reconciliation บน disposable data เมื่อจำเป็น Preserve IDs, lineageKey, content/provenance fields, source links และ version behavior

Legacy/new Market writer ต้องมี authoritative routing ต่อ cohort และทดสอบไม่ double-execute uncontrolled ผลสรุป runtime extraction/data ownership/physical relocation แยกกัน ไม่บังคับ production relocation เพื่อทำ isolated development

Rollback หลังมี new writes ต้องรักษา observation/receipts/references และ rejoin consumers ได้จริง ไม่ใช่ flip env กลับ DB เก่าแล้วทิ้งข้อมูล

## 8. ลำดับ implementation ที่เลือก

| Tranche | สิ่งที่ทำ | เกณฑ์ checkpoint |
|---|---|---|
| M0 | discovery, baseline, dependency/ownership inventory, ADR/contract plan ตาม repo | ขอบเขต actual-vs-planned ชัด; มี failing tests เมื่อพบ regression |
| M1 | pure core/repositories, isolated tests และ proposed contracts | domain tests ไม่ boot Next/DB; ไม่ deep-import core |
| M2 | process ใหม่ + real owned persistence + test dependency adapters | raw fixture → service translation → durable observation → scoped feed |
| M3 | core-compatible façades + consumers + conformance | real core/test DB → independent Market process → BFF/consumer ผ่าน authenticated ports |
| M4 | concurrency/recovery, source revoke, audit, migration/rollback rehearsal | fault matrix ผ่านและ claims ไม่เกินหลักฐาน |
| M5 | final regression/build/image-start/CI, handoff และ status update | exact checks ที่ approved scope ต้องมีครบ; ไม่อ้าง production cutover |

M0/M1 และ service-local M2 เริ่มขนานได้ ไม่ต้องรอ CR/Files ทั้งชุด M3 รอเฉพาะ contract/owned shared patches ที่จำเป็น ไม่เพิ่ม hard dependency ต่อการ merge CR โดยไม่มีเหตุผล

## 9. Test acceptance

1. Pure translation/domain tests: payload parsing, normalization, lineage/hash, timestamps, valid/invalid resolver result, absent resolver
2. Repository component: persist/query บน DB ทดสอบของ owner; duplicate/concurrent lineage; cross-scope collision; restore/restart persistence
3. Scope tests: Tenant T มี A/B, Tenant U; A-only/B-only, denied domain, revoked membership, null/undefined Business, spoofed actor/scope/connection
4. Raw evidence: wrong lane, wrong connection, redacted/revoked payload, invalid envelope, source hash semantics, bounded list and scans
5. Contract: runtime ↔ core façades และ consumer ↔ Market ทั้ง request/response/errors; conformant fakes และ real provider proof แยกกัน
6. Workflow: raw ที่ Integration รับอย่างถูกต้องใน test env → authenticated Market translation ใน process ใหม่ → DB → feed ผ่าน consumer; old code path ไม่เป็น executor ซ่อนอยู่
7. Failure/recovery: timeout ก่อน/หลัง commit, partial batch, retry/restart, provider unavailable, duplicate request, audit failure/reconciliation, no fabricated canonical identity
8. Compatibility: routes/UI/analysis callers ที่อยู่ใน actual scope, visibility, pagination/error semantics, existing backup/export/erasure consumers
9. Isolation: image build โดยไม่ next build/CR/Files/Edge/GKS; start และรัน representative workflow กับ declared test deps ได้
10. Container proof: ตรวจ resolved Compose context/Dockerfile/COPY ด้วย command จริงแล้ว build/start บน disposable stack; Dockerfile มีเฉย ๆ และ `docker build` อย่างเดียวไม่ใช่ startup proof
11. Governance: new paths อยู่ใน graph/ownership scanners/affected tests; preserve required checks/fail-on-zero-tests/fail-on-flaky; contract/shared schema เปลี่ยนต้องตรวจ consumers

ใช้ focused tests ใน inner loop และ full mandatory regression ตาม repo ก่อนพร้อม review หาก local ไม่มี Docker ให้เพิ่ม isolated CI image-start/smoke เมื่อ workflow อนุญาต หรือบันทึก NOT_RUN ห้ามใช้ live container แทน

เก็บ command, OS/runtime, discovered/executed/skipped, exit code, duration, source SHA และ actual artifact path; ไม่รับประกันเวลาลดลงโดยไม่มี baseline และไม่ใช้ mock-only เป็น full integration proof

## 10. Safety / governance / resource isolation

แก้เฉพาะ `Freshair129/zuri.ai`; ไม่อ่านหรือเขียน production secrets/.env, legacy zuri, Edge secrets หรือ external MSP/GKS/GenesisBlock/PRP repos นอก scope

ใช้ task-owned worktree/branch/dependencies/generated client/DB/ports/Compose project/volumes แยกกัน Git worktree ไม่แยก Docker daemon หรือ DB volume ให้เอง ห้าม reset/stash/overwrite อีก lane, shared node_modules junction, force-push, prune, down -v, production migrations หรือ real scraping/provider calls

ไม่ deploy/stop/recreate production ไม่ส่ง LINE จริง ไม่เรียก paid/live model ไม่เปลี่ยน repository visibility/bucket policy/data storage เจ้าของ operator อนุมัติขั้นเหล่านั้นต่างหาก

ใช้ repo ID allocator/templates คง subject anchors และ @req/@spec/@tested ไม่เดาเลข ADR/FR ไม่ปลอม approved decision หรือ hand-edit generated graphs/ID ledger เพื่อให้ผ่าน

สร้าง local commits/patch และ issue/PR เฉพาะเมื่อได้รับสิทธิ์ตาม workflow ห้าม merge/auto-merge เอง และห้ามยกระดับ role/bypass security/test เพื่อทำ CI เขียว

## 11. สถานะและ handoff ที่ต้องอัปเดตทุก checkpoint

Session 4 เป็นเจ้าของ `MARKET-INTELLIGENCE-HANDOFF.md` ใน canonical migration docs ที่ตรวจพบจริง ค่าเสนอเมื่อยังไม่มีคือ `docs/migrations/service-extraction/MARKET-INTELLIGENCE-HANDOFF.md`

เมื่อจบ tranche, เปลี่ยน blocker/contract, เปิด/อัปเดต PR หรือก่อนส่งต่องาน ให้เขียน:

- task/session owner, base/head SHA, PR/branch, exact scope และ current tranche
- implemented/verified/remaining แยกกัน
- contracts: provider/consumer, exact revision/commit, proposal/reviewed/provider-tested/consumer-tested states
- blockers แบบ `{dependency, phase_blocked, condition_to_unblock, owner, evidence, safe_work_now}`
- tests พร้อมหลักฐานและ next exact action
- สถานะแยก CODE_IMPLEMENTED / ISOLATED_TESTS_VERIFIED / CONTRACT_VERIFIED / CONSUMER_INTEGRATION_VERIFIED / DATA_OWNERSHIP_ENFORCED / IMAGE_BUILD_VERIFIED / IMAGE_START_VERIFIED / CI_VERIFIED / PRODUCTION_CUTOVER

ใช้ PASS/FAIL/PARTIAL/NOT_RUN/UNKNOWN ตามหลักฐาน; ไม่ตั้ง PASS จากการมีไฟล์หรือชื่อ service และ CI PASS ไม่เท่ากับ extraction COMPLETE

ส่ง status delta ให้ integrator ปรับ `REFACTOR-STATUS.md` อย่าแก้แถว session อื่นหรือทับตารางกลางจากสำเนาเก่า ถ้าไม่ได้มีสิทธิ์รวม ให้ commit handoff/patch แล้วรายงาน pending-board-integration ไม่สัญญาว่าจะอัปเดตเบื้องหลัง

## 12. Definition of done

งานนี้เสร็จเมื่อ Market in-scope execution อยู่ใน service ใหม่จริง, callers ใช้ contract, authorization/provenance/idempotency/recovery และ compatibility ผ่าน, independent image-start มีหลักฐาน, required review/CI ครบ และ handoff/board ตรงกับผล

Runtime ที่ยังพึ่ง core-owned authority/raw API ถือเป็น explicit dependency ไม่ใช่ความล้มเหลว แต่ห้ามเรียกว่ารัน production โดยไม่พึ่ง core หรือว่า data ownership แยกครบถ้ายังอ่านตารางข้ามเจ้าของ

การ merge และ production cutover เป็น operator/review gates แยก ไม่ทำเอง หากยังไม่ครบส่ง reviewable partial checkpoint พร้อมสิ่งที่ทำต่อได้ ไม่หยุดแค่แผนและไม่ปลอม completion

**เริ่มจากตรวจ current repo/status/ownership แล้วรายงาน findings กับแผนสั้น ก่อนลงมือทำ M0→M1→vertical slice ที่ปลอดภัยต่อทันที**

---

## แหล่งตรวจเทียบ (pinned snapshot ไม่ใช่ current completion proof)

- [Market charter](https://github.com/Freshair129/zuri.ai/blob/fad8ec6252941ca3de01afdb3116484f86b366c3/docs/domains/market-intelligence/CHARTER.md)
- [Observation service](https://github.com/Freshair129/zuri.ai/blob/fad8ec6252941ca3de01afdb3116484f86b366c3/apps/server/src/modules/market-intelligence/application/market-observation-service.js)
- [Translation core](https://github.com/Freshair129/zuri.ai/blob/fad8ec6252941ca3de01afdb3116484f86b366c3/apps/server/src/modules/market-intelligence/application/translate-raw-record.js)
- [Observation repository](https://github.com/Freshair129/zuri.ai/blob/fad8ec6252941ca3de01afdb3116484f86b366c3/apps/server/src/modules/market-intelligence/infrastructure/market-observation-repository.js)
- [Raw evidence adapter](https://github.com/Freshair129/zuri.ai/blob/fad8ec6252941ca3de01afdb3116484f86b366c3/apps/server/src/modules/market-intelligence/infrastructure/market-raw-record-repository.js)
- [Knowledge resolver](https://github.com/Freshair129/zuri.ai/blob/fad8ec6252941ca3de01afdb3116484f86b366c3/apps/server/src/modules/market-intelligence/infrastructure/gks-market-identity-resolver.js)
- [OpenAI Codex worktrees](https://developers.openai.com/codex/app/worktrees/)
- [Domain boundary guidance](https://learn.microsoft.com/en-us/azure/architecture/microservices/model/domain-analysis)
