---
doc_type: assessment
status: measured-experiment
version: "0.1.0"
---

# Thai parser alternatives — same-corpus follow-up

Owner-authorized isolated follow-up to the [OXR assessment](../README.md).
No application parser, production configuration, disclosure grant, price or
stock authority is changed. Findings and actual execution status are recorded
below from actual measurement, not inferred from a model's advertised languages.

## Decision from this experiment

Advance **PaddleOCR PP-StructureV3 + Thai recognition, bounded to 1280 pixels**
to a larger evaluation. It outperformed the retained OXR run and the existing
PDF parser on this small corpus for text, structured tables and evidence retrieval.
It is not production-ready evidence: four synthetic contents are too few, some
Thai characters remain wrong, and the CPU profile is slow and memory-heavy.
The tested Docling/Tesseract configuration is not the preferred replacement.
No application parser was replaced and no production/LINE acceptance is claimed.

The [measurement summary](measurement-summary.json) contains per-input scores,
all query ranks and resource timings. The [manifest](evidence-manifest.json)
identifies the local raw evidence and source hashes; raw evidence is retained
under `.local/thai-parser-alternatives-20261025`, not committed or remotely archived.

## Measured extraction

Four digital PDFs and their four raster equivalents reuse four unique contents.
There are 24 distinct questions, and 90 reference table cells per variant,
including headers. Digital and raster results are paired, not independent samples.

| Parser / profile | PDF variant | Parsed | CER ↓ | QA evidence present in extracted text | Cell text present | Exact cell at row/column |
|---|---|---:|---:|---:|---:|---:|
| Existing parser | Digital | 4/4 | 3.02% | 18/24 | 83/90 | 0/90 |
| OXR retained API run | Digital | 4/4 | 1767.62% | 5/24 | 38/90 | 38/90 |
| Docling + Tesseract Thai | Digital | 4/4 | 3.15% | 19/24 | 51/90 | 47/90 |
| Paddle1280 Thai | Digital | 4/4 | **0.39%** | **22/24** | **85/90** | **85/90** |
| Existing parser | Raster | 0/4 | N/A | N/A | N/A | N/A |
| OXR retained API run | Raster | 4/4 | 2665.68% | 4/24 | 38/90 | 38/90 |
| Docling + Tesseract Thai | Raster | 4/4 | 22.27% | 11/24 | 4/90 | 0/90 |
| Paddle1280 Thai | Raster | 4/4 | **0.43%** | **22/24** | **85/90** | **84/90** |
| Original HTML control | HTML | 4/4 | 0.00% | 24/24 | 90/90 | 90/90 |

CER is edit distance divided by reference characters, after the original NFKC
and whitespace normalization. Insertions can make CER exceed 100%; it is not
an accuracy percentage. PDF text-layer defects are known in these synthetic
fixtures; the HTML control isolates that boundary. Table scores are reference
cell matches, not TEDS or a precision metric: extra output cells are not penalized.
QA evidence presence does not establish correct table-row association or a safe
customer answer. Default Paddle has **no measured quality score**; its setup and
resource failures are recorded below rather than folded into Paddle1280.

## Retrieval and chunking comparison

Same pinned multilingual E5 worker embedder, exact-cosine ranking, 24 questions,
and frozen evidence definitions. These are answer-bearing evidence hits, not
merely finding the right document. `current` is the existing chunker;
`experimental` is the prior Thai-boundary/table-row chunker, unchanged this round.

| Parser / variant | Current hit@1 | Current hit@5 | Experimental hit@1 | Experimental hit@5 |
|---|---:|---:|---:|---:|
| Existing / digital | 8/24 | 12/24 | 10/24 | 15/24 |
| OXR / digital | 0/24 | 1/24 | 1/24 | 1/24 |
| Docling / digital | 0/24 | 2/24 | 1/24 | 2/24 |
| **Paddle1280 / digital** | **17/24** | **21/24** | **21/24** | **21/24** |
| Existing / raster | 0/24* | 0/24* | 0/24* | 0/24* |
| OXR / raster | 0/24 | 0/24 | 0/24 | 0/24 |
| Docling / raster | 0/24 | 1/24 | 1/24 | 3/24 |
| **Paddle1280 / raster** | **17/24** | **21/24** | **21/24** | **21/24** |
| HTML control | 20/24 | 24/24 | 24/24 | 24/24 |

\* End-to-end unavailability: extraction failed, so conditional retrieval is
N/A, not a measured ranking failure. The unmeasured default Paddle arm similarly
retains zero end-to-end availability with conditional quality N/A. All 22 arms
reuse the same 24 questions; they are not 528 independent questions.

For Paddle1280, experimental chunking improved hit@1 from 70.83% to 87.50%,
without improving hit@5. Mean top-five context fell from 505 to 246 tokens
(digital), and 512 to 249 (raster). End-to-end MRR rose from 0.792 to 0.875.
No tokenizer overflow occurred. This measures offline retrieval, **not** native
Genesis hybrid/vector/graph traversal, reranking, model answers or LINE delivery.

The same three questions missed the strict evidence rule in both Paddle variants:

- `returns-5`: OCR rendered `รั่วซึม` as `รัวซึม`; the required phrase was not exact.
- `catalog-5`: `ถุงผ้าดอกบัว` became `ถุงผ้าดอกบั้ว`.
- `storage-3`: requested `45 วัน` and SKU were present, but `°C` in another cell
  of the same row lost its degree sign. The frozen table rule requires the full
  correct row, so this is a strict evidence miss, not a wrong retrieved value.

All three reached the right document at rank 1; changing the scorer to count
them now would invalidate the comparison. Docling's low digital CER also did not
predict good retrieval: normalized text scoring removes spaces, while embeddings
consume its spaced Thai output unchanged, and many complete table rows are wrong.
We did not add post-hoc normalization or repair OCR using reference answers.

## Runtime cost and operational limits

| New profile | CPU / memory limit | Initialization | Per-PDF median (range) | Completed |
|---|---|---:|---:|---:|
| Docling/Tesseract | 2 CPUs / 6 GiB | 12.8 s | 6.9 s (5.8–9.8) | 8/8 |
| Paddle1280 | 2 CPUs / 10 GiB, swap disabled | 22.7 s | 56.1 s (41.7–81.6) | 8/8 |

Paddle's final cgroup memory peak was **8,076,206,080 bytes (7.52 GiB)**.
Docling peak was not captured; 6 GiB is its configured ceiling, not a measurement.
Timings are one serial CPU pass with different memory ceilings and shared-host
load, excluding download/setup, not repeated throughput or p95 measurements.
They do not establish equal-hardware performance against the hosted OXR API.
Paddle's final container exited 0 with `OOMKilled=false`.

## Frozen comparison protocol

Reuse the exact eight PDF bytes, four unique contents, 24 questions and table
truth from the original evidence manifest. Do not regenerate fixtures or tune
against the answers. Keep existing and experimental chunkers, pinned E5 artifacts,
normalization, evidence scoring and exact-cosine ranking unchanged. Baseline/OXR
results are retained historical measurements of the same bytes, not fresh API
calls. All new inputs and outputs live in a separate ignored experiment directory.

Preselected candidates:

1. Docling 2.142.1 with Tesseract Thai + English, full-page OCR on both digital
   and image-only PDFs, and table structure recognition. Full-page OCR was
   requested to reduce reliance on the defective synthetic PDF text layer;
   the selected table pipeline's actual source preference is documented below.
   No extracted values are corrected against reference text.
2. PaddleOCR 3.7.0 / PaddlePaddle 3.3.1, PP-StructureV3 with the explicitly Thai
   `th_PP-OCRv5_mobile_rec` recognizer, table recognition enabled. Disable
   orientation, unwarping, formula/chart/seal extras for these upright documents.

Selection sources: [Docling full-page OCR example](https://github.com/docling-project/docling/blob/v2.142.1/docs/examples/full_page_ocr.py),
[Tesseract language data](https://github.com/tesseract-ocr/tessdata),
[PP-OCRv5 multilingual models](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.7.0/docs/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.en.md),
and [PP-StructureV3 configuration](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.7.0/docs/version3.x/pipeline_usage/PP-StructureV3.en.md).
Language support is a reason to test, not evidence that either candidate passes.

CPU-only containers, no application/database mounts or credentials. Model
download/setup is separate from timed inference; freeze package versions and
model hashes before offline runs. Record setup failures and all corpus-input
failures. If a candidate cannot run, classify it as unmeasured rather than losing
the arm. No production adoption is authorized by this benchmark.

## Resource-profile amendment before Paddle quality scoring

The original Paddle run exceeded 6 GiB (Docker OOM event, exit 137) before any
completed PDF. A same-configuration 10 GiB retry reached the table stage but
attempted a lazy orientation-model download offline. The first input failed
after the 180-second alarm; the process was stopped to avoid repeating this
setup failure across the corpus. These are infrastructure failures, not measured
OCR-quality results. Original logs, config and failure output are retained.

Before observing any successful Paddle output, define a separate `paddle1280`
profile: same model weights/framework, longest text-detector side capped at 1280
(`limit_type=max`), explicitly applied to general/table OCR; disable the separate
predict-time `use_table_orientation_classify` flag for these upright fixtures.
The original `min/736` detector profile does not downscale already-large pages.
This is a different preprocessing/resource profile, not a relabelled default
run. The full bounded-profile run completed at the 10 GiB ceiling and two CPUs;
only its successful outputs receive quality scores. An orientation weight was prefetched while
diagnosing the lazy load, but the corrected predict-time flag leaves it unused.

## Observed Docling table boundary

The selected full-page OCR profile does not guarantee OCR-authoritative table
text on digital PDFs. Independent source review found that Docling 2.142.1's
[TableStructureModel](https://github.com/docling-project/docling/blob/v2.142.1/docling/models/stages/table_structure/table_structure_model.py)
prefers word cells from the PDF backend's segmented page when present, falling
back to OCR/layout cluster cells when absent. The default
[Docling Parse backend](https://github.com/docling-project/docling/blob/v2.142.1/docling/backend/docling_parse_backend.py)
supplies decoded PDF text. Thus `do_cell_matching=True` can retain defective
digital text-layer values even while full-page OCR runs for prose.

Before the assessment adapter, the raw catalog digital export already had a
9-by-5 table with missing Thai vowel marks; the raster export already had a
TableItem with zero rows, columns and cells. These observations are retained as
pipeline outcomes, not repaired by reading reference answers. They do not
establish that every Docling backend/configuration has the same limitation.

## Reproduction and retained evidence

The measured parser image is
`sha256:79397a0f5fea3a2445a1a15a684f67948211f5b369f055e054e8c531df4a3e34`.
[Dockerfile](Dockerfile) records the build recipe; `models-after.json` in the
local evidence records the complete pip freeze, Tesseract packages and model
hashes. Rebuilding against mutable apt/transitive dependencies need not reproduce
the image bytes. The OXR hosted model build was not pinned; the comparison is
against its retained responses, not a claim about every OXR release.

Runtime: Docling 2.142.1, docling-core 2.104.0, docling-ibm-models 4.0.4,
PaddleOCR 3.7.0, PaddleX 3.7.2, PaddlePaddle 3.3.1, Torch 2.8.0+cpu.
Paddle MKL-DNN is disabled. General and table OCR both resolve to
`th_PP-OCRv5_mobile_rec`; model/config fingerprints before and after the offline
run match for all 63 retained files. This count includes unused cached weights
and is not a claim that all 63 files participate in inference.

[run_parser.py](run_parser.py) accepts `docling` or `paddle`, `--setup` for
download/initialization, and `--bounded-detector` for the measured Paddle1280
profile. Both constructor and prediction arguments are recorded in runtime JSON.
The final runner explicitly disables table orientation at prediction time;
historical failed default runs predate that correction and retain their own
runtime/config/log files. The runner refuses overwriting existing raw outputs.

To repeat inference, use a **new** evidence/output directory, copy and verify the
eight frozen PDFs, and mount only those inputs read-only at `/input`, the model
cache at `/cache`, the harness read-only at `/harness`, and the new output at
`/bench`. Setup requires model-download access; inference uses `--network none`,
`--read-only`, a writable `/tmp` tmpfs, two CPUs and the limits above. Set
`HOME=/cache/home`, `HF_HOME=/cache/hf`, `TORCH_HOME=/cache/torch`,
`PADDLE_PDX_CACHE_HOME=/cache/paddlex`, `HF_HUB_DISABLE_XET=1` and
`PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True`. Run serially:

```text
python /harness/run_parser.py docling --setup
python /harness/run_parser.py paddle --setup
python /harness/fingerprint.py /bench/models-before-bounded.json
python /harness/run_parser.py docling
python /harness/run_parser.py paddle --bounded-detector
python /harness/fingerprint.py /bench/models-after.json
```

The fingerprint helper expects the setup YAML under `/bench`; run setup and
inference with the same cache. Preserve model fingerprints and raw outputs rather
than silently replacing earlier runs. No company documents are submitted to a
public inference endpoint in this follow-up.

Measured postprocessing used the following sequence (historical paths; do not
overwrite the frozen evidence). The evaluator uses the original worker embedder
and model artifacts, validated by the hashes in [evaluate.py](../evaluate.py),
with the optional parser list `baseline,oxr,docling,paddle,paddle1280`.

```powershell
node reports/oxr-thai-2026-10-25/alternatives/prepare.mjs .local/thai-parser-alternatives-20261025 .local/oxr-thai-20261025
# In the pinned worker image, network disabled and model mounted read-only:
# /opt/ki17/venv/bin/python /bench/evaluate.py /bench /model/614241f622f53c4eeff9890bdc4f31cfecc418b3 baseline,oxr,docling,paddle,paddle1280
node reports/oxr-thai-2026-10-25/summarize.mjs .local/thai-parser-alternatives-20261025 reports/oxr-thai-2026-10-25/alternatives
node reports/oxr-thai-2026-10-25/alternatives/audit.mjs .local/thai-parser-alternatives-20261025 .local/oxr-thai-20261025 reports/oxr-thai-2026-10-25/alternatives
```

The adapter imports the exact shared chunker functions and never reads the
reference answers. [audit.mjs](audit.mjs) checks frozen evidence, input identity,
old-arm parity, model fingerprints, successful new outputs and token bounds,
then adds runtime/config/failure logs to the new manifest. Raw default-profile
failures remain visible: one ERROR and seven NOT_RUN inputs after the second
attempt was stopped; the earlier OOM is separate run evidence.

## Verification and next boundary

- Frozen original evidence: 37/37 hashes unchanged; all eight PDF bytes identical.
- Original 20 parsing rows and ten retrieval arms, including scores and query
  results, reproduced exactly. Shared-chunker prepared output also matched.
- New extraction: Docling 8/8 and Paddle1280 8/8. All 22 result rows finalized:
  16 retrieval arms have measured queries; six retain extraction unavailability
  and have no measured queries. Zero overflow among generated chunks.
- Metric regressions: 3/3; document reader/profile tests: 16/16, zero skipped.
- Relative file links: 174 checked, none missing; Python/JavaScript syntax and
  `git diff --check` passed. The final audit verifies 83 local evidence hashes.
- `npm run govern`: exit 0, 0 critical, 0 warning, 43 informational findings;
  `docs:llms` and `docs:llms:check` passed. These cover the updated experiment
  specification/navigation, not application or production acceptance.
- Independent GPT-6 Luna Max review signed off with no material blocker after
  checking all eight Paddle adapters, table counts, reading order, result tables,
  source references, 83 evidence hashes, nine source hashes and 37 frozen original
  hashes. Review corrected the distinction between finalized result rows and
  measured retrieval arms. A copy-paste host Docker command remains optional
  reproduction polish; the runtime constraints and in-container commands are above.

Next evaluation should use owner-approved real Thai documents with independently
checked ground truth, varied fonts, scans, merged/multipage tables and longer
documents, plus repeated resource measurements. Keep parser and chunker choices
separate, then test the native Genesis retrieval path if this candidate remains
strong. This is a proposed next experiment, not authorization to switch production.
Existing Vault/field disclosure, customer/staff scope, and authoritative ERP
price/stock checks remain unchanged; parsed price-looking text grants no authority.
