---
id: "GENESIS-RAG-TAXONOMY-CONTRACT"
version: "0.1.0"
created_at: "2026-08-23T00:00:00+07:00, ATHER"
last_update: "2026-08-23T03:50:36+07:00, ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "SmartGift controlled catalog taxonomy and bundle component semantics"
  parent: "GENESIS-RAG-SPEC"
  plan: "GENESIS-RAG-TAXONOMY-IMPLEMENTATION-PLAN"
  risk: "HIGH"
  complexity: "C-3"
  approval: "P0 approved by user, 2026-08-23"
  language: "th-TH"
---

# SmartGift Catalog Taxonomy — P0 Contract

## 0. Approval boundary

เอกสารนี้เป็น P0 contract ที่ได้รับ approval สำหรับ
docs/GENESIS-RAG-TAXONOMY-IMPLEMENTATION-PLAN.md

การอนุมัติเอกสารนี้อนุญาตให้เริ่ม P1 ซึ่งเป็น pure parser และ fixture
เท่านั้น ยังไม่อนุญาตให้เขียน mapping ถาวร, แก้ family_v2, สร้าง taxonomy_v3,
เปลี่ยน retrieval/runtime หรือสร้าง vector index

P0 vocabulary เป็น contract สำหรับ implementation แล้ว แต่ผลลัพธ์
auto/review_required ยังไม่ใช่การอนุมัติ mapping ทางธุรกิจจนกว่าจะผ่าน P2

## 1. Evidence baseline

หลักฐานจาก active pricing snapshot และ
data/genesis_smartgift_store_family_v2/catalog-manifest.json:

| Metric | Current evidence |
|---|---:|
| Source rows | 1,017 |
| Canonical offers | 1,016 |
| Provisional product families | 845 |
| Provisional variants | 1,016 |
| Review-required families | 107 |
| Exact duplicate code | TPT11-7 |
| Conflicting duplicate codes | 0 |
| Existing category nodes | 0 |
| Vector status | not_built |

Source identity:

- path: D:\workspace\smartgift-pricing\public\catalog\giftset.json
- source SHA-256: 5399499d3031ed58be66c958c2ee98fc57401190ee6ddd0a7d40b315842544c2
- active snapshot: d2afc2597c66656a8572a27e4189c99a38f4b1c247b53d32504e39d6ecdddd31

Read-only phrase inspection found 982 names containing + and 35 without +.
There are also names with :, ·, &, packaging text, and MOQ text.
These observations are parser-risk evidence; they are not automatic assignments.

## 2. Terms and count semantics

### 2.1 Terms

| Term | P0 meaning |
|---|---|
| Base category | A controlled product type represented by a stable categoryId; a family may have many |
| Product family | Existing customer-facing family identity from family_v2; taxonomy does not replace its ID |
| Bundle family | A family whose parsed component set contains at least two product components |
| Component | One explicitly evidenced product type inside a family name |
| Offer | One retained source code/pricing record; duplicate source rows do not create a second offer |
| Variant | Current provisional offer-level projection; not claimed to be a confirmed physical variant |
| Packaging metadata | Gift/packing/box/bag wording retained as evidence but excluded from component categories |

### 2.2 Published count definitions

The report must show these counts as separate fields:

| Count | Definition | Baseline / publication rule |
|---|---|---|
| baseCategoryCount | Distinct categoryId with at least one approved assignment | Do not publish candidate-only categories as approved |
| productFamilyCount | Distinct existing familyId | 845 provisional families at current snapshot |
| bundleFamilyCount | Families with two or more evidenced component tokens | Must preserve different signatures as different families |
| variantCount | Distinct current variant IDs | 1,016 provisional; not physical-stock evidence |
| offerCount | Distinct retained offer IDs/source codes | 1,016 canonical offers |
| reviewRequiredFamilyCount | Families with unresolved or ambiguous taxonomy evidence | 107 current family review baseline, subject to P2 reconciliation |
| unclassifiedFamilyCount | Families with no safe category assignment | Report explicitly; never hide in the category total |

baseCategoryCount is not a family count, bundle count, SKU count, or inventory
quantity. A bundle may contribute to several base categories while remaining one
bundle family and retaining every offer.

## 3. Approved P0 controlled vocabulary

The following vocabulary is the approved P0 vocabulary for P1 implementation.
It is not a preselected final count, and auto classification remains subject to
the P2 review gate.

| categoryId | Candidate aliases / phrases | Boundary note |
|---|---|---|
| drinkware | mug, coffee mug, cup, vacuum cup, flask, bottle, tumbler, thermos cup, teapot, tea pot, teacup | cup requires context guard; do not match World Cup |
| umbrella | umbrella, manual umbrella, paradise umbrella | Descriptor stays evidence, not a new category |
| pen | pen, sign pen, fountain pen | Writing instrument family |
| notebook | notebook, A5 notebook, A6 notebook, account book, loose leaf notebook | Size is an option, not a category |
| usb_flash_drive | usb, usb flash drive, flash drive, 16G USB | Capacity is an option |
| power_bank | power bank, magnetic power bank, mag safe power bank, power bank with phone stand, four cables power bank | Integrated stand/cable remains an option |
| fan | fan, handheld fan, turbo handheld fan, mini fan, neck fan, foldable fan | neck fan is not neck_massager |
| humidifier | humidifier | Exact alias only |
| neck_massager | neck massager | Exact alias only; model prefixes are modifiers |
| massage_gun | massage gun | Exact alias only |
| hair_dryer | hair dryer | Brand/model prefixes are modifiers |
| speaker | speaker, bluetooth speaker, speaker clock | speaker clock requires reviewer confirmation |
| earbuds | earbuds | Exact alias only |
| headset | headset | Exact alias only |
| smart_bracelet | smart bracelet | Exact alias only |
| mouse | mouse, wireless mouse | wireless mouse pad is not automatically a mouse |
| keyboard | keyboard, foldable keyboard | Foldable is an option |
| bookmark | bookmark, bookmark with tassel, cloud shape bookmark | Shape/material is an option |
| notebook_refill | refill, ink refill | Ambiguous refill remains review-required without notebook context |
| name_card_holder | name card holder | card bag remains review-required |
| key_chain | key chain, keychain | Both spellings normalize to one ID |
| briefcase | briefcase | Exact alias only |
| bag | bag, business organizer bag | gift bag is packaging metadata, not this category |
| charger | wireless charger, car charger, charging mount | Car-specific combinations require review |
| car_accessory | car wireless charging mount, car parking dual number plate | Candidate category; do not infer from image |
| towel | towel | Exact alias only |
| glove | glove | Exact alias only |
| massage_comb | massage comb, electric massage comb | Exact alias only |
| coffee_maker | coffee maker, pour-over coffee maker | Item-count wording is packaging/configuration metadata |
| tea_set | tea set, teapot, teacup | Split from drinkware only if reviewer accepts the boundary |

Anything outside the accepted vocabulary must be review_required or
unclassified; the parser must not create a category from an arbitrary source phrase.

## 4. Deterministic parser proposal

### 4.1 Normalization

1. Preserve the original name and source evidence unchanged.
2. Apply NFKC, trim, lowercase, and normalize whitespace only for matching.
3. Normalize + spacing so key chain+USB and key chain + USB have the same separators.
4. Normalize spelling variants such as keychain/key chain and usb/USB flash drive
   only through an explicit alias table.
5. Never use price, image, LLM output, or a guessed translation as canonical evidence.

### 4.2 Component extraction

1. Split the primary product phrase on + after normalization.
2. For a name without +, accept a single component only when the complete phrase
   matches an explicit safe alias; otherwise send it to review.
3. Treat a prefix ending in Series or a dated/holiday label as series metadata only
   after an explicit rule match. Do not remove arbitrary text before :.
4. Treat the suffix after · as descriptive evidence only when the primary phrase
   before · already supplies the component set. If not, send the row to review.
5. Preserve modifiers such as color, size, capacity, material, brand, model, and
   temperature display as attributes/evidence; do not turn them into categories.
6. Sort category IDs by their stable ID to build a deterministic componentSignature.
   Different signatures remain different families by default; sharing one component
   never authorizes a merge.

### 4.3 Packaging and commercial text

The following phrases are metadata, not components, when they occur in a packaging or
commercial context: gift set, gift pack, gift packing, gift box, gift bag,
drawer box packing, simple gift bag packing, MOQ, and SETS.

The parser must retain the original phrase and source row as evidence. It must not
silently remove a phrase that could be a product component, such as power bank with
phone stand, speaker clock, or card bag.

### 4.4 Collision and ambiguity rules

- cup must not match World Cup Series; the prefix is not a drinkware component.
- gift bag is packaging metadata; a standalone business organizer bag is a candidate bag.
- refill, card bag, speaker clock, and car-specific phrases require explicit context
  rules or review_required.
- Blank names, names with no safe alias, and names whose separators produce conflicting
  interpretations are unclassified until reviewed.

## 5. Assignment status

FamilyCategoryAssignment.assignmentStatus uses the plan's values:

| Status | Meaning |
|---|---|
| auto | Every emitted token matched an explicit, non-conflicting rule; this is still a proposal until P2 review |
| review_required | At least one token, separator, wrapper, or context is ambiguous |
| approved | A human/business reviewer accepted the mapping and evidence |
| unclassified | No safe category can be assigned from current source evidence |

Every assignment must carry familyId, zero or more categoryId values, ruleVersion,
matched source phrase/field, original source reference, snapshot ID, and a reason
suitable for audit. approved must not be produced by the parser itself.

## 6. Golden sample decisions for P0 review

These are proposed decisions only. They are not persisted mappings.

| Code | Source name | Proposed components / signature | Proposed status | Review point |
|---|---|---|---|---|
| TJS00-1 | Coffee Mug | drinkware / drinkware | auto | Basic alias |
| TDK01-1 | Vacuum Cup with Drawer Box Packing | drinkware / drinkware | auto | Packaging suffix excluded |
| TJS23-2 | Turbo Handheld Fan + Umbrella | fan, umbrella / fan+umbrella | auto | Two-category bundle |
| TDK01-4 | Flask + A5 Notebook + USB + Pen | drinkware, notebook, pen, usb_flash_drive / drinkware+notebook+pen+usb_flash_drive | auto | Alias and size handling |
| TZQ13-2 | World Cup Series: Power bank + Fan | power_bank, fan / fan+power_bank | review_required | World Cup collision and series-prefix rule |
| TJJ01-4 | Speaker + usb flash drive + mouse + keyboard | speaker, usb_flash_drive, mouse, keyboard | auto | Four-component bundle |
| TGC0735 | Notebook + cloud shape bookmark + bookmark with tassel + refill + pen + usb flash drive | notebook, bookmark, notebook_refill, pen, usb_flash_drive | review_required | Duplicate bookmark and refill context |
| GJHD0-1 | Car Wireless Charging Mount+Car parking Dual number plate+Keychain+Car Charger+gift box+gift bag(MOQ 100 SETS) | car_accessory, charger, key_chain | review_required | Packaging/MOQ and car phrase boundaries |
| CER01-5 | blank | none | unclassified | No source name to classify |

The reviewer may accept, split, merge, or reject candidate categories. Any change must
be recorded as a vocabulary/version change before P1 implementation.

## 7. P0 acceptance gate

P0 approval record:

1. User approval received on 2026-08-23 for the count definitions and the separate
   treatment of inventory absence;
2. The vocabulary and split/merge decisions, especially drinkware,
   speaker_clock, tea_set, bag, charger, and car_accessory;
3. the separator, packaging, series-prefix, and alias-collision rules;
4. the golden sample decisions and the unresolved-row policy;
5. Taxonomy contract version 0.1.0.

After P0 approval, P1 may implement only the accepted vocabulary/rules as pure functions
with fixtures. P2 remains a separate review gate for the 107 current review families.
No taxonomy_v3 projection or runtime activation is authorized by this P0 approval.

## References

- GENESIS-RAG-TAXONOMY-IMPLEMENTATION-PLAN.md
- GENESIS-RAG-CATALOG-FAMILY-VARIANT-SPEC.md
- GENESIS-RAG-SPEC.md
- GENESIS-RAG-DB-MIGRATION-REPORT.md
- data/genesis_smartgift_store_family_v2/catalog-manifest.json

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.1.0 | 2026-08-23 | beta | P0 approved by user; authorizes P1 pure parser and fixtures while retaining P2/P3/P4 gates | ATHER |
| 0.1.0b | 2026-08-23 | candidate | Added P0 taxonomy vocabulary, count semantics, parser rules, and golden sample decisions for review | ATHER |
