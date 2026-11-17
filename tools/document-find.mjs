#!/usr/bin/env node
// docs:find — "does this already exist?" (ADR-118 D2). Pure read; builds the
// catalog in memory from tracked files, so it needs no prior govern run.
// A hit is evidence of presence only. A miss is never proof of absence
// (AGENTS.md section 21): enumerate the intended home before claiming nothing exists.
//
// @spec ADR-118, docs/plans/DOCS-ARCHITECTURE-REDESIGN-PROPOSAL-20261113.md
// @tested tools/tests/document-catalog.test.mjs

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildRepositoryCatalog } from './document-catalog.mjs'

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOME_WEIGHT = { write: 1, tolerated: 0.9, legacy: 0.8, external: 0.8, frozen: 0.5, generated: 0.5, local: 0.3, unclassified: 0.7 }

export function parseFindArguments(argv) {
  const options = { terms: [], id: null, kind: null, domain: null, pathPrefix: null, limit: 15, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`${arg} needs a value`)
      i += 1
      return argv[i]
    }
    if (arg === '--id') options.id = next()
    else if (arg === '--kind') options.kind = next()
    else if (arg === '--domain') options.domain = next()
    else if (arg === '--path') options.pathPrefix = next().replace(/\\/g, '/')
    else if (arg === '--limit') {
      const raw = next()
      if (!/^[1-9]\d*$/.test(raw)) throw new Error('--limit needs a positive integer')
      options.limit = Number(raw)
    }
    else if (arg === '--json') options.json = true
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`)
    else options.terms.push(arg)
  }
  return options
}

function tokens(terms) {
  return [...new Set(terms.join(' ').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1))]
}

function resolveKind(policy, value) {
  if (!value) return null
  const id = policy.aliases.get(String(value).toLowerCase())
  if (!id) throw new Error(`Unknown kind "${value}". Known: ${[...policy.aliases.keys()].sort().join(', ')}`)
  return id
}

/** Rank catalog documents for an options object. Pure; no I/O. */
export function findDocuments(catalog, policy, options) {
  const kind = resolveKind(policy, options.kind)
  const words = tokens(options.terms)
  const idQuery = options.id ? options.id.toLowerCase().replace(/^zai:/, '') : null
  const results = []
  for (const doc of catalog.documents) {
    if (kind && doc.kind !== kind) continue
    if (options.domain && doc.domain !== options.domain) continue
    if (options.pathPrefix && !doc.path.startsWith(options.pathPrefix)) continue
    const reasons = []
    let score = 0
    if (idQuery) {
      const ids = [doc.id, doc.registryId].filter(Boolean).map((v) => v.toLowerCase().replace(/^zai:/, ''))
      const base = path.basename(doc.path).toLowerCase()
      if (ids.includes(idQuery)) { score += 100; reasons.push('id') }
      else if (base.startsWith(idQuery)) { score += 40; reasons.push('filename id') }
      else continue
    }
    let matched = 0
    if (words.length) {
      const pathText = doc.path.toLowerCase()
      const title = (doc.title || '').toLowerCase()
      const subject = doc.subject || ''
      const heads = doc.headings.join(' ').toLowerCase()
      const idText = [doc.id, doc.registryId, ...doc.relations].filter(Boolean).join(' ').toLowerCase()
      const sum = (doc.summary || '').toLowerCase()
      for (const word of words) {
        let hit = false
        if (title.includes(word)) { score += 10; hit = true; reasons.push(`title:${word}`) }
        if (pathText.includes(word)) { score += 8; hit = true; reasons.push(`path:${word}`) }
        if (subject.includes(word)) { score += 6; hit = true }
        if (heads.includes(word)) { score += 4; hit = true; reasons.push(`heading:${word}`) }
        if (sum.includes(word)) { score += 2; hit = true }
        if (idText.includes(word)) { score += 5; hit = true; reasons.push(`id/relation:${word}`) }
        if (hit) matched += 1
      }
      if (matched === 0 && !idQuery) continue
      score += matched * 20
    }
    if (!words.length && !idQuery && !options.pathPrefix && !kind && !options.domain) continue
    const stem = path.basename(doc.path).toLowerCase().replace(/\.[a-z]+$/, '')
    for (const word of words) if (stem.includes(word)) score += 6
    const weight = (HOME_WEIGHT[doc.home] ?? 0.7) * (doc.sourceOfTruth === true ? 1.5 : 1) * (['superseded', 'retired'].includes(doc.status) ? 0.6 : 1)
    results.push({ doc, score: score * weight, matched, reasons: [...new Set(reasons)].slice(0, 5) })
  }
  results.sort((a, b) => b.matched - a.matched || b.score - a.score || a.doc.path.localeCompare(b.doc.path))
  return { words, kind, results }
}

function describe(row) {
  const d = row.doc
  const flags = [d.kind, d.home, d.status || 'no-status', d.sourceOfTruth === true ? 'SOT' : null, d.domain].filter(Boolean).join(' · ')
  return `${d.path}\n    ${flags}\n    ${d.title}${row.reasons.length ? `\n    matched: ${row.reasons.join(', ')}` : ''}`
}

export function renderFind(outcome, policy, options) {
  const lines = []
  const shown = outcome.results.slice(0, options.limit)
  if (!shown.length) lines.push('No catalogued document matched. A miss is not proof of absence: enumerate the intended home (git ls-files <home>) before concluding nothing exists.')
  for (const row of shown) lines.push(describe(row))
  if (outcome.results.length > shown.length) lines.push(`... ${outcome.results.length - shown.length} more (use --limit)`)
  const kinds = [...new Set(shown.map((r) => r.doc.kind))]
  const focus = outcome.kind ? [outcome.kind] : kinds.slice(0, 3)
  for (const id of focus) {
    const info = policy.kinds[id]
    if (info) lines.push(`write home for ${id} (${info.name}): ${info.writeHome}; source of truth: ${info.sot}`)
  }
  return lines.join('\n')
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseFindArguments(process.argv.slice(2))
    if (!options.terms.length && !options.id && !options.kind && !options.domain && !options.pathPrefix) {
      console.error('usage: npm run docs:find -- "<subject words>" [--id FR-292] [--kind plan] [--domain agent] [--path docs/plans] [--limit N] [--json]')
      process.exit(2)
    }
    if (options.terms.length && !tokens(options.terms).length && !options.id && !options.pathPrefix && !options.kind && !options.domain) {
      console.error('No searchable words left in the query (single characters are ignored). Use longer words, --id, --kind, --domain or --path.')
      process.exit(2)
    }
    const { policy, catalog } = buildRepositoryCatalog(TOOL_ROOT)
    const outcome = findDocuments(catalog, policy, options)
    if (options.json) {
      console.log(JSON.stringify(outcome.results.slice(0, options.limit).map((r) => ({ path: r.doc.path, kind: r.doc.kind, home: r.doc.home, status: r.doc.status, title: r.doc.title, matched: r.reasons })), null, 2))
    } else {
      console.log(renderFind(outcome, policy, options))
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
