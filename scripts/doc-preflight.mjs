#!/usr/bin/env node
// RWANG doc-preflight — mechanical health checks over docs + code.
// Judgment calls (contradictions of meaning) stay with a human/agent review;
// everything here is checkable from the filesystem, so it runs in CI.
//
// Usage: node scripts/doc-preflight.mjs [--strict]
//   --strict  exit 1 on any CRITICAL finding

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Post-flatten: spec pack and module docs are one tree under ROOT/docs.
const SPEC_PACK = path.join(ROOT, 'docs')
const REPORT = path.join(ROOT, 'docs', '.preflight-report.json')
const GRAPH = path.join(ROOT, 'docs', '.doc-graph.json')

const read = (p) => readFileSync(p, 'utf8')
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')
const findings = []
const add = (severity, check, title, details, files = [], action = '') =>
  findings.push({ id: `${severity[0].toUpperCase()}${findings.length + 1}`, severity, check, title, details, files, action })

function walk(dir, ext, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    if (['node_modules', '.next', '.git'].includes(e)) continue
    const full = path.join(dir, e)
    if (statSync(full).isDirectory()) walk(full, ext, out)
    else if (full.endsWith(ext)) out.push(full)
  }
  return out
}

// ADR-005 §D9 — the imported V1 corpus is read-only evidence: it is not checked for
// control blocks (it never had ours) and its links point at V1 paths that do not
// exist here. 238 findings nobody can act on would drown the real ones.
const V1_DIR = path.join(SPEC_PACK, 'v1-inherited')
// Post-flatten: one docs/ tree. Everything (minus v1-inherited) is scanned once.
const labDocs = walk(path.join(ROOT, 'docs'), '.md').filter((f) => !f.startsWith(V1_DIR))
const specDocs = []
const inherited = walk(V1_DIR, '.md')
const allDocs = labDocs

// ---- Check 1: document control blocks ------------------------------------
for (const f of allDocs) {
  const body = read(f)
  if (path.basename(f).startsWith('ADR-')) {
    if (!/\*\*Status:\*\*/.test(body)) add('warning', 'doc-control', 'ADR without a Status line', path.basename(f), [rel(f)], 'Add **Status:** Accepted|Superseded')
    continue
  }
  // Control data may be a markdown table or YAML frontmatter (live documents
  // that a parser reads, like the roadmap, carry frontmatter instead).
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1] || ''
  const missing = ['Version', 'Status'].filter(
    (k) => !new RegExp(`\\*\\*${k}\\*\\*`).test(body) && !new RegExp(`^${k.toLowerCase()}:`, 'm').test(frontmatter)
  )
  if (missing.length) {
    // The spec pack (ADRs, PRODUCT-V2, replacement/, parity, prompts) predates RWANG doc
    // control — authority, not managed, so a missing block there is info. The actively
    // managed module docs (appendices, features, PRD, FEATURE-MAP) still warn.
    const managed =
      f.includes(`${path.sep}appendices${path.sep}`) ||
      f.includes(`${path.sep}features${path.sep}`) ||
      /^(PRD-SDD|FEATURE-MAP|DB-MIGRATION)/.test(path.basename(f))
    add(managed ? 'warning' : 'info', 'doc-control', `Missing control fields: ${missing.join(', ')}`, path.basename(f), [rel(f)],
      managed ? 'Add the document control table' : 'Inherited spec pack — add a control block at its next revision')
  }
}

// ---- Check 2: broken relative links --------------------------------------
const LINK = /\[[^\]]*\]\(([^)#]+?)(?:#[^)]*)?\)/g
for (const f of allDocs) {
  for (const [, href] of read(f).matchAll(LINK)) {
    if (/^(https?:|mailto:)/.test(href)) continue
    const target = path.resolve(path.dirname(f), href)
    if (!existsSync(target)) {
      add('warning', 'cross-reference', `Broken link → ${href}`, `in ${path.basename(f)}`, [rel(f)], 'Fix the path or remove the link')
    }
  }
}

// ---- Check 3: requirement coverage (from the doc graph) ------------------
if (!existsSync(GRAPH)) {
  add('critical', 'doc-graph', 'No document graph', 'docs/.doc-graph.json is missing', [], 'Run npm run docs:graph')
} else {
  const g = JSON.parse(read(GRAPH))
  const cov = g.stats.coverage
  if (cov.fr_without_code?.length) {
    add('critical', 'requirement-coverage', 'Functional requirements with no code anchor', cov.fr_without_code.join(', '), [], 'Add @req annotations or mark the FR as planned')
  }
  if (cov.fr_without_tests?.length) {
    add('warning', 'requirement-coverage', 'Functional requirements with no test path', cov.fr_without_tests.join(', '), [], 'Add @tested or name the FR inside a test')
  }
  if (g.stats.dangling_edges > 0) {
    add('warning', 'doc-code-symlink', 'Annotations pointing at unknown nodes', `${g.stats.dangling_edges} dangling edge(s)`, [], 'Fix the @req/@tested target')
  }
  // Requirement ids used in code but never declared in the PRD registry.
  const declared = new Set(g.nodes.filter((n) => n.type === 'requirement').map((n) => n.id.slice(4)))
  const used = new Set()
  for (const n of g.nodes.filter((n) => n.type === 'code_file')) {
    for (const list of Object.values(n.annotations || {})) {
      for (const v of list) if (/^(FR|NFR|BR|SEC|SDD)-\d{3}$/.test(v)) used.add(v)
    }
  }
  const undocumented = [...used].filter((id) => !declared.has(id))
  if (undocumented.length) {
    add('critical', 'requirement-coverage', 'Requirement ids referenced in code but not declared', undocumented.join(', '), [], 'Declare them in the PRD registry')
  }
  // ID sequence gaps per family.
  const byFamily = {}
  for (const id of declared) {
    const [fam, num] = id.split('-')
    ;(byFamily[fam] ||= []).push(Number(num))
  }
  for (const [fam, nums] of Object.entries(byFamily)) {
    const sorted = nums.sort((a, b) => a - b)
    const gaps = []
    for (let i = sorted[0]; i < sorted[sorted.length - 1]; i++) if (!sorted.includes(i)) gaps.push(`${fam}-${String(i).padStart(3, '0')}`)
    if (gaps.length) add('info', 'requirement-coverage', `Gaps in ${fam} numbering`, gaps.join(', '), [], 'Intentional gaps are fine — confirm nothing was lost')
  }

  // Lineage integrity — a doc marked superseded must carry a successor edge, so
  // "what replaced it" is answerable from the graph (RWANG lineage guard).
  for (const n of (g.nodes || []).filter((n) => n.status === 'superseded' || /supersed/i.test(n.doc_status || ''))) {
    if (!(g.edges || []).some((e) => e.to === n.id && e.type === 'supersedes')) {
      add('warning', 'lineage', 'Superseded doc without a successor edge', n.id, [n.path].filter(Boolean), 'Add **Superseded by:** [X](X.md) so the graph records what replaced it')
    }
  }
}

// ---- Check 4: superseded documents still cited as current ----------------
const superseded = allDocs.filter((f) => /\*\*Status:?\*\*[^\n]*supersed|\| \*\*Status\*\* \| Superseded/i.test(read(f)))
for (const s of superseded) {
  const name = path.basename(s)
  for (const f of allDocs) {
    if (f === s) continue
    const body = read(f)
    if (!body.includes(name)) continue
    // A superseded doc may legitimately cite another superseded doc (that is
    // history); a current doc is fine as long as it names the replacement.
    if (superseded.includes(f)) continue
    const cited = body.split('\n').filter((l) => l.includes(name))
    const flagged = /ADR-003/.test(body) || cited.every((l) => /supersede|แทน|ยกเลิก|cancelled|previous|earlier|เดิม/i.test(l))
    if (!flagged) {
      add('warning', 'contradiction', `Superseded doc cited without a marker: ${name}`, `cited in ${path.basename(f)}`, [rel(f)], `Mark the reference as superseded or point at the replacement`)
    }
  }
}

// ---- Check 5: appendix drift vs the real code ---------------------------
const routeFiles = walk(path.join(ROOT, 'src', 'app', 'api'), 'route.js')
const routes = routeFiles.map((f) => '/' + rel(f).replace(/^src\/app\//, '').replace(/\/route\.js$/, ''))
const apiSpec = path.join(ROOT, 'docs', 'appendices', 'A-api-spec.md')
if (existsSync(apiSpec)) {
  const body = read(apiSpec)
  const missing = routes.filter((r) => !body.includes(r.replace(/\[(\w+)\]/g, '[$1]')) && !body.includes(r.replace(/\/\[\w+\]/g, '')))
  if (missing.length) {
    add('warning', 'staleness', 'API appendix does not list every route', missing.join(', '), ['docs/appendices/A-api-spec.md'], 'Add the new endpoints to Appendix A')
  }
}
const schema = path.join(ROOT, 'prisma', 'schema.prisma')
const dbSpec = path.join(ROOT, 'docs', 'appendices', 'B-db-schema.md')
if (existsSync(schema) && existsSync(dbSpec)) {
  const models = [...read(schema).matchAll(/^model\s+(\w+)/gm)].map((m) => m[1])
  const body = read(dbSpec)
  const missing = models.filter((m) => !body.includes(m))
  if (missing.length) {
    add('warning', 'staleness', 'DB appendix is missing models', missing.join(', '), ['docs/appendices/B-db-schema.md'], 'Add the models to Appendix B')
  }
}

// ---- Check 6: numeric claims that go stale ------------------------------
const testCount = walk(path.join(ROOT, 'tests'), '.test.js').length + walk(path.join(ROOT, 'tests'), '.spec.js').length
const claimPattern = /(\d+)\s*(?:Vitest|vitest)[^\n]{0,40}?(\d+)?\s*(?:Playwright|playwright)?/g
for (const f of allDocs) {
  const body = read(f)
  for (const line of body.split('\n')) {
    const m = line.match(/(\d+)\s*(?:unit\/integration|Vitest)\b/i)
    if (m && Number(m[1]) < 100 && /test/i.test(line)) {
      add('info', 'staleness', 'Possibly stale test count', `"${line.trim().slice(0, 110)}"`, [rel(f)], `Current suite: 129 Vitest + 28 Playwright across ${testCount} files`)
    }
  }
}

// ---- Output --------------------------------------------------------------
const counts = findings.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] || 0) + 1 }), {})
const report = {
  version: '2.0.0',
  generated_by: 'scripts/doc-preflight.mjs (rwang:doc-preflight)',
  scanned: { docs: allDocs.length, v1_inherited: inherited.length, routes: routes.length, test_files: testCount },
  summary: {
    critical: counts.critical || 0,
    warning: counts.warning || 0,
    info: counts.info || 0,
    overall: counts.critical ? 'CRITICAL' : counts.warning ? 'WARN' : 'PASS',
  },
  trust_hierarchy: 'code > SDD > PRD — when they disagree, the downstream artefact wins',
  findings,
}
writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n')

console.log(`docs ${allDocs.length} (+${inherited.length} v1-inherited, unchecked) · routes ${routes.length} · test files ${testCount}`)
console.log(`critical ${report.summary.critical} · warning ${report.summary.warning} · info ${report.summary.info} → ${report.summary.overall}`)
for (const f of findings) console.log(`  [${f.severity.toUpperCase()}] ${f.check}: ${f.title} — ${f.details}`)

if (process.argv.includes('--strict') && report.summary.critical > 0) process.exit(1)
