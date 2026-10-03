import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createConversationRuntimeRouteHandlers } from '@/app/api/internal/conversation-runtime/v1/[operation]/route'
import { admitLineConversation, runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createConversationRuntimeCore } from '@/modules/line-oa-studio/application/conversation-runtime-core'
import { lineCatalogCommandReply, withLineCatalogCommand } from '@/modules/agent/line-catalog-command'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { addIdentifier } from '@/modules/inventory/application/inventory-identity-service'
import { createCoreClient } from '../../../../services/conversation-runtime/src/core-client.js'
import { createCorePorts } from '../../../../services/conversation-runtime/src/core-ports.js'
import { createConversationRuntime } from '../../../../services/conversation-runtime/src/turn-runtime.js'

// @req FR-210 — the `#sku` catalogue command for an account opted into the
//   Conversation Runtime cohort answers exactly as the Server worker does.
//   Every case admits one signed-shape LINE message to the runtime account and
//   runs both executors against the same database state:
//   - legacy: the Server worker's real answer port, `withLineCatalogCommand`
//     over a stand-in model, on the claimed job row, inside a transaction that is
//     rolled back (so its preview, commit or cancel does not survive), with the
//     worker's own answer bound (trimmed, 1..5,000 characters);
//   - runtime: `createConversationRuntime().runOne()` over the real Core route
//     handlers (Core client -> route -> Core -> Inventory services -> SQLite).
//   The reply the runtime commits and sends must equal the legacy reply byte for
//   byte. Only the LINE transport and the model are local fakes; the model is
//   reached only for a message that is not a command its sender may run.
// @req FR-149, FR-171 — the same durable completion and Core-coordinated send.
// @spec ADR-084 D4; ADR-106 D1-D4; SDD-091; SDD-110; BR-042
// @tested tests/integration/conversation-runtime-catalog-command.test.js
const serviceToken = 'synthetic-catalog-command-core-token-0000001'
const sealKey = '5c'.repeat(32)
const MODEL_ANSWER = 'คำตอบจากโมเดลทดสอบ'
// The Server worker's own bound on an answer (`zCompletion.shape.text`).
const serverAnswerBound = z.string().trim().min(1).max(5000)

let tenant, business, provider, account, owner, member, sequence = 0
let wire = []
let deliveries = []
let modelCalls = 0
let openJobs = []

const transport = sink => ({
  resolveAccount: async id => prisma.lineOaAccount.findUnique({ where: { id } }),
  replyTransport: { send: async ({ messages }) => { sink.push({ method: 'REPLY', messages }); return { status: 'ACCEPTED_BY_LINE', requestId: `reply-${sink.length}` } } },
  pushTransport: { send: async ({ messages, retryKey }) => { sink.push({ method: 'PUSH', messages, retryKey }); return { status: 'ACCEPTED_BY_LINE', requestId: `push-${sink.length}` } } },
})

function inProcessFetch(handlers) {
  return async (url, init = {}) => {
    const target = new URL(url)
    const operation = target.pathname.split('/').pop()
    if (init.body) wire.push(JSON.parse(init.body).operation)
    const request = new Request(target, init)
    return operation === 'health'
      ? handlers.GET(request, { params: { operation } })
      : handlers.POST(request, { params: { operation } })
  }
}

function buildRuntime() {
  const core = createConversationRuntimeCore({ db: prisma,
    env: { CONVERSATION_RUNTIME_TOKEN: serviceToken, ZURI_LINE_REPLY_SEAL_KEY: sealKey },
    // An ordinary turn in this suite is grounded on one synthetic record and answered
    // by the stand-in model, the same stand-in the legacy answer port wraps.
    prepareTurn: async job => ({ question: job.inbound.body, evidence: { records: [{ product: 'synthetic-product' }] },
      slices: [], authorized: true, audienceKind: job.audienceKind, threadId: null, maxBudgetChars: 0, workCommand: null }),
    credentialResolver: async () => ({ provider: 'prp', model: 'controlled-model', apiKey: 'synthetic-provider-key' }),
    linePorts: () => transport(deliveries) })
  const client = createCoreClient({ baseUrl: 'http://core.invalid', token: serviceToken,
    fetchFn: inProcessFetch(createConversationRuntimeRouteHandlers(core)) })
  const ports = createCorePorts({ client, model: { generate: async () => { modelCalls += 1; return MODEL_ANSWER } } })
  return createConversationRuntime({ ports, claimantId: `runtime-catalog-${++sequence}` })
}

const legacyModel = async () => ({ text: MODEL_ANSWER })

async function admit(text, { user = owner, source = null } = {}) {
  const eventId = `synthetic-catalog-${++sequence}`
  const at = new Date()
  const current = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
  const { jobId } = await admitLineConversation({ db: prisma, account: current, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey },
    correlationId: eventId, now: at, ingressReceivedAt: at,
    event: { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: at.getTime(),
      source: source ?? { type: 'user', userId: user.lineUserId },
      message: { type: 'text', id: `synthetic-message-${eventId}`, text } } })
  openJobs.push(jobId)
  // The row exactly as the Server worker's claim hands it to the answer port.
  return prisma.lineConversationJob.findUnique({ where: { id: jobId }, include: { account: true, inbound: { include: { conversation: true } } } })
}

const ROLLBACK = Symbol('rollback')
/** The Server worker's reply for this job, with none of its writes surviving. */
async function legacyReply(job) {
  let reply
  try {
    await prisma.$transaction(async tx => {
      reply = await withLineCatalogCommand(legacyModel, { db: tx })(job, {})
      throw ROLLBACK
    }, { timeout: 30_000 })
  } catch (cause) { if (cause !== ROLLBACK) throw cause }
  return serverAnswerBound.parse(reply?.text ?? reply)
}

/** Run one admitted job through both executors and return both replies. */
async function bothPaths(text, options) {
  const job = await admit(text, options)
  expect(job.runtimeOwner).toBe('CONVERSATION_RUNTIME')
  const legacy = await legacyReply(job)
  wire = []
  deliveries = []
  const outcome = await buildRuntime().runOne()
  expect(outcome).toMatchObject({ jobId: job.id, status: 'RECORDED' })
  const after = await prisma.lineConversationJob.findUnique({ where: { id: job.id } })
  expect(deliveries).toHaveLength(1)
  return { job, legacy, committed: after.answerText, delivered: deliveries[0].messages[0].text, operations: [...wire] }
}

/** A command turn: identical bytes, and no model or Work tool asked for. */
async function expectCommandParity(text, options) {
  const result = await bothPaths(text, options)
  expect(Buffer.from(result.committed, 'utf8').equals(Buffer.from(result.legacy, 'utf8'))).toBe(true)
  expect(result.committed).toBe(result.legacy)
  expect(result.delivered).toBe(result.legacy)
  expect(result.operations).not.toContain('credential')
  expect(result.operations).not.toContain('work-tool')
  expect(result.legacy).not.toBe(MODEL_ANSWER)
  return result
}

let commandRuns = 0
function guardCore() {
  return createConversationRuntimeCore({ db: prisma, env: { CONVERSATION_RUNTIME_TOKEN: serviceToken },
    catalogCommand: (job, deps) => { commandRuns += 1; return lineCatalogCommandReply(job, deps) },
    prepareTurn: async job => ({ question: job.inbound.body, evidence: { records: [{ product: 'synthetic-product' }] },
      slices: [], authorized: true, audienceKind: job.audienceKind, threadId: null, maxBudgetChars: 0, workCommand: null }),
    credentialResolver: async () => ({ provider: 'prp', model: 'controlled-model', apiKey: 'synthetic-provider-key' }) })
}
async function claimFor(core, jobId, claimantId) {
  const claimed = await core.operate({ operation: 'claim', payload: { claimantId } })
  expect(claimed.jobId).toBe(jobId)
  return { jobId: claimed.jobId, executionId: claimed.executionId, claimantId: claimed.claimantId, version: claimed.version,
    tenantId: claimed.tenantId, businessId: claimed.businessId, accountId: claimed.accountId }
}
async function commits(code) {
  const intake = await prisma.inventoryCatalogIntake.findFirst({ where: { businessId: business.id, code } })
  return prisma.auditEvent.count({ where: { entityType: 'INVENTORY_CATALOG_INTAKE', entityId: intake.id, action: 'INVENTORY_CATALOG_INTAKE_COMMITTED' } })
}

const intakeCode = text => text.match(/CIT-[0-9A-F]{8}/)[0]

async function person(code, role, lineUserId) {
  const row = await prisma.person.create({ data: { code, displayName: code } })
  await prisma.membership.create({ data: { personId: row.id, tenantId: tenant.id, businessId: business.id, role, status: 'ACTIVE', domainKeysJson: '["inventory"]' } })
  const at = new Date(Date.now() - 86_400_000)
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: row.id, provider: 'LINE',
    providerSubject: lineUserId, verifiedAt: at, linkedAt: at } })
  await prisma.channelIdentity.create({ data: { personId: row.id, tenantId: tenant.id, channel: 'LINE',
    channelAccountId: account.bindingCode, providerSubject: lineUserId, status: 'ACTIVE', verifiedAt: at, linkedAt: at } })
  return { ...row, lineUserId }
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ code: 'PF-CR-SKU', name: 'Runtime #sku fixture' })
  tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-CR-SKU', name: 'Runtime #sku tenant' })
  business = await createBusiness({ tenantId: tenant.id, code: 'BUS-CR-SKU', name: 'Runtime #sku business' })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: 'Synthetic #sku connection', externalAccountId: 'synthetic-sku-destination', status: 'ACTIVE' })
  account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: 'cr-sku-runtime', displayName: 'Synthetic #sku OA', bindingCode: 'cr-sku-binding',
    status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD', runtimeOwner: 'CONVERSATION_RUNTIME' } })
  owner = await person('PER-CR-SKU-OWNER', 'OWNER', 'synthetic-sku-owner')
  member = await person('PER-CR-SKU-MEMBER', 'MEMBER', 'synthetic-sku-member')
  const seed = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['projects', 'platform', 'inventory'] })
  const category = await createCategory({ businessId: business.id, code: 'CRSKU-CAT', nameTh: 'แก้ว', nameEn: 'Cups' }, { viewer: seed })
  const cups = await createProductMaster({ businessId: business.id, code: 'CRSKU-CUPS', categoryId: category.id, nameTh: 'แก้ว', nameEn: 'Cups' }, { viewer: seed })
  const black = await createProduct({ businessId: business.id, code: 'CRSKU-CUP-BLK', productMasterId: cups.id, name: 'แก้วดำ' }, { viewer: seed })
  await addIdentifier(black.id, { businessId: business.id, kind: 'GTIN', value: '4006381333931' }, { viewer: seed })
  await createProduct({ businessId: business.id, code: 'CRSKU-CUP-WHT', productMasterId: cups.id, name: 'แก้วขาว' }, { viewer: seed })
})

afterEach(async () => {
  await prisma.lineConversationJob.updateMany({ where: { id: { in: openJobs }, status: { in: ['QUEUED', 'CLAIMED', 'READY'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_CATALOG_DONE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  openJobs = []
  wire = []
  deliveries = []
})

describe('FR-210 #sku in the Conversation Runtime cohort — byte parity with the Server worker', () => {
  it('found: a barcode resolves to the existing SKU, and confirming that preview commits it', async () => {
    const preview = await expectCommandParity(['#sku', 'รหัส: CRSKU-CUP-BLACK', 'สินค้าหลัก: CRSKU-CUPS', 'บาร์โค้ด: 4006381333931',
      'หน่วยแปลง: BOX12=12'].join('\n'))
    expect(preview.legacy).toContain('1) CRSKU-CUP-BLACK — พบ SKU เดิม CRSKU-CUP-BLK (ตรงบาร์โค้ด/รหัสคู่ค้า) · เพิ่ม หน่วย BOX12=12')
    const code = intakeCode(preview.legacy)
    // The legacy run was rolled back; the runtime's preview is the one that exists.
    expect(await prisma.inventoryCatalogIntake.findMany({ where: { businessId: business.id, code }, select: { status: true, requestedById: true } }))
      .toEqual([{ status: 'PREVIEWED', requestedById: owner.id }])

    const confirmed = await expectCommandParity(`#sku ยืนยัน ${code}`)
    expect(confirmed.legacy).toContain(`บันทึกแล้ว ${code}`)
    expect(confirmed.legacy).toContain('เพิ่มข้อมูลให้ SKU เดิม 1')
    expect((await prisma.inventoryCatalogIntake.findFirst({ where: { businessId: business.id, code } })).status).toBe('COMMITTED')

    // Confirming again answers "saved" again; cancelling a committed intake is refused.
    expect((await expectCommandParity(`#sku confirm ${code.toLowerCase()}`)).legacy).toContain(`บันทึกแล้ว ${code}`)
    expect((await expectCommandParity(`#sku ยกเลิก ${code}`)).legacy).toBe('รายการนี้บันทึกไปแล้ว ยกเลิกไม่ได้')
  })

  it('not found: a new code is planned as a new SKU, an unknown intake code is not found, and a cancel writes nothing', async () => {
    const preview = await expectCommandParity(['#sku', 'รหัส: CRSKU-CUP-RED', 'ชื่อ: แก้วแดง', 'สินค้าหลัก: CRSKU-CUPS',
      'บาร์โค้ด: 036000291452'].join('\n'))
    expect(preview.legacy).toContain('1) CRSKU-CUP-RED — สร้าง SKU ใหม่ใต้ CRSKU-CUPS')
    expect((await expectCommandParity('#sku ยืนยัน CIT-00000000')).legacy).toBe('ไม่พบรายการนี้ หรือรายการนี้ไม่ได้ตรวจโดยคุณ')

    const code = intakeCode(preview.legacy)
    expect((await expectCommandParity(`#sku ยกเลิก ${code}`)).legacy).toBe(`ยกเลิก ${code} แล้ว — ไม่มีอะไรถูกบันทึก`)
    expect((await expectCommandParity(`#sku ยืนยัน ${code}`)).legacy).toBe('รายการนี้ถูกยกเลิกไปแล้ว')
    expect(await prisma.product.count({ where: { businessId: business.id, code: 'CRSKU-CUP-RED' } })).toBe(0)
  })

  it('several matches: identifiers that point at different SKUs are a conflict, and the batch cannot be confirmed', async () => {
    const result = await expectCommandParity(['#sku', 'รหัส: CRSKU-CUP-WHT', 'สินค้าหลัก: CRSKU-CUPS', 'บาร์โค้ด: 4006381333931'].join('\n'))
    expect(result.legacy).toContain('1) CRSKU-CUP-WHT — ติดปัญหา: รหัสในรายการนี้ชี้ไปที่ SKU ต่างกัน:')
    expect(result.legacy).toContain('ยังบันทึกไม่ได้')
    expect(result.legacy).not.toContain('#sku ยืนยัน')
  })

  it.each([
    ['bare command (help)', '#sku'],
    ['help word', '#SKU help'],
    ['confirm without a code', '#sku ยืนยัน'],
    ['confirm with a malformed code', '#sku ยืนยัน CIT-12'],
    ['unknown key', '#sku\nรหัส: CRSKU-X\nราคา: 99'],
    ['line without a key', '#sku\nรหัส: CRSKU-Y\nแก้วสวยมาก'],
    ['unknown master (invalid item)', '#sku\nรหัส: CRSKU-Z\nสินค้าหลัก: CRSKU-NOPE'],
    ['separator only', '#sku\n---'],
  ])('malformed: %s', async (_label, text) => {
    const result = await expectCommandParity(text)
    expect(result.legacy.length).toBeGreaterThan(0)
  })

  it('a sender without Inventory write authority is answered as an ordinary question on both paths', async () => {
    const before = await prisma.inventoryCatalogIntake.count({ where: { businessId: business.id } })
    const result = await bothPaths('#sku\nรหัส: CRSKU-MEMBER\nสินค้าหลัก: CRSKU-CUPS', { user: member })
    expect(result.legacy).toBe(MODEL_ANSWER)
    expect(result.committed).toBe(result.legacy)
    expect(result.delivered).toBe(result.legacy)
    expect(result.operations).toContain('credential')
    expect(await prisma.inventoryCatalogIntake.count({ where: { businessId: business.id } })).toBe(before)
  })

  it('Core pins a command turn: no credential or Work tool, and READY only for the stored reply', async () => {
    const job = await admit('#sku')
    const core = guardCore()
    const claim = await claimFor(core, job.id, 'runtime-catalog-guard')
    // Nothing is handed out for a `#sku` message before prepare has decided it.
    await expect(core.operate({ operation: 'credential', payload: { claim } })).rejects.toMatchObject({ code: 'CATALOG_COMMAND_NOT_PREPARED', status: 409 })
    await expect(core.operate({ operation: 'complete', payload: { claim, text: 'anything', operationId: `${job.id}:turn-answer` } }))
      .rejects.toMatchObject({ code: 'CATALOG_COMMAND_NOT_PREPARED', status: 409 })
    const prepared = await core.operate({ operation: 'prepare', payload: { claim, authorityVersion: claim.version } })
    expect(prepared).toMatchObject({ turnKind: 'CATALOG_COMMAND', workCommand: null, evidence: { records: [] }, slices: [] })
    expect(prepared.replyText).toContain('คำสั่งนำเข้าสินค้า (#sku)')
    await expect(core.operate({ operation: 'credential', payload: { claim } })).rejects.toMatchObject({ code: 'CATALOG_COMMAND_TURN_HAS_NO_MODEL', status: 409 })
    await expect(core.operate({ operation: 'work-tool', payload: { claim, operation: 'read', operationId: `${job.id}:work-read`, input: {} } }))
      .rejects.toMatchObject({ code: 'CATALOG_COMMAND_TURN_HAS_NO_WORK', status: 409 })
    // A runtime cannot report a different outcome than the one Core produced.
    for (const text of ['บันทึกแล้ว CIT-00000000', `${prepared.replyText.trim()}.`, MODEL_ANSWER]) {
      await expect(core.operate({ operation: 'complete', payload: { claim, text, operationId: `${job.id}:turn-answer` } }))
        .rejects.toMatchObject({ code: 'CATALOG_COMMAND_REPLY_MISMATCH', status: 409 })
    }
    expect(await core.operate({ operation: 'complete', payload: { claim, text: prepared.replyText.trim(), operationId: `${job.id}:turn-answer` } }))
      .toMatchObject({ status: 'READY' })
    expect((await prisma.lineConversationJob.findUnique({ where: { id: job.id } })).answerText).toBe(prepared.replyText.trim())
  })

  it('an ordinary #sku decision is stored too: the model path stays open for a sender without authority', async () => {
    const job = await admit('#sku', { user: member })
    const core = guardCore()
    const claim = await claimFor(core, job.id, 'runtime-catalog-ordinary')
    const prepared = await core.operate({ operation: 'prepare', payload: { claim, authorityVersion: claim.version } })
    expect(prepared.turnKind).toBeUndefined()
    expect(await core.operate({ operation: 'credential', payload: { claim } })).toMatchObject({ provider: 'prp' })
    expect(await core.operate({ operation: 'complete', payload: { claim, text: MODEL_ANSWER, operationId: `${job.id}:turn-answer` } }))
      .toMatchObject({ status: 'READY' })
  })

  it('a reclaimed confirm replays the stored reply and never imports twice', async () => {
    const code = intakeCode((await expectCommandParity(['#sku', 'รหัส: CRSKU-CUP-GRN', 'ชื่อ: แก้วเขียว', 'สินค้าหลัก: CRSKU-CUPS'].join('\n'))).legacy)
    const job = await admit(`#sku ยืนยัน ${code}`)
    const core = guardCore()
    const first = await claimFor(core, job.id, 'runtime-catalog-first')
    const firstTurn = await core.operate({ operation: 'prepare', payload: { claim: first, authorityVersion: first.version } })
    expect(firstTurn.replyText).toContain(`บันทึกแล้ว ${code}`)
    expect(await prisma.product.count({ where: { businessId: business.id, code: 'CRSKU-CUP-GRN' } })).toBe(1)

    // The first runtime dies before completing: its lease lapses and another claims the job.
    await prisma.lineConversationJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } })
    const second = await claimFor(core, job.id, 'runtime-catalog-second')
    expect(second.executionId).not.toBe(first.executionId)
    const commitsBefore = await commits(code)
    commandRuns = 0
    const secondTurn = await core.operate({ operation: 'prepare', payload: { claim: second, authorityVersion: second.version } })
    expect(secondTurn).toEqual(firstTurn)
    expect(commandRuns).toBe(0)
    expect(await commits(code)).toBe(commitsBefore)
    expect(await prisma.product.count({ where: { businessId: business.id, code: 'CRSKU-CUP-GRN' } })).toBe(1)
    // The stale execution can no longer complete; the new one completes with the same reply.
    await expect(core.operate({ operation: 'complete', payload: { claim: first, text: firstTurn.replyText.trim(), operationId: `${job.id}:turn-answer` } }))
      .rejects.toMatchObject({ status: 409 })
    expect(await core.operate({ operation: 'complete', payload: { claim: second, text: firstTurn.replyText.trim(), operationId: `${job.id}:turn-answer` } }))
      .toMatchObject({ status: 'READY' })
  })

  it('a reclaimed cancel replays its reply rather than answering "already cancelled"', async () => {
    const code = intakeCode((await expectCommandParity(['#sku', 'รหัส: CRSKU-CUP-PNK', 'สินค้าหลัก: CRSKU-CUPS'].join('\n'))).legacy)
    const job = await admit(`#sku ยกเลิก ${code}`)
    const core = guardCore()
    const first = await claimFor(core, job.id, 'runtime-catalog-cancel-1')
    const firstTurn = await core.operate({ operation: 'prepare', payload: { claim: first, authorityVersion: first.version } })
    expect(firstTurn.replyText).toBe(`ยกเลิก ${code} แล้ว — ไม่มีอะไรถูกบันทึก`)
    await prisma.lineConversationJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } })
    const second = await claimFor(core, job.id, 'runtime-catalog-cancel-2')
    commandRuns = 0
    expect(await core.operate({ operation: 'prepare', payload: { claim: second, authorityVersion: second.version } })).toEqual(firstTurn)
    expect(commandRuns).toBe(0)
  })

  it('two concurrent prepares of one confirm leave exactly one product and hand out one reply', async () => {
    const code = intakeCode((await expectCommandParity(['#sku', 'รหัส: CRSKU-CUP-YLW', 'ชื่อ: แก้วเหลือง', 'สินค้าหลัก: CRSKU-CUPS'].join('\n'))).legacy)
    const job = await admit(`#sku ยืนยัน ${code}`)
    const core = guardCore()
    const claim = await claimFor(core, job.id, 'runtime-catalog-race')
    const turns = await Promise.all([0, 1].map(() => core.operate({ operation: 'prepare', payload: { claim, authorityVersion: claim.version } })))
    expect(turns[1]).toEqual(turns[0])
    expect(turns[0].replyText).toContain(`บันทึกแล้ว ${code}`)
    expect(await prisma.product.count({ where: { businessId: business.id, code: 'CRSKU-CUP-YLW' } })).toBe(1)
    expect(await commits(code)).toBe(1)
    expect(await prisma.agentTraceEvent.count({ where: { turnId: job.id, idempotencyKey: `${job.id}:catalog-command` } })).toBe(1)
  })

  it('the same message in a group is an ordinary question, never the command', async () => {
    // Addressed to the bot so the group message is answered at all.
    const text = '#sku ซูริ'
    const direct = await expectCommandParity(text)
    expect(direct.legacy).toContain('บรรทัด 1: "ซูริ"')

    modelCalls = 0
    const before = await prisma.inventoryCatalogIntake.count({ where: { businessId: business.id } })
    const job = await admit(text, { source: { type: 'group', groupId: 'synthetic-sku-group', userId: owner.lineUserId } })
    expect(job.audienceKind).toBe('GROUP')
    const legacy = await legacyReply(job)
    expect(legacy).toBe(MODEL_ANSWER)
    // Core's shared resolver declines the group job, so whichever cohort owns it
    // answers it as an ordinary turn.
    expect(await lineCatalogCommandReply(job)).toBeNull()
    deliveries = []
    if (job.runtimeOwner === 'CONVERSATION_RUNTIME') {
      expect(await buildRuntime().runOne()).toMatchObject({ jobId: job.id, status: 'RECORDED' })
      expect(modelCalls).toBe(1)
    } else {
      await runLineConversationWorker({ db: prisma, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey }, workerId: 'server-catalog-group',
        answer: withLineCatalogCommand(async () => { modelCalls += 1; return { text: MODEL_ANSWER } }), ...transport(deliveries) })
      expect(modelCalls).toBe(1)
    }
    expect(deliveries.map(delivery => delivery.messages[0].text)).toEqual([legacy])
    expect((await prisma.lineConversationJob.findUnique({ where: { id: job.id } })).answerText).toBe(legacy)
    expect(await prisma.inventoryCatalogIntake.count({ where: { businessId: business.id } })).toBe(before)
  })
})
