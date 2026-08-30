#!/usr/bin/env node
// RWANG doc-preflight — mechanical health checks over docs + code.
// Judgment calls (contradictions of meaning) stay with a human/agent review;
// everything here is checkable from the filesystem, so it runs in CI.
//
// Usage: node scripts/doc-preflight.mjs [--strict]
//   --strict  exit 1 on any CRITICAL finding

import { writeFileSync, readdirSync, statSync, existsSync } from 'fs'
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { readCanonical } from './canonical-text.mjs'
import { collectDeclared } from './id-anchors.mjs'
import { evaluateIdStability } from './id-stability.mjs'
import { findBrokenEvidence } from './roadmap-evidence.mjs'
import { findUncoveredRequirements } from './roadmap-coverage.mjs'
import { GIT_ARGS, evaluateUntrackedDocs } from './untracked-docs.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Post-flatten: spec pack and module docs are one tree under ROOT/docs.
const SPEC_PACK = path.join(ROOT, 'docs')
const REPORT = path.join(ROOT, 'docs', '.preflight-report.json')
const GRAPH = path.join(ROOT, 'docs', '.doc-graph.json')

// Canonical for the same reason as doc-graph's reader: a CRLF checkout leaves a
// trailing \r on every line-anchored capture, so control-block and link checks
// must not depend on how git materialized the file.
const read = readCanonical
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

// Tombstone guard (ADR-024): the legacy-project mirror once lived at
// docs/v1-inherited/ and may still exist on old checkouts. Never scan it.
const V1_DIR = path.join(SPEC_PACK, 'v1-inherited')
// docs/archive/ is a cold store — frozen records keep their original links and
// are exempt from every live-tree check, like the legacy mirror before it.
const ARCHIVE_DIR = path.join(SPEC_PACK, 'archive')
const labDocs = walk(path.join(ROOT, 'docs'), '.md').filter((f) => !f.startsWith(V1_DIR) && !f.startsWith(ARCHIVE_DIR))
const specDocs = []
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
    // The spec pack (ADRs, PRODUCT, prompts) predates RWANG doc
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

  // Duplicate-id guard. Ids are hand-picked, so two concurrent sessions can both
  // take "the next number" — that is exactly how two ADR-020s were filed on
  // 2026-08-15/16 and someone had to renumber one after the fact. An id claimed
  // by two documents is a CRITICAL: it breaks the key contract (AGENTS.md §18)
  // that every plan, annotation and test relies on.
  {
    const claims = new Map() // id → [files]
    const claim = (id, file) => {
      if (!claims.has(id)) claims.set(id, [])
      claims.get(id).push(rel(file))
    }
    for (const f of allDocs) {
      const base = path.basename(f)
      const adr = /^ADR-(\d{3})/.exec(base)
      if (adr) claim(`ADR-${adr[1]}`, f)
      // Stage artifacts of a CR (ZV2-CR-001-W0-INVENTORY.md) belong to it and
      // are not competing claims on the id.
      const cr = /^ZV2-CR-(\d{3})-(?!W\d+-)/.exec(base)
      if (cr) claim(`ZV2-CR-${cr[1]}`, f)
      // A feature note claims its FR; plans and briefs citing the id do not.
      if (f.includes(`${path.sep}features${path.sep}`)) {
        const fr = /^(FR-\d{3})/.exec(base)
        if (fr) claim(fr[1], f)
      }
    }
    for (const [id, holders] of claims) {
      if (holders.length > 1) {
        add('critical', 'id-uniqueness', `${id} is claimed by ${holders.length} documents`, holders.join(' · '), holders,
          'Ids are immutable keys — the later claimant takes the next free number (AGENTS.md §18)')
      }
    }
  }

  // Generated-view blindness guard. A generated index is only trustworthy if it
  // actually saw its inputs: when the FEATURE-MAP generator's discovery broke, the
  // map regenerated "successfully" with every note link blank, and nothing
  // noticed — generated guarantees consistency with the generator, not with the
  // world. Assert the map cites every feature note that exists on disk.
  {
    const mapPath = path.join(SPEC_PACK, 'FEATURE-MAP.md')
    if (existsSync(mapPath)) {
      const map = read(mapPath)
      const blind = []
      for (const f of allDocs) {
        if (!f.includes(`${path.sep}features${path.sep}`)) continue
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(f))?.[1] || ''
        if (!/^feature:\s*\S+/m.test(fm)) continue
        const relPath = rel(f).replace(/^docs\//, '')
        if (!map.includes(relPath)) blind.push(rel(f))
      }
      if (blind.length) {
        add('critical', 'generated-view', `FEATURE-MAP is blind to ${blind.length} feature note(s) that exist on disk`, blind.join(' · '), blind,
          'The generator\'s discovery is broken or the map is stale — fix scripts/doc-graph.mjs and rerun docs:graph')
      }
    }
    // Same assertion for the other generated views: DOMAIN-MAP must cite every
    // domain directory; TRACE must cite every FR in the registry; FEAT ids in
    // the FEATURES registry must be unique and bundle only declared FRs.
    const domainMapPath = path.join(SPEC_PACK, 'DOMAIN-MAP.md')
    const domainsDir = path.join(SPEC_PACK, 'domains')
    if (existsSync(domainMapPath) && existsSync(domainsDir)) {
      const dm = read(domainMapPath)
      for (const entry of readdirSync(domainsDir)) {
        if (!statSync(path.join(domainsDir, entry)).isDirectory()) continue
        if (!dm.includes(`## ${entry}`)) {
          add('critical', 'generated-view', `DOMAIN-MAP is blind to domain "${entry}"`, 'the generator did not see a domain that exists on disk', [],
            'Fix scripts/doc-views.mjs discovery and rerun docs:graph')
        }
      }
    }
    const tracePath = path.join(SPEC_PACK, 'TRACE.md')
    if (existsSync(tracePath) && existsSync(GRAPH)) {
      const trace = read(tracePath)
      const g = JSON.parse(read(GRAPH))
      const missing = g.nodes
        .filter((n) => n.type === 'requirement' && n.family === 'FR')
        .map((n) => n.id.slice(4))
        .filter((fid) => !trace.includes(`### ${fid} `))
      if (missing.length) {
        add('critical', 'generated-view', `TRACE is blind to ${missing.length} FR(s)`, missing.join(', '), [],
          'Fix scripts/doc-views.mjs and rerun docs:graph')
      }
    }
    const featPath = path.join(SPEC_PACK, 'FEATURES.md')
    if (existsSync(featPath)) {
      const seen = new Map()
      const declaredFr = existsSync(GRAPH)
        ? new Set(JSON.parse(read(GRAPH)).nodes.filter((n) => n.type === 'requirement').map((n) => n.id.slice(4)))
        : null
      for (const line of read(featPath).split('\n')) {
        const m = /^\|\s*(FEAT-\d{3})\s*\|[^|]*\|\s*([^|]*)\|/.exec(line)
        if (!m) continue
        const [, fid, frs] = m
        seen.set(fid, (seen.get(fid) || 0) + 1)
        if (declaredFr) {
          for (const fr of frs.match(/FR-\d{3}/g) || []) {
            if (!declaredFr.has(fr)) {
              add('critical', 'id-uniqueness', `${fid} bundles ${fr}, which is not declared in the PRD registry`, 'features bundle real requirements only', ['docs/FEATURES.md'],
                'Declare the FR first, then bundle it')
            }
          }
        }
      }
      for (const [fid, n] of seen) {
        if (n > 1) add('critical', 'id-uniqueness', `${fid} appears ${n} times in the FEATURES registry`, 'feature ids are immutable keys', ['docs/FEATURES.md'], 'The later row takes the next free number')
      }
    }
  }

  // Module ↔ charter guard. src/modules/ is enumerated from the filesystem — the
  // stale hand-written module list in CLAUDE.md is exactly how two modules ended
  // up in no domain's lane. Every module must be claimed by exactly one charter
  // (charter frontmatter: `modules:`; a charter with no list claims the module
  // matching its folder name).
  {
    const MODULES_DIR = path.join(ROOT, 'src', 'modules')
    const DOMAINS_DIR = path.join(SPEC_PACK, 'domains')
    if (existsSync(MODULES_DIR) && existsSync(DOMAINS_DIR)) {
      const moduleClaims = new Map() // module → [domains]
      for (const entry of readdirSync(DOMAINS_DIR)) {
        const charter = path.join(DOMAINS_DIR, entry, 'CHARTER.md')
        if (!existsSync(charter)) continue
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(charter))?.[1] || ''
        const listed = (/modules:\s*\n((?:\s+-\s+\S+\n?)*)/.exec(fm)?.[1]?.match(/-\s+(\S+)/g) || []).map((x) => x.replace(/-\s+/, ''))
        const claimed = listed.length ? listed : [entry]
        for (const m of claimed) {
          if (!moduleClaims.has(m)) moduleClaims.set(m, [])
          moduleClaims.get(m).push(entry)
        }
      }
      for (const m of readdirSync(MODULES_DIR)) {
        if (!statSync(path.join(MODULES_DIR, m)).isDirectory()) continue
        const owners = moduleClaims.get(m) || []
        if (owners.length === 0) {
          add('critical', 'domain-spine', `src/modules/${m} is in no domain's lane`, 'code with no charter is exactly how work gets lost — a module exists, so a domain owns it', [],
            `Add "${m}" to the owning charter's modules: list (or create the domain)`)
        } else if (owners.length > 1) {
          add('critical', 'domain-spine', `src/modules/${m} is claimed by ${owners.length} charters: ${owners.join(', ')}`, 'one module, one lane', [],
            'Remove it from all but the owning charter')
        }
      }
    }
  }

  // Domain spine (ADR-025) — docs/domains/<d>/ is an agent's lane definition, so
  // the lane must actually be defined and claims on it must be unambiguous.
  {
    const DOMAINS_DIR = path.join(SPEC_PACK, 'domains')
    if (existsSync(DOMAINS_DIR)) {
      const schemaModels = new Set(
        (read(path.join(ROOT, 'prisma', 'schema.prisma')).match(/^model\s+(\w+)/gm) || []).map((m) => m.split(/\s+/)[1]),
      )
      const modelClaims = new Map() // model → [domains]
      for (const entry of readdirSync(DOMAINS_DIR)) {
        const dir = path.join(DOMAINS_DIR, entry)
        if (!statSync(dir).isDirectory()) continue
        const charter = path.join(dir, 'CHARTER.md')
        if (!existsSync(charter)) {
          add('critical', 'domain-spine', `Domain without a charter: ${entry}`, 'every domains/<d>/ needs CHARTER.md — it is the lane definition agents work from', [rel(dir)], 'Write the charter before putting documents in the domain')
          continue
        }
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(charter))?.[1] || ''
        const declared = /^domain:\s*(\S+)/m.exec(fm)?.[1]
        if (declared !== entry) {
          add('warning', 'domain-spine', `Charter domain mismatch: frontmatter says "${declared}", folder is "${entry}"`, path.basename(charter), [rel(charter)], 'Make the frontmatter match the folder')
        }
        const inModels = /owns_models:\s*\n((?:\s+-\s+\S+\n?)*)/.exec(fm)?.[1] || ''
        for (const m of inModels.match(/-\s+(\S+)/g)?.map((x) => x.replace(/-\s+/, '')) || []) {
          if (!modelClaims.has(m)) modelClaims.set(m, [])
          modelClaims.get(m).push(entry)
          if (!schemaModels.has(m)) {
            add('warning', 'domain-spine', `Charter claims a model that is not in the schema: ${m}`, `domains/${entry}`, [rel(charter)], 'Stale charter — sync owns_models with prisma/schema.prisma')
          }
        }
        // Feature notes must declare the domain they sit in.
        for (const note of walk(path.join(dir, 'features'), '.md')) {
          const nfm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(note))?.[1] || ''
          const nd = /^domain:\s*(\S+)/m.exec(nfm)?.[1]
          if (nd !== entry) {
            add('critical', 'domain-spine', `Feature note in domains/${entry} declares domain "${nd || '(none)'}"`, path.basename(note), [rel(note)], 'A feature has one home — set domain: to the folder it lives in, or move it')
          }
        }
      }
      // The architecture invariant, applied to documentation: one owner per model.
      for (const [m, ds] of modelClaims) {
        if (ds.length > 1) {
          add('critical', 'domain-spine', `Model ${m} is claimed by ${ds.length} domains: ${ds.join(', ')}`, 'every operational table has exactly one owning domain (architecture invariant #1)', [], 'Pick the owner; the other domain reaches it through a contract')
        }
      }
      const unowned = [...schemaModels].filter((m) => !modelClaims.has(m))
      if (unowned.length) {
        add('info', 'domain-spine', `Models not yet claimed by any charter: ${unowned.length}`, unowned.join(', '), [], 'Coverage debt — claim them as charters mature')
      }
    }
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

// ---- Check 5: appendix/interface drift vs the real code -----------------
// A graph node proves that a file exists and is linked. It does not prove that
// a human inventory contains the current route, count or semantic boundary.
// These checks are deliberately separate from doc-graph so stale prose cannot
// hide behind a fresh generated projection.
const appRoute = (f) => {
  const fileRel = rel(f)
  const dir = path.posix.dirname(fileRel).replace(/^src\/app\/?/, '')
  const segments = dir.split('/').filter(Boolean).filter((segment) => !/^\(.*\)$/.test(segment))
  return '/' + segments.join('/')
}

const routeFiles = walk(path.join(ROOT, 'src', 'app', 'api'), 'route.js')
const routes = routeFiles.map(appRoute).sort()
const tick = String.fromCharCode(96)
const escapeRegex = (value) => value.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&')
const documentedPath = (body, route) => {
  const escaped = escapeRegex(route)
  return body.includes(tick + route + tick) ||
    new RegExp(tick + escaped + '(?:\\?[^' + tick + ']+)?' + tick).test(body) ||
    body.includes('| ' + route + ' |')
}
const apiSpec = path.join(ROOT, 'docs', 'appendices', 'A-api-spec.md')
if (existsSync(apiSpec)) {
  const body = read(apiSpec)
  const missing = routes.filter((r) => !documentedPath(body, r))
  if (missing.length) {
    add('critical', 'staleness', 'API appendix does not list every current route', missing.join(', '), ['docs/appendices/A-api-spec.md'], 'Add every current endpoint to Appendix A before release')
  }
  const apiCount = /<!--\s*api-spec-counts:\s*route_handlers=(\d+)\s*-->/.exec(body)
  if (!apiCount) {
    add('critical', 'staleness', 'API appendix has no machine-checkable handler count', 'Missing api-spec-counts marker', ['docs/appendices/A-api-spec.md'], 'Add <!-- api-spec-counts: route_handlers=N --> and keep it equal to src/app/api route.js files')
  } else if (Number(apiCount[1]) !== routes.length) {
    add('critical', 'staleness', 'API appendix handler count is stale', 'declared ' + apiCount[1] + ', actual ' + routes.length, ['docs/appendices/A-api-spec.md'], 'Regenerate the count from src/app/api route.js files')
  }
}

const pageFiles = walk(path.join(ROOT, 'src', 'app'), 'page.jsx')
const pageRoutes = pageFiles.map(appRoute).sort()
const interfaceInventory = path.join(ROOT, 'docs', 'INTERFACE-INVENTORY.md')
if (existsSync(interfaceInventory)) {
  const body = read(interfaceInventory)
  const missing = pageRoutes.filter((r) => !documentedPath(body, r))
  if (missing.length) {
    add('critical', 'staleness', 'Interface inventory does not list every current page route', missing.join(', '), ['docs/INTERFACE-INVENTORY.md'], 'Add one interface row or an explicit grouping rule for every page route')
  }

  const marker = /<!--\s*interface-inventory-counts:\s*page_routes=(\d+);\s*operational_domain_keys=(\d+);\s*operational_subdomain_entries=(\d+);\s*business_home_shell_slots=(\d+)\s*-->/
  const declared = marker.exec(body)
  if (!declared) {
    add('critical', 'staleness', 'Interface inventory has no machine-checkable coverage marker', 'Missing interface-inventory-counts marker', ['docs/INTERFACE-INVENTORY.md'], 'Add the route/domain count marker and keep it equal to the source registry')
  } else {
    const domainConfig = read(path.join(ROOT, 'src', 'config', 'domains.js'))
    const domainKeys = [...domainConfig.matchAll(/^\s*key:\s*'([^']+)',/gm)].map((m) => m[1])
    const subdomainEntries = [...domainConfig.matchAll(/\{\s*label:\s*'[^']+',\s*path:/g)].length
    const expected = [
      pageRoutes.length,
      domainKeys.filter((key) => key !== 'business-home').length,
      subdomainEntries - (domainKeys.includes('business-home') ? 1 : 0),
      domainKeys.filter((key) => key === 'business-home').length,
    ]
    const actual = declared.slice(1).map(Number)
    if (actual.some((value, index) => value !== expected[index])) {
      add('critical', 'staleness', 'Interface inventory coverage marker is stale', 'declared ' + actual.join('/') + ', actual ' + expected.join('/'), ['docs/INTERFACE-INVENTORY.md', 'src/config/domains.js'], 'Reconcile the interface registry with page routes and src/config/domains.js')
    }
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

// ---- Check 7: routes with no requirement anchor (ratchet) ----------------
// The other checks only fire on code that *opts in* by annotating: an `@req`
// naming an undeclared id is a CRITICAL, but a file naming nothing at all is
// invisible. A whole page could be added with no FR, no note and no test while
// every governance command reported green (.brain/rca/2026-08-17-governance-
// did-not-govern.md). This closes that gap without demanding a retrofit of the
// 47 routes that predate it: the baseline is the debt we accept, and it may
// only shrink. Anything not in it is new, and new orphans are a CRITICAL.
//
// Depends on a fresh graph — run docs:graph before this, and docs:check after,
// or a stale graph will hide a route this is meant to catch.
const BASELINE = path.join(SPEC_PACK, '.route-anchor-baseline.json')
if (existsSync(GRAPH)) {
  const g = JSON.parse(read(GRAPH))
  const codeByPath = new Map(g.nodes.filter((n) => n.type === 'code_file').map((n) => [n.path, n]))
  const implementers = new Set(g.edges.filter((e) => e.type === 'implements').map((e) => e.from))
  const anchored = (routeNode) => {
    const code = codeByPath.get(routeNode.path)
    return Boolean(code && implementers.has(code.id))
  }
  const orphans = g.nodes.filter((n) => n.type === 'route' && !anchored(n)).map((n) => n.path).sort()
  const baseline = existsSync(BASELINE) ? JSON.parse(read(BASELINE)).routes || [] : []
  const known = new Set(baseline)

  const introduced = orphans.filter((p) => !known.has(p))
  if (introduced.length) {
    add('critical', 'route-anchor', `${introduced.length} route(s) implement no declared requirement`, introduced.join(', '), introduced,
      'Declare the FR in docs/PRD-SDD-v1.0.md and add `@req FR-xxx` to the route — never widen .route-anchor-baseline.json to silence this')
  }
  const repaid = baseline.filter((p) => !orphans.includes(p))
  if (repaid.length) {
    add('info', 'route-anchor', `${repaid.length} baseline route(s) are now anchored`, repaid.join(', '), [rel(BASELINE)],
      'Remove them from .route-anchor-baseline.json so the ratchet keeps its ground')
  }
  const remaining = orphans.length - introduced.length
  if (remaining) {
    add('info', 'route-anchor', `${remaining} route(s) carry no requirement anchor (accepted debt)`, `baseline: ${rel(BASELINE)}`, [rel(BASELINE)],
      'Annotate them as their FRs get declared; the baseline may only shrink')
  }
}

// ---- Check 8: hand-built viewer fixtures (ratchet) -----------------------
// Three authorization holes shipped with a green suite because every test built
// its viewer by hand, in shapes `resolveViewer` cannot produce — typically
// `{ role: 'OWNER', visibleBusinessIds: [...] }` with no `ownedBusinessIds`.
// The guard ran, the test passed, and the hole was invisible from inside the
// suite (.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md).
//
// `tests/factories/viewer.js` is now the sanctioned constructor, and it enforces
// the resolver's invariants so the impossible viewer cannot be built. This check
// keeps new hand-built ones out. Files that legitimately construct *Membership*
// rows rather than viewers — chiefly the resolver's own test — are exempt.
const VIEWER_BASELINE = path.join(SPEC_PACK, '.viewer-fixture-baseline.json')
const VIEWER_EXEMPT = new Set([
  // Owns the contract: it feeds real Membership rows to the real resolver, so
  // its `role:` literals are inputs, not viewers.
  'tests/unit/viewer-gate.test.js',
  'tests/factories/viewer.js',
  'tests/unit/viewer-factory-contract.test.js',
  // Owns the authorization predicate. Its hand-built viewers are adversarial
  // *inputs* — `{ role: 'OWNER', visibleBusinessIds: [x] }` is exactly the shape
  // that must be refused, and the file asserts `false` for every one of them.
  // A fixture that pretends to be a real viewer is dangerous because a guard
  // then passes on it; a literal that exists to prove refusal cannot have that
  // failure mode. Its realistic viewers come from `resolveViewer` against the
  // real database.
  'tests/unit/viewer-authority.test.js',
])
{
  const roleLiteral = /\brole:\s*['"](OWNER|MEMBER|DEV)['"]/
  const viewerField = /visibleBusinessIds|ownedBusinessIds|domainsByBusinessId|visibleDomains|isPlatform/
  // A `role:` that sits in a **Membership row or a Membership mutation payload**
  // is data, not a viewer. Every field listed here belongs to Membership or to a
  // call that changes one; none has ever appeared on a viewer, so suppressing
  // them is provable rather than a fudge.
  //
  // This has now been widened twice, both times because the check fired on
  // something that was not a viewer: first a Prisma mock (`personId`,
  // `domainKeysJson`), then a service call (`membershipId`). Each time the cheap
  // move was to restructure the test around the guard — and each time that would
  // have documented a workaround and weakened the real signal everywhere else
  // (.brain/rca/2026-08-17-a-guard-that-teaches-a-workaround.md).
  const membershipRow = /personId|membershipId|domainKeysJson|employeeRef|branchId|tenantId/
  // A call to the sanctioned factory is the behaviour this check exists to
  // produce, so its own argument list must never be the evidence against a file.
  // `makeViewer({ visibleBusinessIds: [], ownedBusinessIds: [], role: 'MEMBER' })`
  // is correct usage, and a factory call ten lines above an unrelated `role:`
  // supplied the "resolver-only field" half of the heuristic for free — so
  // adopting the factory could make a file *start* failing. That is the third
  // widening, and the first where the false positive pointed at the very thing
  // the guard is trying to encourage
  // (.brain/rca/2026-08-17-a-guard-that-teaches-a-workaround.md).
  const FACTORY_CALL = /\b(?:makeViewer|ownsElsewhere|makeDevViewer)\s*\(/
  /** Line indices spanned by a sanctioned factory call, matched by paren depth. */
  const factorySpan = (lines) => {
    const inside = new Set()
    for (let i = 0; i < lines.length; i += 1) {
      const match = FACTORY_CALL.exec(lines[i])
      if (!match) continue
      let depth = 0
      let started = false
      for (let j = i; j < lines.length; j += 1) {
        const from = j === i ? match.index : 0
        for (const ch of lines[j].slice(from)) {
          if (ch === '(') { depth += 1; started = true }
          else if (ch === ')') depth -= 1
        }
        inside.add(j)
        if (started && depth <= 0) break
      }
    }
    return inside
  }
  const offenders = []
  for (const file of walk(path.join(ROOT, 'tests'), '.js')) {
    const relative = rel(file)
    if (VIEWER_EXEMPT.has(relative)) continue
    // Comments are stripped before matching. A viewer literal's fields appear
    // in code; prose about them does not build one. Without this, a file that
    // had genuinely been repaid to use the factory still tripped the check,
    // because a comment *explaining* the old hand-built shape sat within ten
    // lines of an unrelated `role:` in a mutation payload — which teaches the
    // next person to delete the explanation rather than fix the fixture.
    const lines = read(file)
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
    // Factory-call lines are blanked for BOTH halves of the test: they can
    // neither be the offending `role:` nor supply the resolver-only field that
    // convicts a neighbouring one.
    const factory = factorySpan(lines)
    const evidence = lines.map((line, i) => (factory.has(i) ? '' : line))
    // Proximity, not parsing: a `role:` within ten lines of a resolver-only
    // field is a viewer literal in every real occurrence in this repository.
    const hit = evidence.some((line, i) =>
      roleLiteral.test(line)
      && !membershipRow.test(line)
      && viewerField.test(evidence.slice(Math.max(0, i - 10), i + 11).join('\n')))
    if (hit) offenders.push(relative)
  }
  offenders.sort()
  const baseline = existsSync(VIEWER_BASELINE) ? JSON.parse(read(VIEWER_BASELINE)).files || [] : []
  const known = new Set(baseline)

  const introduced = offenders.filter((f) => !known.has(f))
  if (introduced.length) {
    add('critical', 'viewer-fixture', `${introduced.length} test file(s) build a viewer by hand`, introduced.join(', '), introduced,
      'Use makeViewer()/ownsElsewhere() from tests/factories/viewer.js — never widen .viewer-fixture-baseline.json to silence this. ' +
      'If this file does NOT build a viewer (a Membership DB row also carries `role:`), fix the heuristic in this script — do not move the code to escape it')
  }
  const repaid = baseline.filter((f) => !offenders.includes(f))
  if (repaid.length) {
    add('info', 'viewer-fixture', `${repaid.length} baseline file(s) no longer build a viewer by hand`, repaid.join(', '), [rel(VIEWER_BASELINE)],
      'Remove them from .viewer-fixture-baseline.json so the ratchet keeps its ground')
  }
  const remaining = offenders.length - introduced.length
  if (remaining) {
    add('info', 'viewer-fixture', `${remaining} test file(s) still build viewers by hand (accepted debt)`, `baseline: ${rel(VIEWER_BASELINE)}`, [rel(VIEWER_BASELINE)],
      'Migrate them to the factory; the baseline may only shrink')
  }
}

// ---- Check 9: hand-copied enum lists (ratchet) ---------------------------
// CLAUDE.md already says it: `src/lib/validation/enums.js` is the single source
// of truth and an enum list is never hand-copied. That was prose, so it was not
// enforced, and 25 copies accumulated.
//
// The cost is not theoretical. `WORK_STATUSES` has seven values; two separate
// copies — KanbanBoard and the FR-009 execution mode bodies — both spell out
// six and both drop the same one, `CANCELLED`. A WorkItem in that status renders
// in no column and appears on no board, silently. Two independent copies losing
// the *same* value is the signature of a list copied from another copy.
//
// This check deliberately does NOT judge whether a given copy is wrong: a subset
// can be a legitimate filter (terminal statuses, active-only), and a guard that
// guesses at intent produces false positives, which teach people to restructure
// code to dodge it rather than fix it. It only refuses NEW copies, against a
// shrink-only baseline — the same shape as checks 7 and 8.
const ENUM_BASELINE = path.join(SPEC_PACK, '.enum-copy-baseline.json')
const ENUM_SOURCE = path.join(ROOT, 'src', 'lib', 'validation', 'enums.js')
if (existsSync(ENUM_SOURCE)) {
  const enums = new Map()
  for (const m of read(ENUM_SOURCE).matchAll(/export const ([A-Z_0-9]+)\s*=\s*\[([^\]]*)\]/g)) {
    const values = [...m[2].matchAll(/'([^']+)'/g)].map((v) => v[1])
    // Two shared members is coincidence (many enums share DONE/ACTIVE); three
    // spelled-out members of one enum in one file is a copy.
    if (values.length >= 3) enums.set(m[1], values)
  }

  // The members must be CO-LOCATED, not merely present somewhere in the file.
  // The first version counted literals file-wide, and immediately produced a
  // false positive with a real cost: progress-service.js uses three unrelated
  // single-value comparisons — `status: { not: 'ARCHIVED' }` at line 55,
  // `m.status !== 'DONE'` at 118, `p.status === 'ACTIVE'` at 135 — sixty lines
  // apart, which is not a copied list by any reading. An agent "repaid" it by
  // rewriting the exclusion filter into an inclusion filter, silently changing
  // which rows count toward a progress roll-up.
  //
  // A hand-copied list is compact by nature: an array, a column map, a
  // status→label object. Requiring three distinct members inside a five-line
  // window is what separates a list from a vocabulary used across a file.
  // Third narrowing, 2026-08-17, and the one that matters most: only literals
  // that are actually LIST ELEMENTS count. The check previously counted every
  // quoted uppercase literal, so on its first full review 8 of its 10 findings
  // turned out not to be copies at all:
  //
  //   mapping value   KIND_TO_ENDPOINT = { project: 'PROJECT', ... }
  //                   DEFAULT_ITEM_SUBTYPE = { SOFTWARE_SPRINT: 'TASK', ... }
  //   mapping pair    [['portfolio', 'PORTFOLIO'], ['tenant', 'TENANT'], ...]
  //   call argument   nodeKey('PROJECT', projectId)
  //   comparison      workspace.scopeType === 'PORTFOLIO'
  //   JSDoc union     @returns {{ principalType: 'STAFF'|'CUSTOMER'|... }}
  //
  // None of those is a list that can drift out of step with the enum, and the
  // report actively misled about one: `DEFAULT_ITEM_SUBTYPE` was called an
  // "INCOMPLETE copy of ITEM_SUBTYPES missing BUG/VALIDATION/…", when it is a
  // per-mode default — one entry per execution mode, deliberately choosing DEAL
  // over the contract's first entry ACCOUNT. Adding the "missing" values would
  // have corrupted it. That is the failure the earlier narrowing was written
  // about: a finding phrased as "missing X" invites adding X.
  //
  // A list element is a literal whose preceding non-space character is `[` or
  // `,` (looking back through line breaks for a wrapped array). A line that also
  // carries a lower-case quoted string is a mapping pair, not a list.
  const listElements = (lines) => {
    const out = lines.map(() => new Set())
    let prevTail = ''
    lines.forEach((raw, idx) => {
      const line = raw.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '')
      if (!/'[a-z][^']*'/.test(line)) {
        for (const m of line.matchAll(/'([A-Z][A-Z_0-9]{2,})'/g)) {
          const before = line.slice(0, m.index).replace(/\s+$/, '')
          const prev = before ? before.slice(-1) : prevTail
          if (prev === '[' || prev === ',') out[idx].add(m[1])
        }
      }
      const trimmed = line.replace(/\s+$/, '')
      if (trimmed) prevTail = trimmed.slice(-1)
    })
    return out
  }

  const WINDOW = 5
  const offenders = []
  for (const file of walk(path.join(ROOT, 'src'), '.js').concat(walk(path.join(ROOT, 'src'), '.jsx'))) {
    if (path.resolve(file) === path.resolve(ENUM_SOURCE)) continue
    const lines = read(file).split('\n')
    const perLine = listElements(lines)
    const fileLiterals = new Set(perLine.flatMap((s) => [...s]))
    for (const [name, values] of enums) {
      let clustered = false
      for (let i = 0; i < lines.length && !clustered; i += 1) {
        const window = new Set(perLine.slice(i, i + WINDOW).flatMap((s) => [...s]))
        if (values.filter((v) => window.has(v)).length >= 3) clustered = true
      }
      if (!clustered) continue
      // `missing` is still reported file-wide: a value mentioned anywhere in the
      // file is handled somewhere, and the dangerous case is the one that is
      // mentioned nowhere at all.
      const missing = values.filter((v) => !fileLiterals.has(v))
      offenders.push({ key: `${rel(file)}::${name}`, missing })
    }
  }
  offenders.sort((a, b) => a.key.localeCompare(b.key))

  const baseline = existsSync(ENUM_BASELINE) ? JSON.parse(read(ENUM_BASELINE)).copies || [] : []
  const known = new Set(baseline)
  const introduced = offenders.filter((o) => !known.has(o.key))
  if (introduced.length) {
    add('critical', 'enum-copy', `${introduced.length} hand-copied enum list(s)`,
      introduced.map((o) => `${o.key}${o.missing.length ? ` (missing ${o.missing.join(', ')})` : ''}`).join(' · '),
      introduced.map((o) => o.key.split('::')[0]),
      'Import the list from src/lib/validation/enums.js and derive from it — never widen .enum-copy-baseline.json to silence this. ' +
      'If these literals are genuinely unrelated to that enum, fix the matcher in this script — do not rename the values to escape it')
  }
  const currentKeys = new Set(offenders.map((o) => o.key))
  const repaid = baseline.filter((k) => !currentKeys.has(k))
  if (repaid.length) {
    add('info', 'enum-copy', `${repaid.length} baseline entr(ies) no longer copy an enum`, repaid.join(', '), [rel(ENUM_BASELINE)],
      'Remove them from .enum-copy-baseline.json so the ratchet keeps its ground')
  }
  const remaining = offenders.length - introduced.length
  if (remaining) {
    const incomplete = offenders.filter((o) => known.has(o.key) && o.missing.length)
    add('info', 'enum-copy', `${remaining} hand-copied enum list(s) remain (accepted debt)`,
      `${incomplete.length} of them are INCOMPLETE copies — those are the ones that silently drop a value: ${incomplete.slice(0, 6).map((o) => `${o.key} missing ${o.missing.join('/')}`).join(' · ')}`,
      [rel(ENUM_BASELINE)],
      'Derive from enums.js; the baseline may only shrink')
  }
}

// ---- Check 9b: every Prisma model is covered by the backup snapshot -------
// SNAPSHOT_MODELS is a hand-maintained mirror of prisma/schema.prisma, and until
// now nothing related the two. A model added to the schema and forgotten here
// fails in one of two ways, and which one you get is luck: with a foreign key
// into the swept graph the restore crashes, without one it silently succeeds
// while never exporting, deleting or restoring that table — so a "restored"
// installation keeps rows from before the restore, pointing at ids that no
// longer mean the same thing.
//
// That second branch is data corruption during disaster recovery, which is why
// this is a CRITICAL rather than a warning. It ran latent through two shipped
// requirements: FR-079/FR-080 added three integration models that were never
// listed, and stayed green only because no test ever created a row in them.
// Full account: .brain/rca/2026-08-18-snapshot-model-list-drifted-from-the-schema.md
//
// Membership is checkable; ORDER is not. Parent-before-child is a property of
// the relation graph, not of this list, and the restore integration test is what
// proves it. Both incidents so far came from membership.
const BACKUP_SERVICE = path.join(ROOT, 'src', 'modules', 'project-manager', 'application', 'backup-service.js')
const PRISMA_SCHEMA = path.join(ROOT, 'prisma', 'schema.prisma')
if (existsSync(BACKUP_SERVICE) && existsSync(PRISMA_SCHEMA)) {
  // Prisma client accessors are the model name with a lower-cased first letter.
  const accessor = (model) => model[0].toLowerCase() + model.slice(1)
  const schemaModels = [...read(PRISMA_SCHEMA).matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => accessor(m[1]))

  const source = read(BACKUP_SERVICE)
  // Strip line comments first: the list carries prose naming models it does not
  // list, and a comment must never be able to satisfy this check.
  const uncommented = (block) => block.replace(/\/\/.*$/gm, '')
  const listBlock = source.match(/const SNAPSHOT_MODELS = \[([\s\S]*?)\]/)
  const exclBlock = source.match(/export const SNAPSHOT_EXCLUDED_MODELS = \{([\s\S]*?)\n\}/)
  const listed = listBlock ? [...uncommented(listBlock[1]).matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]) : []
  // Keys only. Each value is the reason, and a key with an empty reason is not
  // an exclusion — it is the omission this pair exists to stop.
  const excluded = exclBlock
    ? [...uncommented(exclBlock[1]).matchAll(/^\s{2}(\w+):\s*([\s\S]*?)(?=^\s{2}\w+:|$)/gm)]
      .map((m) => ({ name: m[1], reason: m[2].replace(/[\s'+,]/g, '') }))
    : []

  if (!listBlock) {
    add('critical', 'snapshot-coverage', 'SNAPSHOT_MODELS could not be parsed', rel(BACKUP_SERVICE), [rel(BACKUP_SERVICE)],
      'This check derives snapshot coverage from that array. If it was renamed or reshaped, update this check with it')
  } else {
    const covered = new Set([...listed, ...excluded.map((e) => e.name)])
    const uncovered = schemaModels.filter((m) => !covered.has(m))
    if (uncovered.length) {
      add('critical', 'snapshot-coverage', `${uncovered.length} Prisma model(s) absent from the backup snapshot`,
        uncovered.join(', '), [rel(BACKUP_SERVICE), rel(PRISMA_SCHEMA)],
        'Add each to SNAPSHOT_MODELS in restore order (parents first), or to SNAPSHOT_EXCLUDED_MODELS with the reason it ' +
        'cannot be restored. Then create a real row for it in tests/integration/backup.test.js — a model listed but never ' +
        'written by any fixture is exactly how the last three stayed hidden')
    }

    // A listed name with no model behind it crashes at `tx[model].deleteMany()`
    // during a restore — the one code path nobody exercises until they need it.
    const known = new Set(schemaModels)
    const phantom = listed.filter((m) => !known.has(m))
    if (phantom.length) {
      add('critical', 'snapshot-coverage', `${phantom.length} snapshot entr(ies) name no Prisma model`,
        phantom.join(', '), [rel(BACKUP_SERVICE)],
        'A renamed or removed model leaves an entry that throws mid-restore. Remove it, or rename it to match the schema')
    }

    const reasonless = excluded.filter((e) => e.reason.length < 20)
    if (reasonless.length) {
      add('critical', 'snapshot-coverage', `${reasonless.length} exclusion(s) carry no reason`,
        reasonless.map((e) => e.name).join(', '), [rel(BACKUP_SERVICE)],
        'An exclusion without a stated reason is indistinguishable from having forgotten the model. Write why it is not restorable')
    }

    const staleExclusions = excluded.filter((e) => !known.has(e.name))
    if (staleExclusions.length) {
      add('info', 'snapshot-coverage', `${staleExclusions.length} exclusion(s) name no Prisma model`,
        staleExclusions.map((e) => e.name).join(', '), [rel(BACKUP_SERVICE)],
        'Drop them from SNAPSHOT_EXCLUDED_MODELS so the list keeps meaning what it says')
    }
  }
}

// ---- Check 10: mutating routes must resolve a viewer (ratchet) ------------
// On 2026-08-17 a review found `POST /api/projects/{id}/team` resolving no
// viewer while the service behind it wrote a Membership whose `role` came
// straight from the request body — one unauthenticated request minted
// business-owner authority. It was not an oversight in one file: 39 of 61 route
// files resolved no viewer, and the SEC-001 guard `assertWorkspaceInScope` was
// called by nothing.
//
// Reads are a separate argument. A handler that WRITES and cannot say who is
// asking is not.
const ROUTE_VIEWER_BASELINE = path.join(SPEC_PACK, '.route-viewer-baseline.json')
{
  const MUTATING = /export\s+async\s+function\s+(POST|PATCH|PUT|DELETE)\b/
  const RESOLVES = /resolveRequestViewer|resolveViewer/
  // Structurally exempt, not baselined debt: authentication lifecycle endpoints
  // establish or clear the session and therefore cannot require a viewer first.
  // They are exemptions rather than baseline entries because resolving a viewer
  // there would be a broken authentication boundary. reset-password (FR-104) is
  // the same class: the caller's only credential is the handed-over token, and
  // demanding a session from someone locked out of theirs is the broken boundary.
  // signup (FR-120) is the extreme case of the same rule — it is the route that
  // brings the identity into existence, so there is not yet a Person for a
  // viewer to resolve to. It belongs here rather than in the baseline for the
  // reason the baseline exists to keep straight: the baseline records routes
  // that SHOULD resolve a viewer and do not, and adding a structurally
  // exempt one would make that list mean two different things at once.
  const IS_AUTH_LIFECYCLE_ENDPOINT = (p) =>
    p.includes('/api/auth/login/') || p.includes('/api/auth/logout/') ||
    p.includes('/api/auth/signup/') ||
    p.includes('/api/auth/reset-password/') || p.split('/').includes('session')
  // FR-123 / ADR-052 — the plugin credential lifecycle is the same class one
  // boundary out. `POST /api/plugin/auth/token` authenticates with a one-time
  // PKCE-bound authorization code and `POST /api/plugin/auth/revoke` with the
  // opaque bearer itself; neither caller has a browser session, and the plugin
  // is a public client precisely so it never holds one. Requiring
  // resolveRequestViewer there would not add a check, it would add a second,
  // wrong identity boundary — which is the same reason login/logout sit here.
  // They are exemptions and not baseline entries for the reason stated above:
  // the baseline records routes that SHOULD resolve a viewer and do not.
  // Note that `GET /authorize` is deliberately NOT exempt — it is the one
  // route in the family that must have a browser viewer, and it resolves one.
  const IS_PLUGIN_AUTH_LIFECYCLE_ENDPOINT = (p) =>
    p.includes('/api/plugin/auth/token/') || p.includes('/api/plugin/auth/revoke/')
  const offenders = []
  for (const file of walk(path.join(ROOT, 'src', 'app', 'api'), '.js')) {
    if (path.basename(file) !== 'route.js') continue
    if (IS_AUTH_LIFECYCLE_ENDPOINT(rel(file)) || IS_PLUGIN_AUTH_LIFECYCLE_ENDPOINT(rel(file))) continue
    const body = read(file)
    if (!MUTATING.test(body)) continue
    if (RESOLVES.test(body)) continue
    offenders.push(rel(file))
  }
  offenders.sort()
  const baseline = existsSync(ROUTE_VIEWER_BASELINE) ? JSON.parse(read(ROUTE_VIEWER_BASELINE)).routes || [] : []
  const known = new Set(baseline)
  const introduced = offenders.filter((f) => !known.has(f))
  if (introduced.length) {
    add('critical', 'route-viewer', `${introduced.length} mutating route(s) resolve no viewer`, introduced.join(', '), introduced,
      'Resolve the request viewer and pass it to the service, which must fail closed without one — never widen .route-viewer-baseline.json to silence this. ' +
      'If this handler genuinely needs no caller identity, say why in a comment on the file and raise it with an owner rather than baselining it')
  }
  const repaid = baseline.filter((f) => !offenders.includes(f))
  if (repaid.length) {
    add('info', 'route-viewer', `${repaid.length} baseline route(s) now resolve a viewer`, repaid.join(', '), [rel(ROUTE_VIEWER_BASELINE)],
      'Remove them from .route-viewer-baseline.json so the ratchet keeps its ground')
  }
  const remaining = offenders.length - introduced.length
  if (remaining) {
    add('info', 'route-viewer', `${remaining} mutating route(s) still resolve no viewer (accepted debt)`, `baseline: ${rel(ROUTE_VIEWER_BASELINE)}`, [rel(ROUTE_VIEWER_BASELINE)],
      'Each one is a write nobody can attribute; the baseline may only shrink')
  }
}

// ---- Check 11: a client mutation must be able to report its own failure ----
// `PermissionRow.save` had `try { await api(...) } finally { setBusy(false) }`
// with no `catch`: a refused save un-greyed the button, wrote nothing, and said
// nothing. Three quarters of that page's rows failed on every click and the page
// looked fine. It was fixed at one site; a review then found twelve more.
//
// This does NOT use a proximity window. Three separate false positives from
// proximity heuristics in one day — each of which cost real work, one of which
// changed a progress calculation — were enough. It brace-matches the actual
// `try` blocks and asks whether the call sits inside one that has a `catch`.
const API_CATCH_BASELINE = path.join(SPEC_PACK, '.client-mutation-baseline.json')

/** Ranges of `try { … }` blocks that are followed by a `catch`. */
function guardedTryRanges(source) {
  const ranges = []
  const tryRe = /\btry\s*\{/g
  let m
  while ((m = tryRe.exec(source))) {
    const open = m.index + m[0].length - 1
    let depth = 0
    let i = open
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (i >= source.length) continue
    // A `finally` with no `catch` is the exact defect — it restores the UI to
    // something that looks like success. Only a `catch` counts as guarded.
    if (/^\s*catch\b/.test(source.slice(i + 1, i + 40))) ranges.push([open, i])
  }
  return ranges
}
{
  const offenders = []
  for (const file of walk(path.join(ROOT, 'src'), '.jsx')) {
    const body = read(file)
    if (!/\bfrom\s+['"][^'"]*useApi['"]/.test(body)) continue
    const ranges = guardedTryRanges(body)
    const unguarded = []
    const callRe = /\bawait\s+api\(/g
    let m
    while ((m = callRe.exec(body))) {
      if (!ranges.some(([a, b]) => m.index > a && m.index < b)) {
        unguarded.push(body.slice(0, m.index).split('\n').length)
      }
    }
    if (unguarded.length) offenders.push({ key: rel(file), lines: unguarded })
  }
  offenders.sort((a, b) => a.key.localeCompare(b.key))
  const baseline = existsSync(API_CATCH_BASELINE) ? JSON.parse(read(API_CATCH_BASELINE)).files || [] : []
  const known = new Set(baseline)
  const introduced = offenders.filter((o) => !known.has(o.key))
  if (introduced.length) {
    add('critical', 'client-mutation', `${introduced.length} file(s) call the API with no catch`,
      introduced.map((o) => `${o.key} (line${o.lines.length > 1 ? 's' : ''} ${o.lines.join(', ')})`).join(' · '),
      introduced.map((o) => o.key),
      'Catch the rejection and show it — a mutation that cannot report its own failure reports success by saying nothing. ' +
      'Never widen .client-mutation-baseline.json to silence this')
  }
  const currentKeys = new Set(offenders.map((o) => o.key))
  const repaid = baseline.filter((f) => !currentKeys.has(f))
  if (repaid.length) {
    add('info', 'client-mutation', `${repaid.length} baseline file(s) now report their failures`, repaid.join(', '), [rel(API_CATCH_BASELINE)],
      'Remove them from .client-mutation-baseline.json so the ratchet keeps its ground')
  }
  const remaining = offenders.filter((o) => known.has(o.key))
  if (remaining.length) {
    add('info', 'client-mutation', `${remaining.length} file(s) still swallow a failed mutation (accepted debt)`,
      remaining.map((o) => `${o.key}:${o.lines.join('/')}`).join(' · '), [rel(API_CATCH_BASELINE)],
      'A silent failure is indistinguishable from success; the baseline may only shrink')
  }
}

// ---- Check 12: an id is a key — its subject may not move (id-stability) ----
// On 2026-08-20 PR #88 hit an id collision and resolved it by renumbering
// SDD-049 — a statement that had already merged to main — to SDD-050, taking
// SDD-049 for its own market-translation seam. AGENTS.md §18 forbids exactly
// that. The duplicate-id guard above could not see it: it catches two rows
// sharing a key, and a MOVED id is not a duplicate at any single moment. So the
// whole chain stayed green while tests/e2e/fr091-conversation-inbox.spec.js went
// on citing SDD-049 for a subject it had never been written against, and that
// stale reference was found by hand. It was the second occurrence — on
// 2026-08-15 a stale whole-file copy of the registry merged over main,
// repurposing FR-051 and SDD-026 and deleting fifteen other ids outright.
//
// The rules live in scripts/id-stability.mjs so the incident itself can be a
// regression test: a straight-line script that derives ROOT from its own
// location cannot be pointed at a fixture. This block only gathers the inputs.
//
// Top level with its own reader, NOT inside the Check-3 `else`: that block does
// not run when the graph is missing, and this check deliberately takes no
// dependency on docs/.doc-graph.json at all. The graph knows only
// FR/NFR/BR/SEC/SDD/FEAT, so a graph-backed check would ship blind to MI-RQ and
// RSK — which is precisely how this recurs.
const ID_LEDGER = path.join(SPEC_PACK, '.id-ledger.json')
{
  // Read defensively, in the house idiom: a missing file or key degrades to the
  // strictest state (nothing pinned), never the loosest.
  //
  // A CORRUPT ledger degrades the same way, and says so. Two branches each
  // declaring an id conflict in this file, and a conflict marker left in it threw
  // an uncaught SyntaxError out of the whole run — taking the other eleven checks
  // with it and leaving docs/.preflight-report.json stale, which is the one
  // outcome every check here exists to prevent.
  let ledger = {}
  if (existsSync(ID_LEDGER)) {
    try {
      ledger = JSON.parse(read(ID_LEDGER))
    } catch (e) {
      add('critical', 'id-stability', 'the id ledger could not be parsed', `${rel(ID_LEDGER)}: ${e.message}`, [rel(ID_LEDGER)],
        'Every id now reads as unpinned, so this run can tell you nothing about id stability. If a merge left conflict markers in it, ' +
          'resolve them by KEEPING BOTH sides of `ids` and `roster` — an entry never leaves this ledger (ADR-039 D9) — then run ' +
          'npm run docs:ids -- --write')
    }
  }
  const readDoc = (repoRelPath) => {
    const abs = path.join(ROOT, repoRelPath)
    return existsSync(abs) ? read(abs) : null
  }

  // Blast radius. Computed ONLY once something has already fired, so a healthy
  // tree pays nothing — and deliberately a plain text scan, because it has to
  // reach the reference sites the doc graph never reads: prisma/*.prisma,
  // supabase/**/*.sql, the traces-to cells of CURRENT registry rows, §2.4 prose,
  // charter prose. Every confirmed stale citation in this repository lives in one
  // of those. It REPORTS; it never decides whether a citation is wrong — that
  // comparison needs a model, and a gate that needs a model behaves differently
  // on two machines.
  let citationIndex = null
  const citersOf = (id) => {
    if (!citationIndex) {
      citationIndex = [
        ...walk(path.join(ROOT, 'src'), '.js'),
        ...walk(path.join(ROOT, 'src'), '.jsx'),
        ...walk(path.join(ROOT, 'tests'), '.js'),
        ...walk(path.join(ROOT, 'prisma'), '.prisma'),
        ...walk(path.join(ROOT, 'supabase'), '.sql'),
        ...walk(path.join(ROOT, 'contracts'), '.json'),
        ...allDocs,
      ].map((f) => [rel(f), read(f)])
    }
    const re = new RegExp(`(?<![A-Za-z0-9-])${id}(?![0-9])`)
    return citationIndex.filter(([, body]) => re.test(body)).map(([p]) => p)
  }

  const namedFiles = [
    ...walk(path.join(ROOT, 'src'), '.js'),
    ...walk(path.join(ROOT, 'src'), '.jsx'),
    ...walk(path.join(ROOT, 'tests'), '.js'),
    ...allDocs,
  ].map((f) => ({ path: rel(f), body: read(f) }))

  for (const f of evaluateIdStability({
    declared: collectDeclared(ROOT),
    ledger,
    readDoc,
    citersOf,
    namedFiles,
    ledgerPath: rel(ID_LEDGER),
  })) {
    add(f.severity, f.check, f.title, f.details, f.files, f.action)
  }
}

// ---- Check 13: the roadmap's evidence column must resolve (ratchet) -------
// ROADMAP.md declares itself `source_of_truth: true` and `live_document: true`,
// and GoVibe Mission Control reads it directly. Its `Source Section` column is
// the only pointer a reader has from a delivery claim to the artifact backing
// it, so a pointer at a file that does not exist is a claim nobody can falsify.
//
// On 2026-08-27 a row was given `../domains/knowledge/features/FR-113-entity-
// candidate-extraction.md` while that file existed only in a different branch,
// and the whole chain reported `dangling 0` and PASS. Check 2 above did not see
// it: that check matches markdown links, `[text](href)`, and these cells are
// bare paths. So the one file whose own frontmatter claims to be a source of
// truth was the one file whose references nothing resolved.
//
// What counts as a path (the predicate this check turns on):
//   A `;`-separated reference is a path claim if, after a trailing parenthetical
//   annotation is stripped, it contains `/`. That cleanly separates the two
//   populations already in the column: locations (`../domains/crm/features/
//   FR-078-....md`, `changes/ZV2-CR-005-....md`) from registry references
//   (`PRD-SDD 1.3`, `ADR-024`, `PRD-SDD FR-109..111`), which name an id or a
//   section rather than a file and are not checkable from the filesystem.
//
// The hybrid form `../domains/identity/features/FR-107 (PRD row)` was the one
// real judgement call. It is NOT treated as a legitimate non-path: the prefix is
// still a claim about where something lives, and exempting it would let any
// broken pointer be laundered by appending a parenthetical. The annotation is
// stripped and the path is checked. Both instances present when this check was
// written were repaired rather than baselined — FR-112's note exists under its
// full slug, and FR-107 has no note at all, so that cell became the registry
// reference it was really describing.
//
// Two resolution bases, deliberately: `docs/roadmap/` and `docs/`. The column
// genuinely mixes them — `../domains/...` is relative to the roadmap directory,
// `roadmap/PLAN-FR-045-....md` and `changes/ZV2-CR-005-....md` are relative to
// docs/ — and both forms name files that exist. Accepting either base can miss a
// path that resolves from the base its author did not mean; demanding one would
// report two correct pointers as broken, and a check that cries wolf on working
// links teaches people to "repair" them. A false negative here is recoverable; a
// false positive corrupts the thing being checked.
//
// A missing `.md` extension is accepted for the same reason: several cells omit
// it and still name a real file.
const ROADMAP = path.join(SPEC_PACK, 'roadmap', 'ROADMAP.md')
const ROADMAP_EVIDENCE_BASELINE = path.join(SPEC_PACK, '.roadmap-evidence-baseline.json')
if (existsSync(ROADMAP)) {
  const { broken, structural } = findBrokenEvidence({
    roadmapText: read(ROADMAP),
    exists: (repoRelPath) => existsSync(path.join(ROOT, repoRelPath)),
  })
  for (const s of structural) {
    add('warning', 'roadmap-evidence', s.title, rel(ROADMAP), [rel(ROADMAP)], s.action)
  }
  const baseline = existsSync(ROADMAP_EVIDENCE_BASELINE)
    ? JSON.parse(read(ROADMAP_EVIDENCE_BASELINE)).references || []
    : []
  const known = new Set(baseline)

  const introduced = broken.filter((b) => !known.has(b))
  if (introduced.length) {
    add('critical', 'roadmap-evidence', `${introduced.length} roadmap row(s) cite evidence that does not exist`, introduced.join(', '), [rel(ROADMAP)],
      'Point the Source Section at the real file, or cite the registry (e.g. `PRD-SDD FR-xxx`) when no document backs the row — ' +
        'never widen .roadmap-evidence-baseline.json to silence this')
  }
  const repaid = baseline.filter((b) => !broken.includes(b))
  if (repaid.length) {
    add('info', 'roadmap-evidence', `${repaid.length} baseline reference(s) now resolve`, repaid.join(', '), [rel(ROADMAP_EVIDENCE_BASELINE)],
      'Remove them from .roadmap-evidence-baseline.json so the ratchet keeps its ground')
  }
  const remaining = broken.length - introduced.length
  if (remaining) {
    add('info', 'roadmap-evidence', `${remaining} roadmap reference(s) name a document that no longer exists (accepted debt)`, `baseline: ${rel(ROADMAP_EVIDENCE_BASELINE)}`, [rel(ROADMAP_EVIDENCE_BASELINE)],
      'Repoint or retire them; the baseline may only shrink')
  }
}

// ---- Check 14: a delivered requirement must have a roadmap row (ratchet) --
// Check 13 above verifies that a roadmap row's evidence resolves. It has no
// opinion about a row that was never written — and on 2026-08-28 that is exactly
// what happened: FR-114, FR-115 and FR-116 all merged, all with code and tests,
// and the roadmap carried rows for none of them. It went three stages behind
// `main` and nothing said so, including the check that had just been added to
// that same table. The gap was found by reading main after a merge.
//
// Every other guard failure recorded in this file was a guard reading the wrong
// *field*. This one reads the wrong *set*: a check over the rows that exist can
// never see the row that does not. The only fix for that class is a check
// starting from the other side, so this one begins with delivered requirements
// and asks which have no row, rather than beginning with rows and asking whether
// they are good.
//
// The two decisions worth knowing are in scripts/roadmap-coverage.mjs: ranges
// are expanded (without that, 22 of 32 findings would be false), and delivery is
// read from `implements` edges rather than from a status cell, because a ✅ is a
// claim someone typed while an edge is one the filesystem can retract.
//
// Depends on a fresh graph — run docs:graph before this.
const ROADMAP_COVERAGE_BASELINE = path.join(SPEC_PACK, '.roadmap-coverage-baseline.json')
if (existsSync(ROADMAP) && existsSync(GRAPH)) {
  const g = JSON.parse(read(GRAPH))
  const delivered = new Set(
    g.edges
      .filter((e) => e.type === 'implements' && /^req:FR-\d{3}$/.test(e.to))
      .map((e) => e.to.slice(4))
  )
  const uncovered = findUncoveredRequirements({ roadmapText: read(ROADMAP), delivered })
  const baseline = existsSync(ROADMAP_COVERAGE_BASELINE)
    ? JSON.parse(read(ROADMAP_COVERAGE_BASELINE)).requirements || []
    : []
  const known = new Set(baseline)

  const introduced = uncovered.filter((id) => !known.has(id))
  if (introduced.length) {
    add('critical', 'roadmap-coverage', `${introduced.length} delivered requirement(s) have no roadmap row`, introduced.join(', '), [rel(ROADMAP)],
      'Add a Backlog Items row under the owning phase — the roadmap is source_of_truth and Mission Control reads it, so a delivered requirement with no row understates what shipped. ' +
        'Never widen .roadmap-coverage-baseline.json to silence this')
  }
  const repaid = baseline.filter((id) => !uncovered.includes(id))
  if (repaid.length) {
    add('info', 'roadmap-coverage', `${repaid.length} baseline requirement(s) now have a roadmap row`, repaid.join(', '), [rel(ROADMAP_COVERAGE_BASELINE)],
      'Remove them from .roadmap-coverage-baseline.json so the ratchet keeps its ground')
  }
  const remaining = uncovered.length - introduced.length
  if (remaining) {
    add('info', 'roadmap-coverage', `${remaining} delivered requirement(s) carry no roadmap row (accepted debt)`, `baseline: ${rel(ROADMAP_COVERAGE_BASELINE)}`, [rel(ROADMAP_COVERAGE_BASELINE)],
      'Write their rows as their phases are revisited; the baseline may only shrink')
  }
}

// ---- Check 15: untracked documents under docs/ ---------------------------
// Every check above this one reads a set built from files git already knows
// about — the doc walk, the graph, the registries, the route scan. That is not
// an accident of implementation; it is what "the repository" means to all of
// them. So a document that was never `git add`ed is not merely unchecked: it is
// unrepresentable. There is no severity any other check could assign to it,
// because no other check has a slot for it to occupy.
//
// On 2026-08-30 four change requests — CR-002, CR-003, CR-004 and CR-005 —
// were found sitting in the working tree of the shared primary checkout,
// untracked, not ignored, absent from main. They had been written there
// directly by an agent outside this machine's session mesh. `govern` was green
// the whole time, preflight reported PASS, CI reported PASS, and the doc graph
// counted the same number of documents before and after they appeared. They
// were found by byte-comparing the primary's tree against `git archive`, which
// is to say: by a method no part of this repository runs.
//
// That is the same shape as every guard failure recorded above — the check is
// correct and its source cannot contain the failure — but with the sharpest
// possible source defect, because the tracked-file list excludes untracked
// files *by construction*. The only fix for that class is a check that starts
// from the other side, so this one asks git for what it is deliberately not
// looking at everywhere else.
//
// **This check cannot fire in CI, and that limitation is load-bearing.** A CI
// checkout is a clone of a commit; it has no untracked files, so this check
// passes there no matter what any working tree contains. That is not a reason
// to skip it — `govern` runs locally constantly, and local is where the
// condition exists at all — but it IS a reason to say so out loud, because a
// green pull request would otherwise be read as covering this. The sentence is
// in the finding's own `action` text, and on a CI runner the check emits a
// standalone `info` saying it is blind there, so the machine-readable report CI
// produces carries the disclaimer rather than a silent PASS. See
// scripts/untracked-docs.mjs for the wording and for why the severity is
// warning rather than critical, and why there is deliberately no baseline file.
//
// A failed git call is CRITICAL, not clean. `spawnSync` returns an empty stdout
// for a command that never ran, and an empty list from this check is otherwise
// indistinguishable from a healthy tree — which would be this very defect
// rebuilt inside its own remedy.
{
  const runGit = () => {
    const r = spawnSync('git', GIT_ARGS, { cwd: ROOT, encoding: 'utf8', windowsHide: true })
    if (r.error) return { ok: false, reason: `${r.error.message} (is git on PATH?)` }
    if (r.status !== 0) {
      return { ok: false, reason: `exited ${r.status}: ${(r.stderr || '').trim() || 'no stderr — is this a git repository?'}` }
    }
    return { ok: true, stdout: r.stdout }
  }
  for (const f of evaluateUntrackedDocs({ git: runGit, ci: Boolean(process.env.CI) })) {
    add(f.severity, f.check, f.title, f.details, f.files, f.action)
  }
}

// ---- Output --------------------------------------------------------------
const counts = findings.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] || 0) + 1 }), {})
const report = {
  version: '2.0.0',
  generated_by: 'scripts/doc-preflight.mjs (rwang:doc-preflight)',
  scanned: { docs: allDocs.length, routes: routes.length, test_files: testCount },
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

console.log(`docs ${allDocs.length} · routes ${routes.length} · test files ${testCount}`)
console.log(`critical ${report.summary.critical} · warning ${report.summary.warning} · info ${report.summary.info} → ${report.summary.overall}`)
for (const f of findings) console.log(`  [${f.severity.toUpperCase()}] ${f.check}: ${f.title} — ${f.details}`)

if (process.argv.includes('--strict') && report.summary.critical > 0) process.exit(1)
