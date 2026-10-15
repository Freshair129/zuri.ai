---
id: ZAI:TASK-ZAI-048-PARSER-CONTRACT
title: TASK-ZAI-048 — Binary document parsing contract
version: "0.1.0b"
status: candidate
created_at: "2026-10-15T18:59:00+07:00,Codex,base c2c0816ba3c83665334e45680000dbb931e46874"
last_update: "2026-10-15T18:59:00+07:00,Codex"
superseded_by: null
attributes:
  domain: knowledge
  doc_type: implementation-plan
  task: TASK-ZAI-048
  scope: proposal-only Stage 2 binary parsing and source-location contract
  complexity: C-3
  risk: HIGH
relations:
  - type: references
    target: ZAI:ADR-050
  - type: references
    target: ZAI:ADR-072
  - type: references
    target: ZAI:FR-115
  - type: references
    target: ZAI:FR-116
  - type: relates_to
    target: ZAI:FR-138
  - type: relates_to
    target: ZAI:TASK-ZAI-047-CONSOLE-PLAN
  - type: relates_to
    target: ZAI:TASK-ZAI-049-STORAGE-SPEC
---

# TASK-ZAI-048 — Binary document parsing contract

**Lifecycle: candidate proposal only; non-authoritative. No binary parser, schema,
or product behavior is accepted or implemented by this document.** This draft is
limited to the documentation objective recorded for TASK-ZAI-048. It does not
amend source-preserved requirements, ADRs, stage catalogs, storage contracts,
production behavior, or task status. TASK-ZAI-048 remains
`planned / UNKNOWN / NOT_STARTED` in the inspected roadmap at `c2c0816`.

All choices below marked **Proposed** require review and acceptance by the
existing product and service authorities before implementation. The current
approved knowledge admission path remains Text/Markdown only under ADR-072.
Implementation, provider activation, OCR, migrations, and production acceptance
are **NOT_RUN / NOT_ACCEPTED**.

## 1. Objective and boundary

Specify a bounded, deterministic extension point for PDF, DOCX, and static HTML
parsing at Stage 2, with verifiable source locations carried through Stage 3,
Stages 7–9, and citation resolution. Preserve the immutable raw source version
and all historical artifacts. A parser or mapping change creates a distinct
parsed identity and never rewrites a prior artifact, chunk, occurrence, source
version, or published citation.

The proposal covers Tier 1 parsing, source mapping, lineage, and fixture-based
acceptance. It does not change Stage 9 ownership: GKS remains the Stage 9 entity
resolution owner under ADR-050. It does not claim that Tier 1 executes Stages
10–17 or writes native knowledge stores.

**OCR is excluded from proposed v1.** There is no OCR/provider/model call and no
OCR-derived text. Image-only input is a typed refusal; an otherwise parseable
document that contains images or may contain text inside images receives a
typed warning that this content was not examined. A later OCR proposal requires
separate authority and a contract for provider/model identity, confidence,
provenance, and human review before any OCR-derived content can be recorded.
FR-138's separate Asset evidence candidate/review workflow is not a substitute
for that authorization or a second knowledge admission path.

## 2. Source evidence and current authority

The following sources were read from the exact base revision
`c2c0816ba3c83665334e45680000dbb931e46874`:

| Source | Current meaning used here |
|---|---|
| [Canonical roadmap](../roadmap/ROADMAP.md), TASK-ZAI-048 row and 2026-10-14 next implementation plan | Task is planned, dependency TASK-ZAI-046 is done, and the next slice is contract-only. The roadmap requires immutable Stage 2→3 mapping, offsets/provenance through 7–9, concrete limits, parser/reparse rules, and later PDF/DOCX/HTML/table fixtures for mapping, replay/restart and page/cell citations. It says not to begin parser implementation before contract acceptance. |
| [FR-115](../requirements/FR-115.md), source-preserved row at source revision `a34ceaf79c112e02b1bcfdbf0a84122d835b002e` | Current `ParsedArtifact` keeps `document_id`, `parsed_from`, structure, text blocks, tables, metadata and warnings. The source row says Markdown/plain text only; binary/model formats are not in the current profile. |
| [FR-116](../requirements/FR-116.md), source-preserved row at the same source revision | Provenance carries source identity/version, artifact identity, pipeline/extractor versions and checksum; it validates/carries identifiers rather than minting them. Stage 3 is Tier 1. |
| [FR-115 domain note](../domains/knowledge/features/FR-115-document-parsing.md) and [FR-116 domain note](../domains/knowledge/features/FR-116-derived-object-provenance.md) | The current parser is deterministic text/Markdown. Any binary expansion needs raw-to-parsed mapping across Stages 3, 7, 8 and 9; exact hashes and parser identity distinguish reparses. |
| [FR-138](../features/FEAT-016/requirements/FR-138.md), source-preserved row at the same source revision | Asset extraction is an authorized provider-to-candidate flow with separate reviewer decision. This is a distinct FEAT-016 workflow, not authority to OCR or admit parsed knowledge. |
| [ADR-050](../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md), D2–D3 | Stage 2/3/7/8 are Tier 1 responsibilities; Stage 9 belongs to GKS; FR-071 owns the execution ledger and its established identities. Tier 1 does not execute substrate-writing stages. |
| [ADR-072](../decisions/ADR-072-KNOWLEDGE-ADMISSION-AND-CORPUS-PUBLICATION.md), beta 1.0.6b | The approved admission surface handles Text/Markdown and readable Text/Markdown FileAssets. Binary/OCR remain outside the approved phases. Citation resolution binds source, ingestion, generation and chunk, and rechecks current authorization. |
| [17-stage specification](../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md), §§7–8 and 12–14; [17-stage flow](../KNOWLEDGE-INGESTION-17-STAGE-FLOW.md), extension and durability sections | Stage 3 must validate parent identity and hashes; Stage 7 persists exact substring/hash/ordinal/UTF-16 offsets; Stage 8 uses chunk-local UTF-16 mention offsets; Stage 9 validates source/chunk/mention hashes and keeps every occurrence. The flow calls for citation resolution after restart and source-version-specific replay. |
| [TASK-ZAI-047 plan](TASK-ZAI-047-KNOWLEDGE-CONSOLE.md) and [TASK-ZAI-049 plan](TASK-ZAI-049-DURABLE-KNOWLEDGE-STORAGE.md) | The console must open citation-bound immutable raw/parsed/chunk artifacts and never fall back to latest bytes. Storage preserves exact raw bytes/SHA-256 and restart lineage; it does not by itself imply binary-parser support. |

This draft proposes a contract within those boundaries. It neither changes FR-115
or ADR-072 nor asserts that a binary parser, PDF page viewer, typed locator
schema, or GKS/native citation support currently exists. A requirement or
membership change, if accepted, must use the repository's reviewed record
migration; this file does not issue or repurpose an FR identifier.

## 3. Immutable source-to-parsed identity

### 3.1 Raw source version

**Proposed invariant:** parse only the exact raw artifact attached to one
authorized immutable source version. Before parsing, read the pinned raw object
version, verify byte length, and recompute SHA-256 over the original bytes. Never
read by display filename, current path, or “latest” pointer. A byte/hash mismatch
quarantines the attempt before parser execution.

The source-version binding is the immutable tuple:

```text
sourceId
sourceVersion
rawArtifactId
rawSha256                 # lowercase hexadecimal SHA-256 of original bytes
rawByteLength
declaredMediaType         # advisory only
detectedMediaType         # parser selection input; never filename-only
```

The FR-116 `source_id`, `source_version`, `artifact_id`, `checksum`,
`pipeline_version`, and `extractor_version` remain the existing provenance
vocabulary. Exact persisted field names, placement, and migration are open
implementation decisions; names in this proposal do not claim a schema exists.
The same `sourceId + sourceVersion` with different raw bytes/hash is a conflict,
not an update. A correction is a new source version with its own immutable raw
artifact and parser lineage.

### 3.2 Parsed artifact identity and hashes

**Proposed invariant:** Stage 2 owns creation of the parsed-artifact identity;
Stage 3 and FR-116 validate and carry it. No caller, Stage 3, or downstream
worker may mint a replacement document/artifact ID to repair missing lineage.

The immutable parse-key tuple is:

```text
raw source-version tuple
mediaType selected for parsing
parserId + parserVersion + parserBuildDigest
extractorProfileVersion
locationMappingVersion
parsedArtifactContractVersion
```

Compute a proposed `parseKeyHash` as SHA-256 over a deterministic canonical
encoding of that tuple. One immutable `parsedArtifactId` binds to one parse key.
The artifact stores both `parsed_from = rawArtifactId` and the raw SHA-256, so
identity does not depend on mutable names, path, storage ETag, or the newest
source pointer.

Store separate hashes with separate meanings:

| Hash | Proposed input |
|---|---|
| `rawSha256` | Exact original bytes, before decoding or extraction. |
| `extractedTextSha256` | UTF-8 bytes of the exact normalized text projection, without display truncation. |
| `parsedArtifactSha256` | Deterministic canonical serialization of parsed structure, text, tables, typed source spans, warnings, and the pinned parser/extractor/mapping versions. Exclude timestamps, storage URLs, run IDs and generated database IDs. |

For one parse key, replay must return the same parsed identity and hashes. If
re-execution under that exact key yields a different output hash, quarantine it
as nondeterministic; do not overwrite the stored artifact or continue downstream.
Exact canonical JSON rules (key ordering, number/string encoding and serializer
version) must be pinned by implementation review before the first persisted
binary artifact.

### 3.3 Version and replay semantics

| Change | Proposed result |
|---|---|
| Same source version, raw hash and parser/extractor/mapping versions | Idempotent replay of the same artifact identity. Existing output hashes must match. |
| New raw bytes or source version | New immutable raw identity and new parsed identity; prior artifacts and citations remain pinned. |
| Parser binary/build, extraction profile, mapping, or artifact contract changes | New parse key and parsed identity, even when extracted text happens to be byte-identical. Run a new FR-071 replay/attempt under existing ledger rules. |
| Crash before complete artifact commit | No partial ParsedArtifact is accepted. Restart reconciles the same parse key; commit is atomic after output hash validation. |
| Deterministic unsupported/malformed/limit refusal | Preserve raw source and typed refusal evidence; no ParsedArtifact or downstream stage success is fabricated. Retry requires a corrected source or a newly versioned supported profile/limit. |
| Timeout or worker interruption with no committed output | Record a typed failed attempt and permit only the bounded retry policy for the same parse key. A later successful output must still match the identity rules. |

Reparse never rewrites old `ParsedArtifact`, chunks, mentions, native snapshots,
or published corpus membership. The new artifact produces new downstream
identities and a later independently verified snapshot/generation. An old
citation resolves the old parser version and source version while retained and
currently authorized; it never redirects to the new parse or current file.

## 4. Deterministic text and typed source locations

### 4.1 Offset unit and normalization

**Proposed offset contract:** all parser, chunk, and mention text offsets are
zero-based, half-open UTF-16 code-unit ranges into one immutable
`ParsedArtifact.normalizedText`. They are not offsets into PDF/DOCX/ZIP/HTML raw
bytes, UTF-8 bytes, Unicode code points, or grapheme clusters. A raw-source
locator is stored beside each text range; binary byte offsets must never be
claimed where the format does not provide them.

For deterministic normalized text, the proposal is to preserve extracted code
points and spaces, convert CRLF and lone CR to LF, strip one leading BOM from the
artifact text, and perform no NFC/NFKC or locale-dependent rewrite. Structural
paragraph separators are LF; DOCX/HTML table cells are projected in source order
with TAB between cells and LF between rows. The typed cell matrix remains stored
separately, so flattened text never replaces cell identity. These serialization
rules must be pinned by `locationMappingVersion` before persisted use.

For every stored text segment:

1. `artifactStartUtf16` and `artifactEndUtf16` point to the exact extracted
   substring in `normalizedText`.
2. `unitStartUtf16` and `unitEndUtf16` point to the same substring in the
   parser-defined page, paragraph, cell, or element text.
3. Both ranges are half-open and may not split a surrogate pair.
4. The stored substring, text hash, and typed locator are checked together at
   Stage 3 and again before a citation is served.

Offsets are stable only for the same raw source version and the same parser,
extractor, mapping, and artifact-contract versions. A changed parser version may
change reading order, separators, offsets, and chunks; it must create a distinct
artifact and cannot claim cross-version offset stability.

### 4.2 Typed location union

Each text span has one or more typed locations. Proposed stable fields are:

| `kind` | Required source-local coordinates |
|---|---|
| `pdf_page` | Zero-based `pageIndex`; `unitStartUtf16` / `unitEndUtf16` within that page's extracted text. UI displays `pageIndex + 1`. |
| `docx_paragraph` | Zero-based `bodyParagraphIndex`; offsets within that paragraph. Header/footer/footnote inclusion is not assumed by this proposal and remains an explicit profile decision. |
| `docx_table_cell` | Zero-based `tableIndex`, `rowIndex`, `cellIndex`, `paragraphIndex`; offsets within that cell paragraph. Preserve grid span/merge metadata when present; if a cell cannot be mapped unambiguously, refuse or warn rather than invent coordinates. |
| `html_element` | `elementPath`, an ordered path from the document element using `(tagName, zeroBasedElementChildIndex)` pairs; offsets within document-order descendant text for that element. JavaScript, scripts, external resources and rendered DOM are not inputs. |
| `html_table_cell` | The containing `tablePath`, zero-based row and cell indexes, declared `rowspan` / `colspan`, and offsets within the cell text. |

An output may carry multiple locations where normalization or a chunk crosses
source units. Order location spans by source order and reject overlapping or
out-of-bounds ranges. Do not infer PDF visual coordinates or source-byte ranges
from text offsets. PDF tables without a deterministic cell locator remain page
text with a warning; only explicitly structured DOCX/HTML tables receive cell
locators in this proposal.

## 5. Stage 2 output and Stage 3 provenance

The existing FR-115 artifact shape remains the compatibility baseline:
`document_id`, `parsed_from`, `structure`, `text_blocks`, `tables`, `metadata`,
and `warnings`. **Proposed binary-profile additions**, subject to schema review,
are the identity tuple and hashes above plus a versioned ordered list of
`sourceSpans`. A structural/table block may reference multiple exact cell spans;
the text passed downstream is the same `normalizedText` those spans address.

Stage 3 (`DPS-KI-PROVENANCE`) verifies and records references; it does not
reparse or repair them. Before Stage 4/7 can proceed, Stage 3 must verify:

- the raw artifact exists under the same tenant/business/project scope and its
  bytes match `rawSha256` and `rawByteLength`;
- `parsed_from` names that exact raw artifact and source version;
- the parsed identity is unique to its pinned parse-key tuple;
- the parsed output hash, extracted text hash, source spans, and typed locations
  recompute exactly;
- FR-116 provenance has nonempty source, version, artifact, pipeline,
  extractor, timestamp and checksum values in the permitted order; no field is
  defaulted or inferred from filename;
- the parser, extractor and mapping version are explicit and supported by the
  admitted profile.

Any failed invariant blocks downstream success and citation creation. The
proposed metadata is additive to FR-116's existing provenance contract; this
document does not redefine `checksum` or claim a current database field for the
new hashes and locations.

## 6. Stage 7–9 lineage and citation resolution

### Stage 7 — chunking

Each chunk retains its current exact substring, hash, ordinal, and UTF-16
offsets, and additionally carries its parent parsed identity/hash plus the exact
`sourceSpans` intersecting that chunk. A chunk crossing paragraph/page/cell
boundaries contains an ordered list of those locators, not one guessed
location. Its text must equal the `normalizedText` slice covered by its parent
span. Table rows may be chunked with their cell spans; the table text projection
must not erase the header/row/cell coordinates needed for a citation. If current
chunk interfaces cannot preserve the map, the implementation must version the
chunk profile and acceptance as a separate downstream contract before enabling
binary input.

### Stage 8 — entity extraction

Keep the current chunk-local UTF-16 mention offsets and `sourceMentionId`.
For every mention, verify that its exact text is the corresponding chunk slice,
then map that range to one or more parent artifact spans and typed source
locations. Preserve both chunk-local and parsed-artifact-relative ranges. Do not
normalize names in a way that changes the citable source substring; any
normalization used for matching is a separate value with its own version.

### Stage 9 — entity resolution

Tier 1 sends a complete batch with each occurrence's source, parsed artifact,
chunk, mention hash, exact span and typed locations. GKS validates the same
source/chunk/mention hashes before resolving. Every occurrence reference is
retained, including repeated names; entity matching must not collapse away the
source evidence. GKS owns canonical identity and its matching policy. A missing
or invalid locator blocks resolution/publication for the affected evidence;
Tier 1 never guesses a page/cell or creates a canonical entity as fallback.

### Citation readback

A version-bound citation follows the existing published generation and
authorization path, then resolves exact source version → raw artifact/hash →
ParsedArtifact ID/hash → chunk/hash → mention/fact evidence. Check current
Business/Project/source access before disclosing content. Return the stored
typed page/paragraph/cell/element locator and exact authorized excerpt. A
missing artifact, hash mismatch, withdrawn source, or inaccessible raw version
is an explicit unavailable/denied result; never substitute latest bytes,
reconstruct from a newer parse, or expose a hidden source's existence. A restart
must resolve the same immutable chain and citation before the parse can count as
recoverable.

## 7. Proposed v1 limits and typed failure behavior

The following values are **concrete proposals for review, not approved product
limits**. Before implementation, compare them with existing FileAsset/admission
limits and use the stricter existing authority unless that authority is
formally changed. Reject the whole source version on a hard limit; do not
silently truncate text, drop pages/cells, or persist a partial success.

| Boundary | Proposed limit | Measurement and exceedance |
|---|---:|---|
| Original file size | 20 MiB per source version | Original byte length before parsing. Larger input is refused. |
| PDF pages | 500 pages | Count all pages before text extraction. Over limit refuses the document, not just trailing pages. |
| DOCX paragraphs | 100,000 body paragraphs | Count in document order before text projection. |
| DOCX table cells | 25,000 physical cells total | Count every table cell, including empty cells. Preserve coordinates; over limit refuses the document. |
| HTML elements | 100,000 elements and depth 256 | Count static parsed DOM elements; no script execution, external fetch, CSS layout or browser-rendered DOM. |
| HTML table cells | 25,000 physical cells total | Count cells before projection; over limit refuses the document. |
| DOCX archive expansion | 100 MiB total expanded bytes and at most 20:1 expansion | Measure total uncompressed entry bytes and expansion ratio before XML parsing. Exceedance returns `ARCHIVE_EXPANSION_LIMIT` for the whole source version. |
| DOCX ZIP entries | At most 2,000 central-directory entries | Count every ZIP entry, including directory entries, before decompression. More than 2,000 returns `ARCHIVE_ENTRY_COUNT_LIMIT` for the whole source version, distinct from expansion and table-cell limits. Reject encrypted entries, nested archives, macros, unsafe paths and external relationships; consume only expected OOXML parts. |
| Normalized output | 10 MiB UTF-8 | Count exact serialized `normalizedText` bytes. Refuse rather than truncate. |
| Parser process | 60 seconds wall time and 256 MiB resident memory per source | Run in a killable isolated worker. Timeout/resource refusal emits no partial artifact. |

The parser selects format from validated content type/signature plus a supported
profile, not extension alone. It makes no network calls. Unsupported encoding,
encrypted/password-protected content, malformed container, ambiguous table
mapping, corrupt/hash-mismatched raw bytes and incomplete parser output fail
closed.

**Proposed typed outcomes** are parser result/error codes, not new requirement
IDs or asserted FR-071 fields: `UNSUPPORTED_FORMAT`, `RAW_HASH_MISMATCH`,
`MALFORMED_DOCUMENT`, `ENCRYPTED_DOCUMENT`, `INPUT_BYTES_LIMIT`,
`PDF_PAGE_LIMIT`, `DOCX_PARAGRAPH_LIMIT`, `TABLE_CELL_LIMIT`,
`HTML_ELEMENT_LIMIT`, `ARCHIVE_EXPANSION_LIMIT`, `ARCHIVE_ENTRY_COUNT_LIMIT`,
`AMBIGUOUS_TABLE_MAPPING`, `OUTPUT_BYTES_LIMIT`, `PARSER_TIMEOUT`,
`PARSER_RESOURCE_LIMIT`, `NO_EXTRACTABLE_TEXT`,
`IMAGE_ONLY_DOCUMENT`, `IMAGE_CONTENT_NOT_PROCESSED`, and
`NONDETERMINISTIC_OUTPUT`. `ARCHIVE_ENTRY_COUNT_LIMIT` is raised before
decompression when the central directory contains more than 2,000 entries;
`AMBIGUOUS_TABLE_MAPPING` is raised when table geometry cannot map every
projected cell to one exact source coordinate. Either outcome refuses the whole
source version: retain the raw artifact and typed failure evidence, but commit
no ParsedArtifact, table cells, or source spans and start no downstream stage.
Map these proposed codes to the existing FR-071 terminal evidence contract
during implementation review; do not add or claim ledger status or field names
here.

An image-only PDF or standalone image returns `IMAGE_ONLY_DOCUMENT` and no
ParsedArtifact. A mixed text-and-image PDF may return text-backed output with
`IMAGE_CONTENT_NOT_PROCESSED` warning scoped to affected pages. Image-associated
text is never inferred, sent to a provider, or included in hashes as though
extracted. A valid file with no text and no supported structural content is a
typed refusal, not an empty successful artifact. A timeout/crash before commit
may be retried within the existing bounded execution policy; repeated output
under one parse key must hash identically.

## 8. Future fixture-based acceptance matrix

All checks below are future acceptance criteria and **NOT_RUN**. The filenames,
test entrypoints, and environment profile are proposed additions; their
presence is not claimed. Keep compact, synthetic, non-customer fixtures under
`apps/server/tests/fixtures/knowledge-parsing/task-zai-048/` and pin fixture
SHA-256 values in the test manifest. Negative ZIP-bomb/size fixtures should be
generated in the test harness from bounded recipes rather than committed as
oversized binaries.

Common proposed environment for isolated test commands:

```text
NODE_ENV=test
TZ=UTC
LANG=C.UTF-8
LC_ALL=C.UTF-8
TASK_ZAI_048_FIXTURE_PROFILE=task-zai-048-v1
KNOWLEDGE_OCR=disabled
KNOWLEDGE_PARSER_NETWORK=disabled
```

The future harness must enforce network egress denial and provide only
disposable local storage/database or explicitly isolated native test services;
the two `disabled` variables are profile declarations, not a security control
by themselves. No provider key, production endpoint, production database, live
corpus, or customer document may be present. For native/GKS/Tier 4 stages, record
the exact isolated service revisions and endpoint identities in the verifier
receipt without secrets. If these services are unavailable, the full 17-stage
row is `NOT_RUN`/blocked; passing local parser tests is not full-pipeline
acceptance.

| Case and named fixture | Given / When / Then | Exact future command; cwd; env | Independent evidence owner |
|---|---|---|---|
| PDF page map — `pdf/multilingual-two-page.pdf` | Given two text pages with Thai, a supplementary-plane character and distinct sentinel phrases; when Stage 2 parses; then each phrase has a deterministic page index and UTF-16 span, and the raw/text/artifact hashes match the pinned oracle. | `npm --prefix apps/server test -- tests/unit/knowledge-binary-parser-contract.test.js -t "PDF page map"`; cwd: repository root; common environment above. | Separate `dev-verifier` session runs and records fixture/hash and exact revision; `dev-reviewer` checks page/span oracles. |
| DOCX paragraph and cells — `docx/paragraph-table-cells.docx` | Given ordered body paragraphs, a two-row table, Thai text and emoji; when parsed; then paragraph/cell indexes, row order, cell content and both offset systems match the fixture manifest. | `npm --prefix apps/server test -- tests/unit/knowledge-binary-parser-contract.test.js -t "DOCX paragraph and cells"`; cwd: repository root; common environment above. | Separate `dev-verifier`; `dev-reviewer` independently checks the DOCX source coordinates and text oracle. |
| HTML element and table cells — `html/nested-elements-table.html` | Given nested elements, whitespace, one table, script and an external URL; when parsed offline; then document-order element paths and table-cell spans resolve, script/network content is absent, and visible text is deterministic. | `npm --prefix apps/server test -- tests/unit/knowledge-binary-parser-contract.test.js -t "HTML element and table cells"`; cwd: repository root; common environment above. | Separate `dev-verifier`; `dev-reviewer` checks the element-path and cell-coordinate manifest. |
| HTML spans — `html/table-rowspan-colspan.html` and `html/table-ambiguous-span.html` | Given valid declared row/column spans and a second fixture with contradictory cell geometry; when table locations are built; then the valid fixture preserves exact coordinates, while the ambiguous fixture returns `AMBIGUOUS_TABLE_MAPPING` with no ParsedArtifact, table cells, source spans, or downstream stage. | `npm --prefix apps/server test -- tests/unit/knowledge-binary-parser-contract.test.js -t "HTML spans"`; cwd: repository root; common environment above. | Separate `dev-verifier`; `dev-reviewer` checks all positive and refusal oracles. |
| OCR exclusion — `pdf/image-only.pdf` and `pdf/mixed-text-image.pdf` | Given image-only and mixed pages; when parsing offline; then image-only is typed refusal, mixed text retains its page locator and image warning, and a provider/OCR spy records exactly zero calls and zero OCR-derived text. | `npm --prefix apps/server test -- tests/unit/knowledge-binary-parser-contract.test.js -t "OCR exclusion"`; cwd: repository root; common environment above. | Separate `dev-verifier` captures the zero-call spy and output hashes; `dev-reviewer` checks refusal/warning semantics. |
| Limit and malformed inputs — generated `limits/*` recipe fixtures, including ZIP entry counts of 2,000 and 2,001 | Given inputs at and one unit above every byte/page/paragraph/cell/archive/output/time limit, including expansion and entry count independently; when parsed; then 2,000 ZIP entries pass that count check, 2,001 returns `ARCHIVE_ENTRY_COUNT_LIMIT` before decompression, expansion excess returns `ARCHIVE_EXPANSION_LIMIT`, and each refusal commits no ParsedArtifact or downstream stage. Malformed PDF/DOCX, encrypted DOCX and raw hash mismatch also produce typed fail-closed results. | `npm --prefix apps/server test -- tests/unit/knowledge-binary-parser-contract.test.js -t "limits and malformed inputs"`; cwd: repository root; common environment above, with a deterministic fake clock for timeout boundary cases. | Separate `dev-verifier` records generated recipe seeds and measured sizes; `dev-reviewer` checks fail-closed outcomes and no-partial-write evidence. |
| Stage 3, 7–9 and restart lineage — `docx/paragraph-table-cells.docx` | Given one raw version and pinned parser tuple; when it passes Stage 3, chunks, mention extraction and GKS resolution, then the process restarts; then hashes/spans validate at every seam and each mention/citation returns the correct paragraph or cell. | `npm --prefix apps/server test -- tests/integration/knowledge-binary-parser-lineage.test.js -t "Stage 3 through 9 restart lineage"`; cwd: repository root; common environment above plus disposable local database/storage and isolated native service revisions recorded in the receipt. | Separate `dev-verifier` owns end-to-end evidence; `dev-reviewer` independently audits exact-head lineage and citation resolution. |
| Replay and reparse versioning — `pdf/multilingual-two-page.pdf` | Given a completed parse; when the same parse key replays and a new parser/mapping version reparses; then same-key hashes/ID remain identical, new version creates a distinct identity, and the old citation still resolves the old page after restart. | `npm --prefix apps/server test -- tests/integration/knowledge-binary-parser-lineage.test.js -t "replay and reparse versions"`; cwd: repository root; common environment above plus disposable local database/storage. | Separate `dev-verifier`; `dev-reviewer` checks no overwrite/latest fallback and old-version citation. |
| Raw-entrypoint 17-stage acceptance — all fixtures above | Given a fresh isolated profile and source admission through the supported raw entrypoint; when the actual worker executes the applicable 17 stages and publication/query path; then no test injects stage success, exact source/page/cell citations resolve after restart, quality/publication receipts are real for that environment, and unsupported/OCR cases do not publish. | `npm --prefix apps/server run test:genesisrag17`; cwd: repository root; common environment above plus the pinned disposable admission database, storage, MSP/GKS/worker endpoints, and exact native service revisions in the receipt. | `dev-verifier` must be independent of the implementation worker and capture raw-entrypoint evidence; `dev-reviewer` validates service ownership, real receipts, source citations and negative no-publication cases; Sol/root records final disposition. |

The verifier must report command, arguments, working directory, complete
non-secret environment, fixture hashes, tested revision, service revisions,
result and limitations. A unit result cannot stand in for restart, native
publication, query citation, or all-17-stage acceptance. The full-chain command
is a future fixture-profile contract; current support for those flags, fixtures
or binaries is not asserted.

## 9. Unresolved decisions before implementation

1. Product authority must accept whether PDF, DOCX and static HTML become
   supported admission types. That requires reconciling the current FR-115
   source-preserved text-only row and ADR-072's Text/Markdown-only decision via
   the reviewed record-migration process; this proposal is not that migration.
2. Review the proposed limits against actual upload/admission ceilings, threat
   model and supported deployment memory/time budgets. A stricter existing
   limit wins unless its authority is separately changed.
3. Select and security-review deterministic PDF, DOCX and HTML parsers; pin
   package/build digests, decoding rules, supported PDF/OOXML/HTML features,
   process isolation, and exact output canonicalization before persisting data.
4. Confirm the typed locator and hash contract across Tier 1, MSP, GKS, native
   snapshot/index, and citation readers. The current flow calls out Stage
   13/16/query impact; no external schema support is inferred here.
5. Decide format-specific profiles for PDF reading order, DOCX headers/footers
   and merged cells, HTML charset/CSS-hidden content, and how incomplete or
   ambiguous table extraction is surfaced.
6. Obtain separate future authority for any OCR scope. Any OCR design must
   identify provider/model/response and confidence, treat output as an
   untrusted candidate, and require a human review decision before recording
   OCR-derived knowledge. No OCR is in this v1 proposal.
7. Confirm raw/parsed retention and erasure behavior can preserve historical
   citations without bypassing current source revocation or the TASK-ZAI-049
   durability/erasure contract.

These decisions do not block review of this proposal. They do block binary
implementation or admission enablement until the responsible authority and
service owners accept their contracts.

## 10. Delivery sequence and evidence state

1. Review this candidate against the source table and resolve the decisions
   above within the trusted task mandate. Keep the roadmap and authoritative
   records unchanged in this slice.
2. After contract acceptance, prepare any required source-record migration and
   downstream schema agreements before coding. Do not infer acceptance from this
   draft, a readiness result, or passing synthetic tests.
3. Implement the bounded parser and immutable artifacts in a separately
   authorized task; keep OCR disabled and reject unsupported inputs.
4. Have distinct verifier and reviewer sessions inspect the exact implementation
   revision and run the fixture matrix. Root integrates, runs governance, and
   records the actual roadmap disposition only against accepted evidence.

**Documentation governance status:** After authoring, the root integrator ran
the declared chain on this candidate: verification-plan map, document registry,
inventory and identity checks, document-graph generation, document-view check,
document-graph check, and strict document preflight. All passed on
2026-10-15. These checks validate documentation consistency only. Parser tests,
implementation acceptance, native pipeline acceptance, production change,
provider call, and deployment remain **NOT_RUN**.

## Version diff

`0.1.0b` candidate adds a proposal-only binary parsing identity, mapping,
location, failure, limit, replay, citation, OCR-exclusion, and future fixture
acceptance contract for TASK-ZAI-048. Root documentation-governance results are
recorded in §10. It changes no requirement row, schema, stage catalog, runtime,
admission behavior, production state, or acceptance status. No implementation
is accepted.

## CHANGELOG

| Version | Date | Status | Summary | Base revision | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-10-15 | candidate | Proposal-only Stage 2 binary parsing and page/cell/element lineage contract; OCR excluded | `c2c0816ba3c83665334e45680000dbb931e46874` | Codex |
