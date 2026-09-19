// @req FR-238 — on a publisher action, the human-readable description of a
//   published rich menu, LIFF app or bot profile is admitted as one
//   LINE_STUDIO_DESCRIPTION TEXT source through the existing ADR-072
//   admission service — never the Flex or rich menu JSON — and unpublishing
//   withdraws the source; admission and withdrawal are both audited.
// @spec ADR-090 D7; ADR-072
// @tested tests/integration/fr238-line-studio-description-admission.test.js
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { LINE_OA_PROVIDER_CODE, createIntegrationConnection, registerIntegrationProvider } from '@/platform/integrations/core/integration-registry'
import { ROLE_LINE_OA_PUBLISHER } from '@/modules/identity/rbac'
import { connectLineOaAccount, applyLineOaAccountAction } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { applyRichMenuAction, createRichMenu } from '@/modules/line-oa-studio/application/line-oa-rich-menu-service'
import { queueRichMenuJob, runLineRichMenuWorker } from '@/modules/line-oa-studio/application/line-oa-rich-menu-jobs'
import { applyLiffAppAction, registerLiffApp } from '@/modules/line-oa-studio/application/line-oa-liff-app-service'

const DOMAINS = ['projects', 'platform', 'line-oa']
const saved = {}
let portfolio, tenant, business, provider, owner, publisher, seq = 0

function sourceRow(sourceKey) {
  return prisma.knowledgeSource.findFirst({ where: { sourceKey } })
}

async function connection() {
  const n = ++seq
  return createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: `FR238 conn ${n}`, externalAccountId: `fr238-oa-${n}`, purpose: 'GENERAL', status: 'ACTIVE' })
}

const accepted = () => ({ status: 'ACCEPTED_BY_LINE', httpStatus: 200, requestId: 'req-ok', code: null })
const pngFile = async () => prisma.fileAsset.create({ data: { code: `FIL-FR238-${++seq}`, tenantId: tenant.id, businessId: business.id, storageKind: 'MANAGED_BLOB', blobRef: `blob-fr238-${seq}`, name: 'menu.png', mime: 'image/png', size: 4, sha256: `sha-fr238-${seq}`, status: 'ACTIVE' } })
const area = (label, text) => ({ bounds: { x: 0, y: 0, width: 1250, height: 843 }, action: { type: 'MESSAGE', label, text } })
const draft = (file) => ({ layout: '1x1', chatBarText: 'เมนู', imageFileAssetId: file.id, imageWidth: 2500, imageHeight: 843, areas: [area('ทักทาย', 'สวัสดีค่ะ ยินดีต้อนรับ')] })

describe('FR-238 LINE Studio descriptions as knowledge sources (ADR-090 D7)', () => {
  beforeAll(async () => {
    for (const name of ['ZURI_KNOWLEDGE_ENABLED', 'ZURI_KNOWLEDGE_BINDINGS', 'MSP_PIPELINE_PRINCIPALS', 'ZURI_MSP_COMMAND']) saved[name] = process.env[name]
    const suffix = randomUUID().slice(0, 8)
    portfolio = await createPortfolio({ name: `FR238 portfolio ${suffix}`, code: `F238-PF-${suffix}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `FR238 tenant ${suffix}`, code: `F238-TN-${suffix}` })
    business = await createBusiness({ tenantId: tenant.id, name: `FR238 business ${suffix}`, code: `F238-BU-${suffix}` })
    provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account' })

    const scope = { portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: 'workspace-f238', agentId: 'agent-f238', visibility: 'private' }
    process.env.ZURI_KNOWLEDGE_ENABLED = '1'
    process.env.ZURI_KNOWLEDGE_BINDINGS = JSON.stringify([{ scope, policy: { allowEmbedding: true, allowPublication: true } }])
    process.env.MSP_PIPELINE_PRINCIPALS = JSON.stringify([{ role: 'source', credential: 'test-credential', scope }])
    process.env.ZURI_MSP_COMMAND = process.execPath

    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS })
    publisher = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [business.id]: [ROLE_LINE_OA_PUBLISHER] } })
  })

  afterAll(async () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it('AC-238.1 — publishing a rich menu admits its human-readable description, never the Flex/rich-menu JSON; archiving withdraws it', async () => {
    const oaConn = await connection()
    const oa = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id, integrationConnectionId: oaConn.id, code: `rm-oa-${seq}`, displayName: 'RM account', bindingCode: `rm-bind-${seq}`, transportMode: 'CLOUD', serverEnabled: true, status: 'CONNECTED', executionMode: 'SERVER' } })
    const file = await pngFile()
    const menu = await createRichMenu({ accountId: oa.id, code: `menu-${++seq}`, name: 'เมนูหลัก', draft: draft(file) }, { viewer: owner })
    const frozen = await applyRichMenuAction(menu.id, { action: 'FREEZE', version: menu.version }, { viewer: owner })
    await queueRichMenuJob(menu.id, { kind: 'PUBLISH', version: frozen.version }, { viewer: publisher })
    const result = await runLineRichMenuWorker({
      db: prisma, now: () => new Date(), workerId: 'fr238-worker',
      resolveAccount: async (id) => prisma.lineOaAccount.findUnique({ where: { id } }),
      richMenuTransport: { create: async () => ({ ...accepted(), richMenuId: 'richmenu-fr238' }), uploadImage: async () => accepted(), setDefault: async () => accepted(), setAlias: async () => accepted() },
      readImage: async () => ({ bytes: new Uint8Array([137, 80, 78, 71]), mime: 'image/png' }),
    })
    expect(result.status).toBe('ACCEPTED')

    const source = await sourceRow(`line-studio-description:rich-menu:${menu.id}`)
    expect(source).toMatchObject({ kind: 'LINE_STUDIO_DESCRIPTION', revokedAt: null })
    const ingestion = await prisma.knowledgeIngestion.findFirst({ where: { sourceId: source.id } })
    expect(ingestion.content).toContain('เมนูหลัก')
    expect(ingestion.content).toContain('สวัสดีค่ะ ยินดีต้อนรับ')
    // Never the Flex/rich-menu JSON: no braces, no bounds/coordinates, no image ref.
    expect(ingestion.content).not.toMatch(/[{}[\]]/)
    expect(ingestion.content).not.toContain('richmenu-fr238')
    expect(ingestion.content).not.toContain(file.id)
    const admissionAudit = await prisma.auditEvent.findFirst({ where: { entityType: 'KNOWLEDGE_INGESTION', entityId: ingestion.id, action: 'KNOWLEDGE_ADMISSION_QUEUED' } })
    expect(admissionAudit).toBeTruthy()

    const archived = await applyRichMenuAction(menu.id, { action: 'ARCHIVE', version: (await prisma.lineOaRichMenu.findUnique({ where: { id: menu.id } })).version }, { viewer: publisher })
    expect(archived.status).toBe('ARCHIVED')
    const withdrawnSource = await sourceRow(`line-studio-description:rich-menu:${menu.id}`)
    expect(withdrawnSource.revokedAt).toBeTruthy()
    const withdrawAudit = await prisma.auditEvent.findFirst({ where: { action: 'KNOWLEDGE_SOURCE_WITHDRAWN', payloadJson: { contains: source.id } } })
    expect(withdrawAudit).toBeTruthy()
  })

  it('AC-238.2 — a LIFF app activated with a liffId admits its name/description; archiving withdraws it', async () => {
    const oaConn = await connection()
    const oa = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id, integrationConnectionId: oaConn.id, code: `liff-oa-${seq}`, displayName: 'LIFF account', bindingCode: `liff-bind-${seq}`, transportMode: 'CLOUD', status: 'CONNECTED' } })
    const app = await registerLiffApp({ accountId: oa.id, code: `liff-app-${++seq}`, name: 'ร้านค้าออนไลน์', description: 'สั่งซื้อสินค้าผ่าน LIFF', endpointUrl: 'https://shop.example/liff', liffId: '1234567890-AbCdEfGh' }, { viewer: publisher })
    expect(app.status).toBe('ACTIVE')

    const source = await sourceRow(`line-studio-description:liff-app:${app.id}`)
    expect(source).toMatchObject({ kind: 'LINE_STUDIO_DESCRIPTION', revokedAt: null })
    const ingestion = await prisma.knowledgeIngestion.findFirst({ where: { sourceId: source.id } })
    expect(ingestion.content).toBe('ร้านค้าออนไลน์\nสั่งซื้อสินค้าผ่าน LIFF')
    expect(ingestion.content).not.toContain('shop.example')
    expect(ingestion.content).not.toContain('1234567890-AbCdEfGh')

    const archivedApp = await applyLiffAppAction(app.id, { action: 'ARCHIVE', version: app.version }, { viewer: publisher })
    expect(archivedApp.status).toBe('ARCHIVED')
    expect((await sourceRow(`line-studio-description:liff-app:${app.id}`)).revokedAt).toBeTruthy()
  })

  it('AC-238.3 — connecting an account admits its bot profile; archiving the account withdraws it', async () => {
    const oaConn = await connection()
    const account = await connectLineOaAccount({
      businessId: business.id, integrationConnectionId: oaConn.id, code: `bot-oa-${++seq}`, displayName: 'Bot account',
      botProfile: { greeting: 'สวัสดีค่ะ', fallbackText: 'ขอโทษค่ะ ไม่เข้าใจ', personaLabel: 'ผู้ช่วยร้านค้า' },
    }, { viewer: owner })

    const source = await sourceRow(`line-studio-description:bot-profile:${account.id}`)
    expect(source).toMatchObject({ kind: 'LINE_STUDIO_DESCRIPTION', revokedAt: null })
    const ingestion = await prisma.knowledgeIngestion.findFirst({ where: { sourceId: source.id } })
    expect(ingestion.content).toContain('ผู้ช่วยร้านค้า')
    expect(ingestion.content).toContain('สวัสดีค่ะ')

    const archived = await applyLineOaAccountAction(account.id, { action: 'ARCHIVE', version: account.version }, { viewer: owner })
    expect(archived.status).toBe('ARCHIVED')
    expect((await sourceRow(`line-studio-description:bot-profile:${account.id}`)).revokedAt).toBeTruthy()
  })

  it('AC-238.4 — never blocks the publisher action when the knowledge runtime is unavailable', async () => {
    const previousEnabled = process.env.ZURI_KNOWLEDGE_ENABLED
    delete process.env.ZURI_KNOWLEDGE_ENABLED
    try {
      const oaConn = await connection()
      const account = await connectLineOaAccount({
        businessId: business.id, integrationConnectionId: oaConn.id, code: `noknowledge-oa-${++seq}`, displayName: 'No-knowledge account',
        botProfile: { greeting: 'hi' },
      }, { viewer: owner })
      expect(account.status).toBeTruthy()
      expect(await sourceRow(`line-studio-description:bot-profile:${account.id}`)).toBeNull()
    } finally {
      process.env.ZURI_KNOWLEDGE_ENABLED = previousEnabled
    }
  })
})
