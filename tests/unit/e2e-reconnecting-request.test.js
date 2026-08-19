import { describe, expect, it, vi } from 'vitest'
import { api, isConnectionLost, reconnecting } from '../e2e/reconnecting-request.js'

// @req FR-077 — the e2e proof of the Inventory boundaries must not be lost to a
//   socket the server closed; run 32285614052 turned exactly that into a red main.
// @spec SDD-045 — a retry that can mask a wrong answer is the thing the suite's
//   `--fail-on-flaky` rule exists to stop. These cases pin the line between the two.
// @tested tests/unit/e2e-reconnecting-request.test.js
//
// The helper is one `try`/`catch`, so the risk is not that it breaks — it is that
// it quietly grows into the silent retry it replaced. Every case below fails if
// someone widens it: to more attempts, to a delay, or to retrying a response.

/** A response is a *value* here, exactly as Playwright returns it. */
const response = (status) => ({ status: () => status, ok: () => status < 400 })

const reset = () => Object.assign(new Error('apiRequestContext.get: read ECONNRESET'), { code: 'ECONNRESET' })

describe('the e2e reconnecting request retries the connection, never the answer', () => {
  it('reconnects once when the connection died before any response arrived', async () => {
    const send = vi.fn().mockRejectedValueOnce(reset()).mockResolvedValue(response(200))

    await expect(reconnecting(send)).resolves.toMatchObject({ status: expect.any(Function) })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('hands back a failing response on the first attempt instead of retrying it', async () => {
    // The whole point. A 500 means the server answered — wrongly, but it answered,
    // and the assertion that catches that must see it on the first attempt. If this
    // ever calls twice, a flaky route has been given somewhere to hide.
    for (const status of [400, 404, 409, 500, 503]) {
      const send = vi.fn().mockResolvedValue(response(status))

      const result = await reconnecting(send)

      expect(result.status()).toBe(status)
      expect(send).toHaveBeenCalledTimes(1)
    }
  })

  it('rethrows anything that is not a lost connection, without a second attempt', async () => {
    for (const error of [new Error('Timeout 10000ms exceeded'), new Error('expect(received).toBe(expected)'), new TypeError('x is not a function')]) {
      const send = vi.fn().mockRejectedValue(error)

      await expect(reconnecting(send)).rejects.toThrow(error.message)
      expect(send).toHaveBeenCalledTimes(1)
    }
  })

  it('gives up after one reconnect, because two resets in a row are a real failure', async () => {
    const send = vi.fn().mockRejectedValue(reset())

    await expect(reconnecting(send)).rejects.toThrow(/ECONNRESET/)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('recognises the connection-level errors and nothing broader', () => {
    for (const message of ['read ECONNRESET', 'connect ECONNREFUSED 127.0.0.1:3100', 'socket hang up', 'write EPIPE']) {
      expect(isConnectionLost(new Error(message)), message).toBe(true)
    }
    // "Timed out" is the shape the warm-up step exists to prevent and must stay a
    // failure: a slow route is a result, and reconnecting would only hide it.
    for (const message of ['Timeout 10000ms exceeded', 'Navigation failed', 'net::ERR_ABORTED', 'connection closed by policy']) {
      expect(isConnectionLost(new Error(message)), message).toBe(false)
    }
  })

  it('wraps both verbs of a Playwright request context and passes options through', async () => {
    const context = {
      get: vi.fn().mockRejectedValueOnce(reset()).mockResolvedValue(response(200)),
      post: vi.fn().mockResolvedValue(response(201)),
    }
    const client = api(context)

    await client.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')
    await client.post('/api/projects', { data: { name: 'x' } })

    expect(context.get).toHaveBeenCalledTimes(2)
    expect(context.get).toHaveBeenLastCalledWith('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM', undefined)
    expect(context.post).toHaveBeenCalledTimes(1)
    expect(context.post).toHaveBeenCalledWith('/api/projects', { data: { name: 'x' } })
  })
})
