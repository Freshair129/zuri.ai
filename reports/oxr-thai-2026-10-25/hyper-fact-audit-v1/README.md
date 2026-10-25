---
doc_type: assessment
status: completed
version: "0.1.0"
---

# Hyper-Extract held-fact source audit and geometry recheck

This nonproduction follow-up audits the 115 run-5 table-fact candidates held by
the v6 validator, rechecks all 120 facts against frozen Paddle table text and
OCR-box geometry, and runs one resulting TEXT-only source projection through
the existing GenesisRAG17 native workflow. It makes no OCR edits, model calls,
gold-based selection, production change, or graph-admission claim. The run-5
candidate receipt and earlier v6 results remain unchanged.

## Diagnosis

The independent per-ID source audit classifies the 115 v6-held candidates by
primary cause: 10 OCR recognition/layout cases, 93 extraction cases (including
7 duplicate model emissions), 10 table-projection binding cases, and 2
ambiguous token/column cases. The 10 projection cases are source-supported cell
claims that the frozen Paddle HTML header grid cannot bind correctly; the
geometry audit found no demonstrated validator defect. All 10 align with the
10 newly recovered facts. The remaining 86 nonduplicate extraction cases
include wrong or omitted metrics, multi-cell concatenations, ordinal/entity
mix-ups, mismatched labels, and other candidate-field errors. See the full
[source audit](source-audit.md) and [machine-readable records](source-audit.json).

The economy table has a one-cell header offset: seven month labels occupy
header grid cells 0–6 while the row has a label plus seven values at cells 0–7.
The frozen Paddle OCR records place the December label box directly over the
last value box. A separate population page-2 group-header order conflicts with
the PDF image, so those candidates remain held; this pass does not repair or
rewrite OCR. Some source navigation is unresolved, and candidates with incorrect
values, omitted measures, composite labels, or missing OCR boxes remain held.

## Geometry-based recheck

The revalidator rechecked all 120 original run-5 facts, including the five
previous v6 admissions. It requires exact source subject/value/header cells,
the same absolute source occurrences inside the emitting chunk, valid raw
Paddle OCR boxes on the same physical row, and a unique horizontal alignment
between the selected header box and value cell. When a row repeats the same
value, it additionally requires the complete nonempty source cell sequence to
match the same-row OCR record sequence in x-order before using header geometry
to resolve the cell. Duplicate emissions, missing/clipped boxes, nonunique or
misaligned headers, and candidate atoms not present at the matching chunk
offset remain held. This is a generic source-geometry rule; it does not use
month names, question labels, or manual per-ID decisions.

The recheck found 15 unique geometry-grounded lexical fact candidates: the five
previously admitted facts still pass, and 10 facts are newly recovered from the
115 held cohort. Seven duplicate candidate emissions remain held, and 98 other
facts remain held. Candidate descriptions and predicates are unverified;
semantic status remains `NOT_ASSESSED`. The new projection contains only exact
frozen source TEXT and referenced row/header context. It includes 15 economy
zones (6,390 of 41,323 source characters, 15.46%) and no population zones.
Candidate fields, graph data and descriptions stay in a sidecar and are not
ingested.

## GenesisRAG17 result

The native run used the pinned GenesisRAG17 image, a fresh disposable database
and store, network disabled, CPU limited to 2, memory limited to 6 GiB, and the
existing E5 model volume mounted read-only. The scorer read the frozen QA only
after the fact validation and source projection were frozen. The native harness
completed all 17 stages and 48 queries (16 intents repeated three times).

The geometry-derived arm returned row hits at rank 1 for 2/16 intents and at
rank 5 for 2/16; row-plus-header hits at rank 5 were 2/16, document hits at
rank 5 were 6/16, and all 16 metric ranks were stable across repetitions. The
prior v6 five-zone arm had 0/16 row hits and 6/16 document hits at rank 5, so
the additional source zones recovered two row-level retrieval hits in this
isolated comparison. In a separate historical run on the same corpus, the
Paddle/table-preserving arm had 4/16 row hits at rank 1 and rank 5, 4/16
row-plus-header hits at rank 5, and 16/16 document hits at rank 5. The current
geometry-derived subset remains below that baseline. These are separate runs,
not simultaneous control arms. The current arm remains economy-only and covers
15.46% of source characters; this does not establish population retrieval
quality or broad extraction quality.

Ingestion-to-publish time was 21.20 seconds, native container wall time was
74.998 seconds, and peak container memory was 1,671,675,904 bytes. The synthetic
gate probe, scope-denial check and restart/citation checks also completed. These
are harness and runtime checks, not semantic validation. Full metrics are in
[`measurement-summary.json`](measurement-summary.json); the host-only hash and
profile preflight is in the ignored local evidence directory.

## Verification and limits

- Pinned Python 3.11.17: 13/13 no-model geometry and native-contract tests pass.
- Host-only preflight: PASS; verified both source-bundle file and parsed-object
  hashes, all 120 unique candidate IDs, the v7 validation/projection, all three
  native arms, 15 exact source ranges, and unchanged plain/table baseline arms.
- Actual isolated GenesisRAG17 native test: 1/1 passed, 17/17 stages and 48/48
  queries; scorer verified the previously sealed gold digest after freeze.
- No inference was rerun. The frozen source bundle, Paddle output, and OCR text
  were not modified. The per-ID source audit is diagnostic and never a runtime
  input.

The geometry result establishes only lexical/source-cell alignment. It does not
prove that the model's description or predicate is true, authorize a GKS graph
contract, establish exhaustive extraction, or support production adoption.
The full artifact list, SHA-256 values and byte lengths are in
[`evidence-manifest.json`](evidence-manifest.json). Earlier Hyper-Extract and
relation-audit evidence remains unchanged.
