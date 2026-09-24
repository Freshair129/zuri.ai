---
id: ZAI:SERVICE-EXTRACTION-COORDINATION-PACK
version: "0.1.0b"
status: candidate
last_update: "2026-09-24T08:30:00+07:00,Claude"
attributes:
  domain: architecture
  scope: service-extraction-coordination-index
relations:
  - type: relates_to
    target: ZAI:ADR-038
---

# Zuri — Session 4 Prompt + Refactor Status

ชุดนี้มี 3 ไฟล์หลัก:

| ไฟล์ | ใช้ทำอะไร | ส่งให้ใคร |
|---|---|---|
| [SESSION-4-MARKET-INTELLIGENCE-CODEX-PROMPT.md](SESSION-4-MARKET-INTELLIGENCE-CODEX-PROMPT.md) | คำสั่ง implementation/extraction พร้อมขอบเขต, phases, contracts, tests และ handoff | Codex Session 4 ใหม่ หรือ session งาน Market เดิมถ้ามี |
| [REFACTOR-STATUS.md](REFACTOR-STATUS.md) | Snapshot S1–S4, งานค้าง, gates, dependency diagrams, ownership และ backlog | ทุก session / ผู้จัดการโครงการ |
| [REFACTOR-STATUS-UPDATE-PROTOCOL.md](REFACTOR-STATUS-UPDATE-PROTOCOL.md) | วิธีส่ง checkpoint/status delta และวิธีรวมสถานะโดยไม่ชนกัน | ทุก session; central board integrator ค่าเริ่มต้นคือ Session 1 |

## ใช้กับ Session 4

แนบทั้ง 3 ไฟล์ แล้วส่ง:

```text
เริ่ม Session 4 — Market Intelligence ตาม prompt ที่แนบ
ใช้ REFACTOR-STATUS.md และ UPDATE-PROTOCOL เป็นกติกาประสานงาน
ตรวจ actual HEAD/worktree/contracts ก่อนเริ่ม อย่าเชื่อ snapshot เป็นสถานะสด
ทำ discovery และ owned implementation ที่ปลอดภัย ไม่ต้องรอ CR/Files เสร็จทั้งชุด
shared integration ให้รอเฉพาะ contract และ patch ownership ที่จำเป็น
ทุก checkpoint อัปเดต Market handoff แล้วส่ง status delta ให้ integrator
ไม่ merge/deploy หรือแตะ production เอง
```

## ใช้กับ Sessions 1–3 ที่มีอยู่แล้ว

ส่งไฟล์สถานะและโปรโตคอลเพิ่มเติม ไม่ต้องนำ prompt Market ไปสั่งให้ทุก session ทำซ้ำ
ข้อความพร้อมใช้ในโปรโตคอล §8 ส่วน integrator ใช้ §9 เพิ่มเติม

Session 2 ยังต้องรอ CR extraction ที่ครบเกณฑ์และ merge ตามแผนเดิม งานวิเคราะห์ read-only ทำได้ก่อน การเพิ่ม Market ไม่เปิด gate นี้เอง

## ที่วางใน repo

ชุดนี้ถูกนำเข้า `docs/migrations/service-extraction/` แล้วเมื่อ 24 ก.ย. 2026 บน branch `feat/market-intelligence-service` (ยังไม่ merge) ซึ่งเป็น path เดียวกับที่ Session 1 ใช้เก็บ `CONVERSATION-RUNTIME-HANDOFF.md` ใน PR #542 ไม่มี tracker เดิมบน `main` ให้ reconcile

| ไฟล์ | เจ้าของ |
|---|---|
| `REFACTOR-STATUS.md` | integrator (ค่าเริ่มต้น Session 1) — นำเข้าตาม snapshot 0.1 โดยไม่แก้เนื้อหา |
| `REFACTOR-STATUS-UPDATE-PROTOCOL.md` | ทุก session อ่าน; integrator ดูแล |
| `SESSION-4-MARKET-INTELLIGENCE-CODEX-PROMPT.md` | Session 4 |
| `MARKET-INTELLIGENCE-HANDOFF.md` | Session 4 — checkpoint M0/M1 จริง |
| `CONVERSATION-RUNTIME-HANDOFF.md` | Session 1 — อยู่ใน PR #542 ยังไม่อยู่ใน branch นี้ |
| `FILE-MANAGEMENT-HANDOFF.md`, `WORK-MANAGEMENT-HANDOFF.md` | Session 3 / 2 — ยังไม่มี; ไม่สร้างแทนเจ้าของ |

สถานะล่าสุดของ Market อยู่ใน handoff ไม่ใช่ใน board: board จะอัปเดตเมื่อ integrator รวม status delta ตามโปรโตคอล

**Market (S4) live state:** ดู `MARKET-INTELLIGENCE-HANDOFF.md` หัวข้อ "Verification" และ "Board delta"

## ขอบเขตความน่าเชื่อถือ

ข้อมูลวันที่ 24 กันยายน 2026: main `fad8ec6…`; PR #542 ยัง draft/partial/not merged ที่ `189c607…`; hosted governance และ edge-ci ผ่านแล้ว ส่วน Files/WM/Market ไม่มี implementation checkpoint ที่ตรวจยืนยันในรอบนี้ จึงไม่เดาว่า agent กำลังรันหรือไม่ทำงาน

เอกสารชุดนี้สร้างในแชต แล้วนำเข้า repo ตามหัวข้อข้างบน ไม่ได้ส่งคำสั่งเข้า session อื่น และไม่ได้ติดตั้งระบบ auto-sync การอัปเดตครั้งต่อไปเกิดเมื่อ session เจ้าของงานและ integrator ทำตามโปรโตคอล
