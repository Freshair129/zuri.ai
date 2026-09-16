---
id: ZAI:PM-SRS
title: Project Manager Software Requirements Specification
version: "0.1.0b"
status: candidate
created_at: "2026-09-16T12:00:32+07:00,RWANG,design base 087f3025"
last_update: "2026-09-16T12:22:55+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: requirements-specification
  domain: project-manager
  scope: Full PM proposal including workforce and peer-owner contracts
relations:
  - type: references
    target: ZAI:PM-SYSTEM-DESIGN
  - type: references
    target: ZAI:PM-SPEC-READINESS
---
# Software Requirements Specification — Project Manager

**SRS v0.1.0b · Candidate · C-3 · Risk HIGH for eventual implementation.** เป็นข้อกำหนดระบบที่รวบรวม requirement เดิมและ Workforce ให้ตรวจพฤติกรรม ข้อมูล และ interface ได้ในที่เดียว ไม่ใช่รายงานว่าระบบทำได้แล้ว และไม่อ้างการรับรองตามมาตรฐานใด.

## 1. Purpose and system boundary

ระบบต้องช่วยทีมเปลี่ยนเป้าหมายธุรกิจเป็นแผนงานที่ติดตามได้ ผ่าน Domain view และ Feature view ที่แยกกัน เชื่อม requirements → architecture/API → human/agent execution → evidence → release. ข้อมูลชุดเดียวต้องตอบได้ว่าใครรับผิดชอบอะไร ทีมมีเวลาพอหรือไม่ และส่งมอบผลงานอย่างไร.

Target is an extension of zuri-ai using a modular monolith and repository ports. Existing seven execution modes remain SOFTWARE_SPRINT, DATA_MIGRATION, B2B_SALES, B2C_CAMPAIGN, PRODUCT_LAUNCH, OPERATIONS, BUSINESS_EXPANSION. No new mode is introduced by this SRS.

### Included scope

1. Objective-first Project planning; Domain and Feature lenses; existing Inventory, Team/Membership, Files, Work views and plan import.
2. Requirement/design baselines, typed directed architecture graph, API explorer, document/contract traceability and change control.
3. Human resources: individual/team workload, working calendars, effective assignments, schedule, capacity gaps and twelve performance metrics.
4. Agent definitions, fleet/workflow versions, governed execution, command center, approval and recovery.
5. Cloud/local/self-host model registry, MCP bindings, scoped inference gateway, usage and budgets through Integration and Identity.
6. Risks/issues/decisions, evidence, collaboration, authorized search/sharing, notification receipts and release/operational verification.

### Excluded or separately authorized

Payroll/compensation decisions, automatic hiring, employee surveillance, autonomous task reassignment, new canonical execution modes, public raw LLM ports, external-store writes to MSP/GKS, new microservice migration, legacy-zuri migration and production activation are not implied. No hard deadline or staffing target is invented.

## 2. Baseline and document precedence

| Subject | Authority within this candidate package |
|---|---|
| Binding product/domain identity | Current accepted repository decisions/charters; [PM charter](../../domains/project-manager/CHARTER.md), [Integration charter](../../domains/integration/CHARTER.md) and Identity owner APIs |
| User navigation intent | [13 Domain boundaries](13-DOMAIN-TAXONOMY-AND-NAVIGATION-BOUNDARIES.md): Top bar Domain → sidebar subdomain/module → local tabs; Business Home shortcuts |
| Existing tabs | [14 Existing tab semantics](14-EXISTING-PROJECT-TAB-SEMANTICS.md); preserve Inventory, planned Risks/Resources and Membership meanings |
| Human planning behavior | [15 Workforce](15-WORKFORCE-CAPACITY-SCHEDULE-AND-PERFORMANCE.md) and this SRS |
| HTTP shapes as currently authored | Two candidate OpenAPI files; [06 APIs](06-API-AND-CONTRACTS.md); gaps remain explicit in [16 Readiness](16-SPEC-READINESS-AND-API-REFERENCE.md) |
| Proposed table/relationship design | [18 Tables & ERD](18-DATABASE-TABLES-AND-ERD.md); does not silently amend existing schemas or OpenAPI |
| Target component/runtime design | [19 Blueprint](19-SYSTEM-BLUEPRINT.md); blueprint models are supplemental, not a replacement of G01 |

Conflict resolution: stop the affected implementation slice, record the differing source/hash and resolve by explicit amendment. Older navigation JSON and 37-screen gallery remain historical until reconciled. A drawing does not override an accepted owner contract.

## 3. Actors and authority

| Actor | Needs | Required authority principle |
|---|---|---|
| Business owner / PM | Goals, project delivery, resource demand and risk | Current scoped PM actions; owner label alone is not a grant |
| Team lead | Team capacity, allocation preview, delivery scorecard | Explicit team/person data scope and planning/review actions |
| Employee / contributor | Own work, schedule, logs and evidence correction | Self scope where granted; no automatic coworker metrics access |
| People administrator | Employment-linked calendars and availability | People writer action; no implicit Identity management |
| Reviewer / QA | Review exact snapshots, policy and evidence | Current review capability, no disallowed self approval |
| Integration administrator | Connection, model, MCP and executor setup | Integration grants plus step-up where secrets require it |
| Operator | Installation health and recovery | Redacted operational scope; no implicit Business data |
| Agent / executor | Claim an authorized task and submit evidence | Short-lived audience/attempt/epoch-scoped capability intersection |
| Observer / shared recipient | Read permitted records or exact artifact revision | Read-only current grant; expiry/revocation enforced |

## 4. Glossary and data meaning

| Term | Meaning |
|---|---|
| Domain | Owner boundary for services, data and rules; navigation group may own no data |
| Feature | User capability spanning one or more domains; has one primary owner |
| Workstream | Project execution lane with one canonical execution mode and progress strategy |
| Inventory | Existing operational project composition; not stock SKU inventory and not agent inventory |
| Team / Membership / Employment | Organizational grouping / access grant / employment assignment; three different records |
| Capacity | Available working minutes after interval exclusions, not assigned task count |
| FTE | Period capacity divided by an explicitly configured full-time reference; not headcount |
| Performance | Contextual delivery/quality/flow/outcome evidence, not a universal employee score |
| Approved / Ready / Successful | Sealed configuration / current runnable prerequisites / completed run contract; none automatically means work accepted or deployed |
| Unknown / zero | Missing evidence / measured zero. They must remain distinguishable |

## 5. Functional requirement catalog

PMR/PMF/PMT are immutable proposal-local references. They do not reserve canonical FR/FEAT IDs. All 33 behavior families are listed below; SHOULD/MUST wording refers to the approved future slice, not current runtime.

| Requirement | Observable behavior | Capability | Owner | Acceptance family |
|---|---|---|---|---|
| PMR-001 | สร้าง Project จาก objective, outcome, scope, owner, dates และ execution modes; import dry-run แสดงผลก่อน atomic commit | PMF-01 | project-manager | PMT-001 |
| PMR-002 | Domain view จัดกลุ่มตาม canonical domain ID; เปลี่ยน label แล้ว links/counts ไม่เปลี่ยน; แสดง ownership, work, contracts, gaps | PMF-01 | project-manager | PMT-002 |
| PMR-003 | Feature view เป็นอีก tab; หนึ่ง feature เชื่อมหลาย domain/FR; work ที่เชื่อมหลาย feature ถูก deduplicate ใน totals | PMF-01 | project-manager | PMT-003 |
| PMR-004 | Architecture canvas แสดง directed typed edges พร้อม owner/contract/version; มี table และ keyboard alternative | PMF-02 | project-manager | PMT-004 |
| PMR-005 | API explorer แสดง schemas/auth/errors/examples และ source version; Try it out ใช้ sandbox หรือ explicit scoped invocation | PMF-03 | project-manager | PMT-005 |
| PMR-006 | Agent inventory มี immutable approved version, charter, skills, tools, model policy, executor constraints, tests และ lifecycle | PMF-04 | project-manager | PMT-006 |
| PMR-007 | Fleet inventory มี member-version bindings, DAG, handoffs, concurrency, review policy และ budget; validate ก่อน publish | PMF-05 | project-manager | PMT-007 |
| PMR-008 | Command center แสดง queues, active claims, attempts, events, blockers, usage; dispatch/cancel/retry ผ่าน server command | PMF-06 | integration | PMT-008 |
| PMR-009 | Provider registry แยก provider, connection, deployment, model และ capabilities; probe มีเวลาและ evidence | PMF-07 | integration | PMT-009 |
| PMR-010 | MCP registry pin transport/protocol/tool-schema digest; local stdio อยู่บน paired executor; consent ต่อ tool scope | PMF-07 | integration | PMT-010 |
| PMR-011 | Self-host model เรียกผ่าน gateway API key ที่ scoped/expiring/revocable; raw serving port เป็น private | PMF-07 | integration | PMT-011 |
| PMR-012 | ทุก read/write/stream resolve authority จาก trusted identity; foreign-scope IDs ไม่เผยตัวตนและ aggregate | PMF-08 | identity | PMT-012 |
| PMR-013 | Approval ผูก exact artifact/spec/config hashes, action และ expiry; เปลี่ยน input ต้อง approval ใหม่; reviewer conflict ถูกปฏิเสธ | PMF-06 | project-manager | PMT-013 |
| PMR-014 | Architecture model เป็น structured specification; unknown types, invalid port pairs, orphan refs และ forbidden cycles fail validation | PMF-02 | project-manager | PMT-014 |
| PMR-015 | จาก requirement เปิดไป diagram/API/work/test/release ได้; evidence ระบุ SHA, environment, status และเวลา | PMF-08 | project-manager | PMT-015 |
| PMR-016 | Progress ใช้ strategy/weights/evidence ของ workstream; usage ไม่ใช่ progress; denominator/unknown แสดงได้ | PMF-01 | project-manager | PMT-016 |
| PMR-017 | มี objectives/KPIs, scope baseline, risks/issues/decisions, resources/capacity และ cost plan; allocation เกิน capacity มีเหตุผล override | PMF-01 | project-manager | PMT-017 |
| PMR-018 | Release แยก environment, build, migration, deploy, activation; promotion ผูก tested SHA และ rollback evidence | PMF-10 | project-manager | PMT-018 |
| PMR-019 | Meaningful changes มี append-only audit refs, actor, scope, reason และ before/after hash; sensitive reads auditable | PMF-08 | identity | PMT-019 |
| PMR-020 | Trace/usage แยก input/output/cache/reasoning tokens, latency, cost basis และ unknown; ไม่เดาค่าเงินจากจำนวน task | PMF-10 | integration | PMT-020 |
| PMR-021 | Worker crash, lease expiry, duplicate receipts, late result, cancellation และ external unknown outcome มี deterministic recovery | PMF-06 | integration | PMT-021 |
| PMR-022 | Search ค้นเฉพาะ authorized project artifacts/specs; MSP/GKS ใช้ผ่าน ports; retrieval ต้องมี provenance | PMF-09 | knowledge | PMT-022 |
| PMR-023 | Comment/mention/review thread ผูก revision; concurrent edit ใช้ version conflict และไม่ทับงานเงียบ | PMF-09 | project-manager | PMT-023 |
| PMR-024 | Notification inbox/webhook/subscription ระบุ event filters, recipients, delivery receipts และ retry; ไม่มี auto-send จากการเปิดหน้า | PMF-09 | integration | PMT-024 |
| PMR-025 | Import/export design bundle มี schemaVersion, namespace, refs, hashes, conflict preview และ sanitized portable export | PMF-09 | project-manager | PMT-025 |
| PMR-026 | Retention/classification และ share grants บังคับ server-side; revocation/expiry ใช้ทันที; export ไม่มี secrets | PMF-09 | identity | PMT-026 |
| PMR-027 | Readiness แยก PLANNED, IMPLEMENTED, VERIFIED, DEPLOYED, ACTIVATED, UNKNOWN; ทุก promotion อ้าง evidence | PMF-08 | project-manager | PMT-027 |
| PMR-028 | Agent/provider/workflow version ผ่าน eval suite ก่อน approve; regression, adversarial scope และ side-effect checks มี threshold | PMF-10 | project-manager | PMT-028 |
| PMR-029 | UI/API/workers มี SLO, bounded pagination, queue backpressure, accessibility, backup/restore และ load targets ที่ทดสอบได้ | PMF-10 | integration | PMT-029 |
| PMR-030 | Manual/scheduled/event triggers มี timezone, dedup, misfire, approval และ loop suppression; pause หยุด enqueue ใหม่ | PMF-06 | integration | PMT-030 |
| PMR-031 | SCM/CI adapters เชื่อม repository/branch/commit/PR/check/release แบบ explicit mappings; webhook ไม่ยืนยัน completion เอง | PMF-10 | integration | PMT-031 |
| PMR-032 | CI ตรวจ divergence ของ approved spec, architecture graph, OpenAPI, code anchors และ tests; generated views ไม่แก้ด้วยมือ | PMF-02 | project-manager | PMT-032 |
| PMR-033 | จำนวนงานเชื่อม effort/calendar เพื่อสรุปภาระงาน กำลังคน ตารางงาน และ performance รายคน/ทีม รวมหลาย Project พร้อมสูตร cohort/เป้าหมาย/หลักฐาน/coverage | PMF-11 | project-manager; people, Identity/CRM ports | PMT-033 |

## 6. End-to-end use cases

Each journey rechecks scope at mutation/read boundaries and yields a durable receipt when a command is accepted. Outcomes below are required behavior; tests remain planned.

| UC / requirement | Preconditions and input | Main flow | Alternate/error flow | Postcondition / proof |
|---|---|---|---|---|
| UC-01 Plan Project / 001,016 | Authorized Business/Project; objective, outcomes, dates | Plan → decompose Workstreams → validate seven-mode contracts → dry-run → exact commit | Invalid mode/refs or stale preview: refuse without partial writes | PM owner records plan/import receipt and AuditEvent; strategy roll-up |
| UC-02 Review Domain or Feature / 002,003 | Authorized project and asOf snapshot | Choose separate lens → filter → inspect links/counts → open source work | Missing evidence stays UNKNOWN; multiple tags deduplicate totals | Same underlying WorkItem identity and consistent authorized total |
| UC-03 Approve architecture/API / 004,005,013,014,032 | Draft snapshot with graph/contracts/requirements hashes | Validate node/edge types and owner ports → inspect API → diff → independent review → seal | Orphan refs, illegal write, changed hash or review conflict: block | Exact immutable approved manifest; no automatic application code or API call |
| UC-04 Plan human capacity / 017,033 | Resolved Person, work estimate, effective calendar and authorized demand | Person/team period → preview allocation → show conflict and sources → commit | Unknown calendar/unestimated work stays visible; 412 stale; 409 conflict; hard scope/interval faults cannot override | One writer and exact receipt; no duplicate consumption or changed Membership |
| UC-05 Log/review performance / 033 | Known work/cohort/assignment and scoped policy | Draft log → submit → review → calculate scorecard → inspect evidence | No sample gives null/INSUFFICIENT_SAMPLE; ongoing period PROVISIONAL; correction requests go to source owner | Immutable reviewed history and new result revision; no retroactive credit transfer |
| UC-06 Configure provider/MCP / 009–012 | Authorized Integration connection; metadata and secret via owner | Register deployment → credential vault → probe → pin schema/model policy → approve binding | Changed tool digest, invalid audience, quota or missing capability: not ready | Secret-free inventory and exact approved capability binding |
| UC-07 Publish agent/fleet / 006,007,028 | Charter, approved model/tool bindings, versioned workflow/eval | Validate DAG/handoffs → pin members → eval → review → seal | Cycle/unresolved latest/failed eval/invalid owner lane: refuse | Approved version; runtime readiness calculated separately |
| UC-08 Dispatch and recover / 008,013,020,021,030 | Approved baseline/input, authority, budget, ready executor | Dry-run → admission receipt → lease → execute → validate output → evidence | Crash/expiry: fence stale epoch; uncertain effect: UNKNOWN and reconcile; cancellation stops claims | Durable run state and receipts; PM acceptance remains separate |
| UC-09 Manage risk/change/release / 017,018,027,031 | Typed support record or verified source/check evidence | Risk response/change review → approved baseline → tested SHA → staged release evidence | Forged/stale CI or mismatched SHA/environment: refuse promotion | Separate build/test/migration/deploy/activation proof |
| UC-10 Collaborate/share/import / 022–026 | Current authorized artifact revision or safe bundle | Scoped search → comment/mention → recipient recheck → expiring share or sanitized export | Revoked recipient, out-of-scope ref, unknown executable import field: deny/suppress | Revision-pinned thread/receipt; no hidden nodes or secrets exported |

## 7. Business rules and invariants

| Rule family | Normative behavior | Verification |
|---|---|---|
| Scope & identity | Tenant isolation, Business operation, branch location; trusted lookup before aggregate; Team/Employment do not authorize | Foreign ID/cursor/stream tests; Membership unchanged after scheduling |
| Progress | Existing mode strategy and accepted evidence; weighted Project roll-up; unique WorkItems | Same work in two features counts once; token usage never increases completion |
| Time | Integer minutes, IANA timezone, half-open intervals, explicit DST ambiguity; no implicit 40h calendar | DST/nonexistent time rejection, boundary splitting, overlapping absence union |
| Capacity | Sum known confirmed demand over available minutes; per-person and daily overload shown even if team aggregate fits | 35/28h=125%, 18/30h=60%, combined 53/58h=91.38%; team still shows A overload |
| Missing demand | Unestimated/unassigned/unscheduled work visible with source coverage; free capacity withheld if incomplete | Null/zero capacity matrix and partial authorized scope |
| Team aggregation | Effective capacity shares sum <=100%; distinct people/work; unassigned queue consumes no specific person | Multi-team membership cannot duplicate capacity |
| Performance | Twelve metrics from document 15; frozen due/estimate/assignment/cohort and formula version; no raw-count ranking across unlike work | Pooled numerator/denominator and combined percentile sample, not averaged percentages/percentiles |
| Effective history | Adoption snapshot is labeled; reassignment/soft deletion preserves evidence | No reconstructed history from updatedAt; late corrections append |
| Version/control | Optimistic version check; idempotent create/command; exact approval hash | Same key/hash returns receipt; changed hash yields conflict; stale writes fail |
| Execution effects | Distinct plan/run/attempt/effect IDs; lane CAS and epoch fencing; at-least-once events | Duplicate/stale result tests; unknown effect never blindly retried |
| Resource meaning | Human allocation, agent occupancy and equipment/stock reservation have distinct units and owners | No token-to-headcount or task-count-to-hour conversion |

## 8. External and internal interfaces

| Interface | Source | Expected binding / remaining gate |
|---|---|---|
| Main HTTP contract | [Main OpenAPI](contracts/openapi.candidate.yaml): 72 operations / 98 definitions | PM and peer owner routes; SPEC-G01/03/05 reconcile shared semantics |
| Workforce HTTP contract | [Workforce OpenAPI](contracts/workforce.openapi.candidate.yaml): 8 operations / 27 definitions | Typed planning/scorecard endpoints; history/policy/correction and result shapes remain incomplete |
| Workflow import | [JSON Schema](contracts/workflow.schema.json) and synthetic example | Schema plus DAG/owner/ref checks; never executable imported commands |
| Graph and blueprint | G01 [architecture model](contracts/architecture.model.json) and supplemental [blueprint model](contracts/blueprint.candidate.json) | Typed directed edges; owner write boundary; no inferred grants |
| Data persistence | [Table model](contracts/data-model.candidate.json) and table dictionary | Repository interfaces; exact SQLite/Postgres constraints/migrations require approval and tests |
| Identity / CRM / People | Accepted owner ports for viewer/capabilities, Person and Employment | No direct foreign-owner writes or parallel RBAC; employment status is not availability schedule |
| Providers / executors | Integration connection/secret, model gateway, MCP and claim/event contracts | Private hosts use authorized pull; credentials scoped by audience; no raw secret in browser |
| Knowledge / SCM / notifications | Owner adapters, signed source receipts, authorized recipient binding | Verify provenance and reauthorize before results or sends; webhook is not completion authority |

HTTP common behavior: opaque cursor (default 50, max 200), scope-before-filter, idempotency and version preconditions, redacted errors and explicit rate limits. Session/CSRF binding, error-envelope and If-Match parity remain SPEC-G05; this prose does not silently fill missing OpenAPI fields.

## 9. Data requirements and retention

Tables and ERDs define owner, existing/proposed status, scalar fields, nullability, keys, temporal constraints, indexing, deletion policy and atomic boundaries. Keep artifacts private with hashes; immutable evidence survives ordinary soft deletes subject to approved privacy retention/tombstone rules. Document 03 retention defaults remain proposals; deployment requires owner-configured schedules and purge evidence. Raw credentials remain in the Integration secret store, not PM data or logs.

## 10. UX and accessibility

- Domain → subdomain/module → local tabs; Business Home uses authorized shortcuts, not duplicated writers.
- Domain and Feature stay separate views. Inventory remains explicit. Resources has Overview / Workload / Schedule / Performance; Person/Team and period are controls, not new domains.
- Preserve nine existing sections, fourteen route templates and seven Work views per document 14. Expose future capabilities with honest planned state.
- [UX strategy](10-UX-STRATEGY-AND-JOURNEYS.md), [UI contract](11-UI-SYSTEM-AND-INTERACTIONS.md), [wireframes](12-WIREFRAMES-AND-SCREEN-SPECS.md) and six WF-R screens define field behavior and alternatives.
- Required states: empty/loading/ready/partial/stale/forbidden/error/conflict; keyboard graph/table alternatives; persistent labels, logical form sequence, inline validation and focus recovery.
- Thai/English labels, timezone/unit/period shown; color supplements text; keyboard, screen reader and 200% zoom acceptance needed for delivered flows.

## 11. Nonfunctional acceptance targets

Targets below come from document 07; they are proposed benchmarks and not measured current SLAs.

| Concern | Candidate target | Verification |
|---|---|---|
| Scoped list API | p95 ≤ 500ms / p99 ≤ 1500ms at 50 requests/s | Seed 100 projects, 100k work items across 10 tenants; mixed authorized/denied requests |
| Domain/Feature aggregation | p95 ≤ 1s for a 10k-item project | Indexed/scoped query; explain plan and dedup correctness |
| Graph UX | 1k nodes/3k edges load ≤ 3s on declared reference device | Reproducible browser profile, accessible list and filtered rendering |
| Event visibility | p95 ≤ 2s from committed event to connected client | 200 streams, bounded buffer, reconnect/revocation test |
| Worker scale | 100 active runs, 20 executors within configured lane locks | Race/lease expiry/queue backpressure and recovery |
| Queue limits | max 1k queued runs per Business; 429 above cap | Admission atomicity; operator-controlled limit |
| Availability | target 99.5% monthly for control API | Synthetic probe and outage accounting; provider outage reported separately |
| Recovery | RPO ≤ 15m, RTO ≤ 4h for production operational data | Encrypted backup + isolated restore drill + key revalidation |
| Accessibility | WCAG 2.2 AA target for delivered flows | Keyboard/screen-reader/manual zoom checks plus automated scan |
| Security | zero cross-scope reads/writes in contract suite; no secret sentinel in artifacts/logs | Auth matrices and secret-leak tests |
| Evaluations | 100% scope/authorization cases; ≥ 95% task-specific golden acceptance | Fixed versioned dataset, output grading rubric, recorded model/config |
| Data loss | no accepted command without durable receipt | Kill/restart at transaction boundaries; outbox/inbox replay proof |

## 12. Permission and privacy acceptance matrix

| Action | Subject scope | Required checks | Failure behavior |
|---|---|---|---|
| View own/team workload | Authorized people and Business/project facts | Read action, source coverage, redacted conflicts | Same external not-found shape; never hidden demand IDs |
| Change calendar/allocation | Target People/PM records | Write actions, current Employment/assignment, expected versions and capacity | No partial writes; hard invalid scope/time cannot override |
| Review policy/log/correction | Person/team/Business evidence | Explicit review action and conflict-of-interest policy | No Project grant reused by name for Business KPI review |
| Manage connection/key | Integration/Identity profile | Current management/step-up and audience | One-time reveal; secrets excluded from lists, exports and audit |
| Dispatch/tool effect | Exact run/attempt/target | Requester ∩ workflow ∩ executor ∩ tool ∩ current grant | Deny before effect; stale/revoked claims cannot commit |
| Share/notify/export | Exact revision and current audience | Re-resolve recipient and source grant at access/send | Expired/revoked suppressed/denied; event receipt remains |

Names in this matrix describe required policy actions; exact canonical capability names are resolved with Identity before code. No permission is granted by a proposed table or UI role.

## 13. Verification and acceptance trace

[srs-traceability.candidate.json](contracts/srs-traceability.candidate.json) maps every PMR to data records, blueprint nodes, operation IDs, delivery phase and PMT family. All acceptance tests below are PLANNED / NOT_RUN for the product.

| Family | Required observable proof |
|---|---|
| PMT-001 | Authorized project import with one invalid nested work item → Whole commit refused; dry-run shows exact issue; no partial business writes |
| PMT-002 | Domain label renamed at same stable ID → Work/feature links and authorized counts unchanged |
| PMT-003 | Same WorkItem linked to two features → Project total counts once; allocation view explains weights |
| PMT-004 | Keyboard user adds directed edge with missing contract → Blocked with specific field/edge reason; equivalent drag validation |
| PMT-005 | Observer opens Swagger then attempts mutation → Documentation readable if authorized; execution denied with no write |
| PMT-006 | Approved AgentVersion edited or tool schema changes → New revision required; existing version/run remains pinned |
| PMT-007 | Fleet DAG includes cross-domain write without handoff or a cycle → Validation fails before any dispatch |
| PMT-008 | Run accepted while browser disconnects → Durable queue survives; reconnect renders authoritative state |
| PMT-009 | Model name exists but required capability probe fails → Deployment cannot satisfy binding readiness |
| PMT-010 | MCP server changes tool schema/requests broader authority → Binding pauses; no widened tool call |
| PMT-011 | Consumer key allows model A, asks for B or hits raw model port → Gateway denies B; raw port unreachable; no upstream inference |
| PMT-012 | Foreign tenant/business/project IDs in URL/body/filter/cursor/stream → Equivalent not-found/denied; no identifiers, counts or payload leakage |
| PMT-013 | Approve hash H then dispatch modified hash H2 → INPUT_CHANGED; old approval cannot authorize new effect |
| PMT-014 | Graph WRITES edge crosses owner or has unknown endpoint/type → Semantic validation rejects; no scaffold generated |
| PMT-015 | Test evidence belongs to older commit or different environment → Cannot satisfy current acceptance/release gate |
| PMT-016 | Token usage rises with no new accepted business evidence → Project progress unchanged |
| PMT-017 | Concurrent allocations exceed resource capacity → Transaction rejects second allocation or requires authorized reasoned override |
| PMT-018 | CI green for A, deployment request targets B → Release refused; migration/deployment/activation remain distinct |
| PMT-019 | Sensitive mutation/privileged read occurs → Redacted append-only audit with scope/actor/reason/refs exists |
| PMT-020 | Provider omits usage/cost categories → UNKNOWN shown; no fabricated 0 or double counting |
| PMT-021 | Crash after external effect before acknowledgment; then stale worker reports → UNKNOWN/reconcile; no duplicate effect, stale epoch cannot promote |
| PMT-022 | Search query crosses project or GKS/MSP scope → Only authorized provenance-linked results; no direct foreign store access |
| PMT-023 | Two reviewers edit same draft version → Second write 412; approved revision comments stay pinned |
| PMT-024 | Subscriber loses grant before notification delivery → Delivery suppressed; reason recorded; no message leakage |
| PMT-025 | Import bundle has unsupported version/colliding ref/script field → Reject with preview diagnostics, no executable payload |
| PMT-026 | Artifact link expired/revoked or underlying access withdrawn → Immediate denial and no cached private bytes to new request |
| PMT-027 | Code/tests available but no deployment receipt → Readiness cannot claim DEPLOYED/ACTIVATED |
| PMT-028 | New agent/model version fails golden/adversarial suite → Approval/production binding blocked with evidence |
| PMT-029 | Declared scale/load and restore scenarios → Meets measured candidate targets below or explicit failed gate |
| PMT-030 | DST/timezone/missed trigger/duplicate webhook/self-generated event → Correct one scheduled window, dedup, bounded catch-up, no feedback loop |
| PMT-031 | Forged/stale CI webhook claims check passed → Verify signature + repository/commit/check mapping before readiness update |
| PMT-032 | Approved contract differs from generated API/code anchors → CI reports drift and blocks phase closure |
| PMT-033 | Person/team capacity, schedule and performance scenarios A–P in document 15 → Accurate counts/intervals/cohorts, scope-first reads, visible unknown data, concurrency and accessible workforce UI |

Additional PMT-033 A–P scenarios are specified in document 15: status counts, interval subtraction, missing estimates, zero capacity, duplicate team shares, effective history, fixed-slot conflicts, concurrent preview/commit, cohort/percentile math, partial permissions and keyboard schedules.

## 14. Delivery, assumptions and open decisions

Follow P0→P7 for the full system and independent PMR-033-P1→P5 for human workforce; do not make staffing depend on Fleet activation. Retain one parent requirement with ordered phase suffixes. Navigation refinement remains the first UI implementation slice after its own approved reconciled model.

[ASSUMPTIONS]

1. Extend this product and existing owner ports; no legacy repo migration.
2. Initial workforce aggregation is one authorized Business; cross-Business availability requires a separate coarse-grained owner contract.
3. Performance is delivery evidence and planning support; actual business targets and full-time calendars require owner data.
4. Proposed data profiles may reuse exact existing owner storage after field-level compatibility review.

Open: all SPEC-G01–G09 remain tracked. This addition supplies detailed table/ERD and SRS/blueprint coverage; it does not claim complete machine contract parity, tested migrations, runnable conformance or approval. Definition of Ready for code is the approved per-slice baseline with required gaps closed. Definition of Done requires implementation, relevant tests/build/governance and environment-specific evidence, not document counts.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Consolidate 33 requirement families, use cases, interfaces, rules, nonfunctional targets and acceptance trace | design base 087f3025; uncommitted | RWANG |
