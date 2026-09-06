import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createServerLinePushTransport,
  createServerLineReplyTransport,
  createServerLineSecretManagerFromEnv,
  resolveServerLineAccount,
  verifyServerLineWebhook,
} from '@/platform/integrations/providers/line/server-line-transport'

// @req FR-149 — prove ingress authentication, scoped secret resolution and
// distinct retry safety of Reply versus durable Push delivery attempts.
// @spec ADR-061, SEC-001, SEC-016

const secrets = { channelSecret: 'test-channel-secret', channelAccessToken: 'test-access-token' }
const now = new Date('2026-09-06T00:00:00Z')
const retryKey = '08a6e5b9-6638-4f26-9082-e30fcc841abc'
const messages = [{ type: 'text', text: 'สวัสดีครับ' }]

function accountRow() {
  return {
    id: 'account-1', tenantId: 'tenant-1', businessId: 'business-1',
    integrationConnectionId: 'connection-1', status: 'CONNECTED', transportMode: 'CLOUD',
    serverEnabled: true, version: 3, executionMode: 'SERVER',
    connection: {
      id: 'connection-1', tenantId: 'tenant-1', businessId: 'business-1',
      status: 'ACTIVE', authorizationType: 'SECRET_MANAGER', externalAccountId: 'Ubot',
      provider: { code: 'LINE_OA', status: 'ACTIVE' },
      credential: { connectionId: 'connection-1', secretRef: 'deployment-secret:account-1', status: 'ACTIVE' },
    },
  }
}

function resolver(row = accountRow(), material = JSON.stringify(secrets)) {
  return {
    accountId: 'account-1', now,
    db: { lineOaAccount: { findUnique: vi.fn().mockResolvedValue(row) } },
    secretManager: { runtimeSource: 'PRODUCTION_LINE', resolve: vi.fn().mockResolvedValue({ material }) },
  }
}

function signed(body, account = { ...secrets, destination: 'Ubot' }) {
  const rawBody = Buffer.from(body)
  return { account, rawBody, signature: createHmac('sha256', account.channelSecret).update(rawBody).digest('base64') }
}

function mountEntry() {
  return {
    ...secrets,
    secretRef: 'deployment-secret:account-1', tenantId: 'tenant-1', businessId: 'business-1',
    accountId: 'account-1', connectionId: 'connection-1', destination: 'Ubot',
    version: '1', expiresAt: '2027-01-01T00:00:00Z',
  }
}
function mount(config = { version: 1, entries: [mountEntry()] }) {
  const readFileFn = vi.fn().mockResolvedValue(JSON.stringify(config))
  const manager = createServerLineSecretManagerFromEnv({ ZURI_LINE_SECRET_FILE: '/run/secrets/line.json' }, {
    cwd: '/app', readFileFn, now: () => now,
  })
  return { manager, readFileFn }
}
function scope() {
  const { tenantId, businessId, accountId, connectionId, destination } = mountEntry()
  return { tenantId, businessId, accountId, connectionId, destination }
}

afterEach(() => vi.useRealTimers())

describe('server LINE account credential boundary', () => {
  it('resolves exact server scope and keeps credentials out of enumeration', async () => {
    const input = resolver()
    const account = await resolveServerLineAccount(input)
    expect(input.secretManager.resolve).toHaveBeenCalledWith('deployment-secret:account-1', scope())
    expect(account.channelSecret).toBe(secrets.channelSecret)
    expect(account.channelAccessToken).toBe(secrets.channelAccessToken)
    expect(JSON.stringify(account)).not.toContain('test-')
    expect({ ...account }).not.toHaveProperty('channelSecret')
    expect(Object.isFrozen(account)).toBe(true)
    expect(account.channelAccountId).toBe('account-1')
  })

  it('preserves an existing binding namespace when transitioning ownership', async () => {
    const row = accountRow()
    row.bindingCode = 'legacy-binding'
    expect((await resolveServerLineAccount(resolver(row))).channelAccountId).toBe('legacy-binding')
  })

  it.each([
    ['tenant mismatch', (row) => { row.connection.tenantId = 'other' }],
    ['business mismatch', (row) => { row.connection.businessId = 'other' }],
    ['tenant-wide connection', (row) => { row.connection.businessId = null }],
    ['account paused', (row) => { row.status = 'PAUSED' }],
    ['edge transport', (row) => { row.transportMode = 'EDGE' }],
    ['not explicitly enabled', (row) => { row.serverEnabled = false }],
    ['connection paused', (row) => { row.connection.status = 'PAUSED' }],
    ['wrong provider', (row) => { row.connection.provider.code = 'openai' }],
    ['provider paused', (row) => { row.connection.provider.status = 'PAUSED' }],
    ['connection link mismatch', (row) => { row.integrationConnectionId = 'other' }],
    ['no destination', (row) => { row.connection.externalAccountId = null }],
    ['plaintext credential mode', (row) => { row.connection.authorizationType = 'API_KEY' }],
  ])('refuses %s before reading secrets', async (_, mutate) => {
    const row = accountRow()
    mutate(row)
    const input = resolver(row)
    await expect(resolveServerLineAccount(input)).rejects.toThrow('LINE_ACCOUNT_NOT_AVAILABLE')
    expect(input.secretManager.resolve).not.toHaveBeenCalled()
  })

  it('permits metadata validation before enabling an otherwise valid draft account', async () => {
    const row = accountRow()
    row.status = 'DRAFT'
    row.serverEnabled = false
    await expect(resolveServerLineAccount({ ...resolver(row), requireEnabled: false })).resolves.toHaveProperty('id', row.id)
  })

  it.each(['expiresAt', 'accessTokenExpiresAt'])('refuses expired %s before reading secrets', async (field) => {
    const row = accountRow()
    row.connection.credential[field] = now
    const input = resolver(row)
    await expect(resolveServerLineAccount(input)).rejects.toThrow('LINE_ACCOUNT_CREDENTIAL_UNAVAILABLE')
    expect(input.secretManager.resolve).not.toHaveBeenCalled()
  })

  it('refuses a local runtime port for production', async () => {
    const input = resolver()
    input.secretManager.runtimeSource = 'LOCAL_DEV'
    await expect(resolveServerLineAccount(input)).rejects.toThrow('LINE_SECRET_MANAGER_NOT_CONFIGURED')
  })

  it.each(['raw-secret', JSON.stringify({ ...secrets, unexpected: true }), JSON.stringify({ channelSecret: 'value' })])('redacts malformed secret material', async (material) => {
    await expect(resolveServerLineAccount(resolver(accountRow(), material))).rejects.toThrow('LINE_ACCOUNT_CREDENTIAL_UNAVAILABLE')
  })
})

describe('deployment mounted LINE secret manager', () => {
  it('uses the production port with complete mount binding and rereads on rotation', async () => {
    const { manager, readFileFn } = mount()
    const result = await manager.resolve('deployment-secret:account-1', scope())
    expect(result.material).toBe(JSON.stringify(secrets))
    expect(JSON.stringify(result)).not.toContain(secrets.channelSecret)
    const rotated = { ...mountEntry(), channelAccessToken: 'rotated-token', version: '2' }
    readFileFn.mockResolvedValueOnce(JSON.stringify({ version: 1, entries: [rotated] }))
    expect(JSON.parse((await manager.resolve('deployment-secret:account-1', scope())).material).channelAccessToken).toBe('rotated-token')
    expect(readFileFn).toHaveBeenCalledTimes(2)
  })

  it.each(['tenantId', 'businessId', 'accountId', 'connectionId', 'destination'])('denies mounted %s mismatch', async (key) => {
    const { manager } = mount()
    await expect(manager.resolve('deployment-secret:account-1', { ...scope(), [key]: 'other' })).rejects.toThrow('SECRET_MANAGER_UNAVAILABLE')
  })

  it.each([
    ['expired', { version: 1, entries: [{ ...mountEntry(), expiresAt: now.toISOString() }] }],
    ['duplicate ref', { version: 1, entries: [mountEntry(), mountEntry()] }],
    ['missing', { version: 1, entries: [] }],
    ['corrupt', { arbitrary: secrets.channelSecret }],
  ])('refuses %s mount without disclosing material', async (_, config) => {
    const { manager } = mount(config)
    await expect(manager.resolve('deployment-secret:account-1', scope())).rejects.toThrow(/^SECRET_MANAGER_/)
  })

  it('refuses relative paths and files inside checkout', () => {
    expect(() => createServerLineSecretManagerFromEnv({ ZURI_LINE_SECRET_FILE: 'secrets.json' })).toThrow('LINE_SECRET_MOUNT_NOT_CONFIGURED')
    expect(() => createServerLineSecretManagerFromEnv({ ZURI_LINE_SECRET_FILE: '/app/secrets.json' }, { cwd: '/app' })).toThrow('LINE_SECRET_MOUNT_MUST_BE_OUTSIDE_CHECKOUT')
  })
})

describe('signed native LINE ingress', () => {
  it('verifies whitespace and Thai bytes without reserializing', () => {
    const input = signed('{ "destination":"Ubot", "events":[{"type":"message","text":"สวัสดี\\nโลก"}]}\n')
    expect(verifyServerLineWebhook(input).events).toHaveLength(1)
    expect(() => verifyServerLineWebhook({ ...input, rawBody: Buffer.from(input.rawBody.toString().trim()) })).toThrow('LINE_WEBHOOK_SIGNATURE_INVALID')
  })

  it('authenticates empty verification probes and checks destination', () => {
    expect(verifyServerLineWebhook(signed('{"destination":"Ubot","events":[]}')).events).toEqual([])
    expect(() => verifyServerLineWebhook(signed('{"destination":"Uother","events":[]}'))).toThrow('LINE_WEBHOOK_DESTINATION_MISMATCH')
  })

  it('rejects missing/bad signature before attempting to parse invalid JSON', () => {
    const input = signed('{bad-json')
    expect(() => verifyServerLineWebhook({ ...input, signature: null })).toThrow('LINE_WEBHOOK_SIGNATURE_INVALID')
    expect(() => verifyServerLineWebhook(input)).toThrow('LINE_WEBHOOK_PAYLOAD_INVALID')
  })

  it('preserves the transient reply token only outside serialization', () => {
    const body = verifyServerLineWebhook(signed('{"destination":"Ubot","events":[{"type":"message","replyToken":"transient-token"}]}'))
    expect(body.events[0].replyToken).toBe('transient-token')
    expect(JSON.stringify(body)).not.toContain('transient-token')
    expect({ ...body.events[0] }).not.toHaveProperty('replyToken')
  })
})

describe('server-owned LINE send ports', () => {
  it('sends immutable push content with retry UUID from the first request', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'x-line-request-id': 'request-1' } }))
    const transport = createServerLinePushTransport({ fetchFn })
    const mutable = structuredClone(messages)
    const first = transport.send({ account: secrets, to: 'Urecipient', messages: mutable, retryKey })
    mutable[0].text = 'changed'
    expect(await first).toEqual({ status: 'ACCEPTED_BY_LINE', httpStatus: 200, requestId: 'request-1', code: null })
    const [url, request] = fetchFn.mock.calls[0]
    expect(url).toBe('https://api.line.me/v2/bot/message/push')
    expect(request.redirect).toBe('error')
    expect(request.headers['X-Line-Retry-Key']).toBe(retryKey)
    expect(JSON.parse(request.body)).toEqual({ to: 'Urecipient', messages })
    await transport.send({ account: secrets, to: 'Urecipient', messages, retryKey })
    expect(fetchFn.mock.calls[1][1].body).toBe(request.body)
  })

  it.each([
    [409, 'accepted-1', 'ACCEPTED_BY_LINE'],
    [409, null, 'PERMANENT_FAILURE'],
    [400, null, 'PERMANENT_FAILURE'],
    [401, null, 'PERMANENT_FAILURE'],
    [429, null, 'PERMANENT_FAILURE'],
    [500, null, 'RETRYABLE_FAILURE'],
  ])('classifies Push HTTP %i with accepted-id %s as %s', async (status, acceptedId, expected) => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('sensitive-provider-error', {
      status, headers: acceptedId ? { 'x-line-accepted-request-id': acceptedId } : {},
    }))
    const result = await createServerLinePushTransport({ fetchFn }).send({ account: secrets, to: 'Urecipient', messages, retryKey })
    expect(result.status).toBe(expected)
    expect(JSON.stringify(result)).not.toContain('sensitive-provider-error')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('requires a valid retry key before any Push network attempt', async () => {
    const fetchFn = vi.fn()
    await expect(createServerLinePushTransport({ fetchFn }).send({ account: secrets, to: 'Urecipient', messages })).rejects.toThrow('LINE_SEND_INPUT_INVALID')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('uses Reply API without a retry header', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    expect((await createServerLineReplyTransport({ fetchFn }).send({ account: secrets, replyToken: 'reply-1', messages })).status).toBe('ACCEPTED_BY_LINE')
    const [url, request] = fetchFn.mock.calls[0]
    expect(url).toBe('https://api.line.me/v2/bot/message/reply')
    expect(request.headers).not.toHaveProperty('X-Line-Retry-Key')
    expect(JSON.parse(request.body)).toEqual({ replyToken: 'reply-1', messages })
  })

  it('treats Reply 5xx as UNKNOWN and does not retry or switch to Push', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('secret-error', { status: 503 }))
    const result = await createServerLineReplyTransport({ fetchFn }).send({ account: secrets, replyToken: 'reply-1', messages })
    expect(result.status).toBe('UNKNOWN')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('secret-error')
  })

  it.each([
    [createServerLinePushTransport, 'RETRYABLE_FAILURE'],
    [createServerLineReplyTransport, 'UNKNOWN'],
  ])('aborts hung requests with redacted ambiguity status', async (factory, expected) => {
    vi.useFakeTimers()
    const fetchFn = vi.fn().mockImplementation(() => new Promise(() => {}))
    const pending = factory({ fetchFn, timeoutMs: 10 }).send({ account: secrets, to: 'Urecipient', replyToken: 'reply-1', messages, retryKey })
    await vi.advanceTimersByTimeAsync(10)
    expect(await pending).toMatchObject({ status: expected, code: 'LINE_NETWORK_UNAVAILABLE' })
    expect(fetchFn.mock.calls[0][1].signal.aborted).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('never exposes a transport exception containing a token', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error(secrets.channelAccessToken))
    const result = await createServerLineReplyTransport({ fetchFn }).send({ account: secrets, replyToken: 'reply-1', messages })
    expect(result.status).toBe('UNKNOWN')
    expect(JSON.stringify(result)).not.toContain(secrets.channelAccessToken)
  })
})
