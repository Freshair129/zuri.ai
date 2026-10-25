---
doc_type: assessment
status: experiment-completed
version: "0.2.0"
---

# Table-preserving projection and native chunking experiment

Owner-authorized continuation of the [real Thai benchmark](../real-native/README.md).
No application parser identity, runtime setting, production data, price/stock guard
or disclosure grant changes. This is an experimental projection plus segmentation
profile, not an installed production chunker.

## Design and frozen protocol

Reuse the exact original Paddle run-1 output and public PDFs. Keep the original
gold, 16 questions, strict whole-row scorer, native image/model and five-query
publication control unchanged. Do not run OCR again, correct strings, infer values,
or expose gold/questions to the projection builder. Compare fresh native runs of
the old plain Paddle projection and the new table-aware projection; historical
binary-parser results remain context only. Query each question three times.

Expand HTML row/column spans into source-cell coordinates. Detect the header band
before the first row with at least `max(1, ceil((cellCount-1)/2))` numeric-shaped
physical cells using character syntax only, with no
Thai dictionary, province/month names, document-specific offsets or gold lookups.
Preserve unchanged cell strings from the frozen Paddle projection, positions and
spans. The previous adapter normalized HTML cell whitespace; raw HTML bytes are
retained separately and are not claimed to equal the cell strings. Reparse each
raw table HTML with the same normalization and assert exact row/cell/span equality.
Do not borrow
headers across pages, shift columns, or repair contradictory OCR structure.

Emit one Markdown section per eligible data row. Its **body** contains the header
band with explicit column ranges, followed by the original tab-separated physical
row. A synthetic `[table-row-end]` delimiter preserves trailing empty columns;
it is embedded projection overhead, not OCR evidence, and is excluded from cell
answer scoring. Native headings are metadata only, so do not put required evidence only in a
heading. Keep body <=480 raw/NFKC units and <=80 whitespace tokens. Oversize or
ambiguous non-data blocks retain their original text in fallback sections and are
reported separately; never claim those are atomic row bundles. No limit tuning
after retrieval evaluation. Sidecar mapping identifies source PDF/page/table/cells;
native citations still prove only exact transformed-TEXT substring lineage.
Each repeated cell also has an exact UTF-16 output span checked against its frozen
source cell; these are not geometric PDF bounding boxes.

Before inference freeze adapter/input hashes, verify eligible bundles yield one
exact native chunk, verify all source cell strings remain unchanged, and test
merged headers, OCR corruption, invalid spans, missing headers and size bounds.
Actual all17/native runs use separate disposable databases/stores and CPU2/RAM6GiB,
network none. Keep receipts, citation checks, wrong-business denial and restart
checks. Measure ingestion/query time and cgroup peak RAM, chunk count, repeated
header size and E5 token budget. Report row hit@1/5 and header-token co-presence
with the original scorer; these are not generated-answer correctness.

Header/column preservation means faithful to the OCR structure, not proof that
the OCR structure matches the page. Table OCR already misplaces some headers;
this experiment must retain and report those limitations. VL-based reparsing is
a separate future comparison, not part of this controlled chunking experiment.

## Execution

Both native runs passed: each published through 17 stages, served 48 held-out
queries (16 questions x 3), denied a wrong-business scope, and returned five
verified citations from the same generation after restart. The unchanged five
control queries passed. Publication/control success is not Thai answer accuracy.

All 114 eligible row packets became exactly one native chunk each, checked before
worker inference. All 1,131 source cells map to exact transformed-text spans;
repeated headers create 2,463 mapped occurrences. Raw HTML was reparsed and its
normalized rows/spans matched the old frozen projected cells exactly. Fifteen
header/context rows and nine non-data rows remain as fallback sections. No row
packet exceeded the fixed native limits, and no body-spanning row was admitted.
The syntax heuristic retains the BOT title/notes in its header band; repeated
context is part of the measured cost, not a tuned language-specific selection.

### Same-corpus comparison

Both columns below use the **same Paddle output**. The existing binary parser was
not rerun: its prior results are in the linked previous assessment. No OCR model
or recognition pass ran during this comparison. The common scorer and its gold
are unchanged; the newly added column-label diagnostic is reported separately.

| Metric | Old plain projection | Header/row/column projection |
|---|---:|---:|
| Complete ordered-row hit@1 / hit@5 | 3/16 / 3/16 | **4/16 / 4/16** |
| Row plus requested header-token co-presence, hit@5 | 2/16 | **4/16** |
| Correct-document hit@5 | 16/16 | 16/16 |
| Explicit association to listed gold column label, hit@5 | Not represented | 2/16 |
| Native chunks | 35 | 156 |
| Submitted transformed-text characters | 11,254 | 41,724 |
| Total E5 passage tokens including prefixes/specials | 5,569 | 18,587 |
| Largest E5 passage | 310 tokens | 208 tokens |
| Native submission through published finish | 17.80 s | 35.82 s |
| Native observed cgroup peak RAM | 1.58 GiB | 2.52 GiB |
| First-pass query median (16 queries) | 380.4 ms | 351.7 ms |
| Repeat query median (32 queries) | 342.7 ms | 373.3 ms |

The additional whole-row success is `eco6`, the exchange-rate row. Existing
successes `pop3`, `pop4`, `eco1` remain. Under the unchanged strict whole-row
metric, only those four questions have complete correct rows in frozen OCR:
the candidate retrieves all four, but this is **4/16 overall**, not 100% document
accuracy. A single requested cell can be correct while another cell or label in
its row fails this deliberately conservative metric. No generated answer is scored.

The new column diagnostic is exploratory post-run analysis, not a frozen primary
endpoint. It requires a retrieved complete row, its exact source-cell
value and OCR span-derived headers matching the gold's listed column path. It does
not require all question context (e.g. year), and is not full year/month binding.
It passes only `pop3`/`pop4`. In the BOT OCR, month labels are shifted relative to
data cells; page 2 of the population OCR also swaps header groups. The adapter
preserves these errors, as required. Same-chunk header tokens alone do not solve
wrong header-to-column associations, even when all requested words are present.

Both arms used two CPUs and a 6 GiB cap with swap disabled on the same host as the
previous run. Plain ran first, table second; one ingestion per arm and three query
passes are not enough to infer a speed improvement, production p95 or load capacity.
The native container wall times were 54.10/72.02 seconds. The RAM counter was read
at test teardown; it includes child processes/cache and is not isolated model RSS.
Query timing excludes verifier DB reads. Both containers exited 0 without OOM.
Reported metric ranks were stable for all 16 questions over the three passes.
No chunk exceeded the model's 512-token bound. Header duplication increased total
embedding input about 3.34x and ingestion time about 2.01x in this run.

### Decision

The profile preserves the eligible table rows through the actual native path and
recovers one lost row, but is not qualified for production. The remaining strict
row failures are already present in frozen OCR, and some column bindings are wrong.
The next parsing experiment can compare a vision-language document parser against
the same images/gold, without revealing gold to the parser. That is a separate
factor from this chunking comparison; no VL model was invoked here. Changing OCR
and chunking simultaneously would not isolate the cause of improvement.

### Reproduction and evidence

Working-tree experiment based on Zuri `49ef1ddbaa4db684bc5282ccc8df379e5a0028c8`.
Use the same pinned native image, E5 model and runtime provenance as the prior
real-native report. The test driver uses image Node 22.23.4; KI17 child processes
use `KI17_NODE` and the resolved Node 24.18.0 pin. Container writable layers are
ephemeral; only each run's evidence directory is a writable host mount.
The current raw root is
`.local/thai-table-chunking-20261025/run-v2/`. Earlier preparation folders are
unrun drafts: one added an empty-column delimiter, the next added stronger cell
span provenance, all before inference. No native run or OCR result was overwritten.

- [table-profile.mjs](table-profile.mjs): pure profile; no gold, queries, filesystem,
  model calls, lookup tables or value corrections.
- [prepare.mjs](prepare.mjs): checks original artifact hashes and HTML/table
  association, creates both arms and cell spans with exclusive output files.
- [run-native.ps1](run-native.ps1): serial isolated container execution with fresh
  databases and the existing embedding-model volume mounted read-only.
- [native.test.js](native.test.js): actual ingestion, atomicity, stages, native
  query, lineage, scope denial and restart checks; same previous acceptance harness
  plus pre-inference packet assertions. Gold is read only after publication.
- [evaluate.mjs](evaluate.mjs): unchanged common metrics plus separate column
  association diagnostic; verifies frozen input/profile/scorer/gold hashes.
- [measurement-summary.json](measurement-summary.json): per-question results,
  timings and resource measurements. Raw stage/citation data remain local.
- [evidence-manifest.json](evidence-manifest.json): exact input/source/output
  hashes, unchanged original artifacts, actual model fingerprints and commands.
  [token-audit.py](token-audit.py) records post-run E5 counts without truncation;
  the raw `token-audit.json` is included in the summary and evidence inventory.

Reproduce preparation with
`node reports/oxr-thai-2026-10-25/table-chunking/prepare.mjs .local/thai-native-20261025 <fresh-output>`;
use `freeze.mjs <fresh-output>` before inference to retain protocol/hash records,
then use `run-native.ps1 -EvidenceRoot
<fresh-output>`. Container names in the runner must be free. Do not rerun into
existing raw output directories. The evaluator compares the preserved pre-run
protocol snapshot instead of treating this completed report as the frozen draft.

Version diff 0.1.0 → 0.2.0: adds measured results and explicit normalization,
delimiter, column-association and resource-cost limits; no production adoption.

## Verification

- Native acceptance: both actual runs passed one test each; 17 stages and 48
  public QA queries per arm, scope denial and restart evidence retained.
- Profile and unchanged scorer/evaluator regression tests: 13/13 passed. The
  empty-column delimiter and source-span checks had failing tests before their
  implementation. Documentation reader/profile tests: 16/16 passed.
- `npm run govern`: exit 0, 0 critical, 0 warning, 43 informational entries.
- `npm run docs:llms`, `npm run docs:llms:check`, JavaScript syntax checks and
  `git diff --check` passed. Generated corpus remains local; Git emits existing
  CRLF-to-LF advisories, which are not content-check failures.
- Independent GPT-6 Luna Max reviews checked preparation isolation, exact cell
  provenance, native execution and recomputed metrics. Gold/common scorer and
  original OCR bytes remain unchanged; the five actual E5 model files match the
  previous run. No application source diff, CI, commit, merge or deployment is
  claimed. Both stopped measurement containers were removed after evidence capture.
