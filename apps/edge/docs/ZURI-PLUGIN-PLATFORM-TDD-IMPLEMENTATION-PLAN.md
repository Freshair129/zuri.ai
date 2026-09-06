---
version: "0.2.0b"
created_at: "2026-08-23T00:00:00+07:00, ATHER"
last_update: "2026-08-23T03:24:00+07:00, ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "Zuri plugin, harness adapters, connector execution, and zuri-ai PM pipeline boundary"
  plan_kind: "technical-design-and-implementation-plan"
  state_owner: "zuri-ai"
  approval: "P0-P1 contract-only + P2 local auth boundary approved"
---

# TDD + Implementation Plan — Zuri Plugin Platform

| Field | Value |
|---|---|
| Product | Zuri Plugin Platform |
| Decision owner | Boss / product owner |
| Technical owner | ATHER — proposed, confirmation required |
| Status | Beta — P0/P1 contract artifacts and P2 local auth boundary implemented; live transport gated |
| Risk | HIGH — authentication, tenant data, connector side effects, and durable state |
| Specification authority | docs/ZURI-PLUGIN-PLATFORM-SPEC.md |
| Created | 2026-08-23 |
| Source authority | AGENTS.md, docs/AGENT-RUNTIME-SPEC.md, docs/COMMAND-AGENT-SPEC.md, docs/ZURI-PM-EXECUTION-PIPELINE-PLAN.md, and canonical zuri-ai contracts |

## 1. สรุปการตัดสินใจ

Zuri ควรเป็น **thin plugin / governed client** ที่เชื่อม Codex, Claude Code และ harness อื่น
เข้ากับ Zuri AI Platform ผ่าน canonical command protocol เดียวกัน ไม่ควรเป็น autonomous
connector runner ที่ถือ secret หรือเป็นเจ้าของ task state อยู่ในเครื่องผู้ใช้

หลักการที่ล็อกไว้ในเอกสารนี้:

1. zuri-ai เป็น authority เดียวของ identity, tenant/business authorization, policy,
   PlanEnvelope, PM state, pipeline receipt, audit และ rollback/kill switch
2. Harness และ model รับคำคุยธรรมชาติแล้วสร้างได้เพียง **plan proposal** ไม่ใช่ authorization
   และไม่ใช่ durable state
3. plan.preview, plan.commit และ pipeline.start เป็นคนละ command และคนละ approval boundary
4. Plugin เก็บได้เพียง encrypted installation identity และ bounded transient cache ที่ลบทิ้งได้
5. Connector ทุกตัวต้องประกาศ capability, scope, schema, data class และ egress policy ก่อนถูกเรียก
6. ทุก write ที่ไม่ทราบผลหลัง timeout ต้องเป็น OUTCOME_UNKNOWN และเข้าสู่ reconciliation
   ห้าม retry แบบเดาสุ่ม

เอกสารนี้เป็น candidate สำหรับ review เท่านั้น ยังไม่เพิ่ม endpoint, schema, credential,
database row หรือ pipeline run ใด ๆ

## 2. Context และหลักฐานปัจจุบัน

ปัจจุบัน zuri-edge-device มี shared CLI/bridge boundary สำหรับ Codex, Claude Code และ
Antigravity อยู่แล้ว โดย Edge เปิด DuckDB แบบ read-only, ใช้ query registry และส่ง evidence
ผ่าน Zuri command contract. เอกสารปัจจุบันกำหนดชัดว่า Edge ไม่ถือ tenant policy, ไม่ต่อ
Zuri PostgreSQL โดยตรง และไม่เรียก LINE API โดยตรง

ฝั่ง zuri-ai มี PlanEnvelope 1.2, dry-run, semantic validation, transactional commit,
PlanImportReceipt และ PM graph (Project → Workstream → WorkContainer → WorkItem) ในระดับ
local contract แล้ว ส่วน pipeline ledger มี PipelineRun, PipelineStep, event,
reconciliation และ replay lineage. อย่างไรก็ตาม audit ล่าสุดพบว่ายังไม่มี Edge-to-PM
PlanEnvelope adapter และยังต้องปิดช่องว่าง explicit PM binding/projection ของ pipeline ก่อน
อ้างว่าเป็น end-to-end production path

ดังนั้นข้อเสนอนี้เป็นการต่อยอดจาก boundary เดิม ไม่ใช่การสร้าง state store ใหม่ใน plugin
และไม่ใช่การเปลี่ยน Execution Plan ให้เป็นตารางใหม่

### 2.1 Assumptions

1. ผู้ใช้ต้องการให้การคุยใน Codex/Claude Code เป็น UX หลัก และไม่ต้องรู้คำสั่งภายใน
2. ใน V1 จะใช้ protocol กลางเดียวกันกับทุก harness; adapter เฉพาะ harness ทำหน้าที่บางที่สุด
3. PM state และ pipeline state ต้องอ่าน/เปลี่ยนผ่าน Zuri API หรือ contract ที่ Zuri อนุมัติเท่านั้น
4. V1 จะเริ่มจาก plan.preview และ read-only connector/pipeline health ก่อนเปิด connector write
5. ค่า timeline ใช้สมมติฐาน 2-week sprint, 1 platform/backend developer เป็นฐานประมาณการ

## 3. Problem Statement และเป้าหมาย

### ปัญหา

- ผู้ใช้คุยผ่าน harness หลายตัว แต่ต้องการให้แผนและผลการทำงานมี semantics เดียวกัน
- การต่อ connector ตรงจาก plugin จะทำให้ credential, tenant scope และ task state กระจายไปหลายจุด
- คำตอบจาก model อาจดูเหมือนอนุมัติแล้ว ทั้งที่ยังไม่มี server-side authorization หรือ approval
- timeout/retry ของ external API อาจสร้าง side effect ซ้ำ หากไม่มี execution identity และ receipt
- PM ต้องเห็นแผนและ pipeline เดียวกับที่ Zuri ใช้ตัดสิน ไม่ใช่สำเนาสถานะจากเครื่องผู้ใช้

### เป้าหมาย V1

- ผู้ใช้คุยธรรมชาติผ่าน Codex หรือ Claude Code ได้
- Harness เรียก canonical Zuri tools ที่ให้ผลเหมือนกัน
- Zuri ตรวจคน, session, business membership, capability และ policy จาก server-side context
- แปลงคำขอเป็น PlanEnvelope 1.2 proposal แล้วทำ dry-run/preview โดยยังไม่เขียน state
- หลัง approval จึง commit เป็น PM graph และเริ่ม pipeline แยกต่างหาก
- Pipeline ทำงานผ่าน lease, event receipt, idempotency และ PM projection ที่ Zuri เป็นผู้เขียน
- เพิ่ม connector หรือ harness ใหม่ได้โดยไม่สร้าง orchestration และ authorization ชุดใหม่

### ไม่ใช่เป้าหมาย V1

- ให้ model อนุมัติสิทธิ์หรือเปลี่ยน policy เอง
- ให้ plugin ต่อ Zuri PostgreSQL หรือ connector API โดยตรงพร้อม secret จริง
- universal autonomous agent ที่ทำทุก connector และทุก write ตั้งแต่วันแรก
- offline source of truth, local scheduler, local PM database หรือ local delivery outbox
- สร้าง ExecutionPlan table ใหม่หรือเพิ่ม state เฉพาะ Edge

## 4. Architecture Overview

### 4.1 Layer และ trust boundary

| Layer | ส่วนประกอบ | หน้าที่ | สิ่งที่ห้ามทำ |
|---|---|---|---|
| L0 | User + conversation | ให้ intent และ approval แบบมนุษย์ | ไม่ใช่หลักฐาน authorization โดยตัวมันเอง |
| L1 | Codex/Claude/other harness adapter | แสดง tools, รับผล, render preview/status | ห้ามถือ tenant authority, secret หรือ durable task state |
| L2 | Zuri Plugin SDK | auth client, envelope, redaction, idempotency, polling/streaming | ห้ามตัดสิน policy หรือสร้าง PM state เอง |
| L3 | Zuri Gateway + Identity | ตรวจ token/device/request และ resolve principal | ห้ามเชื่อ tenantId, role หรือ membership จาก body |
| L4 | Plan + Policy service | schema/semantic validation, dry-run, conflict, approval | ห้ามให้ model bypass policy |
| L5 | Connector registry + secret broker | capability catalog, scoped auth, secret resolution | ห้ามส่ง secret เข้า prompt/log/tool result |
| L6 | Pipeline orchestrator + durable state | run/step/lease/event/receipt/audit/kill switch | ห้ามให้ plugin เป็น state owner |
| L7 | Edge/connector worker | claim lease, execute bounded capability, heartbeat, evidence | ห้ามประกาศ PM success เองหรือยิง API นอก allowlist |
| L8 | PM read model | แสดง Project/Workstream/WorkItem/progress จาก Zuri state | ห้ามอ่าน state copy จาก plugin |
| L9 | External connectors | ระบบบัญชี, CRM, storage, messaging ฯลฯ | ถือเป็น untrusted boundary; response ต้อง validate |

### 4.2 Architecture diagram

~~~mermaid
flowchart LR
  U[User conversation] --> H[Codex / Claude Code / Other harness]
  H --> A[Thin harness adapter]
  A --> S[Zuri Plugin SDK]
  S --> G[Zuri Gateway]
  G --> I[Identity and session]
  G --> P[Policy and plan service]
  P --> R[Dry-run / approval / PlanEnvelope 1.2]
  P --> O[Pipeline orchestrator]
  O --> D[(Zuri durable state and audit)]
  O --> W[Leased Edge or connector worker]
  W --> C[Connector sandbox]
  C --> X[External connector]
  C --> E[Evidence and event receipt]
  E --> O
  D --> M[PM read model]
  M --> U
  K[Secret broker and connector registry] --> C
  I --> K
~~~

### 4.3 Authority matrix

| State/decision | Authority | Plugin behavior |
|---|---|---|
| Human identity/session | Zuri identity service | ขอ/เก็บ credential อย่างปลอดภัยและแนบ access token อายุสั้น |
| Tenant/business/membership | Zuri server-side resolver | ส่ง requested target ได้ แต่ห้ามถือเป็น fact |
| Plan proposal | Plugin/model + Zuri validator | สร้าง proposal; Zuri validate และออก draft/hash |
| Plan commit | Zuri plan service | เรียกหลัง approval receipt; รับ receipt เท่านั้น |
| WorkItem status/version | Zuri PM service | อ่านผ่าน API; ไม่ PATCH ตรงหรือเพิ่ม version เอง |
| PipelineRun/Step/event | Zuri orchestrator | ส่ง bounded evidence/event; Zuri aggregate และ deduplicate |
| Connector credential | Zuri secret broker | ไม่รับ raw secret และไม่เก็บใน local file |
| PM progress | Zuri projection/read model | แสดง receipt/reference ล่าสุด; ไม่คำนวณแทน source truth |

## 5. Identity, Authentication และ Authorization

### 5.1 Identity tuple

ห้ามใช้ userId เดี่ยวเป็นตัวแทนของ principal. ทุกคำขอที่มีสิทธิ์ควร resolve tuple
ประมาณนี้ในฝั่ง server:

~~~json
{
  "personId": "person_...",
  "sessionId": "session_...",
  "tenantId": "server-derived",
  "businessId": "server-derived",
  "membershipId": "membership_...",
  "roleBindings": ["..."],
  "harness": "codex|claude_code|other",
  "pluginInstallationId": "install_...",
  "deviceBindingId": "device_...",
  "connectorAccountId": "connector_...",
  "executionRunId": "run_...",
  "traceId": "trace_...",
  "policySnapshotId": "policy_..."
}
~~~

Codex account, Claude account, Zuri Person, plugin installation, device และ connector
account เป็นคนละ identity และต้อง map ผ่าน Zuri. External provider id ไม่ใช่ authorization
id โดยอัตโนมัติ

### 5.2 Authentication flow

1. Plugin เริ่ม interactive login ผ่าน OIDC/OAuth 2.1 Authorization Code + PKCE
2. Zuri สร้าง session และ resolve Person/membership/business ฝั่ง server
3. Plugin ใช้ short-lived access token; refresh credential อยู่ใน OS Credential Manager,
   Docker secret หรือ secure store ที่ได้รับอนุมัติ
4. Installation สร้าง pluginInstallationId และ device-bound key แยกจาก user token
5. ทุก request มี timestamp, nonce, trace และ idempotency; ใช้ signed request/DPoP หรือ
   device binding ตามความสามารถของ transport
6. Zuri ตรวจ session expiry, revocation, kill switch, policy snapshot และ capability scope
7. Commit, connector write, delivery หรือ side effect ต้องมี explicit approval หรือ policy
   ที่อนุมัติไว้ชัด พร้อม step-up auth เมื่อความเสี่ยงถึงเกณฑ์

### 5.3 Authorization rules

- Server derive tenant/business/role; ค่า client-supplied เป็นเพียง requested context
- Target ที่ไม่อยู่ใน scope ให้ตอบแบบไม่เปิดเผยว่ามี resource อยู่ (not-found/denied ที่ปลอดภัย)
- Scope แยกอย่างน้อย plan:preview, plan:commit, pipeline:start, pipeline:read,
  pipeline:cancel, connector:health และ capability เฉพาะ connector
- connector:authorize ต้องเป็น onboarding/admin flow แยกจาก natural-language execution
- Revocation ของ session, installation, device หรือ connector account ต้องหยุดคำขอใหม่และ
  ยกเลิก/พักงานที่ policy กำหนด

## 6. Canonical command และ data contracts

### 6.1 Canonical tools

เริ่มจาก command จำนวนน้อยและแยก side effect ให้ชัด:

| Tool | ผลลัพธ์ | Side effect |
|---|---|---|
| zuri.capabilities.get | capability/policy ที่ผู้ใช้เรียกได้ | none |
| zuri.plan.preview | planDraftId, planHash, diff, conflicts, warnings, TTL | no PM write |
| zuri.plan.commit | import receipt, PM IDs, audit ID | creates PM graph transactionally |
| zuri.pipeline.start | executionRunId และ binding | starts admitted pipeline |
| zuri.pipeline.get | run/step/event status แบบ redacted | none |
| zuri.pipeline.cancel | cancellation receipt | governed state change |
| zuri.connector.list | manifest/capability/health summary | none |
| zuri.connector.health | readiness ของ connector account | none |

plan.commit ไม่เริ่ม pipeline โดยอัตโนมัติใน V1. pipeline.start ต้องรับ plan hash,
approval/commit receipt และ PM binding ที่ Zuri ออกให้เท่านั้น

### 6.2 Envelope boundary

ทุก adapter ส่ง semantics เดียวกัน โดย envelope อาจมี schemaVersion, commandId,
idempotencyKey, traceId, causationId, commandType, harness metadata, requested target
และ payload ที่ validate แล้ว. tenantId, role, membership, policy snapshot และ secret ไม่รับ
ความจริงจาก payload; Zuri เติมจาก authenticated context

Plan ใช้ PlanEnvelope 1.2 ที่มีอยู่เป็น canonical contract และต้องคง:

- trace.correlationId และ trace.idempotencyKey
- domainBinding, identityRefs
- executionModeId, executionContractId, contractVersion
- normalized payload hash และ conflict/replay semantics

### 6.3 Connector manifest

ทุก connector ต้องมี manifest versioned:

~~~json
{
  "connectorId": "example",
  "version": "1.0",
  "authType": "oauth2",
  "capabilities": ["record.read"],
  "inputSchemaRef": "schema://...",
  "outputSchemaRef": "schema://...",
  "dataClasses": ["business-confidential", "pii"],
  "egressAllowlist": ["api.example.com"],
  "supportsIdempotency": true,
  "rateLimitPolicy": "policy://...",
  "healthCheckRef": "health://..."
}
~~~

Invocation ต้องผ่าน capability check → policy/consent → short-lived secret resolution →
sandbox/egress check → timeout/rate limit/circuit breaker → response schema validation →
redaction/minimization → evidence packet → event receipt

## 7. State machine และ pipeline

### 7.1 Plan state

~~~text
PROPOSED
  -> VALIDATING
  -> DRY_RUN_VALID | CONFLICT | REJECTED
  -> AWAITING_APPROVAL
  -> COMMITTED | EXPIRED
~~~

Preview ต้องออก planDraftId, planHash และ TTL. Commit ต้องอ้าง draft/hash เดิมและ
approval receipt; draft ที่ถูกแก้หลัง preview ต้องเป็น conflict ไม่ใช่ commit เงียบ ๆ

### 7.2 Pipeline state

ใช้ lifecycle ที่กำหนดใน Edge/Zuri contract:

~~~text
ADMITTED -> QUEUED -> CLAIMED -> EVIDENCE_READY
  -> REVIEW_REQUIRED | DELIVERY_PENDING
  -> DELIVERED | FAILED | CANCELLED | EXPIRED
~~~

Pipeline worker อาจมี internal execution result OUTCOME_UNKNOWN เมื่อ external write
timeout หลังส่งคำขอแล้ว แต่ห้ามแปลงเป็น FAILED แล้ว retry โดยไม่มี reconciliation

ทุก event ต้องมี executionRunId, executionStepId, attemptId, sequence, traceId,
correlationId, eventId และ idempotency key. Zuri deduplicate ก่อน mutation และเป็นผู้
คำนวณ aggregate status/progress

### 7.3 PM binding และ projection

หลัง commit ต้องมี explicit binding:

~~~text
projectId
  -> planId (Workstream)
  -> containerId (WorkContainer)
  -> workItemId (WorkItem)
  -> executionRunId / executionStepId
~~~

PipelineRun เป็น evidence truth; WorkItem.metrics เป็น read projection ที่ Zuri เขียน
หลัง validate reconciliation ใน transaction/receipt path. Pipeline ที่ไม่มี PM binding ห้าม
อัปเดต WorkItem ใด ๆ และห้ามใช้ pipelineId แทน planId

## 8. End-to-end user และ execution pipeline

~~~text
1. User พูดธรรมชาติใน Codex/Claude Code
2. Harness model จัด intent เป็น structured proposal (ยังไม่ใช่ authorization)
3. Thin adapter เรียก zuri.plan.preview ผ่าน Plugin SDK
4. Zuri ตรวจ token, installation, nonce, idempotency และ resolve principal
5. Zuri ตรวจ PlanEnvelope 1.2: schema, semantic, target, policy, capability, data class
6. Zuri ทำ dry-run/conflict check และคืน draft/hash/TTL/preview diff
7. User เห็นผลและกด approve; adapter ได้ approval receipt จาก Zuri
8. zuri.plan.commit ตรวจ hash + receipt แล้วสร้าง PM graph + audit + import receipt
9. User/Policy เรียก zuri.pipeline.start แยกต่างหาก
10. Zuri สร้าง PipelineRun/Step และผูก PM IDs; worker claim ด้วย lease
11. Worker เรียก connector ผ่าน manifest, secret broker และ sandbox
12. Worker normalize/redact evidence แล้วส่ง event receipt พร้อม sequence/attempt
13. Zuri deduplicate, update run/step/reconciliation และเขียน PM projection เมื่อ binding ถูกต้อง
14. Plugin อ่าน zuri.pipeline.get หรือ stream สถานะจาก Zuri และแสดงสถานะจริง
15. Failure/retry/cancel/replay ใช้ server receipt และ lineage ไม่ใช้ local plugin state
~~~

### 8.1 สถานะที่ต้องสื่อกับผู้ใช้

ใช้คำตาม operational truth: preview, awaiting approval, committed, queued, running,
review required, delivery pending, delivered, failed, cancelled, expired, unknown outcome,
unavailable. HTTP 202, timeout หรือ local model response ไม่ใช่หลักฐานว่า external side effect สำเร็จ

## 9. Risks

Risk score = Probability (1–5) × Impact (1–5). 1–6 is Low, 7–14 is Medium,
and 15–25 is High.

| ID | Risk | Probability | Impact | Score | Mitigation | Owner |
|---|---|---:|---:|---:|---|---|
| R1 | Cross-tenant authorization bypass | 3 | 5 | 15 | Server-derived membership, indistinguishable deny, negative/E2E tests | zuri-ai + Security |
| R2 | Connector secret/token/PII leak | 3 | 5 | 15 | Secret broker, secure store, redaction tests, no secret in model context | Platform |
| R3 | Duplicate external write after timeout | 4 | 5 | 20 | Connector idempotency, OUTCOME_UNKNOWN, reconciliation before retry | Pipeline + connector owner |
| R4 | PM WorkItem and PipelineRun drift | 3 | 4 | 12 | Explicit binding, event receipt, atomic projection and counter tests | zuri-ai PM |
| R5 | Prompt injection/tool escalation | 4 | 4 | 16 | Treat connector data as untrusted, allowlists, server policy gate | Security |
| R6 | Connector outage/rate limit/cascading failure | 3 | 4 | 12 | Timeout, circuit breaker, bounded retry and truthful unavailable state | Connector runtime |
| R7 | Scope expands into universal autonomous execution | 4 | 3 | 12 | Phase gates, one read-only connector first, separate write approval | Product owner |
| R8 | Auth/harness contract drift | 3 | 3 | 9 | Canonical conformance suite and one adapter before multi-harness rollout | Platform |

The highest risks are R3, R5, R1 and R2. They are release blockers, not post-launch
improvements.

## 10. Security Considerations

| Threat | ระดับ | Control ที่ต้องมี |
|---|---:|---|
| Prompt injection จาก connector data | สูง | แยก instruction/data, tool allowlist, server policy validation |
| Prompt ขอข้าม tenant/business | สูง | derive scope จาก session/membership ฝั่ง Zuri เท่านั้น |
| Plugin ถูก clone หรือ device ถูกยึด | สูง | device binding, signed request, nonce, rotation, revocation |
| Replay command/pipeline | สูง | timestamp, nonce, idempotency, stable run/step identity |
| Connector secret เข้า prompt/log | สูง | server-side secret broker, redaction, no secret in tool result |
| OAuth token ถูกขโมย | สูง | PKCE, short-lived access token, secure store, DPoP/device binding |
| Model สร้าง plan เกินสิทธิ์ | สูง | schema + semantic + policy + dry-run + approval receipt |
| Cross-tenant audit/read-model leak | สูง | server-scoped queries, immutable auth context, redacted response |
| Connector egress ไป domain แปลก | กลาง-สูง | manifest allowlist, sandbox, rate limit, timeout, circuit breaker |
| Auto-approval ผิดพลาด | สูง | explicit approval/step-up, policy snapshot, kill switch |
| Client ปลอม pipeline status | สูง | Zuri รับ event แล้ว aggregate เอง; client ไม่มี direct state mutation |
| Retention/PII ผิด policy | กลาง-สูง | data classification, minimization, TTL, purge/erasure hook |

### MVP security gates

1. Identity gate — request ทุกอัน resolve เป็น Person + Session + Membership + Business
2. Plugin gate — มี installation/device binding, request integrity, nonce และ idempotency
3. Plan gate — model สร้างได้แค่ proposal; commit ต้องผ่าน Zuri validation
4. Approval gate — external write/side effect ต้องมี approval หรือ policy admission ที่ตรวจสอบได้
5. Secret gate — credential อยู่ใน Zuri secret store/broker ไม่อยู่ใน prompt/log/local file
6. Connector gate — manifest, scope, schema, egress, rate limit และ health check ครบ
7. Audit gate — dry-run, commit, connector call และ pipeline event trace กลับได้
8. Rollback gate — cancel/retry/replay/kill switch และ unknown-outcome reconciliation ผ่านการทดสอบ
9. Data gate — มี classification, minimization, retention และ erasure boundary
10. State gate — plugin ไม่เป็น source of truth ของ Plan/WorkItem/PipelineRun

## 11. Testing Strategy และ acceptance criteria

### 10.1 Test layers

| Test | เป้าหมาย |
|---|---|
| Unit | envelope normalization, scope mapping, redaction, idempotency key, status mapping |
| Contract | ทุก harness ส่ง command semantics เดียวกัน; PlanEnvelope 1.2 และ receipt schema |
| Integration | Zuri auth → preview → commit → pipeline start → event → PM read |
| Security negative | cross-tenant, revoked token, replay, nonce, prompt injection, egress violation |
| Connector contract | manifest, input/output schema, rate limit, secret non-disclosure, health |
| Failure/chaos | worker crash, lease expiry, duplicate event, timeout-after-write, stale version |
| E2E | Codex path และ Claude Code path ให้ result/receipt/PM state semantics เดียวกัน |
| Load | concurrent preview/commit, event ingestion, connector latency and projection lag |

### 10.2 Acceptance criteria

- Request ที่ไม่มี valid Person + Session + Membership + Business ถูก reject และไม่เขียน state
- plan.preview ที่ schema/semantic/target ไม่ผ่านต้องมี zero PM writes
- plan.commit ต้องใช้ draft/hash/approval receipt ที่ตรงกัน
- replay ด้วย idempotency/payload เดิมคืน receipt เดิม; payload ใหม่เกิด conflict
- same plan ไม่สร้าง Project/Workstream/WorkItem ซ้ำ
- plugin restart ไม่ทำให้ task หรือ event ซ้ำ เพราะ server receipt/lease เป็น authority
- revoked session/device/connector หยุดคำขอใหม่ตาม policy
- secret, raw token, raw PII และ raw connector payload ไม่ปรากฏใน prompt/log/preview/tool results
- event ซ้ำหรือมาผิดลำดับไม่ทำให้ aggregate ถอยหลังหรือเพิ่มซ้ำ
- timeout หลัง external write แสดง OUTCOME_UNKNOWN และเข้าสู่ reconciliation
- pipeline ที่ไม่มี PM binding ไม่เขียน WorkItem metrics
- PM roadmap/monitor แสดง state และ progress จาก Zuri projection เดียวกัน
- Codex และ Claude Code ที่ส่ง proposal semantics เดียวกันได้ PlanEnvelope/receipt semantics เดียวกัน

## 12. Monitoring, audit และ observability

| Metric | Initial target/alert | เหตุผล |
|---|---|---|
| Auth deny/revocation rate | alert เมื่อ >3x baseline ต่อเนื่อง 5 นาที | ตรวจ abuse/credential failure |
| Replay/nonce rejection | alert เมื่อ >10 ครั้งใน 5 นาที | ตรวจ replay attack หรือ client bug |
| Plan preview validation latency | server-only p95 <500ms target; tune after baseline | ไม่ปน model/network latency โดยไม่แยก |
| Preview-to-commit conflict rate | dashboard + alert เมื่อ >2x baseline | ตรวจ stale draft หรือ UX mismatch |
| Pipeline queue/claim/lease age | alert เมื่อเกิน lease policy | ตรวจ worker unavailable |
| Connector error/latency/rate-limit | error >5% ต่อเนื่อง 5 นาที; แยกตาม capability | ตรวจ external dependency |
| OUTCOME_UNKNOWN count | ทุก occurrence เป็น high-priority reconciliation | ป้องกัน duplicate side effect |
| Event duplicate/out-of-order rate | dashboard + alert เมื่อ >2x baseline | ตรวจ retry/transport/order bug |
| PM projection lag/drift | p95 lag <10s target; alert เมื่อเกิน 1 นาที | PM ต้องไม่แสดง stale success |
| Redaction/security violation | P0/P1 alert ทุก occurrence | ป้องกัน secret/PII leak |

ทุก record ต้อง trace ด้วย traceId, correlationId, commandId, idempotencyKey,
policySnapshotId, actor/install reference, connector capability, source/as_of และ outcome.
ห้าม log raw token, secret, OTP, hidden connector id, full transcript หรือ unredacted PII

## 13. Rollback และ incident controls

### Rollback triggers

- cross-tenant read/write ถูกตรวจพบ
- secret/token/PII leak
- duplicate external write หรือ unknown outcome ที่ reconciliation ทำไม่ได้
- PM projection drift ที่ทำให้ผู้ใช้เห็นสถานะสำเร็จผิดจริง
- auth bypass, replay bypass หรือ policy snapshot mismatch
- connector egress หลุด allowlist หรือ error rate ทำให้เกิด cascading failure

### Rollback actions

1. ปิด feature flag ของ plan.commit และ pipeline.start; คง capabilities/read-only status
2. revoke installation/device/session หรือ connector account ที่มีปัญหา
3. pause worker/connector capability และหยุด outbox/side-effect path ตาม policy
4. mark affected runs เป็น REVIEW_REQUIRED/OUTCOME_UNKNOWN ตามหลักฐาน ไม่เปลี่ยนเป็น success
5. ใช้ Zuri cancellation/reconciliation/compensating action; ห้ามลบ audit หรือแก้ประวัติย้อนหลัง
6. หากเป็น schema deployment ให้ใช้ reversible migration และตรวจ transaction/backup ก่อน
7. ทำ RCA, เพิ่ม negative test และ rollout ใหม่แบบ canary หลัง security/owner approval

## 14. Implementation Plan

### 13.1 Phase overview

| Phase | ชื่อ | Sprint โดยประมาณ | Deliverable | Gate |
|---|---|---:|---|---|
| P0 | Authority, threat model, contract freeze | S1 | TDD, identity matrix, state/sequence, data classification | Owner + security review |
| P1 | Thin Plugin SDK + one harness adapter | S2 | canonical tools, envelope, redaction, receipt client | no direct DB/connector |
| P2 | Authentication + capability discovery | S3 | PKCE/session boundary, grant/capability validation, local revoke fail-closed | live auth/revocation evidence |
| P3 | Plan preview only | S4 | PlanEnvelope 1.2 builder, dry-run, hash/TTL/conflict UX | zero writes before approval |
| P4 | Plan commit + PM projection | S5-S6 | approval receipt, transactional import, PM IDs/audit | replay/conflict/rollback tests |
| P5 | Read-only connector pipeline | S7-S8 | manifest, lease, worker, evidence/event, monitor | restart/duplicate/stale tests |
| P6 | Controlled write connector | S9+ | step-up, connector idempotency, unknown reconciliation | security/canary approval |
| P7 | Multi-harness + scale | S10+ | Claude Code and other conformance adapters | same semantics across harnesses |

P0–P5 เป็น MVP ที่เสนอ. P6–P7 ไม่ควรเป็นเงื่อนไขของ first useful release และต้องมี
security gate แยก

### 13.2 Requirement complexity estimate

ประมาณการนี้เป็น planning baseline ไม่ใช่ commitment. สูตรใช้
Scope + Technical Risk + Dependencies + AI/ML factor ตาม implementation-plan convention.

| Work package | Scope | Risk | Dependencies | AI/ML | Total | Critical path |
|---|---:|---:|---:|---:|---:|---|
| P0 authority/threat/contract | 5 | 5 | 1 | 0 | 11 | yes |
| P1 plugin SDK + harness adapter | 5 | 2 | 3 | 0 | 10 | yes |
| P2 auth/device/capability | 5 | 5 | 3 | 0 | 13 | yes |
| P3 plan preview/dry-run | 5 | 5 | 3 | 2 | 15 | yes |
| P4 commit/PM projection | 8 | 5 | 3 | 0 | 16 | yes |
| P5 read-only connector pipeline | 8 | 5 | 3 | 0 | 16 | yes |
| P6 controlled write connector | 8 | 5 | 3 | 2 | 18 | later |
| P7 multi-harness/conformance | 5 | 2 | 3 | 0 | 10 | parallel |
| **Total** |  |  |  |  | **109** |  |

ภายใต้ 1 developer ที่ capacity 20 points ต่อ 2-week sprint และ risk buffer 25%:
MVP ควรวางกรอบราว 7–9 sprints ไม่ใช่สัญญาวันส่งมอบ. ต้องปรับใหม่เมื่อยืนยันทีม,
existing auth APIs, connector runtime location และ target date

### 13.3 Critical path

~~~mermaid
graph LR
  P0[Authority and threat model] --> P1[Plugin SDK and adapter]
  P1 --> P2[Auth and capability]
  P2 --> P3[Plan preview]
  P3 --> P4[Commit and PM projection]
  P4 --> P5[Read-only pipeline]
  P5 --> P6[Controlled write connector]
  P4 --> P7[Multi-harness conformance]
~~~

### 13.4 Sprint-level detail

#### S1 — Contract and authority freeze

- ยืนยัน source of truth, identity tuple, trust boundary, state transitions และ PM binding
- ตัดสิน transport: shared CLI/JSON, MCP facade, API หรือ combination ที่ contract เดียวกัน
- ทำ threat model และ data classification
- ส่ง security/owner review

Definition of done: ไม่มี component ใดอ้างสิทธิ์เปลี่ยน state ที่เป็นของ Zuri และมี open
questions/decision owners ครบ

#### S2 — Thin Plugin SDK และ adapter หนึ่งตัว

- canonical tool schema และ redacted response
- trace/idempotency/causation envelope
- auth client interface, receipt polling/streaming interface
- Codex adapter เป็น first conformance target; ยังไม่มี side effect

Definition of done: adapter ส่ง request ได้แต่ไม่ต่อ database/connector โดยตรง

#### S3 — Authentication และ capability discovery

- OIDC/PKCE login, short-lived token, secure installation credential
- server-side scope/tenant resolution
- revocation/kill-switch/health
- capabilities.get, connector.list, connector.health

Definition of done: unauthorized, cross-business, expired/revoked และ replay request ถูกปฏิเสธ

#### S4 — Plan preview only

- natural language proposal → normalized PlanEnvelope 1.2
- schema + semantic + policy + conflict validation
- plan hash/TTL/preview diff
- ห้าม create Project/Workstream/WorkItem/AuditEvent จาก preview

Definition of done: invalid proposal และ privilege escalation ได้ zero writes

#### S5–S6 — Commit และ PM projection

- approval receipt/step-up boundary
- transactional plan commit และ PlanImportReceipt
- return Project/Workstream/Container/Item/audit IDs
- explicit projectId/planId/containerId/workItemId binding
- optimistic concurrency และ idempotent replay/conflict

Definition of done: commit ซ้ำไม่ duplicate, partial failure rollback, PM roadmap เห็น graph
จาก Zuri และ plugin ไม่เก็บ task state

#### S7–S8 — Read-only connector pipeline

- connector manifest/registry และ secret broker boundary
- queue/lease/claim/heartbeat/retry/release
- run/step/event/attempt/sequence/evidence
- event dedupe, reconciliation, PM projection และ monitor

Definition of done: worker restart, duplicate/out-of-order event, stale lease และ PM-unbound
pipeline ไม่ทำให้ state เพี้ยน

#### S9+ — Controlled write connector

- step-up approval และ connector-level idempotency
- timeout-after-write reconciliation
- circuit breaker/rate limit/egress allowlist
- canary + security review

Definition of done: duplicate write, unknown outcome, credential revoke และ kill switch ผ่าน
การทดสอบก่อนเปิด production

### 13.5 Team / capacity assumption

| Role | Baseline | Responsibility |
|---|---:|---|
| Tech lead/platform | 1 | contract, authority, review, integration |
| Backend/PM | 1 | zuri-ai auth/plan/pipeline/projection |
| Plugin/adapter | 0.5–1 | SDK, Codex/Claude conformance, UX |
| Security/identity | 0.5 | threat model, auth, secret, abuse tests |
| QA/SRE | 0.5 | contract, E2E, chaos, monitoring, rollout |

ถ้าเป็น solo build ให้ถือว่า timeline และ capacity เป็น optimistic; P0–P3 ต้องไม่ข้าม
security review เพียงเพื่อให้เร็วขึ้น

## 15. Dependencies และ blockers

| Dependency | Owner | Current evidence | Blocker |
|---|---|---|---|
| PlanEnvelope 1.2 + semantic validation | zuri-ai | local contract มี | ต้องล็อก version และ test boundary |
| PM dry-run/commit transport | zuri-ai | /api/mcp local path มี แต่ auth context ต่างจาก Edge | ต้องเลือก authenticated adapter |
| Person/session/membership auth | zuri-ai | canonical IAM direction มี | ต้องยืนยัน live contract/production evidence |
| Pipeline ledger/projection | zuri-ai | local ledger มี | explicit PM binding/counter projection ยังต้องปิด |
| Edge shared CLI/bridge | zuri-edge-device | มี command boundary/read-only design | ยังไม่มี PM adapter |
| Secret store/token broker | platform | policy ระบุ authority | ต้องเลือก implementation/rotation evidence |
| Connector vendor APIs | connector owner | ยังไม่เลือก connector V1 | ต้องเลือก read-only connector แรก |
| Observability/alerting | platform/SRE | preflight ชี้ว่ายังขาด consolidated observability | ต้องทำก่อน unattended worker |

### 14.1 Current documentation prerequisites

docs/.preflight-report.json ที่มีอยู่ระบุ critical findings เป็น 0 แต่มี warnings เรื่อง
observability, requirement coverage และ document hygiene; docs/.doc-graph.json มี graph
สำหรับเอกสารเดิม. รายงานดังกล่าวเป็น snapshot ก่อน proposal นี้ จึงไม่ถือเป็น approval หรือ
production evidence และต้อง regenerate ผ่าน governed workflow หลังเอกสารได้รับการยอมรับ

## 16. Alternatives considered

| Option | Decision | เหตุผล |
|---|---|---|
| Plugin ต่อ connector โดยตรง | Reject | secret/tenant/state/audit กระจายและ bypass Zuri |
| Native integration แยก Codex/Claude ทุกตัว | Reject | contract drift และ credential surface ซ้ำ |
| Plugin ถือ local PM/pipeline state | Reject | restart/replay และ state divergence |
| Model เป็นผู้เลือก authorization/approval | Reject | model output ไม่ใช่ evidence ของสิทธิ์ |
| Server-only connector execution | Defer/partial | security ง่าย แต่ไม่ตอบ on-premise data ทุกกรณี |
| Hybrid Zuri control plane + leased Edge worker | Proposed | Zuri คุม policy/state; Edge เข้าถึงระบบ local แบบ bounded |
| Streaming ตั้งแต่วันแรก | Defer | polling/SSE ก็พอสำหรับ MVP หาก status durable และ truthful |

## 17. Success metrics

### Product

- ผู้ใช้สร้าง preview จาก Codex/Claude Code ได้โดยไม่ต้องรู้ internal API
- plan semantics เดียวกันใช้ได้กับทุก harness conformance adapter
- preview → approval → commit แยกชัดเจนและตรวจสอบย้อนหลังได้

### Technical

- zero cross-tenant authorization success ใน negative/E2E test
- zero raw secrets/tokens ใน logs, prompt context, preview และ tool results
- duplicate plan/event ไม่เพิ่ม durable rows หรือ aggregate ซ้ำ
- PM projection lag และ event reconciliation มี metric/alert
- Edge restart ไม่ทำให้ duplicate side effect
- unknown outcome ทุกตัวมี reconciliation path

ตัวเลข SLO จริงให้ตั้งหลัง baseline ของ S3–S5; ห้ามประกาศ production readiness จาก local
test เพียงอย่างเดียว

## 18. Open questions ที่ต้องตัดสินก่อน live P2/P3

| # | คำถาม | Decision owner | Status |
|---:|---|---|---|
| 1 | Canonical transport V1 เป็น shared CLI/JSON, MCP, API หรือทั้งสองผ่าน contract เดียวกัน? | Platform | Open |
| 2 | User session ของ plugin จะใช้ Zuri IAM contract ใด และ production endpoint ใด? | Zuri owner | Open |
| 3 | Device-to-PM adapter จะใช้ credential/scope แบบใดเมื่อไม่มี interactive user session? | Security + Zuri | Open |
| 4 | Connector V1 ตัวแรกคืออะไร และ execute ที่ Zuri หรือ Edge? | Product | Open |
| 5 | Auto-execution/auto-delivery policy อนุญาต capability ใดบ้าง? | Owner + Security | Open |
| 6 | connector.authorize จะทำผ่าน admin UI/consent page ใด ไม่ใช่ chat command อย่างไร? | Platform | Open |
| 7 | Pipeline event transport ใช้ queue, webhook, polling หรือ SSE ใน MVP? | Platform | Open |
| 8 | Data retention/erasure boundary ของ evidence และ connector payload เท่าใด? | Security/Legal | Open |
| 9 | PM projection จะ recompute counter ใน transaction เดียวกับ event receipt อย่างไร? | zuri-ai | Open |

## 19. Approval และ next step

เอกสารนี้อยู่ที่ **Beta สำหรับ P0/P1 และ P2 local boundary**. การอนุมัติ scope นี้ไม่เท่ากับ
การเปิด live authentication, production connector write หรือ PM mutation และไม่อนุญาตให้
สร้าง database row โดยอัตโนมัติ

P2 รายละเอียดอยู่ใน [docs/ZURI-PLUGIN-PLATFORM-P2-AUTH-DESIGN.md](ZURI-PLUGIN-PLATFORM-P2-AUTH-DESIGN.md).
การ implement ที่ทำได้ใน scope นี้คือ in-memory PKCE transaction, injectable transport,
server-grant/capability validation และ local fail-closed revoke. Live adapter ยังต้องรอ
canonical Zuri device/plugin auth contract และ evidence แยกต่างหาก

## 20. Reviewer synthesis

มีการขอ review สองมุมมอง:

- **Agent-runtime/UX lens:** gpt-5.6-sol — เสนอ thin harness plugin, canonical tools,
  plan/execute separation, lease/event/idempotency และ truthful status UX
- **Secure-platform lens:** gpt-5.5 ใช้เป็น proxy เนื่องจาก runtime นี้ไม่มีโมเดลชื่อ
  Fable 5 — เน้น identity tuple, PKCE/device binding, secret broker, connector sandbox,
  threat model และ security gates

ข้อสรุปร่วมคือใช้ runtime lens เป็นรูปแบบ product/protocol และใช้ security lens เป็น
blocking gate. ไม่มีการอ้างว่า gpt-5.5 เป็น Fable 5 จริง

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-23 | candidate | Initial TDD, layer, identity/security boundary, pipeline and phase plan | — | ATHER |
| 0.2.0b | 2026-08-23 | beta | Records approved P0/P1 implementation and P2 local authentication boundary; live adapter remains gated | — | ATHER |
