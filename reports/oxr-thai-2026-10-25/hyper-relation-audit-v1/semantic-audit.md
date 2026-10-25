# Hyper-Extract run-3 relation semantic audit

This diagnostic review covers all 85 frozen edge occurrences against their exact emitting chunk and source zones. It did not read gold, questions, or metrics. It does not alter the frozen run or feed per-edge verdicts into runtime selection.

## Classification counts

- Source-supported paraphrase: 18
- Unsupported semantic assertion: 25
- Ambiguous OCR/chunk/header evidence: 42

## Same-row table evidence

The source-supported population-table facts are individual province-to-population-data rows only when the participant label matches the source evidence. Each cited row is bound to its table headers through the frozen headerRefs and per-column bindings; the JSON gives exact row/header quotes and source spans. OCR-mismatched or chunk-created labels remain ambiguous. These row facts do not support cross-row grouping/comparison, or turn an economy table’s repeated prepared-by header into a series-level publisher, compiler, or policy-action relation.

Supported population-row edge IDs: `hyper.run3.population.chunk-0.edge-0`, `hyper.run3.population.chunk-0.edge-2`, `hyper.run3.population.chunk-5.edge-0`, `hyper.run3.population.chunk-5.edge-1`, `hyper.run3.population.chunk-5.edge-3`, `hyper.run3.population.chunk-5.edge-4`, `hyper.run3.population.chunk-5.edge-5`, `hyper.run3.population.chunk-5.edge-6`, `hyper.run3.population.chunk-7.edge-0`, `hyper.run3.population.chunk-7.edge-1`, `hyper.run3.population.chunk-7.edge-2`, `hyper.run3.population.chunk-7.edge-3`, `hyper.run3.population.chunk-7.edge-4`, `hyper.run3.population.chunk-7.edge-5`, `hyper.run3.population.chunk-7.edge-6`

## Main causal patterns

- The economy candidates often promote a table-level prepared-by/header to series-level publisher, compiler, or reporting claims.
- Some economy candidates assert policy actions such as setting rates, managing exchange rates, or website dissemination that the source only presents as data or a URL.
- Population province rows support individual population-data statements, but chunk-based multi-province groups and pairwise comparisons are not source-stated relations.
- Several candidate labels are OCR-corrupted, translated, or mismatched; those are recorded separately from relation support.

## Evidence and limits

**Span precision:** binding records distinguish containing-zone bounds (`rowZoneSpan`/`zoneSpan`) from exact quote offsets (`rowQuoteSpan`/`quoteSpan`). Exact quote spans were checked against the frozen source ranges.


The JSON records stable document/chunk/edge IDs, exact candidate descriptions and participants, exact source quotes with UTF-16 source spans, table header references and assembled relation contexts, participant literal/normalization diagnostics, and a per-edge semantic finding. Normalization is limited to NFKC, Thai-digit conversion, and whitespace removal; it does not repair OCR or translate names. “Source-supported” is limited to the relationship actually stated (for example, row inclusion or an explicit footnote), not every possible graph edge.

Raw input SHA-256 values and freeze bindings are in the JSON provenance block. No runtime, product, or source artifacts were changed.
