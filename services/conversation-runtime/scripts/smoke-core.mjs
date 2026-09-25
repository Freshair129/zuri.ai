import { createServer } from 'node:http'

// Disposable Core/provider stub used only by the CI image drain smoke.
const token = process.env.CONVERSATION_RUNTIME_TOKEN
if (typeof token !== 'string' || token.length < 32) throw new Error('SMOKE_CORE_TOKEN_REQUIRED')

const jobId = '2e41e30e-6a42-4da0-845e-90d6cdfa5ab7'
const executionId = 'c8f7ce46-9139-4a4f-a243-cc131da651f2'
const tenantId = 'bb3fc951-bac7-4ed6-88ea-734215d70286'
const businessId = '7719bd56-9f84-47c2-ae35-b1cc29f745d7'
const accountId = 'fb3e6b5f-5440-4cee-9c4d-02214243df47'
const state = { claimCalls: 0, prepareCalls: 0, prepareEntered: false, providerCalls: 0,
  completeCalls: 0, sendCalls: 0, traceKinds: [] }
let releasePrepare
const prepareGate = new Promise(resolve => { releasePrepare = resolve })

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (request.method === 'GET' && url.pathname === '/test/health') return send(response, 200, { status: 'UP' })
  if (request.method === 'GET' && url.pathname === '/test/state') return send(response, 200, state)
  if (request.method === 'POST' && url.pathname === '/test/release') {
    releasePrepare()
    return send(response, 200, { released: true })
  }
  if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
    state.providerCalls += 1
    if (request.headers.authorization !== 'Bearer synthetic-runtime-provider-key') return send(response, 401, {})
    await readJson(request)
    return send(response, 200, { choices: [{ message: { content: 'Disposable image drain answer' } }] })
  }

  const operation = url.pathname.split('/').at(-1)
  const health = request.method === 'GET' && operation === 'health'
  if (!url.pathname.startsWith('/api/internal/conversation-runtime/v1/')) return send(response, 404, {})
  if (request.headers.authorization !== `Bearer ${token}`) return send(response, 401, {})
  if (health) return send(response, 200, {
    contractVersion: 'conversation-runtime.v1', status: 'READY', runtimeOwner: 'CONVERSATION_RUNTIME',
  })

  const envelope = await readJson(request)
  if (!envelope || envelope.contractVersion !== 'conversation-runtime.v1' || envelope.operation !== operation) {
    return send(response, 400, { contractVersion: 'conversation-runtime.v1', ok: false, error: { code: 'SMOKE_ENVELOPE_INVALID', retryable: false } })
  }
  const { payload } = envelope
  const claim = { jobId, executionId, claimantId: payload.claimantId ?? 'smoke-runtime', version: 1,
    tenantId, businessId, accountId, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    deadlineAt: new Date(Date.now() + 120_000).toISOString(), correlationId: 'smoke-drain', phase: 'EXECUTION' }
  let data
  switch (operation) {
    case 'claim':
      state.claimCalls += 1
      data = state.claimCalls === 1 ? claim : null
      break
    case 'resolve':
      data = { authorized: true, version: 1, scope: { tenantId, businessId, accountId,
        identityId: '85b758eb-5a91-4611-90d7-24e6f6d55b31', identityVersion: 1 } }
      break
    case 'prepare':
      state.prepareCalls += 1
      state.prepareEntered = true
      await prepareGate
      data = { question: 'smoke drain', evidence: { records: [{ source: 'synthetic' }] },
        slices: [{ id: 'smoke-context', source: 'RECORD', text: 'Disposable authorized context' }],
        authorized: true, audienceKind: 'DIRECT', threadId: null, maxBudgetChars: 1024, workCommand: null }
      break
    case 'credential':
      data = { provider: 'prp', model: 'smoke-model', apiKey: 'synthetic-runtime-provider-key', baseUrl: 'http://smoke-core:4010' }
      break
    case 'trace':
      state.traceKinds.push(payload.kind)
      data = { recorded: true }
      break
    case 'status':
      data = { status: 'NOT_FOUND', operationId: payload.operationId, version: 1 }
      break
    case 'complete':
      state.completeCalls += 1
      data = { id: jobId, status: 'READY', version: 2, operationId: payload.operationId }
      break
    case 'send':
      state.sendCalls += 1
      data = { id: jobId, status: 'RECORDED', acceptance: { provider: 'synthetic' } }
      break
    default:
      return send(response, 400, { contractVersion: 'conversation-runtime.v1', ok: false, error: { code: 'SMOKE_OPERATION_UNSUPPORTED', retryable: false } })
  }
  send(response, 200, { contractVersion: 'conversation-runtime.v1', ok: true, data })
})

server.listen(4010, '0.0.0.0')
