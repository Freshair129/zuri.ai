---
id: "GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW-REPORT"
version: "0.1.0b"
created_at: "2026-08-23T00:00:00+07:00, ATHER"
last_update: "2026-08-23T00:00:00+07:00, ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "Side-by-side SmartGift catalog review using owner product-separation logic"
  spec: "GENESIS-RAG-CATALOG-USER-LOGIC-REVIEW-SPEC"
  decision: "review_only"
---

# SmartGift Catalog — Owner Logic Side-by-Side Review Report

## 1. Boundary

ผลนี้เป็น projection ใหม่สำหรับเปรียบเทียบเท่านั้น ไม่เขียนทับผลเดิม

- Snapshot: `5488a37eec8819bf1b744e0a2e6b09e7b7afe832dbcda99cba53ff14859bc8e0`
- Canonical offers: 1016
- Old artifact: `data/catalog_identity_review_v1/identity-review.json`
- Old artifact SHA256: `87d473b870c133abb6ebc4bac1bc3b6d86fc7887d72bb6faf3afc683a985f36b`
- New artifact: `data/catalog_identity_review_user_logic_v1/identity-review.json`
- Decision: `review_only`
- Active family_v2/taxonomy/price/quote/stock/delivery: unchanged

## 2. Before and after

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Atomic ProductMaster | 425 | 427 | 2 |
| Auto identity status | 43 | 42 | -1 |
| Classified type | 370 | 377 | 7 |
| Review-required ProductMaster | 327 | 336 | 9 |
| Unclassified ProductMaster | 55 | 49 | -6 |
| Single offer | — | 30 | — |
| Set offer | — | 986 | — |
| Unclassified offer status | — | 168 | — |
| Component links | — | 3170 | — |
| Changed offers | — | 25 | — |
| Changed ProductMasters | — | 11 | — |

## 3. Separation rule

`ProductMaster` คือสินค้ากายภาพหลักหนึ่งแบบ; สี ขนาด วัสดุ รุ่น และ branding
เป็น variant/option; SKU เป็น `CatalogOffer`; Set เป็น offer ที่ชี้ไปยัง component
ด้วย `CONTAINS_COMPONENT` และไม่ถูกนับเป็น ProductMaster อีกหนึ่งรายการ

Hard rules ถูกใช้ก่อนคะแนน:

1. explicit set/bundle/lovers set เป็น set offer
2. logo/printing/laser/color/size/packaging ไม่สร้าง ProductMaster ใหม่
3. physical component/material/model/capacity conflict ห้าม auto-merge
4. ไม่มี physical anchor หรือ component evidence ให้คงเป็น unclassified
5. คำว่า box หรือ bag เดี่ยว ๆ ไม่ถือเป็น set โดยอัตโนมัติ

## 4. Scoring formula

### IdentityScore

`IdentityScore = 0.35*AnchorAgreement + 0.25*ComponentAgreement + 0.20*PhysicalSpecAgreement + 0.10*NameDescriptionAgreement + 0.05*BrandingPackagingCompatibility + 0.05*SourceLineageSupport`

- 90–100: candidate same product
- 75–89: review_required
- 0–74: unclassified/review according to evidence

### TypeScore

`TypeScore = 0.50*ExplicitAliasEvidence + 0.25*DescriptionEvidence + 0.15*ParentSubtypeConsistency + 0.10*CrossOfferConsistency`

- 90–100: classified
- 70–89: review_required
- 0–69: unclassified

Hard rules override both scores.

## 5. Owner mappings applied

| Source name | Type result |
|---|---|
| Wireless Earphone | audio > earphone |
| Nail Clipper Box | personal_care > nail_clipper |
| Lighter | lifestyle > lighter |
| 2026 Diary | stationery > notebook > diary |
| Backpack | bags > bag > backpack |
| Happy Valentine's Day Lovers Set | set offer; Coffee Mug ×1 + Neck Massage ×1 |
| Portable Tea Pot Gift Set | set offer; Tea Pot ×1 + Tea Cup ×3 |

## 6. Row-level evidence

The JSON artifact stores every offer comparison with old/new ProductMaster IDs,
old/new type IDs, offer kind, component links, factor breakdown, hard rules,
decision source, and change reasons.

## 7. Verification contract

- old artifact is immutable and its hash is recorded above
- new artifact is written to a separate directory
- all offers are represented exactly once as single or set
- graph relationships are stored in one canonical direction
- the same snapshot must replay to the same JSON hash

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-23 | candidate | Generated side-by-side owner-logic review report with scoring and before/after counts | pending | ATHER |
