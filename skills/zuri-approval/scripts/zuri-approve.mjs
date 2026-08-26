#!/usr/bin/env node
// Submit an approval decision a HUMAN has already made. This script never
// decides anything: authority is evaluated server-side, per request, at the
// Business that governs the record. A 403 here is an answer, not an obstacle.
//
//   node zuri-approve.mjs pending --project <projectId>
//   node zuri-approve.mjs gate <gateId> <PASSED|WAIVED|BLOCKED>
//        --approved-by "<person>" [--evidence <file.json>] [--note "<why>"] --confirm
//   node zuri-approve.mjs review <caseId> --business <businessId>
//        --expected-version <n> --decisions <file.json> --confirm
//
// Without --confirm nothing is sent: the payload is printed for the approver to read.

import { readFileSync } from 'node:fs'
import { api, config, die } from '../../lib/zuri-client.mjs'

const argv = process.argv.slice(2)
const command = argv[0]
const positional = argv.slice(1).filter((a) => !a.startsWith('--'))
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? null : argv[i + 1]
}
const confirmed = argv.includes('--confirm')
const cfg = config()

function preview(label, method, path, body) {
  console.log(`${label}\n  ${method} ${cfg.baseUrl}${path}\n${JSON.stringify(body, null, 2).split('\n').map((l) => `  ${l}`).join('\n')}`)
}

async function send(method, path, body) {
  const res = await api(path, { method, body, cfg })
  console.log(JSON.stringify({ status: res.status, ok: res.ok, body: res.json ?? res.text.slice(0, 400) }, null, 2))
  if (res.status === 401) console.error('\nAUTH_REQUIRED — the connector holds no authenticated session. Stop and re-run zuri-connect.')
  if (res.status === 403) console.error('\nREFUSED — this viewer does not hold approval authority at that Business. Report the refusal; do not look for another route to the same write.')
  if (res.status === 409) console.error('\nCONFLICT — the record moved since you read it. Re-read it, show the approver what changed, and ask again.')
  process.exitCode = res.ok ? 0 : 1
}

if (command === 'pending') {
  const projectId = flag('project')
  if (!projectId) die('usage: zuri-approve.mjs pending --project <projectId>')
  const res = await api(`/api/milestones?projectId=${encodeURIComponent(projectId)}`, { cfg })
  if (!res.ok) die(`HTTP ${res.status}: ${res.text.slice(0, 300)}`)
  const gates = (res.json?.gates || []).filter((g) => g.status === 'OPEN' || g.status === 'BLOCKED')
  if (!gates.length) console.log('No OPEN or BLOCKED gates in this project.')
  for (const g of gates) {
    console.log(`${g.status.padEnd(8)} ${g.code.padEnd(24)} ${g.required ? 'required' : 'optional'}  ${g.title}`)
    console.log(`         id=${g.id} targetAt=${g.targetAt || '(none)'} evidence=${JSON.stringify(g.evidence || {})}`)
  }
} else if (command === 'gate') {
  const [gateId, status] = positional
  const approvedBy = flag('approved-by')
  if (!gateId || !['PASSED', 'WAIVED', 'BLOCKED'].includes(status)) {
    die('usage: zuri-approve.mjs gate <gateId> <PASSED|WAIVED|BLOCKED> --approved-by "<person>" [--evidence <file.json>] [--note "<why>"] --confirm')
  }
  if (!approvedBy) die('--approved-by is required: the decision belongs to a named human, never to the agent running this script')
  const evidenceFile = flag('evidence')
  const body = {
    status,
    evidence: {
      ...(evidenceFile ? JSON.parse(readFileSync(evidenceFile, 'utf8')) : {}),
      approvedBy,
      approvedAt: new Date().toISOString(),
      ...(flag('note') ? { note: flag('note') } : {}),
      ...(status === 'WAIVED' ? { waived: true } : {}),
    },
  }
  preview('Gate decision to submit:', 'PATCH', `/api/gates/${gateId}`, body)
  if (!confirmed) {
    console.log('\nNothing was sent. Show this to the approver, then re-run with --confirm.')
    process.exit(0)
  }
  await send('PATCH', `/api/gates/${gateId}`, body)
} else if (command === 'review') {
  const caseId = positional[0]
  const businessId = flag('business')
  const expectedVersion = Number(flag('expected-version'))
  const decisionsFile = flag('decisions')
  if (!caseId || !businessId || !Number.isInteger(expectedVersion) || !decisionsFile) {
    die('usage: zuri-approve.mjs review <caseId> --business <businessId> --expected-version <n> --decisions <file.json> --confirm')
  }
  const decisions = JSON.parse(readFileSync(decisionsFile, 'utf8'))
  const list = Array.isArray(decisions) ? decisions : decisions.decisions
  if (!Array.isArray(list) || !list.length) die('the decisions file must hold a non-empty array of decisions')
  for (const d of list) {
    if (!['CREATE_SEPARATE', 'LINK_EXISTING', 'REJECT', 'DEFER'].includes(d.action)) {
      die(`decision for "${d.provenanceId}": action must be CREATE_SEPARATE, LINK_EXISTING, REJECT or DEFER`)
    }
    if (d.action === 'LINK_EXISTING' && !d.targetCustomerId) die(`decision for "${d.provenanceId}": LINK_EXISTING requires targetCustomerId`)
    if (d.note) die(`decision for "${d.provenanceId}": free-text notes are disabled on this queue (no-raw-PII rule)`)
  }
  const body = { businessId, expectedVersion, decisions: list }
  preview('Review decisions to submit:', 'POST', `/api/platform/customer-import-reviews/${caseId}/decisions`, body)
  if (!confirmed) {
    console.log('\nNothing was sent. Show this to the approver, then re-run with --confirm.')
    process.exit(0)
  }
  await send('POST', `/api/platform/customer-import-reviews/${caseId}/decisions`, body)
} else {
  die('usage: zuri-approve.mjs <pending|gate|review> [args]')
}
