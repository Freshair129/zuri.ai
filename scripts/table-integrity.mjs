// @tested tests/unit/table-integrity.test.js
//
// The rule behind preflight Check 16 (table-integrity), kept out of
// doc-preflight.mjs for the same reason scripts/untracked-docs.mjs and
// scripts/roadmap-evidence.mjs are: that script is straight-line and derives
// ROOT from its own location, so it cannot be pointed at a fixture. The parts
// with judgement in them — what counts as a table row, how a cell is counted,
// and which documents are in scope — live here where a test can reach them.
//
// Filesystem-free by construction: the reader, the existence probe and the
// ledger text are injected.
//
// ## What this check is for
//
// A blank line terminates a GFM table. On 2026-08-30, while FR-129 was being
// declared, five tables in docs/PRD-SDD-v1.0.md were found to have been split
// by a single blank line since version 1.32.0 (2026-08-14) — between FR-046 and
// FR-047, NFR-009/NFR-010, BR-010/BR-011, SDD-024/SDD-025 and SEC-008/SEC-009,
// each at the boundary where a Phase 1 batch appended rows. Every row below each
// break — 82 FR rows among them — rendered as literal pipe-delimited text rather
// than as a table row, for sixteen days. Repaired in PR #191.
//
// ## Why nothing caught it, and what that dictates about this file
//
// Every generator and check in scripts/ matches a registry row with a
// line-anchored regex — `^\| FR-\d+ \|` and its siblings — and none of them
// parses the table AS A TABLE. Those regexes match a row just as happily when it
// is loose prose on the rendered page as when it is inside a table, so a
// document whose tables do not render is, to all of them, indistinguishable from
// one whose tables do. The check was right about rows and structurally could not
// represent a failure of the table. That is the repeating defect shape in this
// repository (see Checks 13, 14 and 15 above it).
//
// So this file must not repeat it. It knows nothing about `FR-`, `NFR-`, `SDD-`
// or any other id family: it walks lines, tracks fenced code blocks, classifies
// separator rows and counts cells. A check that only understood registry-id rows
// would miss a split in any OTHER table in the same document, which is exactly
// the narrowness that produced the defect.

/** A fence opens or closes on a run of three or more backticks or tildes. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/**
 * Cells in one GFM table row.
 *
 * Counted the way cmark-gfm does it, because the question this check answers is
 * a question about rendering. GFM splits a row on its pipes BEFORE inline
 * parsing, so the only thing that stops a pipe from opening a cell is a
 * backslash escape — `\|` — and a pipe inside a backtick code span delimits a
 * cell like any other. That is a real trap for a human author, and it is also
 * why the registries in scope already write `` `POST /api/import/bundle/dry-run\|commit` ``
 * with the escape inside the code span: 442 rows of docs/PRD-SDD-v1.0.md use
 * `\|`, and a survey of the four registry documents found no unescaped pipe
 * inside a code span at all. Counting them the renderer's way and counting them
 * the intuitive way therefore agree on this corpus; where they could disagree,
 * this file agrees with the renderer.
 *
 * The leading and trailing pipe of a row delimit nothing, so the empty strings
 * either side of them are dropped. `| a | b |` is two cells, and so is
 * `a | b` — a GFM row may omit its outer pipes, though this repository never
 * does. Only the COUNT is returned: the rule compares two of them, and cell
 * content is never inspected.
 */
export function countCells(line) {
  const text = String(line ?? '').trim()
  const cells = []
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') {
      // The escaped character joins the cell whatever it is; a trailing lone
      // backslash escapes nothing and is kept as content.
      cur += ch + (text[i + 1] ?? '')
      i++
      continue
    }
    if (ch === '|') {
      cells.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  cells.push(cur)
  if (cells.length && cells[0].trim() === '') cells.shift()
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop()
  return cells.length
}

/**
 * A line this check is willing to treat as a table row: it both starts and ends
 * with a pipe once indentation is stripped.
 *
 * Deliberately narrower than GFM, which accepts a row with no outer pipes. A
 * bare `a | b` is indistinguishable from a sentence containing a pipe, and the
 * cost of being wrong is asymmetric: a missed split is a rendering bug that
 * survives until someone reads the page, while a false CRITICAL on prose is a
 * gate that teaches people to work around it. Every table in every document in
 * scope uses outer pipes.
 */
export function isTableRow(line) {
  const text = String(line ?? '').trim()
  return text.length >= 2 && text.startsWith('|') && text.endsWith('|')
}

/**
 * The `|---|:--:|` line under a header. Every cell must be a run of dashes with
 * optional alignment colons; a row of real content never satisfies that.
 *
 * It matters to the rule twice over. A separator adjacent to the blank means the
 * blank sits at a table BOUNDARY — either just under a header, which is a
 * different (and rarer) defect, or just above the next table's separator, which
 * is a legitimately adjacent pair — and in neither case is it the mid-table
 * split this check reports.
 */
export function isSeparatorRow(line) {
  const text = String(line ?? '').trim()
  if (!isTableRow(text)) return false
  const inner = text.slice(1, -1)
  const cells = inner.split('|')
  return cells.length > 0 && cells.every((c) => /^\s*:?-+:?\s*$/.test(c))
}

const isBlank = (line) => String(line ?? '').trim() === ''

/**
 * Every blank line that splits one table in two.
 *
 * The rule, which found all five historical breaks in docs/PRD-SDD-v1.0.md with
 * zero false positives across that document:
 *
 *   A blank line whose PRECEDING and FOLLOWING lines are both table rows,
 *   NEITHER of which is a separator row, and which have the SAME cell count.
 *
 * Each condition carries weight. Two genuinely adjacent tables are
 * separated by a heading or prose, or differ in cell count; and the equal-count
 * test is what keeps an unrelated one-column table under a six-column one from
 * firing.
 *
 * ## The fourth condition, and the case that forced it
 *
 * Run over the whole docs tree rather than over the registries alone, the rule
 * as stated above returned two hits. One was a real break —
 * docs/appendices/A-api-spec.md, where two `GET` rows sat below the blank line
 * that ended the Scope table and rendered as literal text; repaired, and the
 * reason the appendices are now in scope. The other is a FALSE POSITIVE:
 * docs/zuri_workspace_system.md:128 separates two genuinely adjacent tables that
 * happen BOTH to have two cells, so "different cell count" does not part them
 * and neither does a heading. What does part them is the line one further on:
 * the row after the blank is that second table's HEADER, and directly under it
 * is its `|---|---|`.
 *
 * So the rule gains one condition — the line after the following row must not be
 * a separator row either. It cannot cost a true positive: a separator only ever
 * appears under a header, so a blank followed by a row followed by a separator
 * is a new table beginning, never the middle of an old one. Recorded here rather
 * than folded in silently, because the rule as handed over was said to have zero
 * false positives and, within the registry documents it was derived from, it
 * does; the second hit only exists outside that scope.
 *
 * Lines inside a fenced code block are not table rows — a fenced example of a
 * split table is documentation of this check, not an instance of it.
 *
 * @param {string} text  document body, newlines already canonical
 * @returns {{line:number, cells:number, before:string, after:string}[]}
 *          `line` is the 1-based line number of the blank line itself.
 */
export function findSplitTables(text) {
  const lines = String(text ?? '').split('\n')
  const fenced = new Array(lines.length).fill(false)
  let fence = null
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i])
    if (fence) {
      fenced[i] = true // the closing fence line is itself inside the block
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null
      continue
    }
    if (m) {
      fence = m[1]
      fenced[i] = true
    }
  }

  const rowAt = (i) => i >= 0 && i < lines.length && !fenced[i] && isTableRow(lines[i])
  const out = []
  for (let i = 1; i < lines.length - 1; i++) {
    if (!isBlank(lines[i]) || fenced[i]) continue
    if (!rowAt(i - 1) || !rowAt(i + 1)) continue
    if (isSeparatorRow(lines[i - 1]) || isSeparatorRow(lines[i + 1])) continue
    // The row after the blank is a new table's header when a separator follows it.
    if (rowAt(i + 2) && isSeparatorRow(lines[i + 2])) continue
    const cells = countCells(lines[i - 1])
    if (cells !== countCells(lines[i + 1])) continue
    out.push({ line: i + 1, cells, before: lines[i - 1].trim(), after: lines[i + 1].trim() })
  }
  return out
}

/**
 * Which documents this check reads: the registry documents named in
 * docs/.id-ledger.json at runtime, plus every `.md` under docs/appendices/.
 *
 * ## The first scope was the reason the sixth break was invisible
 *
 * This check was originally scoped to the ledger's registries, because that is
 * where the five known breaks were. Run over the whole docs tree it immediately
 * found a sixth — docs/appendices/A-api-spec.md, where two `GET` rows had been
 * appended below the blank line that ended the Scope table in August 2026 and
 * had been rendering as literal text ever since. It had been sitting in an
 * appendix the entire time the registry breaks were being hunted, and the first
 * scope would have shipped a green check straight past it.
 *
 * That is the general lesson and it is worth stating rather than quietly fixing:
 * **a guard scoped to where the last failure happened will keep missing the next
 * one.** The property that matters here is not "a document that issues ids" — it
 * is "a document whose tables carry meaning". Appendix D is generated, A and B
 * are hand-maintained, E is a registry, and every one of them is read by people
 * off the rendered page. So docs/appendices/ is swept whole, by directory rather
 * than by a hand-listed set, and a new appendix is covered the day it appears
 * instead of the day somebody remembers to add it.
 *
 * ## Reading the ledger
 *
 * Read rather than hardcoded so registry scope follows the ledger. The array's
 * shape needs one decision, made here in the open — an entry names EITHER a
 * `file` (docs/PRD-SDD-v1.0.md, docs/FEATURES.md, docs/appendices/E-risk-matrix.md,
 * docs/domains/market-intelligence/SRS.md) or a `dir` (docs/decisions for ADR-*,
 * docs/changes for ZV2-CR-*), and only the first names a registry DOCUMENT. The
 * `dir` entries are folders of ordinary prose whose ids come from their own H1;
 * they are skipped, and `skippedDirs` reports them so the omission is stated
 * rather than left to be discovered. Extending to those folders is a decision
 * for whoever wants it, not a side effect of this one.
 *
 * docs/FEATURES.md is already a `file` entry, so the union is the file entries.
 * It is pinned in ALWAYS_IN_SCOPE anyway, so the FEAT registry stays covered
 * even if the ledger's shape changes.
 *
 * ## Why the directory listing is injected, and why its absence is not "clean"
 *
 * `listMarkdown` is a dependency for the same reason `read` and `exists` are:
 * this module stays filesystem-free so a test can drive it. A caller that does
 * not supply one gets `ok: false`, never a quietly narrower sweep — a scope this
 * check silently failed to build would look exactly like a scope with no splits
 * in it, which is the defect shape the whole check exists to close.
 */
export const SWEPT_DIRS = ['docs/appendices']

export const ALWAYS_IN_SCOPE = ['docs/FEATURES.md']

/**
 * @param {string}   ledgerText          contents of docs/.id-ledger.json
 * @param {object}   deps
 * @param {Function} deps.listMarkdown   (repoRelDir) => repo-relative `.md` paths
 */
export function scopeFromLedger(ledgerText, { listMarkdown } = {}) {
  let ledger
  try {
    ledger = JSON.parse(ledgerText)
  } catch (e) {
    return { ok: false, reason: `docs/.id-ledger.json is not valid JSON: ${e?.message || e}` }
  }
  const registries = ledger?.registries
  if (!Array.isArray(registries) || registries.length === 0) {
    return { ok: false, reason: 'docs/.id-ledger.json has no `registries` array' }
  }
  const files = []
  const skippedDirs = []
  for (const r of registries) {
    if (typeof r?.file === 'string' && r.file) files.push(r.file)
    else if (typeof r?.dir === 'string' && r.dir) skippedDirs.push(r.dir)
  }
  if (files.length === 0) {
    return { ok: false, reason: 'docs/.id-ledger.json names no registry file — every entry is a directory' }
  }
  for (const f of ALWAYS_IN_SCOPE) if (!files.includes(f)) files.push(f)

  if (typeof listMarkdown !== 'function') {
    return { ok: false, reason: `no directory lister was supplied, so ${SWEPT_DIRS.join(', ')} could not be swept` }
  }
  const sweptDirs = []
  for (const dir of SWEPT_DIRS) {
    let found
    try {
      found = listMarkdown(dir)
    } catch (e) {
      return { ok: false, reason: `${dir} could not be listed: ${e?.message || e}` }
    }
    if (!Array.isArray(found)) {
      return { ok: false, reason: `${dir} could not be listed: the lister returned ${typeof found}, not an array` }
    }
    sweptDirs.push(dir)
    for (const f of found) if (!files.includes(f)) files.push(f)
  }

  return { ok: true, files, skippedDirs, sweptDirs }
}

/**
 * Findings for Check 16, in doc-preflight's `add()` shape.
 *
 * @param {object}   deps
 * @param {string}   deps.ledgerText    contents of docs/.id-ledger.json
 * @param {Function} deps.read          (repoRelPath) => string, canonical newlines
 * @param {Function} deps.exists        (repoRelPath) => boolean
 * @param {Function} deps.listMarkdown  (repoRelDir) => repo-relative `.md` paths
 *
 * ## Why CRITICAL
 *
 * The unusual property of this failure is that it is invisible from every
 * direction except one: reading the rendered page with your eyes. It changes no
 * id, breaks no link, moves no anchor, and leaves every row matchable by every
 * regex in scripts/ — so no other check in this repository can be made to report
 * it, at any severity. It also does not decay: the five registry breaks survived
 * sixteen days and roughly forty green governance runs, and the appendix break
 * dated from 2026-08-13 and was found only by running this rule wider than its
 * first scope. A warning would put it in the same bucket as a stray untracked
 * note, which is transient and harmless; this is permanent, and it corrupts the
 * readability of exactly the documents people read.
 *
 * ## Why a document that cannot be read is CRITICAL, not skipped
 *
 * Same reason Check 15 treats a failed git call as CRITICAL: "could not look" is
 * never "clean". A scope this check silently failed to read would look exactly
 * like a scope with no splits in it.
 */
export function evaluateTableIntegrity({ ledgerText, read, exists, listMarkdown }) {
  const findings = []
  const scope = scopeFromLedger(ledgerText, { listMarkdown })
  if (!scope.ok) {
    findings.push({
      severity: 'critical',
      check: 'table-integrity',
      title: 'could not determine which documents to check for split tables',
      details: scope.reason,
      files: ['docs/.id-ledger.json'],
      action:
        'This check could not look, which is NOT the same as finding nothing. Repair docs/.id-ledger.json — ' +
        'it is written only by scripts/id-ledger.mjs (ADR-039) — or the appendices directory it also sweeps',
    })
    return findings
  }

  for (const file of scope.files) {
    if (!exists(file)) {
      findings.push({
        severity: 'critical',
        check: 'table-integrity',
        title: 'a document in scope does not exist',
        details: `${file} is in this check's scope but is not on disk, so its tables were not checked`,
        files: [file],
        action: 'Restore the document, or record the move with npm run docs:ids',
      })
      continue
    }
    let splits
    try {
      splits = findSplitTables(read(file))
    } catch (e) {
      findings.push({
        severity: 'critical',
        check: 'table-integrity',
        title: 'a document in scope could not be read',
        details: `${file}: ${e?.message || e}`,
        files: [file],
        action: 'This check could not look, which is NOT the same as finding nothing — read the file by hand',
      })
      continue
    }
    if (!splits.length) continue
    findings.push({
      severity: 'critical',
      check: 'table-integrity',
      title: `${splits.length} table(s) in ${file} are split in two by a blank line`,
      // Every location, never a count: the remedy is to delete one specific
      // blank line, and a count tells nobody which.
      details: splits
        .map((s) => `${file}:${s.line} — blank line between two ${s.cells}-cell rows (after "${clip(s.before)}")`)
        .join('; '),
      files: [file],
      action:
        'Delete the blank line. A blank line ENDS a GFM table, so every row below it renders as literal ' +
        'pipe-delimited text — no other check in this repository can see that, because they all match rows ' +
        'with a line-anchored regex and none parses the table as a table',
    })
  }

  return findings
}

/** Enough of a row to find it by eye, without pasting a registry row into a log line. */
function clip(row, max = 48) {
  return row.length <= max ? row : row.slice(0, max - 1) + '…'
}
