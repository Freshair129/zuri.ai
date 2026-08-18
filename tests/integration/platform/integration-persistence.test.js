import { createHmac, randomUUID } from 'node:crypto'

import { beforeAll, describe, expect, it } from 'vitest'

import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../../factories/scope'
import {
  createIngestionRun,
  createIntegrationConnection,
  registerIntegrationProvider,
  upsertIntegrationCredentialMetadata,
} from '@/platform/integrations/core/integration-registry'
import { ingestRawExternalRecord } from '@/platform/integrations/core/raw-ingest-service'
import { createPrismaRawRecordRepository } from '@/platform/integrations/core/raw-record-repository'
import { createLineOaWebhookConnector } from '@/platform/integrations/providers/line/line-oa-webhook'

const suffix = () => randomUUID().slice(0, 8).toUpperCase()

describe('P1 integration persistence', () => {
  let tenant
  let business
  let provider
  let connection
  let run

  beforeAll(async () => {
    const token = suffix()
    const portfolio = await createPortfolio({ name: `P1 Platform ${token}`, code: `PF-P1-${token}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `P1 Tenant ${token}`, code: `TNT-P1-${token}` })
    business = await createBusiness({ tenantId: tenant.id, name: `P1 Business ${token}`, code: `BUS-P1-${token}` })
    provider = await prisma.integrationProvider.create({
      data: { code: 'FLOWACCOUNT', name: 'FlowAccount', status: 'ACTIVE' },
    })
    connection = await prisma.integrationConnection.create({
      data: {
        tenantId: tenant.id,
        businessId: business.id,
        providerId: provider.id,
        name: 'FlowAccount primary',
        authorizationType: 'OPENID',
        status: 'ACTIVE',
      },
    })
    run = await prisma.ingestionRun.create({
      data: {
        tenantId: tenant.id,
        businessId: business.id,
        connectionId: connection.id,
        lane: 'ACCOUNTING',
        resourceType: 'INVOICE',
        runType: 'INITIAL',
      },
    })
  })

  it('stores connection metadata, raw payload, cursor, external ref and DLQ state', async () => {
    const repository = createPrismaRawRecordRepository(prisma, {
      tenantId: tenant.id,
      businessId: business.id,
      connectionId: connection.id,
      ingestionRunId: run.id,
      provider: 'FLOWACCOUNT',
    })
    const input = {
      tenantId: tenant.id,
      businessId: business.id,
      connectionId: connection.id,
      ingestionRunId: run.id,
      provider: 'FLOWACCOUNT',
      lane: 'ACCOUNTING',
      entityType: 'INVOICE',
      externalId: `INV-${suffix()}`,
      sourceType: 'PULL',
      schemaVersion: 'flowaccount.invoice.v1',
      payload: { total: 1250, currency: 'THB' },
      receivedAt: new Date('2026-08-18T00:00:00.000Z'),
    }

    const first = await ingestRawExternalRecord(input, { repository })
    const replay = await ingestRawExternalRecord(input, { repository })
    const stored = await prisma.rawExternalRecord.findUnique({ where: { id: first.rawRecord.id } })

    expect(first.status).toBe('CREATED')
    expect(replay.status).toBe('UNCHANGED')
    expect(stored).toMatchObject({
      tenantId: tenant.id,
      businessId: business.id,
      connectionId: connection.id,
      ingestionRunId: run.id,
      processingStatus: 'RECEIVED',
      payloadJson: '{"currency":"THB","total":1250}',
    })

    const credential = await prisma.integrationCredential.create({
      data: { connectionId: connection.id, secretRef: 'vault://integration/flowaccount/p1' },
    })
    const cursor = await prisma.syncCursor.create({
      data: {
        tenantId: tenant.id,
        businessId: business.id,
        connectionId: connection.id,
        resourceType: 'INVOICE',
        strategy: 'DATE_WINDOW',
        cursorValue: '2026-08-18',
      },
    })
    const externalRef = await prisma.externalEntityRef.create({
      data: {
        tenantId: tenant.id,
        businessId: business.id,
        connectionId: connection.id,
        provider: 'FLOWACCOUNT',
        entityType: 'INVOICE',
        externalId: input.externalId,
        internalEntityType: 'ACCOUNTING_INVOICE',
        internalEntityId: 'internal-invoice-1',
        payloadHash: first.envelope.payloadHash,
      },
    })
    const deadLetter = await prisma.deadLetterRecord.create({
      data: {
        tenantId: tenant.id,
        businessId: business.id,
        connectionId: connection.id,
        ingestionRunId: run.id,
        rawRecordId: stored.id,
        lane: 'ACCOUNTING',
        entityType: 'INVOICE',
        externalId: input.externalId,
        failureStage: 'NORMALIZE',
        failureOwner: 'ACCOUNTING_ACL',
        errorCode: 'MISSING_CUSTOMER',
        errorMessage: 'Customer mapping is required',
      },
    })

    expect(credential.secretRef).toBe('vault://integration/flowaccount/p1')
    expect(cursor.connectionId).toBe(connection.id)
    expect(externalRef.internalEntityId).toBe('internal-invoice-1')
    expect(deadLetter.status).toBe('OPEN')
  })

  it('creates registry records through tenant-scoped platform services', async () => {
    const token = suffix()
    const registeredProvider = await registerIntegrationProvider({
      code: `META-${token}`,
      name: 'Meta Graph API',
      capabilities: { pull: true, webhook: true },
    }, { db: prisma })
    const registeredConnection = await createIntegrationConnection({
      tenantId: tenant.id,
      businessId: business.id,
      providerId: registeredProvider.id,
      name: 'Meta primary',
      authorizationType: 'OAUTH2',
      externalAccountId: `act-${token}`,
    }, { db: prisma })
    const registeredRun = await createIngestionRun({
      tenantId: tenant.id,
      businessId: business.id,
      connectionId: registeredConnection.id,
      lane: 'MARKETING',
      resourceType: 'AD_INSIGHTS',
      runType: 'INITIAL',
    }, { db: prisma })
    const credential = await upsertIntegrationCredentialMetadata({
      tenantId: tenant.id,
      connectionId: registeredConnection.id,
      secretRef: `vault://integration/meta/${token}`,
    }, { db: prisma })

    expect(registeredConnection.status).toBe('DRAFT')
    expect(registeredRun.status).toBe('RUNNING')
    expect(credential.secretRef).toContain(`vault://integration/meta/${token}`)
  })

  it('persists a signed LINE OA event as CUSTOMER raw evidence without a CRM write', async () => {
    const token = suffix()
    const destination = `Uline-${token}`
    const lineProvider = await prisma.integrationProvider.upsert({
      where: { code: 'LINE_OA' },
      create: { code: 'LINE_OA', name: 'LINE Official Account', status: 'ACTIVE' },
      update: { status: 'ACTIVE' },
    })
    const lineConnection = await createIntegrationConnection({
      tenantId: tenant.id,
      businessId: business.id,
      providerId: lineProvider.id,
      name: 'LINE OA primary',
      authorizationType: 'CHANNEL_SECRET',
      externalAccountId: destination,
      status: 'ACTIVE',
    }, { db: prisma })
    const lineRun = await createIngestionRun({
      tenantId: tenant.id,
      businessId: business.id,
      connectionId: lineConnection.id,
      lane: 'CUSTOMER',
      resourceType: 'WEBHOOK_EVENT',
      runType: 'INCREMENTAL',
    }, { db: prisma })
    const lineSecret = 'line-integration-test-secret'
    const body = JSON.stringify({
      destination,
      events: [{
        type: 'message',
        webhookEventId: `line-event-${token}`,
        source: { type: 'user', userId: `Uuser-${token}` },
        message: { id: `line-message-${token}`, type: 'text', text: 'hello' },
        replyToken: 'transient-reply-token',
      }],
    })
    const signature = createHmac('sha256', lineSecret).update(Buffer.from(body, 'utf8')).digest('base64')
    const connector = createLineOaWebhookConnector({
      channelSecret: lineSecret,
      scope: {
        tenantId: tenant.id,
        businessId: business.id,
        connectionId: lineConnection.id,
        ingestionRunId: lineRun.id,
        destination,
      },
    })
    const repository = createPrismaRawRecordRepository(prisma, {
      tenantId: tenant.id,
      businessId: business.id,
      connectionId: lineConnection.id,
      ingestionRunId: lineRun.id,
      provider: 'LINE_OA',
    })
    const result = await connector.ingestWebhook(
      new Request('https://zuri.test/api/integrations/line/webhook', {
        method: 'POST',
        headers: { 'x-line-signature': signature },
        body,
      }),
      { repository, now: () => new Date('2026-08-18T00:00:00.000Z') },
    )
    const stored = await prisma.rawExternalRecord.findFirst({
      where: { connectionId: lineConnection.id, provider: 'LINE_OA' },
    })

    expect(result).toMatchObject({ provider: 'LINE_OA', received: 1, created: 1, unchanged: 0 })
    expect(stored).toMatchObject({
      tenantId: tenant.id,
      businessId: business.id,
      connectionId: lineConnection.id,
      ingestionRunId: lineRun.id,
      provider: 'LINE_OA',
      lane: 'CUSTOMER',
      entityType: 'LINE_MESSAGE',
      processingStatus: 'RECEIVED',
    })
    expect(stored.payloadJson).not.toContain('transient-reply-token')
    expect(await prisma.conversation.count({ where: { externalThreadId: `Uuser-${token}` } })).toBe(0)
  })

  it('rejects a raw write whose tenant does not match the repository scope', async () => {
    const otherPortfolio = await createPortfolio({ name: `P1 Other ${suffix()}`, code: `PF-P1-O-${suffix()}` })
    const otherTenant = await createTenant({ portfolioId: otherPortfolio.id, name: 'Other tenant', code: `TNT-P1-O-${suffix()}` })
    const repository = createPrismaRawRecordRepository(prisma, {
      tenantId: tenant.id,
      businessId: business.id,
      connectionId: connection.id,
      provider: 'FLOWACCOUNT',
    })

    await expect(
      ingestRawExternalRecord(
        {
          tenantId: otherTenant.id,
          connectionId: connection.id,
          provider: 'FLOWACCOUNT',
          lane: 'ACCOUNTING',
          entityType: 'INVOICE',
          externalId: `INV-CROSS-${suffix()}`,
          sourceType: 'PULL',
          schemaVersion: 'flowaccount.invoice.v1',
          payload: { total: 1 },
        },
        { repository },
      ),
    ).rejects.toThrow(/scope/i)

    await expect(
      ingestRawExternalRecord(
        {
          tenantId: tenant.id,
          businessId: business.id,
          connectionId: connection.id,
          provider: 'META',
          lane: 'MARKETING',
          entityType: 'AD_INSIGHTS',
          externalId: `AD-CROSS-${suffix()}`,
          sourceType: 'PULL',
          schemaVersion: 'meta.ad-insights.v1',
          payload: { clicks: 1 },
        },
        { repository },
      ),
    ).rejects.toThrow(/provider/i)

    await expect(
      createIntegrationConnection({
        tenantId: otherTenant.id,
        businessId: business.id,
        providerId: provider.id,
        name: 'Invalid cross-tenant connection',
        authorizationType: 'OPENID',
      }, { db: prisma }),
    ).rejects.toThrow(/tenant/i)
  })
})
