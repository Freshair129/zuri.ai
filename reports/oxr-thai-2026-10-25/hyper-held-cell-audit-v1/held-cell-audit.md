# Hyper held-cell source audit v1

**Status:** complete, diagnostic source audit. No QA, gold answers, or metrics were opened; no model calls or raw OCR edits were made.

## Cohort and causes

The primary denominator is exactly **239 held source cells** across two tables/pages: 152 population cells on PDF page 2 and 87 economy cells on PDF page 1. Primary causes are exclusive and sum to 239:

- `OCR_VALUE_RECOGNITION`: 23
- `HEADER_BINDING_GEOMETRY`: 129
- `OCR_ROW_GRID_LAYOUT`: 59
- `OCR_CELL_OR_ROW_LABEL_BINDING`: 21
- `CONSERVATIVE_ROW_LABEL_AMBIGUITY`: 7

The 152 population cells were held by the original header-path conflict. The PDF vector grid shows the Thai group spanning three columns, non-Thai spanning three columns, and total occupying the rightmost column across two header rows; raw OCR header labels/boxes fall in those physical vector cells. Of the 152 values, 129 have a unique native PDF numeric word whose normalized token agrees with Paddle, and 23 differ. The 23 glyph differences were visually checked against the original page render.

The 87 economy cells comprise 59 row-sequence mismatches, 21 missing exact row-label OCR boxes, and 7 missing/nonunique row-label spans. The PDF text layer supports row navigation for 13 affected rows, but the vector detector does not recover the month-cell grid (17 vector cells versus the source HTML table row/column topology). Three rows (21, 36, 42) have seven source/PDF numeric tokens in the same order and near the seven month-heading centers; the PDF has no unique vector month-cell boundaries, so this remains row-level support and does not resolve any of the 87 cells.

## Separate collateral check

A separate pageIndex1 check covers **30** PDF numeric-text mismatch candidates that were already outside the held239 cohort. Their original rendered cell crops visually match the clean native PDF text-layer token. These 30 are not added to the primary 239 count. The remaining 65 outside-cohort candidates (43 population pageIndex0 and 22 pageIndex2) were not reviewed here.

## Provenance and limits

The JSON ledger binds all source files, hashes, PDF text/vector records, exact OCR-source quote spans, per-record causes, and the separate 30-cell collateral set. PDF word coordinates are in PDF points; vector cell bounds are explicitly in Paddle page coordinates and use the recorded PDF-to-Paddle scale. Rendered evidence uses the original 300 dpi Poppler page images.

No audit label is a runtime selector or allowlist. Numeric differences remain separate PDF-derived evidence; source OCR has not been corrected. The audit does not assert semantic fact validity or graph admission. Economy row text and horizontal proximity do not prove cell-level month binding.

See `held-cell-audit.json` for the complete 239-record ledger and row/cell evidence.
