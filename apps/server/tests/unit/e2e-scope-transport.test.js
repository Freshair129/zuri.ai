import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

// @req FR-103 — consent verification must reach its assertions after a single
// connection reset during read-only scope setup, without hiding HTTP failures.
// @spec ADR-017 — scope setup keeps the caller's authenticated request context.
// @tested tests/unit/e2e-scope-transport.test.js
const require = createRequire(import.meta.url)
const { request } = require('@playwright/test')
const { readScope } = require('../e2e/e2e-auth.js')
const cleanups = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture(respond) {
  const received = []
  const server = createServer((req, res) => {
    received.push({ path: req.url, method: req.method, cookie: req.headers.cookie })
    respond(req, res, received.length)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise((resolve) => {
    server.close(resolve)
    server.closeAllConnections()
  }))
  const baseURL = `http://127.0.0.1:${server.address().port}`
  const context = await request.newContext({
    baseURL,
    storageState: { cookies: [{ name: 'fixture-session', value: 'test-only',
      domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true,
      secure: false, sameSite: 'Lax' }], origins: [] },
  })
  cleanups.push(() => context.dispose())
  return { context, received }
}

describe('authenticated scope fixture transport', () => {
  it('reconnects once after a real socket reset and preserves the signed context', async () => {
    const scope = { businesses: [{ code: 'BUS-001', id: 'fixture-business' }] }
    const { context, received } = await fixture((req, res, attempt) => {
      if (attempt === 1) return req.socket.destroy()
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(scope))
    })
    await expect(readScope(context)).resolves.toEqual(scope)
    expect(received).toEqual(Array.from({ length: 2 }, () => ({
      path: '/api/scope', method: 'GET', cookie: 'fixture-session=test-only',
    })))
  })

  it('fails after two resets rather than retrying the whole test', async () => {
    const { context, received } = await fixture((req) => req.socket.destroy())
    await expect(readScope(context)).rejects.toThrow(/Failed after 2 attempt/)
    expect(received).toHaveLength(2)
  })

  it.each([401, 403, 500, 503])('does not retry HTTP %i or expose its body', async (status) => {
    const { context, received } = await fixture((_req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ privateDetail: 'must-not-appear-in-setup-error' }))
    })
    await expect(readScope(context)).rejects.toMatchObject({
      message: `Scope fixture failed: HTTP ${status}`,
    })
    expect(received).toHaveLength(1)
  })

  it('does not reconnect when a successful response contains invalid JSON', async () => {
    const { context, received } = await fixture((_req, res) => res.end('not-json'))
    await expect(readScope(context)).rejects.toThrow()
    expect(received).toHaveLength(1)
  })
})
