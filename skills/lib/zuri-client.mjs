// Shared transport for the Zuri skill pack. Node >= 18, zero dependencies.
//
// Two ways into the same Zuri instance, in this order of preference:
//   1. MCP  — POST {base}/api/mcp  (project_manager.plan_dry_run / plan_commit)
//   2. HTTP — the REST routes under {base}/api/*
// Both resolve the SAME server-side viewer and run the SAME service code.
// Neither can be talked into a wider scope than the session it carries.

export function config(env = process.env) {
  const baseUrl = String(env.ZURI_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
  return {
    baseUrl,
    cookie: env.ZURI_SESSION_COOKIE || '',
    workspaceId: env.ZURI_WORKSPACE_ID || '',
  }
}

export function headers(cfg, extra = {}) {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    ...(cfg.cookie ? { cookie: cfg.cookie } : {}),
    ...extra,
  }
}

/** One REST call. Never throws on a non-2xx: the status is data the caller must report. */
export async function api(path, { method = 'GET', body, cfg = config() } = {}) {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: headers(cfg),
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON body stays in `text` */ }
  return { ok: res.ok, status: res.status, json, text }
}

/**
 * MCP session over HTTP. The session id is a protocol continuation token only —
 * the server re-authenticates every single request, so a session never widens
 * what the caller may see or write.
 */
export async function mcpConnect(cfg = config()) {
  const post = async (message, sessionId) => {
    const res = await fetch(`${cfg.baseUrl}/api/mcp`, {
      method: 'POST',
      headers: headers(cfg, sessionId ? { 'mcp-session-id': sessionId } : {}),
      body: JSON.stringify(message),
    })
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { /* keep raw text */ }
    return { status: res.status, json, text, sessionId: res.headers.get('mcp-session-id') }
  }

  const init = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'zuri-skill-pack', version: '1.0.0' } },
  })
  if (init.status !== 200 || !init.sessionId) {
    const reason = init.json?.error?.message || init.text || `HTTP ${init.status}`
    throw new Error(`MCP initialize failed (${init.status}): ${reason}`)
  }
  const sessionId = init.sessionId
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)

  let nextId = 2
  return {
    sessionId,
    serverInfo: init.json?.result?.serverInfo || null,
    async listTools() {
      const res = await post({ jsonrpc: '2.0', id: nextId++, method: 'tools/list' }, sessionId)
      if (res.json?.error) throw new Error(`tools/list failed: ${res.json.error.message}`)
      return res.json?.result?.tools || []
    },
    async callTool(name, args) {
      const res = await post({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }, sessionId)
      if (res.json?.error) {
        const err = new Error(`${name} failed: ${res.json.error.message}`)
        err.status = res.status
        throw err
      }
      // structuredContent is the tool result itself (valid/errors/preview, or committed/...).
      return res.json?.result?.structuredContent ?? null
    },
  }
}

export function readJsonFile(path) {
  return import('node:fs').then(({ readFileSync }) => JSON.parse(readFileSync(path, 'utf8')))
}

export function die(message, code = 1) {
  console.error(message)
  process.exit(code)
}
