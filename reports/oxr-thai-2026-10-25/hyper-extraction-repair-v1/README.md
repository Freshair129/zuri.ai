---
doc_type: assessment
status: completed
version: "0.1.0"
---

# Hyper-Extract held-fact audit and source-native retrieval comparison

This nonproduction follow-up audits the 93 extraction-primary candidates among
the 115 facts held by the earlier v6 check, derives structural cell references
from the frozen Paddle table source, and compares that source-native TEXT arm
with the current table-preserving baseline in the same GenesisRAG17 harness.
The original Hyper candidate receipt and prior run reports remain unchanged.

## What the 93-candidate audit found

The independent source audit assigns all 93 records to extraction-primary
causes: 43 wrong header, measure, predicate, or period selections; 32 subject,
entity, or index-routing errors; 7 duplicate emissions; 7 whole-row values
instead of atomic values; and 4 missing or out-of-chunk evidence quotes. The
per-ID audit is diagnostic only. It is not read by the enumerator, projection,
or native harness.

The post-freeze crosswalk finds a source row/cell match for 63 of the 93 model
records. Seven link to one exact value cell with a resolved source header path;
seven link to an exact multi-cell row sequence; 49 have an exact subject and
value cell but no matching header binding; five find the exact row label but no
exact value cell; and 25 find no exact source-native row/value match. The 49
header-unresolved candidate records split into 14 candidate header strings not
found in the source table/header lines available in their emitting chunk, and
35 where the header text occurs in source but is held or does not bind to that
cell. The seven resolved-path records are separate from those 49. Across all
links, 63 candidate records map to 99 unique source cells through 105 links;
six links are repeated links to an already-linked cell. All links remain
diagnostic. Candidate predicates and descriptions remain `NOT_ASSESSED`; no
candidate is promoted or rewritten.

See the auditor-owned [93-record source audit](extraction-audit.md), the
machine-readable [candidate-to-cell crosswalk](../../../.local/hyper-extraction-repair-20261025/extraction-crosswalk.json),
and the [frozen source structure audit](source-audit.md).

## Source-native method and limits

The deterministic enumerator processes all four frozen tables and 114 source
packets without reading candidate IDs or audit labels. It uses exact frozen
cell strings, same-row Paddle text/box sequences, and unique geometry-backed
header associations. It retains raw cell/header text as-is. A missing or
conflicting row/header association remains held. The solitary unmerged year
header remains literal table context and is not propagated to month cells.
Population page-2 parent-header geometry conflicts also remain unresolved.
No OCR text or numeric glyphs are corrected.

The source inventory contains 972 cell records: 632 structurally resolved
value-cell candidates, 101 row-label cells, and 239 held cells kept as context.
Thirteen rows without unique source/OCR row-sequence agreement also remain
context-only. These are structural/lexical candidates, not verified business
facts. All descriptions and predicates remain unassessed; graph admission is
`NONE`.

The projection preserves all 151 source zones (114 table rows and 37 non-table
context zones) and all 41,323 characters across the frozen source ranges,
including four range-gap characters. Source-range reconstruction is exact and
the source text is unchanged. It adds 53,390 characters of generated
cell-reference framing, for 94,713 projection characters (129.2% framing
overhead relative to raw source-range text). The full native arm includes a
374-character control prefix, for 95,087 characters. The projection contains
632 resolved value-cell references; held values, unmatched rows, non-table
zones, and the remaining cell records appear only as unqualified source
context.

## Same-run GenesisRAG17 comparison

Both arms used the same frozen control prefix, pinned GenesisRAG17 image,
native harness, read-only E5 model volume, fresh disposable database/store,
network-disabled container, 2 CPU limit, and 6 GiB memory limit. The current
table arm's content bytes and SHA-256 are unchanged from the frozen baseline;
document IDs were added to its range metadata for citation scoring. The arms
ran serially in separate containers. The scorer used the sealed 16-question
QA set three times only after both source projections and the native input
were frozen. Each arm completed all 17 stages and 48 queries, with scope-denial
and restart checks passing.

| Metric | Current table baseline | Source-native all rows |
| --- | ---: | ---: |
| Row hit @1 | 4/16 | 3/16 |
| Row hit @5 | 4/16 | 4/16 |
| Row + header-token hit @5 | 4/16 | 4/16 |
| Document hit @5 | 16/16 | 16/16 |
| Stable ranks across repetitions | 16/16 | 16/16 |
| Native chunks | 156 | 310 |
| Exact common table packet text (headers + row) in one native chunk | 114/114 | 114/114 |
| Exact raw row bodies wholly inside one native chunk | 114/114 | 114/114 |
| Ingestion to publish | 59.2 s | 101.5 s |
| Container peak memory | 2,680,471,552 bytes | 4,381,884,416 bytes |

The `row + header-token` metric means exact row support plus the requested
header token somewhere in the retrieved chunk; it does not prove that the
header is semantically bound to the matched value. Every row hit at rank 5 in
both arms included the exact frozen source row body in the retrieved text;
none of these row hits was a frame-only match. The identical complete header+
row packet text from the frozen table baseline occurs in one native chunk for
114/114 packets in both arms. The exact raw row bodies also occur in one chunk
for all 114 rows in both arms. Chunk receipts include character lengths but no
E5 token-count field.

For a separate granularity diagnostic, none of the source-native bundle zones
that include the extra `## table row N` wrapper and terminator fits wholly in a
single chunk (0/114). This zone includes wrapper text absent from the baseline
packet, so its count is not a like-for-like comparison and does not indicate
loss of the common header+row packet or raw row text. The source-native
treatment produces 154 more chunks, 71% longer ingestion to publish, and about
1.63 times the peak memory of the current table arm.

The source-native arm did not improve row or document hit@5: those rates match
the same-run baseline. Row hit@1 decreased by one. Its extra structural
references therefore did not improve this corpus's retrieval results, while
increasing input size, chunk count, runtime, and memory use.

## Verification and boundaries

- Pinned Python 3.11.17 no-model source/native-input, projection, geometry, and
  crosswalk tests: 18/18 passed.
- Host-only preflight passed for both native arms and verified all source and
  projection freeze links, content/range hashes, unchanged baseline text, image,
  and read-only model volume.
- Both actual isolated GenesisRAG17 runs passed: 17/17 stages, 48/48 queries,
  and container exit code 0.
- The model was not called. Source enumeration used frozen OCR/parser output
  and detector boxes only; it did not use QA, candidate IDs, or per-ID audit
  labels. QA was used only by the post-freeze scorer.
- The native input contains no Hyper candidate descriptions or graph data.

This experiment does not validate predicate or description truth, establish
exhaustive extraction, define a graph-ingestion contract, or authorize
production adoption. The source-native output is an experimental TEXT
projection with `NOT_ASSESSED` semantics and no graph admission. Full paths,
hashes, run receipts, and input bindings are listed in
[`evidence-manifest.json`](evidence-manifest.json); the machine-readable scores
are in [`measurement-summary.json`](measurement-summary.json).
