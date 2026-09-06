// @spec docs/GOVERNANCE-LINK-METADATA.md — stable identity and typed links.
// @tested tests/unit/doc-links.test.js
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { parseDocument } from 'yaml'
import Ajv from 'ajv'

const schema = JSON.parse(readFileSync(new URL('../contracts/doc-link-metadata.schema.json', import.meta.url), 'utf8'))
const validate = new Ajv({ allErrors: true }).compile(schema)
const types = { relates_to: 'relates', references: 'references', supersedes: 'supersedes', superseded_by: 'supersedes' }
const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const control = /^\*\*(Relates to|Supersedes(?:\s*\([^)]*\))?|Superseded by):\*\*\s*(.+)$/gim
const clean = (s) => s.replace(/\r\n?/g, '\n')
function withoutFences(s) {
  let fence = null
  return clean(s).replace(frontmatter, '').split('\n').map(line => {
    if (fence) {
      if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = null
      return ''
    }
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (opening) { fence = opening[1]; return '' }
    return line
  }).join('\n')
}
const prose = (s) => withoutFences(s).replace(/(`+)[^\n]*?\1/g, '')
const headingId = (s) => s.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-')
const identity = (s) => s.replaceAll('\\', '/')
export const hasLinkMetadata = body => /^relations\s*:/m.test(frontmatter.exec(body)?.[1] || '')

/** Resolve metadata and prose against real graph identities, never guessed paths. */
export function collectDocumentLinks(documents, nodes) {
  const findings = [], edges = []
  const byGraphId = new Map(nodes.map(n => [n.id, n]))
  const ambiguousGraphIds = new Set(nodes.filter((n, i) => nodes.some((other, j) => i !== j && other.id === n.id && other.path !== n.path)).map(n => n.id))
  const aliases = new Map(), explicit = new Map(), byPath = new Map()
  const fail = (doc, message) => findings.push({ path: doc.path, message })
  const register = (key, node) => {
    if (!aliases.has(key)) aliases.set(key, new Set())
    aliases.get(key).add(node.id)
  }
  const parsed = documents.map(doc => {
    const fm = frontmatter.exec(doc.body)?.[1] || ''
    let metadata = null
    // Old frontmatter has many unrelated dialects: validate only link opt-ins.
    if (hasLinkMetadata(doc.body)) {
      try {
        const yaml = parseDocument(fm, { schema: 'core', uniqueKeys: true })
        if (yaml.errors.length || yaml.warnings.length) throw Error([...yaml.errors, ...yaml.warnings].map(e => e.message).join('; '))
        metadata = yaml.toJS({ maxAliasCount: 20 })
        if (!validate(metadata)) throw Error(new Ajv().errorsText(validate.errors))
      } catch (err) { fail(doc, `Invalid link metadata: ${err.message}`); metadata = null }
    }
    const node = byGraphId.get(doc.nodeId)
    if (!node) { fail(doc, 'Document has no graph node'); return { ...doc, metadata } }
    byPath.set(doc.path, { ...doc, metadata, node })
    register(doc.path, node)
    register(path.posix.basename(doc.path, '.md'), node)
    const adr = /^ADR-\d{3}(?=-|\.md$)/.exec(path.posix.basename(doc.path))?.[0]
    if (adr) register(`ZAI:${adr}`, node)
    if (metadata) {
      for (const key of [metadata.id, ...(metadata.aliases || [])]) {
        if (explicit.has(key) && explicit.get(key) !== doc.path) fail(doc, `Duplicate explicit ID or alias: ${key}`)
        explicit.set(key, doc.path)
        register(key, node)
      }
    }
    return { ...doc, metadata, node }
  })
  for (const n of nodes) {
    if (/^(req|feat):/.test(n.id)) register(`ZAI:${n.id.slice(n.id.indexOf(':') + 1)}`, n)
    register(n.id, n)
    if (n.identity_migration) register(n.identity_migration.previous_id, n)
  }
  for (const [key] of explicit) if (aliases.get(key)?.size > 1) findings.push({ path: '', message: `Explicit ID collides with registered identity: ${key}` })

  function resolve(raw, doc, strict = true) {
    let target = raw.trim()
    if (target.startsWith('[[') && target.endsWith(']]')) target = target.slice(2, -2).split('|')[0]
    const hash = target.indexOf('#')
    let fragment = hash < 0 ? '' : target.slice(hash + 1)
    target = hash < 0 ? target : target.slice(0, hash)
    try { target = decodeURIComponent(target); fragment = decodeURIComponent(fragment) } catch { if (strict) fail(doc, `Invalid encoded target: ${raw}`); return null }
    let matches
    if (!target && fragment) matches = new Set([doc.nodeId])
    else if (aliases.has(target)) matches = aliases.get(target)
    else if (/\.md$/i.test(target)) matches = aliases.get(path.posix.normalize(path.posix.join(path.posix.dirname(doc.path), identity(target))))
    // Bare global IDs are allowed for legacy controls, with an exact full match.
    else if (/^(ADR|FR|NFR|BR|SEC|SDD|FEAT)-\d{3}$/.test(target)) matches = aliases.get(`ZAI:${target}`)
    if (!matches || matches.size !== 1) {
      if (strict || matches?.size > 1) fail(doc, `${matches?.size > 1 ? 'Ambiguous' : 'Missing'} link target: ${raw}`)
      return null
    }
    const id = [...matches][0], node = byGraphId.get(id)
    if (ambiguousGraphIds.has(id)) { if (strict) fail(doc, `Ambiguous graph identity: ${raw}`); return null }
    if (fragment) {
      const body = byPath.get(node?.path)?.body
      const headings = new Set()
      for (const m of withoutFences(body || '').matchAll(/^ {0,3}#{1,6}\s+(.+)$/gm)) {
        const base = headingId(m[1])
        let candidate = base, suffix = 0
        while (headings.has(candidate)) candidate = `${base}-${++suffix}`
        headings.add(candidate)
      }
      if (!headings.has(fragment)) { if (strict) fail(doc, `Missing heading: ${raw}`); return null }
    }
    return id
  }
  const put = (from, to, type, source) => {
    if (from === to) return
    if (!edges.some(e => e.from === from && e.to === to && e.type === type)) edges.push({ from, to, type, source, status: 'current' })
  }
  for (const doc of parsed) {
    if (!doc.node) continue
    const declarations = new Map()
    for (const relation of doc.metadata?.relations || []) {
      const to = resolve(relation.target, doc)
      if (!to) continue
      if (!declarations.has(relation.type)) declarations.set(relation.type, new Set())
      declarations.get(relation.type).add(to)
      const reverse = relation.type === 'superseded_by'
      put(reverse ? to : doc.nodeId, reverse ? doc.nodeId : to, types[relation.type], 'metadata')
    }
    const text = prose(doc.body)
    if (doc.metadata) for (const match of text.matchAll(control)) {
      const kind = { 'relates to': 'relates_to', supersedes: 'supersedes', 'superseded by': 'superseded_by' }[match[1].toLowerCase().replace(/\s*\([^)]*\)/, '')]
      const tokens = [...match[2].matchAll(/\[\[([^\]]+)\]\]|\[[^\]]+\]\(([^)]+)\)|((?:[A-Z][A-Z0-9_-]*:)?(?:ADR|FR|NFR|BR|SEC|SDD|FEAT)-\d{3}(?:-P\d+)?)/g)]
      const actual = new Set(tokens.map(m => resolve(m[1]?.split('|')[0] || m[2] || m[3], doc)).filter(Boolean))
      const wanted = declarations.get(kind) || new Set()
      if (actual.size !== wanted.size || [...actual].some(id => !wanted.has(id))) fail(doc, `Metadata conflicts with legacy ${match[1]}`)
    }
    // The existing generator owns old Markdown/ID controls; resolve new wiki
    // syntax here so its type is preserved even before metadata adoption.
    if (!doc.metadata) for (const match of text.matchAll(control)) {
      const reverse = match[1].toLowerCase() === 'superseded by'
      const type = match[1].toLowerCase() === 'relates to' ? 'relates' : 'supersedes'
      for (const wiki of match[2].matchAll(/\[\[([^\]\n]+)\]\]/g)) {
        const to = resolve(wiki[1].split('|')[0], doc)
        if (to) put(reverse ? to : doc.nodeId, reverse ? doc.nodeId : to, type, 'wikilink')
      }
    }
    const body = text.replace(control, '')
    for (const m of body.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
      const to = resolve(m[1].split('|')[0], doc)
      if (to && !edges.some(e => e.from === doc.nodeId && e.to === to)) put(doc.nodeId, to, 'references', 'wikilink')
    }
    for (const m of body.matchAll(/(?<!!)\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(m[1]) || !m[1].split('#')[0].endsWith('.md')) continue
      const to = resolve(m[1], doc, false)
      if (to && !edges.some(e => e.from === doc.nodeId && e.to === to)) put(doc.nodeId, to, 'references', 'markdown')
    }
  }
  return { edges, findings }
}

/** Markdown is the portable crosslink view; incoming links are derived. */
export function documentLinksView(nodes, edges) {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const allowed = new Set(['references', 'relates', 'supersedes'])
  const selected = edges.filter(e => allowed.has(e.type) && byId.get(e.from)?.path?.endsWith('.md'))
  const escape = s => String(s).replace(/[\[\]|\n\r]/g, ' ')
  const link = id => {
    const n = byId.get(id), p = n?.path || n?.defined_in
    if (!p) return escape(id)
    return `[${escape(n.title || id)}](${encodeURI(path.posix.relative('docs', p))})`
  }
  const docs = nodes.filter(n => n.path?.endsWith('.md') && selected.some(e => e.from === n.id || e.to === n.id)).sort((a, b) => a.path.localeCompare(b.path))
  const content = '# Document Links\n\n**Status:** Auto-generated\n\nGenerated by scripts/doc-graph.mjs. Do not hand-edit.\n\n' + docs.map(n => {
    const out = selected.filter(e => e.from === n.id).sort((a, b) => (a.type + a.to).localeCompare(b.type + b.to))
    const incoming = selected.filter(e => e.to === n.id).sort((a, b) => (a.type + a.from).localeCompare(b.type + b.from))
    return `## ${escape(n.title || n.id)}\n\nSource: ${link(n.id)}\n\n` +
      (out.length ? out.map(e => `- ${e.type}: ${link(e.to)}`).join('\n') + '\n\n' : '') +
      (incoming.length ? 'Backlinks:\n\n' + incoming.map(e => `- ${link(e.from)} (${e.type})`).join('\n') + '\n\n' : '')
  }).join('')
  return content.trimEnd() + '\n'
}
