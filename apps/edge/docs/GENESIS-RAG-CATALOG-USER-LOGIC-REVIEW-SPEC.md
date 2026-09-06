---
id: "GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW-SPEC"
version: "0.1.0b"
created_at: "2026-08-23T00:00:00+07:00, ATHER"
last_update: "2026-08-23T08:15:53+07:00, ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "Side-by-side SmartGift catalog review using owner-provided product separation logic"
  parent: "GENESIS-RAG-CATALOG-IDENTITY-REVIEW-SPEC"
  approval: "owner approved, 2026-08-23; projection remains review_only"
  risk: "HIGH"
  complexity: "C-3"
  language: "th-TH"
---

# SmartGift Catalog — Owner Logic Side-by-Side Review

## 1. Purpose

สร้างผลลัพธ์ชุดใหม่เพื่อใช้เปรียบเทียบกับ identity review เดิม โดยไม่เขียนทับ
artifact เดิมและไม่เปลี่ยน active catalog, `family_v2`, taxonomy authority,
ราคา, quote หรือ delivery behavior

ผลเดิมที่ต้องคงไว้:

```text
data/catalog_identity_review_v1/identity-review.json
```

ผลใหม่ที่เสนอ:

```text
data/catalog_identity_review_user_logic_v1/identity-review.json
docs/GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW-REPORT.md
```

ขอบเขตการประมวลผลคือ canonical offers ทั้ง catalog ไม่ใช่เฉพาะ 55 รายการที่
ยัง `unclassified`

## 2. Owner separation logic

เจ้าของต้องการนับ “สินค้าจริง” จากตัวตนของสินค้ากายภาพ ไม่ใช่จากจำนวน SKU:

| สิ่งที่พบใน source | การนับ |
|---|---|
| สินค้ากายภาพ/แบบสินค้าเดียวกัน | 1 `ProductMaster` |
| สี ขนาด วัสดุ รุ่น หรือคุณสมบัติ | `PhysicalVariant` ใต้ `ProductMaster` เดิม |
| โลโก้ลูกค้า งานสกรีน งานเลเซอร์ หรือ branding | `CustomizationProfile`/option ไม่ใช่สินค้าใหม่ |
| SKU, ราคา, MOQ, supplier หรือ source code | `CatalogOffer` คงไว้แยกจาก ProductMaster |
| ชุดสินค้า/เซ็ต | `CatalogOffer` ที่มี `CONTAINS_COMPONENT` ไปยังสินค้าจริงหลายชิ้น |

หลักนับคือ:

```text
จำนวนสินค้าจริง = จำนวน ProductMaster ที่ไม่ซ้ำ
จำนวน SKU = จำนวน CatalogOffer
จำนวน Set = จำนวน CatalogOffer ที่มี component ตั้งแต่ 2 ชิ้นขึ้นไป
```

Set เองไม่ถูกนับเป็น ProductMaster เพิ่มอีกหนึ่งรายการ แต่ component ภายในต้องถูก
นับเป็น ProductMaster เมื่อมีหลักฐานระบุได้

## 3. Processing order

ใช้ลำดับเดียวกันกับทุก canonical offer:

1. ตรวจว่าเป็น single offer หรือ set offer
2. แตก component จากชื่อและคำอธิบายที่มีหลักฐาน
3. ลบคำเชิงพาณิชย์ สี โลโก้ และ packaging ออกจาก identity key
4. สร้าง physical anchor ของสินค้าจริง
5. รวม anchor ที่เป็นสินค้ากายภาพเดียวกันเป็น ProductMaster
6. แยกสี/ขนาด/วัสดุ/รุ่นเป็น PhysicalVariant
7. ผูก SKU และ branding กลับด้วย graph edge เดียวต่อความสัมพันธ์
8. จัด component type และ parent/subtype
9. เก็บเหตุผล คะแนน แหล่งข้อมูล และสถานะ review ต่อรายการ

## 4. Hard rules

Hard rule มีผลก่อนคะแนน ถ้าเข้าเงื่อนไขให้ใช้ผลตามกฎและห้ามให้คะแนนสูงลบล้าง:

| Rule | ผลที่บังคับ |
|---|---|
| ชื่อหรือคำอธิบายระบุ `set`, `bundle`, `lovers set` หรือหลาย component ชัดเจน | เป็น CatalogOffer แบบ set; ไม่สร้าง ProductMaster ให้ตัวเซ็ต |
| มีเพียงสี โลโก้ งานสกรีน งานเลเซอร์ ขนาด หรือ packaging ต่างกัน | รวม ProductMaster เดิม; เก็บเป็น variant/customization/offer evidence |
| component signature ต่างกันอย่างมีนัยสำคัญ | ห้าม merge; แยก ProductMaster หรือส่ง review |
| วัสดุ ความจุ ขนาด รุ่น หรือ construction ขัดกัน | ห้าม auto-merge; ส่ง `review_required` |
| มีชื่อแต่ไม่พบ physical anchor หรือ component evidence | `unclassified`; ห้ามเดาประเภทจากราคา |
| คำว่า `box` หรือ `bag` ปรากฏเดี่ยว ๆ | ไม่ถือเป็น set โดยอัตโนมัติ ต้องดู description/component evidence |
| customer logo เป็นเพียง option ของสินค้า | ไม่สร้าง ProductMaster ใหม่ |

ตัวอย่าง owner mapping ที่ต้องอยู่ในผลใหม่:

| Source name | Proposed type | หมายเหตุ |
|---|---|---|
| `Wireless Earphone` | หูฟัง | เก็บ subtype earbuds/headset เป็น review ถ้า source แยกไม่ได้ |
| `Nail Clipper Box` | กรรไกรตัดเล็บ | ถือ `Box` เป็น packaging ตาม owner rule จนกว่าจะมีหลักฐานว่าเป็นหลายชิ้น |
| `Lighter` | ไฟแช็ก | สินค้าจริง 1 ประเภท |
| `2026 Diary` | สมุด/ไดอารี่ | ปีเป็น attribute ไม่ใช่สินค้าใหม่ |
| `Backpack` | กระเป๋า > backpack | parent คือ bag, subtype คือ backpack |
| `Happy Valentine's Day Lovers Set` | Set offer | ไม่ใช่ ProductMaster; ต้องแตก component จากหลักฐาน |

## 5. Identity score

คะแนนใช้เฉพาะเมื่อ hard rules ยังไม่ตัดสินผล คะแนนอยู่ในช่วง 0–100:

```text
IdentityScore =
  0.35 * AnchorAgreement
+ 0.25 * ComponentAgreement
+ 0.20 * PhysicalSpecAgreement
+ 0.10 * NameDescriptionAgreement
+ 0.05 * BrandingPackagingCompatibility
+ 0.05 * SourceLineageSupport
```

แต่ละตัวแปรอยู่ในช่วง 0–100 และต้องเก็บค่าที่คำนวณได้ต่อคู่ที่นำมาเปรียบเทียบ:

| Factor | 100 | 70 | 0 |
|---|---|---|---|
| `AnchorAgreement` | physical anchor ตรงกัน | parent/alias ใกล้กัน | anchor ขัดกัน/ไม่มี |
| `ComponentAgreement` | component signature ตรงกัน | มีหลักฐานบางส่วน | composition ขัดกัน |
| `PhysicalSpecAgreement` | สเปกที่มีตรงกันทั้งหมด | มีข้อมูลไม่ครบ | วัสดุ/รุ่น/ขนาดขัดกัน |
| `NameDescriptionAgreement` | ชื่อ/คำอธิบายยืนยันกัน | คล้ายบางส่วน | ไม่สนับสนุนกัน |
| `BrandingPackagingCompatibility` | ต่างเฉพาะ option | ข้อมูลไม่ครบ | เป็น physical change |
| `SourceLineageSupport` | family/source lineage เดียวกัน | มีความเชื่อมโยงบางส่วน | ไม่มีหลักฐาน |

Threshold หลังผ่าน hard rules:

| Score | Proposed decision |
|---:|---|
| 90–100 | `same_product`, candidate auto |
| 75–89 | `review_required` |
| 0–74 | `kept_separate` หรือ `unclassified` ตามว่ามี anchor หรือไม่ |

คะแนนไม่สามารถเปลี่ยน set ให้เป็น ProductMaster และไม่สามารถลบหลักฐานของ
physical conflict ได้

## 6. Type score

หลังได้ atomic component แล้วจึงจัดประเภท โดยไม่ใช้ type ของ SKU เป็นตัวนับ:

```text
TypeScore =
  0.50 * ExplicitAliasEvidence
+ 0.25 * DescriptionEvidence
+ 0.15 * ParentSubtypeConsistency
+ 0.10 * CrossOfferConsistency
```

เกณฑ์:

| Score | Type status |
|---:|---|
| 90–100 | `classified` |
| 70–89 | `review_required` |
| 0–69 | `unclassified` |

การจัดประเภทต้องเก็บ `typeId`, `parentTypeId`, `matchedAlias`, `evidenceIds`,
`TypeScore` และ `decisionSource=user_logic_v1`

## 7. Output and comparison contract

ผลใหม่ต้องรายงานทั้ง aggregate และ row-level comparison:

- old ProductMaster id/status/type
- new ProductMaster id/status/type
- offer id/source code
- single/set decision
- component links
- IdentityScore และ factor breakdown
- TypeScore และ factor breakdown
- hard rules ที่ถูกใช้
- evidence/source references
- reason ที่ผลใหม่ต่างจากผลเดิม

ผลสรุปต้องแยกอย่างน้อย:

```text
canonicalOfferCount
oldAtomicProductCount
newAtomicProductCount
newClassifiedTypeCount
newReviewRequiredCount
newUnclassifiedCount
setOfferCount
componentLinkCount
oldVsNewChangedCount
```

ทุก offer ต้องอยู่ในผลใหม่ exactly once ในฐานะ single offer หรือ set offer และ
ทุกความสัมพันธ์ต้องเก็บเป็น directed graph edge เพียงทิศทางเดียว

## 8. Safety and acceptance gates

- ห้ามเขียนทับ `data/catalog_identity_review_v1/identity-review.json`
- ต้องตรวจ hash ของ artifact เดิมก่อนและหลังการสร้างผลใหม่
- ห้ามเปลี่ยน active `family_v2`, taxonomy activation, price, quote, stock หรือ delivery
- replay snapshot เดิมสองครั้งต้องได้ผลลัพธ์และ hash เดียวกัน
- รายงานต้องแสดงสูตรและน้ำหนักจริง ไม่สรุปจากคะแนนรวมอย่างเดียว
- รายการที่คะแนนสูงแต่ชน hard rule ต้องยังคงถูกแยกหรือส่ง review ตาม hard rule
- ผลลัพธ์นี้เป็น `review_only` จนกว่าจะมี owner decision แยกต่างหาก

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-23 | beta | Owner approved side-by-side review rules and implementation boundary; active catalog remains unchanged | pending | ATHER |
| 0.1.0b | 2026-08-23 | candidate | Proposed side-by-side catalog review using owner product-separation rules, explicit scoring, and immutable old artifact | pending | ATHER |
