#!/usr/bin/env node
// RWANG doc-graph — build docs/.doc-graph.json + appendices/D-traceability.md
// by scanning the real docs, source annotations and tests. Hand-maintained
// graphs drift the moment code lands; this one is regenerated from the files.
//
// Usage: node scripts/doc-graph.mjs [--check]
//   --check  exit 1 if the committed graph differs from a fresh scan (CI guard)

import { createHash } from 'crypto'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPEC_PACK = path.resolve(ROOT, '..', 'docs')
const GRAPH_PATH = path.join(ROOT, 'docs', '.doc-graph.json')
const MATRIX_PATH = path.join(ROOT, 'docs', 'appendices', 'D-traceability.md')
const FEATURE_MAP_PATH = path.join(ROOT, 'docs', 'FEATURE-MAP.md')

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'test-results', 'playwright-report', 'migrations'])

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8)
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, exts, out)
    else if (exts.some((e) => entry.endsWith(e))) out.push(full)
  }
  return out
}

const read = (p) => readFileSync(p, 'utf8')

// ---------------------------------------------------------------- documents
const DOC_TITLE = /^#\s+(.+)$/m
const STATUS_ROW = /\|\s*\*\*Status\*\*\s*\|\s*([^|]+)\|/
const VERSION_ROW = /\|\s*\*\*Version\*\*\s*\|\s*([^|]+)\|/

function docNode(file, type, idPrefix) {
  const body = read(file)
  const title = (body.match(DOC_TITLE) || [, path.basename(file, '.md')])[1].trim()
  const status = (body.match(STATUS_ROW) || [, ''])[1].trim()
  const version = (body.match(VERSION_ROW) || [, ''])[1].trim()
  return {
    id: `${idPrefix}:${path.basename(file, '.md')}`,
    type,
    path: rel(file),
    title,
    ...(version ? { version } : {}),
    ...(status ? { doc_status: status } : {}),
    hash: hash(body),
    status: /superseded|cancelled/i.test(status) ? 'superseded' : 'current',
  }
}

// ------------------------------------------------------------- requirements
// Registry rows live in the PRD's tables. Parsed line by line — a regex that
// can cross newlines silently swallows every second row of a 2-column table.
const REQ_ID = /^(FR|NFR|BR|SEC|SDD)-\d{3}$/

function requirementNodes(prdPath) {
  const body = read(prdPath)
  const nodes = []
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map((c) => c.trim())
    const id = cells[1]
    if (!id || !REQ_ID.test(id)) continue
    if (nodes.some((n) => n.id === `req:${id}`)) continue
    const label = (cells[2] || '').replace(/\s+/g, ' ').trim()
    const marker = cells.slice(3).join(' ')
    nodes.push({
      id: `req:${id}`,
      type: 'requirement',
      family: id.split('-')[0],
      label,
      defined_in: rel(prdPath),
      // ✅/🔜 only appear in the FR registry; other families carry evidence text.
      declared: marker.includes('✅') ? 'done' : marker.includes('🔜') ? 'planned' : 'n/a',
      status: marker.includes('🔜') ? 'planned' : 'current',
    })
  }
  return nodes
}

// -------------------------------------------------------------- annotations
const ANNOTATION = /@(req|spec|tested|designs)\s+([^\n]*)/g
const ID_LIST = /(?:FR|NFR|BR|SEC|SDD)-\d{3}/g

function annotationsOf(body) {
  const found = { req: [], spec: [], tested: [], designs: [] }
  for (const [, kind, rest] of body.matchAll(ANNOTATION)) {
    if (kind === 'tested' || kind === 'designs') {
      // "a.test.js, b.test.js (7 view tests) — note" → ["a.test.js", "b.test.js"]
      const head = rest.split('—')[0].replace(/\([^)]*\)/g, '').trim()
      for (const t of head.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!found[kind].includes(t)) found[kind].push(t)
      }
    } else {
      for (const id of rest.match(ID_LIST) || []) if (!found[kind].includes(id)) found[kind].push(id)
      // non-ID @spec targets (e.g. a doc path) are kept as references
      const head = rest.split('—')[0].trim()
      if (kind === 'spec' && head.endsWith('.md') && !found.spec.includes(head)) found.spec.push(head)
    }
  }
  return found
}

// --------------------------------------------------------------------- scan
function build() {
  const nodes = []
  const edges = []
  const addEdge = (from, to, type, source) => {
    if (!edges.some((e) => e.from === from && e.to === to && e.type === type)) {
      edges.push({ from, to, type, status: 'current', source })
    }
  }

  // Documents: lab docs, appendices, roadmap, and the governing spec pack.
  const labDocs = walk(path.join(ROOT, 'docs'), ['.md'])
  for (const file of labDocs) {
    const isAppendix = file.includes(`${path.sep}appendices${path.sep}`)
    const isRoadmap = file.includes(`${path.sep}roadmap${path.sep}`)
    nodes.push(docNode(file, isAppendix ? 'appendix' : isRoadmap ? 'roadmap' : 'document', 'doc'))
  }
  const V1_DIR = path.join(SPEC_PACK, 'v1-inherited')
  for (const file of walk(SPEC_PACK, ['.md'])) {
    if (file.startsWith(V1_DIR)) continue // handled below, as evidence not authority
    const node = docNode(file, path.basename(file).startsWith('ADR-') ? 'adr' : 'spec', 'spec')
    node.path = path.relative(path.resolve(ROOT, '..'), file).split(path.sep).join('/')
    nodes.push(node)
  }
  // ADR-005 — V1's imported corpus. Indexed so a V2 document can cite an inherited
  // file and have the reference validated, but kept out of coverage and drift: it
  // is evidence of what V1 says, not a V2 artefact anyone maintains.
  for (const file of walk(V1_DIR, ['.md'])) {
    nodes.push({
      id: `v1:${path.relative(V1_DIR, file).split(path.sep).join('/')}`,
      type: 'v1_inherited',
      path: path.relative(path.resolve(ROOT, '..'), file).split(path.sep).join('/'),
      status: 'read-only',
    })
  }

  // Requirements from the PRD registry.
  const prd = path.join(ROOT, 'docs', 'PRD-SDD-v1.0.md')
  const reqs = requirementNodes(prd)
  nodes.push(...reqs)
  for (const r of reqs) addEdge(r.id, 'doc:PRD-SDD-v1.0', 'specifies', 'prd-registry')

  // Tests first, so @tested names can be resolved to real test nodes.
  const testFiles = walk(path.join(ROOT, 'tests'), ['.test.js', '.spec.js'])
  for (const file of testFiles) {
    const body = read(file)
    nodes.push({ id: `test:${rel(file)}`, type: 'test', path: rel(file), hash: hash(body), status: 'current' })
    // A requirement id named inside a test verifies it directly.
    for (const r of new Set(body.match(ID_LIST) || [])) addEdge(`test:${rel(file)}`, `req:${r}`, 'verifies', 'test-reference')
  }
  const testNodes = nodes.filter((n) => n.type === 'test')
  const resolveTest = (name) => {
    const want = name.split('::')[0].trim()
    const hit = testNodes.find((t) => t.path === want || t.path.endsWith(`/${want}`) || t.path.includes(want))
    return hit ? hit.id : `test:${want}`
  }

  // Code + annotations (seed lives outside src but carries FR-016).
  const codeFiles = [...walk(path.join(ROOT, 'src'), ['.js', '.jsx']), ...walk(path.join(ROOT, 'prisma'), ['.js'])]
  for (const file of codeFiles) {
    const body = read(file)
    const ann = annotationsOf(body)
    const annotated = ann.req.length + ann.spec.length + ann.tested.length > 0
    if (!annotated) continue
    const id = `code:${rel(file)}`
    nodes.push({
      id,
      type: 'code_file',
      path: rel(file),
      hash: hash(body),
      status: 'current',
      annotations: {
        ...(ann.req.length ? { '@req': ann.req } : {}),
        ...(ann.spec.length ? { '@spec': ann.spec } : {}),
        ...(ann.tested.length ? { '@tested': ann.tested } : {}),
      },
    })
    for (const r of ann.req) addEdge(id, `req:${r}`, 'implements', 'annotation')
    for (const s of ann.spec) {
      // @spec points at a design decision or constraint, not a feature.
      if (s.endsWith('.md')) addEdge(id, `doc:${path.basename(s, '.md')}`, 'references', 'annotation')
      else addEdge(id, `req:${s}`, 'follows', 'annotation')
    }
    for (const t of ann.tested) addEdge(resolveTest(t), id, 'tests', 'annotation')
  }

  // Transitive verification: test → tests → code → implements → requirement.
  // Written explicitly so the traceability matrix shows how a requirement is
  // actually covered, instead of demanding that tests repeat requirement ids.
  for (const t of edges.filter((e) => e.type === 'tests')) {
    for (const i of edges.filter((e) => e.from === t.to && (e.type === 'implements' || e.type === 'follows'))) {
      addEdge(t.from, i.to, 'verifies', 'transitive')
    }
  }

  // Drop edges pointing at nodes that do not exist (e.g. @tested with a bare
  // filename): rewrite them onto the real test path when unambiguous.
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const testPaths = nodes.filter((n) => n.type === 'test')
  const resolved = []
  const dangling = []
  for (const e of edges) {
    let { from, to } = e
    if (!byId.has(from) && from.startsWith('test:')) {
      const want = from.slice(5)
      const hit = testPaths.find((t) => t.path === want || t.path.endsWith(`/${want}`) || t.path.includes(want))
      if (hit) from = hit.id
    }
    if (byId.has(from) && byId.has(to)) resolved.push({ ...e, from, to })
    else dangling.push({ ...e, reason: !byId.has(from) ? `unknown node ${from}` : `unknown node ${to}` })
  }

  return { nodes, edges: resolved, dangling }
}

// ------------------------------------------------------------------ outputs
// Coverage is family-aware on purpose:
//   FR  — must be implemented by code and verified by a test
//   BR/SEC/SDD — constraints and design decisions; code *follows* them
//   NFR — properties evidenced by the acceptance matrix, not linked to one file
function coverage(nodes, edges) {
  const reqs = nodes.filter((n) => n.type === 'requirement')
  const linked = (r, types) => edges.some((e) => e.to === r.id && types.includes(e.type))
  const pct = (n, d) => `${d ? Math.round((n / d) * 100) : 0}% (${n}/${d})`

  const fr = reqs.filter((r) => r.family === 'FR')
  const frImpl = fr.filter((r) => linked(r, ['implements']))
  const frTest = fr.filter((r) => linked(r, ['verifies']))
  const rules = reqs.filter((r) => ['BR', 'SEC', 'SDD'].includes(r.family))
  const rulesLinked = rules.filter((r) => linked(r, ['follows', 'implements', 'verifies']))
  const nfr = reqs.filter((r) => r.family === 'NFR')

  return {
    requirements: reqs.length,
    fr_with_code: pct(frImpl.length, fr.length),
    fr_with_tests: pct(frTest.length, fr.length),
    rules_anchored_in_code: pct(rulesLinked.length, rules.length),
    nfr_evidence_based: `${nfr.length} (verified by the acceptance matrix, not code-linked)`,
    annotated_code_files: nodes.filter((n) => n.type === 'code_file').length,
    fr_without_code: fr.filter((r) => !frImpl.includes(r)).map((r) => r.id.slice(4)),
    fr_without_tests: fr.filter((r) => !frTest.includes(r)).map((r) => r.id.slice(4)),
    rules_without_anchor: rules.filter((r) => !rulesLinked.includes(r)).map((r) => r.id.slice(4)),
  }
}

function matrix(nodes, edges, cov) {
  const short = (id) => `\`${id.replace(/^(code|test):/, '').replace(/^src\/|^tests\//, '')}\``
  const section = (family, heading, linkTypes, note) => {
    const reqs = nodes
      .filter((n) => n.type === 'requirement' && family.includes(n.family))
      .sort((a, b) => a.id.localeCompare(b.id))
    const rows = reqs.map((r) => {
      const impl = edges.filter((e) => e.to === r.id && linkTypes.includes(e.type)).map((e) => short(e.from))
      const tests = edges.filter((e) => e.to === r.id && e.type === 'verifies').map((e) => short(e.from))
      const state = impl.length === 0 ? '🔴 no anchor' : tests.length === 0 ? '🟠 no test' : '✅'
      return `| ${r.id.slice(4)} | ${r.label} | ${impl.join(', ') || '—'} | ${tests.join(', ') || '—'} | ${state} |`
    })
    return `## ${heading}\n\n${note}\n\n| ID | Statement | Anchored in | Verified by | State |\n|---|---|---|---|---|\n${rows.join('\n')}\n`
  }

  return `# Appendix D — Traceability Matrix

| Field | Value |
|-------|-------|
| **Version** | 2.0.0 |
| **Status** | Auto-generated |
| **Generator** | \`scripts/doc-graph.mjs\` (RWANG doc-graph) |

> Regenerate with \`npm run docs:graph\`; \`npm run docs:check\` fails if this file
> is stale. Do not hand-edit — every row is derived from \`@req\`/\`@spec\`/\`@tested\`
> annotations in the source, from requirement ids named inside tests, and from
> transitive test → code → requirement paths.

**Coverage** — FR with code **${cov.fr_with_code}** · FR with tests **${cov.fr_with_tests}** ·
rules anchored in code **${cov.rules_anchored_in_code}** · annotated source files **${cov.annotated_code_files}**

${section(['FR'], 'Functional requirements', ['implements'], 'Each FR must have code that declares `@req` and a test that reaches it.')}
${section(['BR', 'SEC', 'SDD'], 'Business rules, security rules and design decisions', ['follows', 'implements'], 'Anchored by `@spec` in the code that enforces them.')}
${section(['NFR'], 'Non-functional requirements', ['implements', 'follows'], 'Evidenced by the acceptance matrix in `.agent/reports/FINAL.md` (build output, e2e runs, determinism tests) rather than by a single file.')}`
}

// -------------------------------------------------------- FEATURE-MAP.md
// One generated index: feature → module → where it came from → status → code →
// tests → design doc → roadmap task. Once V1 modules are lifted in, the
// "source" column doubles as the cutover dashboard.
function featureMap(nodes, edges) {
  const short = (id) => id.replace(/^(code|test):/, '').replace(/^src\/|^tests\//, '')
  const moduleOf = (p) =>
    /modules\/([^/]+)\//.exec(p)?.[1] || (p.startsWith('prisma/') ? 'seed' : 'shell')

  // Feature docs declare which feature they explain via frontmatter.
  const featureDocs = new Map()
  for (const f of walk(path.join(ROOT, 'docs', 'features'), ['.md'])) {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(f))?.[1] || ''
    const id = /^feature:\s*(\S+)/m.exec(fm)?.[1]
    if (id) featureDocs.set(id, { path: rel(f), source: /^source:\s*(\S+)/m.exec(fm)?.[1] || 'v2-native' })
  }

  // Roadmap rows that name a requirement id own that feature's delivery.
  const tasks = new Map()
  for (const f of walk(path.join(ROOT, 'docs', 'roadmap'), ['.md'])) {
    for (const line of read(f).split(/\r?\n/)) {
      if (!line.startsWith('|')) continue
      const taskId = line.split('|')[1]?.trim()
      if (!/^TASK-/.test(taskId)) continue
      for (const req of line.match(ID_LIST) || []) {
        if (!tasks.has(req)) tasks.set(req, taskId)
      }
    }
  }

  const rows = nodes
    .filter((n) => n.type === 'requirement' && n.family === 'FR')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => {
      const fid = r.id.slice(4)
      const code = edges.filter((e) => e.to === r.id && e.type === 'implements').map((e) => short(e.from))
      const tests = edges.filter((e) => e.to === r.id && e.type === 'verifies').length
      const doc = featureDocs.get(fid)
      const modules = [...new Set(code.map(moduleOf))].join(', ') || '—'
      const status = code.length === 0 ? '🔜 planned' : r.declared === 'planned' ? '🟠 built, not declared' : '✅ live'
      const head = code.length > 2 ? `\`${code[0]}\` +${code.length - 1}` : code.map((c) => `\`${c}\``).join(', ') || '—'
      return `| ${fid} | ${r.label} | ${modules} | ${doc?.source || 'v2-native'} | ${status} | ${head} | ${tests} | ${doc ? `[doc](${doc.path.replace('docs/', '')})` : '—'} | ${tasks.get(fid) || '—'} |`
    })

  return `# Feature Map

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Auto-generated |
| **Generator** | \`scripts/doc-graph.mjs\` (RWANG doc-graph) |

> One index for every feature: what it is, which module owns it, whether it is
> V2-native or lifted from V1, and where its code, tests, design note and delivery
> task live. Regenerate with \`npm run docs:graph\` — never hand-edit.
>
> **Source** is the cutover dashboard: \`v2-native\` (built here), \`lifted-from-v1\`
> (V1 UI reused per ADR-003), \`pending\` (not moved yet).

| ID | Feature | Module | Source | Status | Code | Tests | Design note | Task |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

Design notes live in \`docs/features/\` and declare their feature in frontmatter
(\`feature: FR-020\`), so moving or renaming a note never breaks this table — the
link is keyed by requirement id, not by path (AGENTS.md §18).
`
}

// -------------------------------------------------------------------- main
const previous = existsSync(GRAPH_PATH) ? JSON.parse(read(GRAPH_PATH)) : null
const { nodes, edges, dangling } = build()

// Drift: a node whose hash changed since the last committed graph.
const prevHash = new Map((previous?.nodes || []).map((n) => [n.id, n.hash]))
const changed = nodes.filter((n) => n.hash && prevHash.has(n.id) && prevHash.get(n.id) !== n.hash)
const added = nodes.filter((n) => !prevHash.has(n.id))
const removed = (previous?.nodes || []).filter((n) => !nodes.some((x) => x.id === n.id))
for (const n of changed) n.status = 'changed'

const cov = coverage(nodes, edges)
const graph = {
  version: '2.0.0',
  generated_by: 'scripts/doc-graph.mjs (rwang:doc-graph)',
  generated_from: 'filesystem scan — do not hand-edit',
  stats: {
    total_nodes: nodes.length,
    total_edges: edges.length,
    dangling_edges: dangling.length,
    node_types: nodes.reduce((a, n) => ({ ...a, [n.type]: (a[n.type] || 0) + 1 }), {}),
    coverage: cov,
  },
  drift: {
    changed: changed.map((n) => n.id),
    added: added.map((n) => n.id),
    removed: removed.map((n) => n.id),
  },
  nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
  edges: edges.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to)),
  dangling_edges: dangling,
}

const serialized = JSON.stringify(graph, null, 2) + '\n'

if (process.argv.includes('--check')) {
  const current = existsSync(GRAPH_PATH) ? read(GRAPH_PATH) : ''
  const normalise = (s) => s.replace(/"generated_at":\s*"[^"]*",?\n?/g, '')
  if (normalise(current) !== normalise(serialized)) {
    console.error('doc-graph is stale — run: npm run docs:graph')
    process.exit(1)
  }
  console.log('doc-graph is up to date')
  process.exit(0)
}

writeFileSync(GRAPH_PATH, serialized)
writeFileSync(MATRIX_PATH, matrix(nodes, edges, cov))
writeFileSync(FEATURE_MAP_PATH, featureMap(nodes, edges))

console.log(`nodes ${nodes.length} · edges ${edges.length} · dangling ${dangling.length}`)
console.log(`FR with code ${cov.fr_with_code} · FR with tests ${cov.fr_with_tests} · rules anchored ${cov.rules_anchored_in_code}`)
if (cov.fr_without_code.length) console.log(`FR without code: ${cov.fr_without_code.join(', ')}`)
if (cov.fr_without_tests.length) console.log(`FR without tests: ${cov.fr_without_tests.join(', ')}`)
if (cov.rules_without_anchor.length) console.log(`rules with no code anchor: ${cov.rules_without_anchor.join(', ')}`)
if (dangling.length) console.log(`dangling edges:\n  ${dangling.map((d) => `${d.from} → ${d.to} (${d.reason})`).join('\n  ')}`)
if (added.length) console.log(`new nodes: ${added.length}`)
if (changed.length) console.log(`changed nodes: ${changed.length}`)
if (removed.length) console.log(`removed nodes: ${removed.map((n) => n.id).join(', ')}`)
