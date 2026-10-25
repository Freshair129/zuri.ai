---
doc_type: assessment
status: experiment-completed
version: "0.2.0"
---

# PaddleOCR-VL v1 Thai PDF and native retrieval experiment

Owner-authorized nonproduction comparison on the same two public PDFs and the
same frozen gold used by [the real-native baseline](../real-native/README.md)
and [table-preserving chunking trial](../table-chunking/README.md). The design
crosses parser output with projection profile: existing Paddle/plain,
existing Paddle/table-preserving, PaddleOCR-VL/plain and PaddleOCR-VL/table-
preserving. Each arm uses the actual isolated GenesisRAG17 publication and
retrieval path. No generated answer is scored; no application or production
configuration is changed.

## Frozen protocol and inputs

- Initial protocol: [protocol.json](protocol.json),
  SHA-256 `0ccec5571ac8850e897cc0a9c54b4cffe3b417cb35c9a8538218ad540f8a0032`.
- The pre-inference amendment and script/model locks record exact source hashes,
  CUDA-only enforcement, repeats, page coverage, common projection adapter,
  model-cache hashes, and the no-gold parser mount. Raw failed attempts remain
  under `.local/thai-paddleocr-vl-20261025/`.
- Inputs are unchanged official PDFs: [Thailand population registration
  announcement](https://ratchakitcha.soc.go.th/documents/57621.pdf) (3 pages)
  and [Bank of Thailand December 2567 economic
  table](https://www.bot.or.th/content/dam/bot/documents/th/thai-economy/state-of-thai-economy/monthly-report/macro-2567-12-table_m.pdf)
  (1 page). Their byte counts and SHA-256 hashes are in `protocol.json`.
- The frozen gold remains
  [gold.json](../real-native/gold.json); the scorer is the unchanged
  [metrics.mjs](../real-native/metrics.mjs). Parser containers receive neither
  gold, questions, scorer, prior OCR text, nor native query output.

## Candidate and execution

The candidate is PaddleOCR-VL original pipeline v1, using PaddleOCR 3.6.0,
PaddlePaddle GPU 3.2.1 and PaddleX 3.6.1 from the pinned official image digest
in `protocol.json`. It uses the PaddleOCR-VL-0.9B component and the default
pipeline prompt/postprocessing. Official references:
[v3.6.0 release](https://github.com/PaddlePaddle/PaddleOCR/releases/tag/v3.6.0),
[PaddleOCR-VL pipeline docs](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.6.0/docs/version3.x/pipeline_usage/PaddleOCR-VL.en.md),
[installation guide](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.6.0/docs/version3.x/installation.en.md),
and [official model card](https://huggingface.co/PaddlePaddle/PaddleOCR-VL).

The parser runs only on a visible NVIDIA RTX 3060 GPU (`gpu:0`), with six
container CPUs, 12 GiB cgroup memory and no swap. It runs two serial repetitions;
repetition 1 is scored and repetition 2 is a stability diagnostic, never a
gold-based selector. Inference has no network and reads the two PDFs and
read-only, SHA-256-frozen model cache. The cache is 64 files / 2,357,934,281
bytes. One-second `nvidia-smi` samples are whole-host GPU telemetry and can
include unrelated processes; cgroup memory is the parser container peak.

The Paddle and VL outputs pass through the same frozen HTML-to-TSV/read-order
adapter, which reproduces the previous Paddle plain input for both documents.
The table arm applies the unchanged `ocr-table-row-v1` profile. It preserves
literal cell text and source spans; it does not correct OCR values, infer
missing cells, consult gold, or alter the native TEXT chunker. The adapter does
not restructure pages across page boundaries.

Native arms use the same pinned GenesisRAG17 image and read-only E5 model volume,
with separate fresh DB/store state, two CPUs, 6 GiB memory, no swap and no
network. Each arm performs actual 17-stage ingestion/publication, the same 48
fixed query responses, citation/range checks, wrong-scope denial and restart
verification. Citations establish exact composite-TEXT evidence and sidecar
cell mapping; they do not claim PDF geometry or native per-PDF lineage.

## Results

The predeclared primary is repetition 1; repetition 2 is a determinism and
variance check. Both PDFs had identical semantic JSON, projected output, and
Markdown across repetitions. Scoring reports the unchanged 16 fixed query
intents on repetition 1; the other 32 responses are retained as repeat checks.

### Parser and table extraction

| Measure | Existing Paddle | PaddleOCR-VL v1 |
|---|---:|---:|
| Normalized Thai phrase-presence checks | 10/12 | 8/12 |
| Selected numeric tokens present in linear text | 57/63 | 28/63 |
| Selected values matched to parsed table cells | 43/63 | 0/63 |
| Gold rows found in parser text in order | 3/9 | 0/9 |
| Tables / source cells / row packets after the same profile | 4 / 1,131 / 114 | 4 / 891 / 60 |

Phrase presence uses the unchanged scorer's NFKC and Thai-digit normalization
and ignores whitespace; it is not byte-exact matching or a CER score. VL did
retain all 28 selected economy numeric tokens somewhere in its linear text, but
none of the 63 selected gold values mapped to its parsed table cells; its
population linear text had 0/35 selected numeric tokens. The frozen table
projection does not repair OCR values or infer cells. This is the parser-level
result before native retrieval.

### Actual GenesisRAG17 comparison

Each row is a separate fresh native state/store. Each arm completed all 17
stages and 48 responses (16 intents × 3 passes), passed the wrong-scope denial
and restart checks, and had stable metric ranks across all 16 intent repeats.
Hit counts below use the first response per intent. `row + header tokens@5`
requires row support and query-header token co-presence in a returned result;
it does not establish structural column binding. `column binding` separately
requires a retrieved row, exact target-cell sidecar span, and the header binding.

| Parser / projection | Chunks / packets | Row hit@1 / @5 | Row + header tokens@5 | Document hit@5 | Column binding@5 | Median first-pass query | Native wall / peak RAM |
|---|---:|---:|---:|---:|---:|---:|---:|
| Paddle / plain | 35 / — | 3/16 / 3/16 | 2/16 | 16/16 | — | 380 ms | 54.1 s / 1.58 GiB |
| Paddle / table-preserving | 156 / 114 | 4/16 / 4/16 | 4/16 | 16/16 | 2/16 | 351.7 ms | 72.0 s / 2.52 GiB |
| VL v1 / plain | 27 / — | 0/16 / 0/16 | 0/16 | 16/16 | — | 448 ms | 78.6 s / 1.78 GiB |
| VL v1 / table-preserving | 137 / 60 | 0/16 / 0/16 | 0/16 | 13/16 | 0/16 | 469.7 ms | 84.3 s / 2.16 GiB |

The fixed native test fixture's separate five-query gate probe passed with
recall@5, MRR and citation correctness at 1.0 and zero cross-tenant leaks in
all arms. This smoke check is not the Thai gold-query score. Exact evidence
citations and post-restart citation verification passed; these prove composite
TEXT and sidecar spans, not PDF geometry.

### Time and memory

VL inference used PaddleOCR 3.6.0, PaddlePaddle GPU 3.2.1 and PaddleX 3.6.1 on
the RTX 3060 12 GiB (`gpu:0`). The two serial passes took 1,498.5 s of reported
parser time and 1,509.8 s container wall time, including 27.4 s model load. The
container cgroup peak was 3,019,218,944 bytes (2.81 GiB). Per-PDF times were
148.4 s / 547.7 s on repetition 1 (economy / population) and 158.9 s / 611.4 s
on repetition 2. There were 1,380 one-second host GPU samples; whole-device
memory used peaked at 12,070 of 12,288 MiB from a 1,310 MiB first sample. This host
telemetry can include other processes and is not process-attributed VRAM.

The prior Paddle CPU parser took 362.8 s / 352.6 s container wall time and
peaked at 8,038,461,440 / 8,023,343,104 bytes (about 7.49 / 7.47 GiB) in
repetitions 1 / 2, respectively. These
parser timings and memory are descriptive: Paddle used CPU and VL used GPU, so
they do not isolate an engine speed advantage. Native runs used the same pinned
GenesisRAG17 image and CPU2/RAM6GiB/no-swap/network-none profile. The runner
mounted the exact `zuri-main-dev-20261020_ki17-model` Docker volume read-only
and used model subdirectory `614241f622f53c4eeff9890bdc4f31cfecc418b3` in all
four arms. The [prior table-chunking evidence manifest](../table-chunking/evidence-manifest.json)
records the E5 model-file fingerprints and confirms they matched its previous
baseline; this VL trial records the same volume/revision and does not claim a
new E5 rehash. Their
different chunk counts and content sizes are part of the parser/projection
comparison, so native wall-time deltas are not throughput-normalized.

All four native arms had no OOM. Native peak container memory ranged from
1.58–2.52 GiB. Paddle plain/table publication took 17.8 s / 35.8 s; VL
plain/table took 27.8 s / 37.1 s. The full per-arm timing, retrieval ranks,
resource receipts and integrity hashes are in
[measurement-summary.json](measurement-summary.json).

The first inference-launch attempt exited before model initialization because
wrapper telemetry occupied the model-output directory; it produced no PDF
prediction. The corrected attempt used a dedicated empty model-output directory
and completed. The earlier bootstrap wrapper formatting issue, preflight
attempts and failed evaluator path lookup are also preserved as receipts; they
are not scored runs.

## Scope limits

This is a two-document/four-page pilot, not a representative Thai corpus. Sampled
field checks are not full-document CER/TEDS; native retrieval does not evaluate
generated answers. It does not qualify customer-facing prices or stock, live
LINE behavior, production ingestion, concurrency or p95 latency. No OCR value is
corrected from gold, and no production or application code is changed.

## Evidence and reproduction

Raw parser outputs, logs, one-second GPU samples, run receipts, cache manifest,
native DB/store evidence and failed attempts are retained under
`.local/thai-paddleocr-vl-20261025/`. Reproduction uses the frozen source tree
and the exact image/model digests recorded in `protocol.json`,
`protocol-amendment.json` and the harness/native locks. The report does not
authorize rollout or production qualification.

The sealed [evidence manifest](evidence-manifest.json) lists report/raw file
hashes and the frozen model-cache manifest. It binds this result to the
unchanged gold hash without copying the private raw artifacts into the report.
