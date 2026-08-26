#!/usr/bin/env node
// Verify that this harness can reach ONE Zuri instance as ONE authenticated
// viewer, and report exactly what that viewer may write to. Read-only.
//
//   node skills/zuri-connect/scripts/zuri-verify-connection.mjs [--json]
//
// Env: ZURI_BASE_URL (default http://localhost:3000), ZURI_SESSION_COOKIE.

import { api, config, mcpConnect } from '../../lib/zuri-client.mjs'

const asJson = process.argv.includes('--json')
const cfg = config()
const report = { baseUrl: cfg.baseUrl, cookiePresent: Boolean(cfg.cookie), checks: [] }
const check = (name, ok, detail) => report.checks.push({ name, ok, detail })

const viewer = await api('/api/viewer', { cfg })
if (viewer.status === 401) check('viewer', false, 'AUTH_REQUIRED — the connector carries no authenticated session')
else if (viewer.status === 503) check('viewer', false, 'SESSION_UNAVAILABLE — the session adapter is not configured on this instance')
else if (!viewer.ok) check('viewer', false, `HTTP ${viewer.status}: ${viewer.text.slice(0, 200)}`)
else {
  const v = viewer.json || {}
  report.viewer = {
    principalId: v.principal?.id ?? null,
    role: v.role ?? null,
    visibleBusinessIds: v.visibleBusinessIds ?? [],
    ownedBusinessIds: v.ownedBusinessIds ?? [],
    isOperator: v.isOperator === true,
    isPlatform: v.isPlatform === true,
  }
  check('viewer', true, `role=${report.viewer.role} owns=${report.viewer.ownedBusinessIds.length} sees=${report.viewer.visibleBusinessIds.length}`)
}

if (report.viewer) {
  const scope = await api('/api/scope', { cfg })
  if (scope.ok) {
    const workspaces = scope.json?.workspaces || []
    report.workspaces = workspaces.map((w) => ({ id: w.id, code: w.code, name: w.name, scopeType: w.scopeType, businessId: w.businessId }))
    check('scope', true, `${workspaces.length} workspace(s) visible`)
  } else {
    check('scope', false, `HTTP ${scope.status}`)
  }
}

try {
  const mcp = await mcpConnect(cfg)
  const tools = await mcp.listTools()
  report.mcp = { serverInfo: mcp.serverInfo, tools: tools.map((t) => t.name) }
  check('mcp', true, `${tools.length} tool(s): ${tools.map((t) => t.name).join(', ')}`)
} catch (error) {
  check('mcp', false, error.message)
}

report.ok = report.checks.every((c) => c.ok)

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Zuri instance : ${report.baseUrl}`)
  console.log(`Session cookie: ${report.cookiePresent ? 'present' : 'MISSING'}`)
  for (const c of report.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(7)} ${c.detail}`)
  if (report.workspaces?.length) {
    console.log('\nWritable target candidates (authorization is still decided per request by the server):')
    for (const w of report.workspaces) console.log(`  ${w.id}  ${w.code}  [${w.scopeType}]  ${w.name}`)
  }
}
process.exitCode = report.ok ? 0 : 1
