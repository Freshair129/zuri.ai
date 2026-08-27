// The rule behind preflight Check 13 (roadmap-evidence), kept out of
// doc-preflight.mjs for the same reason scripts/id-stability.mjs is: that script
// is straight-line and derives ROOT from its own location, so it cannot be
// pointed at a fixture. The parsing and the resolution rule are the parts with
// judgement in them, so they live here where a test can reach them.
//
// Filesystem-free by construction: `exists` is injected. Everything below works
// in repo-relative POSIX paths.
import path from 'path'

// Where a Source Section reference may be rooted. The column genuinely mixes
// the two — `../domains/...` is written relative to the roadmap's own directory,
// while `roadmap/PLAN-FR-045-....md` and `changes/ZV2-CR-005-....md` are written
// relative to docs/ — and both forms name files that exist. See the check's
// comment in doc-preflight.mjs for why accepting either is the deliberate choice.
export const EVIDENCE_BASES = ['docs/roadmap', 'docs']

/**
 * Strip a reference down to the path it claims, or null if it claims none.
 *
 * A reference is a path claim when, after a trailing parenthetical annotation is
 * removed, it contains `/`. That separates locations from registry references
 * (`PRD-SDD 1.3`, `ADR-024`, `PRD-SDD FR-109..111`), which name an id or a
 * section rather than a file.
 *
 * The annotation is stripped rather than treated as making the cell a non-path:
 * `../domains/identity/features/FR-107 (PRD row)` still asserts a location, and
 * exempting the form would let any broken pointer be laundered by appending a
 * parenthetical.
 */
export function evidencePath(reference) {
  const ref = (/\[[^\]]*\]\(([^)]+)\)/.exec(reference)?.[1] ?? reference)
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
  if (!ref || ref === '-' || !ref.includes('/')) return null
  return ref
}

/**
 * Every repo-relative path a reference could legitimately mean.
 *
 * The `.md` extension is optional because several cells omit it and still name a
 * real file. Candidates that escape the repository root are dropped rather than
 * probed — a `..` walking out of the tree is never a document this repo owns.
 */
export function candidatePaths(ref) {
  const out = []
  for (const base of EVIDENCE_BASES) {
    for (const cand of [ref, `${ref}.md`]) {
      const joined = path.posix.normalize(path.posix.join(base, cand))
      if (!joined.startsWith('..') && !out.includes(joined)) out.push(joined)
    }
  }
  return out
}

/**
 * Read the Backlog Items table and report which evidence references resolve to
 * nothing.
 *
 * @param {object} input
 * @param {string} input.roadmapText  ROADMAP.md, newlines already canonical
 * @param {(repoRelativePath: string) => boolean} input.exists
 * @returns {{broken: string[], structural: {title: string, action: string}[]}}
 *   `broken` entries are `"<row id>::<reference>"` — the key the baseline uses.
 *   `structural` reports the table itself having moved out from under the check,
 *   which must be visible rather than reading as a clean pass.
 */
export function findBrokenEvidence({ roadmapText, exists }) {
  const broken = []
  const structural = []
  const lines = roadmapText.split('\n')
  const cells = (row) => row.split('|').slice(1, -1).map((c) => c.trim())

  const start = lines.findIndex((l) => /^##\s+Backlog Items/i.test(l))
  if (start === -1) {
    structural.push({
      title: 'Backlog Items table not found in the roadmap',
      action: 'The heading moved or was renamed — this check reads nothing until it is found again',
    })
    return { broken, structural }
  }

  // The column position is read from the header rather than assumed, so
  // inserting a column ahead of it cannot silently point this at the wrong cell.
  // That failure mode is worse than a crash: the check would go on passing while
  // reading titles.
  const headerAt = lines.findIndex((l, i) => i > start && /^\|/.test(l) && /\bSource Section\b/.test(l))
  if (headerAt === -1) {
    structural.push({
      title: 'Backlog table has no Source Section column',
      action: 'Restore the column, or retire this check with it',
    })
    return { broken, structural }
  }

  const col = cells(lines[headerAt]).findIndex((c) => /\bSource Section\b/.test(c))
  for (let i = headerAt + 2; i < lines.length && /^\|/.test(lines[i]); i++) {
    const row = cells(lines[i])
    const id = row[0]
    for (const raw of (row[col] || '').split(';')) {
      const ref = evidencePath(raw)
      if (!ref) continue
      if (!candidatePaths(ref).some(exists)) broken.push(`${id}::${ref}`)
    }
  }
  return { broken, structural }
}
