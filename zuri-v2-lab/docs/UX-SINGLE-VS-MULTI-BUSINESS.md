# UX Spec — Single-Business vs Multi-Business Owner

| Field | Value |
|-------|-------|
| **Version** | 1.1.0 |
| **Status** | Implemented (FR-020) |
| **Author** | Owen + Claude |
| **Created** | 2026-08-11 |
| **Last Updated** | 2026-08-12 |

> **สถานะการ implement (2026-08-12):** กติกาทั้งหมดในเอกสารนี้อยู่ใน
> `src/lib/shell-mode.js` (`deriveShell`) เป็นฟังก์ชันบริสุทธิ์ที่ ScopeContext,
> Topbar, Overview และ wizard อ่านร่วมกัน — เพิ่มธุรกิจแล้ว UI กางชั้นเองทันที
> ไม่มี setting ให้ตั้ง หลักฐาน: `tests/unit/shell-mode.test.js` (8),
> `tests/integration/adaptive-shell.test.js` (8), `tests/e2e/smoke.spec.js`
> (3 เคส: multi, single, เพิ่มธุรกิจ)
>
> ข้อเบี่ยงเบนที่บันทึกไว้ 2 จุด:
> 1. **"ทุกธุรกิจ" อ่านอย่างเดียว** — หน้า landing ไม่มีปุ่มแก้ไข แต่ไม่ได้บล็อก
>    "New Project" ทั้งดุ้น; wizard จัดกลุ่ม workspace ตามธุรกิจ (optgroup) และ
>    แสดงปลายทางใต้ช่องเลือก การเลือก workspace จึงเท่ากับการเลือกธุรกิจ
> 2. **จำนวนธุรกิจนับจาก scope payload** ไม่ใช่ membership ของผู้ใช้ — MVP มี
>    identity เดียว (local owner) การกรองตาม membership จะมาพร้อม auth จริง
>    ซึ่งอยู่นอกขอบเขต MVP (B4 ฝั่ง service มี `assertWorkspaceInScope` อยู่แล้ว)

หลักการกลาง: **สคีมาเก็บลำดับชั้นเต็มเสมอ (Portfolio → Tenant → Business → Workspace →
Project) แต่ UI แสดงเฉพาะชั้นที่มีทางเลือกมากกว่า 1** โดยอนุมานจากข้อมูลจริง
(นับจำนวน business ที่ผู้ใช้มี membership) — ไม่ใช่ setting ที่ต้องเลือกเอง
และ**ไม่มีหน้า gate คั่นก่อนเข้าแอป**ในทุกกรณี

## Personas

- **Owen A (ธุรกิจเดียว):** ร้านอาหาร 1 แบรนด์ อาจหลายสาขา ไม่รู้จักคำว่า
  Portfolio/Tenant/Workspace — มีแค่ "ร้านของฉัน" กับ "งานที่ต้องเสร็จ"
- **Owen B (หลายธุรกิจ):** ร้านอาหาร + ครัวกลาง + แบรนด์เดลิเวอรี่ ใต้กลุ่มเดียว
  ทีมแยกต่อธุรกิจ ต้องการภาพรวมทั้งเครือ + isolation ระหว่างธุรกิจ

## User stories — กรณี A (ธุรกิจเดียว)

| # | Story | Acceptance |
|---|---|---|
| A1 | เปิดแอปแล้วเห็นงานของร้านทันที ไม่ต้องเลือกอะไรก่อน | landing = Business Overview; ไม่มี selector ใดถามก่อนเข้า |
| A2 | สร้างโปรเจกต์จากเป้าหมาย ("เปิดสาขาเชียงใหม่") โดยไม่ต้องรู้จัก workspace/mode | ฟอร์มถามแค่ชื่อเป้าหมาย+วันเป้า; workspace default อัตโนมัติ; workstream+mode มาจาก planning step |
| A3 | ไม่เห็นศัพท์โครงสร้างที่ไม่เกี่ยว (Portfolio/Tenant/Business selector) | topbar ซ้ายแสดงชื่อ+โลโก้ร้านเป็นข้อความ ไม่ใช่ dropdown |
| A4 | วันที่เพิ่มธุรกิจที่สอง ของเดิมไม่พัง UI แค่กางชั้นเพิ่ม | ปุ่ม "เพิ่มธุรกิจ" ใน Settings; หลังสร้าง → switcher + Portfolio Overview ปรากฏ; ข้อมูลเดิมไม่ต้อง migrate |

## User stories — กรณี B (หลายธุรกิจ)

| # | Story | Acceptance |
|---|---|---|
| B1 | เห็น Portfolio Overview ก่อน: การ์ดสุขภาพทุกธุรกิจ | การ์ดต่อธุรกิจ: weighted progress, open required gates, milestone ใกล้ถึง; คลิกเข้า business scope |
| B2 | สลับธุรกิจได้ 1 คลิกจากทุกหน้า และระบบจำอันล่าสุด | business switcher ที่โซน identity (มุมซ้ายบน topbar); persist selection |
| B3 | งานข้ามธุรกิจอยู่ใน workspace ระดับกลุ่ม | workspace scopeType=PORTFOLIO (เช่น WS-PLATFORM) มองเห็นจากทุก business scope |
| B4 | ผู้จัดการธุรกิจ A เห็นแค่ A | switcher แสดงเฉพาะ business ตาม membership; ฝั่ง service มี isolation guard อยู่แล้ว (`assertWorkspaceInScope`) |
| B5 | แชร์ deep link แล้วเข้า scope ถูกต้องทันที | URL ถือ scope (ผ่าน project id); ไม่มีหน้า gate; ถ้าไม่มีสิทธิ์ → error state บอกเหตุ ไม่ redirect ไปหน้าเลือก |

## กติกา UI (derive จากข้อมูล ไม่ใช่ config)

```text
businesses.length === 1:
  landing            = /overview (business overview ของอันเดียว)
  topbar-left        = โลโก้+ชื่อธุรกิจ (static)
  selectors ที่เห็น    = Project (และ Workspace เฉพาะเมื่อ workspaces > 1)
  vocabulary         = "ร้าน/ธุรกิจของคุณ"; ห้ามคำว่า Portfolio/Tenant โผล่

businesses.length >= 2:
  landing            = /overview (portfolio overview: การ์ดต่อธุรกิจ + roll-up)
  topbar-left        = business switcher (avatar dropdown สไตล์ Slack workspace)
                       + รายการ "ทุกธุรกิจ" สำหรับ mode ภาพรวม
  selectors ที่เห็น    = Business · Workspace · Project
  vocabulary         = "เครือ/กลุ่มธุรกิจ" แทนคำว่า Portfolio ใน copy ไทย

ทุกกรณี: Tenant ไม่ปรากฏใน UI (เป็น isolation boundary หลังบ้านเท่านั้น)
```

## Wireframes

```text
A — ธุรกิจเดียว                            B — หลายธุรกิจ
┌──────────────────────────────┐          ┌──────────────────────────────────┐
│ 🍜 ครัวคุณโอเวน   [โปรเจกต์ ▾]│⌘K 👤     │ [🍜▾] | [Workspace▾] [โปรเจกต์▾] │⌘K 👤
├──────┬───────────────────────┤          ├──────┬───────────────────────────┤
│ side │ งานของร้านวันนี้         │          │ side │ ภาพรวมทั้งเครือ              │
│ bar  │ ▸ เปิดสาขาเชียงใหม่  58% │          │ bar  │ ┌ครัวคุณโอเวน┐┌ครัวกลาง┐┌ฟู้ดทรัค┐
│      │ ▸ แคมเปญ 12.12     31% │          │      │ │58% ·gate 2││74%      ││ 12%  │
│      │ [+ เริ่มจากเป้าหมายใหม่]  │          │      │ └──────────┘└─────────┘└──────┘
└──────┴───────────────────────┘          └──────┴───────────────────────────┘
                                          switcher ▾ = ครัวคุณโอเวน / ครัวกลาง /
                                          ฟู้ดทรัค / ── ทุกธุรกิจ ── / + เพิ่มธุรกิจ
```

## Mapping กับ Zuri v1 layout (topbar = parent modules, sidebar = child)

- Business switcher อยู่โซน identity มุมซ้ายของ topbar (ตำแหน่งโลโก้ Zuri เดิม
  ขยายเป็น dropdown เมื่อ >1 ธุรกิจ) — ไม่แย่งพื้นที่ module nav
- Workspace/Project selector เป็น subheader ของโมดูล Projects ไม่ใช่ระดับ shell
  (จนกว่าจะไปทาง Zuri v2 ที่ workspace เป็น global context — ค่อยยก switcher ขึ้น shell)
- Execution views ยังอยู่ใน project context (tabs) เหมือนเดิม

## การเปลี่ยนสถานะ A → B

1. Settings → "เพิ่มธุรกิจใหม่ในเครือของคุณ" (คำว่า "เครือ" ปรากฏครั้งแรกที่นี่)
2. สร้าง Business ที่สอง (Tenant ใหม่ใต้ Portfolio เดิม — อัตโนมัติ ไม่ถามผู้ใช้)
3. topbar ซ้าย morph จาก static → switcher; landing ครั้งถัดไป = Portfolio Overview
4. ข้อมูลเดิมของธุรกิจแรกไม่ถูกแตะ (schema รองรับอยู่แล้ว)

## สถานะที่ต้องออกแบบเพิ่ม (edge states)

- ธุรกิจเดียวแต่หลาย workspace → Workspace dropdown โผล่เฉพาะจุดที่เกี่ยว
- เปิด deep link ข้ามธุรกิจโดยไม่มีสิทธิ์ → ErrorState "คุณไม่มีสิทธิ์ในธุรกิจนี้" + ปุ่มกลับ
- "ทุกธุรกิจ" mode → มุมมองอ่านอย่างเดียวสำหรับ roll-up; การสร้าง/แก้ไขบังคับเลือกธุรกิจก่อน
- ธุรกิจใหม่ที่ยังไม่มีโปรเจกต์ → empty state พาไป "เริ่มจากเป้าหมายใหม่" (ไม่ใช่ตาราง)
```
