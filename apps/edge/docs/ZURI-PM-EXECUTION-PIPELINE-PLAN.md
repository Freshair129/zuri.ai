---
version: "0.1.0b"
created_at: "2026-08-23T01:15:00+07:00, ATHER"
last_update: "2026-08-23T01:15:00+07:00, ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "Edge Device to zuri-ai Project Manager execution-plan and pipeline state boundary"
  plan_kind: "documentation-first implementation plan"
  state_owner: "zuri-ai"
---

# Zuri PM Execution Pipeline — Implementation Plan

## 0. Plan status

สถานะเอกสาร: **Candidate / Reviewable only**

เอกสารนี้เป็นแผนและผล audit แบบ read-only ยังไม่สร้าง PlanEnvelope row, ยังไม่ส่งเข้า
zuri-ai, ยังไม่แก้ schema และยังไม่เปลี่ยนสถานะงานใด ๆ

## 1. Outcome

ทำให้แผนจาก Edge แสดงใน Zuri Project Manager ได้ โดยให้ `zuri-ai` เป็นเจ้าของ state
เพียงรายเดียว:

```text
Edge / Agent
  -> PlanEnvelope 1.2 builder (ไม่มี durable task state)
  -> authenticated PM adapter
  -> Zuri validate + semantic check
  -> dry-run + conflict preview
  -> Human approval
  -> transactional commit in zuri-ai
  -> Project / Workstream / WorkContainer / WorkItem
  -> PM roadmap + strategy-based progress

Data pipeline execution
  -> PipelineRun / PipelineStep / PipelineRecordEvent / Reconciliation
  -> Zuri pipeline monitor
  -> approved PM projection (เมื่อมี explicit WorkItem binding เท่านั้น)
```

`PipelineRun` ไม่ใช่ `WorkItem` และ `Execution Plan` ไม่ใช่ตารางใหม่:

| PM label | Canonical owner/model | Role |
|---|---|---|
| Project | `Project` | งานระดับโครงการและ scope |
| Execution Plan | `Workstream` | แผนหลักของโครงการ (`planId = Workstream.id`) |
| Phase/Sprint/Stage/Batch | `WorkContainer` | ช่วงหรือกลุ่มงาน |
| Task/Dataset/Validation | `WorkItem` | งานที่ PM ติดตาม |
| Pipeline run | `PipelineRun` | หลักฐานการประมวลผลและ replay lineage |

## 2. Assumptions and decisions required

1. แผน integration นี้ใช้ `SOFTWARE_SPRINT` สำหรับงานสร้าง bridge และใช้
   `DATA_MIGRATION` เฉพาะงาน catalog/data pipeline; ไม่รวม state สองชนิดเป็นก้อนเดียว
2. การเชื่อมครั้งแรกจะผ่าน PM adapter ที่มี authenticated viewer ของ Zuri แล้วเรียก
   `project_manager.plan_dry_run` และ `project_manager.plan_commit` ผ่าน `/api/mcp`
   หรือ API ที่มี contract เดียวกัน
3. `HttpZuriApiClient` เดิมของ Edge ที่เรียก `/api/agent-commands` เป็น command/delivery
   contract ไม่ใช่ PM state contract และจะไม่ถูกใช้เป็นทางลัดเขียน WorkItem
4. หากต้องการ unattended Edge ที่ใช้ device credential โดยไม่มี user session ต้องมี
   การอนุมัติแยกสำหรับ device-to-PM authentication adapter; ห้ามนำ bearer ของ command
   contract ไปใช้กับ `/api/mcp` โดยสมมติว่าเป็น viewer
5. Pipeline evidence เป็น source of truth ของการประมวลผล ส่วน `WorkItem.metrics` เป็น
   read projection สำหรับ PM progress ได้ต่อเมื่อ Zuri เป็นผู้ตรวจและเขียน projection
   ใน transaction เดียวกับ receipt เท่านั้น

## 3. Audit result ณ 2026-08-23

| Area | Current evidence | Verdict |
|---|---|---|
| PlanEnvelope schema | `contracts/plan-envelope.schema.json` และ `plan-schema.js` รองรับ 1.0/1.1/1.2, mode/strategy/subtype validation, trace และ domain binding | **ใช้งานได้ใน zuri-ai local** |
| Dry-run | ตรวจ target authorization ก่อน parse, Zod + semantic validation, diff/conflict preview และไม่เขียน DB | **พร้อมเป็นขั้น preview** |
| Commit | transaction เดียว, upsert ตาม external id/code, สร้าง Project/Workstream/Container/Item/Milestone/Gate/Dependency, AuditEvent และ PlanImportReceipt | **พร้อมระดับ local contract** |
| Replay import | schema 1.2 ใช้ `idempotencyKey` + normalized payload hash; replay เดิมคืน receipt เดิม; payload ต่างกันเป็น conflict | **มี guard แล้ว** |
| PM display | `GET /api/projects/:id/roadmap` อ่าน graph เดียวกันและแสดง execution plans, IDs, tasks, gates, dependency และ progress | **อ่านได้ใน PM local** |
| Progress aggregate | คำนวณจาก mode-specific strategy และ weighted Workstream roll-up ตอนอ่าน ไม่ใช่ task ratio กลาง | **หลักการถูกต้อง; ต้องมี event/projection ที่อัปเดต input** |
| WorkItem state | Zuri service เป็นผู้ PATCH status, increment version และเขียน AuditEvent; Edge ยังไม่มี PM state client | **state owner ถูก แต่ transport ยังขาด** |
| Pipeline ledger | `PipelineRun`/`PipelineStep`/record/reconciliation/gate, status transition, event idempotency, heartbeat stale และ replay request มีใน zuri-ai | **ใช้งานได้เป็น ledger local** |
| Pipeline → PM aggregate | ยังไม่พบ explicit `projectId/planId/workItemId` binding หรือ transaction ที่นำ reconciliation ไปอัปเดต PM WorkItem metrics | **ยังไม่ end-to-end** |
| Edge → PM | Edge มี command client สำหรับ `/api/agent-commands`, heartbeat และ status; ไม่พบ PlanEnvelope builder/PM import client | **ยังต่อ PM ไม่ได้โดยตรง** |
| Test evidence | ชุด targeted test รอบนี้ค้างที่ `prisma db push --skip-generate` ก่อนเข้า test case จึงไม่ถือเป็น pass | **ต้อง rerun ใน isolated test environment** |

## 4. State contract

### 4.1 Import state

ไม่เพิ่ม `ExecutionPlan` หรือ state store ที่ Edge:

| State | Authority | Stored evidence |
|---|---|---|
| `DRY_RUN_VALID` / conflict | zuri-ai | preview response; no write |
| `COMMITTED` | zuri-ai | Project graph + `PLAN_IMPORTED` AuditEvent |
| `REPLAY` | zuri-ai | existing `PlanImportReceipt`, original execution IDs |
| `IDEMPOTENCY_CONFLICT` | zuri-ai | rejected response; no graph mutation |

### 4.2 PM work state

`WorkItem.status`, `WorkItem.version`, `updatedAt` และ AuditEvent อยู่ใน zuri-ai
เท่านั้น. ทุก remote update ต้องมี:

- trusted actor/viewer resolved by Zuri;
- `workItemId`/`planId` resolved server-side;
- `expectedVersion` หรือ equivalent optimistic-concurrency guard;
- event/request idempotency key;
- transaction ที่ทำ state update และ audit receipt พร้อมกัน;
- response คืนสถานะใหม่, version, audit ID และ correlation ID.

สถานะที่ใช้ต้องเป็น `WORK_STATUSES` เดิม; ห้ามสร้าง status เฉพาะ Edge.

### 4.3 Pipeline execution state

`PipelineRun.status` และ `PipelineStep.status` ใช้ transition graph ของ pipeline เดิม
(`QUEUED → RUNNING → terminal`) และรับ event ผ่าน server-owned receiver เท่านั้น.
`STEP_HEARTBEAT` ที่เกิน stale threshold ต้องทำให้ monitor เป็น `UNKNOWN`/unavailable
อย่างตรงไปตรงมา ไม่แปลงเป็นสำเร็จ.

### 4.4 Aggregate projection rule

เมื่อ PM ต้องแสดงความคืบหน้าจาก data pipeline ให้ใช้เส้นทางนี้:

```text
validated pipeline event
  -> append-only PipelineEventReceipt
  -> update PipelineRun/Step aggregate
  -> optional authorized PM projection
       WorkItem.metrics = latest accepted reconciliation evidence
  -> strategy calculator (RECORD_VALIDATION)
  -> Workstream weighted roll-up
  -> PM roadmap / Migration Monitor
```

Pipeline evidence และ PM projection ต้องมี `correlationId`, `executionRunId`,
`executionStepId`, `attemptId`, `projectId`, `planId`, `workItemId` และ source/artifact
hashที่เพียงพอสำหรับ trace. ห้ามใช้ `pipelineId` แทน `planId` เพราะ `pipelineId`
เป็น alias ของ B2B WorkContainer.

## 5. Phase plan

### P0 — Contract and authority freeze

**Deliverables**

- เอกสาร mapping ระหว่าง Edge, PM และ pipeline ledger
- เลือก transport ที่ได้รับอนุมัติ: authenticated MCP/API หรือ device-to-PM adapter
- ระบุ owner ของทุก field และ state transition
- RCA สำหรับ aggregate counter/projection gap ก่อนแก้ code

**Gate P0**

- ยืนยันว่าไม่มี direct Edge → database
- ยืนยันว่า `/api/agent-commands` ไม่ถูกใช้เป็น PM import endpoint
- ยืนยัน project/workspace/business target และ actor ที่จะใช้ทดสอบ

### P1 — PlanEnvelope 1.2 producer

**Deliverables**

- builder/normalizer ของ Edge ที่สร้าง schema 1.2 เท่านั้น
- `trace.correlationId` และ `trace.idempotencyKey` deterministic ต่อ request
- `domainBinding`, `identityRefs`, `executionModeId`, `executionContractId`,
  `contractVersion` ครบและตรงกับ mode
- local JSON Schema/Zod contract tests; ไม่มี write

**Gate P1**

- invalid mode/strategy/subtype/status ถูก reject
- duplicate code/external ID/dependency ถูก reject
- envelope เดียวกันสร้าง hash เดียวกัน

### P2 — PM transport and preview

**Deliverables**

- PM adapter เรียก `project_manager.plan_dry_run`
- authenticated viewer/device principal ถูกตรวจโดย zuri-ai
- timeout, retry, 4xx/5xx และ unavailable แสดงเป็นสถานะจริง
- response เก็บเฉพาะ receipt/IDs ที่จำเป็น; Edge ไม่เก็บ business task state

**Gate P2**

- dry-run ไม่สร้าง Project, Workstream, WorkItem หรือ AuditEvent
- cross-business/workspace target ถูกปฏิเสธเหมือน not-found
- preview แสดง insert/update/conflict ก่อน commit

### P3 — Human-approved commit and receipt

**Deliverables**

- commit ใช้ `project_manager.plan_commit` หลัง approval เท่านั้น
- Zuri คืน `projectId`, `planId`/Workstream ID, container/item IDs,
  `executionRunId`, `executionStepId`, `attemptId`, `auditEventId`
- replay เดิมคืนผลเดิม; idempotency key กับ payload ใหม่เป็น conflict

**Gate P3**

- transaction failure ไม่เหลือ partial graph
- PM `/roadmap` เห็น plan และ task จาก graph ที่เพิ่ง commit
- AuditEvent/PlanImportReceipt trace กลับไปยัง envelope ได้

### P4 — Zuri-owned task state update

**Deliverables**

- endpoint/tool สำหรับ status/metric update ที่เป็น Zuri service เดียว
- optimistic concurrency (`expectedVersion`) และ idempotent update receipt
- update + AuditEvent transaction เดียว
- aggregate read model recompute/invalidation หลัง update

**Gate P4**

- stale version ถูก reject โดยไม่เขียนทับ state ใหม่
- duplicate event ไม่เพิ่ม version หรือ audit ซ้ำ
- status update ใน PM, Board, Roadmap และ All Work อ่านค่าเดียวกัน

### P5 — Pipeline binding and aggregate projection

**Deliverables**

- explicit PM context binding: `projectId`, `planId`, `workItemId` (และ container ถ้ามี)
- แก้ aggregate counters ให้สะท้อน reconciliation ล่าสุดใน transaction
- projection policy: `PipelineRun` เป็น evidence truth; `WorkItem.metrics` เป็น PM read projection
- preserve failed/skipped/stale/replay lineage และ source/artifact hashes

**Gate P5**

- `actual/failed/inserted/updated/reconciled` ไม่แยกค่าขัดกันระหว่าง run กับ reconciliation
- pipeline event ที่ซ้ำหรือมาผิดลำดับไม่ทำให้ aggregate ถอยหลัง
- pipeline ที่ไม่มี PM binding ไม่อัปเดต WorkItem ใด ๆ
- replay สร้าง lineage ใหม่และไม่แก้ source run

### P6 — End-to-end PM proof

**Deliverables**

- isolated E2E fixture: Edge envelope → dry-run → approval → commit → state update → PM read
- pipeline fixture: create run → heartbeat → reconciliation → finish → monitor/read model
- failure/retry/stale/idempotency/conflict test matrix
- deployment/credential/authorization evidence แยกจาก local test evidence

**Definition of Done**

- PM แสดง project/plan/container/task/status/aggregate progress จาก Zuri state
- Edge restart ไม่ทำให้เกิด duplicate task หรือ duplicate event
- ไม่มี direct DB credential หรือ raw business rows ใน Edge logs/cache
- production readiness จะยังไม่ถูกอ้างจนกว่าจะมี live auth, database, network และ canary evidence

## 6. Acceptance test matrix

| Test | Expected result |
|---|---|
| Valid PlanEnvelope 1.2 | schema + semantic validation ผ่าน |
| Invalid mode/strategy/subtype/status | dry-run reject; zero writes |
| Unauthorized workspace/business | indistinguishable not-found; zero writes |
| Dry-run | preview only; no graph/audit mutation |
| First commit | one Project graph + receipt + audit |
| Same idempotency/payload | `REPLAY`/unchanged result; no duplicate rows |
| Same idempotency/different payload | conflict; no mutation |
| Commit failure mid-transaction | rollback; no partial graph |
| Task update with current version | one state change, one audit, version +1 |
| Task update with stale version | conflict; state/version unchanged |
| Duplicate task update event | unchanged receipt; no double increment |
| Pipeline reconciliation | run/step/reconciliation aggregates agree |
| Duplicate pipeline event | unchanged receipt; no duplicate record/audit |
| Failed step | failure code/errorRef/retryable + downstream explicit state |
| Missing heartbeat | monitor becomes `UNKNOWN`, not success |
| PM-bound pipeline | only bound WorkItem projection updates |
| Edge restart/retry | idempotent replay, no duplicate PM task |
| PM roadmap read | IDs, task state, evidence and weighted progress visible |

## 7. Risks and out of scope

| Risk | Mitigation |
|---|---|
| MCP uses user viewer auth while Edge has device credential | choose approved adapter at P0; fail closed until then |
| WorkItem and PipelineRun drift | single Zuri projection transaction + counter tests |
| optimistic version absent in current PATCH path | add contract before remote state updates |
| aggregate progress uses stale/missing metrics | explicit `UNAVAILABLE`/warning; never infer completion |
| local tests do not prove production | separate local, live, canary and release evidence |

Out of scope for this plan: direct Zuri PostgreSQL access from Edge, new execution modes,
new `ExecutionPlan` table, automatic commit without Human approval, production Supabase
apply, LINE delivery, and catalog taxonomy decisions.

## 8. Approval gate

กรุณาตรวจเอกสารนี้และตอบ:

```text
APPROVE PM-PIPELINE-P0
```

หลัง approval จึงจะสร้าง adapter/contract test หรือแก้ state projection ตาม phase ที่อนุมัติ
โดยจะไม่สร้าง database row หรือส่ง PlanEnvelope จริงก่อนผ่าน dry-run และ approval ของ commit.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-23 | candidate | Initial read-only audit and phase plan for Edge to zuri-ai PM state ownership | — | ATHER |
