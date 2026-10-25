# Hyper held-cell source repair audit v1

Status: completed nonproduction experiment. The source-PDF arm is an isolated
retrieval overlay; it does not change the native parser, OCR files, canonical
knowledge, graph admission, or production behavior.

## Result

An all-cell re-evaluation covered 972 records: the 632 previously resolved value
cells, 101 source row-label records, and all 239 cells previously held. The
source-native pass structurally resolved 885 records and left 87 economy cells
held. The 239-cell primary-cause audit is in
[held-cell-audit.json](held-cell-audit.json) and
[held-cell-audit.md](held-cell-audit.md):

| Primary cause among the 239 held cells | Count |
| --- | ---: |
| Header-binding geometry | 129 |
| OCR row-grid layout | 59 |
| OCR value recognition | 23 |
| OCR cell or row-label binding | 21 |
| Conservative row-label ambiguity | 7 |
| **Total** | **239** |

PDF vector geometry resolved the 152 population cells affected by header-grid
structure. A separate source-text pass found 118 numeric values across 59 full
rows that differed from Paddle OCR and had unique PDF vector-cell and clean
native PDF text-word evidence. These comprise 23 cells from the held cohort and
95 collateral cells that had previously been resolved. All 118 were checked
against the original rendered PDF cells. The original Paddle strings and spans
remain unchanged; PDF-derived values are separate records with PDF, page, cell,
word and bounding-box provenance. No manual per-cell value table or question
answers selected the records.

The 87 remaining held cells are in the economy table. Their rows or row labels
cannot be bound to unique month cells from the available source geometry, so
they remain unchanged source context. No value was assigned by nearby position.
The derived view contains 3 header maps and 59 complete row blocks. All values
remain structural/lexical candidates: semantic status is `NOT_ASSESSED` and
graph admission is `NONE`.

## Retrieval comparison

The comparison uses the same frozen 16-query QA set and native profile. The
unchanged table baseline is the completed attempt-1 arm; the source-PDF overlay
is the single candidate attempt-2 arm. Each used a separate disposable native
state. The candidate and projection were frozen before the evaluator read QA.
Each arm completed 17 stages and 48 queries.

| Metric | Table baseline | Source-PDF overlay |
| --- | ---: | ---: |
| Legacy strict row-format hit @1 | 4/16 | 2/16 |
| Legacy strict row-format hit @5 | 4/16 | 4/16 |
| Exact frozen Paddle row line @1 | 11/16 | 2/16 |
| Exact frozen Paddle row line @5 | 11/16 | 11/16 |
| Full raw header-plus-row packet @5 | 11/16 | 11/16 |
| Row plus required header tokens @5 | 4/16 | 4/16 |
| Document hit @5 | 16/16 | 16/16 |
| Exact complete PDF-derived row body present @1 | 0/16 | 8/16 |
| PDF-derived body matches the requested gold row @1 | 0/16 | 8/16 |
| Exact complete PDF-derived row body present @5 | 0/16 | 10/16 |
| PDF-derived body also matches the requested gold row @5 | 0/16 | 10/16 |
| Any PDF-derived range overlap @5 | 0/16 | 10/16 |
| Any PDF-derived range citations in top 5 | 0 | 33 |
| Full metadata-plus-provenance row frame in one result chunk @5 | 0/16 | 0/16 |

The unchanged primary row metric is format-sensitive: its legacy predicate
looks for the source label and complete gold value sequence on one contiguous
row line. The derived body serializes values as header/value atoms, so the
primary metric does not recognize that representation. A post-hoc diagnostic
unions the existing primary hit with an exact complete PDF-derived row-body
line in a same-document top-k chunk whose derived values match the frozen gold
row:

| Post-hoc complete-row evidence union | Baseline | Source-PDF overlay |
| --- | ---: | ---: |
| @1 (primary + derived; overlap) | 4/16 (4 + 0; 0) | 10/16 (2 + 8; 0) |
| @5 (primary + derived; overlap) | 4/16 (4 + 0; 0) | 12/16 (4 + 10; 2) |

The union is a diagnostic, not a replacement for the primary metric or proof of
semantic answer correctness. It records 6 additional queries at @1 and 8 at
@5 with a complete gold-matching row representation retrieved.

The PDF-derived body is a distinct source representation, not a correction to
the baseline OCR. Its complete row text appeared in the top five for 10 queries;
the broader exact-row metric tied at @5 and regressed at @1. The 33 overlapping
citations comprise 26 row-frame ranges and 7 header-map-only ranges. A row-atom
presence metric is also 10/16, but it means any cell atom from the row, not the
answer-column atom. The full frame is longer than the native chunk limit and is
split across two chunks for all 59 rows; the shorter label-plus-header/value
body is preserved intact in one chunk for all 59.

The treatment adds 40,686 characters over the unchanged 41,724-character table
baseline (97.5% overhead), producing 82,410 characters and 277 chunks versus
156 baseline chunks. Total runtime was 106,300 ms versus 82,170 ms. Peak cgroup
memory was 3,728,736,160 bytes versus 2,693,615,616 bytes. The native harness
recorded no token counts. The legacy primary row-format metric tied at @5 and
fell at @1; the post-hoc union shows the derived row representation supplies
additional complete-row evidence in this sample. Neither measure establishes
semantic correctness or parser adoption.

## Source and runtime boundary

The treatment preserves the exact baseline table content as its prefix and all
114 frozen header/row packets appear in at least one native chunk in both arms.
The harness adds a `doc` field to baseline range metadata; baseline content,
packet text, and range coordinates are preserved. The candidate has 64 ranges:
3 derived header maps and 59 complete row frames. Derived ranges carry native
content offsets and hashes, not original-source offsets. To keep the indexed row
body within one native chunk, the v2 framing moves repeated raw-OCR qualifier
text out of that body; the original text remains verbatim in the baseline prefix
and per-cell provenance sidecar. It does not change any row label, header path,
or PDF-derived value.

The correction pass made no model calls. The no-QA chunk-boundary probe used the
actual GenesisRAG17 parser/chunker and passed baseline parity (156 chunks),
114/114 packet coverage in each arm, and 59/59 complete label-plus-header/value
row bodies in one chunk. The native run used the pinned image
`sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39`, a
read-only E5 model volume, fresh disposable state, no network, 2 CPUs and a 6
GiB memory limit. The measured run completed 17 stages, 48 queries, expected
scope denial, and restart/citation verification. No application or production
behavior changed.

## Reproduction and artifacts

Pinned Python 3.11.17 source/geometry tests:

```powershell
& '.local/hyper-extract-20261025/venv/Scripts/python.exe' -m unittest discover -s reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1 -p 'test_*.py' -v
```

Actual parser/chunker, no-QA probe:

```powershell
& 'apps/server/node_modules/.bin/vite-node.cmd' --root apps/server --config apps/server/vitest.config.js reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/native_chunk_boundary_probe.mjs
```

Attempt-2 host preflight and candidate run:

```powershell
.\reports\oxr-thai-2026-10-25\hyper-held-cell-audit-v1\run-native-held-cell-repair.ps1 -Arm source-pdf-repair-v1 -Attempt attempt-2 -PreflightOnly
.\reports\oxr-thai-2026-10-25\hyper-held-cell-audit-v1\run-native-held-cell-repair.ps1 -Arm source-pdf-repair-v1 -Attempt attempt-2
node reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/evaluate-held-cell-native.mjs
```

The evaluator output is [measurement-summary.json](measurement-summary.json).
The raw, frozen inputs and native receipts are under
`.local/hyper-held-cell-audit-20261025/`; attempt-1 receipts remain intact.
`evidence-manifest.json` binds the report, source/geometry/projection freezes,
no-QA probe, native inputs, and both measured native receipts.
