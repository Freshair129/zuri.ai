---
domain: knowledge
feature: FR-115
module: knowledge
source: v2-native
version: "0.1.1b"
status: "implemented"
---

# FR-115 — Document parsing into a structured artifact that keeps its link to the raw source

## Intent

FR-115 implements Stage 2 of `DPL-KNOWLEDGE-INGEST-V1` — the `DPS-KI-PARSE` row
of [FR-109](./FR-109-knowledge-ingestion-stage-catalog.md)'s catalog — as a pure
function in the knowledge lane: `src/modules/knowledge/parsing.js`, function
`parseDocument`.

It turns a document's text into the `ParsedArtifact` the specification's §7
defines, and keeps that artifact pointed at the raw artifact it came from via
`parsed_from`.

Stage 2 is **Tier 1** under
[ADR-050](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md)
(row 2 of its stage table), which is why this one executes here.

## The gap this closes

Before this, `chunkDocument` (FR-112) consumed a `blocks` argument that
**nothing in `src/` produced**. Every caller was a test file. The same held for
Stage 8 downstream of it. Two modules were written, reviewed and green, and
neither could be reached from a document — the chain started at a fixture.

That is why Stage 2 was worth building before Stage 3 or Stage 6, both of which
are also unimplemented: 2 → 7 → 8 is the first stretch of the pipeline that can
now run end to end on real text, and the stages either side of it are ledger and
key work that do not unblock anything by themselves.

## The artifact

`parseDocument({ documentId, rawArtifactId, text })` returns:

| Field | Meaning |
|---|---|
| `document_id` | echoed from `documentId` |
| `parsed_from` | echoed from `rawArtifactId` — the §7 link back to the raw artifact FR-081 stored |
| `structure` | the ordered block list: `{ type: 'heading', level, text }` and `{ type: 'text', text }` |
| `text_blocks` | every line of the normalised document, in order, as `{ text }` — including blanks, fenced code and table rows |
| `tables` | `{ header, rows }` per recognised table, cells trimmed |
| `warnings` | one string per structure the parser refused to guess at, plus one for a code fence that never closed |
| `metadata` | `extractor_version`, `heading_count`, `text_block_count`, `structure_text_count`, `table_count` |

`metadata.extractor_version` is the exported `EXTRACTOR_VERSION`
(`'ki-parse-1'`), stamped on every artifact so a reparse after a parser change is
distinguishable from the original — the §7 requirement that makes reprocessing
auditable rather than silent.

The two text counts are deliberately separate, because they answer different
questions and one field cannot answer both:

| Field | Counts | Answers |
|---|---|---|
| `text_block_count` | `text_blocks.length` — every source line, blanks included | "did the artifact keep the whole document?" |
| `structure_text_count` | the `type: 'text'` nodes in `structure` — blank lines excluded, a consumed table contributing one | "how much will Stage 7 chunk?" |

`text_block_count` counts `text_blocks`, as its name says. It used to count
`structure` instead, which made a field named after one array report the length
of another — the kind of mismatch nobody reads twice and everybody miscomputes
from. `structure_text_count` now carries the old meaning under a name that
states it. `heading_count` has always counted `structure`, and still does;
headings exist nowhere else.

Input is normalised before anything is read: a leading byte-order mark is
stripped rather than glued onto the first heading, and CRLF (and lone CR) become
LF, so a file saved on Windows parses identically to the same file saved on
Linux. An empty document returns an empty artifact — empty `structure`, empty
`tables`, `document_id` and `parsed_from` still set — rather than throwing.

## Refusing structure that is not there

The hard part of this stage is not finding structure. It is refusing to find
structure that is not there. A parser that over-reads does not fail loudly: it
invents a heading, and Stage 7 then chunks the document along a boundary the
author never wrote, so the damage surfaces as a bad retrieval result three stages
later with nothing pointing back here.

| Input | Naive reading | What the parser does |
|---|---|---|
| `# not a heading` inside a fenced code block | a heading — a shell comment opens with the same character as a heading | fence state is tracked; fenced lines stay text |
| a four-space-indented `#` | a heading | indented code is code; the ATX match is anchored at column 0 |
| `#โปรโมชัน` — no space after `#` | a heading | CommonMark requires the space, so it is a paragraph. Thai business documents carry hashtags, so this is a live case, not a spec-lawyer case |
| a run of dashes with no text on the line directly above it | a setext heading with an empty title | a thematic break |
| a run of dashes below a line containing a pipe | a setext heading | a table separator |
| a run of dashes below the last row of a table | a setext heading promoting a paragraph rows above the table | a thematic break — the underline reads the SOURCE line above it, not the last node it recorded |
| `npm run verify \| tee log.txt` inside a sentence | a table row | a table row is delimited by pipes, not merely containing one |
| a 2-column separator under a 3-column header | a table read with a column dropped or invented | reported in `warnings`, left as prose |
| a code fence that is never closed | the rest of the document silently swallowed as text | still read as text, but the artifact says so in `warnings` |

The separator row is the rule most worth stating outright. When a table's separator
disagrees with its header, the author's table is broken, and both repairs — pad
the row or drop the column — put data in the artifact that is not in the
document. Refusing, and saying so in `warnings`, is the only option that does not
lie.

### Setext headings are read in arrears, and that is where the trap was

A setext heading is the line **above** its underline, so it can only be
recognised looking backwards. The first version looked backwards into
`structure` — it promoted the last node it had recorded. That was wrong in a way
the guards beside it could not catch, because **table rows and fenced code never
reach `structure` as lines**. A run of dashes after a consumed table therefore
reached back over the whole table and promoted a paragraph five rows up into a
heading, and the pipe guard — the one written precisely to stop a table
separator being read as an underline — never saw the pipes it was guarding
against, because the line it inspected was not the line above.

It now reads `lines[i - 1]`, the previous **source** line, and promotes only when
that line is non-empty, contains no pipe, and is not itself an ATX heading, a
fence or another underline. The last `structure` node must additionally still
correspond to that line — the promotion rewrites that node, so it has to be the
one the underline is talking about. Both failure modes are pinned by tests now
(the blank-line case and the reach-back-over-a-table case), and so is the
converse: a genuine heading on the line directly above is still promoted, so the
fix cannot be "fixed" into refusing everything.

Fenced lines and raw table rows reach `text_blocks` but not `structure` as
lines. A consumed table, however, **does** contribute to `structure`: alongside
the `{ header, rows }` entry in `tables`, it emits one `text` node carrying its
header and rows joined. Without it a table lived only in `tables`, and Stage 7
chunks `structure` alone — a table nobody could retrieve. In a Thai business
document the tables are most of what anyone wants to find, so this was the
difference between a searchable document and a searchable preamble. The table is
still reported in `tables` as well; a test pins both halves, because a fix that
moved the table from one array to the other would have traded one blind spot for
another.

### Limits a reader should not have to discover

Most of these are conservative in direction — the parser under-reads rather than
inventing structure — but they are real, and stating them here is cheaper than
finding them in a bad retrieval result. The fence one is not conservative, which
is why it is second:

- **ATX headings are anchored at column 0.** CommonMark allows 1–3 leading
  spaces before a `#`; this parser does not, so ` # Heading` is prose. The
  four-space case is genuinely indented code and is meant to be prose; the one-
  to-three-space case is a heading the parser declines to see.
- **Fence matching ignores the fence character and its length.** Any line
  starting with ` ``` ` or `~~~` toggles the fence state, so a `~~~` line closes
  a backtick fence and a longer run does not have to match the run that opened
  it. A document that mixes both fence styles can therefore end a block early —
  and then read what follows as markup.
- **A table's `structure` node is flattened.** Cells are joined with spaces,
  header and rows into a single text node, so the chunk text says what the table
  says but no longer says which column said it. `tables` keeps the shape for
  anything that needs it.

## The seam with Stage 7

`structure` **is** `chunkDocument`'s `blocks` argument (SDD-063). Not a shape
that maps onto it — the same array, handed straight across.

**Stage 7 owns the shape.** FR-112 existed first and its tests define
`{ type, level, text }`; the parser conforms to it. Stating the ownership matters
because the alternative — two modules each free to adjust "their" shape — is how
a seam drifts while both suites stay green.

The seam is held by a **composition test that feeds real `parseDocument` output
into `chunkDocument` and asserts on the resulting chunks**, not by the paragraph
you are reading. A written statement that two shapes agree is prose, and prose is
not a contract: it cannot fail. Only the composition test fails when one side
moves.

One of those tests also carries `parsed_from` the whole way through — parse a
document, hand `provenance: { parsed_from }` to Stage 7, assert on
`chunks[0].provenance.parsed_from`. That is the §8 chain
`Chunk → ParsedArtifact → RawArtifact` demonstrated rather than asserted.

## What is parsed here and what is not

Markdown and plain text, deterministically — same input, same artifact; no model,
no network, no clock.

PDF, DOCX, OCR and vision layout analysis are **not** parsed here, and this is a
division of labour rather than a shortfall. Extracting text from a PDF or reading
a scanned table needs either a model or a native binary; neither belongs in a
pure function in this lane. Those formats already arrive through
[FR-071](./FR-071-supabase-data-pipeline-monitor-and-replay.md)'s
`smartgift.document-intake.v1` front door, which receives and validates someone
else's extraction rather than performing one. There are two ways into the
pipeline because there are two kinds of source, not because one way is
unfinished.

## Acceptance criteria

Each criterion is checked when a test in `tests/unit/knowledge-parsing.test.js`
proves it. The file holds **24 tests**; every checked box below names one, and
the unchecked ones name behaviour no test asserts.

- [x] **AC-115.1** A `#` line inside a fenced code block does not become a
      heading.
- [x] **AC-115.2** Those fenced lines are still present in the artifact, as text.
- [x] **AC-115.3** A four-space-indented `#` does not become a heading.
- [x] **AC-115.4** `#hashtag` with no following space is prose, not a heading.
- [x] **AC-115.5** A line underlined with `=` is a level-1 setext heading.
- [x] **AC-115.6** A line underlined with `-` is a level-2 setext heading.
- [x] **AC-115.7** Real `parseDocument` output passed to `chunkDocument` yields
      the expected `heading_path`s and chunk text — the seam is executed, not
      described.
- [x] **AC-115.8** `parsed_from` survives from the artifact to a chunk's
      `provenance`.
- [x] **AC-115.9** A well-formed table is read into `header` and `rows`.
- [x] **AC-115.10** A sentence containing a pipe is not read as a table.
- [x] **AC-115.11** A table whose separator column count disagrees with its
      header is left as prose and reported in `warnings`.
- [x] **AC-115.12** `metadata.table_count` reports the table, so the caller does
      not have to count.
- [x] **AC-115.13** CRLF input parses to the same structure as LF input.
- [x] **AC-115.14** A leading byte-order mark is stripped, not attached to the
      first heading.
- [x] **AC-115.15** An empty document returns an empty artifact that still
      carries `document_id` and `parsed_from`, rather than throwing.
- [x] **AC-115.16** `metadata.extractor_version` is stamped on the artifact, so a
      reparse can be told from the original.
- [x] **AC-115.17** `metadata.heading_count` reports the headings found, and
      `metadata.text_block_count` equals `text_blocks.length` — the field counts
      the array it is named after. Two tests assert the second half.
- [x] **AC-115.18** A run of dashes separated from the paragraph above it by a
      blank line is a thematic break, not a setext heading.
- [x] **AC-115.19** A run of dashes following a table's last row does not reach
      back over the table to promote a paragraph five rows up; the pipe on the
      real preceding line is what stops it.
- [x] **AC-115.20** A genuine setext heading on the line **directly** above the
      underline is still promoted — the reach-back fix refuses the wrong case
      without refusing the right one.
- [x] **AC-115.21** A consumed table's content reaches `structure`, so a chunk
      built from real parser output carries what the table says.
- [x] **AC-115.22** That table is still reported in `tables` as well — it moved
      into `structure`, it did not move out of `tables`.
- [x] **AC-115.23** `metadata.structure_text_count` counts the `type: 'text'`
      nodes Stage 7 will chunk, blank lines excluded.
- [x] **AC-115.24** A code fence that is never closed produces a warning rather
      than silently swallowing the rest of the document.

Known gaps in this list, stated rather than left to be discovered:

- [ ] **AC-115.25** A run of dashes as the very first line of a document — with
      no line above it at all — is a thematic break. The `above !== undefined`
      arm of the same guard; the blank-line case above pins its sibling, this
      one is reached only at line 0 and no test drives it.
- [ ] **AC-115.26** An ATX heading indented by one to three spaces is a heading
      under CommonMark and prose here. Deliberate and conservative, but
      undertested: nothing fails if the anchor changes.
- [ ] **AC-115.27** A `~~~` line does not close a ` ``` ` fence. It currently
      does — fence matching ignores the fence character and its length — so this
      is an open defect, not merely an untested guard.

## Non-goals

- **No Prisma model, no persistence, no route, no API.** The artifact is returned
  to the caller and never stored, so the knowledge charter's `owns_models: []`
  stays true.
- **Not chunking.** Splitting `structure` into retrieval units is
  [FR-112](./FR-112-structural-knowledge-chunking.md), and this file does not
  import it.
- **No entity work.** Mentions, types and candidates are
  [FR-113](./FR-113-entity-candidate-extraction.md).
- **Not a CommonMark implementation.** It recognises the constructs Stage 7 can
  use — ATX and setext headings, fenced and indented code, pipe tables — and
  treats everything else as text. Lists, block quotes, link reference definitions
  and inline markup are not modelled.
- **Not classification or provenance capture.** `scope` is
  [FR-111](./FR-111-knowledge-sensitivity-lattice.md)'s (Stage 5) and the
  provenance envelope is Stage 3's; the parser emits only the one link §7 asks of
  it, `parsed_from`.

## Related documents

- [Knowledge domain charter](../CHARTER.md)
- [FR-109 — Seventeen-stage knowledge ingestion stage catalog and job trace](./FR-109-knowledge-ingestion-stage-catalog.md) — the `DPS-KI-PARSE` catalog row this implements
- [FR-112 — Structural knowledge chunking with parent-child lineage](./FR-112-structural-knowledge-chunking.md) — the consumer that owns the block shape
- [FR-113 — Entity candidate extraction from chunks and structured records](./FR-113-entity-candidate-extraction.md) — the stage below Stage 7
- [FR-111 — Knowledge sensitivity lattice](./FR-111-knowledge-sensitivity-lattice.md) — where `scope` comes from, not from here
- [FR-071 — Supabase data pipeline monitor and replay](./FR-071-supabase-data-pipeline-monitor-and-replay.md) — the `smartgift.document-intake.v1` front door for the formats this parser does not read
- [PRD-SDD v1.0 — FR-115, SDD-063, FR-112, FR-081](../../../PRD-SDD-v1.0.md)
- [ADR-050 — Knowledge ingestion tier boundary and stage ownership](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md) — its stage table puts Stage 2 in Tier 1
- [Zuri 17-Stage Knowledge Ingestion & GraphRAG Preparation Pipeline Specification](../../../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) — §7 (Stage 2) is the source requirement
