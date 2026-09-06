import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { listPhase1Integrations } from '@/modules/integration/application/integration-management-service'
import { createIntegrationConnection } from '@/platform/integrations/core/integration-registry'
import { createLineWebhookPost } from '@/app/api/agent/line-webhook/route'

// @req FR-080 — AC-075.3: the Platform Integrations read model carries health.
// @req FR-081 — the ingress evidence that health is computed from.
// @spec ADR-032, SEC-016 — trusted scope, metadata only, no secret material.
//
// The operator question: "is LINE OA up?" Answering it must not need a second,
// LINE-only status page — the channel appears on the surface that already exists,
// and its health is derived from the same RawExternalRecord the ingress writes.

let tenant, business, otherBusiness, lineConnection, viewer

const DESTINATION = 'Uhealth-oa'
const BINDING_ID = '44444444-5555-4666-8777-888888888888'
const BEARER = 'Bearer health-binding-secret-long-enough'

function webhookHandler() {
  return createLineWebhookPost({
    logger: { info() {}, warn() {}, error() {}, debug() {}, emit() {} },
    runtimeFactory: async () => ({
      bindingResolver: {
        resolve: async () => ({ id: BINDING_ID, tenantId: tenant.id, businessId: business.id }),
      },
    }),
  })
}

const deliver = (handler, id) => handler(new Request('http://local/api/agent/line-webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: BEARER },
  body: JSON.stringify({
    bindingId: BINDING_ID,
    destination: DESTINATION,
    events: [{
      type: 'message', webhookEventId: id,
      source: { type: 'user', userId: 'Uhealth-1' },
      message: { id: `M-${id}`, type: 'text', text: 'สวัสดี' },
    }],
  }),
}))

const list = (over = {}) => listPhase1Integrations({
  resolve: async () => viewer,
  businessId: business.id,
  ...over,
})

const channelRow = (rows) => rows.find((row) => row.kind === 'CHANNEL')

describe('LINE OA channel health on the Platform Integrations surface (FR-080)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Health Group', code: 'PF-HEALTH' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Health Tenant', code: 'TNT-HEALTH' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Health Business', code: 'BUS-HEALTH' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'Other Business', code: 'BUS-HEALTH-2' })
    viewer = makeViewer({
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [business.id],
    })

    const provider = await prisma.integrationProvider.upsert({
      where: { code: 'LINE_OA' },
      create: { code: 'LINE_OA', name: 'LINE Official Account', status: 'ACTIVE' },
      update: { status: 'ACTIVE' },
    })
    lineConnection = await createIntegrationConnection({
      tenantId: tenant.id,
      businessId: business.id,
      providerId: provider.id,
      name: 'LINE OA channel',
      authorizationType: 'CHANNEL_SECRET',
      externalAccountId: DESTINATION,
      status: 'ACTIVE',
    }, { db: prisma })
  })

  it('shows the LINE channel on the existing surface, not a separate one', async () => {
    const rows = await list()
    const channel = channelRow(rows)
    expect(channel).toBeTruthy()
    expect(channel).toMatchObject({
      id: lineConnection.id, kind: 'CHANNEL', provider: 'LINE_OA', status: 'ACTIVE',
    })
  })

  it('reports DEGRADED before any traffic has ever been observed', async () => {
    const channel = channelRow(await list())
    expect(channel.health.state).toBe('DEGRADED')
    expect(channel.health.reasons).toEqual(['NO_TRAFFIC_OBSERVED'])
    expect(channel.health.evidence.lastEventAt).toBeNull()
  })

  it('turns CONNECTED once the ingress records a real event', async () => {
    const res = await deliver(webhookHandler(), 'WEH-HEALTH-1')
    expect(res.status).toBe(200)

    const channel = channelRow(await list())
    expect(channel.health.state).toBe('CONNECTED')
    expect(channel.health.reasons).toEqual([])
    expect(channel.health.evidence.lastEventAt).not.toBeNull()

    // the health is derived from the ingress evidence, not from a status column
    const raw = await prisma.rawExternalRecord.findFirst({
      where: { connectionId: lineConnection.id },
      orderBy: { receivedAt: 'desc' },
    })
    expect(new Date(channel.health.evidence.lastEventAt).toISOString())
      .toBe(new Date(raw.receivedAt).toISOString())
  })

  it('degrades again once that evidence ages past the window', async () => {
    // same rows, later clock — nothing stored had to change for the answer to change
    const channel = channelRow(await list({
      now: new Date(Date.now() + 48 * 60 * 60 * 1000),
    }))
    expect(channel.health.state).toBe('DEGRADED')
    expect(channel.health.reasons).toEqual(['TRAFFIC_STALE'])
  })

  it('reports DISABLED when an operator turns the channel off', async () => {
    await prisma.integrationConnection.update({
      where: { id: lineConnection.id },
      data: { status: 'DISABLED' },
    })
    const channel = channelRow(await list())
    expect(channel.health.state).toBe('DISABLED')
    expect(channel.health.reasons).toContain('CONNECTION_DISABLED')

    await prisma.integrationConnection.update({
      where: { id: lineConnection.id },
      data: { status: 'ACTIVE' },
    })
  })

  it('reports MISCONFIGURED when the channel has no account to listen to', async () => {
    await prisma.integrationConnection.update({
      where: { id: lineConnection.id },
      data: { externalAccountId: null },
    })
    const channel = channelRow(await list())
    expect(channel.health.state).toBe('MISCONFIGURED')
    expect(channel.health.reasons).toContain('MISSING_EXTERNAL_ACCOUNT_ID')

    await prisma.integrationConnection.update({
      where: { id: lineConnection.id },
      data: { externalAccountId: DESTINATION },
    })
  })

  it('stays inside the viewer trusted scope', async () => {
    // an owner of another Business cannot read this channel's health
    await expect(listPhase1Integrations({
      resolve: async () => viewer,
      businessId: otherBusiness.id,
    })).rejects.toMatchObject({ status: 404 })
  })

  it('returns no secret material with the health', async () => {
    const rows = await list()
    expect(JSON.stringify(rows)).not.toContain(BEARER.slice(7))
    expect(JSON.stringify(rows)).not.toContain(BINDING_ID)
  })
})
