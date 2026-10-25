# Hyper-Extract held-fact source audit

This ledger covers 115/115 facts held by v6: 30 economy and 85 population. Five accepted facts are outside scope.

## Method

The ledger joins the worker mechanical audit with frozen candidates, exact emitter chunks, source bundle, and v6 receipt. It does not read gold, QA/questions, or metrics. PDF navigation is asserted only from an exact row quote or exact subject plus value unique inside the emitter chunk. Candidate row/table metadata alone never selects a source row; otherwise navigation is explicitly unresolved. Original OCR/candidate text is unchanged. Every quoted source span was slice-checked.

## Primary causes

| Primary cause domain | Held IDs |
|---|---:|
| OCR recognition/layout | 10 |
| Candidate extraction | 93 |
| Validator/projection | 10 (projection 10, validator defect 0) |
| Ambiguous token/column cases | 2 |

These mutually exclusive primary domains total 115. Candidate extraction includes 86 nonduplicate field/claim failures and 7 duplicate model emissions. The 10 projection cases are representation-induced binding false negatives, not semantic-quality or validator-correctness findings; the demonstrated validator defect count is zero.

## Source findings

- Economy: frozen Paddle puts December in header grid cell 6 while final values use data cell 7. For a source-supported example, the header/value OCR boxes overlap exactly in x. This can explain a false negative only for otherwise-correct candidate subject/value fields.
- Population PDF page 2: the unchanged visual group order conflicts with Paddle text, which places total over cells 6–8 and non-Thai over cell 9. The OCR text remains untouched.
- Other repeated causes include non-atomic concatenated values, omitted population measures, ordinal/province inversion, and province-name mismatches.

## Contributing OCR/layout evidence

- All 30 held economy candidates carry December/header-column metadata affected by the one-column grid offset. The mechanical audit proves unique subject/value/header geometry for 10 held candidates. Seven other candidate records duplicate a source claim; three lack a valid subject OCR box; one has a dropped row label and blank subject; the other nine have extraction-field failures. These are not all repairable by changing the header grid.
- The population page-2 group-header conflict is primary for 6 exact-row records and contributes to 5 more. Other OCR/layout tags and overlapping IDs are counted in the JSON summary and detailed per-ID records.

## Complete per-ID evidence

See source-audit.json for all stable IDs, candidate fields, exact emitter spans, v6/mechanical status, source navigation state, source row/cell/header spans when uniquely grounded, and primary/contributing cause.

## Integrity

- Exact source row navigation resolved for 108/115; all other rows are explicitly unresolved.
- Exact row/cell/header quote checks: PASS.
- Stable IDs reconcile to 115: PASS.
- No gold, questions, or metrics were read. No OCR was modified; no runtime code consumes this audit.
