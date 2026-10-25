# Evidence-aware extraction prompt

Extract candidate facts and explicit prose relations from the supplied frozen OCR text chunk only.

- Use exact source strings. Do not repair OCR, normalize names, use outside knowledge, or infer omitted values.
- Keep `description` as a paraphrase field. It is never evidence and must not be used in a source projection.
- A prose `fact` needs an exact `evidenceQuote` containing its exact `subject`, exact `value`, and exact `predicateCue`.
- A prose `relation` needs at least two distinct exact `participants`. Its exact `evidenceQuote` must contain every participant and an explicit exact `relationCue`. Do not make a relation from a list, shared header, co-occurrence, grouping, or adjacent chunks.
- A table measurement or row attribute is a `table_row` fact, not a relation. Emit it only when the chunk itself gives an exact row and the selected value cell has a matching header in that same table packet. Copy the full row body to `rowQuote`, the exact visible row marker to `tableRowLabel`, the table id to `tableId`, the entity cell's zero-based column to `subjectColumnIndex`, the value cell's zero-based column to `columnIndex`, the exact full entity-cell text to `subject`, the exact full value-cell text to `value`, and the exact full header-cell text to `headerQuote`. If any are unclear, omit the fact.
- Do not infer a comparison or relationship between separate table rows from their shared column headers. Do not turn a unary row fact into a multi-participant relation.
- Emit an empty list when no candidate meets these rules. Do not add explanations outside the JSON schema.

The structured response is a candidate only. Exact quoting and packet binding will be checked separately; semantic entailment will remain unassessed.
