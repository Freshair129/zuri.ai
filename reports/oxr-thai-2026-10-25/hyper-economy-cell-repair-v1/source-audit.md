# Economy held-cell source audit

Status: COMPLETE_DIAGNOSTIC_SOURCE_AUDIT_NOT_RUNTIME_SELECTION. Frozen old records remain held.

The 87 held legacy records are a table-projection / missing OCR-cell-binding problem, not a numeric OCR recognition failure in this source page. The PDF-visible 13 affected baselines each contain seven physically separated month cells: 91/91 PDF numeric words match 91/91 raw Paddle OCR tokens in exact text and unique transformed boxes. Across the full table there are 37 seven-cell numeric rows (259 cells), including four separate parenthetical percent-change rows, plus two all-n.a. rows and one six-number-plus-n.a. row. Old source rows merge multiple values, lack per-cell OCR boxes/indexes, and include a one-slot cyclic sequence (row 10), displaced label/value (row 10), absent label record (row 21), and next-section heading in a value field (row 20). New PDF/box-derived rows are supported, while old frozen cell records remain held and unchanged.

PDF geometry shows the left-stub divider x=199.34–199.94 pt, data area right edge x=564.0–564.6 pt, seven PDF month-word centers and a 2567 year word centered over the complete month area. There are no internal vertical month rules in the header; slot boundaries are midpoint-derived from PDF header centers, not assumed from Paddle HTML column numbers. Four standalone percent-change lines use the rendered/Paddle delta label (∆%), while PDF text extraction emits (D%); their numeric cells map uniquely, but relation to the preceding line remains adjacency context only.

| Measure | Result |
|---|---:|
| Legacy held records | 87 distinct IDs |
| Existing OCR box / index | 0 / 87 |
| Exact source cell quote checks | 87 / 87 |
| Exact row-label quote checks | 80 / 80 |
| Held physical rows / month cells | 13 / 91 |
| PDF-to-Paddle exact matches on held rows | 91 / 91 |
| Full table rows / cells | 40 / 280 |
| Full table exact PDF/Paddle matches | 280 / 280 |
| Full table controls | 37 numeric (including 4 parenthetical percent rows), 2 all n.a., 1 six numeric + n.a. |
| Partial/footnote baselines rejected | 4 |

The count is 87 legacy records to 91 physical month cells. The legacy table projection contains merged values, displaced text, and a missing row-label record; the new geometry-derived row evidence is a separate diagnostic reconstruction.

## Held-row crosswalk

| Legacy row | PDF left stub | Baseline top (pt) | Old records | Ordered values | Projection evidence |
|---:|---|---:|---:|---|---|
| 10 | - ดัชนีการใช้จ่ายสินค้าไม่คงทน 1/ | 173.963 | 8 | one-slot rotation | value in old label field; row label in old value field; cyclic shift |
| 11 | - ดัชนีการใช้จ่ายสินค้าคงทน 3/ | 199.883 | 7 | exact order | 1 merged value cell(s) |
| 14 | - ยอดจดทะเบียนยานยนต์เพื่อการลงทุนในประเทศ 5/ | 238.763 | 5 | exact order | 1 merged value cell(s) |
| 16 | ดุลเงินสดรัฐบาล (พันล้านบาท) | 277.500 | 5 | exact order | 1 merged value cell(s) |
| 20 | ดัชนีราคาผู้บริโภคพื้นฐาน (ไม่รวมราคาอาหารสดและพลังงาน) 7/ | 329.477 | 6 | exact order | next-section heading in old value field; 1 merged value cell(s) |
| 21 | สินค้าออก8/ | 355.111 | 7 | exact order | legacy row label absent |
| 29 | - ภาครัฐบาล | 458.920 | 7 | exact order | 1 merged value cell(s) |
| 30 | - สถาบันการเงินที่รับฝากเงิน | 471.880 | 7 | exact order | 1 merged value cell(s) |
| 32 | ดุลการช าระเงิน | 497.840 | 7 | exact order | 1 merged value cell(s) |
| 34 | เงินฝากของสถาบันรับฝากเงินรวมตวั๋ แลกเงิน 12/ | 536.857 | 5 | exact order | 1 merged value cell(s) |
| 36 | เงินกู้ยืมและตราสารหนี้ภาคเอกชน 13/ | 562.650 | 8 | exact order | old per-cell OCR box/index missing |
| 38 | อัตราส่วนสินเชื่อต่อเงินฝากและ B/E (ไม่รวม Interbank) | 601.480 | 7 | exact order | 1 merged value cell(s) |
| 42 | - เงินฝากประจ า 1 ปี 14/ | 666.751 | 8 | exact order | old per-cell OCR box/index missing |

## Method and limits

PDF-only row selection used physical baselines, the left stub, and one word in each of seven month intervals before comparing old cell values. The old source-row labels or a vertical/section bracket identify the 13 targeted physical rows; row 21 has no legacy label quote and remains order-linked only. PDF cells and raw Paddle rec_boxes are separately required to occupy the same unique slot/baseline and match text after NFKC/Unicode decimal normalization.

The table year 2567 is centered across the data area; the title independently states December 2567. No inner month rules are drawn, so month boundaries are midpoint-derived from the PDF header centers and clipped by the explicit left/right table boundaries.

All 87 prior IDs/spans/statuses remain unchanged. Crosswalk tokens are exact-source ordered text linked to independently selected PDF rows and source boxes; they do not restore the prior OCR cell identity. No values were corrected and no per-ID audit labels feed runtime selection. No gold, QA, metrics, or model calls were used.

## Evidence and provenance

- JSON ledger: reports/oxr-thai-2026-10-25/hyper-economy-cell-repair-v1/source-audit.json (SHA-256 190c8f009f8a49013bcc96f2b03139a53b30f8766a157b7ef24cef1c9674822a).
- Detailed physical geometry and 40-row/280-cell controls: .local/hyper-economy-cell-repair-20261025/independent-source-geometry-evidence.json (SHA-256 7272ec355d68bcea82e05018fd47577703045b20642b468c1ae7a11ab6052036).
- Input file SHA-256 values are recorded in the JSON.
