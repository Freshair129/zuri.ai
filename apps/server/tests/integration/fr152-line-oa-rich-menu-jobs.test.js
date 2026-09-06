// @req FR-152 — the rich menu publish ledger against a real database: queue
//   rules, the server-owned fence, compare-and-set claim and lease, the
//   PUBLISH stages through a faked provider port, retry versus UNKNOWN by
//   idempotency, default and alias jobs, acknowledgement, audit.
// @spec ADR-061 D1, D6, D7; ADR-060 D3, D11; SEC-001
// @tested tests/integration/fr152-line-oa-rich-menu-jobs.test.js
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { LINE_OA_PROVIDER_CODE, createIntegrationConnection, registerIntegrationProvider } from '@/platform/integrations/core/integration-registry'
import { ROLE_LINE_OA_PUBLISHER } from '@/modules/identity/rbac'
import { applyRichMenuAction, createRichMenu } from '@/modules/line-oa-studio/application/line-oa-rich-menu-service'
import {
  acknowledgeUnknownRichMenuJob,
  listRichMenuJobs,
  queueRichMenuJob,
  runLineRichMenuWorker,
} from '@/modules/line-oa-studio/application/line-oa-rich-menu-jobs'

const DOMAINS = ['projects', 'platform', 'line-oa']
const start = new Date('2026-09-06T15:00:00.000Z')
const later = (ms) => new Date(start.getTime() + ms)
let tenant, business, provider, owner, publisher, member, pngFile, seq = 0

async function account(over = {}) {
  const n = ++seq
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: `RM conn ${n}`, externalAccountId: `rm-oa-${n}`, purpose: 'GENERAL', status: 'ACTIVE' })
  return prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id, code: `rm-account-${n}`, displayName: `RM OA ${n}`,
    bindingCode: `rm-binding-${n}`, transportMode: 'CLOUD', serverEnabled: true, status: 'CONNECTED', executionMode: 'SERVER', ...over,
  } })
}
const area = (x, y, w, h, action = { type: 'MESSAGE', text: 'สวัสดี' }) => ({ bounds: { x, y, width: w, height: h }, action })
const draft = (over = {}) => ({ layout: '2x1', chatBarText: 'เมนู', imageFileAssetId: pngFile.id, imageWidth: 2500, imageHeight: 843, areas: [area(0, 0, 1250, 843), area(1250, 0, 1250, 843)], ...over })

async function frozenMenu(oa, over = {}) {
  const n = ++seq
  const menu = await createRichMenu({ accountId: oa.id, code: `menu-${n}`, name: `Menu ${n}`, alias: `alias-${n}`, draft: draft(over.draft), ...over.menu }, { viewer: owner })
  return applyRichMenuAction(menu.id, { action: 'FREEZE', version: menu.version }, { viewer: owner })
}
const accepted = (extra = {}) => ({ status: 'ACCEPTED_BY_LINE', httpStatus: 200, requestId: 'req-ok', code: null, ...extra })
const transport = (over = {}) => ({
  create: vi.fn(async () => accepted({ richMenuId: 'richmenu-created' })),
  uploadImage: vi.fn(async () => accepted()),
  setDefault: vi.fn(async () => accepted()),
  setAlias: vi.fn(async () => accepted()),
  ...over,
})
const worker = (over = {}) => ({
  db: prisma, now: () => start, workerId: 'test-rm-worker',
  resolveAccount: vi.fn(async (id) => prisma.lineOaAccount.findUnique({ where: { id } })),
  richMenuTransport: transport(),
  readImage: vi.fn(async () => ({ bytes: new Uint8Array([137, 80, 78, 71]), mime: 'image/png' })),
  ...over,
})
const jobRow = (id) => prisma.lineOaRichMenuJob.findUnique({ where: { id } })
const versionRow = (id) => prisma.lineOaRichMenuVersion.findUnique({ where: { id } })

describe('FR-152 LineOaRichMenuJob', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-LINE-RMJ', name: 'Rich Menu Jobs' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-LINE-RMJ', name: 'RMJ Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-LINE-RMJ', name: 'RMJ Business' })
    provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS })
    publisher = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [business.id]: [ROLE_LINE_OA_PUBLISHER] } })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS })
    pngFile = await prisma.fileAsset.create({ data: { code: 'FIL-RMJ-1', tenantId: tenant.id, businessId: business.id, storageKind: 'MANAGED_BLOB', blobRef: 'blob-rmj-1', name: 'menu.png', mime: 'image/png', size: 4, sha256: 'sha-rmj', status: 'ACTIVE' } })
  })

  // The worker takes the oldest due job in the whole table, so each case
  // starts from an empty queue: whatever a previous case left QUEUED is run
  // to completion (with an accepting port) before the next assertion.
  beforeEach(async () => {
    for (let i = 0; i < 10; i++) {
      const result = await runLineRichMenuWorker(worker({ now: () => later(10 * 60_000) }))
      if (result.status === 'IDLE') break
    }
  })

  it('AC-152.1 — queues PUBLISH for the frozen version under publisher authority, once, on a server-owned account', async () => {
    const oa = await account()
    const menu = await frozenMenu(oa)
    await expect(queueRichMenuJob(menu.id, { kind: 'PUBLISH', version: menu.version }, { viewer: member })).rejects.toMatchObject({ status: 404 })
    const job = await queueRichMenuJob(menu.id, { kind: 'PUBLISH', version: menu.version }, { viewer: publisher, now: start })
    expect(job).toMatchObject({ kind: 'PUBLISH', stage: 'CREATE', status: 'QUEUED', attempts: 0, externalRichMenuId: null, richMenuId: menu.id })
    expect(job.correlationId).toBeTruthy()
    // The menu's version moved, so the caller's copy is stale, and one open job is enough.
    await expect(queueRichMenuJob(menu.id, { kind: 'PUBLISH', version: menu.version }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_RICH_MENU_VERSION_CONFLICT' })
    await expect(queueRichMenuJob(menu.id, { kind: 'PUBLISH', version: menu.version + 1 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_RICH_MENU_JOB_OPEN' })
    const listed = await listRichMenuJobs(menu.id, { viewer: member })
    expect(listed.jobs.map((j) => j.id)).toEqual([job.id])
    // SET_DEFAULT needs a published version; nothing is published yet.
    const other = await frozenMenu(oa)
    await expect(queueRichMenuJob(other.id, { kind: 'SET_DEFAULT', version: other.version }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_RICH_MENU_NOT_PUBLISHED' })
  })

  it('AC-152.2 — refuses an account that is not server-owned, a menu with no frozen version, and an unresolved LIFF action', async () => {
    const legacy = await account({ serverEnabled: false })
    const legacyMenu = await frozenMenu(legacy)
    await expect(queueRichMenuJob(legacyMenu.id, { kind: 'PUBLISH', version: legacyMenu.version }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_ACCOUNT_SERVER_NOT_ENABLED' })
    const oa = await account()
    const draftOnly = await createRichMenu({ accountId: oa.id, code: `draft-only-${++seq}`, name: 'Draft', draft: draft() }, { viewer: owner })
    await expect(queueRichMenuJob(draftOnly.id, { kind: 'PUBLISH', version: draftOnly.version }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_RICH_MENU_NO_FROZEN_VERSION' })
    const liff = await frozenMenu(oa, { draft: { areas: [area(0, 0, 2500, 843, { type: 'LIFF', liffAppCode: 'shop' })] } })
    await expect(queueRichMenuJob(liff.id, { kind: 'PUBLISH', version: liff.version }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'LINE_OA_RICH_MENU_LIFF_UNRESOLVED' })
  })

  it('AC-152.3 — the worker publishes: create, persist the id, upload, then the version is PUBLISHED and the previous one RETIRED', async () => {
    const oa = await account()
    const menu = await frozenMenu(oa)
    const job = await queueRichMenuJob(menu.id, { kind: 'PUBLISH', version: menu.version }, { viewer: owner, now: start })
    const w = worker()
    expect(await runLineRichMenuWorker(w)).toEqual({ id: job.id, status: 'ACCEPTED', stage: 'DONE' })
    expect(w.richMenuTransport.create).toHaveBeenCalledTimes(1)
    const [{ richMenu }] = w.richMenuTransport.create.mock.calls[0]
    expect(richMenu).toMatchObject({ size: { width: 2500, height: 843 }, chatBarText: 'เมนู', name: menu.name })
    expect(richMenu.areas[0].action).toEqual({ type: 'message', text: 'สวัสดี' })
    expect(w.richMenuTransport.uploadImage).toHaveBeenCalledWith(expect.objectContaining({ richMenuId: 'richmenu-created', mime: 'image/png' }))
    expect(await jobRow(job.id)).toMatchObject({ status: 'ACCEPTED', stage: 'DONE', externalRichMenuId: 'richmenu-created', attempts: 1, claimantId: null, leaseExpiresAt: null })
    const v1 = await versionRow(job.versionId)
    expect(v1).toMatchObject({ status: 'PUBLISHED', externalRichMenuId: 'richmenu-created' })
    expect(v1.publishedAt).toBeTruthy()
    expect(await runLineRichMenuWorker(w)).toEqual({ status: 'IDLE' })

    // A second frozen version publishes and retires the first.
    const saved = await applyRichMenuAction(menu.id, { action: 'SAVE_DRAFT', version: (await prisma.lineOaRichMenu.findUnique({ where: { id: menu.id } })).version, draft: draft({ chatBarText: 'รุ่นสอง' }) }, { viewer: owner })
    const frozen = await applyRichMenuAction(menu.id, { action: 'FREEZE', version: saved.version }, { viewer: owner })
    await queueRichMenuJob(menu.id, { kind: 'PUBLISH', version: frozen.version }, { viewer: owner, now: start })
    const w2 = worker({ richMenuTransport: transport({ create: vi.fn(async () => accepted({ richMenuId: 'richmenu-second' })) }) })
    expect((await runLineRichMenuWorker(w2)).status).toBe('ACCEPTED')
    const versions = await prisma.lineOaRichMenuVersion.findMany({ where: { richMenuId: menu.id }, orderBy: { versionNumber: 'asc' } })
    expect(versions.map((v) => [v.versionNumber, v.status, v.externalRichMenuId])).toEqual([[1, 'RETIRED', 'richmenu-created'], [2, 'PUBLISHED', 'richmenu-second']])
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'LINE_OA_RICH_MENU_JOB', entityId: job.id }, orderBy: { occurredAt: 'asc' } })
    expect(audits.map((a) => a.action)).toEqual(['LINE_OA_RICH_MENU_JOB_QUEUED', 'LINE_OA_RICH_MENU_PUBLISHED'])
    for (const row of audits) expect(row.payloadJson).not.toMatch(/token|secret/i)
  })

  it('AC-152.4 — an unconfirmed create is UNKNOWN (never retried); an operator acknowledges it', async () => {
    const oa = await account()
    const menu = await frozenMenu(oa)
    const job = await queueRichMenuJob(menu.id, { kind: 'PUBLISH', version: menu.version }, { viewer: owner, now: start })
    const w = worker({ richMenuTransport: transport({ create: vi.fn(async () => ({ status: 'UNCONFIRMED', httpStatus: null, requestId: null, code: 'LINE_NETWORK_UNAVAILABLE', richMenuId: null })) }) })
    expect(await runLineRichMenuWorker(w)).toEqual({ id: job.id, status: 'UNKNOWN', stage: 'CREATE' })
    const row = await jobRow(job.id)
    expect(row).toMatchObject({ status: 'UNKNOWN', errorCode: 'LINE_NETWORK_UNAVAILABLE', attempts: 1 })
    expect(await runLineRichMenuWorker(w)).toEqual({ status: 'IDLE' })
    expect(w.richMenuTransport.create).toHaveBeenCalledTimes(1)
    expect((await versionRow(job.versionId)).status).toBe('FROZEN')
    await expect(acknowledgeUnknownRichMenuJob(menu.id, { jobId: job.id, version: row.version, acknowledgePossibleOutcome: true }, { viewer: member })).rejects.toMatchObject({ status: 404 })
    const closed = await acknowledgeUnknownRichMenuJob(menu.id, { jobId: job.id, version: row.version, acknowledgePossibleOutcome: true }, { viewer: publisher })
    expect(closed).toMatchObject({ status: 'CANCELLED', errorCode: 'OPERATOR_ACKNOWLEDGED_UNKNOWN' })
    // The menu is free again: a new PUBLISH may be queued.
    const current = await prisma.lineOaRichMenu.findUnique({ where: { id: menu.id } })
    await expect(queueRichMenuJob(menu.id, { kind: 'PUBLISH', version: current.version }, { viewer: owner, now: start })).resolves.toMatchObject({ status: 'QUEUED' })
  })

  it('AC-152.5 — a retryable upload goes back to QUEUED with backoff and keeps the created id; a permanent one FAILS keeping it too', async () => {
    const oa = await account()
    const menu = await frozenMenu(oa)
    const job = await queueRichMenuJob(menu.id, { kind: 'PUBLISH', version: menu.version }, { viewer: owner, now: start })
    const upload = vi.fn()
      .mockResolvedValueOnce({ status: 'RETRYABLE_FAILURE', httpStatus: 503, requestId: 'req-503', code: 'LINE_HTTP_503' })
      .mockResolvedValueOnce(accepted({ requestId: 'req-upload' }))
    const w = worker({ richMenuTransport: transport({ uploadImage: upload }) })
    expect(await runLineRichMenuWorker(w)).toEqual({ id: job.id, status: 'QUEUED', stage: 'UPLOAD' })
    let row = await jobRow(job.id)
    expect(row).toMatchObject({ status: 'QUEUED', stage: 'UPLOAD', externalRichMenuId: 'richmenu-created', errorCode: 'LINE_HTTP_503', attempts: 1 })
    expect(row.availableAt.getTime()).toBeGreaterThan(start.getTime())
    // Not due yet: the backoff holds.
    expect(await runLineRichMenuWorker(w)).toEqual({ status: 'IDLE' })
    expect(await runLineRichMenuWorker({ ...w, now: () => later(120_000) })).toEqual({ id: job.id, status: 'ACCEPTED', stage: 'DONE' })
    // The create was not repeated: the persisted id was reused.
    expect(w.richMenuTransport.create).toHaveBeenCalledTimes(1)
    row = await jobRow(job.id)
    expect(row).toMatchObject({ status: 'ACCEPTED', attempts: 2, providerRequestId: 'req-upload', errorCode: null })

    const menu2 = await frozenMenu(oa)
    const job2 = await queueRichMenuJob(menu2.id, { kind: 'PUBLISH', version: menu2.version }, { viewer: owner, now: start })
    const w2 = worker({ richMenuTransport: transport({ uploadImage: vi.fn(async () => ({ status: 'PERMANENT_FAILURE', httpStatus: 400, requestId: 'req-400', code: 'LINE_HTTP_400' })) }) })
    expect(await runLineRichMenuWorker(w2)).toEqual({ id: job2.id, status: 'FAILED', stage: 'UPLOAD' })
    expect(await jobRow(job2.id)).toMatchObject({ status: 'FAILED', externalRichMenuId: 'richmenu-created', errorCode: 'LINE_HTTP_400' })
    expect((await versionRow(job2.versionId)).status).toBe('FROZEN')
  })

  it('AC-152.6 — the fence: a paused, non-server or re-epoched account cancels waiting work; a stale lease ends UNKNOWN', async () => {
    const oa = await account()
    const menu = await frozenMenu(oa)
    const job = await queueRichMenuJob(menu.id, { kind: 'PUBLISH', version: menu.version }, { viewer: owner, now: start })
    await prisma.lineOaAccount.update({ where: { id: oa.id }, data: { status: 'PAUSED' } })
    const w = worker()
    expect(await runLineRichMenuWorker(w)).toEqual({ id: job.id, status: 'CANCELLED' })
    expect(w.richMenuTransport.create).not.toHaveBeenCalled()
    expect(await jobRow(job.id)).toMatchObject({ status: 'CANCELLED', errorCode: 'LINE_ACCOUNT_NOT_SERVER_OWNED' })

    await prisma.lineOaAccount.update({ where: { id: oa.id }, data: { status: 'CONNECTED', transportEpoch: { increment: 1 } } })
    const current = await prisma.lineOaRichMenu.findUnique({ where: { id: menu.id } })
    const job2 = await queueRichMenuJob(menu.id, { kind: 'PUBLISH', version: current.version }, { viewer: owner, now: start })
    await prisma.lineOaAccount.update({ where: { id: oa.id }, data: { transportEpoch: { increment: 1 } } })
    expect(await runLineRichMenuWorker(w)).toEqual({ id: job2.id, status: 'CANCELLED' })

    // A claim whose lease expired is an outcome nobody saw: UNKNOWN, visible.
    const menu3 = await frozenMenu(oa)
    const job3 = await queueRichMenuJob(menu3.id, { kind: 'PUBLISH', version: menu3.version }, { viewer: owner, now: start })
    await prisma.lineOaRichMenuJob.update({ where: { id: job3.id }, data: { status: 'CLAIMED', claimantId: 'dead-worker', leaseExpiresAt: later(-1) } })
    expect(await runLineRichMenuWorker(w)).toEqual({ status: 'IDLE' })
    expect(await jobRow(job3.id)).toMatchObject({ status: 'UNKNOWN', errorCode: 'LEASE_EXPIRED_OUTCOME_UNKNOWN' })

    // An unresolvable credential fails the job before any external call.
    const menu4 = await frozenMenu(oa)
    const job4 = await queueRichMenuJob(menu4.id, { kind: 'PUBLISH', version: menu4.version }, { viewer: owner, now: start })
    const w4 = worker({ resolveAccount: vi.fn(async () => { throw new Error('LINE_ACCOUNT_CREDENTIAL_UNAVAILABLE') }) })
    expect(await runLineRichMenuWorker(w4)).toEqual({ id: job4.id, status: 'FAILED' })
    expect(await jobRow(job4.id)).toMatchObject({ status: 'FAILED', errorCode: 'LINE_ACCOUNT_UNAVAILABLE', attempts: 0 })
  })

  it('AC-152.7 — SET_DEFAULT moves the account\'s single default on acceptance; SET_ALIAS needs an alias and is idempotent on retry', async () => {
    const oa = await account()
    const a = await frozenMenu(oa)
    const b = await frozenMenu(oa, { menu: { alias: undefined } })
    for (const menu of [a, b]) {
      await queueRichMenuJob(menu.id, { kind: 'PUBLISH', version: menu.version }, { viewer: owner, now: start })
      expect((await runLineRichMenuWorker(worker({ richMenuTransport: transport({ create: vi.fn(async () => accepted({ richMenuId: `richmenu-${menu.code}` })) }) }))).status).toBe('ACCEPTED')
    }
    const currentA = await prisma.lineOaRichMenu.findUnique({ where: { id: a.id } })
    const defaultJob = await queueRichMenuJob(a.id, { kind: 'SET_DEFAULT', version: currentA.version }, { viewer: owner, now: start })
    expect(defaultJob).toMatchObject({ kind: 'SET_DEFAULT', stage: 'APPLY', externalRichMenuId: `richmenu-${a.code}` })
    const w = worker()
    expect(await runLineRichMenuWorker(w)).toEqual({ id: defaultJob.id, status: 'ACCEPTED', stage: 'DONE' })
    expect(w.richMenuTransport.setDefault).toHaveBeenCalledWith(expect.objectContaining({ richMenuId: `richmenu-${a.code}` }))
    expect((await prisma.lineOaRichMenu.findUnique({ where: { id: a.id } })).isDefault).toBe(true)
    expect((await prisma.lineOaRichMenu.findUnique({ where: { id: b.id } })).isDefault).toBe(false)

    const currentB = await prisma.lineOaRichMenu.findUnique({ where: { id: b.id } })
    await expect(queueRichMenuJob(b.id, { kind: 'SET_ALIAS', version: currentB.version }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_RICH_MENU_NO_ALIAS' })
    const afterDefault = await prisma.lineOaRichMenu.findUnique({ where: { id: a.id } })
    const aliasJob = await queueRichMenuJob(a.id, { kind: 'SET_ALIAS', version: afterDefault.version }, { viewer: owner, now: start })
    const setAlias = vi.fn()
      .mockResolvedValueOnce({ status: 'UNCONFIRMED', httpStatus: null, requestId: null, code: 'LINE_NETWORK_UNAVAILABLE' })
      .mockResolvedValueOnce(accepted())
    const wa = worker({ richMenuTransport: transport({ setAlias }) })
    expect(await runLineRichMenuWorker(wa)).toEqual({ id: aliasJob.id, status: 'QUEUED', stage: 'APPLY' })
    expect(await runLineRichMenuWorker({ ...wa, now: () => later(120_000) })).toEqual({ id: aliasJob.id, status: 'ACCEPTED', stage: 'DONE' })
    expect(setAlias).toHaveBeenLastCalledWith(expect.objectContaining({ aliasId: a.alias, richMenuId: `richmenu-${a.code}` }))
  })
})
