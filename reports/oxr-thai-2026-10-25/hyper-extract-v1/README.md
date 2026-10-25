---
doc_type: assessment
status: experiment-completed
version: "0.1.0"
---

# Hyper-Extract v1 Thai extraction and native retrieval experiment

Owner-authorized, nonproduction trial over the same two public PDFs, unchanged
Paddle OCR text projection and frozen gold used by the [real-native baseline](../real-native/README.md),
[table-preserving trial](../table-chunking/README.md) and [PaddleOCR-VL comparison](../paddleocr-vl-v1/README.md).
Hyper-Extract proposed candidate entities and relations from the frozen Paddle
text; a conservative source checker selected exact source zones for a separate
TEXT-only arm through the actual isolated GenesisRAG17 path. The candidate graph
remained a sidecar. No product, production, OCR, gold, price or stock behavior
changed.

## Frozen input and execution

The frozen [protocol](protocol.json) has SHA-256
`9316805b81b03d95a43727dccb01beaabf9d27e87ee4c952494a5f136361c43a` and binds
the exact source bundle hash
`e0699864289fa151385590b002ee87048e955890ea0b7c4c9c2ffc7380714d49`. Hyper-Extract
received only 41,323 characters from the two source ranges in the existing
Paddle `ocr-table-row-v1` text projection, split into 23 chunks at 2,048
characters with 256-character overlap. It did not read PDF bytes, perform OCR,
receive the control corpus, frozen questions or gold, or correct the Paddle text.

The installed distribution reported version 0.10.5 and was an editable install
of source commit `a8e27199ffd3984042e870d0b6963810a0d70f5d`, bound by source-tree
SHA-256 `c07a004863ff47db1415201a739939771fb9ba79b2506edaf185a3937804ee7f`.
That checkout is a later source snapshot than the v0.10.5 release commit
`0dc002bb1029fd34b21e47602e406ef7880c8673`; the version and source commit are
reported separately. Hyper-Extract declares Apache-2.0. This experiment does not
complete a license audit of all dependencies.

Inference used the already-installed local `qwen3.5:9b` model, digest
`bb0c43f2ae93339a21a67576441645ad0fd5696a259c250bfe4af7462c528cb2`, through
Ollama 0.40.9 and LangChain's `ChatOpenAI` adapter. The model was already
resident, so cold-load time was not measured and it was not unloaded. Ollama
reported a 4,096-token context and `size_vram` of 5,506,859,006 bytes before and
after extraction. This is Ollama runtime telemetry; Python client RSS and total
host memory were not measured. The wrapper requested `reasoning_effort=none`;
no reasoning field was observed in responses.

Hyper-Extract's two-stage implementation requests function-calling output.
The first full attempt preserved as run 2 failed on economy chunk 9 with Ollama's
`NodeSchemaList` invalid-tool-arguments error. Bounded 1,024- and 2,048-token
function-calling diagnostics on that same frozen chunk also failed. A
JSON-Schema diagnostic on the identical chunk then returned nonempty nodes and
edges in 47.4 seconds with no extraction failures. Run 3 froze a small
`ChatOpenAI` adapter that maps the library's structured-output request to
`json_schema`, and both outgoing token-cap fields to 2,048. The upstream package
source was not modified. Run 3 completed all 23 chunks and 55 structured calls
with 55 responses, no retries and no extraction failures in 447.9 seconds.
Every request body was checked for the frozen model, schema method and token
caps. Ollama's observed 4,096-token context matched before and after extraction;
context was checked out of band through `/api/ps`. The failed run and diagnostics
remain preserved; only the one complete run is scored.

## Candidate evidence and native boundary

The post-extraction validator is versioned and hash-bound in
`validated-candidates.json`; it was applied before opening the gold and is not
misrepresented as an extraction-time Hyper-Extract feature. It requires a
candidate name or relation quote to occur in the exact chunk that emitted it
and within the same source zone. For table relations, only the row body can
support the relation; repeated table headers stay as projection context. A
literal name mention does not establish entity type or description. A literal
relation quote is only a source-grounded candidate, not native GKS acceptance.

| Candidate check | Observed | Interpretation |
|---|---:|---|
| Node output occurrences across chunks | 187 | Per-chunk occurrences, not unique canonical entities |
| Unique exact candidate-name strings | 153 | Exact-string count only; it does not assert identity |
| Names with an exact same-zone, same-chunk mention | 82/187 | Mention evidence only |
| Names without that literal anchor | 105/187 | Ungrounded under this strict check; aliases, normalization or formatting can also fail it, so this is not a hallucination count |
| Node descriptions with a literal source quote | 72/187 | Descriptions remain candidate-only and are never projected |
| Edge output occurrences | 85 | Candidate relations |
| Edges with exact participants and full relation quote in one same-chunk source zone | 0/85 | None met this verifier; this is not proof that every proposed relation is false |

The source-text projection selected the union of zones containing a literal
candidate-name mention. No edge passed the relation check, so no zone was
selected through an edge. It selected 79 of 151 zones (22,569 of 41,323 source
characters, 54.62%) and omitted 72 zones (18,754 characters). The native input
contains the unchanged control text and source heading plus only those exact
Paddle source slices. The model's node types, descriptions, edge descriptions,
and other generated fields do not appear in the TEXT content.

The candidate graph was not admitted to GKS and does not satisfy Stage 9/10
contracts. The only native input was TEXT. The [native input builder](build-native-input.mjs)
and launcher verify the run-3 freeze, candidate receipt, projection and gold
hashes before execution. The disposable native harness also checked that its
copied `gold.json` matched the frozen gold hash
`976e843a970065b31b984f11fa933434a38a3f824f27b34117b333eb85789303`.

## Native results

GenesisRAG17 completed all 17 stages, published the source-text arm and returned
the same 16 fixed gold queries three times (48 responses). All citations were
checked against the native composite text and verified source ranges. The
five-query synthetic gate probe, wrong-scope denial and post-restart citation
check also passed. The gate probe is integrity evidence, not Thai answer
quality. The checked gold queries were opened only after extraction and the
source projection were frozen.

The native arm used a fresh disposable DB/store and worker state, the pinned
GenesisRAG17 image `sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39`,
and the existing E5 model volume mounted read-only. It had no network or host
database mount.

| Arm | Native chunks | Complete-row hit@1 / @5 | Row + header tokens@5 | Correct document@5 | Median first-pass query | Ingest to publish | Native cgroup peak |
|---|---:|---:|---:|---:|---:|---:|---:|
| Hyper-guided source-zone subset | 87 | 3/16 / 3/16 | 3/16 | 16/16 | 380.7 ms | 26.8 s | 1.69 GiB |
| Paddle / plain | 35 | 3/16 / 3/16 | 2/16 | 16/16 | 380.4 ms | 17.8 s | 1.58 GiB |
| Paddle / table-preserving | 156 | 4/16 / 4/16 | 4/16 | 16/16 | 351.7 ms | 35.8 s | 2.52 GiB |
| PaddleOCR-VL v1 / plain | 27 | 0/16 / 0/16 | 0/16 | 16/16 | 448.0 ms | 27.8 s | 1.78 GiB |
| PaddleOCR-VL v1 / table-preserving | 137 | 0/16 / 0/16 | 0/16 | 13/16 | 469.7 ms | 37.1 s | 2.16 GiB |

Hyper's complete-row retrieval matched the earlier Paddle/plain arm and did not
improve on the Paddle/table-preserving result. The row-plus-header metric counts
token co-presence; it does not prove column binding. Column-binding is not
reported for the Hyper arm. These are historical arms from separate runs, not a
same-run factorial; chunk counts and content differ, so latency and memory
differences are descriptive rather than causal.

The Hyper extraction took 447.9 seconds for 55 calls, using 60,006 prompt and
19,158 completion tokens. This extraction time is separate from native
ingestion, and is not directly comparable with the earlier CPU Paddle OCR
parsing runs. The native container ran with two CPUs, a 6 GiB memory limit, no
swap and no network; its wall time was 69.3 seconds and cgroup peak was
1,814,032,384 bytes. See [measurement-summary.json](measurement-summary.json)
for per-query ranks, repeats, tokens, resource records and historical arm data.

## Limits and evidence

This two-PDF pilot does not qualify entity resolution, relation correctness,
generated-answer quality, a customer-facing table feature, production ingestion
or any change to price/stock authority. It leaves the native TEXT workflow
unchanged and introduces no new graph authority. The 105 unanchored names are
strict-check failures, not a factual hallucination score; the 85 held/rejected
edges are not all proven false. The result gives no retrieval improvement over
Paddle/plain and trails Paddle/table-preserving for complete rows.

The frozen protocol and summaries are in this folder. Full candidate, validator,
projection, native, per-stage and database artifacts remain under the local
`.local/hyper-extract-20261025/run-2/` and `run-3/` directories; failed attempts
are retained. The [evidence manifest](evidence-manifest.json) binds report code
and those local receipts by hash. This report records an isolated experiment,
not a production recommendation or adoption decision.
