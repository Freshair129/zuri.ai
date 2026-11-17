import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createCredentialWriteGuardMock } = vi.hoisted(() => ({
  createCredentialWriteGuardMock: vi.fn(),
}))

vi.mock('@/modules/identity/credential-write-gate', () => ({
  createCredentialWriteGuard: createCredentialWriteGuardMock,
}))

import {
  CREDENTIAL_BODY_LIMIT_BYTES,
  handleCredentialRequest,
} from '@/modules/integration/application/credential-route'

// @req FR-224 — credential request bodies are bounded and never echoed on refusal.
// @spec ADR-089 D2, D4; SEC-030
// @tested tests/unit/integration/credential-route-body-cap.test.js

const viewer = { principal: { id: 'person-1' } }
const ports = { source: 'test guard' }

beforeEach(() => {
  createCredentialWriteGuardMock.mockReset()
  createCredentialWriteGuardMock.mockReturnValue(ports)
})

function requestWithBody(body, headers = {}) {
  return { body, headers: new Headers(headers) }
}

function streamFrom(chunks, cancel = vi.fn(), onPull = vi.fn()) {
  let index = 0
  const body = new ReadableStream({
    pull(controller) {
      onPull()
      if (index === chunks.length) controller.close()
      else controller.enqueue(chunks[index++])
    },
    cancel,
  }, { highWaterMark: 0 })
  return { body, cancel, onPull }
}

async function expectRefusal(response, status, code, work) {
  expect(response.status).toBe(status)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const body = await response.json()
  expect(body).toEqual({ error: code })
  expect(work).not.toHaveBeenCalled()
  expect(createCredentialWriteGuardMock).not.toHaveBeenCalled()
  return body
}

describe('credential request body limit', () => {
  it.each([401, 503])('resolves viewer before pulling an unread body (%i)', async (status) => {
    const stream = streamFrom(Array.from({ length: 100 }, () => new Uint8Array(1024)))
    const work = vi.fn()
    const resolveViewer = vi.fn(async () => {
      throw Object.assign(new Error('AUTH_REFUSED'), { status })
    })

    const response = await handleCredentialRequest(requestWithBody(stream.body), work, { resolveViewer })

    await expectRefusal(response, status, 'AUTH_REFUSED', work)
    expect(resolveViewer).toHaveBeenCalledTimes(1)
    expect(stream.onPull).not.toHaveBeenCalled()
    expect(stream.cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects an oversized valid Content-Length without pulling the body', async () => {
    const stream = streamFrom([Buffer.from('{}')])
    const work = vi.fn()
    const request = requestWithBody(stream.body, {
      'content-length': String(CREDENTIAL_BODY_LIMIT_BYTES + 1),
    })

    const response = await handleCredentialRequest(request, work, { resolveViewer: async () => viewer })

    await expectRefusal(response, 413, 'CREDENTIAL_INPUT_TOO_LARGE', work)
    expect(stream.onPull).not.toHaveBeenCalled()
    expect(stream.cancel).toHaveBeenCalledTimes(1)
  })

  it('stops a chunked oversized body as soon as the actual byte count crosses the cap', async () => {
    let chunksPulled = 0
    const cancel = vi.fn()
    const body = new ReadableStream({
      pull(controller) {
        chunksPulled += 1
        if (chunksPulled > 100) controller.close()
        else controller.enqueue(new Uint8Array(1024))
      },
      cancel,
    }, { highWaterMark: 0 })
    const work = vi.fn()

    const response = await handleCredentialRequest(requestWithBody(body), work, { resolveViewer: async () => viewer })

    await expectRefusal(response, 413, 'CREDENTIAL_INPUT_TOO_LARGE', work)
    expect(chunksPulled).toBeLessThanOrEqual(CREDENTIAL_BODY_LIMIT_BYTES / 1024 + 2)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('uses actual bytes when Content-Length understates the body', async () => {
    const stream = streamFrom([Buffer.alloc(20 * 1024, 0x61)])
    const work = vi.fn()
    const request = requestWithBody(stream.body, { 'content-length': '10' })

    const response = await handleCredentialRequest(request, work, { resolveViewer: async () => viewer })

    await expectRefusal(response, 413, 'CREDENTIAL_INPUT_TOO_LARGE', work)
    expect(stream.cancel).toHaveBeenCalledTimes(1)
  })

  it('accepts exactly the byte cap and rejects one byte over', async () => {
    const exactText = JSON.stringify('x'.repeat(CREDENTIAL_BODY_LIMIT_BYTES - 2))
    expect(Buffer.byteLength(exactText)).toBe(CREDENTIAL_BODY_LIMIT_BYTES)
    const exact = streamFrom([Buffer.from(exactText)])
    const exactWork = vi.fn(async (body) => ({ acceptedLength: body.length }))

    const accepted = await handleCredentialRequest(requestWithBody(exact.body), exactWork, { resolveViewer: async () => viewer })

    expect(accepted.status).toBe(200)
    expect(accepted.headers.get('cache-control')).toBe('no-store')
    expect(await accepted.json()).toEqual({ acceptedLength: CREDENTIAL_BODY_LIMIT_BYTES - 2 })
    expect(exactWork).toHaveBeenCalledTimes(1)
    expect(createCredentialWriteGuardMock).toHaveBeenCalledTimes(1)

    const overText = JSON.stringify('x'.repeat(CREDENTIAL_BODY_LIMIT_BYTES - 1))
    const over = streamFrom([Buffer.from(overText)])
    const overWork = vi.fn()
    createCredentialWriteGuardMock.mockClear()
    const response = await handleCredentialRequest(requestWithBody(over.body), overWork, { resolveViewer: async () => viewer })

    await expectRefusal(response, 413, 'CREDENTIAL_INPUT_TOO_LARGE', overWork)
    expect(over.cancel).toHaveBeenCalledTimes(1)
  })

  it('decodes multi-byte UTF-8 split between chunks after resolving the viewer', async () => {
    const events = []
    const bytes = Buffer.from(JSON.stringify({ value: '🧋' }))
    const emojiStart = bytes.indexOf(Buffer.from('🧋'))
    const chunks = [
      bytes.subarray(0, emojiStart + 1),
      bytes.subarray(emojiStart + 1, emojiStart + 3),
      bytes.subarray(emojiStart + 3),
    ]
    const stream = streamFrom(chunks, vi.fn(), () => events.push('body'))
    createCredentialWriteGuardMock.mockImplementation(() => {
      events.push('guard')
      return ports
    })
    const resolveViewer = vi.fn(async () => {
      events.push('viewer')
      return viewer
    })
    const work = vi.fn(async (body) => {
      events.push('work')
      return body
    })

    const response = await handleCredentialRequest(requestWithBody(stream.body), work, { resolveViewer })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ value: '🧋' })
    expect(events[0]).toBe('viewer')
    expect(events.indexOf('body')).toBeGreaterThan(events.indexOf('viewer'))
    expect(events.indexOf('guard')).toBeGreaterThan(events.indexOf('body'))
    expect(events.indexOf('work')).toBeGreaterThan(events.indexOf('guard'))
  })

  it('passes an empty body to work as an empty object', async () => {
    const work = vi.fn(async (body) => ({ body }))
    const injectedPorts = { source: 'injected guard' }

    const response = await handleCredentialRequest(requestWithBody(null), work, {
      resolveViewer: async () => viewer,
      guard: injectedPorts,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ body: {} })
    expect(work).toHaveBeenCalledWith({}, { viewer, ports: injectedPorts })
    expect(createCredentialWriteGuardMock).not.toHaveBeenCalled()
  })

  it('returns a no-store 400 for malformed JSON without echoing submitted text', async () => {
    const submittedText = 'credential-body-secret-not-json'
    const stream = streamFrom([Buffer.from(submittedText)])
    const work = vi.fn()

    const response = await handleCredentialRequest(requestWithBody(stream.body), work, { resolveViewer: async () => viewer })

    const responseBody = await expectRefusal(response, 400, 'CREDENTIAL_INPUT_INVALID', work)
    expect(JSON.stringify(responseBody)).not.toContain(submittedText)
  })

  it('maps a stream read error to the same non-echoing 400 refusal', async () => {
    const submittedText = 'stream-error-secret'
    const body = new ReadableStream({
      pull() {
        throw new Error(submittedText)
      },
    }, { highWaterMark: 0 })
    const work = vi.fn()

    const response = await handleCredentialRequest(requestWithBody(body), work, { resolveViewer: async () => viewer })

    const responseBody = await expectRefusal(response, 400, 'CREDENTIAL_INPUT_INVALID', work)
    expect(JSON.stringify(responseBody)).not.toContain(submittedText)
  })
})
