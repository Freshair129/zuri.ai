---
doc_type: assessment
status: completed
version: "0.1.0"
---

# Hyper-Extract relation evidence audit and companion pass

This nonproduction follow-up investigates why the frozen Hyper-Extract v1
candidate graph had 0/85 relations admitted by its conservative evidence
checker. It reuses the original two-PDF Paddle OCR/table text and the separately
audited 85 edge occurrences. It does not alter that sealed run, use gold or
questions to select candidates, change OCR, or change production behavior.

## Diagnosis from the frozen source

The 0/85 result was not a reliable estimate that all proposed relations were
false. Hyper-Extract's edge schema and prompt requested a generated detailed
explanation, but supplied no separate verbatim evidence-quote field. The frozen
validator then required the generated description itself to appear in source
text. All 85 descriptions were absent from the full frozen source even after
normalization, so valid paraphrases could not pass that lexical rule. Separately,
14 edge outputs had only one participant; the source audit found 13 of these
better represented as unary/table facts and one OCR-ambiguous case. Some
multi-participant outputs were unsupported or ambiguous, so relaxing the quote
rule alone would be unsafe.

The independent, diagnostic-only per-edge audit classified 18 candidate claims
as source-supported paraphrases, 25 as unsupported, and 42 as ambiguous. These
manual labels are not validator inputs or extraction rules. Exact mention/quote
support establishes lexical grounding only; the companion validator leaves
semantic entailment `NOT_ASSESSED`. In particular, table headers require a
bound row/column context, while shared headers do not support cross-row
comparison claims. See the full [semantic audit](semantic-audit.md) and its
[machine-readable records](semantic-audit.json).

## Evidence-aware candidate contract

The companion extraction separates facts from relations and carries source
quotes, cues and source offsets apart from descriptive paraphrases. It requires
at least two distinct participants for a relation. Prose relation evidence
must contain the participants and an explicit cue in the exact emitting chunk;
table values are represented as unary facts bound to the specific row, subject
cell, value cell and referenced header cells. Header-cell indices are resolved
through packet metadata, including merged headers and leading ordinal columns.
Substrings do not qualify as exact cell values. The validator checks every
quote/span against the frozen text and emitting chunk. Candidate descriptions
are never treated as evidence.

The model output is bounded to the first eight fact and four relation
candidates per chunk in source order, with bounded quote fields. This makes the
pass explicitly non-exhaustive; absence from its output does not establish
absence from the documents. Even lexically grounded candidates retain semantic
status `NOT_ASSESSED` and stay in an isolated sidecar.

## Frozen inputs and inference

The companion uses the same 23 chunks and source bundle as the failed
budget-unbounded run 4. Its source bundle SHA-256 is
`e0699864289fa151385590b002ee87048e955890ea0b7c4c9c2ffc7380714d49`; its chunk
file SHA-256 is
`a8e4d41c1a89204283a87c0ac9ad8e5a5172b9b4f51129fafe5506bb6cdc5c08`. The run-5
freeze is in the local evidence directory and pins the exact per-chunk text,
prompt, schema, validator and runner hashes.

Inference uses the already installed `qwen3.5:9b` model with digest
`bb0c43f2ae93339a21a67576441645ad0fd5696a259c250bfe4af7462c528cb2`, Ollama
0.40.9, direct `/api/chat`, JSON Schema output, 8,192 context, 4,096 output
tokens, temperature 0 and thinking disabled. It runs one worker with no retries.
This transport/settings profile differs from the earlier OpenAI-compatible
attempts and is not a causal API-performance comparison. The budgeted output
contract was checked on the exact failed run-4 population chunk before freezing
run 5; that diagnostic is excluded from all run-5 results.

Earlier attempts remain preserved: run 2 stopped at an output-length failure;
run 3 stopped after one valid response because of a harness aggregation bug;
run 4 recorded 12 of 23 completed chunks before a second output-length failure
and left 10 chunks unrun. None of those partial outputs are combined with the
single frozen run-5 pass.

## Candidate, source projection and GenesisRAG17 boundary

The clean run-5 pass completed all 23 chunks with 23/23 stop responses and no
call errors. It emitted 120 table-fact candidates (35 economy, 85 population)
and zero relations. This is a budgeted output count, not an exhaustive
extraction or a relation-recall result.

The frozen v5 validator initially held all 120 table facts: 29 row quotes were
not exact source text, 74 exact-row candidates carried packet-generated row
labels that differed from the frozen packet, and 17 full-row quotes extended
outside the emitting chunk. It selected no zones. A separate no-gold mechanical
probe then found five candidates with exact subject/value/header cells that
uniquely resolve to the same frozen row and header binding inside the emitting
chunk; 115 candidates had no such unique binding. This probe was diagnostic and
did not change the v5 receipt or projection.

The v6 post-extraction validator freezes that generic cell-binding rule
separately from inference. It ignores model-generated table IDs, row labels,
value-column indices and row-quote paraphrases only when the exact full subject
cell, value cell and header quote independently resolve to one same-row packet
binding and every atom has an exact source offset in the emitting chunk. It
keeps the original quote and metadata statuses as audit fields. Repeated values,
wrong or partial headers, cross-row matches, missing cells, and atoms outside
the emitting chunk remain held. The resulting v6 validation admits 5/120
lexical fact candidates and holds 115/120; it admits zero relations. Semantic
status remains `NOT_ASSESSED`.

The v6 source projection selects five table-row zones (2,056 of 41,323 source
characters, 4.98%; 5 of 151 zones), all from the economy document. Each selected
zone includes its exact row packet and referenced header context, so the native
TEXT slice is wider than the three grounding atoms but stays within that same
frozen table-row zone. It does not include sibling rows. The native input keeps
these candidates and the graph in a sidecar; candidate facts, relations,
descriptions and semantic labels are not copied into TEXT. The original v5
zero-zone projection is retained but is not run natively.

The native arm used the pinned GenesisRAG17 image, a fresh disposable DB/store,
no network, and the existing E5 model volume mounted read-only. The scorer read
the sealed gold/questions only after the candidate receipt, v6 validation and
source projection were frozen. Runtime provenance binds the mounted gold to
the prior sealed digest. This is a separate historical comparison against the
earlier plain and table-preserving runs, not a same-run factorial.
GenesisRAG17's available contract accepts TEXT for this path; no candidate
graph is claimed to enter Stage 9/10 or GKS.

The native run completed all 17 stages and 48 queries (16 intents repeated
three times). The five-zone economy-only arm had 0/16 row hits at rank 1 or 5,
0/16 row-plus-header hits at rank 5, and 6/16 document hits at rank 5; metrics
were stable across all 16 intents. It ingested 13 chunks, took 9.723 seconds
from ingestion to publish, and had a 339.7 ms median first-pass query latency.
The container ran for 44.895 seconds with a 1,686,323,200-byte cgroup memory
peak (about 1.57 GiB). The synthetic gate probe passed 5/5 fixture queries and
reported zero cross-tenant leaks; scope denial and restart citation checks also
passed. These gate probes verify the isolated native harness, not retrieval
quality. Exact measurements and hashes are in
[`measurement-summary.json`](measurement-summary.json).

The first v6 native launch was preserved as a failed preflight attempt: a
harness overlay replaced the prior evidence manifest before the launcher read
its frozen gold digest. The gold bytes still matched the sealed digest. A
separate launcher restored the prior manifest after the overlay and reran the
same frozen native input in a fresh container/output path; the completed result
above is from that retry.

Historically, the separate Paddle/plain and Paddle/table-preserving arms each
retrieved the correct document for 16/16 intents and had row hits at rank 5
(3/16 and 4/16 respectively). Those are separate runs, so they are context,
not a causal comparison. The Hyper evidence-guided subset did not improve
retrieval: it produced no row hits and only 6/16 document hits, while covering
only economy source zones and no population zones.

## Limits

The original 0/85 result reflects a real mismatch between generated edge
descriptions and a literal-description checker, but the new complete pass
emitted zero relation candidates. It therefore does not show that the extractor
now recovers the original supported relations or improve their admission. The
v6 correction demonstrates only a narrow, exact-source table-fact grounding
path, and that subset reduced retrieval quality against the historical
plain/table arms. This companion cannot establish exhaustive extraction,
relation truth, entity resolution, a new GKS graph contract, customer-facing
behavior, production readiness, or adoption. A completed JSON-Schema response
is not itself semantic validation.

Run receipts, diagnostic attempts and generated native evidence remain under
`.local/hyper-relation-audit-20261025/`. The [evidence manifest](evidence-manifest.json)
binds the report, all local run artifacts, both freezes and the sealed gold
digest. The original Hyper-Extract v1 report, freeze, 85 candidates and 0/85
validator result remain unchanged.
