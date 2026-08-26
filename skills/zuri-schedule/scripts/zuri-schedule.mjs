#!/usr/bin/env node
// Apply a dated schedule to work that ALREADY exists in Zuri.
//
//   node zuri-schedule.mjs plan  <schedule.json>   # resolve + show what would change (writes nothing)
//   node zuri-schedule.mjs apply <schedule.json>   # PATCH existing rows, POST only what --create allows
//
// Flags: --create   allow creating milestones that do not exist yet (items are never created here)
//        --json     machine-readable output
//
// Zuri has no calendar or appointment entity. A "schedule" is dates on real work:
// Milestone.targetAt, Gate.targetAt, WorkItem.startAt/targetAt, WorkContainer.startAt/targetAt.
// Matching is by `code`, so re-running this file is an update, never a duplicate.

import { readFileSync } from 'node:fs'
import { api, config, die } from '../../lib/zuri-client.mjs'

const argv = process.argv.slice(2)
const command = argv[0]
const file = argv.slice(1).find((a) => !a.startsWith('--'))
const allowCreate = argv.includes('--create')
const asJson = argv.includes('--json')
const cfg = config()

if (!['plan', 'apply'].includes(command) || !file) {
  die('usage: zuri-schedule.mjs <plan|apply> <schedule.json> [--create] [--json]')
}

const schedule = JSON.parse(readFileSync(file, 'utf8'))
if (schedule.artifact !== 'zuri.schedule/1') die('schedule artifact must declare "artifact": "zuri.schedule/1"')
if (!schedule.projectId) die('schedule.projectId is required — a schedule always lands inside one Project')
if (!Array.isArray(schedule.entries) || !schedule.entries.length) die('schedule.entries must hold at least one entry')

// startAt exists on items and containers only; milestones and gates carry targetAt.
const KINDS = { milestone: false, gate: false, item: true, container: true }
for (const entry of schedule.entries) {
  if (!(entry.kind in KINDS)) die(`entry "${entry.code || '(no code)'}": kind must be one of ${Object.keys(KINDS).join(', ')}`)
  if (!entry.code) die('every entry needs a stable code — it is the match key that keeps re-runs idempotent')
  if (!entry.targetAt) die(`entry "${entry.code}": targetAt is required (ISO 8601, with the offset the business actually uses)`)
  for (const field of ['startAt', 'targetAt']) {
    if (entry[field] && Number.isNaN(Date.parse(entry[field]))) die(`entry "${entry.code}": ${field} is not a valid ISO 8601 timestamp`)
  }
  if (entry.startAt && !KINDS[entry.kind]) die(`entry "${entry.code}": a ${entry.kind} carries targetAt only`)
  if (entry.startAt && Date.parse(entry.startAt) > Date.parse(entry.targetAt)) die(`entry "${entry.code}": startAt is after targetAt`)
}

const mg = await api(`/api/milestones?projectId=${encodeURIComponent(schedule.projectId)}`, { cfg })
if (!mg.ok) die(`Could not read milestones/gates: HTTP ${mg.status} ${mg.text.slice(0, 200)}`)
// The work-breakdown tree is the complete, unpaginated source for containers and items.
const tree = await api(`/api/projects/${encodeURIComponent(schedule.projectId)}/tree`, { cfg })
if (!tree.ok) die(`Could not read the project tree: HTTP ${tree.status} ${tree.text.slice(0, 200)}`)

const containers = new Map()
const items = new Map()
const walkContainer = (c) => {
  containers.set(c.code, c)
  for (const i of c.items || []) items.set(i.code, i)
  for (const child of c.children || []) walkContainer(child)
}
for (const ws of tree.json?.workstreams || []) {
  for (const c of ws.containers || []) walkContainer(c)
  for (const i of ws.items || []) items.set(i.code, i)
}

const byCode = {
  milestone: new Map((mg.json?.milestones || []).map((r) => [r.code, r])),
  gate: new Map((mg.json?.gates || []).map((r) => [r.code, r])),
  item: items,
  container: containers,
}
const endpoint = { milestone: '/api/milestones', gate: '/api/gates', item: '/api/work', container: '/api/containers' }

const actions = schedule.entries.map((entry) => {
  const existing = byCode[entry.kind].get(entry.code)
  const patch = {}
  if (entry.startAt && KINDS[entry.kind]) patch.startAt = entry.startAt
  if (entry.targetAt) patch.targetAt = entry.targetAt
  if (entry.title && existing && entry.title !== existing.title) patch.title = entry.title
  if (!existing) {
    return {
      code: entry.code,
      kind: entry.kind,
      action: entry.kind === 'milestone' && allowCreate ? 'CREATE' : 'SKIP',
      reason: entry.kind === 'milestone'
        ? (allowCreate ? 'not found — will be created' : 'not found — re-run with --create, or commit it in a PlanEnvelope first')
        : 'not found — create it through a PlanEnvelope (zuri-execution-plan), never here',
      entry,
    }
  }
  const changed = Object.entries(patch).filter(([k, v]) => {
    const current = existing[k]
    if (k === 'title') return current !== v
    return (current ? new Date(current).toISOString() : null) !== new Date(v).toISOString()
  })
  return {
    code: entry.code,
    kind: entry.kind,
    id: existing.id,
    action: changed.length ? 'PATCH' : 'UNCHANGED',
    patch: Object.fromEntries(changed),
    entry,
  }
})

const results = []
if (command === 'apply') {
  for (const a of actions) {
    if (a.action === 'PATCH') {
      const res = await api(`${endpoint[a.kind]}/${a.id}`, { method: 'PATCH', body: a.patch, cfg })
      results.push({ ...a, status: res.status, ok: res.ok, error: res.ok ? null : res.text.slice(0, 200) })
    } else if (a.action === 'CREATE') {
      const body = {
        projectId: schedule.projectId,
        workstreamId: a.entry.workstreamId ?? null,
        code: a.entry.code,
        title: a.entry.title || a.entry.code,
        targetAt: a.entry.targetAt,
        ...(a.entry.weight === undefined ? {} : { weight: a.entry.weight }),
      }
      const res = await api(endpoint[a.kind], { method: 'POST', body, cfg })
      results.push({ ...a, status: res.status, ok: res.ok, error: res.ok ? null : res.text.slice(0, 200) })
    } else {
      results.push({ ...a, ok: a.action === 'UNCHANGED' })
    }
  }
}

const output = { command, projectId: schedule.projectId, actions: command === 'apply' ? results : actions }
if (asJson) {
  console.log(JSON.stringify(output, null, 2))
} else {
  for (const a of output.actions) {
    const detail = a.action === 'PATCH' ? JSON.stringify(a.patch) : (a.reason || '')
    const mark = a.ok === false ? 'FAIL' : a.action
    console.log(`${String(mark).padEnd(9)} ${a.kind.padEnd(9)} ${a.code} ${detail} ${a.error ? `-> ${a.error}` : ''}`)
  }
  const skipped = output.actions.filter((a) => a.action === 'SKIP')
  if (skipped.length) console.log(`\n${skipped.length} entry/entries were skipped — nothing was invented for them.`)
}
process.exitCode = output.actions.some((a) => a.ok === false) ? 1 : 0
