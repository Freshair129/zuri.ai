#!/usr/bin/env node
// Self-plan generator (ADR-009 §D5, dogfood) — turn the governance IR
// (docs/.doc-graph.json) into a write IR (a PlanEnvelope) so Zuri's own roadmap +
// decision lineage can be imported into Zuri's Project Manager and rendered on the
// existing WBS + /dependencies views. Pure: reads the graph, writes an envelope. The
// commit goes through the real intake pipeline (BR-009), never here.
//
// Usage: node scripts/self-plan.mjs  →  contracts/zuri-v2-self-plan.json

import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GRAPH = path.join(ROOT, 'docs', '.doc-graph.json')
const OUT = path.join(ROOT, 'contracts', 'zuri-v2-self-plan.json')

const g = JSON.parse(readFileSync(GRAPH, 'utf8'))
const nodeById = new Map(g.nodes.map((n) => [n.id, n]))

// Which subsystem a code file belongs to — the WBS groups requirements by it.
const moduleOf = (p) =>
  /modules\/([^/]+)\//.exec(p)?.[1] || (p.startsWith('prisma/') ? 'seed' : 'shell')

// A stable, unique WorkItem code per graph node (external id → internal is the pipeline's job).
const planCode = (id) => {
  const i = id.indexOf(':')
  const prefix = id.slice(0, i)
  const rest = id.slice(i + 1)
  if (prefix === 'req') return `GOV-${rest}`
  if (prefix === 'spec') return `GOV-${/ADR-\d{3}/.exec(rest)?.[0] || rest}`
  return `GOV-DOC-${rest}`
}

const lineage = g.edges.filter((e) => e.type === 'supersedes' || e.type === 'relates')
const implementsEdges = g.edges.filter((e) => e.type === 'implements')
const verifiesEdges = g.edges.filter((e) => e.type === 'verifies')

// Items = every FR + every node that is an endpoint of a lineage edge (so all
// dependency refs resolve). Deduped by node id.
const wanted = new Set()
for (const n of g.nodes) if (n.type === 'requirement' && n.family === 'FR') wanted.add(n.id)
for (const e of lineage) { wanted.add(e.from); wanted.add(e.to) }

const codeRefsOf = (id) => implementsEdges.filter((e) => e.to === id).map((e) => e.from.replace('code:', ''))
const testsOf = (id) => verifiesEdges.filter((e) => e.to === id).map((e) => e.from.replace('test:', ''))

// Build items, bucketed into workstreams.
const streams = new Map() // module -> items[]
const bucket = (mod, item) => { if (!streams.has(mod)) streams.set(mod, []); streams.get(mod).push(item) }

for (const id of wanted) {
  const n = nodeById.get(id)
  if (!n) continue
  const code = planCode(id)
  if (n.type === 'requirement') {
    const refs = codeRefsOf(id)
    const tests = testsOf(id)
    const mod = refs.length ? mostCommon(refs.map(moduleOf)) : 'shell'
    const status = n.declared === 'done' ? 'DONE' : n.declared === 'planned' ? 'PLANNED' : 'IN_PROGRESS'
    bucket(mod, {
      code, subtype: 'TASK', title: `${n.id.slice(4)} — ${n.label}`, status, weight: 1,
      // symbolLink (ADR-009 §D4): the code that implements + tests that verify, carried as data.
      metadata: { kind: 'requirement', req: n.id.slice(4), family: n.family, codeRefs: refs, tests, source: 'doc-graph' },
    })
  } else if (n.type === 'adr') {
    bucket('governance', {
      code, subtype: 'APPROVAL', title: n.title || n.id, status: 'DONE', weight: 1,
      metadata: { kind: 'adr', doc: n.path, source: 'doc-graph' },
    })
  } else {
    bucket('governance', {
      code, subtype: 'DELIVERABLE', title: n.title || n.id,
      status: n.status === 'superseded' ? 'CANCELLED' : 'DONE', weight: 1,
      metadata: { kind: 'document', doc: n.path, source: 'doc-graph' },
    })
  }
}

function mostCommon(arr) {
  const c = {}
  let best = arr[0]
  for (const x of arr) { c[x] = (c[x] || 0) + 1; if (c[x] > (c[best] || 0)) best = x }
  return best
}

const MOD_LABEL = {
  governance: 'Governance & Decisions', 'project-manager': 'Project Manager',
  identity: 'Identity', crm: 'CRM / Backend Slice', agent: 'Agent', knowledge: 'Knowledge (GKS)',
  shell: 'Shell & UI', seed: 'Seed & Data',
}
const workstreams = [...streams.entries()]
  .sort((a, b) => (a[0] === 'governance' ? -1 : b[0] === 'governance' ? 1 : a[0].localeCompare(b[0])))
  .map(([mod, items]) => ({
    code: `WST-GOV-${mod.toUpperCase().replace(/[^A-Z0-9]/g, '-')}`,
    name: MOD_LABEL[mod] || mod,
    executionMode: 'SOFTWARE_SPRINT',
    progressStrategy: 'TASK_WEIGHT',
    progressWeight: 1,
    items: items.sort((a, b) => a.code.localeCompare(b.code)),
  }))

// Dependencies from lineage edges (both endpoints are items, guaranteed by `wanted`).
const dependencies = lineage
  .map((e) => ({
    sourceRef: planCode(e.from),
    targetRef: planCode(e.to),
    type: e.type === 'supersedes' ? 'SUPERSEDES' : 'DERIVES_FROM',
  }))
  .filter((d) => d.sourceRef !== d.targetRef)

const envelope = {
  schemaVersion: '1.1',
  generatedBy: 'scripts/self-plan.mjs (dogfood: Zuri governance IR → PM)',
  scope: { portfolioCode: 'PF-001', workspaceCode: 'WS-PLATFORM' },
  project: {
    code: 'PRJ-ZURI-GOV',
    name: 'Zuri V2 — Governance (self)',
    description: 'Auto-generated from docs/.doc-graph.json (ADR-009 dogfood): every FR + decision, with supersede/derive lineage and code/test symbolLinks. Re-run scripts/self-plan.mjs to refresh.',
    type: 'SOFTWARE',
    status: 'ACTIVE',
  },
  workstreams,
  dependencies,
}

writeFileSync(OUT, JSON.stringify(envelope, null, 2) + '\n')
const itemCount = workstreams.reduce((s, w) => s + w.items.length, 0)
console.log(`wrote ${path.relative(ROOT, OUT)} — ${workstreams.length} workstreams · ${itemCount} items · ${dependencies.length} lineage deps`)
