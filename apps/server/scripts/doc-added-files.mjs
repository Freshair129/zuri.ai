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
// SEVERITY is 'warning' (or 'info' / 'warning' when the guard cannot run), with ONE exception set by
// ADR-118 amendment 3: doc-placement is CRITICAL, per finding, for a file added or renamed into a
// legacy home whose policy rule says enforce:"critical" (.agent/, agent/, .rwang-tasks/,
// .brain/plans/, docs/superpowers/, docs/roadmap/PLAN-*.md). The shared SEVERITY constant stays
// 'warning'; doc-preflight exits non-zero only for CRITICAL. There is no baseline. Only files added/renamed against the merge base (plus
// untracked, non-ignored files) are examined, so existing files are never reported.
//
// Deliberate scope choices (ADR-118 amendment 1): generated homes are not reported (a new
// feature's generated design page is expected); metadata is asked only of METADATA_KINDS
// (instructions, templates, archive, records and generated views keep their own formats).
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
// What is asked of a document comes from docs/governance/DOCUMENT-KINDS.json, tuned to the
// shapes that really exist (ADR-118 amendment 2): required fields per kind (policy.requiredFields),
// the status/doc_type values each kind really uses (policy.vocabulary, on top of the global
// lifecycle lists), the kinds that start a new subject (policy.priorArtKinds) and rules marked
// priorArt:false for multi-document bundles. 'tolerated' homes (active practice with no matrix
// write home yet) are neither flagged for placement nor asked for metadata.
const NON_WRITE_HOMES = new Set(['legacy', 'frozen', 'local', 'unclassified'])
const INDEX_FILE = /(^|\/)(README|index)\.md$/i

function allowed(policy, kind, field, value) {
  const set = field === 'status' ? 'statuses' : 'docTypes'
  const v = String(value).toLowerCase()
  return policy[set].has(v) || Boolean(policy.vocabulary.get(kind)?.[set]?.has(v))
}

export const CRITICAL_NOTE =
  'CRITICAL (ADR-118 amendment 3, delegated product-owner decision): this legacy home takes no new documents. ' +
  'Only files added or renamed into the home against the merge base are examined; existing files are never reported.'

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

// A prior_art entry is a repo path, optionally followed by a comment; paths may contain spaces.
function priorArtCandidates(parsed) {
  const raw = parsed?.lists?.prior_art || (parsed?.fields?.prior_art ? [parsed.fields.prior_art] : [])
  return raw.map((entry) => {
    const whole = String(entry).replace(/[`'"]/g, '').replace(/\s+(#|—|--).*$/, '').trim()
    return { whole, first: whole.split(/\s+/)[0] }
  }).filter((c) => c.whole)
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
    // A rename inside one home is the same document under another name, not a new one. "Same home"
    // means the same policy rule, so a rename between different legacy directories (.agent/ to
    // agent/, docs/superpowers/specs/ to docs/superpowers/plans/) is a move into another home and
    // is examined.
    if (entry.status === 'R' && entry.from) {
      const was = classifyPath(policy, entry.from)
      if (was.rule === here.rule && was.rule !== -1) continue
    }
    if (NON_WRITE_HOMES.has(here.home) && !here.addAllowed) {
      // Per-finding severity (ADR-118 amendment 3): only an added or renamed-into file in a legacy
      // home that its rule marks enforce:"critical" is CRITICAL; every other finding stays WARNING.
      const severity = here.enforce === 'critical' && here.home === 'legacy' ? 'critical' : SEVERITY
      findings.push({
        severity, check: 'doc-placement', title: `New document in a ${here.home} home: ${file}`,
        details: `Kind ${here.kind} (${here.home}) takes no new documents${here.note ? `: ${here.note}` : ''}. ${severity === 'critical' ? CRITICAL_NOTE : LIMITATION}`,
        files: [file], action: 'Write it in the write home of its kind (ADR-118; docs/governance/DOCUMENT-KINDS.json), or ask the owner to amend the matrix',
      })
      continue
    }
    if (here.home !== 'write') continue
    const text = read(file)
    if (typeof text !== 'string') {
      findings.push({ severity: 'info', check: 'doc-added-files', title: `Added document could not be read: ${file}`, details: `The guards skipped it. ${LIMITATION}`, files: [file], action: '' })
      continue
    }
    const parsed = parseFrontmatter(text)
    const fields = parsed?.fields || {}
    // A README or index file describes its folder; it is not a new subject, so it is exempt from
    // metadata and prior-art (placement above still applies to it).
    const index = INDEX_FILE.test(file)
    const required = policy.requiredFields.get(here.kind)
    if (required && !index) {
      const issues = []
      if (!parsed) issues.push('no frontmatter')
      else {
        // A key with an empty or null value counts as missing.
        const missing = required.filter((key) => !(key in fields) || ['', 'null', '~'].includes(String(fields[key]).trim()))
        if (missing.length) issues.push(`missing ${missing.join(', ')}`)
        if (fields.doc_type && !allowed(policy, here.kind, 'doc_type', fields.doc_type)) issues.push(`doc_type "${fields.doc_type}" is not one this kind uses`)
        if (fields.status && !allowed(policy, here.kind, 'status', fields.status)) issues.push(`status "${fields.status}" is not one this kind uses`)
      }
      if (issues.length) {
        add('doc-metadata', `Added document frontmatter: ${file}`, `Kind ${here.kind}: ${issues.join('; ')}.`, file,
          'Add the required frontmatter (docs/plans/DOCS-ARCHITECTURE-REDESIGN-PROPOSAL-20261113.md section 5.3)')
      }
    }
    if (policy.priorArtKinds.has(here.kind) && here.priorArt && !index) {
      const declared = fields.prior_art || parsed?.lists?.prior_art
      // Typed relations to existing documents are themselves a declaration of what the author found.
      if (!declared && (parsed?.relations?.length || 0) > 0) continue
      if (!declared) {
        add('doc-prior-art', `Added document declares no prior_art: ${file}`,
          'The search-before-write protocol asks a new document to name what it found: typed relations to existing documents, a prior_art list, or none-found with the query used (npm run docs:find). This check verifies the declaration, not that a search happened.',
          file, 'Run npm run docs:find, then add relations or prior_art to the frontmatter')
      } else if (/^none-found\b/i.test(String(fields.prior_art || ''))) {
        if (!/^none-found\b\W*\w/i.test(String(fields.prior_art))) {
          add('doc-prior-art', `prior_art none-found names no query: ${file}`,
            'none-found should be followed by the query that was run (for example: none-found (query "office design receiver")). The check verifies the declaration, not that the search happened.', file,
            'Add the query used with npm run docs:find')
        }
      } else {
        const missing = priorArtCandidates(parsed).filter((c) => !exists(c.whole) && !exists(c.first)).map((c) => c.whole)
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
  // A guard that could not evaluate the diff must never read as a pass. Under CI it is a visible
  // WARNING (a CI checkout has full history, so this means something is wrong); locally it is INFO.
  const skipped = (reason) => [{
    severity: process.env.CI ? 'warning' : 'info', check: 'doc-added-files',
    title: 'Added-document guards NOT EVALUATED (neither a pass nor a failure)',
    details: `${reason}. The legacy-home CRITICAL guard did not run for this change. ${LIMITATION}`, files: [], action: 'Fetch origin/main (full history) and rerun npm run govern',
  }]
  // Nothing in here may throw into doc-preflight: a guard that cannot run is reported, never an error exit.
  try {
    const listed = listAddedDocuments({ git })
    if (!listed.ok) return skipped(listed.reason)
    return evaluateAddedDocuments({ added: listed.added, policy, read, exists })
  } catch (error) {
    return skipped(`unexpected error: ${error?.message || error}`)
  }
}

export { compilePolicy }
