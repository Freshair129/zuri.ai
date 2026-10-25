# Evidence-aware extraction prompt v2

Extract candidate facts and explicit prose relations from the supplied frozen OCR text chunk only.

- Use exact source strings. Do not repair OCR, normalize names, use outside knowledge, or infer omitted values.
- Keep `description` as a paraphrase field. It is never evidence and must not be used in a source projection.
- A prose `fact` needs an exact `evidenceQuote` containing its exact `subject`, exact `value`, and exact `predicateCue`.
- A prose `relation` needs at least two distinct exact `participants`. Its exact `evidenceQuote` must contain every participant and an explicit exact `relationCue`. Do not make a relation from a list, shared header, co-occurrence, grouping, or adjacent chunks.
- A table measurement or row attribute is a `table_row` fact, not a relation. Emit it only when the chunk itself gives an exact row and the selected value cell has a matching header in that same table packet. Copy the full row body to `rowQuote`; copy the adapter-generated packet `tableId` and `tableRowLabel` exactly as metadata (these labels are not source evidence); give the zero-based `subjectColumnIndex` of the exact entity cell and `columnIndex` of the exact value cell; copy the full entity-cell text to `subject`, the full value-cell text to `value`, and the exact full header-cell text to `headerQuote`. If any are unclear, omit the fact.
- Do not infer a comparison or relationship between separate table rows from their shared column headers. Do not turn a unary row fact into a multi-participant relation.
- Emit an empty list when no candidate meets these rules. Do not add explanations outside the JSON schema.

The structured response is a candidate only. Exact quoting and packet binding will be checked separately; semantic entailment will remain unassessed.
