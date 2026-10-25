---
doc_type: assessment
status: experiment-completed
version: "0.2.0"
---

# Real Thai documents and native GenesisRAG17 comparison

Owner-authorized nonproduction follow-up to the [synthetic comparison](../alternatives/README.md).
Use two public official PDFs unchanged: the [population registration announcement](https://ratchakitcha.soc.go.th/documents/57621.pdf)
and [BOT December 2567 economic table](https://www.bot.or.th/content/dam/bot/documents/th/thai-economy/state-of-thai-economy/monthly-report/macro-2567-12-table_m.pdf).
Four pages include Thai digits, multi-level merged headers, a three-page table,
dense month columns, negative values and footnotes. This is a small real-document
pilot, not a representative Thai corpus. No customer/production data is used.

## Protocol frozen before inference

- Preserve original PDFs and hashes. Inspect rendered pages and independently
  verify [gold.json](gold.json) before candidate inference. No tuning to outputs.
- Compare the existing binary PDF parser with the prior Paddle1280 Thai profile.
  Keep model weights/configuration fixed. Run two serial parsing repetitions per
  parser with two CPUs and a 10 GiB memory ceiling; retain first-run quality and
  both run timings/peak cgroup RAM. Repeats use fresh containers and cached weights.
- Measure 12 selected Thai text strings, nine selected table rows (63 numeric
  cells plus nine labels), exact ordered row association and 16 fixed queries.
  These are sampled-field metrics, not full-document CER or TEDS. Strings/cells
  use NFKC, whitespace removal and Thai-to-ASCII digits; signs and decimals remain.
  Document-wide numeric token diagnostics preserve token boundaries/whitespace
  and number formatting; they do not join separate numbers or establish cells.
- Through isolated Zuri/MSP/GKS/Genesis worker processes, ingest each parser's
  uncorrected extracted text through the same current TEXT chunker and actual
  17-stage execution, publish and query the native store. External PDF parsing is
  timed separately; this does not claim a production Paddle binary-parser plugin.
  Use separate database/store directories per arm, no application credentials,
  production volumes or host ports. Do not fabricate stage receipts or gate PASS.
- Query the same 16 questions three times each. Report the first pass separately
  from repeats, native result/citation validity and complete ordered-row hit@1/@5.
  Report row-plus-header-token co-presence as a diagnostic, not proof of header
  association. Finding a number or the right file is not a supported table answer.
  Report scope-denial evidence separately.
- Record source/image/model/config hashes, all failures, elapsed time and memory
  for parser and native pipeline separately. RAM is the whole container cgroup,
  not a summed RSS claim. Single-host repeats do not establish production p95.
- Price/stock authority, approved disclosure fields and production remain unchanged.
  Public economic values here are test evidence, not customer-facing prices.

## Execution and results

Native feasibility review found that this worker creates a generation per
decision and does not merge earlier source snapshots. Each arm therefore did
admit one explicitly delimited composite TEXT source: the unchanged existing
`genesisrag17-corpus-v1.json` synthetic control plus both uncorrected PDF text
projections. Stage 16 uses only the control's five frozen queries as an index/
citation integrity probe; the 16 public-document evaluation queries are separate.
`prepare.mjs` flattens Paddle's physical HTML table rows into tab-separated text;
it does not propagate headers, repair values or feed HTML structure to the native
TEXT chunker. The expanded HTML grid is used only for the separate cell metric.
Thresholds and gate code remain unchanged; a failed probe blocks publication.
This gate does not certify Thai-document answer quality. Native citations resolve
to the composite text; original PDF/page mappings are experimental sidecar evidence,
not claimed native per-PDF lineage. Graph-lane execution may be driven by the
control's English facts, not extracted Thai table facts.

Both arms completed actual ingestion, publication and native queries. This is
not offline cosine scoring and does not certify live LINE or production use.

### Sampled correctness

The frozen source/gold hashes and per-question scores are in
[evidence-manifest.json](evidence-manifest.json) and
[measurement-summary.json](measurement-summary.json), respectively. Quality uses parser run 1;
two repetitions measure parser cost. Sixteen queries per arm were each run three
times (48 responses per arm). Scoring requires the correct document, exact row
label and all seven ordered numeric values on one line in a returned chunk.
It is intentionally stricter than finding the one cell asked for, and does not
measure generated-answer accuracy or reconstruct rows across multiple chunks.

| Metric | Existing binary parser | Paddle Thai 1280 |
|---|---:|---:|
| Exact sampled Thai strings | 5/12 | 10/12 |
| Selected numeric tokens found somewhere in document | 63/63 | 57/63 |
| Correct aligned structured cells, including exact row label | Unsupported structured output | 43/63 |
| Complete ordered rows in parsed projection | 0/9 | 3/9 |
| Native correct-document hit@5 | 15/16 | 16/16 |
| Native complete-row hit@1 / hit@5 | 0/16 / 0/16 | 3/16 / 3/16 |
| Row plus requested header tokens, hit@5 | 0/16 | 2/16 |

Paddle's structured score is 14/28 BOT cells and 29/35 population cells. The
baseline exposes no table grid, so its structured score is **not applicable**,
not a fabricated zero. Its 63/63 number presence does not preserve which province,
month or column owns a value. Paddle also makes mistakes: two selected BOT row
labels do not match the source, and six selected population values are not exact.
The 10/12 string result is a small sampled test, not 83% overall OCR accuracy.

For example, Paddle reads BOT `ดุลการค้า` as `ตุลการค้า`; all seven numbers
survive, but the exact row-label check fails. In the population table it reads
Bueng Kan's Thai-national subtotal as `419,844` instead of `417,844`, after digit
normalization. These are real source/output mismatches, not inferred errors.
Post-run E5 token audit found a maximum of 309 baseline / 310 Paddle tokens per
chunk including the passage prefix, below the worker's 512-token bound. Thus
embedding truncation is not the explanation for these failures in this sample.

Both arms published 35 chunks and completed 17 stages with real receipts. The
five unchanged control queries passed recall/MRR/citation checks with no reported
cross-tenant leaks. All evaluation citations were checked against Zuri raw text,
chunk offsets and hashes; a wrong-business query was denied, and five citations
were verified after a worker restart against the same generation. The three
reported metric ranks were stable for all 16 queries over the three passes;
this does not establish identical full rankings or deterministic production load.

### Elapsed time and RAM

CPU-only, two CPUs per container, serial arms on the same Windows/Docker host.
Host: Intel i7-8700K, 32 GiB physical RAM; Docker engine 29.9.2 with approximately
15.6 GiB available. Background host load was not controlled.
Parser limit 10 GiB; native limit 6 GiB; swap disabled. Models were already cached.
Peak RAM below is cgroup `memory.peak`, including child processes and charged
cache, not an application-only RSS estimate. Native arms ran once each; repeated
queries are warm, within-run repeats. The baseline arm ran first, so cache/order
effects prevent a causal speed claim from the native latency difference.

| Measurement | Existing binary parser | Paddle Thai 1280 |
|---|---:|---:|
| Whole parser container, runs 1 / 2 | 2.12 / 1.85 s | 362.82 / 352.57 s |
| BOT parse call, runs 1 / 2 | 0.792 / 0.716 s | 111.776 / 109.441 s |
| Three-page population parse call, runs 1 / 2 | 0.885 / 0.813 s | 222.690 / 220.883 s |
| Parser peak RAM, runs 1 / 2 | 164.4 / 135.0 MiB | 7.49 / 7.47 GiB |
| Native TEXT submission through published finish | 20.60 s | 18.93 s |
| Native container peak RAM | 1.76 GiB | 1.57 GiB |
| Native query first-pass median, 16 queries | 481.6 ms | 390.0 ms |
| Native query repeat median, 32 queries | 473.7 ms | 386.1 ms |

Parser-call timing excludes imports/model initialization; container wall time
includes startup and output writes. Native ingestion timing excludes external
PDF parsing and runtime initialization. Query timing includes the transport and
native search but excludes subsequent verifier DB reads. Peak RAM is not additive
across these separate containers. All six measured containers exited 0 without
OOM; parser repetitions used fresh processes, not model downloads.

### Decision and remaining limits

Keep the current parser and treat Paddle as an experimental OCR/table fallback.
Paddle recovered readable Thai and some row structure from real complex PDFs,
but CPU parsing cost roughly six minutes for four pages and retrieval still
failed the complete-row test for 13/16 questions. Neither result authorizes
customer-facing table answers. The next experiment should preserve table headers,
row identity and page continuation during chunking, then use a larger frozen Thai
corpus. Do not fix OCR values from gold or treat retrieved amounts as price/stock
authority. No application code, production setting, disclosure grant or commercial
guard was changed in this experiment.

The pilot covers two PDFs/four pages/two layouts only. It has no full-document
CER/TEDS ground truth, no LLM answer scoring, no concurrent-load/p95 measurement,
and no production File Manager admission or native per-PDF provenance acceptance.
Stage execution is not evidence that Thai table relations entered the graph.

### Reproduction and evidence

Run from the repository root at `49ef1ddbaa4db684bc5282ccc8df379e5a0028c8`
with this report patch. Raw evidence is ignored local data under
`.local/thai-native-20261025/`; source PDFs are public and linked above.
The old synthetic experiment remains unchanged. This report directory contains
the frozen gold, parser adapters, projection adapter, native harness and evaluator.

- Parser image: `sha256:79397a0f5fea3a2445a1a15a684f67948211f5b369f055e054e8c531df4a3e34`.
- Native/Node baseline image: `sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39`.
- Native pinned MSP `d0d48c1a8e833478525d9a6ce5ee16af2c85444d`, GKS
  `ecf1e4de269e949406a6a5f791f9ff8fe30c9578`, GenesisBlock
  `5156f412da73905a23d74775a82cc14d1f6d04d0`.
- Embedding model `intfloat/multilingual-e5-small`, revision
  `614241f622f53c4eeff9890bdc4f31cfecc418b3`; worker uses pinned Node 24.18.0,
  while the acceptance test launcher uses image Node 22.23.4.
- Each native arm retains its results, stage evidence, chunk text, runtime
  provenance, SQLite evidence database and store state. Parser raw JSON, resolved
  configuration, container states, logs and resource peaks are retained separately.

`prepare.mjs <raw-root>` creates projections and native inputs exclusively and
never reads gold. Run `parse-paddle.py`/`parse-baseline.mjs` in isolated containers
first, then the same `launch-native.mjs` with `BENCH_ARM=baseline` or `paddle`.
Use new output directories for retries; do not overwrite the frozen run.
`evaluate.mjs <raw-root>` verifies input/gold hashes, query coverage and arm identity
before writing the summary and exits nonzero for incomplete or invalid arms.
`node --test reports/oxr-thai-2026-10-25/real-native/metrics.test.mjs reports/oxr-thai-2026-10-25/real-native/evaluate.test.mjs`
tests scoring and incomplete-run failure cases. Container commands and artifact hashes are retained with the
evidence manifest; model/image availability is required to reproduce execution.
It seals 112 local raw artifacts, fingerprints all five native embedding-model
files and verifies that 63 cached parser model/config files
and the package set match the prior experiment. Both executed native harness
copies match the report source. No application container or volume was modified;
the existing embedding-model volume was mounted read-only.
That shared named volume was `zuri-main-dev-20261020_ki17-model`; no application
database or runtime-state volume was mounted.

### Verification

- Actual native acceptance: one test per arm passed, each with 17 stages, 48
  held-out queries, scope denial and worker-restart citation checks.
- Scorer/evaluator regressions: 7/7 passed, including missing/failed arms exiting
  nonzero while retaining both statuses in the report.
- Documentation reader/profile regressions: 16/16 passed.
- `npm run govern`: exit 0, 0 critical, 0 warning, 43 informational entries.
- `npm run docs:llms` and `npm run docs:llms:check`: passed; generated corpus is
  local only. `git diff --check`: passed (Git line-ending advisories remain).
- Independent GPT-6 Luna Max reviews checked the frozen gold, metric definitions,
  raw results, native architecture and claim boundaries. No CI, merge or deployment
  is claimed. The six stopped measurement containers were removed after retaining
  raw evidence; images and model caches were preserved for reruns.

Version diff 0.1.0 → 0.2.0: records completed measurements, distinguishes token
presence from table correctness, and keeps adoption/production explicitly open.
