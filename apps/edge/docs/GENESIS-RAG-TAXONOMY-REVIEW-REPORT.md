---
id: "GENESIS-RAG-TAXONOMY-REVIEW-REPORT"
version: "0.2.0"
created_at: "2026-08-23T04:00:12+07:00, ATHER"
last_update: "2026-08-23T04:12:34+07:00, ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "zuri-edge-device"
  scope: "P2 aggregate taxonomy review and reconciliation evidence"
  parent: "GENESIS-RAG-TAXONOMY-CONTRACT"
  report_version: "taxonomy-review-v1"
  rule_version: "taxonomy-p0-v1"
  approval: "P2 approved by user, 2026-08-23; P3 projection approval pending"
  risk: "HIGH"
  complexity: "C-3"
  language: "th-TH"
---

# SmartGift Catalog Taxonomy — P2 Review Report

## 0. Status and data boundary

รายงานนี้เป็น aggregate report ที่ได้รับ P2 approval แล้ว แต่ยังไม่ใช่ signed
business mapping และยังไม่มี category assignment ที่ถือว่า approved

ระบบสร้าง family-level records ใน memory เพื่อคำนวณรายงาน แต่ไม่เขียน row-level
ชื่อสินค้า, mapping, หรือ business data ลง Git, database, family_v2, หรือ taxonomy_v3
เอกสารนี้เก็บเฉพาะ counts, provenance และ reason distribution ที่จำเป็นต่อการตัดสินใจ
P2 approval อนุญาตให้ทำ side-by-side projection proposal ตาม
GENESIS-RAG-TAXONOMY-PROJECTION-SPEC.md แต่ยังไม่อนุญาตให้ activate serving runtime

Unresolved-row policy:

- review_required และ unclassified ต้องแสดงให้เห็นใน review queue
- ห้าม auto-promote เป็น approved
- P3 อาจเก็บเป็น non-authoritative candidate evidence ได้ แต่ห้ามใช้เป็น
  approved category filter หรือเปิด serving runtime ก่อนผ่าน P3/P4/P5 gates

## 1. Provenance

| Field | Value |
|---|---|
| Report version | taxonomy-review-v1 |
| Rule version | taxonomy-p0-v1 |
| Snapshot ID | d2afc2597c66656a8572a27e4189c99a38f4b1c247b53d32504e39d6ecdddd31 |
| Source role | pricing |
| Source path | D:\workspace\smartgift-pricing\public\catalog\giftset.json |
| Source SHA-256 | 5399499d3031ed58be66c958c2ee98fc57401190ee6ddd0a7d40b315842544c2 |
| Raw source rows | 1,017 |
| Canonical offers | 1,016 |

## 2. Family-level result

| Metric | Result | Interpretation |
|---|---:|---|
| Candidate base categories | 29 | Observed by deterministic rules; not approved count |
| Approved base categories | 0 | P2 has not approved assignments |
| Product families | 845 | Existing family identity remains unchanged |
| Bundle families | 753 | At least two parsed component tokens; provisional |
| Variants | 1,016 | Current offer-level projection, not physical-variant proof |
| Offers | 1,016 | Canonical retained offers |
| Existing merge-review families | 107 | Current family_v2 review baseline |
| Merge-review taxonomy status | auto 102 / review_required 5 / unclassified 0 | Cross-dimension reconciliation |
| Taxonomy auto families | 611 | Every emitted component has alias/source evidence |
| Taxonomy review-required families | 222 | Ambiguity or unresolved component context remains |
| Unclassified families | 12 | No safe category assignment from current name evidence |
| Unexplained auto assignments | 0 | P2 invariant passes |

Status reconciliation:

611 auto + 222 review_required + 12 unclassified = 845 product families

The 107 existing multi-offer family review rows are a separate merge-review
dimension and must not be conflated with the 222 taxonomy review rows.

Merge-review reconciliation:

| Existing merge-review status | Taxonomy families | Interpretation |
|---|---:|---|
| auto | 102 | Merge identity review remains open, but taxonomy evidence is deterministic |
| review_required | 5 | Both merge identity and taxonomy evidence need review |
| unclassified | 0 | No merge-review family is unclassified under the current parser |

102 + 5 + 0 = 107 existing merge-review families.

## 3. Candidate category distribution

Counts below are family occurrences by candidate category. They are not approved
category counts and do not represent inventory quantity.

| Category | Families |
|---|---:|
| drinkware | 586 |
| power_bank | 302 |
| umbrella | 262 |
| pen | 254 |
| notebook | 223 |
| usb_flash_drive | 154 |
| neck_massager | 124 |
| fan | 120 |
| speaker | 95 |
| hair_dryer | 51 |
| earbuds | 43 |
| mouse | 36 |
| headset | 11 |
| massage_gun | 25 |
| charger | 23 |
| smart_bracelet | 21 |
| keyboard | 16 |
| bookmark | 16 |
| humidifier | 14 |
| name_card_holder | 14 |
| key_chain | 13 |
| bag | 13 |
| notebook_refill | 10 |
| briefcase | 7 |
| towel | 6 |
| coffee_maker | 4 |
| massage_comb | 2 |
| car_accessory | 1 |
| glove | 1 |

## 4. Review reason distribution

Reason counts are family-level visibility signals. One family may have more than
one reason.

| Reason | Families |
|---|---:|
| unmatched_component | 168 |
| series_prefix | 20 |
| duplicate_component | 30 |
| ambiguous_context | 22 |
| commercial_text | 14 |
| implicit_separator | 3 |
| ampersand_separator | 2 |

No missing_name reason is emitted at family level because the canonical catalog
falls back to the source code when a source name is blank; that family remains
unclassified through unmatched_component.

## 5. P2 approval result

The user approved this aggregate report and the `visible_no_promotion` unresolved-row
policy on 2026-08-23. The approval has these bounded effects:

1. the 29 categories remain candidate vocabulary; no category boundary is promoted
   to an approved business taxonomy;
2. the 222 review-required families remain review_required;
3. the 12 unclassified families remain visible and unclassified;
4. duplicate-component signatures remain explicit review evidence;
5. the report may be used as the input contract for a side-by-side P3 dry-run;
6. `approvedBaseCategoryCount` remains zero, and the active runtime remains on
   `data/genesis_smartgift_store_family_v2`.

P3 must use a non-authoritative candidate relation for these assignments. It must
not emit `BELONGS_TO_CATEGORY` until a later approval records an approved assignment.

## 6. Implementation evidence

The in-memory report builder is implemented at src/rag/taxonomy-report.ts.
Its deterministic fixtures are in tests/unit/genesis-taxonomy-report.test.ts.
The builder preserves family IDs, source codes, offer IDs, variant IDs,
snapshot lineage, matched aliases, source phrases, rule version, and review reasons
without persisting the review output.
The next-stage projection boundary is documented in
GENESIS-RAG-TAXONOMY-PROJECTION-SPEC.md.
The materialization evidence is recorded in
GENESIS-RAG-TAXONOMY-PROJECTION-REPORT.md.

## References

- GENESIS-RAG-TAXONOMY-IMPLEMENTATION-PLAN.md
- GENESIS-RAG-TAXONOMY-CONTRACT.md
- GENESIS-RAG-CATALOG-FAMILY-VARIANT-SPEC.md
- GENESIS-RAG-DB-MIGRATION-REPORT.md

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.2.0 | 2026-08-23 | beta | P2 report and unresolved-row policy approved; P3 remains a non-activating projection gate | ATHER |
| 0.1.1b | 2026-08-23 | candidate | Added merge-review to taxonomy-status reconciliation matrix | ATHER |
| 0.1.0b | 2026-08-23 | candidate | Added aggregate P2 family review counts, provenance, unresolved policy, and approval decisions | ATHER |
