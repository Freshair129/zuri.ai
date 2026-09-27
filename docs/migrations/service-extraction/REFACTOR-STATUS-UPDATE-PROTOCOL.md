---
id: ZAI:REFACTOR-STATUS-UPDATE-PROTOCOL
version: "0.1.0b"
status: candidate
last_update: "2026-09-24T08:30:00+07:00,Claude"
attributes:
  domain: architecture
  scope: service-extraction-status-protocol
relations:
  - type: relates_to
    target: ZAI:ADR-038
---

# Refactor Status Update Protocol — สำหรับทุก session และผู้รวมงาน

วันที่: 24 กันยายน 2026  
ขอบเขต: การรายงาน/รวมสถานะของงาน refactor `Freshair129/zuri.ai`  
เอกสารนี้ไม่อนุญาตให้ merge/deploy เอง และไม่เปลี่ยน prerequisite ของงานเดิม

## 1. แหล่งข้อมูลและผู้เขียน

`REFACTOR-STATUS.md` เป็น **มุมมองประสานงานกลาง** ไม่ใช่หลักฐาน completion ที่อยู่เหนือ source/tests/PR หรือแหล่งเปลี่ยน business requirements

หลักฐานอยู่ใน code commit, service handoff, test artifacts, review/check receipts และ PR state จริง แต่ละ session รับผิดชอบ handoff ของตัวเอง แล้วส่ง delta ให้ integrator อัปเดต board กลางจากหลักฐานเหล่านั้น

| Lane | ไฟล์ handoff ที่เสนอ/reuse เมื่อพบของเดิม | สิทธิ์เขียน board กลาง |
|---|---|---|
| Session 1 | `CONVERSATION-RUNTIME-HANDOFF.md` | เขียนเมื่อเป็น integrator ตาม handoff ล่าสุด |
| Session 2 | `WORK-MANAGEMENT-HANDOFF.md` | ส่ง delta; ไม่ทับแถวคนอื่น |
| Session 3 | `FILE-MANAGEMENT-HANDOFF.md` และ SOT handoff ที่มีอยู่ | ส่ง delta; ห้ามรายงาน prompt เป็น implementation |
| Session 4 | `MARKET-INTELLIGENCE-HANDOFF.md` | ส่ง delta; ไม่เปิด gate ของ session อื่นเอง |

ค่าเริ่มต้น integrator คือ Session 1 ตามแผนเดิม แต่ไม่แปลว่า Session 1 เป็น reviewer อนุมัติงานตัวเอง หากเปลี่ยน owner ต้องมี explicit assignment/handoff

Shared patch อาจเป็น PR อิสระตาม workflow ไม่ต้องยัด Files/Market ลง PR #542 และไม่ต้องรอ CR ทั้งโครงการเพื่อรวม status-only หรือ hotfix patch ที่ปลอดภัย

## 2. เมื่อต้องอัปเดต

อัปเดต owner handoff และส่ง status delta เมื่อ:

- เริ่มงานจริงและบันทึก baseline แล้ว
- จบ tranche/checkpoint หรือมีงานค้างที่จะส่งต่อ
- contract ถูกเสนอ/เปลี่ยน/ตรวจ provider หรือ consumer ผ่าน
- พบ blocker ใหม่ หรือ dependency เดิมถูกปลดล็อกด้วยหลักฐาน
- เปิด/อัปเดต PR, check ผลเปลี่ยน, review/merge เกิดขึ้น
- จะเปลี่ยน worktree/session หรือหยุดการทำงานรอบนั้น

ไม่ต้องเปลี่ยน board ทุกไฟล์ที่แก้หรือทุก test ระหว่างทาง และไม่ตั้ง cron/background watcher โดยไม่มีคำสั่งผู้ใช้

## 3. ขั้นตอนของ session เจ้าของงาน

1. อ่าน repo instructions และ current board/handoff; ตรวจ actual branch/base/head โดยไม่ reset tree
2. เขียนเฉพาะสถานะของตนและ dependencies ที่ตนมีหลักฐาน ไม่อ้างว่า lane อื่นเริ่มหรือเสร็จจากการคาดเดา
3. เพิ่ม/แก้ owner handoff ผ่าน metadata/template ของ repo ระบุ evidence ของแต่ละ claim
4. ส่ง delta พร้อม expected board revision/commit ให้ integrator; ถ้า board เปลี่ยนแล้วให้ reconcile เฉพาะแถวงานตน ไม่ overwrite ทั้งไฟล์
5. ถ้ายังรวม board ไม่ได้ ให้รายงาน `BOARD_UPDATE_PENDING` พร้อม handoff SHA/patch ไม่หยุด owned implementation ที่ไม่รอจุดนั้น
6. ไม่อ้างว่าแจ้ง session อื่นแล้ว หากมีเพียงไฟล์/ข้อความพร้อมส่ง ให้ผู้ใช้หรือเครื่องมือที่ได้รับสิทธิ์ส่งจริง

## 4. ขั้นตอนของ integrator

1. Enumerate หา tracker ที่ canonical อยู่แล้ว ไม่สร้าง board ชื่อใหม่ซ้ำ ถ้ายังไม่มี เสนอใช้ `docs/migrations/service-extraction/REFACTOR-STATUS.md`
2. อ่าน latest base, active PR heads และ owner handoffs ที่ exact commit; เทียบกับ snapshot ไม่ใช้ cached chat เป็น current state
3. ตรวจ delta กับ code/check/PR evidence ที่เข้าถึงได้ หากเข้าถึงไม่ได้ให้คง UNKNOWN/REPORTED ไม่ยกเป็น VERIFIED
4. ตรวจว่า source SHA ของผล test เป็นตัวเดียวกับ code ที่ขออ้าง ถ้า head เปลี่ยน ให้ระบุ `verified_code_sha` เดิมกับ `current_head_sha` ใหม่ และผลใหม่ที่ยัง NOT_RUN
5. Reconcile authoritative rows/IDs/contracts/schema ordering ก่อน regenerate derived docs; ไม่ concatenate generated JSON เพื่อจบ conflict
6. อัปเดตตาราง, gates, diagram, backlog, change log และ observed date ให้ตรงกัน ตรวจว่าไม่เพิ่มวงจร HARD_START ที่ทำทุกงานเริ่มไม่ได้
7. รัน governance/doc checks ที่ repo กำหนดจริง status-only update ไม่ต้องอ้างว่ารัน runtime tests ใหม่ถ้าไม่ได้รัน
8. ส่ง reviewable commit/patch/PR ตาม authorization ไม่ merge/enable auto-merge หรือ production cutover เอง

โปรโตคอลนี้ไม่ได้ติดตั้ง generator หรือ workflow อัตโนมัติให้แล้ว ถ้า repo มี generator เดิมให้ใช้ของเดิมตาม contract; ถ้าจะเพิ่มใหม่ต้องเป็น implementation แยกที่ทดสอบจริง

## 5. Template: owner checkpoint / status delta

คัดลอกโครงนี้ไปปรับใช้ใน handoff ตาม repo metadata จริง ค่าที่ยังไม่ทราบใช้ `unknown/null/NOT_RUN` ไม่เดาเลข ID หรือ SHA

```yaml
# ตัวอย่าง schema รายงาน ไม่ใช่ข้อมูลสถานะจริง
session: S4
workstream: market-intelligence
owner: Session 4 implementation owner
observed_at: null
base_sha: null
code_head_sha: null
handoff_source_commit: null
branch: null
pr_number: null
current_tranche: M0
execution_status: PLANNED
merge_status: UNKNOWN
production_status: NOT_RUN

completed:
  - claim: "ระบุสิ่งที่ implement จริง"
    code_paths: []
    evidence: []
verified:
  - level: ISOLATED_TESTS
    result: NOT_RUN
    verified_code_sha: null
    command: null
    discovered: null
    executed: null
    skipped: null
    exit_code: null
    duration_seconds: null
    environment: null
    evidence: []
remaining:
  - "รายการงานที่ยังไม่ทำหรือยังไม่พิสูจน์"

contracts:
  - name: RawEvidenceReadPort
    provider_owner: Integration owner
    consumer_owner: Session 4
    revision: null
    source_commit: null
    review_status: PROPOSED
    provider_conformance: NOT_RUN
    consumer_conformance: NOT_RUN

blockers:
  - dependency: RawEvidenceReadPort reviewed contract
    kind: CONTRACT
    phase_blocked: M3
    owner_to_unblock: Core/Integration owner + Session 4
    condition_to_unblock: "ระบุ exact artifact/check ที่ต้องส่ง"
    evidence: []
    safe_work_now: ["M0 discovery", "M1 pure-core tests"]

next_action: "คำสั่งหรือไฟล์ต่อไปที่ลงมือได้จริง"
owned_paths: []
shared_changes_requested: []
board_expected_source_commit: null
board_update: PENDING
```

`code_head_sha` ให้ระบุ commit ของ implementation ที่ทดสอบ ไม่ต้องปลอมว่า handoff file รู้ hash ของ commit ที่กำลังจะสร้าง หากมี doc-only commit ภายหลัง ให้บอกสัมพันธ์กับ tested code commit อย่างตรงไปตรงมา

## 6. Evidence rules / ห้ามใช้สถานะลัด

- Prompt delivered = PLANNED ไม่ใช่ IN_PROGRESS
- ไม่มี PR ที่เห็น = UNKNOWN ไม่ใช่ไม่มีงานบนเครื่อง
- PR mergeable = ไม่มี merge conflict ที่ GitHub คำนวณ ไม่ใช่ approved, tested หรือ merged
- Draft PR = reviewable checkpoint ได้ ไม่ใช่หลักฐาน complete extraction
- CI success = checks ของ run นั้นผ่าน; ไม่เพิ่ม coverage ให้สิ่งที่ workflow ไม่เคยรัน
- Image built = image build proof; image-start/workflow proof ต้องมีต่างหาก
- Mock/component tests ผ่าน = isolated proof; real provider/consumer integration ต้องระบุแยก
- Complete runtime extraction ≠ complete data ownership migration ≠ production deployment
- Provider adapter absent/unavailable ไม่ถูกเปลี่ยนเป็น PASS เพราะใส่ fake แล้ว UI แสดงได้
- Gate CR จะเปิดได้เมื่อครบ acceptance/review/required checks/merge/handoff ของ CR ตามแผน ไม่ใช่เพียง workflow เขียว
- Gate FILE หรือ MARKET ผูกกับ exact reviewed revision และ fixtures ไม่ใช่ service ต้อง deploy production ก่อน
- นำ code ไปไว้ repo/service ใหม่ ไม่พิสูจน์ว่า authority/data owner แยกแล้ว
- Completion ของเรื่องหนึ่งไม่อนุญาตให้เริ่ม external repo change หรือ production activity อีกเรื่องโดยปริยาย

## 7. Dependency update rules

ทุก dependency ต้องระบุ consumer phase, provider owner, artifact/contract revision ที่ต้องการ, condition_to_unblock และงานที่ยังทำต่อได้

**ห้ามเขียนเพียง “รอ Session 3”** ให้เขียนเช่น:

```text
ผู้รอ: Session 2 / ย้าย ProjectAttachment caller
สิ่งที่รอ: FilePort ReadExactVersion + AttachReference conformance
ผู้ส่ง: Session 3
เงื่อนไข: reviewed contract commit + provider/consumer tests
ยังทำต่อได้: Work dependency/progress tests ที่ไม่ใช้ Files
ไม่ต้องรอ: SOT editor, LINE capture และ production Files cutover
```

แยก 3 เรื่องเสมอ:
1. architecture runtime dependency (บริการอะไรเรียกอะไรตอนรัน)
2. work sequencing decision (ผู้ใช้ตกลงให้เริ่มงานใดก่อน)
3. shared-file conflict (ใครต้องรวม patch ต่อ)

ห้ามนำ runtime arrow มาแปลเป็น hard-start gate ทุกเส้น ถ้าตรวจด้วย approved contract/fake ได้ ให้ทำ owned work ต่อโดยระบุ integration ที่ยังไม่ผ่าน

## 8. ข้อความสั้นสำหรับส่งเข้า session เดิม

```text
เพิ่มกติกาติดตามงานตาม REFACTOR-STATUS-UPDATE-PROTOCOL.md ที่แนบ
อ่าน REFACTOR-STATUS.md เป็น snapshot แล้วตรวจ actual HEAD/PR/handoff ใหม่
ทุก checkpoint ให้อัปเดต handoff ของ service ที่คุณเป็นเจ้าของ พร้อม
base/head SHA, code/test/integration/CI/merge/deploy states, blockers ที่ระบุ
phase และ condition_to_unblock, งานที่ยังทำต่อได้ และ next exact action
ส่ง status delta ให้ integrator รวม board กลาง ห้าม overwrite แถวคนอื่น
หรือแก้ shared worktree โดยไม่ประสาน ไม่เปลี่ยน prerequisite เดิมเอง
หากไม่มีหลักฐานสถานะ lane อื่นให้ UNKNOWN ไม่คาดเดา
ไม่ตั้ง background monitoring, merge หรือ production deploy เอง
```

## 9. ข้อความเฉพาะสำหรับ integrator (ค่าเริ่มต้น Session 1)

```text
ให้นำ REFACTOR-STATUS.md และโปรโตคอลที่แนบเข้าสู่ canonical migration
coordination docs ตาม repo templates เมื่อได้รับสิทธิ์ใน workflow
ก่อนเพิ่มให้ enumerate tracker เดิม; ถ้ามีให้ reconcile ไม่สร้าง duplicate
ตรวจ main/PR/checks/handoffs ล่าสุดแล้วรักษาข้อมูลที่ใหม่กว่าสnapshot
คุณเป็นผู้รวม status/shared changes ไม่ใช่ผู้ approve งานตนเอง
รวม status delta ของแต่ละ lane จาก exact commits โดยไม่เอา implementation
Files/Market ไปปน Conversation Runtime PR #542
อัปเดตบอร์ดและ dependency graph พร้อม evidence และ change log
ไม่รายงาน DONE จาก CI PASS เพียงอย่างเดียว และไม่เปิด Gate CR จน acceptance,
review, required checks, merge และ handoff ครบจริง
ไม่มีสิทธิ์ merge/deploy/เปิด background watcher จากคำสั่งนี้
```
