# Hyper-Extract extraction-primary held-fact audit

This report audits **93 / 93** candidates whose primary cause in the preceding source audit is extraction. It reuses that audit’s frozen candidate, emitter-chunk, OCR row/cell/header, and PDF-page references; it does not read gold, questions, or metrics and performs no new inference or PDF render.

## Primary subtype counts

| Primary subtype | IDs |
|---|---:|
| wrong_header_predicate_metric_or_period | 43 |
| wrong_subject_entity_or_index_routing | 32 |
| duplicate_fact_emission | 7 |
| whole_row_value_not_atomic | 7 |
| missing_or_out_of_chunk_quote | 4 |

Counts are mutually exclusive and sum to 93. OCR faithfulness/layout findings are overlapping contributors, counted separately in the JSON; they are not relabeled as extraction-primary causes.

## Replacement implications

- **Wrong measure/header/predicate/period (43):** a source-native all-row projection can replace model column routing where the frozen OCR cell/header grid is sound. The economy December grid shift and population page-2 parent-header conflict require geometry/header revalidation; selecting against the unchanged grid alone does not establish the binding.
- **Whole-row concatenations (7):** emit individual source cells with their column headers; retain each raw OCR cell verbatim and leave glyph-ambiguous values unresolved.
- **Subject/entity/index routing (32):** derive subject and measure from source table columns rather than paraphrased model fields. Keep the original candidate claim as a separate historical record.
- **Out-of-chunk tokens (4):** the exact token is absent from its emitter chunk. A full source-native parse may independently extract the source row, but emitter-local selection cannot ground this old claim.
- **Duplicate emissions (7):** a new extractor may emit one record per source cell; do not repair by a candidate-ID allowlist.

The per-record sourceNativeRepairAssessment is diagnostic potential, not a result: no source-native replacement was run. Every replacement must process the complete table set rather than select these 93 IDs. Preserve original OCR strings, including ambiguous/conflicting page-2 headers, without manual correction.

## All-row structural evidence

The frozen Paddle JSON is [population.json](../../../.local/thai-native-20261025/paddle-1/population.json) (SHA-256 `5d3b53234bba2cbb6396f2d5e58cf7ca0239fe8965816173876d92736cf9ec32`). On zero-based page index 1, the raw parent-header detector boxes place `สัญชาติไทย` at x=460–540 (center 500), `ไม่ได้สัญชาติไทย` at x=751–856 (center 803.5), and `รวมทั้งสิ้น` at x=958–1030 (center 994). The six child-header centers are x=387.5, 501, 615, 716, 805, and 893; the first body row's final numeric-cell box is x=976–1043 (center 1009.5), anchoring the grand-total band. The frozen HTML assigns `สัญชาติไทย` to the first three child columns, `รวมทั้งสิ้น` to the next three, and `ไม่ได้สัญชาติไทย` to the final parent cell. The raw detector geometry instead places `รวมทั้งสิ้น` over the final grand-total band and `ไม่ได้สัญชาติไทย` over the second three-child band. The prior source audit retains the exact serialized lines (`h2 c3-5=สัญชาติไทย`, `h2 c6-8=รวมทั้งสิ้น`, `h2 c9=ไม่ได้สัญชาติไทย`) and the existing PDF render reference; this audit did not rerender the pages or alter any OCR token.

A general all-row parser can flag disagreement between a parent label's OCR box and the child/data-column span implied by the parsed parent-cell reference, including swapped or overlapping spans. Preserve the tokens and leave affected bindings unresolved until a geometry-aware parser can establish the mapping. The signal is structural and applies across the table; it does not identify a candidate ID or authorize correcting OCR.

For the economy December grid offset, see the prior hash-bound source-audit finding: its December header and value boxes overlap in x (ratio 1.0), while the frozen header grid and final value cell differ by one index. That shared representation issue does not make a wrong or incomplete candidate field correct.

## Per-ID ledger

See extraction-audit.json for all 93 stable IDs, candidate fields, exact chunk spans, frozen source row/cell/header evidence where uniquely navigable, unresolved mappings, causal subtype, contributor tags, and cautious replacement assessment.

## Integrity

- Primary subtypes sum to 93: PASS.
- Exact copied row/cell/header source slices: PASS.
- Source navigation resolved for 87/93; unresolved rows remain unquoted and without a PDF page assertion.
- No gold, questions, metrics, inference, or new PDF rendering was used.
- No app/runtime code consumes these labels.
