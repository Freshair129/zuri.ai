---
id: "GENESIS-RAG-CATALOG-FAMILY-VARIANT-SPEC"
version: "0.5.0b"
created_at: "2026-08-22T00:00:00+07:00, ATHER"
last_update: "2026-08-23T06:18:00+07:00, ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "SmartGift catalog consolidation for GenesisBlock, retrieval, and quotation paths"
  parent: "GENESIS-RAG-SPEC"
  risk: "HIGH"
  complexity: "C-3"
  language: "th-TH"
---

# SmartGift Catalog — Product Family and Variant Contract

## 1. Purpose

ลดรายการ Catalog ที่แสดงต่อผู้ใช้จากระดับ source row/SKU ให้เป็นระดับ **ครอบครัวสินค้า**
โดยยังเก็บสี ขนาด วัสดุ บรรจุภัณฑ์ รูปแบบสกรีน รหัสต้นทาง และราคาไว้ครบถ้วน

สัญญา data model นี้ได้รับอนุมัติให้เริ่ม implementation แล้ว การรวมเป็น derived projection
จะไม่ลบหรือเขียนทับ Source Catalog และ vector/semantic enrichment ยังอยู่นอก gate นี้

## 2. Evidence จากข้อมูลปัจจุบัน

ตรวจ snapshot วันที่ 2026-08-22 จากแหล่งข้อมูลที่ยังอยู่ในขอบเขต:

| Source | Evidence |
|---|---|
| `D:\workspace\smartgift-pricing\public\catalog\giftset.json` | 1,017 pricing rows, 1,016 unique codes; มี duplicate code `TPT11-7` 1 รายการ |

ผลตรวจและข้อจำกัดของ snapshot ที่เหลือ:

1. source นี้มีราคา, code, carton facts บางรายการ และ image reference แต่ไม่มี semantic
   description/category/branding ที่พอใช้ยืนยัน option ได้ครบ
2. ระบบจึงรวมด้วย normalized `englishName/name` เป็น provisional family identity
3. family ที่มีหลาย offer ถูกทำเครื่องหมาย `review_required`; ไม่เลือกราคาใดราคาหนึ่งแทนกัน
4. duplicate code `TPT11-7` เป็น exact duplicate 1 กลุ่ม และไม่มี conflicting duplicate code

สรุป: snapshot นี้ใช้เป็นฐาน `CatalogOffer` และ provisional `ProductFamily` ได้ โดย
color/size/material/packaging ยังเป็น `null` จนกว่าจะมี semantic source หรือ manual mapping

## 3. เป้าหมายและขอบเขต

### In scope

- แยก customer-facing product family ออกจาก source SKU/offer
- แยก physical variant เช่น สี ขนาด capacity วัสดุ รุ่น และ packaging
- แยก branding option ซึ่งเป็นตัวเลือกตอนขอราคา ไม่สร้าง product ซ้ำทุกวิธีสกรีน
- เก็บราคาต้นทุนและ carton facts ต่อ source offer
- สร้าง deterministic family/variant keys และ provenance
- project ความสัมพันธ์นี้เข้า GenesisBlock หลัง contract ผ่าน approval

### Input gate

แหล่ง semantic ที่ถูกนำออกจาก proposal นี้ไม่ถูกใช้ใน runtime ปัจจุบัน การ ingest pricing-only
สร้าง family จากชื่อมาตรฐานได้ แต่ถือเป็น provisional mapping; ตัวเลือกสี/ขนาด/วัสดุ/แพ็กเกจ
ต้องอยู่ใน review หรือ manual mapping จนกว่าจะมีหลักฐานเพิ่ม

### Out of scope

- ลบหรือเขียนทับ source rows
- เดาราคากลางหรือเลือก supplier ที่ถูกกว่าแทนผู้ใช้
- ใช้ LLM ตัดสินการ merge โดยไม่มี rule และ review bucket
- รวมชุดของขวัญที่มีองค์ประกอบใน bundle ต่างกันให้เป็นสินค้าเดียว
- เปิดใช้งาน vector หรือเปลี่ยน answer/delivery path ในเอกสารฉบับนี้

## 4. Canonical model

```text
CatalogSourceRecord
        |
        v
CatalogOffer  --->  ProductVariant  --->  ProductFamily
   |                    |                    |
   |                    +-- HAS_OPTION ------+-- SUPPORTS_BRANDING --> BrandingOption
   +-- FROM_SOURCE                         +-- BELONGS_TO_CATEGORY --> Category
```

### 4.1 ProductFamily

หน่วยที่แสดงเป็นสินค้า 1 รายการใน Catalog สำหรับผู้ใช้ ใช้เมื่อองค์ประกอบสินค้าและ
ความหมายทางการขายเป็นครอบครัวเดียวกัน โดยไม่รวมข้อมูลราคาที่อาจต่างกันของแต่ละ source

ฟิลด์ขั้นต่ำ:

| Field | Rule |
|---|---|
| `familyId` | stable deterministic ID; ไม่ใช้ชื่อที่แสดงเป็น identity |
| `displayName` / `englishName` | ใช้ semantic name เมื่อมี; pricing name เป็น fallback ที่มี provenance |
| `componentSignature` | รายการองค์ประกอบของ bundle ที่ normalize แล้ว |
| `category` | controlled category จาก source; conflict ต้องเข้า review |
| `supportedBranding` | รายการ branding ที่ source ยืนยันหรือ policy อนุญาต |
| `variantIds` | รุ่นย่อยที่ผู้ใช้เลือกได้ |
| `offerIds` | source offers ทั้งหมดที่รองรับ family/variant |
| `mergeStatus` | `auto_merged`, `review_required`, `kept_separate` |
| `catalogVersion` | snapshot id ของ canonical catalog |

### 4.2 ProductVariant

หน่วยที่มีผลต่อ physical product หรือการเลือกสินค้า เช่น สี ขนาด capacity วัสดุ รุ่น
หรือ packaging ที่ทำให้ต้นทุน/สเปกต่างกัน

ฟิลด์ขั้นต่ำ:

| Field | Rule |
|---|---|
| `variantId` | stable ภายใต้ `familyId` |
| `familyId` | parent family ที่ผ่าน rule แล้ว |
| `color` | normalized list; ห้ามใช้ UI hex แทนสีสินค้าจริง |
| `size` / `capacity` | เก็บค่าที่ parse ได้พร้อมหน่วยและ raw text |
| `material` / `model` | เก็บเมื่อ source ระบุชัด |
| `packaging` | แยกจาก component composition; price-affecting ได้ |
| `sourceOfferIds` | offers ที่เป็นรุ่นเดียวกันหรือเป็น candidate |
| `variantStatus` | `confirmed`, `candidate`, `review_required` |

หาก bundle มีองค์ประกอบต่างกัน เช่น มี/ไม่มี power bank, USB, speaker หรือ notebook
ไม่ให้ถือเป็นเพียงสีหรือขนาด ต้องแยก `componentSignature` และโดย default แยก family
จนกว่าจะมีข้อมูลยืนยันว่าเป็น option เดียวกัน

### 4.3 CatalogOffer

ตัวแทน source row ที่มีรหัสและข้อเท็จจริงด้านราคา ใช้เป็น authority สำหรับการคำนวณราคา
และการ trace กลับไปยัง source

ฟิลด์ขั้นต่ำ:

```text
offerId
sourceRole
sourceCode
sourceRowHash
sourceName
rmb
upc
dims
kg
e
image
sourceFileSha256
catalogVersion
```

ห้ามทิ้ง offer เพียงเพราะถูกจัดอยู่ใน family เดียวกัน หากราคา ภาพ รหัส หรือ supplier
ต่างกัน ให้คง offer และทำ mapping ที่ตรวจสอบย้อนหลังได้

### 4.4 BrandingOption

วิธี branding เป็นตัวเลือกของ quote/order ไม่ใช่ product row ใหม่ เมื่อ source รองรับ
เหมือนกัน เช่น:

```text
screen_logo
laser_logo
message_card
```

ตำแหน่งโลโก้ จำนวนสี จำนวนจุดสกรีน ค่าเพลท และค่าบริการต้องอยู่ใน `BrandingOption`
หรือ quote input ที่มี provenance ไม่ควรคูณเป็น SKU สำเนาหลายแถว

ถ้า source ระบุว่าวิธีใดใช้กับ variant บางรุ่นไม่ได้ ให้กำหนด compatibility ต่อ
`ProductVariant` และคืนสถานะ `unavailable` เมื่อเลือกไม่ได้

## 5. Merge rules

### 5.1 Auto-merge ที่อนุญาต

จัดเป็น family เดียวกันได้เมื่อผ่านทุกข้อ:

1. component composition เหมือนกันหลัง normalize
2. physical specification ที่มีผลต่อการขายไม่ขัดกัน
3. ความต่างอธิบายได้ด้วย option ที่รู้จัก เช่น สี ขนาด วัสดุ รุ่น หรือ packaging
4. source lineage และ source code ถูกเก็บเป็น offers แยกกัน
5. ไม่มี conflict ของ category, branding compatibility หรือข้อจำกัดด้านราคา

### 5.2 Candidate ที่ต้อง review

ส่งเข้า `review_required` เมื่อพบอย่างใดอย่างหนึ่ง:

- ชื่อและ description เหมือนกันแต่ราคา, image, dimensions หรือ source code ต่างกัน
- ข้อมูลสีหรือขนาดอยู่ใน free text และ parser ยังยืนยันไม่ได้
- มีหลาย supplier/model ที่อาจเป็นของคนละแบบ
- description ระบุ component ไม่ครบหรือไม่ตรงกับชื่อ bundle
- มี packaging หรือ logo rule ที่อาจทำให้ต้นทุนต่างกัน

กรณีนี้ระบบสร้าง candidate mapping ได้ แต่ห้ามใช้ mapping เป็น canonical merge จนกว่าจะมี
manual decision ที่ versioned

### 5.3 ต้องแยก family

- component composition ต่างกันอย่างมีนัยสำคัญ
- วัสดุหรือรุ่นต่างกันจนสเปก/การใช้งานเปลี่ยน
- category หรือ product type ต่างกัน
- source ไม่พอให้ยืนยันว่าเป็นตัวเลือกของสินค้าชิ้นเดียวกัน

## 6. Quote identity

ราคาและใบราคาต้อง resolve ด้วย key ต่อไปนี้ ไม่ใช้ `familyId` อย่างเดียว:

```text
familyId + variantId + offerId + brandingOptionId + quantity + packagingChoice
```

ถ้า family มีหลาย offers แต่ยังไม่มี rule เลือก offer ให้ตอบ `ต้องขอราคา/เลือก source`
แทนการใช้ราคาต่ำสุดหรือราคาเฉลี่ยโดยอัตโนมัติ

การรวมเพื่อแสดงผลจึงเป็น:

```text
แสดงสินค้า 1 family
  -> แสดงสี/ขนาด/รุ่น/แพ็กเกจเป็น options
  -> เมื่อทำใบราคา ต้อง resolve variant + offer + branding
```

## 7. GenesisBlock projection

Canonical normalized JSON และ merge mapping เป็น authority ของ identity; GenesisBlock เป็น
projection สำหรับ retrieval และ relationship query

node labels ที่เสนอ:

```text
ProductFamily
ProductVariant
CatalogOffer
BrandingOption
Category
```

relationships:

```text
HAS_VARIANT
HAS_OFFER
SUPPORTS_BRANDING
BELONGS_TO_CATEGORY
```

ทุก node ต้องมี `catalogVersion`, `sourceRefs` หรือ `sourceOfferIds` ตามชนิดของ node
และต้องไม่สร้าง global option node ที่มี edge ไม่จำกัดโดยไม่มี filter/bounded traversal

Vector document ในภายหลังให้สร้างอย่างน้อยสองระดับ:

1. family document สำหรับคำค้นสินค้าแบบกว้าง
2. variant/offer document เมื่อคำถามระบุสี ขนาด รุ่น ราคา หรือรหัส

การสร้าง vector ยังอยู่ใน P2 และไม่รวมอยู่ใน approval ของเอกสารนี้

## 8. Deterministic normalization

ขั้น implementation ต้องใช้ parser/versioned rules ที่ตรวจสอบได้:

- uppercase และ trim source code
- normalize whitespace, separator, unit casing และ alias ที่ประกาศไว้
- แยก `Colors:` ออกจาก description โดยเก็บ raw text เดิม
- parse capacity/dimension พร้อมหน่วย; parse ไม่ได้ให้เก็บ raw text และเข้า review
- แยก component tokens จากชื่อ/description โดยไม่ตัดคำที่เป็น model หรือ packaging ทิ้ง
- สร้าง `componentSignature` ที่ sort อย่าง deterministic
- เก็บ `ruleVersion`, `mergeReason`, `mergeConfidence` และ `manualOverrideId`

ห้ามใช้ fuzzy similarity เป็นเหตุผลเดียวในการรวม และห้ามให้ model สร้าง mapping โดยไม่มี
ผลลัพธ์ deterministic ที่ replay ได้

## 9. Deliverables หลัง approval

1. catalog family/variant normalizer แบบ pure function พร้อม fixture จาก source จริง
2. review report แยก `auto_merged`, `review_required`, `kept_separate`
3. canonical snapshot และ mapping ที่ไม่เขียนทับ raw sources
4. Genesis batch projection ที่ไม่สร้าง duplicate family/variant/offer เมื่อ ingest ซ้ำ
5. quote lookup ที่รักษา source offer และไม่เลือกต้นทุนแทนผู้ใช้โดยเงียบ
6. tests สำหรับสี ขนาด packaging branding ราคาแตกต่าง และ ambiguous mapping

## 10. Implementation checkpoint — 2026-08-22

การรันกับ pricing source จริงผ่านแล้ว:

| Metric | Result |
|---|---:|
| Raw pricing rows | 1,017 |
| Canonical offers | 1,016 |
| Product families | 845 |
| Product variants | 1,016 |
| Families requiring review | 107 |
| Exact duplicate source rows | 1 (`TPT11-7`) |
| Conflicting duplicate codes | 0 |
| Graph nodes / edges | 2,877 / 2,032 |
| Vector index | `not_built` |

Native Genesis smoke testผ่าน: pricing-only init, family search และ graph projection
ทำงานได้โดยไม่อ้างอิง semantic download source

## 10.2 Original-product identity review checkpoint — 2026-08-23 (historical v0.1.x)

ก่อนปรับเป็น graph-native ผู้ใช้อนุมัติโมเดล `BaseProduct -> PhysicalVariant -> CatalogOffer ->
CustomizationProfile` ได้สร้าง read-only identity review จาก semantic catalog เป็น
หลักฐานเสริมร่วมกับ pricing source โดยไม่เปลี่ยน active `family_v2`:

| Metric | Result |
|---|---:|
| Provisional base products | 606 |
| Auto base products | 272 |
| Review-required base products | 323 |
| Unclassified base products | 11 |
| Physical variants | 972 |
| Customization profiles | 1 supported set |
| Offers/SKUs retained | 1,016 |
| Bundle products | 518 |

สี, ขนาด, วัสดุ และ packaging ถูกเก็บเป็น variant evidence; branding methods ถูกเก็บ
เป็น customization profile; source code ยังคงเป็น offer identity. รายละเอียดอยู่ใน
`docs/GENESIS-RAG-CATALOG-IDENTITY-REVIEW-REPORT.md` และ artifact ที่ Git-ignored
`data/catalog_identity_review_v1/identity-review.json`.

## 10.1 Active local database migration — 2026-08-22

สร้าง derived store เวอร์ชันใหม่จาก pricing snapshot เดิม โดยไม่เขียนทับ store เก่า:

| Item | Result |
|---|---|
| Active store | `data/genesis_smartgift_store_family_v2` |
| Preserved legacy store | `data/genesis_smartgift_store` |
| Snapshot | `d2afc2597c66656a8572a27e4189c99a38f4b1c247b53d32504e39d6ecdddd31` |
| Source SHA-256 | `5399499d3031ed58be66c958c2ee98fc57401190ee6ddd0a7d40b315842544c2` |
| First init | `ingest_empty_store` |
| Repeat init | `skip_same_snapshot` |
| Vector | `not_built` |

runtime default และ MCP default ชี้ไปที่ active store นี้แล้ว ส่วนการ refresh เมื่อ
snapshot เปลี่ยนยัง fail closed จนกว่าจะสร้าง store version ใหม่หรือสั่ง migration ที่ตรวจสอบแล้ว
ไม่ทำ automatic overwrite.

## 10.3 Graph-native atomic product registry — 2026-08-23

ผู้ใช้อนุมัติให้ใช้ graph relation เป็น cross-link โดยไม่สร้างตารางหรือ edge ย้อนกลับซ้ำ:

- `ProductMaster` เก็บเฉพาะสินค้าชิ้นเดี่ยวและเป็น stable `productId` หลักของสี,
  วัสดุ, ขนาด และคุณสมบัติ;
- `CatalogOffer` เก็บ SKU, ราคา, MOQ และ provenance;
- SKU เดี่ยวใช้ `OFFERS` ไปยัง `ProductMaster`;
- SKU ที่เป็นเซ็ตใช้ `CONTAINS_COMPONENT` หลาย edge ไปยัง `ProductMaster` แต่ละชิ้น;
- edge เก็บ `quantity`, `position`, `role`, `variantId` และ evidence;
- reverse lookup ใช้ incoming traversal/index ของ edge เดิม ไม่เก็บ reverse edge ซ้ำ.

จำนวนสินค้าออริจินอลจะนับจาก atomic `ProductMaster` เท่านั้น ส่วน SKU เซ็ตและ component
link รายงานแยกกัน; `family_v2` ยังคงเป็น runtime/reference boundary จนกว่าการ review จะผ่าน.

ผล P7 ล่าสุดจาก snapshot เดียวกัน: 425 atomic products, 1,126 physical variants,
1,016 offers, 984 set offers, 3,166 component links, graph 2,769 nodes / 10,158 edges;
สถานะ 43 auto, 327 review-required, 55 unclassified.

## 11. Acceptance criteria

- source rows 994/1,017 ยัง trace กลับได้ครบ; ไม่มี destructive deletion
- แสดง catalog ระดับ family ได้โดยไม่ทำให้ offers หาย
- สี/ขนาด/รุ่น/packaging ที่ยืนยันได้แสดงเป็น options
- branding ไม่ทำให้เกิด product duplicates และยังเลือกวิธีสกรีนใน quote ได้
- สินค้าชิ้นเดี่ยวมี stable `ProductMaster.productId` และสี/คุณสมบัติอยู่ใต้ product/variant เดิม
- SKU เซ็ต link ไปยัง atomic components ด้วย edge เดียวต่อ component และค้นย้อนกลับได้
- offer ที่ราคาต่างกันยังคงราคาและ source code แยกกัน
- ambiguous rows ถูกแสดงใน review bucket ไม่ถูก auto-merge
- ingest ซ้ำด้วย snapshot เดิมให้ family/variant/offer counts เท่าเดิม
- exact source code lookup ยังคืน offer เดิมได้
- every result มี `catalogVersion`, source และ merge status
- full test, typecheck, build และ catalog fixture report ผ่านก่อนเปิดใช้งาน

## 12. Approval and remaining gates

ผู้ใช้อนุมัติให้ทำ consolidation implementation และ original-product identity review แล้ว
ผลลัพธ์นี้เป็น beta/local verified; ยังไม่ถือเป็น production-ready จนกว่าจะผ่าน review
bucket, quote UAT และ P2 vector gate

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.5.0b | 2026-08-23 | beta | Approved graph-native atomic ProductMaster registry and single directed SKU component edge | ATHER |
| 0.4.1b | 2026-08-23 | beta | Corrected identity-review evidence extraction so product terms such as coffee are not treated as colors; refreshed counts and review signals | ATHER |
| 0.4.0b | 2026-08-23 | beta | Added the read-only original-product identity review checkpoint without changing family_v2 | ATHER |
| 0.3.0b | 2026-08-22 | beta | Recorded the verified family_v2 database migration, preserved legacy store, and activated the versioned runtime default | ATHER |
| 0.2.0b | 2026-08-22 | beta | Implemented pricing-only family/variant/offer projection, duplicate provenance, and Genesis graph/search integration | ATHER |
| 0.1.1b | 2026-08-22 | candidate | Removed the excluded semantic download source from the consolidation proposal; pricing-only input is offer-level until replacement evidence is approved | ATHER |
| 0.1.0b | 2026-08-22 | candidate | Proposed ProductFamily/Variant/Offer/Branding model and safe merge rules | ATHER |
