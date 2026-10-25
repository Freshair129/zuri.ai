---
doc_type: assessment
status: completed-experiment
version: "0.2.0"
---

# Thai OXR, parser and chunking experiment — 2026-10-25

**Recommendation: do not adopt the tested hosted OXR path for Thai documents.**
It returned severely corrupted and repetitive Thai text. The experimental
chunker improved retrieval on the current parser's output in this small corpus,
but is not a qualified replacement. No application code, production deployment,
Vault grants, product disclosure, price or stock authority was changed.

Scope comes from [unified-flow proposal §11.1](../../docs/change-requests/integration/line-knowledge-memory-unified-flow-20261024.md#111-owner-authorized-thai-parserchunking-experiment-2026-10-25).
Source inspected: Zuri `49ef1ddbaa4db684bc5282ccc8df379e5a0028c8`, with the
separate in-progress documentation patch preserved. This is dated evidence,
not a requirement, canonical amendment or activation approval.

## Corpus and controls

Four independent synthetic Thai documents: return conditions, two-column
delivery instructions, an eight-row product catalog and an eight-row storage
table. Each has a digital PDF and a raster-only PDF: **eight PDFs, four unique
contents**, 24 frozen questions, and 90 table cells including headers per format.
The original authored HTML is a separate clean-text/table control. Source text,
table truth, questions and input hashes were frozen before OXR requests.
Only synthetic data was sent to the public API; synthetic prices are not ERP data.
The rendered one-page fixtures were visually inspected for legibility/clipping.

The four PDF arms combine current/OXR extraction with current/experimental
chunking. Neither chunker reads gold answers. The control uses the existing HTML
parser, not reference text injected into a chunker.

## Extraction results

| Input / parser | Successfully parsed / corpus docs | Weighted character error rate | QA evidence preserved | Cell text present | Correct structured row/column |
|---|---:|---:|---:|---:|---:|
| Digital / current PDFjs | 4/4 | 3.02% | 18/24 | 83/90 | 0/90 |
| Digital / hosted OXR | 4/4 | 1,767.62% | 5/24 | 38/90 | 38/90 |
| Raster / current PDFjs | 0/4 | N/A | N/A | N/A | N/A |
| Raster / hosted OXR | 4/4 | 2,665.68% | 4/24 | 38/90 | 38/90 |
| HTML / current HTML parser | 4/4 | 0% | 24/24 | 90/90 | 90/90 |

CER is Levenshtein distance divided by reference character count, weighted over
documents after NFKC and removal of Unicode whitespace. Punctuation and corrupt
NUL characters remain. **CER can exceed 100% because inserted/repeated text is
counted; it is not an accuracy percentage.** OXR's catalog heading, for example,
became a mathematical expression rather than the Thai heading. Some numeric/SKU
cells survived while Thai names did not.

Cell-text presence does not prove a row association. The current PDF parser has
no structured table extraction, hence zero structured-position matches despite
many readable values. The table metric is exact cell/position matching, not TEDS.
It is gold-cell recall-style matching and does not penalize extra output cells
or rows. QA evidence preservation counts questions whose required exact evidence
phrases appear in the entire extracted document; it is not an independent string
inventory or a chunk-level retrieval score.
Raster baseline fails explicitly with `IMAGE_ONLY_DOCUMENT`; its OCR accuracy
is not measured. HTTP success from OXR only means an output was received.

## Retrieval results

Every row has the same 24 questions. A hit requires an answer-bearing chunk;
table questions require all supporting row fields together. Merely retrieving
the correct document does not pass. Rates below are end-to-end, including source
unavailability; conditional retrieval for the unsupported raster baseline is N/A.

| Input | Parser | Chunker | Chunks | Evidence hit@1 | Evidence hit@5 | MRR |
|---|---|---|---:|---:|---:|---:|
| Digital | current | current | 18 | 8/24 (33.33%) | 12/24 (50%) | .403 |
| Digital | current | experimental | 20 | 10/24 (41.67%) | 15/24 (62.50%) | .491 |
| Digital | OXR | current | 135 | 0/24 | 1/24 (4.17%) | .014 |
| Digital | OXR | experimental | 161 | 1/24 (4.17%) | 1/24 (4.17%) | .042 |
| Raster | current | current | 0 | 0/24; source unavailable | 0/24; source unavailable | 0 |
| Raster | current | experimental | 0 | 0/24; source unavailable | 0/24; source unavailable | 0 |
| Raster | OXR | current | 259 | 0/24 | 0/24 | 0 |
| Raster | OXR | experimental | 313 | 0/24 | 0/24 | 0 |
| HTML control | current HTML | current | 9 | 20/24 (83.33%) | 24/24 (100%) | .910 |
| HTML control | current HTML | experimental | 35 | 24/24 (100%) | 24/24 (100%) | 1 |

Digital current-parser document-hit@5 is 100% for both chunkers, while evidence
hit@5 is only 50%/62.5%. Correct-file retrieval alone would hide missing evidence.
The experimental HTML arm creates 35 rather than 9 chunks; indexed token count
rises from 940 to 1,441, while mean top-five token count falls from 536 to 242.
Digital baseline indexed tokens rise from 2,497 to 2,976, with mean top-five
tokens 733 to 757. This is a quality/cost tradeoff, not a free improvement.
No evaluated embedding input exceeded 512 tokens; maximum observed was 484.

## What actually ran

- Current extraction: real `parseKnowledgeBinary`, PDFjs 6.4.299, and the real
  HTML parser. The binary identity is generated by the current
  `genesisRag17BinaryParserIdentity` helper.
- Current Stage 7: real `parseGenesisRag17Document`, parser-3/chunker-2,
  80 whitespace tokens, 480 raw/NFKC characters and up to 60-character overlap.
  This is not the older generic 400-word splitter.
- Experimental `structure-thai-480-v1`: ICU 78.3 Thai word/grapheme boundaries
  within parser blocks, the same budgets, simple table rows with repeated
  headers. It assumes the first table row is a header; merged tables fall back
  to text, long-row fallback loses the repeated header, and captions are not
  attached. It is an experimental implementation, not complete semantic chunking.
- OXR: official hosted endpoint `https://free-oxr.somark.cn/api/v1/parse/sync`,
  markdown/JSON output. The `.ai` endpoint directed callers to `.cn`. The official
  README was inspected at `c1a1dcb312ee9f691404f127785510453c0d9350`; **the hosted
  model/build revision was not exposed or pinned**. No local OXR inference ran.
  The machine has a 12 GB RTX 3060, below the documented 24 GB minimum.
- Three overlapping requests initially returned HTTP 429/code 1133 (a task was
  already active). These attempts are retained. A bounded serial retry received
  all eight outputs. Successful request times were 36.9–101.5 seconds/page,
  including remote queue/network/inference. Current digital extraction took
  0.33–0.55 seconds/page locally; these are not comparable GPU throughput tests.
- Retrieval: original Genesis worker E5 embedder, CPU ONNX,
  `intfloat/multilingual-e5-small` revision
  `614241f622f53c4eeff9890bdc4f31cfecc418b3`, 384 dimensions, original query/passage
  prefixes, pooling and normalization. All five model artifact hashes were
  checked before evaluation; input token lengths were checked without truncation.
- An ephemeral Docker container used `--network none --read-only --cpus 2
  --memory 3g`, the existing model volume mounted read-only, and only the ignored
  experiment directory writable. No database or application-state mount.
  Image: `sha256:9bee2c31dc0efee6f2564eab273f9c815961a1635c08a29805849524974163e7`.

Retrieval is **offline exact cosine ranking**, not GenesisBlockDB's native
hybrid/vector/graph traversal, reranking, MSP query relay or live LINE acceptance.
No LLM generated answers. Page/block metadata was retained where supplied, but
citation-location accuracy was not scored.

## Validity limits and next decision

This is a small synthetic corpus with one font, clean rasterization and no
real scanned catalogs. Chromium's Thai PDF text layer contained accent-spacing
and NUL issues; a separate PDFium probe also showed extraction defects despite
readable rendered pages. Consequently the baseline's 3.02% CER includes
fixture/text-layer effects and is not a universal PDFjs Thai score. The perfect
HTML extraction control isolates that issue from chunking.

The hosted OXR result cannot establish the quality of a pinned local OXR model,
other languages, other settings or unseen Thai documents. No repeated-run
variance or statistically independent holdout was measured. Exact support-string
matching penalizes normalization/recognition differences; it is an evidence
preservation check, not a semantic human-answer score.

Keep the current production parser/chunker unchanged. Before any adoption,
evaluate a pinned parser on representative authorized Thai scans and complex
tables, with held-out questions, human-reviewed text/table truth and native
retrieval acceptance. A chunker cannot repair hallucinated OCR. Licensing and
hardware acceptance remain separate: consult the official
[OXR repository](https://github.com/SoMarkAI/OXR),
[model card](https://huggingface.co/SoMarkAI/OXR-1.0),
[license](https://github.com/SoMarkAI/OXR/blob/c1a1dcb312ee9f691404f127785510453c0d9350/LICENSE)
and [benchmark documentation](https://github.com/SoMarkAI/OXR/blob/c1a1dcb312ee9f691404f127785510453c0d9350/docs/benchmark.md).

## Reproduction and retained evidence

[Measurements](measurement-summary.json) retain per-document metrics, per-query
rank/hit evidence, model hashes and resource counts without the verbose raw text.
[Evidence manifest](evidence-manifest.json) hashes raw input/output and results in
the ignored `.local/oxr-thai-20261025` directory. That local evidence is not shipped
by this report; hashes alone are not an archive. The scripts reproduce synthetic
inputs and evaluation, but cannot pin or reproduce the external service build.

The command blocks below document the **original measured run**, not commands
to rerun against the retained evidence. A fresh experiment must replace every
evidence path, Docker bind source and summary destination with a new directory;
`summarize.mjs` defaults to this report's destination and also needs a separate
output location for a fresh run. Do not overwrite the retained results.
The optional second argument supports that destination:
`node reports/oxr-thai-2026-10-25/summarize.mjs <new-evidence-root> <new-summary-directory>`.

Original fixture commands, from the repository root with Server dependencies
and Playwright Chromium, Python PDFium/Pillow and pinned model artifacts available:

```powershell
node reports/oxr-thai-2026-10-25/generate.mjs .local/oxr-thai-20261025
python reports/oxr-thai-2026-10-25/rasterize.py .local/oxr-thai-20261025
node reports/oxr-thai-2026-10-25/parse.mjs .local/oxr-thai-20261025 baseline
node reports/oxr-thai-2026-10-25/parse.mjs .local/oxr-thai-20261025 html-control
```

Inspect [parse.mjs](parse.mjs) before explicitly choosing its networked OXR mode;
do not submit private documents to the public service. Run requests serially.
Then [prepare.mjs](prepare.mjs) builds the arms and [evaluate.py](evaluate.py)
runs with the pinned worker embedder/model; [summarize.mjs](summarize.mjs) writes
the compact result and manifest. [generate.mjs](generate.mjs),
[rasterize.py](rasterize.py) and [metric tests](test_metrics.py) are retained.
Model/worker artifacts must be supplied independently; this harness does not
download or replace production artifacts. Re-rendered PDF bytes may differ
because of generator metadata; the manifest identifies the actual measured run.

After retaining OXR responses, the original measured local evaluation used this
sequence. These are historical commands: do not rerun them against the frozen
directory. Paths and model-volume name identify this machine, not deployment
defaults. The model volume is read-only; no DB volume is attached.

```powershell
node reports/oxr-thai-2026-10-25/prepare.mjs .local/oxr-thai-20261025
$workerEmbedder = 'D:/GenesisBlock_Dev/GenesisBlock/genesisrag17-worker/src/embedder.py'
if ((Get-FileHash -LiteralPath $workerEmbedder -Algorithm SHA256).Hash -ne '17C996A8BF5C9F7A818EC35F2C1F99A58A3FB71D679270334E19D5BF76FB9596') { throw 'Worker embedder revision differs' }
Copy-Item -LiteralPath $workerEmbedder -Destination .local/oxr-thai-20261025/embedder.py
Copy-Item reports/oxr-thai-2026-10-25/evaluate.py .local/oxr-thai-20261025/evaluate.py
docker run --rm --name zuri-oxr-thai-eval --network none --read-only --cpus 2 --memory 3g --mount 'type=volume,source=zuri-main-dev-20261020_ki17-model,target=/model,readonly' --mount 'type=bind,source=C:/Users/suanr/workspace/zuri.ai/.local/oxr-thai-20261025,target=/bench' --entrypoint /opt/ki17/venv/bin/python sha256:9bee2c31dc0efee6f2564eab273f9c815961a1635c08a29805849524974163e7 /bench/evaluate.py /bench /model/614241f622f53c4eeff9890bdc4f31cfecc418b3 *> .local/oxr-thai-20261025/eval-final.log
if ($LASTEXITCODE -ne 0) { throw 'Evaluation failed; do not summarize as passed' }
node reports/oxr-thai-2026-10-25/summarize.mjs .local/oxr-thai-20261025
```

## Verification

- Real extraction and pinned-E5 evaluation completed for all ten arms, with the
  four unsupported raster-baseline inputs kept explicit. Zero token overflows.
- `test_metrics.py`: 3/3 passed, including independent edit-distance comparison,
  corruption preservation and a wrong-table-row counterexample.
- `node --test tools/tests/document-views.test.mjs apps/server/tests/node/document-profile-validation.test.mjs`:
  16/16 passed, zero skipped.
- `npm run govern`: exit 0; 0 critical, 0 warning, 43 informational findings.
  Includes registry/inventory/identity, graph freshness and 96 generated-view checks.
- `npm run docs:llms` and `npm run docs:llms:check`: passed.
- Relative file links: 163 checked, none missing. Raw evidence manifest: 37/37
  hashes verified. `git diff --check`: passed.
- Independent GPT-6 Luna Max review required the end-to-end MRR denominator,
  corpus-input/API-attempt distinction, QA-evidence/table metric labels and
  original-run reproduction boundaries to be clarified; these were corrected.
  Final independent review signed off with no remaining blockers. Separate
  summary-output regression reproduced both measurement and manifest hashes.
  No production or live LINE acceptance is claimed by these checks.

## Follow-up

The [local parser alternatives](alternatives/README.md) reuse these frozen inputs
and original measurements. Shared chunker exports and an optional parser-list
argument were added for that follow-up; original metric definitions and retained
results are unchanged. Version 0.2.0 adds this navigation only to the assessment.
