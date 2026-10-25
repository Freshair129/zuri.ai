# Hyper-Extract economy held-cell follow-up

Status: completed non-production source-evidence and retrieval experiment. The source-derived row text is a separate experimental projection. Its semantics remain `NOT_ASSESSED`; graph admission is `NONE`.

## What changed

The 87 historical held OCR-cell records remain byte-for-byte and status-for-status unchanged. The independent audit found 87 old records across 13 affected physical row baselines, but their old OCR representation merges values, lacks cell boxes, and includes a cyclically shifted row and a missing label. The experiment therefore kept those old IDs held and derived new PDF-native row records from source geometry instead of relabeling old records.

The frozen PDF and raw Paddle OCR boxes support 37 complete physical economy rows with 259 numeric cells. Each PDF numeric word was uniquely matched to a raw Paddle token and box at its physical row and month slot. Four parenthetical percentage rows have a literal label difference: PDF text extraction emits `(D%)`, while the rendered page and Paddle OCR show `(∆%)`. Both strings are preserved; the experiment does not infer those rows' relationship to adjacent rows. The table's `2567` year word is retained as table context and is not assigned to any month.

The measured candidate preserves the prior PDF repair arm's full content and 64 source-range records as an exact prefix, then appends a context record and 37 new economy rows. It contains the prior 59 PDF-derived population row bodies plus the new 37 economy rows. This is a combined treatment; the table-baseline versus candidate difference cannot be attributed to the economy rows alone. The prior overlay result below is a separate historical reference, not a contemporaneous arm.

The earlier 972-cell inventory and 87 held statuses are retained as frozen historical evidence; this follow-up did not recompute or reclassify that inventory. The new 37 PDF-native rows are a separate source-derived record set. They do not silently resolve or replace any of the old 87 IDs. The prior overlay's 59 PDF-derived population row bodies and associated evidence ranges are preserved unchanged as the candidate prefix.

No inference calls were made. The extraction used original PDF text, PDF geometry, and frozen Paddle text/boxes. No QA, gold answers, or retrieval metrics were used to select rows or values. The existing 87 held records were not reclassified by this run.

## GenesisRAG17 retrieval results

All three receipts use the frozen 16-query corpus with three repetitions, the same pinned GenesisRAG17 image and read-only E5 model volume, separate disposable state, no network, 2 CPU and a 6 GiB memory cap. The table baseline and prior PDF overlay results are reused receipts; only the combined candidate was newly run for this follow-up.

| Measure, 16 first-pass queries | Current table baseline | Prior PDF overlay, historical | Combined prior overlay + 37 economy rows |
|---|---:|---:|---:|
| Strict legacy row hit @1 | 4/16 | 2/16 | 1/16 |
| Strict legacy row hit @5 | 4/16 | 4/16 | 4/16 |
| Strict row + required header tokens @5 | 4/16 | 4/16 | 4/16 |
| Exact PDF-derived correct row body @1 | 0/16 | 8/16 | 9/16 |
| Exact PDF-derived correct row body @5 | 0/16 | 10/16 | 12/16 |
| New economy PDF row, exact correct body @1 | 0/16 | 0/16 | 1/16 |
| New economy PDF row, exact correct body @5 | 0/16 | 0/16 | 2/16 |
| Post-freeze union: legacy row or correct PDF-derived row @1 | 4/16 | 10/16 | 10/16 |
| Post-freeze union: legacy row or correct PDF-derived row @5 | 4/16 | 12/16 | 14/16 |
| Document hit @5 | 16/16 | 16/16 | 16/16 |

The strict legacy row score ties the baseline at @5 and falls from 4/16 to 1/16 at @1 in the combined arm. The post-freeze union diagnostic reaches 14/16 at @5, including two queries supported by the newly added economy rows. That union is exploratory and depends on exact source-row/value agreement against the frozen QA after projection freeze; it is not semantic or answer acceptance. The row-plus-header metric only checks header-token presence in the same result text, not binding to the matching cell.

| Native receipt measure | Current table baseline | Prior PDF overlay, historical | Combined candidate |
|---|---:|---:|---:|
| GenesisRAG17 stages / query count | 17 / 48 | 17 / 48 | 17 / 48 |
| Indexed chunks | 156 | 277 | 302 |
| Native elapsed time | 82.17 s | 106.30 s | 148.41 s |
| Cgroup peak memory | 2,693,615,616 bytes (2.51 GiB) | 3,728,732,160 bytes (3.47 GiB) | 4,497,965,056 bytes (4.19 GiB) |

The combined run adds 25 chunks, about 42.1 seconds, and 769,232,896 bytes of cgroup peak memory relative to the historical prior overlay receipt. The prior overlay and new candidate are not a controlled two-arm run, so these deltas are descriptive.

## Reproduction and checks

Run from the repository root:

```powershell
& '.local/hyper-held-cell-audit-20261025/pdf-geometry-venv/Scripts/python.exe' 'reports/oxr-thai-2026-10-25/hyper-economy-cell-repair-v1/build_pdf_baseline_rows.py'
& '.local/hyper-held-cell-audit-20261025/pdf-geometry-venv/Scripts/python.exe' 'reports/oxr-thai-2026-10-25/hyper-economy-cell-repair-v1/build_native_input.py'
& '.local/hyper-held-cell-audit-20261025/pdf-geometry-venv/Scripts/python.exe' -m unittest discover -s 'reports/oxr-thai-2026-10-25/hyper-economy-cell-repair-v1' -p 'test_*.py' -v
& 'apps/server/node_modules/.bin/vite-node' --root apps/server --config apps/server/vitest.config.js reports/oxr-thai-2026-10-25/hyper-economy-cell-repair-v1/native_chunker_probe.mjs
& 'reports/oxr-thai-2026-10-25/hyper-economy-cell-repair-v1/run-native-combined.ps1' -PreflightOnly
& 'reports/oxr-thai-2026-10-25/hyper-economy-cell-repair-v1/run-native-combined.ps1'
node 'reports/oxr-thai-2026-10-25/hyper-economy-cell-repair-v1/evaluate-combined.mjs'
node 'reports/oxr-thai-2026-10-25/hyper-economy-cell-repair-v1/seal-evidence.mjs'
```

The pinned Python tests passed 18/18. The real parser/chunker probe passed for all 59 prior population row bodies and all 37 added economy rows, with all seven header/value atoms and the row label in one chunk; all 114 unchanged table packets remained represented. The isolated native test passed 1/1, completed all 17 stages and 48 queries, and exited 0.

## Boundaries and artifacts

- No production, canonical requirements, or graph admission changed.
- No old held ID, OCR span, or status was rewritten. The new PDF rows are independent source evidence, not a claim that every old OCR cell identity has been restored.
- The four `(D%)`/`(∆%)` discrepancies and table-year context are preserved literally; interpretation remains unassessed.
- The source audit is [source-audit.md](source-audit.md); the machine-readable ledger is [source-audit.json](source-audit.json).
- Frozen inputs and native receipts are listed in [measurement-summary.json](measurement-summary.json) and the sealed [evidence-manifest.json](evidence-manifest.json).

Key hashes:

- Combined native input: `b71bdc93b5175bf760cfb5d669dc2f8cc06e4c4a72c65ecb7c43368eaaf9f06c`
- Combined freeze: `8db7f4ec59731f17c60c8d0191ce719fb9eb59d9be7101b6609eeaabcfde4e41`
- No-QA parser/chunker probe: `8eaa23ce3366d96d65b91faaf94b0159241345e234236a73ed86a967fa623d53`
- Native results: `035f6db1f558dd58ec5220abfff3357dba6c31e7ba626d7889a06a02be6337ea`
