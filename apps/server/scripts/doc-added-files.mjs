// Report-only guards for documents ADDED to the repository (ADR-118 amendment 1,
// redesign proposal section 7.2 checks D1 to D3). Kept out of doc-preflight.mjs for
// the same reason untracked-docs.mjs and id-stability.mjs are: that script is
// straight-line and cannot be pointed at a fixture, so the decisions live here.
//
//   doc-placement  an added or renamed-in document sits in a legacy, frozen, local or
//                  unclassified home (a path no kind accepts new documents in)
//   doc-metadata   an added document in a write home lacks the required frontmatter,
//                  or uses a doc_type/status outside the closed lists
//   doc-prior-art  an added document in a decision/plan/design/evidence kind has no
//                  prior_art declaration, or names a path that does not exist
//
// SEVERITY IS ALWAYS 'warning' (or 'info' when the guard cannot run). Nothing here
// can fail `govern`, `--strict` or CI: doc-preflight exits non-zero only for CRITICAL.
// There is no baseline. Only files added/renamed against the merge base (plus
// untracked, non-ignored files) are examined, so existing files are never reported.
//
// What these checks cannot do, and say so in the finding text:
//   - prior_art is a declaration; the check verifies that named paths exist, not that a
//     search was run or that the hits were read;
//   - a run with no merge base (shallow clone, no origin/main) examines nothing.
//
// @spec ADR-118, docs/plans/DOCS-ARCHITECTURE-REDESIGN-PROPOSAL-20261113.md
// @tested apps/server/tests/unit/doc-added-files.test.js

import { classifyPath, compilePolicy, parseFrontmatter } from '../../../tools/document-catalog.mjs'

export const SEVERITY = 'warning'

const DOCUMENT = /\.md$/i
const REQUIRED_FIELDS = ['id', 'title', 'doc_type', 'status', 'version', 'last_update', 'source_of_truth']
// Kinds whose write-home documents need the full frontmatter. Canonical records (K2),
// instructions (K14), templates, archive, session memory, generated views and Edge keep
// their own formats and are not asked for it here.
const METADATA_KINDS = new Set(['K1', 'K3', 'K4', 'K5', 'K6', 'K7', 'K9', 'K10', 'K11', 'K12', 'K13'])
const PRIOR_ART_KINDS = new Set(['K3', 'K4', 'K5', 'K6', 'K9', 'K12'])
const NON_WRITE_HOMES = new Set(['legacy', 'frozen', 'local', 'unclassified'])

export const LIMITATION =
  'Report-only (ADR-118 amendment 1): this warning never fails govern or CI, and only files added or ' +
  'renamed against the merge base are examined, so existing files are never reported.'

/** Parse `git diff --name-status -z` output into { status, path, from } entries. */
export function parseNameStatus(stdout) {
  const parts = String(stdout || '').split('\0')
  const out = []
  for (let i = 0; i < parts.length;) {
    const status = parts[i]
    if (!status) { i += 1; continue }
    if (/^R/.test(status)) { out.push({ status: 'R', from: parts[i + 1], path: parts[i + 2] }); i += 3 }
    else { out.push({ status: status[0], path: parts[i + 1], from: null }); i += 2 }
  }
  return out.filter((e) => e.path)
}

/**
 * The added set: files added or renamed against the merge base, plus untracked,
 * non-ignored files. `git(args)` returns { ok, stdout } and is injected so the rule is
 * testable without a repository. A failure is reported as info, never as clean.
 */
export function listAddedDocuments({ git }) {
  let base = git(['merge-base', 'HEAD', 'origin/main'])
  if (!base.ok || !base.stdout.trim()) base = git(['merge-base', 'HEAD', 'main'])
  if (!base.ok || !base.stdout.trim()) return { ok: false, reason: 'no merge base with origin/main or main (shallow clone or no remote)', added: [] }
  const diff = git(['diff', '--name-status', '-z', '--find-renames', '--diff-filter=AR', base.stdout.trim(), '--'])
  if (!diff.ok) return { ok: false, reason: 'git diff failed', added: [] }
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--'])
  if (!untracked.ok) return { ok: false, reason: 'git ls-files failed', added: [] }
  const added = parseNameStatus(diff.stdout)
  const seen = new Set(added.map((e) => e.path))
  for (const file of untracked.stdout.split('\0').filter(Boolean)) {
    if (!seen.has(file)) added.push({ status: 'A', path: file, from: null })
  }
  return { ok: true, base: base.stdout.trim(), added }
}

function priorArtPaths(parsed) {
  const raw = parsed?.lists?.prior_art || (parsed?.fields?.prior_art ? [parsed.fields.prior_art] : [])
  return raw.map((entry) => String(entry).replace(/[`'"]/g, '').trim().split(/\s+/)[0]).filter(Boolean)
}

/**
 * Findings, in doc-preflight's add() shape, for the added documents.
 * @param {object}   deps
 * @param {object[]} deps.added   { status, path, from }
 * @param {object}   deps.policy  compiled kinds policy (tools/document-catalog.mjs compilePolicy)
 * @param {Function} deps.read    (path) => text | null
 * @param {Function} deps.exists  (path) => boolean
 */
export function evaluateAddedDocuments({ added, policy, read, exists }) {
  const findings = []
  const add = (check, title, details, file, action) =>
    findings.push({ severity: SEVERITY, check, title, details: `${details} ${LIMITATION}`, files: [file], action })
  for (const entry of added) {
    const file = entry.path
    if (!DOCUMENT.test(file)) continue
    const here = classifyPath(policy, file)
    if (here.kind === 'EDGE') continue
    // A rename inside one home is the same document under another name, not a new one.
    if (entry.status === 'R' && entry.from) {
      const was = classifyPath(policy, entry.from)
      if (was.kind === here.kind && was.home === here.home) continue
    }
    if (NON_WRITE_HOMES.has(here.home) && !here.addAllowed) {
      add('doc-placement', `New document in a ${here.home} home: ${file}`,
        `Kind ${here.kind} (${here.home}) takes no new documents${here.note ? `: ${here.note}` : ''}.`, file,
        'Write it in the write home of its kind (ADR-118; docs/governance/DOCUMENT-KINDS.json), or ask the owner to amend the matrix')
      continue
    }
    if (here.home !== 'write') continue
    const text = read(file)
    if (typeof text !== 'string') continue
    const parsed = parseFrontmatter(text)
    const fields = parsed?.fields || {}
    if (METADATA_KINDS.has(here.kind)) {
      const issues = []
      if (!parsed) issues.push('no frontmatter')
      else {
        const missing = REQUIRED_FIELDS.filter((key) => !(key in fields))
        if (missing.length) issues.push(`missing ${missing.join(', ')}`)
        if (fields.doc_type && !policy.docTypes.has(fields.doc_type)) issues.push(`doc_type "${fields.doc_type}" is outside the closed list`)
        if (fields.status && !policy.statuses.has(fields.status)) issues.push(`status "${fields.status}" is outside the closed list`)
      }
      if (issues.length) {
        add('doc-metadata', `Added document frontmatter: ${file}`, `Kind ${here.kind}: ${issues.join('; ')}.`, file,
          'Add the required frontmatter (docs/plans/DOCS-ARCHITECTURE-REDESIGN-PROPOSAL-20261113.md section 5.3)')
      }
    }
    if (PRIOR_ART_KINDS.has(here.kind)) {
      const declared = fields.prior_art || parsed?.lists?.prior_art
      if (!declared) {
        add('doc-prior-art', `Added document declares no prior_art: ${file}`,
          'The search-before-write protocol asks a new document to name what it found (npm run docs:find), or to state none-found with the query used. This check verifies the declaration, not that a search happened.',
          file, 'Run npm run docs:find, then add prior_art to the frontmatter')
      } else if (!/^none-found\b/i.test(String(fields.prior_art || ''))) {
        const missing = priorArtPaths(parsed).filter((p) => /[/.]/.test(p) && !exists(p))
        if (missing.length) {
          add('doc-prior-art', `prior_art names paths that do not exist: ${file}`,
            `Missing: ${missing.join(', ')}. The check verifies that named paths exist, not that they were read.`, file,
            'Correct the paths or use none-found with the query that was run')
        }
      }
    }
  }
  return findings
}

/** The wiring doc-preflight calls: examine the added set and return findings. */
export function evaluateAddedDocumentGuards({ git, policy, read, exists }) {
  const listed = listAddedDocuments({ git })
  if (!listed.ok) {
    return [{ severity: 'info', check: 'doc-added-files', title: 'Added-document guards skipped', details: `${listed.reason}. ${LIMITATION}`, files: [], action: '' }]
  }
  return evaluateAddedDocuments({ added: listed.added, policy, read, exists })
}

export { compilePolicy }
