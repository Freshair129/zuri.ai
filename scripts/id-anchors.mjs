// Subject anchors for every declared id — the one place ids and their statements
// are read, so the writer (scripts/id-ledger.mjs) and the gate (Check 12 in
// scripts/doc-preflight.mjs) can never disagree about what an id says.
//
// @spec docs/decisions/ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md
// @spec AGENTS.md §18 — an id is a key: never renumbered, never reused for a
//   different statement, never recycled after a requirement is dropped.
// @tested tests/unit/id-anchor-stability.test.js
//
// WHY AN ANCHOR AND NOT THE STATEMENT. On 2026-08-20 PR #88 resolved its own id
// collision by renumbering SDD-049 — a statement that had already merged to main
// — to SDD-050 and taking SDD-049 for itself. Nothing caught it: preflight's
// duplicate-id guard sees two rows sharing a key, and a MOVED id is never a
// duplicate at any single moment. The same failure had already happened on
// 2026-08-15 (PR #9 merged a stale whole-file copy of the registry over main,
// repurposing FR-051 and SDD-026 and deleting fifteen other ids outright).
//
// Pinning the whole statement was measured against the real first-parent history
// of docs/PRD-SDD-v1.0.md: 23 fires, 6 true, 17 false — every false one a pure
// append or paragraph expansion of an unchanged subject. A gate that cries wolf
// three times out of four is learned as a chore, and the chore has a one-command
// bypass indistinguishable from its legitimate use (the `retries: 1` lesson this
// repository already paid for once). Pinning the LEADING SUBJECT instead — the
// head of the statement, normalized and capped — measures 5 fires, 5 true, 0
// false over the same history, and those five are exactly the incident set.
//
// THREE THINGS THE FIRST CUT OF THIS FILE GOT WRONG, all found by adversarial
// verification before it shipped, all fixed here:
//
//  1. It compared raw text, so `(soft delete)` → `(soft-delete)` read as a
//     subject move. Punctuation is now normalized away entirely, exactly as
//     markdown already was: it is presentation, not subject.
//  2. It cut at 60 characters mid-word (107 of 340 anchors), so for those rows
//     the pinned unit was arbitrary text rather than a phrase. The cut now falls
//     on a word boundary. (The related complaint — that a short `Label:` pins
//     little of a long statement — is NOT fixed here; anchor() records what was
//     tried, what it cost when measured, and why the blind spot stands.)
//  3. It split table rows on every `|`, truncating any cell containing the
//     correct markdown escape for a literal pipe (`\|`).

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { readCanonical } from './canonical-text.mjs'

/** How much of the leading subject is pinned. Long enough to be a subject. */
export const ANCHOR_MAX = 60

/**
 * Presentation stripped: markdown emphasis, code ticks and link chrome. A row
 * that gains a bold span, or has a path turned into a link, has not changed what
 * it is about.
 */
const plainText = (statement) =>
  String(statement || '')
    .replace(/~~/g, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

/**
 * Canonical full statement for the review-only witness. Presentation markdown
 * and whitespace are not meaning; punctuation and wording are. Unlike
 * `anchor()`, this keeps the complete statement so a same-subject edit can be
 * shown to a reviewer without turning the noisy full-text alternative into a
 * blocking gate.
 */
export const canonicalStatement = (statement) => plainText(statement).replace(/\s+/gu, ' ').trim()

/** SHA-256 of the canonical full statement; never used as a merge blocker. */
export const statementDigest = (statement) =>
  createHash('sha256').update(canonicalStatement(statement), 'utf8').digest('hex')

/**
 * Words and numbers only, lowercased. Punctuation is normalized away rather than
 * compared: a hyphen added to "soft delete", a comma moved, a bullet character
 * swapped and a bracket closed are copy-edits, and a gate that calls a copy-edit
 * a subject move teaches authors to reach for the override flag.
 * Unicode-aware, because half this registry is Thai.
 */
const normalize = (s) => s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()

/** Cap on a word boundary — a half-word is not a subject anybody can read. */
function cap(s) {
  if (s.length <= ANCHOR_MAX) return s
  const cut = s.slice(0, ANCHOR_MAX)
  const space = cut.lastIndexOf(' ')
  // Thai runs without spaces, so a backed-off cut can collapse to nothing.
  // Below half the cap, keep the hard cut rather than pin two words.
  return (space >= ANCHOR_MAX / 2 ? cut.slice(0, space) : cut).trim()
}

/**
 * The subject of a statement: everything before the first colon or dash,
 * normalized and capped.
 *
 * WHAT THIS DELIBERATELY DOES NOT PIN. 30 of 340 ids have a leading label under
 * 30 characters in front of a statement over 150 (FR-030 pins "persistence" out
 * of 222), so for those rows the body can be replaced with the label preserved
 * and nothing fires. Taking the whole statement when the label is short was
 * implemented and MEASURED, and it costs more than it buys: it flips the
 * derivation mid-comparison — "Snapshot backup:" widened to "Snapshot backup and
 * restore:" switches from whole-statement to label and the two become
 * incomparable — and replaying the first-parent history of the PRD with it added
 * a false positive (FR-012 at 4a86409ae, a genuine rewording). Charging authors
 * for widening a phrase is the failure mode this whole design exists to avoid,
 * so the label wins and the blind spot is recorded here and in ADR-039
 * §"What this does not do".
 */
export function anchor(statement) {
  return cap(normalize(plainText(statement).split(/[:—–]/)[0]))
}

const tokens = (a) => a.split(' ').filter(Boolean)

/**
 * Two anchors name the same subject — the tolerant comparison, used to ask
 * "does this id still stand for what it stood for".
 *
 * The tolerance is a WORD-boundary prefix, not a character-count threshold. The
 * character rule shipped first and was wrong in both directions: it required
 * both anchors to be at least 24 characters, which excluded 100 of 340 ids from
 * any tolerance at all (widening "snapshot backup" to "snapshot backup and
 * restore" fired a CRITICAL), and it matched half-words. Growing a statement
 * adds tokens to the end; it never rewrites the ones already there. There is no
 * similarity metric and no threshold — nothing here to tune under deadline
 * pressure, which is the point.
 */
export function sameAnchor(a, b) {
  if (a == null || b == null) return false
  if (a === b) return true
  const [ta, tb] = [tokens(a), tokens(b)]
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (!short.length) return false
  return short.every((t, i) => t === long[i])
}

/**
 * The strict comparison: this is the SAME subject, word for word.
 *
 * Used where tolerance would libel a legitimate edit — asking whether a NEW id
 * has taken over an EXISTING id's subject (a renumber copies the statement, so
 * the anchors are identical), rather than whether one id's subject drifted.
 * Splitting a requirement into slices ("…, second slice: …") is a normal edit
 * here and must not be reported as a renumber.
 */
export const identicalAnchor = (a, b) => a != null && b != null && a === b

/**
 * Families whose numbers are burnt: retired wholesale and never re-declarable.
 *
 * FR-MI-xxx / DQ-MI-xxx shipped in the Market Intelligence SRS at a4c1cb085 and
 * were renamed wholesale to MI-RQ-xxx at eaaec954e WITHOUT preserving slot
 * meanings (FR-MI-010 "Source registry" became MI-RQ-010 "Existing ingestion
 * substrate"). Per AGENTS.md §18 the old numbers stay burnt. They live here in
 * code rather than in the ledger for the same reason Check 8's VIEWER_EXEMPT
 * does: this is a permanent structural fact with a reason attached, not debt that
 * could ever be repaid.
 */
export const BURNT_FAMILIES = ['FR-MI', 'DQ-MI']

/**
 * Roadmap labels shaped like ids that are not ids — waves, gates, batches.
 * Recorded so a future scanner cannot mistake them for a family to guard.
 */
export const NOT_IDS = ['W0', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'B02', 'B03', 'B04']

/**
 * Every id family that has a declaration site — an id AND the statement it names,
 * in one place. Adding a family is one row here, not a new code path: the guard
 * shipped blind to MI-RQ once already, and that is exactly how this recurs.
 *
 * `file` and `dir` are where the registry lives TODAY, not a contract. Moving a
 * document is free (AGENTS.md §18), so a registry that is not at its recorded
 * path is looked for by name before anything is reported — the first cut of this
 * file treated a `git mv` of the risk matrix as fourteen ids vanishing, which is
 * the check contradicting the rule it enforces.
 *
 * Deliberately absent, each for a reason:
 *   AC     — two incompatible live syntaxes (AC-053-01 and AC-075.3), no single
 *            declaration site, and no statement to anchor.
 *   DOM    — semantic string keys (DOM-CRM), not sequence numbers, so the "two
 *            branches both take the next free number" collision cannot occur.
 *   PLAN-FR / TASK-FR / REQ-FR — derived keys that inherit an FR number; the
 *            subject change is already caught at the FR entry itself.
 */
export const REGISTRIES = [
  { families: ['FR', 'NFR', 'BR', 'SEC', 'SDD'], file: 'docs/PRD-SDD-v1.0.md', form: 'table', has_version_history: true },
  { families: ['FEAT'], file: 'docs/FEATURES.md', form: 'table', has_version_history: false },
  { families: ['RSK'], file: 'docs/appendices/E-risk-matrix.md', form: 'table', has_version_history: false },
  { families: ['MI-RQ'], file: 'docs/domains/market-intelligence/SRS.md', form: 'bold-heading', has_version_history: false, draft: true },
  { families: ['ADR'], dir: 'docs/decisions', form: 'document-h1', filePattern: '^ADR-(\\d{3})-', has_version_history: false },
  // A CR's stage artifacts (ZV2-CR-001-W0-INVENTORY.md) belong to the CR and are
  // not competing declarations of it — the same negative lookahead the
  // duplicate-id guard already uses, so the two checks agree about ZV2-CR-001.
  { families: ['ZV2-CR'], dir: 'docs/changes', form: 'document-h1', filePattern: '^ZV2-CR-(\\d{3})-(?!W\\d+-)', has_version_history: false },
]

const tableIdRe = (families) => new RegExp(`^(?:${families.join('|')})-\\d{3}$`)

/**
 * Split a markdown row on its cell separators only. `\|` is the correct escape
 * for a literal pipe inside a cell, and splitting on it truncated the statement
 * mid-token — which then fired as a subject move with a garbage anchor that the
 * repair path would have pinned for the life of the project.
 *
 * Exported because scripts/doc-graph.mjs needs the same answer. It split rows on
 * a bare `|` until 2026-08-30 and therefore truncated SDD-071's label at the
 * escape, publishing a half sentence into Appendix D — two readings of one row,
 * from two splitters, differing on the one character this whole file is about.
 */
export const splitRow = (line) => line.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())

/**
 * Retirement, read from both halves of the row and deliberately asymmetric — a
 * struck-through STATEMENT, or a status cell that OPENS with a retirement word.
 *
 * "Opens with" is the whole rule, and it is narrow on purpose. Reading the word
 * anywhere in the trailing cells made the risk matrix's Mitigation column — free
 * prose about what to do with legacy paths — decide that a live risk was
 * retired, and offered a remedy that would have written a false retirement into
 * the ledger. Every retirement in this tree today (SDD-001, SEC-004, RSK-006)
 * strikes its statement through; SEC-004 additionally opens its status cell with
 * "**retired 2026-08-18 …**", so the narrow rule still reads it.
 */
const RETIREMENT_WORD = /^(superseded|supersedes|supersede|cancelled|canceled|retired|deprecated)\b/i
/** Leading chrome — emoji, bullets, bold markers, dashes — is not the word. */
const opensWithRetirement = (cell) => RETIREMENT_WORD.test(cell.replace(/^[^\p{L}]+/u, ''))

function tableStatus(statement, cells) {
  if (/~~/.test(statement)) return 'superseded'
  if (cells.some(opensWithRetirement)) return 'superseded'
  return 'current'
}

/**
 * Registries move. Look where the registry is recorded first, then anywhere in
 * docs/ under the same basename, and only then give up — a missing registry is
 * ONE finding about the registry, never one per id it used to declare.
 */
function findByBasename(root, relPath) {
  const base = path.basename(relPath)
  const docs = path.join(root, 'docs')
  const found = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir)) {
      if (['node_modules', '.next', '.git', 'archive'].includes(e)) continue
      const full = path.join(dir, e)
      if (statSync(full).isDirectory()) walk(full)
      else if (e === base) found.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  walk(docs)
  // Exactly one, or nothing: two files with the registry's name is not a move,
  // it is a question only a human can answer, and guessing which one is the
  // registry would be the check inventing an answer.
  return found.length === 1 ? found[0] : null
}

export function resolveRegistry(root, reg) {
  if (reg.file) {
    if (existsSync(path.join(root, reg.file))) return reg.file
    return findByBasename(root, reg.file)
  }
  if (existsSync(path.join(root, reg.dir))) return reg.dir
  return null
}

function collectTable(root, reg, file, out, dups) {
  const idRe = tableIdRe(reg.families)
  for (const line of readCanonical(path.join(root, file)).split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = splitRow(line)
    const id = cells[1]
    // Anchored on cell 1 — this is what excludes the Version History table (its
    // first cell is a version number) and every traces-to citation, which live in
    // cells 3 and beyond. Never relax it.
    if (!id || !idRe.test(id)) continue
    const statement = (cells[2] || '').replace(/\s+/g, ' ').trim()
    // slice(3), never [3]: most BR rows write only two cells — the table is
    // three columns wide, but the `Traces to` column is empty for all but the
    // two rows that carry it — so indexing behaves differently there. The slice
    // yields the empty trailing cell instead of undefined.
    const status = tableStatus(statement, cells.slice(3))
    if (out.has(id)) {
      // First row wins, as in doc-graph — but the ones it drops are no longer
      // silent. A second `| SDD-049 |` row carrying a different statement was
      // invisible to every check in this repository, and which of the two the
      // graph kept depended on file order, which carries no meaning.
      dups.push({ id, source: file, statement, anchor: anchor(statement), first: out.get(id) })
      continue
    }
    out.set(id, {
      id,
      family: reg.families.find((f) => id.startsWith(`${f}-`)),
      source: file,
      statement,
      anchor: anchor(statement),
      statement_digest: statementDigest(statement),
      status,
      has_version_history: reg.has_version_history,
      draft: Boolean(reg.draft),
    })
  }
}

// The SRS puts the id and its title on one line and the SHALL sentence on the
// next, so here the subject is the text AFTER the dash — the inverse of the table
// rule. Written per family on purpose: deriving it generically would be a guess.
const MI_RQ_HEADING = /^\*\*(MI-RQ-\d{3})\s+[—–-]\s+(.+?)\*\*\s*$/

function collectBoldHeading(root, reg, file, out, dups) {
  for (const line of readCanonical(path.join(root, file)).split('\n')) {
    const m = MI_RQ_HEADING.exec(line)
    if (!m) continue
    const entry = {
      id: m[1],
      family: 'MI-RQ',
      source: file,
      statement: m[2].trim(),
      anchor: anchor(m[2]),
      statement_digest: statementDigest(m[2]),
      status: 'current',
      has_version_history: reg.has_version_history,
      draft: Boolean(reg.draft),
    }
    if (out.has(m[1])) dups.push({ ...entry, first: out.get(m[1]) })
    else out.set(m[1], entry)
  }
}

function collectDocumentH1(root, reg, dir, out, dups) {
  const namePattern = new RegExp(reg.filePattern)
  const family = reg.families[0]
  for (const base of readdirSync(path.join(root, dir)).sort()) {
    if (!base.endsWith('.md')) continue
    const m = namePattern.exec(base)
    if (!m) continue
    const id = `${family}-${m[1]}`
    const body = readCanonical(path.join(root, dir, base))
    // The H1 is found by scanning, not by reading line 1: ADR-038 opens with YAML
    // frontmatter while ADR-024 opens with its title.
    const h1 = /^#\s+(.+)$/m.exec(body)?.[1] || ''
    const title = h1.replace(new RegExp(`^${id}\\s*[—–-]\\s*`), '').trim()
    const entry = {
      id,
      family,
      source: `${dir}/${base}`,
      statement: title,
      anchor: anchor(title),
      statement_digest: statementDigest(title),
      // A document states its own status; body prose churns on every amendment
      // and is never anchored.
      status: /\*\*Status:\*\*\s*Superseded/i.test(body) || /^status:\s*"?superseded/im.test(body) ? 'superseded' : 'current',
      has_version_history: reg.has_version_history,
      draft: Boolean(reg.draft),
    }
    if (out.has(id)) dups.push({ ...entry, first: out.get(id) })
    else out.set(id, entry)
  }
}

/**
 * Every id declared in the tree today, keyed by id, in registry order.
 *
 * Two extras ride on the returned Map, because they are facts about the same
 * scan and separating them would let a caller read one without the other:
 *   .duplicates — rows this scan had to drop because their id was already taken
 *   .missing    — registries that are not on disk anywhere under docs/
 */
export function collectDeclared(root) {
  const out = new Map()
  const duplicates = []
  const missing = []
  for (const reg of REGISTRIES) {
    const at = resolveRegistry(root, reg)
    if (!at) {
      missing.push({ families: reg.families, recorded_at: reg.file || reg.dir })
      continue
    }
    if (reg.form === 'table') collectTable(root, reg, at, out, duplicates)
    else if (reg.form === 'bold-heading') collectBoldHeading(root, reg, at, out, duplicates)
    else if (reg.form === 'document-h1') collectDocumentH1(root, reg, at, out, duplicates)
  }
  out.duplicates = duplicates
  out.missing = missing
  return out
}
