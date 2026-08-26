#!/usr/bin/env node
// Self-plan generator (ADR-009 §D5, dogfood) — turn the governance IR
// (docs/.doc-graph.json) into a write IR (a PlanEnvelope) so Zuri's own roadmap +
// decision lineage can be imported into Zuri's Project Manager and rendered on the
// existing WBS + /dependencies views. Pure: reads the graph, writes an envelope. The
// commit goes through the real intake pipeline (BR-009), never here.
//
// Usage: node scripts/self-plan.mjs  →  contracts/zuri-v2-self-plan.json
// @tested tests/unit/self-plan-generator.test.js, tests/unit/contract-plan-artifacts.test.js

import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { EXECUTION_MODE_CONTRACTS } from '../src/lib/validation/enums.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GRAPH = path.join(ROOT, 'docs', '.doc-graph.json')
const OUT = path.join(ROOT, 'contracts', 'zuri-v2-self-plan.json')

// The governance plan is delivery work about this repository, so every workstream
// runs in one mode and takes its vocabulary from that mode's contract — never from
// strings typed here (CLAUDE.md: enums are never hand-copied). A governance node is
// an item of the only kind this mode has for "a unit of work someone did": TASK.
// What KIND of governance record it is stays in `metadata.kind`, which is where the
// distinction was always read from; `subtype` never carried it for any consumer.
//
// This used to emit `APPROVAL` for an ADR and `DELIVERABLE` for a document, which
// belong to BUSINESS_EXPANSION and PRODUCT_LAUNCH respectively. `validatePlanSemantics`
// rejects both in a SOFTWARE_SPRINT workstream, so the artifact this generator exists
// to produce could never be imported through the pipeline its own header names.
// `assertModeVocabulary()` below now makes that unwritable rather than undiscovered.
const MODE = 'SOFTWARE_SPRINT'
const MODE_CONTRACT = EXECUTION_MODE_CONTRACTS[MODE]
const ITEM_SUBTYPE = 'TASK'

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

/**
 * Refuse to write an envelope this repository's own intake would reject.
 *
 * The generator and the validator read the SAME source of truth
 * (`EXECUTION_MODE_CONTRACTS`), so this cannot drift from the pipeline: a mode whose
 * vocabulary changes tomorrow changes both sides at once. Throwing here — rather than
 * discovering it at import time, or never — is the point: a generated artifact that
 * cannot be imported is a broken artifact, not a warning.
 */
export function assertModeVocabulary(envelope) {
  for (const ws of envelope.workstreams) {
    const contract = EXECUTION_MODE_CONTRACTS[ws.executionMode]
    if (!contract) throw new Error(`self-plan: workstream ${ws.code} uses unknown executionMode ${ws.executionMode}`)
    if (ws.progressStrategy !== contract.progressStrategy) {
      throw new Error(`self-plan: workstream ${ws.code} (${ws.executionMode}) requires progressStrategy ${contract.progressStrategy}, got ${ws.progressStrategy}`)
    }
    for (const item of ws.items || []) {
      if (!contract.itemSubtypes.includes(item.subtype)) {
        throw new Error(`self-plan: item ${item.code} subtype "${item.subtype}" is not allowed in ${ws.executionMode} (allowed: ${contract.itemSubtypes.join(', ')})`)
      }
    }
    for (const container of ws.containers || []) {
      if (!contract.containerSubtypes.includes(container.subtype)) {
        throw new Error(`self-plan: container ${container.code} subtype "${container.subtype}" is not allowed in ${ws.executionMode} (allowed: ${contract.containerSubtypes.join(', ')})`)
      }
    }
  }
  return envelope
}

/** Pure: governance IR (doc-graph) → PlanEnvelope. No filesystem, no clock. */
export function buildSelfPlan(g) {
  const nodeById = new Map(g.nodes.map((n) => [n.id, n]))
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
        code, subtype: ITEM_SUBTYPE, title: `${n.id.slice(4)} — ${n.label}`, status, weight: 1,
        // symbolLink (ADR-009 §D4): the code that implements + tests that verify, carried as data.
        metadata: { kind: 'requirement', req: n.id.slice(4), family: n.family, codeRefs: refs, tests, source: 'doc-graph' },
      })
    } else if (n.type === 'adr') {
      bucket('governance', {
        code, subtype: ITEM_SUBTYPE, title: n.title || n.id, status: 'DONE', weight: 1,
        metadata: { kind: 'adr', doc: n.path, source: 'doc-graph' },
      })
    } else {
      bucket('governance', {
        code, subtype: ITEM_SUBTYPE, title: n.title || n.id,
        status: n.status === 'superseded' ? 'CANCELLED' : 'DONE', weight: 1,
        metadata: { kind: 'document', doc: n.path, source: 'doc-graph' },
      })
    }
  }

  const workstreams = [...streams.entries()]
    .sort((a, b) => (a[0] === 'governance' ? -1 : b[0] === 'governance' ? 1 : a[0].localeCompare(b[0])))
    .map(([mod, items]) => ({
      code: `WST-GOV-${mod.toUpperCase().replace(/[^A-Z0-9]/g, '-')}`,
      name: MOD_LABEL[mod] || mod,
      executionMode: MODE,
      progressStrategy: MODE_CONTRACT.progressStrategy,
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

  return assertModeVocabulary({
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
  })
}

// CLI only — importing this module (tests, other tooling) must never write a file.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const envelope = buildSelfPlan(JSON.parse(readFileSync(GRAPH, 'utf8')))
  writeFileSync(OUT, JSON.stringify(envelope, null, 2) + '\n')
  const itemCount = envelope.workstreams.reduce((s, w) => s + w.items.length, 0)
  console.log(`wrote ${path.relative(ROOT, OUT)} — ${envelope.workstreams.length} workstreams · ${itemCount} items · ${envelope.dependencies.length} lineage deps`)
}
