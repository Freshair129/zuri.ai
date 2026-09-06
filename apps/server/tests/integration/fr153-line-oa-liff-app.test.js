// @req FR-153 — the LIFF app registry against a real database: register
//   (DRAFT until the liffId is known), identity rules, the authority ladder,
//   versioned actions, audit — and the payoff: a rich menu LIFF action now
//   publishes as a liff.line.me link, and is refused when the app is not ACTIVE.
// @spec SRS LOS-RQ-070; BR-002; ADR-060 D6, D11; SEC-001; FR-072
// @tested tests/integration/fr153-line-oa-liff-app.test.js
import { beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { LINE_OA_PROVIDER_CODE, createIntegrationConnection, registerIntegrationProvider } from '@/platform/integrations/core/integration-registry'
import { ROLE_LINE_OA_PUBLISHER } from '@/modules/identity/rbac'
import { applyLiffAppAction, getLiffApp, listLiffApps, registerLiffApp } from '@/modules/line-oa-studio/application/line-oa-liff-app-service'
import { applyRichMenuAction, createRichMenu } from '@/modules/line-oa-studio/application/line-oa-rich-menu-service'
import { queueRichMenuJob, runLineRichMenuWorker } from '@/modules/line-oa-studio/application/line-oa-rich-menu-jobs'

const DOMAINS = ['projects', 'platform', 'line-oa']
const LIFF_ID = '1234567890-AbCdEfGh'
let tenant, business, otherBusiness, provider, account, owner, publisher, member, foreignOwner, pngFile, seq = 0

const register = (over = {}, viewer = owner) => registerLiffApp({ accountId: account.id, code: `liff-${++seq}`, name: `App ${seq}`, endpointUrl: 'https://shop.example/liff', ...over }, { viewer })

describe('FR-153 LineOaLiffApp', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-LINE-LIFF', name: 'LIFF Group' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-LINE-LIFF', name: 'LIFF Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-LINE-LIFF', name: 'LIFF Business' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-LINE-LIFF-2', name: 'Other' })
    provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS })
    publisher = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [business.id]: [ROLE_LINE_OA_PUBLISHER] } })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS })
    foreignOwner = ownsElsewhere({ owns: otherBusiness.id, sees: business.id, seesDomains: DOMAINS, visibleDomains: DOMAINS })
    const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'LIFF conn', externalAccountId: 'liff-oa', purpose: 'GENERAL', status: 'ACTIVE' })
    account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id, code: 'liff-account', displayName: 'LIFF OA', bindingCode: 'liff-binding', transportMode: 'CLOUD', serverEnabled: true, status: 'CONNECTED', executionMode: 'SERVER' } })
    pngFile = await prisma.fileAsset.create({ data: { code: 'FIL-LIFF-1', tenantId: tenant.id, businessId: business.id, storageKind: 'MANAGED_BLOB', blobRef: 'blob-liff-1', name: 'menu.png', mime: 'image/png', size: 4, sha256: 'sha-liff', status: 'ACTIVE' } })
  })

  it('AC-153.1 — registers a DRAFT app without a liffId and an ACTIVE one with it; a publisher may do both', async () => {
    const draft = await register({ code: 'shop-draft', name: 'Shop', scopes: ['profile', 'openid'], viewSize: 'TALL' }, publisher)
    expect(draft).toMatchObject({ code: 'shop-draft', accountId: account.id, status: 'DRAFT', liffId: null, liffUrl: null, viewSize: 'TALL', scopes: ['profile', 'openid'], botPrompt: 'NORMAL', version: 1 })
    const active = await register({ code: 'shop-live', name: 'Shop live', liffId: LIFF_ID })
    expect(active).toMatchObject({ status: 'ACTIVE', liffId: LIFF_ID, liffUrl: `https://liff.line.me/${LIFF_ID}` })
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'LINE_OA_LIFF_APP', entityId: active.id } })
    expect(audits.map((a) => a.action)).toEqual(['LINE_OA_LIFF_APP_REGISTERED'])
  })

  it('AC-153.2 — identity rules: one code per Tenant, one liffId per account, no app on an archived account', async () => {
    await expect(register({ code: 'shop-draft' })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_LIFF_APP_CODE_TAKEN' })
    await expect(register({ liffId: LIFF_ID })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_LIFF_ID_TAKEN' })
    const conn = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'archived conn', externalAccountId: 'liff-oa-arch', purpose: 'GENERAL', status: 'ACTIVE' })
    const archived = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id, integrationConnectionId: conn.id, code: 'liff-archived', displayName: 'Gone', status: 'ARCHIVED', archivedAt: new Date() } })
    await expect(register({ accountId: archived.id })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_ACCOUNT_ARCHIVED' })
  })

  it('AC-153.3 — the authority ladder: members read, only OWNER or LINE_OA_PUBLISHER write, everything else is one 404', async () => {
    const app = await register()
    await expect(listLiffApps({ accountId: account.id, viewer: member })).resolves.toMatchObject({ accountId: account.id })
    await expect(getLiffApp(app.id, { viewer: member })).resolves.toMatchObject({ id: app.id })
    await expect(register({}, member)).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(applyLiffAppAction(app.id, { action: 'ARCHIVE', version: app.version }, { viewer: member })).rejects.toMatchObject({ status: 404 })
    await expect(register({}, foreignOwner)).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(getLiffApp('no-such-app', { viewer: owner })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(listLiffApps({ accountId: 'no-such-account', viewer: owner })).rejects.toMatchObject({ status: 404 })
  })

  it('AC-153.4 — versioned actions: UPDATE, RECORD_LIFF_ID activates, ARCHIVE closes; a stale version conflicts', async () => {
    const app = await register({ code: 'orders' })
    const updated = await applyLiffAppAction(app.id, { action: 'UPDATE', version: 1, fields: { name: 'Orders', endpointUrl: 'https://orders.example/', scopes: ['profile'] } }, { viewer: publisher })
    expect(updated).toMatchObject({ name: 'Orders', endpointUrl: 'https://orders.example/', scopes: ['profile'], status: 'DRAFT', version: 2 })
    await expect(applyLiffAppAction(app.id, { action: 'RECORD_LIFF_ID', version: 1, liffId: '2222222222-AAAAAAAA' }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_LIFF_APP_VERSION_CONFLICT' })
    await expect(applyLiffAppAction(app.id, { action: 'RECORD_LIFF_ID', version: 2, liffId: LIFF_ID }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_LIFF_ID_TAKEN' })
    const active = await applyLiffAppAction(app.id, { action: 'RECORD_LIFF_ID', version: 2, liffId: '2222222222-AAAAAAAA' }, { viewer: owner })
    expect(active).toMatchObject({ status: 'ACTIVE', liffId: '2222222222-AAAAAAAA', version: 3 })
    const archived = await applyLiffAppAction(app.id, { action: 'ARCHIVE', version: 3 }, { viewer: owner })
    expect(archived).toMatchObject({ status: 'ARCHIVED', version: 4 })
    expect(archived.archivedAt).toBeTruthy()
    await expect(applyLiffAppAction(app.id, { action: 'UPDATE', version: 4, fields: { name: 'x' } }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_LIFF_APP_ARCHIVED' })
    const visible = await listLiffApps({ accountId: account.id, viewer: owner })
    expect(visible.liffApps.map((a) => a.code)).not.toContain('orders')
    const all = await listLiffApps({ accountId: account.id, includeArchived: true, viewer: owner })
    expect(all.liffApps.map((a) => a.code)).toContain('orders')
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'LINE_OA_LIFF_APP', entityId: app.id }, orderBy: { occurredAt: 'asc' } })
    expect(audits.map((a) => a.action)).toEqual(['LINE_OA_LIFF_APP_REGISTERED', 'LINE_OA_LIFF_APP_UPDATED', 'LINE_OA_LIFF_APP_ID_RECORDED', 'LINE_OA_LIFF_APP_ARCHIVED'])
  })

  it('AC-153.5 — a rich menu LIFF action publishes as a liff.line.me uri through an ACTIVE app, and is refused through a DRAFT one', async () => {
    const draftApp = await register({ code: 'pending-app' })
    const area = (code) => ({ bounds: { x: 0, y: 0, width: 2500, height: 843 }, action: { type: 'LIFF', liffAppCode: code, path: '?from=menu' } })
    const draft = (code) => ({ layout: '1x1', chatBarText: 'เมนู', imageFileAssetId: pngFile.id, imageWidth: 2500, imageHeight: 843, areas: [area(code)] })

    const pending = await createRichMenu({ accountId: account.id, code: `liff-menu-${++seq}`, name: 'Pending', draft: draft('pending-app') }, { viewer: owner })
    const frozenPending = await applyRichMenuAction(pending.id, { action: 'FREEZE', version: pending.version }, { viewer: owner })
    await expect(queueRichMenuJob(frozenPending.id, { kind: 'PUBLISH', version: frozenPending.version }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'LINE_OA_RICH_MENU_LIFF_NOT_ACTIVE' })
    await expect(queueRichMenuJob(frozenPending.id, { kind: 'PUBLISH', version: frozenPending.version }, { viewer: owner })).rejects.toMatchObject({ status: 422 })

    const menu = await createRichMenu({ accountId: account.id, code: `liff-menu-${++seq}`, name: 'Live', draft: draft('shop-live') }, { viewer: owner })
    const frozen = await applyRichMenuAction(menu.id, { action: 'FREEZE', version: menu.version }, { viewer: owner })
    await queueRichMenuJob(frozen.id, { kind: 'PUBLISH', version: frozen.version }, { viewer: owner })
    const create = vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', httpStatus: 200, requestId: 'r', code: null, richMenuId: 'richmenu-liff' }))
    const result = await runLineRichMenuWorker({
      db: prisma, workerId: 'liff-test',
      resolveAccount: async (id) => prisma.lineOaAccount.findUnique({ where: { id } }),
      richMenuTransport: { create, uploadImage: vi.fn(async () => ({ status: 'ACCEPTED_BY_LINE', httpStatus: 200, requestId: 'u', code: null })), setDefault: vi.fn(), setAlias: vi.fn() },
      readImage: async () => ({ bytes: new Uint8Array([1]), mime: 'image/png' }),
    })
    expect(result.status).toBe('ACCEPTED')
    expect(create.mock.calls[0][0].richMenu.areas[0].action).toEqual({ type: 'uri', uri: `https://liff.line.me/${LIFF_ID}?from=menu` })
    void draftApp
  })
})
