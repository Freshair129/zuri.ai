#!/usr/bin/env node
// Build/validate/submit a Zuri PlanEnvelope. The SERVER is the contract:
// this script never re-implements validation, it reads the published contract
// and lets `plan_dry_run` decide.
//
//   node zuri-plan.mjs vocab [--mode SOFTWARE_SPRINT] [--contract <path|url>]
//   node zuri-plan.mjs check    <plan.json> [--contract <path|url>]
//   node zuri-plan.mjs dry-run  <plan.json> [--http] [--workspace <id>]
//   node zuri-plan.mjs commit   <plan.json> [--http] [--workspace <id>]
//
// Env: ZURI_BASE_URL, ZURI_SESSION_COOKIE, ZURI_WORKSPACE_ID, ZURI_CONTRACT_PATH.

import { readFileSync } from 'node:fs'
import { api, config, mcpConnect, die } from '../../lib/zuri-client.mjs'

const argv = process.argv.slice(2)
const command = argv[0]
const positional = argv.slice(1).filter((a) => !a.startsWith('--'))
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? null : argv[i + 1]
}
const has = (name) => argv.includes(`--${name}`)
const cfg = config()

/** The per-mode vocabulary, read from the published contract — never hand-typed here. */
async function loadModeContracts() {
  const source = flag('contract') || process.env.ZURI_CONTRACT_PATH || 'contracts/plan-envelope.schema.json'
  let schema
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`Could not fetch contract from ${source}: HTTP ${res.status}`)
    schema = await res.json()
  } else {
    schema = JSON.parse(readFileSync(source, 'utf8'))
  }
  const blocks = schema?.properties?.workstreams?.items?.allOf || []
  const modes = {}
  for (const block of blocks) {
    const mode = block?.if?.properties?.executionMode?.const
    if (!mode) continue
    const then = block.then?.properties || {}
    modes[mode] = {
      progressStrategy: then.progressStrategy?.const ?? null,
      containerSubtypes: then.containers?.items?.properties?.subtype?.enum ?? [],
      itemSubtypes: then.items?.items?.properties?.subtype?.enum ?? [],
      metricKeys: Object.keys(then.items?.items?.properties?.metrics?.properties ?? {}),
    }
  }
  if (!Object.keys(modes).length) throw new Error(`No execution-mode blocks found in ${source}`)
  return { source, modes }
}

/**
 * Structural checks that need NO vocabulary — the ones a dry run would also
 * catch, run locally so an obviously broken envelope never reaches the server.
 * Vocabulary checks are added only when the contract file is reachable.
 */
function structuralErrors(plan, modes) {
  const errors = []
  const codes = new Map()
  const claim = (code, kind) => {
    if (!code) return errors.push(`${kind} is missing a code`)
    if (codes.has(code)) errors.push(`Duplicate code "${code}" (${codes.get(code)} vs ${kind})`)
    else codes.set(code, kind)
    return undefined
  }
  if (!plan?.project?.code || !plan?.project?.name) errors.push('project.code and project.name are required')
  claim(plan?.project?.code, 'project')
  if (!Array.isArray(plan?.workstreams) || plan.workstreams.length === 0) {
    errors.push('workstreams must hold at least one workstream')
  }

  if (plan?.schemaVersion === '1.2') {
    if (!plan.trace?.correlationId) errors.push('trace.correlationId is required for schemaVersion 1.2')
    if (!plan.trace?.idempotencyKey) errors.push('trace.idempotencyKey is required for schemaVersion 1.2')
    if (plan.project?.riskIds?.length) errors.push('project.riskIds must be empty — no Risk owner exists in this slice')
    for (const [key, value] of Object.entries(plan.identityRefs || {})) {
      const populated = Array.isArray(value) ? value.length > 0 : value != null
      if (populated) errors.push(`identityRefs.${key} must stay empty — supporting identity refs are unavailable in this slice`)
    }
  }

  for (const ws of plan?.workstreams || []) {
    claim(ws.code, 'workstream')
    const contract = modes?.[ws.executionMode]
    if (contract) {
      if (ws.progressStrategy !== contract.progressStrategy) {
        errors.push(`Workstream "${ws.code}" mode ${ws.executionMode} requires progressStrategy ${contract.progressStrategy}`)
      }
    } else if (modes && ws.executionMode) {
      errors.push(`Unknown executionMode "${ws.executionMode}" — expected one of ${Object.keys(modes).join(', ')}`)
    }
    const containerCodes = new Set((ws.containers || []).map((c) => c.code))
    for (const c of ws.containers || []) {
      claim(c.code, 'container')
      if (c.parentCode === c.code) errors.push(`Container "${c.code}" cannot be its own parent`)
      if (c.parentCode && !containerCodes.has(c.parentCode)) {
        errors.push(`Container "${c.code}" references unknown parent "${c.parentCode}"`)
      }
      if (contract && !contract.containerSubtypes.includes(c.subtype)) {
        errors.push(`Container "${c.code}" subtype "${c.subtype}" is not allowed in ${ws.executionMode}; expected ${contract.containerSubtypes.join(', ')}`)
      }
    }
    for (const i of ws.items || []) {
      claim(i.code, 'item')
      if (i.containerCode && !containerCodes.has(i.containerCode)) {
        errors.push(`Item "${i.code}" references unknown container "${i.containerCode}"`)
      }
      if (contract && !contract.itemSubtypes.includes(i.subtype)) {
        errors.push(`Item "${i.code}" subtype "${i.subtype}" is not allowed in ${ws.executionMode}; expected ${contract.itemSubtypes.join(', ')}`)
      }
      if (contract) {
        for (const key of Object.keys(i.metrics || {})) {
          if (!contract.metricKeys.includes(key)) {
            errors.push(`Item "${i.code}" metric "${key}" is not allowed in ${ws.executionMode}; expected ${contract.metricKeys.join(', ')}`)
          }
        }
      }
    }
    for (const m of ws.milestones || []) claim(m.code, 'milestone')
    for (const g of ws.gates || []) claim(g.code, 'gate')
  }
  for (const d of plan?.dependencies || []) {
    if (!codes.has(d.sourceRef)) errors.push(`Dependency sourceRef "${d.sourceRef}" resolves to no code in this plan`)
    if (!codes.has(d.targetRef)) errors.push(`Dependency targetRef "${d.targetRef}" resolves to no code in this plan`)
    if (d.sourceRef === d.targetRef) errors.push(`Dependency cannot reference itself ("${d.sourceRef}")`)
  }
  return errors
}

async function submit(kind, plan) {
  const workspaceId = flag('workspace') || cfg.workspaceId || undefined
  if (has('http')) {
    const path = kind === 'commit' ? '/api/import/commit' : '/api/import/dry-run'
    const res = await api(path, { method: 'POST', body: { plan, workspaceId }, cfg })
    if (!res.ok) die(`HTTP ${res.status}: ${res.text.slice(0, 400)}`)
    return res.json
  }
  const mcp = await mcpConnect(cfg)
  const tool = kind === 'commit' ? 'project_manager.plan_commit' : 'project_manager.plan_dry_run'
  return mcp.callTool(tool, workspaceId ? { plan, workspaceId } : { plan })
}

function reportResult(kind, result) {
  console.log(JSON.stringify(result, null, 2))
  if (result?.valid === false || result?.committed === false) {
    console.error(`\n${kind} REFUSED — fix the errors above and run the dry run again. Never retry a commit with a fresh idempotencyKey to get past a refusal.`)
    process.exitCode = 1
  }
}

if (command === 'vocab') {
  const { source, modes } = await loadModeContracts()
  const only = flag('mode')
  console.log(`# execution-mode vocabulary (read from ${source})`)
  for (const [mode, c] of Object.entries(modes)) {
    if (only && mode !== only) continue
    console.log(`\n${mode}`)
    console.log(`  progressStrategy : ${c.progressStrategy}`)
    console.log(`  containers       : ${c.containerSubtypes.join(', ') || '(none)'}`)
    console.log(`  items            : ${c.itemSubtypes.join(', ') || '(none)'}`)
    console.log(`  item metrics     : ${c.metricKeys.join(', ') || '(none)'}`)
  }
} else if (command === 'check') {
  if (!positional[0]) die('usage: zuri-plan.mjs check <plan.json>')
  const plan = JSON.parse(readFileSync(positional[0], 'utf8'))
  let modes = null
  try {
    modes = (await loadModeContracts()).modes
  } catch (error) {
    console.error(`(vocabulary checks skipped: ${error.message} — the dry run still enforces them)`)
  }
  const errors = structuralErrors(plan, modes)
  if (errors.length) {
    for (const e of errors) console.error(`ERROR ${e}`)
    process.exit(1)
  }
  console.log('Local checks passed. This is a pre-check, not the contract: run dry-run next.')
} else if (command === 'dry-run' || command === 'commit') {
  if (!positional[0]) die(`usage: zuri-plan.mjs ${command} <plan.json>`)
  const plan = JSON.parse(readFileSync(positional[0], 'utf8'))
  reportResult(command, await submit(command, plan))
} else {
  die('usage: zuri-plan.mjs <vocab|check|dry-run|commit> [args]')
}
