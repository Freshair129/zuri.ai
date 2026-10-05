---
status: draft
superseded_by: null
version: "0.1.0"
---

# RCA: แก้เอกสาร PM workflow เพื่อป้องกันข้อสรุปที่ขัดกับกฎ

Date: 2026-10-05. Complexity: C-2. Risk: LOW สำหรับร่างเอกสารนี้;
การนำข้อกำหนด workflow ใหม่ไปใช้ต้องได้รับการทบทวนจาก root integrator ตามอำนาจเดิม.

## เป้าหมายและขอบเขต

ใช้ RCA เพื่อเสนอแก้เอกสารกำกับการทำงานของ agent โดยเริ่มจาก
`ZAI:PM-MULTI-AGENT-DELIVERY` (Document 20), packet/receipt ของงาน และ pointer
สำหรับการกลับมาทำงานใน `AGENTS.md`. เป้าหมายคือให้ข้อสรุปอ้างกฎฉบับที่ตรวจจริง
และตรวจพบข้อสรุปที่ขัดกับกฎก่อนเผยแพร่ ไม่ใช่เพิ่มระบบ PM หรือเปลี่ยน product authority.

รายงานนี้เป็น addendum ด้านเอกสารต่อ [RCA เดิม](2026-10-05-pm-spec-dag-two-day-progress-loop.md).
ไม่แทนผล tooling v0.3.0 ที่ตรวจไว้ และไม่เปลี่ยน snapshot/candidate เดิม.
ข้อเสนอด้านล่างยังไม่ได้ใช้กับเอกสาร workflow ต้นทาง.

## Symptom

Agent อ่าน delivery-plan JSON แล้วได้รับค่า `maxAutomaticRepairRounds: 2`
แต่ต่อมาเขียน RCA ว่า `The workflow had no bounded retry rule`.
การเขียนนั้นเป็นข้อสรุปที่ขัดกับหลักฐานของกฎเดิม.
ปัญหาที่ต้องแก้ในเอกสารคือวิธีนำกฎไปผูกกับการตัดสินและตรวจข้อสรุป
ไม่ใช่ตั้งสมมติฐานว่าทั้ง workflow ไม่มีกฎหรือว่า compaction ทำกฎหายแน่นอน.

## Evidence

ใช้ [manifest ของหลักฐานเพิ่มเติม](evidence/2026-10-05-pm-workflow-rule-retrieval/manifest.json)
และ [excerpts](evidence/2026-10-05-pm-workflow-rule-retrieval/excerpts.json).
Manifest SHA-256: `1f214b348b037ad48093e94e17dc01cde76c70cce7e302e8e4624a8f1f616eec`.
Excerpts SHA-256: `bd720eef9ae2767a12241c609eef4a7906174460652d07faba695be0b3fcec94`.
ไฟล์นี้เป็น excerpt จาก `mcp__codex_app__read_thread` ของแชต
`Clarify project manager request`, thread `01a0eb8d-0439-72c1-8685-1f7ba9efd1a6`
บน host ต้นทาง ไม่ใช่ raw rollout หรือ effective model prompt และไม่ได้ลงลายมือชื่อ.

| หลักฐาน | Confidence | สิ่งที่ยืนยันได้ |
|---|---|---|
| Document 20 v0.9.32b, SHA `f502e5e9…`, §10 บรรทัด 398 และ plan v0.9.47b `/repairPolicy/maxAutomaticRepairRounds` | VERIFIED | มีกฎ repair ไม่เกินสองรอบต่อ acceptance revision อยู่แล้ว |
| Excerpts `/policyReadExcerpts` | VERIFIED สำหรับบันทึกที่ API ส่งกลับ | ผลคำสั่งอ่านไฟล์อย่างน้อย 8 รายการคืนกฎสองรอบ; 6 รายการอยู่หลัง compaction ใน turn เดียวกัน |
| `exec-7cda3d74-257f-4cd7-a72b-befb5aafb36f`, exit 0 | VERIFIED สำหรับบันทึก | ผลอ่าน plan คืน `maxAutomaticRepairRounds: 2` และให้ root RCA/Terra scope decision เมื่อครบเพดาน |
| `exec-f9ede844-349f-401d-941b-6dfc4541a658`, exit 0; excerpts `/contradictoryClaim` | VERIFIED สำหรับบันทึก | คำสั่งเขียน RCA มีข้ออ้างว่า workflow ไม่มี bounded retry rule |
| Excerpts `/compactionsBetweenLastSelectedReadAndClaim` | VERIFIED สำหรับลำดับบันทึก | มี 5 compaction events ระหว่างสองคำสั่งข้างต้น |
| Excerpts `/selection` และ `/perTurn` | VERIFIED สำหรับการคัดเลือก | 17 turns ที่เริ่มในช่วง 2026-10-03 02:38 ถึง 2026-10-05 02:38 +07:00 มี 50 compaction events ในรายการที่คืนมา |

เวลาของ turn ไม่ใช่เวลาคำสั่งหรือ compaction; turn อาจทำงานต่อหลังปลายหน้าต่าง.
จึงไม่อ้างว่า 50 events เกิดภายใน 48 ชั่วโมงทั้งหมด หรือใช้ turn starts วัดเวลางาน.
บาง output ถูกตัด ข้อสรุปเรื่องจำนวน policy outputs จึงเป็น lower bound ของข้อความที่เห็น.
API เปิดเผย compaction IDs แต่ไม่เปิดข้อความสรุปหลังย่อ; เนื้อหาที่ model ได้รับจริงยัง UNKNOWN.

แหล่งกฎที่ตรวจ hash แล้วคือ [Document 20 snapshot](evidence/2026-10-05-pm-spec-handoff/source/20-MULTI-AGENT-DELIVERY-PLAN.md)
และ [plan snapshot](evidence/2026-10-05-pm-spec-handoff/inputs/delivery-plan-v0.9.47b-postcomposition.json).
Pack เดิมผ่าน 20/20 snapshot hashes และ 49/49 archive payloads ก่อนนำมาใช้.

## Root Cause และ confidence

**VERIFIED — failure mode ของ RCA:** ข้ออ้างว่าไม่มีกฎจำกัดรอบใน RCA ที่เผยแพร่
ยังขัดกับกฎสองรอบที่มีอยู่. มีทั้งกฎและผลอ่านกฎในบันทึก แต่ไม่ปรากฏผล reconciliation ที่แก้ข้อขัดแย้งนั้นก่อนเผยแพร่.
นี่เป็นข้อบกพร่องของการสังเคราะห์/ตรวจข้อสรุปที่ยืนยันได้; ไม่ได้บอกกลไกภายใน model.

**VERIFIED — ข้อกำหนดทั่วไปมีอยู่แล้ว:** Document 20 §5 กำหนด source digests,
verified digests และ final receipt; §6 กำหนด snapshot คงที่; §10 กำหนด retry/STale;
`AGENTS.md` §21 กำหนดให้ enumerate ก่อนกล่าวว่า artifact ไม่มีอยู่.
จึงไม่อ้างว่าไม่มี source discipline หรือ contradiction rules ทั้ง repository.

**VERIFIED — ช่องว่างของเอกสารเฉพาะที่ตรวจ:** ตาราง packet/receipt ใน Document 20 §5
ไม่มีขั้นตอนเฉพาะที่ผูกการกลับมาทำงานหลัง compaction กับ clause ของกฎ และไม่มี
ตาราง claim-to-rule/counterevidence ก่อนเผยแพร่ RCA. ข้อกำหนดปัจจุบันบอกให้บันทึก
revision/hash/verdict แต่ไม่ได้กำหนดรูปแบบการตรวจข้ออ้างว่า “ไม่มีกฎ” กับ clause ที่เกี่ยวข้อง.
นี่เป็นขอบเขตของ §5 ที่อ่านแล้ว ไม่ใช่ข้ออ้างว่าไม่มีกติกาคล้ายกันในไฟล์อื่นทั้งหมด.

**INFERRED — ปัจจัยทางโครงสร้างเอกสาร:** Document 20 snapshot มี 645 บรรทัด
(นับ line split รวมบรรทัดท้าย), 105,531 bytes; กฎ retry อยู่บรรทัด 398.
ต้นไฟล์มีทั้งกฎ บทบาท และรายละเอียด baseline/receipt จำนวนมาก; §14 เป็นต้นไปมี
ประวัติหลาย snapshot. โครงสร้างนี้อาจทำให้เลือกข้อความเก่าหรือเรียกกฎที่เกี่ยวข้องกลับมา
ได้ยากขึ้นหลัง context เปลี่ยน. ไม่ได้พิสูจน์ว่าความยาวเป็นต้นเหตุหรือว่า historical labels ไม่มีอยู่.

**UNKNOWN — causal mechanism:** ไม่ทราบว่ากฎหลุดจาก compaction summary,
ยังอยู่แต่ถูกตีความผิด, ถูกเหมารวมกับ provenance/tool retries หรือมีเหตุอื่น.
ห้า compactions ระหว่างอ่านกับเขียนผิดเป็นลำดับเหตุการณ์ ไม่ใช่หลักฐานเหตุและผล.
ข้อสรุปว่า agent อ่านแค่ตอนแรกถูกหักล้างด้วยตัวอย่างการอ่านหลัง compaction.

## Why the issue escaped detection

1. Source hash ยืนยัน bytes ที่อ้าง แต่ไม่ยืนยันว่าข้อความสรุปตีความ clause นั้นถูกต้อง.
2. Receipt เดิมรับ revision/hash/verdict โดยยังไม่มีช่องบังคับระบุ clause ที่รองรับข้อสรุป
   และหลักฐานที่ขัดกับข้อสรุปนั้น. กฎทั่วไปไม่ได้สร้างขั้นตรวจเฉพาะสำหรับ RCA claim นี้.
3. Session-start instruction ช่วยเริ่ม session แต่เหตุ compaction ระหว่าง task ต้องมี
   จุดกลับมาทวนข้อกฎใน workflow ด้วย. ไม่มี effective-context capture เพื่อพิสูจน์ว่าหลังย่อยังมีอะไรอยู่.
4. ประวัติและกฎอยู่ในเอกสารเดียวกัน แม้หลายส่วนติดป้าย historical แล้ว.
   การปรับ entry point ให้เลือก clause/current snapshot ชัดขึ้นเป็น prevention ที่เสนอ;
   ยังไม่ใช่ proof ว่าการแยกเอกสารจะแก้เหตุการณ์ย้อนหลัง.

## Proposed document changes

คง identity `ZAI:PM-MULTI-AGENT-DELIVERY`, limit สองรอบ, delegated decision authority,
owner/G0/SPEC gates และ false execution flags เดิม. ไม่สร้าง canonical FR/FEAT,
runtime registry หรือแก้ plan/candidate JSON จากร่างนี้. Packet/receipt เพิ่มเติมเป็น task evidence.

การนำไปใช้ต้องอิง Document 20 ฉบับที่ integrator ถืออยู่จริง ไม่ใช้ branch-base `docs/`
หรือ snapshot นี้ทับ working-tree version ใหม่. Integrator จัดสรร successor version
จาก version ปัจจุบันและบันทึก version diff; ไม่จอง v0.9.33b จาก snapshot เก่า.

### D-1 — เพิ่ม entry point สั้นก่อน §1 โดยไม่คัดลอกกฎเป็น authority ใหม่

ข้อความที่เสนอเพิ่มใน Document 20:

> **ก่อนเริ่ม task และเมื่อกลับมาหลัง compaction**
>
> 1. ตรวจ task ID, scope, selected plan revision/hash, latest decision receipt และข้อห้ามของงานนี้จากไฟล์จริง.
> 2. อ่านข้อกฎที่เกี่ยวข้องโดยใช้ตารางด้านล่าง แล้วแนบ rule-check record ใน task evidence.
> 3. Summary/session note เป็น pointer ให้ค้นต่อ; เมื่อไม่ตรงกับ source ให้หยุดการตัดสินที่พึ่งข้อขัดแย้งและ reconcile ก่อน.
> 4. ยืนยันเพียงการอ่าน/ตีความกฎ ไม่ถือเป็น owner approval, G0 passage หรือ dispatch authority.

| กำลังจะทำอะไร | ข้อกฎที่ต้องทวนจากต้นฉบับ |
|---|---|
| มอบหมาย/รับงาน | §2 บทบาท, §4 gate, §5 packet และ §6 ownership |
| ทำซ้ำ/สร้าง successor | §10 retry, stale dependency และขอบเขตอัตโนมัติ |
| เลือก candidate/ประกอบ pointer | §4 G3/G3b/G4, §5 final receipt, §6 root ownership และ decision receipt ของ exact revision |
| สรุปสถานะ/เขียน RCA | §5 หลักฐาน, §11 metrics, §12 exit criteria และ exact selected plan |

ตารางนี้เป็น navigation; เนื้อหากฎ authoritative ยังอยู่ใน section เดิม.
ไม่ต้องอ่านประวัติทั้งหมดทุก turn. Integrator เพิ่ม stable local anchors ที่ section เดิม
และเชื่อมตารางไปยัง anchors โดยไม่เปลี่ยน document identity หรือ issued requirement IDs.

### D-2 — เพิ่ม rule-check/resume record ที่ §5

ข้อความที่เสนอเพิ่มหลัง Input packet และให้อ้างใน Worker/Verify/Final receipt:

> แนบ rule-check record ต่อ task ที่ใช้ตัดสิน โดยระบุ `taskId`, `action`, เหตุที่อ่าน
> (`TASK_START`, `POST_COMPACTION`, `RULE_CONFLICT` หรือ `SOURCE_CHANGED`),
> source path/document ID/version/raw-byte SHA-256, section locator, relevant clause,
> applicability, read-command/evidence locator และ uncertainty.
> กฎ retry ต้องระบุ revision ที่กำลังตรวจ จำนวนรอบที่มีหลักฐาน และ next permissible action.
> หากประวัติรอบไม่ครบให้ UNKNOWN; ห้ามตั้ง round เป็นศูนย์จากการจำไม่ได้.
> เมื่อ source เปลี่ยน ให้ตรวจ affected meaning ตาม §10; อย่าอ้างว่า hash เดิมยัง current.
> การอ่านแล้วไม่มีข้อสรุป applicability ยังไม่พอสำหรับ action ที่อาศัยกฎนั้น.

ข้อกำหนดนี้ให้เก็บเฉพาะ clause และหลักฐานที่จำเป็น ไม่ขอ private reasoning/chain-of-thought.
เวลาคำสั่งที่ไม่มีในหลักฐานต้อง UNKNOWN; ไม่ใช้ turn-start timestamp สวมเป็น read time.

### D-3 — เพิ่มขั้นตรวจข้อสรุปก่อนส่ง RCA/decision receipt ที่ §5

ข้อความที่เสนอเพิ่ม:

> ก่อนส่ง RCA หรือ decision ให้ทำตาราง `claim → source clause → applicability →
> counterevidence → disposition` สำหรับข้อสรุปที่มีผลต่อการเดินงาน.
> ข้ออ้างว่า “ไม่มีเอกสาร/กฎ/receipt” ต้องระบุขอบเขตที่ enumerate และเนื้อหาที่ตรวจ.
> เมื่อพบ clause หรือ receipt ที่ขัดกับข้ออ้าง ให้แก้ข้อสรุปก่อนส่ง; ถ้าข้อมูลยังไม่ครบให้ UNKNOWN.
> Reviewer ตรวจทั้งการมีอยู่ของ source และความสอดคล้องของข้อสรุปกับ clause.

กรณีนี้ต้องได้ disposition ว่า “มีกฎ acceptance repair สองรอบ;
ความครอบคลุม provenance/tool retry และการปฏิบัติตามในอดีตยังไม่ยืนยัน”.
ห้ามให้ผลว่าไม่มี bounded retry rule เพียงเพราะ summary ไม่กล่าวถึงมัน.

### D-4 — ระบุ applicability ของ retry ใน §10 ให้ตรวจรับได้

คงประโยค repair ไม่เกินสองรอบเดิม และเสนอเพิ่ม:

> ก่อน repeat ให้ระบุว่าเป็น acceptance repair, provenance successor, tool retry
> หรือ review ที่มีหลักฐานใหม่ พร้อม input revision, failure/evidence, owner ของการตัดสิน
> และ stop condition. เพดานสองรอบผูก acceptance revision เดิม; การเปลี่ยนชื่อไฟล์หรือ
> candidate version อย่างเดียวไม่พิสูจน์ว่ามี acceptance revision ใหม่.
> ประเภทอื่นต้องมี explicit applicability/limit decision ก่อน repeat; ไม่ตั้งหนึ่งรอบ
> หรือเพดานใหม่ขึ้นเอง. หากไม่ชัดว่าเข้ากฎใด ให้ NEEDS_DECISION พร้อมคำถามเฉพาะ.

ไม่ใช้การเปลี่ยนประเภท retry เพื่อหลีกเลี่ยงเพดานหรือแก้ owner-blocked decision ด้วยการวน review.
นี่เป็น clarification ที่เสนอสำหรับ review ไม่ใช่หลักฐานว่า agent เกินสองรอบในอดีต.

### D-5 — ทำให้กฎปัจจุบันและประวัติเลือกอ่านได้ชัด

เพิ่ม notice ก่อนประวัติ §14 เป็นต้นไปว่า state/count/hash ในแต่ละ section ผูก
receipt-time snapshot ของตัวเอง. Header/entry point อ้าง current task state จาก
selected plan hash และ latest decision receipt ของ task ไม่ใช้จำนวนที่พบก่อนเป็น current.
คง historical paragraphs, hashes, approvals และ anchors เดิม. ในรอบนี้ไม่ย้าย/ลบประวัติ
หรือเขียน history ใหม่; การแยกเป็นไฟล์ archive อาจพิจารณาภายหลังด้วย path/anchor review.

Proposal สำหรับ `AGENTS.md` §0 เป็น pointer สั้นเพียงหนึ่งย่อหน้า:

> เมื่อกลับมาทำ PM specification task หลัง compaction ให้อ่าน entry point และ
> relevant clauses ของ `docs/architecture/project-manager-system/20-MULTI-AGENT-DELIVERY-PLAN.md`
> จาก source ที่ task เลือก แล้วแนบ rule-check record ตาม §5. Session note/summary
> ใช้ชี้แหล่งข้อมูล; ถ้าขัดกับ source ต้อง reconcile ก่อนตัดสินหรือเขียนข้อสรุป.

Pointer นี้ไม่คัดลอก limit/gates มาเป็นกฎชุดที่สอง. หากใช้จริงต้องให้ integrator
reconcile source/version และ corpus ตามกติกาเดิม; ยังไม่แก้ `AGENTS.md` หรือ corpus ในร่างนี้.

## Acceptance criteria ของการแก้เอกสาร

| Scenario | ผลที่ต้องตรวจรับได้ |
|---|---|
| เริ่ม task/resume โดย summary บอกว่าไม่มีกฎ retry | Record อ้าง clause สองรอบและ source hash; claim reconciliation ปฏิเสธข้ออ้างนั้น |
| หลัง compaction ไม่มีประวัติ attempt ครบ | รายงาน UNKNOWN/NEEDS_DECISION; ไม่ตั้ง count เป็นศูนย์หรือเพิ่มรอบเอง |
| Rename candidate แต่ acceptance เดิม | ไม่ reset เพดานโดยอ้างแค่ชื่อ/version ใหม่; อ้าง applicability decision และหลักฐาน revision |
| เป็น provenance/tool retry | มี class, owner decision และ stop condition ที่ตรวจได้; ไม่เหมารวมกับ repair หรือสร้างเพดานใหม่เอง |
| อ่าน historical count 11/25 แล้วพบ selected plan 12/24 | ใช้ count จาก exact selected snapshot และติดป้าย historical ให้ค่าเดิม |
| Source hash เปลี่ยนหลัง rule check | ตรวจ affected meaning, STALE/HOLD ตามขอบเขตที่เกี่ยวข้อง; ไม่ใช้ receipt เก่าเป็น current |
| ไม่ได้รับ compaction event จาก API | ใช้ trigger เริ่ม task/resume/ก่อน RCA decision ตาม action ที่รู้จริง; ไม่สร้าง event ปลอม |

ตรวจร่างด้วยการอ่านเทียบ parent/peer และ replay สถานการณ์จาก excerpt ก่อน.
เก็บผล reviewer/replay เป็น evidence ของเอกสาร; ไม่เรียกว่า product test หรือ runtime acceptance.
การทดลอง agent หลังใช้ข้อความใหม่ต้องมี exact document revision และ record ที่ตรวจได้
ก่อนกล่าวว่าการแก้เอกสารลด error/loop ได้จริง. Operational replay/adoption ยัง NOT_RUN.

## Validation, limits และ handoff

- PASS: original handoff hashes; supplement byte hashes; การนับ 17 turns/50 compactions,
  8 policy outputs/6 after-compaction และลำดับ 5 events ตรวจจาก excerpt ที่เก็บ.
- PASS: ตรวจประโยค policy และ contradictory claim กับ returned command records;
  ตรวจ draft links/lifecycle และการไม่แก้ source/candidate/pack เดิม.
- NOT_RUN: govern, registry/graph/view/corpus generation, product test/build,
  agent adoption experiment และ runtime. ไม่ขยาย tooling หรือเขียน product code ในงานนี้.
- UNKNOWN: effective prompt/summary หลัง compaction, command-level timestamps,
  reviewer-authorship authenticity และเหตุเชิงกลไกของ model.

Parent/peer: `AGENTS.md` §0/§21, Document 20 §4–§6/§10, Document 08 review evidence,
existing plan `/repairPolicy`, Doc Writer role และ migration governance profile.
Root integrator เป็นผู้ reconcile wording, current version, corpus และ checks ที่ได้รับอนุญาต.
Existing governance HOLD และ owner/G0/SPEC gates คงเดิม; เอกสารนี้ไม่ยก hold.

## Version diff

0.0 → 0.1.0 draft: เพิ่ม bounded document RCA, hashed API excerpts, confidence limits,
และข้อความเสนอแก้ entry point, resume record, claim reconciliation, retry applicability
และ historical navigation. Existing Document 20/AGENTS/plan/candidates remain unchanged.
