import { describe, expect, it, vi } from 'vitest'
import { createServerLineRichMenuTransport } from '@/platform/integrations/providers/line/server-line-rich-menu-transport'

// @req FR-152 — the rich menu port classifies every provider outcome the
//   way the durable job needs: accepted, permanent, retryable, unconfirmed —
//   and reads nothing from a provider error body.
// @spec ADR-061 D1, D6, D7; SEC-016
// @tested tests/unit/platform/server-line-rich-menu-transport.test.js

const account = { channelAccessToken: 'test-access-token' }
const richMenu = {
  size: { width: 2500, height: 843 }, selected: false, name: 'Main', chatBarText: 'เมนู',
  areas: [{ bounds: { x: 0, y: 0, width: 2500, height: 843 }, action: { type: 'message', text: 'hi' } }],
}
const response = (status, { body = {}, headers = {} } = {}) => ({
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => body,
})

describe('FR-152 rich menu transport', () => {
  it('creates a menu and returns the provider id on acceptance, with the bearer and body LINE expects', async () => {
    const fetchFn = vi.fn(async () => response(200, { body: { richMenuId: 'richmenu-abc123' }, headers: { 'x-line-request-id': 'req-1' } }))
    const port = createServerLineRichMenuTransport({ fetchFn })
    const result = await port.create({ account, richMenu })
    expect(result).toEqual({ status: 'ACCEPTED_BY_LINE', httpStatus: 200, requestId: 'req-1', code: null, richMenuId: 'richmenu-abc123' })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://api.line.me/v2/bot/richmenu')
    expect(init.headers.Authorization).toBe('Bearer test-access-token')
    expect(JSON.parse(init.body)).toEqual(richMenu)
  })

  it('reports an accepted create whose id cannot be read as UNCONFIRMED, never as success', async () => {
    const port = createServerLineRichMenuTransport({ fetchFn: vi.fn(async () => response(200, { body: { nope: true } })) })
    const result = await port.create({ account, richMenu })
    expect(result.status).toBe('UNCONFIRMED')
    expect(result.code).toBe('LINE_RICH_MENU_ID_UNREADABLE')
    expect(result.richMenuId).toBeNull()
  })

  it('classifies 4xx as permanent, 5xx as retryable and a network error as unconfirmed', async () => {
    const permanent = createServerLineRichMenuTransport({ fetchFn: vi.fn(async () => response(400)) })
    expect((await permanent.setDefault({ account, richMenuId: 'richmenu-1' })).status).toBe('PERMANENT_FAILURE')
    const retryable = createServerLineRichMenuTransport({ fetchFn: vi.fn(async () => response(503)) })
    expect((await retryable.uploadImage({ account, richMenuId: 'richmenu-1', bytes: new Uint8Array([1]), mime: 'image/png' })).status).toBe('RETRYABLE_FAILURE')
    const network = createServerLineRichMenuTransport({ fetchFn: vi.fn(async () => { throw new Error('ECONNRESET') }) })
    expect((await network.create({ account, richMenu })).status).toBe('UNCONFIRMED')
  })

  it('uploads bytes to the data host with the image content type', async () => {
    const fetchFn = vi.fn(async () => response(200))
    const port = createServerLineRichMenuTransport({ fetchFn })
    const bytes = new Uint8Array([137, 80, 78, 71])
    await port.uploadImage({ account, richMenuId: 'richmenu-abc', bytes, mime: 'image/png' })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://api-data.line.me/v2/bot/richmenu/richmenu-abc/content')
    expect(init.headers['Content-Type']).toBe('image/png')
    expect(init.body).toBe(bytes)
  })

  it('sets an alias by creating it, and updates it when it already exists', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(response(400))
      .mockResolvedValueOnce(response(200, { headers: { 'x-line-request-id': 'req-alias' } }))
    const port = createServerLineRichMenuTransport({ fetchFn })
    const result = await port.setAlias({ account, aliasId: 'main', richMenuId: 'richmenu-abc' })
    expect(result.status).toBe('ACCEPTED_BY_LINE')
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.line.me/v2/bot/richmenu/alias')
    expect(fetchFn.mock.calls[1][0]).toBe('https://api.line.me/v2/bot/richmenu/alias/main')
    expect(fetchFn.mock.calls[1][1].method).toBe('PUT')
  })

  it('refuses malformed input before any request: bad ids, oversized images, a token with whitespace', async () => {
    const fetchFn = vi.fn(async () => response(200))
    const port = createServerLineRichMenuTransport({ fetchFn })
    await expect(port.setDefault({ account, richMenuId: 'not-a-line-id' })).rejects.toMatchObject({ code: 'LINE_SEND_INPUT_INVALID' })
    await expect(port.uploadImage({ account, richMenuId: 'richmenu-1', bytes: new Uint8Array(1024 * 1024 + 1), mime: 'image/png' })).rejects.toMatchObject({ code: 'LINE_SEND_INPUT_INVALID' })
    await expect(port.create({ account: { channelAccessToken: 'bad token' }, richMenu })).rejects.toMatchObject({ code: 'LINE_SEND_INPUT_INVALID' })
    await expect(port.create({ account, richMenu: { ...richMenu, areas: [] } })).rejects.toMatchObject({ code: 'LINE_SEND_INPUT_INVALID' })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
