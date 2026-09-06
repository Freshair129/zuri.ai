---
version: "0.3.0b"
created_at: "2026-08-23T00:00:00+07:00, ATHER"
last_update: "2026-08-23T03:24:00+07:00, ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "Zuri plugin protocol, harness integration, plan intake, connector execution, and PM state boundary"
  doc_type: "product-and-technical-specification"
  state_owner: "zuri-ai"
  approval: "P0-P1 contract-only + P2 local auth boundary approved"
---

# Zuri Plugin Platform Specification

| Field | Value |
|---|---|
| Specification ID | ZPP-SPEC-001 |
| Version | 0.2.0b |
| Status | Beta — P0/P1 contract-only approved |
| Product owner | Boss — confirmation required |
| Technical owner | ATHER — proposal author |
| Risk class | HIGH |
| State authority | zuri-ai |
| Companion roadmap | docs/ZURI-PLUGIN-PLATFORM-TDD-IMPLEMENTATION-PLAN.md |
| Approval gate | APPROVE ZURI-PLUGIN-PLATFORM-SPEC-001 |

## 1. Purpose

เอกสารนี้กำหนด contract และ behavior ของ Zuri Plugin Platform สำหรับเชื่อม Codex,
Claude Code และ harness อื่นเข้ากับ Zuri AI Platform ให้ผู้ใช้คุยด้วยภาษาธรรมชาติได้
โดยไม่ทำให้ harness หรือ plugin กลายเป็นผู้ถือสิทธิ์, secret หรือ task state

Specification นี้เป็น source สำหรับการ review ก่อน implementation. ยังไม่อนุญาตให้สร้าง
endpoint จริง, schema migration, credential, PM row หรือ pipeline run

## 2. Context และปัญหา

ผู้ใช้สามารถสนทนาผ่าน harness ได้หลายตัว แต่ต้องการให้การสร้างแผน, การอนุมัติ,
การเรียก connector และการแสดงผลใน Project Manager มี semantics เดียวกัน ปัจจุบัน
Edge มี shared CLI/bridge boundary และ zuri-ai มี PlanEnvelope 1.2, PM graph และ
pipeline ledger ระดับ local contract แล้ว แต่ยังต้องกำหนด plugin protocol และ
authenticated Edge-to-PM boundary ให้เป็นสเปกเดียว

ปัญหาหลักคือ natural-language request ไม่ใช่ authorization, model output ไม่ใช่
durable state และ external API timeout ไม่ได้แปลว่าไม่มี side effect หากปล่อยให้
plugin ต่อ connector หรือฐานข้อมูลโดยตรง จะเกิดความเสี่ยงเรื่อง cross-tenant access,
credential leakage, duplicate writes และ state drift

## 3. เป้าหมายและขอบเขต

### 3.1 In scope

- Harness-neutral adapter contract สำหรับ Codex, Claude Code และ harness อื่น
- Zuri Plugin SDK boundary สำหรับ auth, envelope, redaction, idempotency และ status
- Natural-language intent → structured plan proposal
- PlanEnvelope 1.2 validation, dry-run, conflict preview และ approval boundary
- Transactional plan commit เป็น Project/Workstream/WorkContainer/WorkItem
- Pipeline start ที่แยกจาก plan commit
- Connector manifest, capability, schema, data classification และ egress policy
- Leased worker, evidence/event receipt, retry, reconciliation และ PM projection
- Authentication, tenant authorization, secret handling, audit, monitoring และ rollback rules

### 3.2 Out of scope

- Plugin ต่อ Zuri PostgreSQL โดยตรง
- Plugin รับ connector secret หรือ LINE/OA credential
- Model อนุมัติ policy, tenant scope หรือ side effect เอง
- Local PM database, local scheduler หรือ local source of truth
- Universal connector runner และ arbitrary shell/SQL execution
- เปิด connector write หรือ automatic execution โดยไม่มี policy/approval ที่ชัดเจน
- เปลี่ยน canonical PM hierarchy หรือสร้าง ExecutionPlan table ใหม่

## 4. Normative terms

คำว่า MUST คือข้อบังคับ, MUST NOT คือข้อห้าม, SHOULD คือข้อแนะนำที่ต้องมีเหตุผล
หากไม่ทำ และ MAY คือความสามารถที่ทำได้โดยไม่ทำลาย contract

## 5. Actors และ authority

| Actor | ทำได้ | ห้ามทำ |
|---|---|---|
| Human user | ให้ intent, ดู preview, อนุมัติ, ยกเลิก | ใช้ข้อความสนทนาแทน approval receipt |
| Harness model | แปลงข้อความเป็น proposal และแสดงผล | ตัดสินสิทธิ์, เปลี่ยน policy, ยืนยัน success |
| Harness adapter | เรียก canonical tools และ render result | เขียน PM state หรือถือ connector secret |
| Zuri Plugin SDK | serialize, validate เบื้องต้น, redact, retry ตาม contract | bypass server policy |
| Zuri identity/gateway | authenticate, resolve principal, authorize request | เชื่อ client-supplied tenant/role |
| Zuri plan/policy service | validate, dry-run, approval, commit | ให้ invalid plan เขียน state |
| Zuri orchestrator | สร้าง run/step/lease, deduplicate event, aggregate | รับ client status เป็น source truth |
| Edge/connector worker | claim lease, execute bounded capability, submit evidence | ประกาศ PM success หรือยิง egress นอก allowlist |
| Connector | ตอบตาม schema ที่ประกาศ | ส่ง instruction ให้ model หรือขยาย scope เอง |
| PM read model | แสดง state/progress จาก Zuri projection | อ่าน state copy จาก plugin |

### 5.1 State ownership rule

zuri-ai MUST เป็น durable authority ของ:

- Person, Session, Membership, tenant/business scope และ policy snapshot
- Plan draft, PlanEnvelope import, Project graph และ audit receipt
- WorkItem status/version/metrics
- PipelineRun, PipelineStep, lease, event, reconciliation และ delivery receipt

Plugin MAY เก็บ encrypted installation identity, bounded transient cache และ receipt ล่าสุด
ที่สร้างใหม่จาก Zuri ได้ทั้งหมด. การลบ local cache MUST ไม่ทำให้แผนหรืองานสูญหาย

## 6. Architecture boundary

~~~mermaid
flowchart LR
  U[User] --> H[Codex / Claude Code / Harness]
  H --> A[Harness Adapter]
  A --> S[Zuri Plugin SDK]
  S --> G[Zuri Gateway]
  G --> I[Identity and Authorization]
  G --> P[Plan and Policy Service]
  P --> O[Pipeline Orchestrator]
  O --> D[(Zuri Durable State)]
  O --> W[Leased Worker]
  W --> K[Connector Sandbox]
  K --> X[External Connector]
  K --> E[Evidence and Event Receipt]
  E --> O
  D --> M[PM Read Model]
  M --> U
  V[Secret Broker and Registry] --> K
~~~

ระบบ MUST รักษา trust boundary ตามลำดับ:

1. user text, model output และ connector payload เป็น untrusted data
2. plugin/adapter เป็น semi-trusted client
3. Zuri gateway, policy, state และ receipt เป็น trusted authority
4. external connector เป็น boundary ที่ต้อง validate และ isolate

## 7. Identity และ authentication specification

### ZPP-FR-001 — Identity tuple

ทุก privileged request MUST resolve เป็น identity tuple ฝั่ง Zuri อย่างน้อย:

~~~json
{
  "personId": "person_...",
  "sessionId": "session_...",
  "tenantId": "server-derived",
  "businessId": "server-derived",
  "membershipId": "membership_...",
  "roleBindings": ["..."],
  "harnessType": "codex|claude_code|other",
  "pluginInstallationId": "install_...",
  "deviceBindingId": "device_...",
  "connectorAccountId": "connector_...",
  "executionRunId": "run_...",
  "traceId": "trace_...",
  "policySnapshotId": "policy_..."
}
~~~

Codex account, Claude account, Zuri Person, plugin installation, device และ connector
account MUST เป็นคนละ identity. External provider ID MUST NOT ถูกใช้เป็น authorization
identity โดยตรง

### ZPP-FR-002 — Interactive authentication

Plugin MUST รองรับ interactive authentication ที่ผูกกับ Zuri session โดยแนวทางตั้งต้นคือ
OIDC/OAuth 2.1 Authorization Code + PKCE. Access token SHOULD มีอายุสั้น และ refresh
credential MUST อยู่ใน OS credential store, Docker secret หรือ secure store ที่อนุมัติ

Plugin MUST NOT มี static client secret หากทำงานเป็น public client และ MUST NOT เก็บ
refresh credential ใน plaintext file

### ZPP-SEC-001 — Installation/device binding

แต่ละ installation MUST มี installation reference และ device-bound key หรือ equivalent
ที่ Zuri revoke ได้. Request ที่มี timestamp, nonce, trace และ idempotency key MUST
สามารถป้องกัน replay ตาม transport ที่เลือก

### ZPP-SEC-002 — Server-derived scope

tenantId, businessId, membership และ role ที่อยู่ใน request body เป็นเพียง requested context
ห้ามใช้เป็น authority. Zuri MUST resolve scope จาก authenticated session/device principal
และ MUST deny cross-tenant/business access โดยไม่เปิดเผย resource existence

## 8. Functional requirements

### ZPP-FR-003 — Harness-neutral command semantics

Codex, Claude Code และ harness อื่น MUST เรียก command semantics เดียวกัน. ความแตกต่าง
ของ UI หรือ tool registration MAY อยู่ใน adapter แต่ห้ามเปลี่ยนความหมายของ status,
approval, idempotency หรือ receipt

### ZPP-FR-004 — Canonical capabilities

ระบบ MUST มี read-only capability discovery อย่างน้อย:

- zuri.capabilities.get
- zuri.connector.list
- zuri.connector.health

ผลลัพธ์ MUST แสดงเฉพาะ capability ที่ principal มีสิทธิ์ใช้ และ MUST ไม่เปิด raw secret

### ZPP-FR-005 — Plan proposal

เมื่อผู้ใช้คุยเรื่องการสร้างแผน model/adapter MUST สร้าง structured proposal ที่มี:

- intent และ requested outcome
- requested target reference
- proposed execution mode/contract
- proposed containers/items/dependencies
- requested connector capabilities
- source conversation reference แบบลดทอน ไม่ใช่ raw transcript ทั้งหมด

Proposal ยังไม่ใช่ durable plan และยังไม่ใช่ authorization

### ZPP-FR-006 — Plan preview

zuri.plan.preview MUST:

1. ตรวจ authentication, scope และ capability ก่อน parse/commit
2. validate PlanEnvelope 1.2 ทั้ง schema และ semantic rules
3. ตรวจ duplicate, dependency, target conflict และ policy conflict
4. คืน planDraftId, normalized planHash, expiresAt, diff, conflicts, warnings และ
   required approval scope
5. ไม่สร้างหรือแก้ Project, Workstream, WorkContainer, WorkItem, AuditEvent หรือ
   pipeline row ที่เป็น durable mutation

Invalid, unauthorized หรือ expired proposal MUST จบด้วย zero writes

### ZPP-FR-007 — Plan commit

zuri.plan.commit MUST แยกจาก preview และต้องรับ:

- planDraftId
- planHash เดิม
- approvalReceiptId หรือ policy admission reference
- idempotencyKey
- trace/correlation context

Zuri MUST ตรวจ hash, TTL, actor, scope, policy snapshot และ approval อีกครั้งก่อน commit
และ MUST commit PM graph, import receipt และ audit ใน transaction เดียวกัน

### ZPP-FR-008 — Pipeline start separation

zuri.pipeline.start MUST เป็น command แยกจาก zuri.plan.commit. การ commit แผน MUST NOT
เริ่ม external side effect โดยอัตโนมัติ เว้นแต่มี policy ที่อนุมัติ explicit และ scope
ของ policy ครอบคลุม capability นั้น

Pipeline start ต้องอ้างอิง commit receipt, planHash และ explicit PM binding ที่ Zuri ออกให้

### ZPP-FR-009 — Connector registry

ทุก connector MUST มี versioned manifest:

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

Manifest MUST ระบุ capability, auth type, input/output schema, data class, egress,
rate limit และ idempotency support ก่อน connector ถูกใช้งาน

### ZPP-FR-010 — Leased execution

Worker MUST claim งานด้วย lease ที่ Zuri ออกให้ และ MUST ตรวจ:

- run/step identity
- tenant/business binding
- connector capability/version
- policy snapshot
- lease owner และ expiry

เมื่อ worker crash หรือ lease หมดอายุ Zuri MUST เป็นผู้ requeue/mark stale ตาม state
ไม่ใช้ local replay เป็น source of truth

### ZPP-FR-011 — Evidence and event receipt

ทุก connector invocation MUST ส่ง evidence/event receipt ที่มี:

~~~json
{
  "eventId": "evt_...",
  "executionRunId": "run_...",
  "executionStepId": "step_...",
  "attemptId": "attempt_...",
  "sequence": 7,
  "eventType": "EVIDENCE_READY",
  "correlationId": "corr_...",
  "idempotencyKey": "idem_...",
  "source": "connector://example",
  "asOf": "2026-08-23T00:00:00Z",
  "sensitivity": "business-confidential",
  "artifactHash": "sha256:...",
  "payloadRef": "evidence://..."
}
~~~

Raw token, raw secret และ unredacted PII MUST NOT อยู่ใน event payload หรือ log

### ZPP-FR-012 — PM projection

Zuri MUST เป็นผู้ตรวจและเขียน projection จาก accepted reconciliation ไปยัง WorkItem.metrics
เมื่อมี explicit:

- projectId
- planId ซึ่งเท่ากับ Workstream identity
- containerId เมื่อจำเป็น
- workItemId
- executionRunId/executionStepId

Pipeline ที่ไม่มี binding MUST NOT แก้ WorkItem ใด ๆ. PipelineRun เป็น evidence truth;
WorkItem.metrics เป็น read projection เท่านั้น

### ZPP-FR-013 — Status and cancellation

zuri.pipeline.get MUST คืน status, receipt, warnings, trace และ safe next action โดยไม่
เปิด secret, hidden ID, raw transcript หรือ PII

zuri.pipeline.cancel MUST เป็น governed state transition และต้องคืน cancellation receipt.
Plugin MUST NOT เปลี่ยน status โดยการเขียน local state

## 9. Canonical command contract

ทุก command MUST มี envelope กลาง:

~~~json
{
  "schemaVersion": "1.0",
  "commandId": "cmd_...",
  "idempotencyKey": "idem_...",
  "trace": {
    "correlationId": "corr_...",
    "causationId": "msg_..."
  },
  "commandType": "PLAN_PREVIEW",
  "harness": {
    "type": "codex",
    "version": "1.0",
    "installationId": "install_..."
  },
  "requestedTarget": {
    "projectRef": "requested-only"
  },
  "payload": {},
  "clientContext": {
    "locale": "th-TH",
    "timezone": "Asia/Bangkok"
  }
}
~~~

Zuri MUST เติม trusted actor, tenant/business, membership, policy snapshot และ scope
จาก server-side context. Envelope MUST NOT ทำให้ client กำหนด authority fields ได้

### 9.1 Preview response

~~~json
{
  "receiptId": "receipt_...",
  "status": "PREVIEW_READY",
  "traceId": "trace_...",
  "planDraftId": "draft_...",
  "planHash": "sha256:...",
  "expiresAt": "2026-08-23T01:00:00Z",
  "diff": {
    "projects": 1,
    "workstreams": 1,
    "containers": 2,
    "items": 8,
    "conflicts": 0
  },
  "requiredApproval": {
    "scope": ["plan:commit"],
    "sideEffects": []
  },
  "warnings": []
}
~~~

### 9.2 Commit response

~~~json
{
  "receiptId": "receipt_...",
  "status": "COMMITTED",
  "traceId": "trace_...",
  "auditEventId": "audit_...",
  "projectId": "project_...",
  "planId": "workstream_...",
  "containerIds": ["container_..."],
  "workItemIds": ["item_..."],
  "importId": "import_...",
  "nextAction": "PIPELINE_START_REQUIRES_SEPARATE_APPROVAL"
}
~~~

## 10. State machines

### 10.1 Plan lifecycle

~~~text
PROPOSED
  -> VALIDATING
  -> DRY_RUN_VALID | CONFLICT | REJECTED
  -> AWAITING_APPROVAL
  -> COMMITTED | EXPIRED
~~~

Rules:

- draft/hash/TTL ต้องผูกกัน
- conflict และ rejected ต้องไม่มี mutation
- replay ด้วย idempotency/payload เดิมคืน receipt เดิม
- idempotency เดิมกับ payload ใหม่ต้องเป็น conflict
- committed plan ห้ามเปิดใหม่ด้วย local plugin state

### 10.2 Pipeline lifecycle

ใช้ lifecycle ที่มีอยู่ใน Zuri/Edge contract:

~~~text
ADMITTED -> QUEUED -> CLAIMED -> EVIDENCE_READY
  -> REVIEW_REQUIRED | DELIVERY_PENDING
  -> DELIVERED | FAILED | CANCELLED | EXPIRED
~~~

OUTCOME_UNKNOWN เป็น execution result สำหรับ external write ที่ไม่ทราบผล ไม่ใช่หลักฐาน
ว่า failed และไม่อนุญาตให้ retry อัตโนมัติโดยไม่มี reconciliation

### 10.3 WorkItem state

WorkItem MUST ใช้ WORK_STATUSES ของ Zuri เดิม. Edge/plugin MUST NOT เพิ่ม status เฉพาะตัว
และ remote update ต้องผ่าน Zuri service พร้อม expectedVersion หรือ equivalent concurrency
guard, idempotency key และ audit receipt

## 11. Connector invocation policy

Invocation MUST ผ่านขั้นตอน:

~~~text
request
 -> capability authorization
 -> consent/policy check
 -> secret resolution
 -> sandbox and egress check
 -> timeout/rate limit/circuit breaker
 -> input/output schema validation
 -> redaction and minimization
 -> evidence/event receipt
~~~

Connector response MUST ถูกถือเป็น untrusted data. ข้อความใน response ห้ามเปลี่ยน
system instruction, policy, scope หรือ tool allowlist

Write connector MUST เพิ่ม:

- explicit approval หรือ approved auto-execution policy
- connector-level idempotency key
- timeout-after-write reconciliation
- compensation/cancellation strategy
- audit ของ request, response outcome และ retry decision

## 12. Risks and Security Considerations

Risk score = Probability (1–5) × Impact (1–5). คะแนน 15 ขึ้นไปเป็น release blocker
จนกว่าจะมี mitigation และ test evidence.

| ID | Risk | Probability | Impact | Score | Required control |
|---|---|---:|---:|---:|---|
| R1 | Cross-tenant/business authorization bypass | 3 | 5 | 15 | Server-derived scope, safe deny, negative tests |
| R2 | Secret/token/PII leakage into model or logs | 3 | 5 | 15 | Secret broker, redaction, no raw payload in context |
| R3 | Duplicate external write after timeout | 4 | 5 | 20 | Connector idempotency, OUTCOME_UNKNOWN, reconciliation |
| R4 | Prompt injection escalates tool/capability | 4 | 4 | 16 | Treat connector data as untrusted, allowlist, policy gate |
| R5 | PM projection and pipeline evidence drift | 3 | 4 | 12 | Explicit binding, receipt, ordering and atomic projection |
| R6 | Connector outage or rate limit causes cascade | 3 | 4 | 12 | Timeout, circuit breaker, bounded retry, unavailable state |
| R7 | Scope expands into universal autonomous execution | 4 | 3 | 12 | Phase gates and separate write approval |

### Security requirements

| ID | Requirement |
|---|---|
| ZPP-SEC-003 | ใช้ TLS สำหรับทุก network boundary และห้ามส่ง credential ใน query string |
| ZPP-SEC-004 | Secret อยู่ใน Zuri secret broker/store; ไม่เข้า prompt, local plaintext, log หรือ receipt |
| ZPP-SEC-005 | ทุก request validate schema, size, scope, timestamp, nonce และ idempotency |
| ZPP-SEC-006 | Data จาก connector เป็น untrusted; ต้องแยก instruction/data และมี tool allowlist |
| ZPP-SEC-007 | PII/business-confidential ต้องมี data class, minimization, retention และ erasure boundary |
| ZPP-SEC-008 | Audit ต้อง trace actor, install, scope, policy, command, run, connector และ outcome |
| ZPP-SEC-009 | Zuri ต้อง revoke session, installation, device และ connector account ได้ |
| ZPP-SEC-010 | External write timeout ต้องเป็น OUTCOME_UNKNOWN และเข้าสู่ reconciliation |
| ZPP-SEC-011 | Cross-tenant/business request ต้อง deny และไม่เปิดเผย resource existence |
| ZPP-SEC-012 | Plugin ห้ามต่อ Zuri PostgreSQL, LINE API หรือ arbitrary shell/SQL |

## 13. Error contract

| Error class | Client behavior | Durable mutation |
|---|---|---|
| AUTH_REQUIRED | เปิด login/reauth | none |
| AUTH_REVOKED | หยุด retry และแจ้ง revoke | none/new request denied |
| SCOPE_DENIED | แสดง unavailable/denied แบบ redacted | zero writes |
| VALIDATION_FAILED | แสดง field-level safe errors | zero writes |
| CONFLICT | ขอให้ refresh preview | zero writes |
| IDEMPOTENCY_REPLAY | คืน receipt เดิม | unchanged |
| IDEMPOTENCY_CONFLICT | หยุดและแจ้ง payload conflict | zero new writes |
| LEASE_EXPIRED | ไม่ replay เอง; query Zuri | Zuri decides requeue |
| CONNECTOR_UNAVAILABLE | bounded retry ตาม policy | no assumed success |
| OUTCOME_UNKNOWN | เข้า reconciliation; ห้าม retry blind | pending investigation |
| PROJECTION_UNAVAILABLE | แสดง PM unavailable/stale | evidence remains source truth |

Error response MUST มี safe error code, trace/correlation ID, retryability และ next action
เท่าที่เปิดเผยได้ และ MUST ไม่มี secret, raw SQL, raw transcript หรือ PII

## 14. Non-functional requirements

| ID | Requirement | Verification |
|---|---|---|
| ZPP-NFR-001 | Plugin restart ต้อง recover จาก Zuri receipt/lease ได้ | crash/restart E2E |
| ZPP-NFR-002 | ทุก mutation เป็น idempotent และ replay-safe | contract + duplicate tests |
| ZPP-NFR-003 | ทุก harness มี command semantics เดียวกัน | conformance suite |
| ZPP-NFR-004 | Read-only preview path ต้องไม่มี PM mutation | database/audit zero-write test |
| ZPP-NFR-005 | Status ต้อง truthful แยก pending, unavailable, failed, delivered, unknown | status contract tests |
| ZPP-NFR-006 | Response และ logs ต้อง redacted ตาม sensitivity class | redaction/security tests |
| ZPP-NFR-007 | Pipeline event ต้อง trace ได้ตั้งแต่ command ถึง PM projection | lineage test |
| ZPP-NFR-008 | Connector execution ต้องมี bounded timeout, retry และ rate limit | fault/load tests |
| ZPP-NFR-009 | PM projection ห้ามทำให้ evidence truth ถอยหลัง | ordering/reconciliation tests |

Initial performance targets สำหรับ validation เท่านั้น:

- server-side plan validation p95 ต่ำกว่า 500 ms โดยไม่รวม model/network latency
- PM projection lag p95 ต่ำกว่า 10 วินาทีใน MVP
- event duplicate/out-of-order ต้องไม่เพิ่ม aggregate หรือทำให้ status ถอยหลัง
- connector timeout/rate limit ต้องเป็น per-connector policy ไม่ใช้ค่ากลางแบบเดาสุ่ม

## 15. Acceptance test matrix

| ID | Scenario | Expected result |
|---|---|---|
| ZPP-AC-001 | valid identity tuple | request admitted with server-derived scope |
| ZPP-AC-002 | missing/expired/revoked session | denied; zero writes |
| ZPP-AC-003 | cross-business target | safe deny/not-found; zero writes |
| ZPP-AC-004 | valid preview | draft/hash/TTL/diff returned; zero PM mutation |
| ZPP-AC-005 | invalid mode/strategy/dependency | validation reject; zero writes |
| ZPP-AC-006 | commit with changed hash | conflict; no graph mutation |
| ZPP-AC-007 | same idempotency and payload | original receipt returned |
| ZPP-AC-008 | same idempotency and changed payload | conflict; no duplicate graph |
| ZPP-AC-009 | commit transaction failure | no partial PM graph |
| ZPP-AC-010 | pipeline start without commit receipt | denied |
| ZPP-AC-011 | duplicate/out-of-order event | deduplicated; aggregate unchanged/backward-safe |
| ZPP-AC-012 | worker crash or lease expiry | Zuri requeue/stale handling; no local replay |
| ZPP-AC-013 | connector data prompt injection | data treated as untrusted; no privilege escalation |
| ZPP-AC-014 | secret in connector response | redacted; security event; no prompt/log leak |
| ZPP-AC-015 | timeout after external write | OUTCOME_UNKNOWN; reconciliation required |
| ZPP-AC-016 | pipeline without PM binding | no WorkItem projection |
| ZPP-AC-017 | revoked connector account | new invocation denied; affected run governed |
| ZPP-AC-018 | Codex vs Claude same proposal | equivalent contract semantics and receipt behavior |

## 16. Observability และ audit

ระบบ MUST วัดและ alert อย่างน้อย:

- authentication deny/revoke และ replay/nonce rejection
- preview validation latency และ preview-to-commit conflict
- queue/claim/lease age และ worker heartbeat
- connector latency, error, rate-limit และ circuit-breaker state
- OUTCOME_UNKNOWN และ reconciliation age
- duplicate/out-of-order event
- PM projection lag/drift
- redaction/security violation

ทุก log/audit record MUST มี traceId, correlationId, commandId, idempotencyKey,
policySnapshotId, actor/install reference, source/asOf และ outcome เท่าที่ sensitivity
อนุญาต. ห้าม log raw token, secret, OTP, raw transcript หรือ unredacted PII

## 17. Rollback และ release gates

### Release gates

ก่อน P1 ต้องผ่าน:

- identity/authority matrix review
- threat model และ data classification review
- canonical command/PlanEnvelope contract review
- decision เรื่อง authenticated transport

ก่อน P4 ต้องผ่าน:

- zero-write preview test
- approval/hash/TTL test
- replay/conflict/transaction rollback test
- PM graph และ audit trace test

ก่อนเปิด write connector ต้องผ่าน:

- connector manifest/egress/secret review
- duplicate write และ timeout-after-write reconciliation
- revoke/kill switch/circuit breaker
- canary และ security approval

### Rollback actions

1. ปิด plan.commit และ pipeline.start ด้วย feature gate
2. revoke installation/device/session/connector account ที่ได้รับผลกระทบ
3. pause worker หรือ capability ที่มีปัญหา
4. เปลี่ยน run เป็น REVIEW_REQUIRED หรือ OUTCOME_UNKNOWN ตามหลักฐาน
5. ใช้ Zuri cancellation/reconciliation/compensating action; ห้ามลบ audit
6. ทำ RCA และเพิ่ม regression/negative test ก่อนเปิดใหม่

## 18. Dependencies และ open questions

| Dependency/question | Owner | Status |
|---|---|---|
| Canonical Zuri IAM/session contract | zuri-ai | ตรวจแล้ว: browser session/MCP session; device/plugin boundary ยัง open |
| Edge-to-PM authenticated adapter | zuri-ai + Edge | P2 local boundary มีแล้ว; live adapter open |
| Transport: shared CLI/JSON, MCP, API หรือ combination | Platform | Open |
| Connector V1 และ execution location | Product | Open |
| Secret broker implementation/rotation | Platform/Security | Open |
| Auto-execution policy | Owner/Security | Open |
| Pipeline projection counter transaction | zuri-ai PM | Open |
| Evidence retention/erasure | Security/Legal | Open |

## 19. Traceability

| Spec group | Source/authority |
|---|---|
| State ownership and permissions | AGENTS.md, docs/AGENT-RUNTIME-SPEC.md |
| Shared harness boundary | docs/ARCHITECTURE.md, docs/COMMAND-AGENT-SPEC.md |
| PlanEnvelope/PM hierarchy | canonical zuri-ai contracts and docs/ZURI-PM-EXECUTION-PIPELINE-PLAN.md |
| Pipeline lifecycle | AGENTS.md and zuri-ai pipeline ledger contract |
| Security/credential boundary | AGENTS.md permission matrix and credential topology |

## 20. Implementation boundary and Approval

Specification นี้กำหนด contract ก่อน code. Implementation จะต้องเดินตามลำดับนี้:

| Phase | Allowed output | Gate |
|---|---|---|
| P0 | authority matrix, threat model, contract decision record | owner/security approval |
| P1 | plugin SDK/adapter contract tests แบบไม่มี side effect | identity and conformance approval |
| P2 | authentication/capability implementation | live auth and revocation evidence |
| P3 | preview/dry-run implementation | zero-write evidence |
| P4 | commit/PM projection implementation | replay, rollback and audit evidence |
| P5 | read-only connector pipeline | lease, event, reconciliation and PM proof |

P2 local boundary ถูกแยกออกมาใน [docs/ZURI-PLUGIN-PLATFORM-P2-AUTH-DESIGN.md](ZURI-PLUGIN-PLATFORM-P2-AUTH-DESIGN.md)
และ implement ได้เฉพาะ PKCE transaction, injectable auth transport, grant/capability validation
และ local fail-closed revoke. สิ่งนี้ยังไม่ถือเป็น live authentication หรือ live revocation evidence.

ห้ามข้าม P0 ไปทำ production connector หรือ PM mutation. รายละเอียด sprint และ capacity
อยู่ใน companion roadmap ไม่ใช่ authority ที่จะ override requirements ในเอกสารนี้

### Approval

สถานะเอกสารเป็น **Beta สำหรับ P0/P1 contract และ P2 local auth boundary**. การ approve spec นี้หมายถึงอนุมัติ contract และ
requirements สำหรับ P0/P1 และ local P2 boundary ตาม gate เท่านั้น ไม่ได้อนุมัติ live authentication,
production deployment, connector write หรือ automatic delivery

Approval record:

- Decision: APPROVE ZURI-PLUGIN-PLATFORM-SPEC-001
- Scope: P0 authority/contract artifacts และ P1 transport-neutral SDK/adapter contract tests
- Additional scope: P2 local auth/capability boundary ตาม `ZURI-PLUGIN-PLATFORM-P2-AUTH-DESIGN.md`
- Explicitly not approved: P2 live authentication, PM mutation, connector secrets/write และ production deployment

โปรด review และตอบ:

~~~text
APPROVE ZURI-PLUGIN-PLATFORM-SPEC-001
~~~

การ implement ต่อจากนี้ต้อง trace กลับมายัง ZPP-FR, ZPP-SEC, ZPP-NFR และ ZPP-AC โดยยังต้อง
ขอ approval แยกสำหรับ live auth transport และ phase ที่มี mutation

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-23 | candidate | Initial protocol, identity, security, pipeline, PM and acceptance specification | — | ATHER |
| 0.2.0b | 2026-08-23 | beta | User-approved P0/P1 contract-only scope; implementation gate recorded | — | ATHER |
| 0.3.0b | 2026-08-23 | beta | Adds canonical auth audit and approved P2 local fail-closed boundary; live auth remains gated | — | ATHER |
