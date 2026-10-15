---
id: ZAI:TASK-ZAI-048-PARSER-CONTRACT
title: TASK-ZAI-048 — Binary document parsing contract
version: "0.1.0b"
status: candidate
created_at: "2026-10-15T18:59:00+07:00,Codex,base c2c0816ba3c83665334e45680000dbb931e46874"
last_update: "2026-10-15T19:59:00+07:00,Codex"
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
sourceId + sourceVersion + rawArtifactId + rawSha256
mediaType selected for parsing
parserId + parserVersion + parserBuildDigest
extractorProfileVersion
locationMappingVersion
parsedArtifactContractVersion
```

`rawByteLength` is checked against the exact raw object before parsing but is
not a separate key component because the raw SHA-256 binds the bytes. Declared
and detected media types are evidence used to select/validate `mediaType`;
only the selected media type enters the key.

Compute a proposed `parseKeyHash` as SHA-256 over a deterministic canonical
encoding of that tuple. For the fixture oracle in §8, the exact encoding is
UTF-8 of ECMAScript `JSON.stringify` on this positional string array (no
whitespace or object-key ordering is involved):

```text
["task-zai-048-fixture-parse-key-v1", sourceId, sourceVersion,
 rawArtifactId, rawSha256, mediaType, parserId, parserVersion,
 parserBuildDigest, extractorProfileVersion, locationMappingVersion,
 parsedArtifactContractVersion]
```

`parseKeyHash = lowercaseHex(SHA256(encodedBytes))`. Strings use ordinary JSON
escaping and are then UTF-8 encoded; every field is a string, including the
lowercase raw hash. The exact fixture field values are pinned in §8. This is a
proposed contract encoding and must be reviewed before any persisted binary
artifact; replacing it requires a contract-version change. One immutable
`parsedArtifactId` binds to one parse key.
The artifact stores both `parsed_from = rawArtifactId` and the raw SHA-256, so
identity does not depend on mutable names, path, storage ETag, or the newest
source pointer.

Store separate hashes with separate meanings:

| Hash | Proposed input |
|---|---|
| `rawSha256` | Exact original bytes, before decoding or extraction. |
| `extractedTextSha256` | UTF-8 bytes of the exact normalized text projection, without display truncation. |
| `parsedArtifactSha256` | SHA-256 of UTF-8 `JSON.stringify(["task-zai-048-parsed-artifact-v1", parseKeyHash, normalizedText, blockRecords, sourceSpanRecords, warningRecords])`, where each record list is an ordered positional array exactly as defined in §8. Exclude timestamps, storage URLs, run IDs and generated database IDs. |

For one parse key, replay must return the same parsed identity and hashes. If
re-execution under that exact key yields a different output hash, quarantine it
as nondeterministic; do not overwrite the stored artifact or continue downstream.
`extractedTextSha256` is lowercase SHA-256 of UTF-8 `normalizedText`. The §8
oracle pins exact values for all three hashes. An implementation may not treat
those values or the fixture-only IDs as evidence of an existing schema.

### 3.3 Version and replay semantics

| Change | Proposed result |
|---|---|
| Same source version, raw hash and parser/extractor/mapping versions | Idempotent replay of the same artifact identity. Existing output hashes must match. |
| New raw bytes or source version | New immutable raw identity and new parsed identity; prior artifacts and citations remain pinned. |
| Parser binary/build, extraction profile, mapping, or artifact contract changes | New parse key and parsed identity, even when extracted text happens to be byte-identical. Decide during implementation review whether and how each new parse attempt maps to FR-071; this draft claims no new FR-071 field or parser/replay support. |
| Crash before complete artifact commit | No partial ParsedArtifact is accepted. Restart reconciles the same parse key; commit is atomic after output hash validation. |
| Deterministic unsupported/malformed/limit refusal | Preserve raw source and typed refusal evidence; no ParsedArtifact or downstream stage success is fabricated. Retry requires a corrected source or a newly versioned supported profile/limit. |
| Timeout or worker interruption with no committed output | Preserve typed failure evidence and permit only a bounded retry for the same parse key if implementation review accepts it. A later successful output must still match the identity rules; map the attempt to FR-071 only during implementation review. |

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
| `docx_table_cell` | Zero-based `tableIndex`, `rowIndex`, `cellIndex`, `paragraphIndex`; offsets within that cell paragraph. Preserve grid column, grid span and vertical-merge metadata when present. |
| `html_element` | `elementPath`, an ordered path from the document element using `(tagName, zeroBasedElementChildIndex)` pairs; offsets within document-order descendant text for that element. JavaScript, scripts, external resources and rendered DOM are not inputs. |
| `html_table_cell` | The containing `tablePath`, zero-based row and cell indexes, declared `rowspan` / `colspan`, and offsets within the cell text. |

**Proposed fail-closed table rule:** Before projecting any DOCX table cell,
construct its exact table-grid coordinate from the source geometry. If any
projected cell cannot be mapped to exactly one coordinate, or declared grid,
span, merge, or row geometry is contradictory, return
`AMBIGUOUS_TABLE_MAPPING` for the whole source version. Retain the raw artifact
and typed failure evidence; create no `ParsedArtifact`, table cells, or
`sourceSpans`, and start no downstream stage. This condition is never a warning.
The same code covers invalid or contradictory HTML table spans under the
proposed static profile. A PDF table may produce a warning only when the parser
deliberately keeps it as page text and does not project cells; use the typed
warning `PDF_TABLE_NOT_PROJECTED`. Do not imply that PDF visual geometry was
mapped.

An output may carry multiple locations where normalization or a chunk crosses
source units. Order location spans by source order and reject overlapping or
out-of-bounds ranges. Do not infer PDF visual coordinates or source-byte ranges
from text offsets. PDF tables without a deterministic cell locator remain page
text with the `PDF_TABLE_NOT_PROJECTED` warning; only explicitly structured
DOCX/HTML tables receive cell locators in this proposal.

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

**Proposed typed outcomes** are parser result/error/warning codes, not new
requirement IDs or asserted FR-071 fields: `UNSUPPORTED_FORMAT`, `RAW_HASH_MISMATCH`,
`MALFORMED_DOCUMENT`, `ENCRYPTED_DOCUMENT`, `INPUT_BYTES_LIMIT`,
`PDF_PAGE_LIMIT`, `DOCX_PARAGRAPH_LIMIT`, `TABLE_CELL_LIMIT`,
`HTML_ELEMENT_LIMIT`, `ARCHIVE_EXPANSION_LIMIT`, `ARCHIVE_ENTRY_COUNT_LIMIT`,
`AMBIGUOUS_TABLE_MAPPING`, `PDF_TABLE_NOT_PROJECTED`, `OUTPUT_BYTES_LIMIT`, `PARSER_TIMEOUT`,
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
here. `PDF_TABLE_NOT_PROJECTED` is a warning only when a PDF table is deliberately
left as page text with no cell projection; it does not represent an ambiguous
DOCX mapping or a partial DOCX success.

An image-only PDF or standalone image returns `IMAGE_ONLY_DOCUMENT` and no
ParsedArtifact. A mixed text-and-image PDF may return text-backed output with
`IMAGE_CONTENT_NOT_PROCESSED` warning scoped to affected pages. Image-associated
text is never inferred, sent to a provider, or included in hashes as though
extracted. A valid file with no text and no supported structural content is a
typed refusal, not an empty successful artifact. A timeout/crash before commit
may be retried only under a bounded policy accepted during implementation
review; map its evidence to FR-071 at that review. Repeated output under one
parse key must hash identically.

## 8. Future fixture-based acceptance matrix

All checks below are future acceptance criteria and **NOT_RUN**. The filenames,
test entrypoints, and environment profile are proposed additions; their
presence is not claimed. The complete synthetic source and output oracle is
embedded in §8.1 below. No fixture files, parser, tests, or generated manifest
are added by this document.

### 8.1 Deterministic source and output oracle

Every path in the future matrix names a synthetic fixture defined here. Byte
recipes below are normative only for this proposal. Recompute all hashes from
the stated bytes; the digest values are recorded as expected results, not
guessed placeholders.

**Hash inputs.** For each success fixture, use `sourceId = "source:<path>"`,
`sourceVersion = "v1"`, `rawArtifactId = "raw:<path>"`, the fixture's exact
media type, `parserId = "task-zai-048-fixture-parser"`,
`parserVersion = "1"`, `parserBuildDigest =
f5c563cd81414b821b2de07fdd40ac5d988c78bb3556068987e8ae90dc7ffe74`,
`extractorProfileVersion = "binary-v1"`,
`locationMappingVersion = "source-locator-v1"`, and
`parsedArtifactContractVersion = "parsed-artifact-v1"`. The build digest is
SHA-256 of UTF-8 `task-zai-048-fixture-parser-build-v1`. Apply the exact
positional parse-key and artifact arrays in §3.2; serialize each array with
ECMAScript `JSON.stringify` (no added whitespace), UTF-8 encode it, and take
lowercase SHA-256. `normalizedTextSha256` hashes the exact UTF-8 normalized text.
For failures, the fixture evidence oracle is lowercase SHA-256 of UTF-8
`JSON.stringify(["task-zai-048-fixture-failure-v1", sourceId, "v1",
rawArtifactId, rawSha256, mediaType, outcomeCode, "stage2_parse"])`. This failure
digest is not a parsed-artifact identity or a claimed FR-071 field.

**PDF byte generator.** Use ASCII bytes only except the image payload noted
below; no metadata, compression, object streams, or extra comments. In the
object list, `LF` means one literal byte `0x0a`, not the four letters `LF`.
Start with
`%PDF-1.4\n`. For each listed body in numeric order, append ASCII
`<n> 0 obj\n`, the exact body bytes, then `\nendobj\n`; record each object's
zero-based byte offset. Append ASCII `xref\n0 <N+1>\n0000000000 65535 f \n`,
then each object offset as ten zero-padded decimal digits followed by
` 00000 n \n`. Append `trailer\n<< /Size <N+1> /Root 1 0 R >>\nstartxref\n`,
the decimal byte offset of `xref`, then `\n%%EOF\n`. For a text content stream
whose exact ASCII data is `D`, its body is
`<< /Length <byteLength(D)> >>\nstream\n` + `D` + `\nendstream`; the `D`
shown below includes its final LF. For an image stream use the exact dictionary
shown, LF, `stream`, LF, three literal zero bytes, LF, `endstream`.

`pdf/two-page-sentinels.pdf` has these seven bodies in order:

```text
1 << /Type /Catalog /Pages 2 0 R >>
2 << /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>
3 << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 6 0 R >> >> /Contents 4 0 R >>
4 stream data: BT /F1 12 Tf 72 220 Td (Page one) Tj ET LF
5 << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>
6 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
7 stream data: BT /F1 12 Tf 72 220 Td (Page two) Tj ET LF
```

`pdf/image-only.pdf` has five bodies: (1) the same Catalog body; (2) `<< /Type
/Pages /Kids [3 0 R] /Count 1 >>`; (3) `<< /Type /Page /Parent 2 0 R /MediaBox
[0 0 300 300] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R
>>`; (4) stream data `q 1 0 0 1 0 0 cm /Im1 Do Q LF`; (5) the image stream
dictionary `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace
/DeviceRGB /BitsPerComponent 8 /Length 3 >>`, followed by the three-byte
payload described above.

`pdf/mixed-text-image.pdf` has six bodies: the same Catalog and one-page Pages
bodies; page body `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300]
/Resources << /Font << /F1 6 0 R >> /XObject << /Im1 5 0 R >> >> /Contents 4
0 R >>`; stream data `BT /F1 12 Tf 72 220 Td (Visible text) Tj ET LF q 1 0 0
1 0 0 cm /Im1 Do Q LF`; the same image object as above; and the same Helvetica
font body as the two-page file.

**DOCX byte generator.** ZIP files use STORE (method 0), UTF-8 flag `0x0800`,
version-needed 20, DOS time 0 and date `0x0021`, no extra fields or comments,
disk numbers 0, internal/external attributes 0, and central-directory entries
in the same order as local entries. Each local header has signature
`0x04034b50`, followed by those fixed fields, CRC-32, equal compressed and
uncompressed byte lengths, filename length, extra length 0, UTF-8 filename,
then raw entry bytes. CRC-32 is reflected IEEE CRC-32 (polynomial
`0xedb88320`, initial/final XOR `0xffffffff`). Each central header uses
signature `0x02014b50`, made-by 0, then the same version/flags/method/time/date,
CRC and lengths, filename length, zero extra/comment/disk/internal/external
fields, and the local-header byte offset. Finish with the 22-byte EOCD
signature `0x06054b50`, disk fields 0, equal entry counts, central size/offset,
and zero comment length, all multibyte fields little-endian. Filenames and XML
are UTF-8 with no BOM. Directory entries have names ending `/` and empty data.

For `docx/paragraph-table-cells.docx`, the three entries, in order, are
`[Content_Types].xml`, `_rels/.rels`, and `word/document.xml`. Their exact text
is shown below. For each member, encode only the text between the fences; add
no BOM, leading/trailing whitespace, or final line feed.

```xml
<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>
```

```xml
<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>
```

```xml
<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>P😀</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>ID</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>ไทย</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>X</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Y</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>
```

`docx/archive-entry-count-2000.docx` uses those same three entries followed
by empty directory entries `x0000/` through `x1996/` in ascending numeric
order (2,000 total). `docx/archive-entry-count-2001.docx` uses the same base
entries followed by `x0000/` through `x1997/` (2,001 total). For
`docx/table-ambiguous-geometry.docx`, use the same first two XML entries and
replace `word/document.xml` with this exact text; its two-column grid conflicts
with the cell's declared three-column span:

```xml
<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="100"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="3"/></w:tcPr><w:p><w:r><w:t>Z</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>
```

**HTML bytes.** Each file is the exact one-line literal below encoded as UTF-8,
with no BOM and no final newline. In the nested fixture, `é` is U+0065
followed by U+0301; the Thai text is U+0E44 U+0E17 U+0E22. With no declared
charset, this synthetic profile accepts strict UTF-8 only.

```html
html/nested-elements-table.html:
<!doctype html><html><head></head><body><main><section><p>A😀é</p><table><tbody><tr><td>X</td><td>ไทย</td></tr></tbody></table></section></main></body></html>

html/table-rowspan-colspan.html:
<!doctype html><html><head></head><body><table><tbody><tr><td rowspan="2">A</td><td colspan="2">BC</td></tr><tr><td>D</td><td>E</td></tr></tbody></table></body></html>

html/table-ambiguous-span.html:
<!doctype html><html><head></head><body><table><tbody><tr><td rowspan="x">A</td></tr></tbody></table></body></html>
```

The static profile accepts `rowspan`/`colspan` only when absent (default 1) or
ASCII decimal in `1..1000`. It rejects the literal `rowspan="x"` as
`AMBIGUOUS_TABLE_MAPPING`; it does not use browser recovery or silently default
the malformed span.

**Success oracles.** The following record notation is exact JSON array data;
line wrapping is for display only. A `sourceSpanRecord` starts with its `kind`;
all ranges are zero-based, half-open UTF-16 code-unit offsets. The raw length
and SHA-256, exact normalized text, text hash, parse-key hash, artifact hash,
blocks, source spans, and warnings are pinned here:

| Fixture and media type | Raw bytes / SHA-256 | Normalized text / text SHA-256 | Parse-key SHA-256 / parsed-artifact SHA-256 |
|---|---|---|---|
| `pdf/two-page-sentinels.pdf` · `application/pdf` | 846 / `0c7d0d6f34a0add80f8f8aefe2b4f09f0dbe94b29fbfb49c62e3984684ea59cb` | `Page one\nPage two` / `19783a03185d7a9d8d4a4370ea83d2ddbe76e3758d594d4defec9312ddab125d` | `4568dbd54b90eb89a5685fdd59099f30a3b3edd1cf2ae4719161c993450b52f4` / `3a56a7d01870749cb00c5b3fb314d4a02a7ad9a9ac103891d561a0d8ccec33e1` |
| `docx/paragraph-table-cells.docx` · `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 1,474 / `77291aa206889a2d2af90f75b559756ffcf328b5429effdf0f9ed11ef648a6db` | `P😀\nID\tไทย\nX\tY` / `698926cc5ac7c83c843ee51d904ba6531ab71ba61d0c4f272a35b555dbc015f7` | `ac123114a128c1fe9d492cd7cceab22f64cb69a4d12c7a77cc363edae85c7dec` / `1f9c8acb5aab37d449dea31a25d6f2ffc02e8605a6b016768ff064e401b5b19e` |
| `docx/archive-entry-count-2000.docx` · `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 177,210 / `7c512a082b76ddc8e9182a6a58a4a41d094bce25c83995be88b0f0b30629e661` | `P😀\nID\tไทย\nX\tY` / `698926cc5ac7c83c843ee51d904ba6531ab71ba61d0c4f272a35b555dbc015f7` | `9862c4d94cdcee64fd1b58c07cd8545637491a153c859f4bc3594a445a83d556` / `36fcdfd515402bf7e3e7cc18552399b9b0394c3583aae95f0de6265c8eedb169` |
| `html/nested-elements-table.html` · `text/html` | 168 / `92c7676a62271bdfe5b9640d4bec544ebd928e8b7704bd76f3e347be0e2b335a` | `A😀é\nX\tไทย` / `0b784e7cf2496bc1edafd7d646b3ba1cb78b60790364474bc093236099638409` | `4f2bf51ef0510ed6d65de65a7a3c77c3a226746a6a78020afae79074051f8f24` / `df4b8130fe94de4c2bafabc8a415c1ff84034d6f473530f0bc2cf68de8242947` |
| `html/table-rowspan-colspan.html` · `text/html` | 167 / `0135ec3bbe6e353ae9cfec9ec5b7f3d9a327978b79cf390e6662b09c836bf776` | `A\tBC\nD\tE` / `6357f780e9742236e197a5e9816f70e70c5afb53270384cdb243b63b23ec2e95` | `522577238ee384515c2e01cb4efd8aa0f825949d740ed17427019f650c247217` / `8a8d1f7a9e7a679b585f78de885194f22fea1cef01eed25197ff64e6da592210` |
| `pdf/mixed-text-image.pdf` · `application/pdf` | 806 / `70947efa839192e0d905fc5256f766f429373fbb13176b8af93e0d710848066d` | `Visible text` / `1557dfa8f543784bdf02b26f6a656e8271dfa20cf5b86f561ba3ece3fe55bea6` | `949b2bb22c761c7269748e21062a6048fe79e7777d5c384dd414663600cfd2e6` / `70388a5d43482c3e9d3298e6bb7a6458b5562cedf275e881275dc42f52d6922c` |

In the following exact text values, `\n` and `\t` denote one LF and one TAB
character, not two-byte backslash sequences. Exact successful records,
serialized in the displayed key order:

```json
pdf/two-page-sentinels.pdf
normalizedText = "Page one\nPage two"
blockRecords = [["pdf_page",0,"Page one"],["pdf_page",1,"Page two"]]
sourceSpanRecords = [["pdf_page",0,0,8,0,8],["pdf_page",1,0,8,9,17]]
warningRecords = []

docx/paragraph-table-cells.docx and docx/archive-entry-count-2000.docx
normalizedText = "P😀\nID\tไทย\nX\tY"
blockRecords = [["docx_paragraph",0,"P😀"],["docx_table",0,[["ID","ไทย"],["X","Y"]]]]
sourceSpanRecords = [["docx_paragraph",0,0,3,0,3],["docx_table_cell",0,0,0,0,0,1,"none",0,2,4,6],["docx_table_cell",0,0,1,0,1,1,"none",0,3,7,10],["docx_table_cell",0,1,0,0,0,1,"none",0,1,11,12],["docx_table_cell",0,1,1,0,1,1,"none",0,1,13,14]]
warningRecords = []

html/nested-elements-table.html
normalizedText = "A😀é\nX\tไทย"
blockRecords = [["html_paragraph","A😀é"],["html_table",0,[["X","ไทย"]]]]
sourceSpanRecords = [["html_element",[["html",0],["body",1],["main",0],["section",0],["p",0]],0,5,0,5],["html_table_cell",[["html",0],["body",1],["main",0],["section",0],["table",1]],0,0,0,1,1,0,1,6,7],["html_table_cell",[["html",0],["body",1],["main",0],["section",0],["table",1]],0,1,1,1,1,0,3,8,11]]
warningRecords = []

html/table-rowspan-colspan.html
normalizedText = "A\tBC\nD\tE"
blockRecords = [["html_table",0,[["A","BC"],["D","E"]]]]
sourceSpanRecords = [["html_table_cell",[["html",0],["body",1],["table",0]],0,0,0,2,1,0,1,0,1],["html_table_cell",[["html",0],["body",1],["table",0]],0,1,1,1,2,0,2,2,4],["html_table_cell",[["html",0],["body",1],["table",0]],1,0,1,1,1,0,1,5,6],["html_table_cell",[["html",0],["body",1],["table",0]],1,1,2,1,1,0,1,7,8]]
warningRecords = []

pdf/mixed-text-image.pdf
normalizedText = "Visible text"
blockRecords = [["pdf_page",0,"Visible text"]]
sourceSpanRecords = [["pdf_page",0,0,12,0,12]]
warningRecords = [["IMAGE_CONTENT_NOT_PROCESSED",["pdf_page",0]]]
```

For DOCX spans, the cell record positions are kind, table, row, cell,
paragraph, grid-column start, grid span, vertical-merge value, unit start/end,
then artifact start/end. For HTML table spans they are kind, table path, row,
cell, grid-column start, row span, column span, unit start/end, then artifact
start/end. The paragraph/page/element records are kind, typed path/index,
unit start/end, then artifact start/end. These tuples make every offset and
coordinate independently checkable.

**Typed refusal oracles.** A failed fixture retains exactly its raw bytes and
typed Stage 2 failure evidence; it has no parsed-artifact ID, parse-key hash,
normalized text/hash, block/table/source-span records, citation, or downstream
stage. Failure evidence uses the §8.1 failure tuple and digest formula.

| Fixture and media type | Raw bytes / raw SHA-256 | Exact outcome / failure-evidence SHA-256 |
|---|---|---|
| `pdf/image-only.pdf` · `application/pdf` | 650 / `c19fed0ba5c775b0a02b6856741cb637984b07238699bae5fb63a10340b20b27` | `IMAGE_ONLY_DOCUMENT` / `d8ade02db089af52e6ce6cf09c57265887043bb00d32da09f8b833f4cc616395` |
| `html/table-ambiguous-span.html` · `text/html` | 115 / `073bec515532082f154f29d0b4b9e0ee32fc724261ac4bd07202594467ba63fa` | `AMBIGUOUS_TABLE_MAPPING` / `015935473d7079d76cd5cc05a32b18377456483c902719a409e4a532dd20256a` |
| `docx/table-ambiguous-geometry.docx` · `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 1,380 / `0c1eea989c30ac0e5a863ce7cb2a740f6e7c193671fef5ad8bf28ac573887d40` | `AMBIGUOUS_TABLE_MAPPING` / `62e5daacde2f02f41d073be5e285488170642d897650884496d774cb24444f11` |
| `docx/archive-entry-count-2001.docx` · `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 177,298 / `ea41d2f43716d049a8198e11b794391d39b11cc6b37514b9e0447e462bca2124` | `ARCHIVE_ENTRY_COUNT_LIMIT` / `7278148ee1613c8f760220c11b83cab2dda11043ab90d4ff0676f76fb6a2eb8a` |

The 2,001-entry refusal is decided from the central directory before entry
decompression or XML parsing and is distinct from expansion and cell-count
limits. The 2,000-entry file parses successfully as the exact DOCX content in
its oracle row. The DOCX ambiguous-grid file returns `AMBIGUOUS_TABLE_MAPPING`
for the whole source version; neither its apparently readable `Z` text nor any
table fragment is emitted.

**Replay, restart and citation assertions.** Every successful fixture must
first match its exact text, ordered block/span/warning records, and three hashes
above. Replaying the same source tuple and parser tuple returns the same
`parsedArtifactId` (fixture oracle ID `parsed:<parseKeySha256>`) and hashes;
after process restart, the raw hash, parsed hash, and each citation locator below
resolve identically. A version-2 parser/build or mapping profile creates a
distinct parse key and artifact while citations to v1 continue resolving v1.
Every refusal above retains the same raw hash and failure-evidence hash across
restart/replay, creates no partial artifact, and cannot resolve a citation.

| Success fixture | Exact citation checks after restart |
|---|---|
| `pdf/two-page-sentinels.pdf` | Page 0, unit `[0,8)`, artifact `[0,8)`, excerpt `Page one`; page 1, unit `[0,8)`, artifact `[9,17)`, excerpt `Page two`. |
| `docx/paragraph-table-cells.docx` | Paragraph 0 unit/artifact `[0,3)`, excerpt `P😀`; table 0 / row 0 / cell 1 / paragraph 0, unit `[0,3)`, artifact `[7,10)`, excerpt `ไทย`. |
| `docx/archive-entry-count-2000.docx` | Same paragraph and Thai-cell citations as the base DOCX, with its own parse key, artifact ID and hash. |
| `html/nested-elements-table.html` | Element path `html[0]/body[1]/main[0]/section[0]/p[0]`, unit/artifact `[0,5)`, excerpt `A😀é`; table path `html[0]/body[1]/main[0]/section[0]/table[1]`, row 0 / cell 1, unit `[0,3)`, artifact `[8,11)`, excerpt `ไทย`. |
| `html/table-rowspan-colspan.html` | Table path `html[0]/body[1]/table[0]`: row0/cell0 `A` unit `[0,1)` / artifact `[0,1)` and rowSpan 2, colSpan 1; row0/cell1 `BC` unit `[0,2)` / artifact `[2,4)` and rowSpan 1, colSpan 2; row1/cell0 `D` unit `[0,1)` / artifact `[5,6)` at grid column 1; row1/cell1 `E` unit `[0,1)` / artifact `[7,8)` at grid column 2. |
| `pdf/mixed-text-image.pdf` | Page 0 unit/artifact `[0,12)`, excerpt `Visible text`; warning `IMAGE_CONTENT_NOT_PROCESSED` remains page-scoped. No OCR/provider call or OCR-derived text exists. |

The ambiguous, image-only, and 2,001-entry refusals have no citation oracle by
design. The malformed HTML and contradictory DOCX table both assert the exact
typed error and absence of all partial parsed outputs.

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
| PDF page map — `pdf/two-page-sentinels.pdf` | Given exact page text `Page one` and `Page two`; when Stage 2 parses; then normalized text is `Page one\nPage two`, page 0 maps unit/artifact `[0,8)`, page 1 maps unit `[0,8)` to artifact `[9,17)`, and raw/text/parse-key/artifact hashes equal §8.1. | `npm --prefix apps/server test -- tests/unit/knowledge-binary-parser-contract.test.js -t "PDF page map"`; cwd: repository root; common environment above. | Separate `dev-verifier` session runs and records fixture/hash and exact revision; `dev-reviewer` checks page/span oracles. |
| DOCX paragraph and cells — `docx/paragraph-table-cells.docx`, `docx/table-ambiguous-geometry.docx` | Given the exact paragraph/table DOCX and a separate two-column grid with a three-column cell span; when parsed; then the first matches §8.1 text, hashes, UTF-16 offsets and typed cell coordinates, while the second returns `AMBIGUOUS_TABLE_MAPPING`, keeps only raw/failure evidence, emits no parsed artifact/table/source span, and starts no downstream stage. | `npm --prefix apps/server test -- tests/unit/knowledge-binary-parser-contract.test.js -t "DOCX paragraph and cells"`; cwd: repository root; common environment above. | Separate `dev-verifier`; `dev-reviewer` independently checks the DOCX source coordinates and refusal oracle. |
| HTML element and table cells — `html/nested-elements-table.html` | Given nested `main/section/p` elements and one two-cell table from the exact UTF-8 source; when parsed offline; then the paragraph path and cell path/ranges, exact text and four hashes match §8.1, with no script, CSS, network or browser-rendered input. | `npm --prefix apps/server test -- tests/unit/knowledge-binary-parser-contract.test.js -t "HTML element and table cells"`; cwd: repository root; common environment above. | Separate `dev-verifier`; `dev-reviewer` checks the exact element paths, cell coordinates and oracle hashes. |
| HTML spans — `html/table-rowspan-colspan.html` and `html/table-ambiguous-span.html` | Given valid spans `2x1`, `1x2`, `1x1`, `1x1` and a second fixture with literal `rowspan="x"`; when table locations are built; then the valid four cell coordinates/ranges match §8.1 and the invalid input returns `AMBIGUOUS_TABLE_MAPPING` with raw/failure evidence only and no ParsedArtifact, table cells, source spans, citation or downstream stage. | `npm --prefix apps/server test -- tests/unit/knowledge-binary-parser-contract.test.js -t "HTML spans"`; cwd: repository root; common environment above. | Separate `dev-verifier`; `dev-reviewer` checks all positive coordinates and exact refusal result. |
| OCR exclusion — `pdf/image-only.pdf` and `pdf/mixed-text-image.pdf` | Given image-only and mixed pages; when parsing offline; then image-only is typed refusal, mixed text retains its page locator and image warning, and a provider/OCR spy records exactly zero calls and zero OCR-derived text. | `npm --prefix apps/server test -- tests/unit/knowledge-binary-parser-contract.test.js -t "OCR exclusion"`; cwd: repository root; common environment above. | Separate `dev-verifier` captures the zero-call spy and output hashes; `dev-reviewer` checks refusal/warning semantics. |
| Limits and malformed inputs — in-memory boundary vectors plus `docx/archive-entry-count-2000.docx` and `docx/archive-entry-count-2001.docx` | Given each §7 boundary value and one unit above it; when guarded before projection; then the 2,000-entry fixture parses to the exact §8.1 DOCX oracle, 2,001 returns `ARCHIVE_ENTRY_COUNT_LIMIT` before decompression, expansion returns `ARCHIVE_EXPANSION_LIMIT`, and all other over-limit cases return the matching §7 code with raw/failure evidence only and no partial artifact or downstream stage. Malformed PDF/DOCX, encrypted DOCX and raw hash mismatch fail closed. | `npm --prefix apps/server test -- tests/unit/knowledge-binary-parser-contract.test.js -t "limits and malformed inputs"`; cwd: repository root; common environment above, with a deterministic fake clock for timeout boundary cases. | Separate `dev-verifier` records exact boundary values, measured sizes and generated inputs; `dev-reviewer` checks typed outcomes and no-partial-write evidence. |
| Stage 3, 7–9 and restart lineage — `docx/paragraph-table-cells.docx` | Given one raw version and pinned parser tuple; when it passes Stage 3, chunks, mention extraction and GKS resolution, then the process restarts; then hashes/spans validate at every seam and each mention/citation returns the correct paragraph or cell. | `npm --prefix apps/server test -- tests/integration/knowledge-binary-parser-lineage.test.js -t "Stage 3 through 9 restart lineage"`; cwd: repository root; common environment above plus disposable local database/storage and isolated native service revisions recorded in the receipt. | Separate `dev-verifier` owns end-to-end evidence; `dev-reviewer` independently audits exact-head lineage and citation resolution. |
| Replay and reparse versioning — `pdf/two-page-sentinels.pdf` | Given the exact completed v1 parse in §8.1; when the same parse key replays and a parser/build version 2 reparses; then v1 retains parse key `4568dbd54b90eb89a5685fdd59099f30a3b3edd1cf2ae4719161c993450b52f4` and artifact hash `3a56a7d01870749cb00c5b3fb314d4a02a7ad9a9ac103891d561a0d8ccec33e1`, v2 has a distinct identity, and after restart the old page citations still resolve to v1. | `npm --prefix apps/server test -- tests/integration/knowledge-binary-parser-lineage.test.js -t "replay and reparse versions"`; cwd: repository root; common environment above plus disposable local database/storage. | Separate `dev-verifier`; `dev-reviewer` checks no overwrite/latest fallback and old-version citation. |
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

**Documentation governance status:** The root integrator reported that the
declared chain passed on the initial candidate on 2026-10-15: verification-plan
map, document registry, inventory and identity checks, document-graph
generation, document-view check, document-graph check, and strict document
preflight. Those results predate the §8.1 oracle and fail-closed repair in this
revision; governance for this revision is **NOT_RUN**. Parser tests,
implementation acceptance, native pipeline acceptance, production change,
provider call, and deployment remain **NOT_RUN**.

## Version diff

`0.1.0b` candidate adds a proposal-only binary parsing identity, mapping,
location, failure, limit, replay, citation, OCR-exclusion, and fixture-level
hash/source/offset/citation oracles for TASK-ZAI-048. This repair makes ambiguous
DOCX/HTML table mapping and DOCX entry-count refusal explicitly fail closed.
Initial governance results and the current NOT_RUN state are recorded in §10.
It changes no requirement row, schema, stage catalog, runtime, admission
behavior, production state, or acceptance status. No implementation is
accepted.

## CHANGELOG

| Version | Date | Status | Summary | Base revision | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-10-15 | candidate | Proposal-only Stage 2 contract with deterministic synthetic hash/location/citation oracles and fail-closed ambiguous-table/archive outcomes; OCR excluded | `c2c0816ba3c83665334e45680000dbb931e46874` | Codex |
