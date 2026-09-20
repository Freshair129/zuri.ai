---
version: "0.1.0b"
created_at: "2026-09-21T00:00:00+07:00, Astra, pending commit"
last_update: "2026-09-21T00:00:00+07:00, Astra"
status: "candidate"
superseded_by: null
attributes:
  domain: "agent-governance"
  doc_type: "core-directive"
  scope: "Global"
  standard_id: "STD-Multi agent workflow S-01"
  enforcement: "candidate; not yet implemented"
---

# STD-Multi agent workflow S-01

สถานะ: candidate — มาตรฐานนี้เป็น design ที่บันทึกแล้ว แต่ยังไม่ใช่ระบบ
บังคับใช้จริงจนกว่า P0 implementation backlog และ controlled pilot จะผ่าน

## 1. Purpose and boundary

มาตรฐานนี้กำหนด workflow สำหรับงานหลาย agent ตั้งแต่รับโจทย์จนปิดงาน:

~~~text
Intake
  -> Triage and work packet
  -> Documentation/RCA and approval
  -> Delivery DAG and execution DAG
  -> Candidate-parallel waves
  -> Luna Max execution
  -> Evidence submission
  -> Astra review and one integration queue
  -> Generated checks and hosted CI
  -> SHA-checked merge
  -> Roadmap/SOT and Mission Control closeout
~~~

มาตรฐานนี้ควบคุม assignment, branch, evidence, integration และ closeout
เท่านั้น ไม่ขยายอำนาจให้ agent ทำ production, migration, owner approval,
MSP หรือ GKS operation โดยไม่มี authority และ receipt ของเจ้าของระบบนั้น

## 2. Roles and sources of truth

- Astra orchestrator รับโจทย์, inventory งานเดิม, จัดทำ packet/DAG,
  อนุมัติ dispatch, ตรวจ evidence, คุม merge queue และออก closure receipt
  โดยไม่แก้ code เอง
- Luna Max worker ทำ implementation หรือ bounded documentation slice
  ใน worktree/branch ของตนเองตาม write-set ที่อนุมัติ
- Luna Max integrator เป็นผู้ปฏิบัติการรวมผลเพียงหนึ่งรายในช่วง integration
  และ regenerate output จาก canonical source ตามคำสั่ง Astra
- Reviewer ตรวจแบบ read-only และต้องแยกจากผู้เขียนสำหรับงานเสี่ยงสูง
- Owner/operator ให้ approval หรือทำ action ที่ต้องใช้สิทธิ์ production,
  provider, MSP หรือ GKS
- Mission Control แสดง execution ledger ที่ผูกกลับไปยัง roadmap task
  ไม่สร้าง source of truth ชุดใหม่

ข้อมูลสามชนิดมีเจ้าของชัดเจน:

| ข้อมูล | เจ้าของความจริง | หน้าที่ |
|---|---|---|
| Requirement/delivery | docs/roadmap/ROADMAP.md และ requirement docs | ระบุสิ่งที่จะส่งมอบและเกณฑ์ |
| Execution state | orchestrator execution ledger | assignment, attempt, lease, SHA, lock, timeout, PR |
| Evidence | commit, CI, test report, approval, production receipt | รองรับข้ออ้างแต่ละข้อ |

## 3. Intake, RCA and approval

ทุกคำขอต้องถูกแปลงเป็น work packet ก่อน dispatch:

~~~yaml
packet_id: stable-id
intent: user-visible outcome
request_kind: design | diagnose | implement | merge | deploy
repository: owner/name
scope:
  tasks: [TASK-...]
  requirements: [FR-...]
  paths: [repo-relative paths]
  out_of_scope: [explicit exclusions]
risk: LOW | MEDIUM | HIGH
complexity: C-1 | C-2 | C-3
completion_target: design | merged_delivery | verified_production
acceptance: [checkable criteria]
authority: [approved actions]
external_gates:
  owner: open | ready | not_applicable
  production: open | ready | not_applicable
  msp: open | ready | not_applicable
  gks: open | ready | not_applicable
estimate:
  execution_minutes: range
  wait_minutes: range or unknown
  confidence: low | medium | high
~~~

ก่อน implementation ให้ตรวจ parent contract และ same-level peer contract
ตาม Doc-first rule. การเปลี่ยนความหมายใหม่ต้องมีเอกสารและ approval ที่ผูกกับ
revision ของเอกสารและ scope ของ packet. Approval เดิมใช้ซ้ำได้เมื่อเปลี่ยน
แค่ worker หรือ branch และสาระสำคัญไม่เปลี่ยน

Bug work ต้องมี RCA ที่มี symptom, evidence, root cause, escape reason และ
prevention ก่อนเสนอ fix. หยุดรอ approval เมื่อ scope, acceptance, authority,
external contract หรือ production target เปลี่ยน. งาน read-only เดินต่อได้
ขณะ node ที่ได้รับผลกระทบอยู่ WAIT_APPROVAL

## 4. Delivery DAG and execution DAG

ต้องมีทั้ง delivery DAG ระหว่าง roadmap tasks และ execution DAG ภายใน task:

~~~text
implementation -> evidence -> review -> integration -> CI -> merge
             -> SOT reconciliation -> Mission Control closeout
~~~

ทุก node ต้องมีข้อมูลอย่างน้อย:

~~~yaml
node_id: TASK-ZAI-056/sot-reconcile
task_id: TASK-ZAI-056
kind: implementation | review | reconciliation | closeout
plan_revision: 1
approval_ref: packet-and-doc-revision
depends_on:
  - node: TASK-ZAI-056/implementation
    requires: merged_receipt
repository: Freshair129/zuri.ai
target_branch: main
base_sha: verified-target-sha
required_ancestor_shas: [required receipts]
read_set: [repo-relative paths]
write_set: [repo-relative paths]
generated_outputs: [source -> generator -> output]
exclusive_resources: [canonical-roadmap, target-branch]
acceptance_refs: [AC-...]
evidence_required: [tests, projection_check, hosted_ci, merge_receipt]
assignment:
  worker_id: null
  attempt: 0
  lease_epoch: 0
budget:
  execution_minutes: 20
  max_recovery_attempts: 1
~~~

Dependency ต้องระบุ required receipt ไม่ใช่ใช้คำว่า done แบบกว้าง. การผ่อน
dependency ต้องเขียนในแผนและมีเหตุผล ไม่ให้ agent อนุมานเอง

## 5. Candidate-parallel waves

Node จะ eligible เมื่อ approval, required dependency receipts, base contract,
assignment uniqueness, locks, environment และ capacity พร้อมทั้งหมด:

~~~text
approval_valid
AND dependency_receipts_valid
AND base_contract_valid
AND no_active_assignment
AND locks_acquired
AND environment_ready
AND capacity_available
~~~

สอง node รันขนานได้เมื่อไม่มี dependency ระหว่างกัน, write-set ไม่ overlap,
ไม่มี read/write contract conflict, ไม่มี shared database/schema/port/provider
conflict และแต่ละ node มี lease กับ base SHA ของตนเอง

Topological wave เป็นเพียง candidate-parallel ไม่ใช่ permission ให้รันทุกงาน.
ให้ serialize canonical roadmap, PRD, FEATURES, ID ledger, shared schema or
migration ordering, generated projections, target branch merge และ production
target เดียวกัน

Generated output ต้องมี manifest source -> generator -> output พร้อมสถานะ
tracked/build-only/ignored. ห้ามแก้ generated JSON เพื่อกลบ conflict โดยไม่
compose canonical source และรัน generator ใหม่

## 6. Freshness, assignment and PR gates

ตรวจ freshness สามครั้ง:

1. ก่อน dispatch: อ่าน target branch และ required ancestors
2. ก่อน PR/review: ตรวจ target และ contract ที่เกี่ยวข้อง
3. ก่อน merge: ตรวจ PR head, target SHA, ancestors และ CI provenance

กฎบังคับ:

- หนึ่ง active assignment ต่อ node
- หนึ่ง active PR ต่อ node
- branch/worktree แยก ใช้ชื่อ codex/task-slice-attempt
- worker ยืนยัน base SHA, scope และ write-set ก่อนแก้
- replacement ต้อง fence lease เดิมก่อนเริ่ม attempt ใหม่
- ตรวจ branch, PR และ checkpoint เดิมก่อนสร้าง replacement
- ห้าม empty PR หรือ duplicate PR
- target เปลี่ยนหลัง review ให้กลับ integration
- mergeable=true อย่างเดียวไม่ใช่ merge authorization

Merge queue มี controller เดียว. Astra merge เฉพาะ head ที่ตรวจแล้วและ
required checks อ้างถึง head นั้น

## 7. Worker lifecycle and evidence

~~~mermaid
stateDiagram-v2
    [*] --> TRIAGED
    TRIAGED --> PLANNING
    PLANNING --> WAIT_APPROVAL
    WAIT_APPROVAL --> READY
    PLANNING --> READY
    READY --> RUNNING
    RUNNING --> SUBMITTED
    RUNNING --> BLOCKED
    RUNNING --> RECOVERY
    RECOVERY --> READY
    RECOVERY --> NEEDS_DECISION
    SUBMITTED --> REVIEW
    REVIEW --> REWORK
    REWORK --> RUNNING
    REVIEW --> INTEGRATING
    INTEGRATING --> CI
    CI --> REWORK
    CI --> INTEGRATING
    CI --> MERGED
    MERGED --> RECONCILING
    RECONCILING --> CLOSED
    RECONCILING --> BLOCKED
~~~

SUBMITTED ไม่ใช่ CLOSED และ BLOCKED ไม่ใช่ active worker. Worker submission
ต้องมี node, attempt, worker, approval revision, base/head SHA, branch,
worktree, PR, changed paths, acceptance-to-evidence mapping, commands,
environment, exit codes, pass/fail/skipped/flaky counts และ remaining gates
พร้อม owner และ next action

Recovery defaults: acknowledge ภายใน 2 นาที, checkpoint ภายใน 5 นาที,
automatic recovery ได้ 1 ครั้ง, ตรวจ process/branch/worktree/PR ก่อน retry,
failure ซ้ำเปลี่ยนเป็น NEEDS_DECISION และไม่ rerun test เพียงเพื่อหวังผลเขียว

Proof scope ต้องแยก:

| Scope | ความหมาย | ไม่ได้พิสูจน์ |
|---|---|---|
| LOCAL | source/test/build ในเครื่อง | hosted หรือ production |
| ISOLATED | fixture/acceptance แยกสภาพแวดล้อม | provider หรือ production |
| HOSTED_CI | checks บน PR head | production activation |
| FIXTURE | captured vectors/replay inputs | live cross-repository parity |
| PRODUCTION | deployed SHA, authorization, receipt, business check | ระบบอื่นนอก target |

SKIPPED, NOT_RUN, UNKNOWN และ FLAKY ไม่เท่ากับ PASSED. MSP/GKS proof ต้อง
มาจาก receipt ของ repository/service เจ้าของ; zuri-ai ไม่เขียน store ของเขา
โดยตรง

## 8. Review, merge and closeout

ลำดับรวมผล:

~~~text
compose canonical sources
-> regenerate governed/runtime projections
-> programme projection check
-> govern/docs checks
-> tests/build/E2E required by acceptance
-> independent review
-> hosted CI
-> recheck head/target and merge
-> roadmap/SOT reconciliation
-> Mission Control verification and closure receipt
~~~

Implementation merge และ SOT reconciliation เป็นคนละ execution node. Merged
implementation ที่ยังมี owner/provider/production gate ค้างเป็น review ไม่ใช่
done อัตโนมัติ

Closeout ต้องมี acceptance และ dependency receipts ครบ, diff อยู่ใน scope,
merge receipt ตรงกับ head, canonical roadmap กับ generated SOT ตรงกัน,
Mission Control อ้าง source revision ที่ตรวจแล้ว, ไม่มี duplicate owner/PR
และ remaining gates มี owner กับ release condition

Archive ได้เมื่อเก็บ closure receipt แล้ว. ก่อนลบ branch/worktree ให้ตรวจ
unpushed commits, ancestry, patch equivalence, PR, lease และ process ที่ใช้
งานอยู่; clean status ไม่ใช่หลักฐานว่าไม่มีผู้ใช้งาน

รายงาน metric แยกกัน:

~~~text
delivery_progress =
  weighted workstream progress / declared workstream weight

task_closure_ratio =
  closed tasks / scoped tasks

production_acceptance_coverage =
  production criteria with receipts / scoped production criteria
~~~

Freeze denominator ต่อ plan revision. Retry ไม่เพิ่ม progress. Production
ที่ยังไม่ตรวจต้องเป็น NOT_RUN. ETA ใช้ critical path ที่เหลือบวก integration,
CI, rework และ known external wait; owner/MSP/GKS wait ที่ไม่ทราบเวลาแสดง
ETA unknown พร้อม owner ไม่กลบไว้ในตัวเลขเดียว

## 9. TASK-ZAI-056 incident and prevention

เหตุการณ์ที่ตรวจพบ:

- implementation PR #487 merge ที่ 5b2964c5
- roadmap reconciliation PR #485 ขยับ target ไป 45f33d0e
- SOT ถูก dispatch หลายฐาน รวมฐานก่อน #485
- เกิด duplicate reconciliation PR #489 และ #490 ก่อนเลือก #491 เป็น
  candidate ที่ครบ scope
- stale diff พยายามย้อน roadmap records เดิม และทำให้ table, task-container
  YAML และ generated projection ไม่ตรงกัน
- projection เคยเปลี่ยนตามลำดับที่ ignored docs ถูกสร้างก่อน focused test

Prevention gate:

~~~text
ก่อน TASK-ZAI-056/sot-reconcile:
1. verify #487 merge receipt
2. verify #485 เป็น ancestor ของ selected base
3. acquire exclusive canonical-roadmap/projection lock
4. reject existing assignment หรือ active PR
5. validate diff เทียบ write-set และ prior task records
6. regenerate จาก canonical source และรัน CI-equivalent order
7. revalidate target SHA ก่อน merge
8. require SOT/Mission Control closeout ก่อนปิด delivery node
~~~

Root cause เชิง orchestration ไม่ใช่ไม่มี topological task DAG แต่ DAG เดิม
ไม่ได้คุม execution attempts, lease, shared-file locks, base freshness,
PR uniqueness หรือ mandatory closeout จึงถูกตีความ candidate-parallel เป็น
permission ให้ทำ reconciliation พร้อมกัน

## 10. Implementation backlog

มาตรฐานนี้ยังไม่ถูก enforce จนกว่างานเหล่านี้และ controlled pilot จะผ่าน:

| Priority | Work | Acceptance |
|---|---|---|
| P0 | Work-packet/node schema และ execution ledger | restore session ได้และ audit transition ได้ |
| P0 | Unique assignment, lease epoch, checkpoint recovery | stale worker publish หลัง replacement ไม่ได้ |
| P0 | SHA freshness และ required-ancestor gate | base ก่อน #485 ถูก reject สำหรับ #056 SOT |
| P0 | Write-set/resource locks และ merge queue เดียว | roadmap/projection มี integrator รายเดียว |
| P0 | PR deduplication และ supersession | replay ไม่สร้าง #489/#490 ซ้ำ |
| P0 | Evidence validator และ mandatory closeout | merge บังคับ SOT/Mission Control reconciliation |
| P1 | Generated-output manifest และ deterministic check | clean/generated workspace ให้ projection เดียวกัน |
| P1 | Timeout/recovery budget และ critical-path ETA | wait แสดงเหตุผล owner และ next action |
| P1 | Mission Control projection | worker, delivery, CI, production แยกสถานะ |
| P1 | Replay #056 acceptance scenario | stale base, duplicate PR, stale CI ถูกจับ |
| P2 | Controlled pilot wave | parallel work + serial integration ปิดได้โดยไม่ซ้ำ owner |

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-21 | candidate | Initial end-to-end multi-agent workflow standard; enforcement backlog remains open. | pending | Astra |
