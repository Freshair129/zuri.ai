---
domain: integration
feature: FR-125
module: integration
source: v2-native
version: "0.3.0b"
created_at: "2026-08-20T10:41:14+07:00,ATHER"
last_update: "2026-10-18T11:57:00+07:00,Codex"
status: "candidate"
superseded_by: null
---

# FR-125 — FlowAccount MCP connector with read-only evidence

> Current scope is the 2026-10-18 MCP amendment below. The REST/OpenAPI details
> in the preserved historical proposal are dated 2026-08-20 and are not MCP
> capability facts, prerequisites, or implementation requirements.

> **Id note.** Drafted as `FR-094` on 2026-08-20. That number was claimed on main
> by the canonical IAM principal before this branch was re-applied, so this
> requirement carries **FR-125** and its decision carries **ADR-053**. Ids are
> keys (AGENTS.md §18) — the earlier declaration keeps its meaning.

## Current MCP amendment — 2026-10-18

On direct human instruction, this feature supports FlowAccount's existing
official hosted AI Connector (MCP). FlowAccount's [Claude connector guide](https://flowaccount.com/help-center/category/ai-connector-mcp/flowaccount-connector-in-claude)
and [Grok connector guide](https://flowaccount.com/help-center/category/ai-connector-mcp/flowaccount-connector-in-grok)
document `https://mcp.flowaccount.com/mcp`, OAuth 2.0 login, selection of one
authorized company, and disconnect/reconnect to change that company. FlowAccount
states that the connector can read and create documents, but cannot edit or
delete existing documents. Its [2026-08-24 overview](https://flowaccount.com/blog/how-to-use-claude-for-accounting-work/)
reports more than 30 tools, including reads of accounting reports. These
provider statements establish capability, not a Zuri permission grant.

The official public pages do not specify the MCP transport/version, OAuth client
registration and scopes, tool names and schemas, or result identity and
pagination contracts. These remain unknown until verified through an authorized
provider contract. Do not invent endpoint methods, scope names, tool names, or
schemas from REST documentation or third-party MCP servers.

### Current contract

An authorized Zuri user connects through FlowAccount's official OAuth flow and
selects one FlowAccount company for one trusted Zuri Business. Zuri stores only
an opaque reference to OAuth credentials in the existing secret manager. The
server resolves trusted user and Business authority before discovery or a tool
call. It discovers the actual provider tool catalog, then exposes only reviewed,
explicitly allow-listed read capabilities. The allow-list is enforced by Zuri;
MCP annotations such as `readOnlyHint` are advisory and never grant authority.
Unknown, create, update, delete, status, payment, and other mutating tools are
denied even when the provider advertises them.

An allowed read is recorded through the existing FR-081 raw-evidence path only
after the tool schema, company binding, lane, and stable result identity have a
reviewed mapping to `zIngestionEnvelope`. The envelope carries trusted
Tenant/Business/connection, provider, lane, entity type, schema version, safe
source provenance, and payload hash. Reports returned by MCP are external
evidence: preserve the discovered report identity and period where the verified
schema supplies them, and do not claim completeness beyond the returned result.
No accounting, CRM, Sales, or Inventory truth is written by this feature.

Discovery and each call produce safe audit evidence with actor, trusted
connection/company, verified capability identifier, correlation, outcome, and
payload hash where appropriate. Logs and audit records exclude OAuth tokens,
secrets, and raw financial/PII payloads. Disconnect disables the local
connection and retires its opaque credential reference; remote token revocation
is attempted only if FlowAccount documents and supports that contract.

This is an explicit, user-authorized read connector. It does not assume REST
Client Credentials, manual pagination, date windows, backfill, a cursor, a
rate-limit value, or a scheduler unless the actual MCP capability contract
documents that behavior. The task does not build a separate MCP server.

### Current acceptance criteria

#### MCP-AC-125.1 — Official MCP and OAuth connection

The server connects only to the official FlowAccount MCP service and follows the
provider's documented OAuth 2.0 flow after its transport and OAuth contract are
verified. No Client Credentials REST form, custom provider host, guessed OAuth
scope, or unsupported transport is accepted.

#### MCP-AC-125.2 — Opaque credential handling

OAuth access/refresh material, if issued, is provisioned through the existing
secret-store port and never persisted in ordinary Prisma fields, browser storage,
URLs, responses, logs, or audit events. Zuri stores and returns only an opaque
credential reference and safe connection status.

#### MCP-AC-125.3 — One company and trusted Business scope

The selected FlowAccount company is bound to one trusted Zuri Business and
verified before activation. Every connect, discovery, read, run, and disconnect
operation re-resolves the trusted viewer and authority; client-supplied
Tenant/Business/connection identifiers do not grant access. Out-of-scope reads
are not-found-equivalent and safely audited.

#### MCP-AC-125.4 — Capability discovery and fail-closed policy

The connector records the actual discovered tool manifest and reviewed schema
version. It executes only explicitly allow-listed read capabilities. Unknown or
mutating tools are denied; provider annotations including `readOnlyHint` cannot
override the Zuri allow-list.

#### MCP-AC-125.5 — Read-only behavior

Provider read tools may be called only through the server-owned authorized
connection. Create-document, edit, delete, status, payment, attachment, or any
other mutation operation is unreachable from this task, even if available from
the official MCP server.

#### MCP-AC-125.6 — FR-081 evidence path

Each approved read result with a verified schema and stable identity is mapped to
`zIngestionEnvelope` and `ingestRawExternalRecord`. It carries trusted scope,
provider, lane, entity type, schema version, safe source URI/capability
provenance, and payload hash. Same identity plus hash is unchanged; changed
payload is new raw evidence. No provider-specific raw table or owner-domain truth
is introduced.

#### MCP-AC-125.7 — Honest result semantics

The connector makes no REST cursor, backfill, date-window, pagination, or
scheduler claim unless a discovered and verified MCP capability documents it.
Partial, unsupported, or ambiguous results are identified as such and are not
presented as a complete report or dataset.

#### MCP-AC-125.8 — Safe errors and audit

Discovery, allowed calls, denials, failures, and disconnects produce
correlation-linked audit evidence with safe error codes. Tokens, secrets, and
raw provider payloads do not enter logs or audit events. Retries occur only for
verified idempotent reads and follow the actual provider contract.

#### MCP-AC-125.9 — Source connection health

The Integration surface reports computed source health from OAuth credential
state, selected-company binding, last verified discovery/read, and disconnect
state using the existing health vocabulary. It does not display REST sync
cursors or stale health snapshots.

#### MCP-AC-125.10 — Truthful financial evidence

MCP may expose accounting reports, including profit/loss and other financial
views. Zuri may label only the actual verified report/tool and returned scope,
company, period, and result; it does not claim complete books or publish values
as Accounting truth without separate owner-domain requirements and approval.

#### MCP-AC-125.11 — Verification and external acceptance

Isolated tests cover OAuth state/secret safety, selected-company binding,
discovery, read allow-list enforcement, mutation refusal, audited denials,
FR-081 provenance, and disconnect. Provider transport, OAuth scopes, tool
schemas, and company identity require separate live contract evidence before
production use; no automated test substitutes for provider or operator
acceptance.

### Open provider contract facts

- OAuth client registration, authorization scopes, token shape/lifecycle, and
  provider-side revocation behavior.
- MCP transport/version and connection requirements for the hosted endpoint.
- Current tool names, schemas, company binding fields, result identities, and
  which tools read reports versus create or mutate records.
- Per-tool pagination, date ranges, limits, retry safety, and report-period
  semantics.

No provider connection, OAuth login/token, tool discovery, or tool call was made
for this documentation correction.

### Current out of scope

- Creating documents or any edit/delete/status/payment/attachment operation.
- A separate Zuri MCP server, REST Client Credentials engine, guessed
  report/resource catalog, automatic scheduler, or assumed full backfill.
- Publishing MCP output as Accounting, CRM, Sales, or Inventory domain truth;
  that requires a separate owner-domain requirement and approval.
- Production use before verified provider contract and operator company-match
  evidence.

## Historical REST-first proposal — superseded for current TASK-ZAI-017

The original v0.2.0b REST Client Credentials design and its AC-125.1 through
AC-125.11 are preserved below as history. They are not current provider facts,
current task requirements, or prerequisites for the MCP connector. The current
requirements are MCP-AC-125.1 through MCP-AC-125.11 above.

## Rationale (historical REST-first proposal)

Integration Platform มี metadata, opaque credential reference และ raw-ingestion
substrate แล้ว แต่ไม่มี provider adapter ที่ดึงข้อมูลบัญชี และ FR-080 form ปัจจุบัน
ถูกออกแบบสำหรับ Phase 1 LLM เท่านั้น การเพิ่ม FlowAccount ต้องใช้ path เดิมโดยไม่
เปิด secret หรือสร้าง persistence/translation path ใหม่

FlowAccount public OpenAPI ใช้ REST pull + Bearer token และ Client
Credentials สำหรับ 1 Client ต่อ 1 บริษัท ไม่มี webhook contract ใน specification
ที่ enumerate เมื่อ 2026-08-20 และไม่มี read endpoint สำหรับ GL/TB/P&L ดังนั้น
ความสามารถนี้เป็น external-evidence acquisition ไม่ใช่ full accounting import

รายละเอียดสถาปัตยกรรมและแหล่งอ้างอิงอยู่ใน
[ADR-053](../../../decisions/ADR-053-FLOWACCOUNT-READ-ONLY-PULL-PIPELINE-AND-CREDENTIAL-PROVISIONING.md)

## Contract

ผู้มี OWNER authority ต่อ Business สามารถเปิด FlowAccount wizard ใต้
`/platform/integrations`, เลือก Sandbox/Production, กรอก Client ID และ Client
Secret แบบ write-only, เลือก resource allow-list/backfill start date และทดสอบ
การเชื่อมต่อ ระบบเก็บ credential bundle ใน approved secret manager และเก็บเฉพาะ
opaque reference ใน `IntegrationCredential`

เมื่อผู้ใช้กด sync, server-owned adapter แลก token, เรียกเฉพาะ GET endpoints ที่
อนุมัติ, paginate ภายใต้ FlowAccount limit แล้วส่งแต่ละ record เข้า FR-081
`zIngestionEnvelope` / `RawExternalRecord` path พร้อม trusted Tenant/Business/
connection scope, external identity, payload hash, run, cursor และ dead-letter
evidence

## Acceptance criteria

### AC-125.1 — Verified connection mode

V1 ใช้ `client_credentials` + `scope=flowaccount-api` ต่อหนึ่ง Business และ fixed
FlowAccount Sandbox/Production endpoints เท่านั้น Custom endpoint, arbitrary
scope และ OpenID refresh-token entry ไม่อยู่ใน V1 ค่า `scope` และ endpoint
ทั้งสองมาจาก provider facts ที่ยืนยันเมื่อ 2026-08-20 และต้องยืนยันซ้ำด้วย
Sandbox contract test ก่อนตรึงเป็นค่าคงที่ (ADR-053 §2 ข้อ 2 บันทึก
provider-doc discrepancy ที่ยังค้างอยู่)

### AC-125.2 — Write-only credential UI

Client Secret เดินทางจาก password field ผ่าน TLS ไปยัง server provisioner ครั้ง
เดียว ไม่เข้า browser storage, URL, Prisma, response, log หรือ AuditEvent หน้า
แสดงเฉพาะ masked Client ID fingerprint, credential version และ configured state

### AC-125.3 — Trusted Business scope

ทุก create/test/sync/run/disable operation re-resolve trusted viewer และ authority
ก่อนอ่าน connection หรือเรียก FlowAccount Client-supplied Tenant/Business/
connection fields ไม่เป็น authority และ resource นอก scope ตอบเหมือนไม่มีอยู่

### AC-125.4 — Company verification

Connection เริ่ม `DRAFT` และเป็น `ACTIVE` หลัง token exchange กับ
`GET /company/info` สำเร็จ `companyId` ถูกเก็บเป็น external account identifier;
tax ID หรือ FlowAccount ID ไม่เป็น Zuri primary key (BR-002)

### AC-125.5 — Read-only resource allow-list

adapter เรียกได้เฉพาะ V1 GET catalog ใน ADR-053 D6 ไม่มี POST/PUT/DELETE/status/
payment/attachment operation reachable Bank Channels, OpenID, webhook และ
attachment/PDF อยู่นอก scope catalog นั้นมีวันที่ 2026-08-20 กำกับ และต้อง
reconcile กับ specification ปัจจุบันใน Phase 0

### AC-125.6 — One raw ingestion path

ทุก provider record ผ่าน `ingestRawExternalRecord`
(`src/platform/integrations/core/raw-ingest-service.js`); same external id +
payload hash เป็น `UNCHANGED`, changed payload เก็บ evidence ใหม่ ไม่มี
provider-specific raw table และไม่มีการเขียน Accounting/CRM/Sales/Inventory truth

### AC-125.7 — Honest cursor and reconciliation

document resources ใช้ date watermark + 7-day lookback และ full reconciliation
ตามคำสั่งผู้ใช้ ส่วน Contacts/Products/Company/Chart of Accounts ทำ full snapshot
เพราะ FlowAccount ไม่ประกาศ generic updated-since cursor `SyncCursor` เลื่อนเมื่อ
resource run จบครบทุกหน้าเท่านั้น

### AC-125.8 — Rate limit and failures

limiter รักษา headroom ใต้เพดาน rate limit ที่ provider ประกาศ **ณ วันที่
implement** — ค่าที่บันทึกไว้คือ Sandbox 20 และ Production 100 requests/minute
ยืนยันเมื่อ 2026-08-20 (ประกาศ 2026-07-09) และต้องตรวจซ้ำ; 429/transient
failures retry แบบ bounded exponential backoff + jitter; terminal failure บันทึก
IngestionRun/DeadLetterRecord ด้วย safe code และไม่เลื่อน cursor

### AC-125.9 — DATA_SOURCE health

หน้า Integration แสดง computed health จาก credential, company test, latest run
และ cursor evidence ด้วย vocabulary เดิม CONNECTED/DEGRADED/ERROR/DISABLED/
MISCONFIGURED โดยไม่เก็บ stale health snapshot และไม่ใช้ inbound silence rule ของ
CHANNEL — `DATA_SOURCE` เป็น connection kind ใหม่ที่ยังไม่มีใน
`CONNECTION_KINDS` วันนี้ (ADR-053 D4) การเพิ่มต้องได้รับอนุมัติแยก

### AC-125.10 — No false accounting completeness

UI และ API ระบุว่า FlowAccount OpenAPI data เป็น raw external evidence และไม่
ประกาศ GL, TB, P&L, revenue reconciliation หรือ net profit หาก source classes
เหล่านั้นไม่มีอยู่ การ publish เข้า owner domain ต้องมี requirement/approval แยก

### AC-125.11 — Verification gates

ก่อน production ต้องมี unit/integration/E2E/security tests, live Sandbox contract
evidence, operator company-match approval, rollback drill และ `npm run verify`
ผ่าน ไม่มี automated test ใดถูกนับแทน live Sandbox หรือ owner acceptance

## Dependencies

- ADR-032 / FR-080 — Platform Integration surface และ deferred secret provisioner
- FR-081 / BR-019 — normalized immutable raw evidence
- SEC-001/003/008/016 — scope, audit, trusted session และ secret-safe management
- SDD-048 — allow-listed observability + correlation ID
- FlowAccount Sandbox/Production credentials และแพ็กเกจที่ provider อนุญาต

## Out of scope

- FlowAccount writes, automatic scheduler, OpenID Partner flow, webhook, Bank
  Channels, attachments/PDF, ledger/report APIs ที่ provider ไม่เปิดให้ read
- domain translation/publish และ raw-record deletion/retention mutation

## Delivery state

**Candidate; task remains planned / not started.** The task detail is corrected to
the official MCP direction, but no outgoing FlowAccount MCP client, OAuth
company-binding implementation, verified tool manifest/schema, tests, or live
provider acceptance exists at the accepted source. Historical REST gates above
do not govern the current approach; live OAuth/company contract and operator
acceptance remain separate evidence.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-20 | candidate | Declared the FlowAccount read-only pull, write-only credential, raw evidence, rate-limit, cursor and no-false-accounting contract | working-tree | ATHER |
| 0.2.0b | 2026-08-30 | candidate | Re-applied to main from `rescue/flowaccount-docs` as FR-125 (was FR-094; ACs renumbered AC-094.x → AC-125.x). Provider facts marked as verified 2026-08-20 and unre-checked in AC-125.1/.5/.8. AC-125.9 records that `DATA_SOURCE` is not an existing connection kind | pending | Claude Opus 5 |
| 0.3.0b | 2026-10-18 | candidate | Direct human correction: current scope supports FlowAccount's official hosted MCP connector using OAuth company selection and a Zuri-enforced read-only allow-list. Added dated official endpoint/capability evidence, explicit unknowns, MCP-AC-125.1–.11 and current not-started state. Preserved the REST-first proposal and its ACs as historical, superseded scope. No code or provider action is claimed | pending | Codex |
