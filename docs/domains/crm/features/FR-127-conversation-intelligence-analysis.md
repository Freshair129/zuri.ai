---
domain: crm
feature: FR-127
module: crm
source: v2-native
version: "0.2.0b"
created_at: "2026-08-30T00:00:00+07:00,Claude Fable 5"
last_update: "2026-08-30T12:00:00+07:00,Claude Fable 5"
status: "building"
---

# FR-127 — Conversation intelligence analysis

## Intent

บันทึกผลวิเคราะห์ AI ต่อหนึ่ง Conversation ต่อหนึ่งรอบวิเคราะห์ — ประเภทการติดต่อ,
สถานะความสนใจ, CTA ที่พบ, tags และ summary — เพื่อให้ FR-128 (Daily Sales Brief)
สรุปรายวันได้ และ inbox (FR-091) แสดงบริบทได้ โดยความจริงยังอยู่ที่
`Conversation`/`Message` เสมอ แถววิเคราะห์ลบและสร้างใหม่ได้ตลอด (ADR-054 D6)

เอกสารนี้เก็บรายละเอียด field mapping จาก legacy ERD ที่ไม่อยู่ใน ADR — ADR-054
เป็นผู้ตัดสิน "ยืมอะไร ปฏิเสธอะไร"; หน้านี้บันทึก "ยืมแล้วแปลงยังไง" สำหรับ lane
implement ที่จะเขียน schema จริง

## Borrowed-shape mapping (legacy → here)

Prior art: `G:\zuri\docs\architecture\database-erd\full-schema.md` §8
(`ConversationAnalysis`), อ่านอย่างเดียวตาม ADR-024 D7

| Legacy field | ที่นี่ | เหตุผล |
|---|---|---|
| `conversationId FK → Conversation.id` | เหมือนกัน — FK ไป `Conversation.id` (UUID) | legacy ต้องมี gotcha (G-DB-02) กันคนใช้ external id; ของเรา external thread id ไม่ใช่ key อยู่แล้ว (BR-002) |
| `analyzedDate`, `analyzedAt` | คงไว้ทั้งคู่ | วันที่วิเคราะห์คือ key ของการสรุปรายวัน; เวลาจริงคือ provenance |
| `contactType` (NEW_LEAD/RETURNING/SUPPORT) | string enum ใน `src/lib/validation/enums.js` | enum เป็น string เสมอ แหล่งเดียว |
| `state` (HOT/WARM/COLD/CLOSED_WON/CLOSED_LOST) | string enum เดียวกัน | เดียวกัน |
| `cta`, `tags[]`, `summary` | คงไว้; `tags` เก็บเป็น JSON string | SQLite dev ไม่มี array; convention repo นี้เก็บ JSON เป็น string |
| `rawOutput json` | `rawOutputJson` string | retained for audit; ไม่ใช่ contract |
| `revenue float` | **ตัดออก** | เงินเป็นเรื่องของ Orders bundle; ตัวเลขที่ recompute ไม่ได้จากแหล่งจริงคือสิ่งที่ D6 ห้าม |
| `sourceAdId → Ad.adId` | **ตัดออก** | external id เป็น key (BR-002) และยังไม่มี Ad model ให้ผูก — รอ Marketing bundle (ADR-054 D5) |

สิ่งที่แถวนี้ไม่ทำ: ไม่แตะ scope (สืบจาก Conversation ที่ scoped แล้ว — ADR-054 D3),
ไม่ merge identity, ไม่เขียนกลับเข้า LINE (BR-011)

## Siblings in FEAT-014

- FR-126 — `CustomerProfile` (mapping ตรงไปตรงมา: ตัด `cookingLevel` ซึ่งเป็น
  domain เฉพาะโรงเรียนทำอาหารออก เหลือ field กลาง; `motivation[]` เก็บ JSON string
  เช่นเดียวกับ `tags`)
- FR-128 — `DailyBrief` (ตัด `adBreakdown` ออกด้วยเหตุผลเดียวกับ `sourceAdId`;
  key เปลี่ยนจาก "1 brief ต่อวันทั้งระบบ" เป็น `(businessId, briefDate)`)

## Status

🟠 Storage seam implemented — schema ทั้งสอง dialect, enums, writer แบบ
append-only (`recordConversationAnalysis`), reader (`latestAnalysesForDate`)
และเทสต์ integration/unit ครบ (`tests/integration/crm-conversation-intelligence.test.js`,
`tests/unit/conversation-intelligence.test.js`) ทั้งสาม model เข้า `owns_models`
ของ charter แล้ว สิ่งที่ยังไม่มีและเป็น slice ถัดไป: ตัว producer ฝั่ง agent
runtime, LINE delivery ของ FR-128 (BR-011), read surface, และการ apply DDL
เข้า Supabase จริง (`supabase/migrations/20260830150000_conversation_intelligence.sql`
เขียนแล้วแต่ยังไม่ apply — deploy เป็น manual)
