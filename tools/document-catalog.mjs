#!/usr/bin/env node
// Document catalog (ADR-118, redesign proposal section 6).
//
// A read-only projection over what git tracks. It adds no authority: kinds come
// from docs/governance/DOCUMENT-KINDS.json, requirement identity from
// registry/document-registry/index.json, everything else from the document's own
// frontmatter. The output is deterministic (no timestamps) and is written only to
// the ignored build file docs/.doc-catalog.json (ADR-081: built, not committed).
//
// Deferred to a later change (proposal 6.2): graph node ids and inbound-reference counts.
// @spec ADR-118, ADR-081, docs/plans/DOCS-ARCHITECTURE-REDESIGN-PROPOSAL-20261113.md
// @tested tools/tests/document-catalog.test.mjs

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const POLICY_PATH = 'docs/governance/DOCUMENT-KINDS.json'
export const CATALOG_PATH = 'docs/.doc-catalog.json'
const REGISTRY_INDEX = 'registry/document-registry/index.json'
const DOCUMENT_FILE = /\.md$|^llms\.txt$/i

export class CatalogError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CatalogError'
  }
}

/** Validate and compile the kinds policy. Throws CatalogError on a malformed file. */
export function compilePolicy(policy) {
  if (!policy || policy.schema !== 'zuri-document-kinds/1') throw new CatalogError('Unsupported document kinds schema')
  const kinds = policy.kinds || {}
  const homes = new Set(Object.keys(policy.homes || {}))
  const aliases = new Map()
  for (const [id, kind] of Object.entries(kinds)) {
    for (const alias of [kind.name, ...(kind.aliases || []), id.toLowerCase()]) aliases.set(String(alias).toLowerCase(), id)
  }
  const rules = (policy.rules || []).map((rule, index) => {
    if (!kinds[rule.kind]) throw new CatalogError(`Rule ${index} names unknown kind ${rule.kind}`)
    if (!homes.has(rule.home)) throw new CatalogError(`Rule ${index} names unknown home ${rule.home}`)
    const selectors = ['path', 'prefix', 'pattern'].filter((key) => rule[key] !== undefined)
    if (selectors.length !== 1) throw new CatalogError(`Rule ${index} needs exactly one of path, prefix, pattern`)
    return { ...rule, regex: rule.pattern ? new RegExp(rule.pattern) : null }
  })
  return { kinds, rules, aliases, docTypes: new Set(policy.docTypes || []), statuses: new Set(policy.statuses || []) }
}

export function loadPolicy(root = TOOL_ROOT) {
  const file = path.join(root, POLICY_PATH)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new CatalogError(`Could not read ${POLICY_PATH}: ${error.message}`)
  }
  return compilePolicy(parsed)
}

/** First matching rule wins; no match is reported, never guessed. */
export function classifyPath(compiled, filePath) {
  for (const rule of compiled.rules) {
    const hit = rule.path !== undefined ? filePath === rule.path
      : rule.prefix !== undefined ? filePath.startsWith(rule.prefix)
        : rule.regex.test(filePath)
    if (hit) return { kind: rule.kind, home: rule.home, note: rule.note || null }
  }
  return { kind: 'UNCLASSIFIED', home: 'unclassified', note: null }
}

function unquote(value) {
  const text = String(value).trim()
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1)
  return text
}

/** Minimal frontmatter reader: top-level scalars, one `attributes:` level, and relations targets. */
export function parseFrontmatter(text) {
  const body = String(text).replace(/\r\n/g, '\n')
  if (!body.startsWith('---\n')) return null
  const end = body.indexOf('\n---', 4)
  if (end < 0) return null
  const fields = {}
  const relations = []
  let section = null
  let pendingType = null
  for (const line of body.slice(4, end).split('\n')) {
    if (/^\s*#/.test(line) || !line.trim()) continue
    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (top) {
      section = top[2] === '' ? top[1] : null
      if (top[2] !== '') fields[top[1]] = unquote(top[2])
      pendingType = null
      continue
    }
    const nested = /^\s+([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (nested && section === 'attributes') {
      if (!(nested[1] in fields)) fields[nested[1]] = unquote(nested[2])
      continue
    }
    const relType = /^\s*-\s*type:\s*(.+)$/.exec(line)
    if (relType && section === 'relations') { pendingType = unquote(relType[1]); continue }
    const relTarget = /^\s*target:\s*(.+)$/.exec(line)
    if (relTarget && section === 'relations' && pendingType) {
      relations.push({ type: pendingType, target: unquote(relTarget[1]) })
      pendingType = null
    }
  }
  return { fields, relations }
}

function normalizeSubject(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function headings(body) {
  const out = []
  let fenced = false
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    if (/^```/.test(line)) { fenced = !fenced; continue }
    if (fenced) continue
    const match = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match) out.push(match[2])
    if (out.length >= 12) break
  }
  return out
}

function summary(body) {
  const withoutFrontmatter = body.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '')
  for (const paragraph of withoutFrontmatter.split(/\n\s*\n/)) {
    const text = paragraph.trim()
    if (text && !/^(#|\||```|>|<|-\s|\*\s)/.test(text)) return text.replace(/\s+/g, ' ').slice(0, 300)
  }
  return ''
}

/**
 * Build the catalog from an explicit file list and a reader. Pure: no git, no disk.
 * `registryByPath` maps a repo path to a canonical record id (K2).
 */
export function buildCatalog({ files, read, policy, registryByPath = new Map() }) {
  const documents = []
  for (const filePath of [...files].sort()) {
    if (!DOCUMENT_FILE.test(filePath)) continue
    let text
    try { text = read(filePath) } catch { continue }
    if (typeof text !== 'string') continue
    const parsed = parseFrontmatter(text)
    const fields = parsed?.fields || {}
    const classified = classifyPath(policy, filePath)
    // A generator's own marker beats the path: feature design/verification pages live under docs/features/ but are K18.
    if (fields.doc_type === 'generated-view') Object.assign(classified, { kind: 'K18', home: 'generated' })
    const title = fields.title || headings(text)[0] || path.basename(filePath)
    const relations = parsed?.relations || []
    documents.push({
      path: filePath,
      kind: classified.kind,
      home: classified.home,
      title,
      id: fields.id || registryByPath.get(filePath) || null,
      registryId: registryByPath.get(filePath) || null,
      docType: fields.doc_type || null,
      status: fields.status || null,
      sourceOfTruth: 'source_of_truth' in fields ? fields.source_of_truth === 'true' : null,
      domain: fields.domain || null,
      subject: normalizeSubject(fields.subject || title),
      supersedes: relations.filter((r) => r.type === 'supersedes').map((r) => r.target).sort(),
      supersededBy: fields.superseded_by && fields.superseded_by !== 'null' ? fields.superseded_by : null,
      relations: relations.map((r) => r.target).sort(),
      headings: headings(text),
      summary: summary(text),
      hasFrontmatter: Boolean(parsed),
    })
  }
  return { schema: 'zuri-document-catalog/1', count: documents.length, documents }
}

function gitFiles(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { maxBuffer: 256 * 1024 * 1024 })
  return out.toString('utf8').split('\0').filter(Boolean)
}

function registryMap(root) {
  const file = path.join(root, REGISTRY_INDEX)
  if (!existsSync(file)) return new Map()
  const index = JSON.parse(readFileSync(file, 'utf8'))
  return new Map((index.records || []).filter((r) => r.path).map((r) => [r.path, `${r.namespace}:${r.id}`]))
}

export function buildRepositoryCatalog(root = TOOL_ROOT) {
  const policy = loadPolicy(root)
  const files = gitFiles(root).filter((f) => existsSync(path.join(root, f)))
  return {
    policy,
    catalog: buildCatalog({
      files,
      read: (f) => readFileSync(path.join(root, f), 'utf8'),
      policy,
      registryByPath: registryMap(root),
    }),
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2)
  try {
    const { catalog } = buildRepositoryCatalog(TOOL_ROOT)
    if (args.includes('--write')) {
      writeFileSync(path.join(TOOL_ROOT, CATALOG_PATH), `${JSON.stringify(catalog, null, 2)}\n`)
      console.log(`Wrote ${CATALOG_PATH} (${catalog.count} documents, ignored build output).`)
    } else {
      const byKind = {}
      for (const d of catalog.documents) byKind[d.kind] = (byKind[d.kind] || 0) + 1
      console.log(`${catalog.count} documents`)
      for (const [kind, n] of Object.entries(byKind).sort()) console.log(`  ${kind}: ${n}`)
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
