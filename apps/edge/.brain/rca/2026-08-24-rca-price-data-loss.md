---
id: "RCA-PRICE-DATA-LOSS"
version: "0.3.0b"
created_at: "2026-08-24T08:20:00+07:00, Claude Fable 5"
last_update: "2026-08-24T16:25:00+07:00, Claude Fable 5"
status: "candidate"
superseded_by: null
attributes:
  domain: "zuri-edge-device / catalog graph v4"
  scope: "FlowAccount price ingestion into CommercialSKU"
  risk: "HIGH"
  complexity: "C-2"
  language: "th-TH"
---

# RCA — Price data loss: 98 of 216 sellable sets reach the customer with no price

## Symptom

ซูริตอบคำถามราคาไม่ได้สำหรับสินค้าจำนวนมาก ทั้งที่ระบบค้นหาและกราฟทำงานปกติ

- UAT 2026-08-24 (LINE OA): `เครื่องนวดคอ 100 ชุด ราคาเท่าไหร่` → คำตอบแรกคือ
  "เครื่องนวดคอที่เจอในระบบตอนนี้ยังไม่มีราคาค่ะ (priceLadder ว่างทุกตัว)" ทั้งที่
  `TBY01` มีราคาจริง 490 บาท/ชุด ที่ 100 ชุด
- `MET_V4_PRICE_COVERAGE` = **118/216 = 0.546** ในทุก eval run ตั้งแต่
  `BASELINE_SUBSTRING` จนถึง `V4_2026-08-24` — ต่ำกว่าเป้าเดิม ≥ 0.85 อย่างถาวร
- การ์ดของ offer เหล่านี้ส่งถึงลูกค้าโดยมี `selectedPrice: null`

## Evidence

วัดจาก `data/source/flowaccount-product-2026-06-21.xlsx` (sha256
`da7452ffd91baca7c5e24198e0418585f8da17265bd190447f7c83b755fca318`) ผ่าน
`src/rag/v4/flowaccount.ts` และ `buildGraphV4` ณ store run
`2026-08-23T23-40-30-103Z` (schema v4.2):

| ตัวชี้วัด | ค่า |
|---|---|
| base code ทั้งหมด (parsed + name_coded) | 216 |
| base ที่มีราคา > 0 ครบทุก tier | 115 |
| base ที่มีราคาบางส่วน (mixed) | 3 |
| **base ที่ไม่มีราคาเลย (`priceMissing` ทุกบรรทัด)** | **98** |
| ในจำนวนนั้น มาจาก bucket `name_coded` | 87 |
| ในจำนวนนั้น มาจาก bucket `parsed` (มี ProductCode) | 11 |
| CommercialSKU node ทั้งหมดในกราฟ | 656 |
| `MET_V4_PRICE_LINK_COVERAGE` (base ที่มีราคา ถูก link เข้ากราฟครบ) | **118/118 = 1.00** |

ตรวจสอบย้อนไปที่เอกสารต้นทาง (ใบราคา/ใบเสนอราคา PDF ทั้ง 38 ไฟล์ ใน
`Bussiness-01-SmartGift/ใบราคา/`):

- **69 จาก 98** base ที่ไม่มีราคาใน FlowAccount **มีอยู่ในใบราคา PDF** — 55 ตัวอยู่ใน
  `01-ใบเสนอราคา-update12กย68(...).pdf` (110 หน้า, 750 รหัส), 7 ตัวใน
  `02-ใบราคา2025-ชุดของขวัญธุรกิจ`, ที่เหลือกระจายในใบราคารายสินค้า
- ตัวอย่างที่ยืนยันด้วยตา: `TPP00-2`, `TPH00-3`, `TPM00-3`, `MC00-1`, `TPC00-2`,
  `TPF09-2`, `TTT01-4`, `TPY00-3` — ทุกตัวมีตารางขั้นบันได 10/20/50/100/300/500
  พร้อมราคาในใบเสนอราคาหน้า 78–105
- **29 จาก 98** ไม่ปรากฏในใบราคาใดเลย (เช่น `CA188`, `THD004`, `TNW03`,
  `TBHN0-4`, `LED06-1`) — เป็นสินค้าที่ไม่มีราคาจริงในเอกสารชุดนี้

## Root cause

**ราคาหายที่ต้นทาง ไม่ใช่ที่ pipeline.** FlowAccount ถูกใช้เป็น "แหล่งราคาเดียว"
ของ v4 (ADR-006) แต่ตัว export เองมีราคาไม่ครบ:

1. **สาเหตุหลัก (69 ราย):** ราคามีอยู่ในใบราคา/ใบเสนอราคา PDF แต่**ไม่เคยถูกคีย์เข้า
   FlowAccount** — แถวสินค้าถูกสร้างไว้ (มีชื่อ/หมวด Gift Set) แต่ช่อง `UnitPrice`
   เป็น 0 ส่วนใหญ่เป็นแถวที่ไม่มี `ProductCode` ด้วย (bucket `name_coded` 87/98)
   จึงเป็นแถว "ตั้งชื่อไว้ก่อน ยังไม่ผูกราคา"
2. **สาเหตุรอง (29 ราย):** ไม่มีราคาในเอกสารใดเลย — เป็นสินค้าเลิกขาย/ยังไม่ตั้งราคา
   หรือรหัสที่ใช้ภายในเท่านั้น
3. **ตัวขยายผล:** v4 สร้าง `CatalogOffer` จากทุก base code ที่พบใน FlowAccount
   (91 ตัวเป็น `origin: flowaccount_only`) โดยไม่แยกว่า "ขายได้" หรือ "ยังไม่มีราคา"
   offer ที่ไม่มีราคาจึงถูก embed และแข่ง ranking เท่ากับ offer ที่ขายได้จริง
   (ดู §Related fix: priced-first tie-break, commit `7785d0a`)

**pipeline ไม่ได้ทำข้อมูลหาย** — พิสูจน์โดย `PRICE_LINK_COVERAGE = 118/118`:
ทุก base ที่มีราคาใน FlowAccount ถูกแปลงเป็น CommercialSKU และผูก `PRICED_AS`
เข้ากับ CatalogOffer ครบถ้วน ไม่มีการ drop เงียบ (AC-A6 buckets รวม 1,317 แถวพอดี)

**แก้ไข 2026-08-24 (ช่วงบ่าย):** ข้อความข้างต้นถูกต้องเฉพาะสิ่งที่ parser "รู้จัก" —
แต่ parser เองมีช่องโหว่จริง ไม่ใช่แค่ปัญหาข้อมูลต้นทาง 2 จุด (ดู commit ที่แก้ไข):

- **CODE_RX แคบเกินไป:** รหัสรูปแบบ `TFA-2(P-02)-500` (ไม่มีเลขก่อนขีด) และ
  `DY05601(P-09)-20` (เลข 5 หลัก) ถูกจัดเป็น `unparsed` ทั้งที่ `UnitPrice` มีค่าจริง —
  **10 แถวราคาจริง (2 base) หายเข้ากลุ่ม `unparsed` เงียบ ๆ** ไม่ถูกนับใน
  `PRICE_LINK_COVERAGE` เลยเพราะไม่เคยเข้า `lines` ตั้งแต่แรก
- **เงื่อนไข category แคบเกินไป:** `TYZ02-2` (390 บาท) และ `TTT30-1` (220 บาท) มีราคาจริง
  และมีรหัสอ่านได้จากชื่อ (`Model:TYZ02-2`) แต่ช่อง Category ว่าง (ไม่ใช่ "Gift Set")
  จึงไม่เคยถูกเรียก `codeFromName` เลย — หายเข้ากลุ่ม `blank`

รวม **12 แถวราคาจริงหายเพราะ parser** (แยกจาก 98 แถวที่หายเพราะข้อมูลต้นทาง) — ทั้งสอง
กรณีนี้คือ**บั๊ก pipeline จริง** ไม่ใช่ข้อมูลต้นทางหาย แก้ไขและมี regression test คุมไว้
(ดู Proposed prevention #7)

## Why detection escaped earlier

- **สเปกตั้งเป้าจากสมมติฐาน ไม่ใช่จากข้อมูล:** `PRICE_COVERAGE ≥ 0.85` ถูกเขียนก่อน
  วัดจริง โดยเดาว่า FlowAccount = แหล่งราคาที่สมบูรณ์
- **metric เดิมวัดปนกันสองเรื่อง:** "ข้อมูลต้นทางครบไหม" กับ "pipeline ทำงานถูกไหม"
  รวมอยู่ในตัวเลขเดียว ทำให้ค่า 0.546 ตีความไม่ได้ว่าใครผิด — จนกระทั่งแยกเป็น
  `PRICE_LINK_COVERAGE` (gate, 1.00) กับ `PRICE_COVERAGE` (informational, 0.546)
  ใน commit `052d49a`
- **UAT รอบก่อนไม่ได้ทดสอบสินค้าที่ไม่มีราคา:** query ที่ใช้ตรวจ (`แก้ว`, `ร่ม`,
  `TBY01`) ล้วนเป็นสินค้าที่มีราคา ปัญหาจึงโผล่ครั้งแรกใน UAT จริงบน LINE
- **ranking ปิดบังอาการ:** e5 score ของสินค้ากลุ่มเดียวกันต่างกัน < 0.01 ทำให้ offer
  ที่ไม่มีราคาขึ้นก่อน offer ที่มีราคาแบบสุ่ม ผลลัพธ์จึง "บางครั้งตอบราคาได้ บางครั้งไม่ได้"
  ซึ่งอ่านเหมือนบั๊กระบบมากกว่าปัญหาข้อมูล

## Proposed prevention

1. **Data (เจ้าของ: ฝ่ายขาย/จัดซื้อ — งานหลัก):** คีย์ราคาของ **69 base** ที่มีอยู่ใน
   ใบราคา PDF เข้า FlowAccount ให้ครบทุกขั้นบันได แล้ว export ใหม่ →
   `PRICE_COVERAGE` จะขึ้นเป็น ~184/216 = 0.85 ทันทีโดยไม่ต้องแก้โค้ดใด ๆ
2. **Data (เจ้าของ: ฝ่ายขาย):** ตัดสินใจกับ **29 base** ที่ไม่มีราคาที่ไหนเลย — ถ้าเลิกขาย
   ให้ mark inactive ใน FlowAccount (`**ไม่ใช้งานแล้ว**`) เพื่อให้หลุดจากกราฟตามกติกา
   bucket `inactive` ที่มีอยู่แล้ว
3. **Guardrail (โค้ด, ทำแล้ว):** `PRICE_LINK_COVERAGE = 1.00` เป็น gate ของ eval;
   `PRICE_COVERAGE` รายงานอย่างเดียว — ป้องกันไม่ให้ปัญหาข้อมูลไปบล็อกการ ship โค้ด
   และไม่ให้ปัญหาโค้ดซ่อนอยู่หลังตัวเลขข้อมูล
4. **Guardrail (โค้ด, ทำแล้ว):** priced-first tie-break เมื่อ query มีจำนวน/งบ
   (commit `7785d0a`) — สินค้าที่ขายได้จริงต้องไม่แพ้ near-tie ให้สินค้าที่ยังไม่มีราคา
5. **Guardrail (โค้ด, ทำแล้ว 2026-08-24):** ingest เขียน `review/unpriced-offers.jsonl`
   ทุกครั้ง (base, ชื่อ, bucket, qty tiers, พบในใบราคาไฟล์/หน้าไหน) — join กับ
   `data/source/price-pdf-index.json` ซึ่ง generate ด้วย `scripts/build-price-pdf-index.py`
   (สแกน PDF ทั้ง 38 ไฟล์อัตโนมัติ ยืนยันตัวเลข 69/98 ของ RCA ฉบับนี้) และมี
   `scripts/build-unpriced-worklist-xlsx.ts` แปลง worklist เป็น Excel ให้ฝ่ายขายคีย์
6. **Process:** ทุกครั้งที่ตั้ง target ของ metric ใหม่ ต้องวัด baseline จากข้อมูลจริงก่อน
   เขียนตัวเลขลงสเปก (บทเรียนตรงกับ §8.4 ของสเปก v3)
7. **Guardrail (โค้ด, ทำแล้ว 2026-08-24 บ่าย):** แก้ `CODE_RX`/`NAME_RX` ให้รับรูปแบบ
   `TFA-2(P-xx)-yyy` (ไม่มีเลขก่อนขีด) และเลขฐาน 5 หลัก (`DY05601`) — กู้คืน **10 แถวราคาจริง**
   ที่เคยหายเข้ากลุ่ม `unparsed`; เพิ่มเงื่อนไข "Category ว่าง + มี `Model:` ในชื่อ + ราคา > 0"
   ให้ `codeFromName` กู้คืนอีก **2 แถว** (`TYZ02-2`, `TTT30-1`) เดิมทดสอบแบบเหมารวม
   (category ว่างทุกแถว) แล้วพบว่าดึง noise เข้ามา 142/144 แถว (ราคา 0 ทั้งหมด บางแถวเป็น
   false positive เช่น `IN1` จาก "สาย USB 3 in1") จึงล็อกเงื่อนไขด้วยราคา>0 แทน —
   ดูรายละเอียดเหตุผลใน commit และ regression tests ใน `tests/unit/v4-flowaccount.test.ts`

## Resolution boundary

- RCA ฉบับนี้ **ไม่แก้ข้อมูล** — ไม่มีการแก้ FlowAccount export, ไม่มีการเดาราคาใส่กราฟ
  และไม่มีการเปลี่ยน store run
- โค้ดที่แก้ไปแล้วในระหว่างการสอบสวน (tie-break, metric split, type classification)
  คือการทำให้ **อาการ**ไม่หลอกลูกค้า ไม่ใช่การแก้ **สาเหตุ** ซึ่งอยู่ที่ข้อมูลต้นทาง
- ราคาบนการ์ดยังต้องมาจาก CommercialSKU เท่านั้น (ADR-006) — ห้ามดึงราคาจาก PDF
  โดยตรงหรือคำนวณจาก `rmb × markup` มาแทน

## Resolution evidence

- store run `2026-08-23T23-40-30-103Z` (schema v4.2): CommercialSKU 656,
  `PRICED_AS` ครบทุก base ที่มีราคา
- eval `V4_2026-08-24` (gate on): `PRICE_LINK_COVERAGE` 118/118 = 1.00 (pass),
  `PRICE_COVERAGE` 118/216 = 0.546 (informational), Recall@5 0.803, NEG 16/16,
  OFFER_SELF 0.9015, p95 129 ms — gate: pass
- UAT LINE OA 2026-08-24 หลังแก้: `เครื่องนวดคอ 100 ชุด` → TBY01 490 บาท/ชุด
  พร้อมขั้นบันได 10/20/50/100/500 = 690/550/520/490/470 ถูกต้องตามใบราคา
- Prevention #5 (2026-08-24): PDF scan อัตโนมัติยืนยัน 69/98 base พบในใบราคา
  (`TPP00-2` หน้า 105, `MC00-1` หน้า 79, `TTT01-4` หน้า 78 ในใบเสนอราคา;
  `CA188`/`THD004`/`TNW03` ไม่พบในไฟล์ใด — ตรงกับการตรวจด้วยตาทุกจุด);
  worklist Excel ส่งฝ่ายขายแล้วที่ `data/review/unpriced-offers-worklist-2026-08-24.xlsx`;
  test suite 535 pass / 0 fail หลังเพิ่ม guardrail
- Prevention #7 (2026-08-24 บ่าย, `SCHEMA_VERSION` v4.2→v4.3): re-ingest store run
  `2026-08-24T08-46-40-226Z` — `CatalogOffer` 1107→1110, `CatalogOfferFlowAccountOnly`
  91→94, `CommercialSKU` 656→669, vectors 1534→1537; `review/unpriced-offers.jsonl`
  98→99 บรรทัด (ลบ `TFA-2`/`DY05601` ออกเพราะมีราคาแล้ว, เพิ่ม `FXD1Y-4` ที่กู้ชื่อได้
  แต่ยังไม่มีราคา — ค้นพบ side effect: `NAME_RX` เดิมไม่รองรับ letter-suffix
  `[A-Z]?` ที่ `CODE_RX` มีอยู่แล้ว ตอนแก้ base pattern ให้เหมือนกันทั้งคู่จึงกู้แถวนี้ได้ด้วย)
- eval หลังแก้ (gate on, 4 รอบติดกันหลัง restart service): `PRICE_LINK_COVERAGE` 1.00,
  Recall@5 53/66 = 0.803, MRR 0.719, NEG 16/16, VARIANT_COVERAGE 0.899,
  OFFER_SELF 0.890, p95 ~95 ms — gate: pass. หมายเหตุ: รอบแรกหลัง ingest วัดได้
  Recall@5 = 0.7879 (52/66) นิ่ง 2 ครั้งติด แต่หายไปเองหลัง restart service แล้วนิ่งที่
  0.803 อีก 3 ครั้งติด (ข้อมูล/โค้ดไม่เปลี่ยนระหว่างนั้น) — ชี้ว่าเป็น process-level
  jitter ตอนโหลด snapshot ของ engine เอง ไม่ใช่ผลจากการแก้ regex; ยังไม่ไล่หา root
  cause ต่อเพราะอยู่นอกขอบเขต RCA นี้ บันทึกไว้เป็นข้อสังเกตสำหรับงานถัดไป
- unit tests: 24/24 ใน `v4-flowaccount.test.ts` (เพิ่ม 12 เคสใหม่ครอบทั้ง 3 การแก้ +
  false-positive guard สำหรับ `CK-003`); suite เต็ม 558 pass / 0 fail
