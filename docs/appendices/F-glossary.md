# Appendix F — Glossary

| Field | Value |
|-------|-------|
| **Version** | 1.2.0 |
| **Status** | Draft |
| **Last Updated** | 2026-08-16 |

## คำที่เลิกใช้แล้ว (อ่านก่อนเปิดเอกสารเก่า)

| Term | สถานะ | ความหมายตอนนี้ |
|---|---|---|
| "Zuri V2" / "V2" | **เลิกใช้** (ADR-024) | ชื่อเก่าของโปรดัคนี้ — ปัจจุบันคือ **zuri-ai** เฉยๆ ไม่มีเวอร์ชัน คำนี้ในเอกสารก่อน 2026-08-16 เป็นป้ายประวัติศาสตร์ |
| "V1" / "Zuri V1" | **เลิกใช้** (ADR-024) | โปรเจกต์ legacy ที่ `G:\zuri` — **คนละโปรดัค** ไม่ใช่บรรพบุรุษ ไม่มี migration/lift/cutover ใดๆ ทั้งสิ้น |
| `V1-ADR-060` ฯลฯ | fossil | รูปแบบ citation ของแผนที่ตายแล้ว — เจอในเอกสารเก่าได้ ปล่อยไว้ อย่า "ซ่อม" |
| tenant (ความหมาย legacy) | อย่าใช้ | ในโปรเจกต์ legacy คำนี้แปลว่า *ร้านเดียว* — ใน zuri-ai, Tenant คือขอบเขต isolation ตามตารางข้างล่างเท่านั้น |

## ศัพท์ปัจจุบัน

| Term | ไทย (คำที่ใช้ใน UI) | ความหมาย |
|---|---|---|
| Portfolio | เครือ / กลุ่มธุรกิจ | รากของ hierarchy — คำนี้โผล่ใน UI ครั้งแรกเมื่อมีธุรกิจที่ 2 |
| Tenant | (ไม่แสดงใน UI) | ขอบเขต isolation + การแชร์ข้อมูล — หลังบ้านเท่านั้น |
| Business | ธุรกิจ / ร้าน | ธุรกิจปฏิบัติการหนึ่งหน่วย |
| Branch | สาขา | สถานที่ — ไม่มีวันเป็น tenant (BR-001) |
| Workspace | พื้นที่งาน | บริบทการทำงาน scoped กับ portfolio/tenant/business |
| Project | โปรเจกต์ | เป้าหมายที่มีผลลัพธ์ชัด อาจผสมหลาย execution mode |
| Workstream | สายงาน | สายการทำงานขนาน มี executionMode + progressStrategy + weight |
| Execution mode | โหมดการทำงาน | 1 ใน 7 โหมด canonical (BR-004) |
| WorkContainer | กลุ่มงาน | ภาชนะตามระเบียบวิธี: SPRINT, MIGRATION_STAGE, CAMPAIGN_WAVE, … |
| WorkItem | รายการงาน | หน่วยเล็กสุดที่ติดตาม: task, dataset, deal, creative, checklist, … |
| Milestone | หมุดหมาย | จุดตรวจถ่วงน้ำหนัก |
| Gate | ด่านตรวจ | เงื่อนไขต้องผ่าน — required gate ที่ค้าง cap progress ที่ 99% |
| Dependency | ความสัมพันธ์งาน | BLOCKS / REQUIRES / RELATES_TO / START_AFTER / FINISH_BEFORE |
| Progress strategy | วิธีคิดความคืบหน้า | 1 ใน 7 ตาม mode: TASK_WEIGHT … EXPANSION_READINESS |
| Roll-up | ความคืบหน้ารวม | Σ(workstream% × weight) / Σ(weight) |
| PlanEnvelope | ซองแผนงาน | JSON contract ที่ agent/surface ส่งเข้า import pipeline |
| Dry run | ทดลองนำเข้า | ตรวจ + พรีวิว insert/update/conflict โดยไม่เขียนข้อมูล |
| Snapshot | สำเนาสำรอง | JSON ทั้งโดเมนสำหรับ export/restore |
| Human code | รหัสอ่านได้ | `PRJ-…`, `WST-…` — ตัวระบุแสดงผล ไม่ใช่ PK |
| External ID | รหัสจากระบบลูกค้า | core id ของธุรกิจลูกค้า — map ผ่าน ExternalRef ไม่ทับ code |
| AuditEvent | บันทึกเหตุการณ์ | สายเหตุการณ์ append-only ของการเปลี่ยนแปลงสำคัญ |
| FileAsset | ไฟล์ | ตัวตนและ metadata ที่ SQLite เป็นเจ้าของ; content อาจเป็น local file, managed blob หรือ external URL |
| FileLink | ลิงก์ไฟล์ | ความสัมพันธ์รองจาก FileAsset ไปยัง entity view ที่ผ่านการตรวจ scope |
| LocalWorkspaceMount | ตำแหน่งไฟล์ในเครื่อง | absolute root เฉพาะอุปกรณ์; identity ใช้ UUID + relative path ไม่ใช้ root เป็นคีย์ |
| Managed cache | แคชที่สร้างใหม่ได้ | projection ใต้ `.zuri/cache`; ลบได้โดยไม่สูญเสีย domain data |
| Reconcile | กระทบยอดไฟล์ | ตรวจ metadata เทียบ content แล้วเสนอ missing/untracked/relink ก่อน commit |
