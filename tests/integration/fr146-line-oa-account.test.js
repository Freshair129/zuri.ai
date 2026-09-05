// @req FR-146 — the LineOaAccount aggregate against a real database: connect,
//   defaults, uniqueness, the authority ladder, versioned actions, audit
//   without secrets, and health computed from the owners it references.
// @spec ADR-060 D2, D3, D5, D11; SEC-001; BR-002; FR-072; FR-144
// @tested tests/integration/fr146-line-oa-account.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import {
  LINE_OA_PROVIDER_CODE,
  createIntegrationConnection,
  registerIntegrationProvider,
} from '@/platform/integrations/core/integration-registry'
import { mintEdgeDeviceCredential } from '@/modules/identity/edge-device-credential'
import { ROLE_LINE_OA_PUBLISHER } from '@/modules/identity/rbac'
import {
  applyLineOaAccountAction,
  connectLineOaAccount,
  getLineOaAccount,
  listLineOaAccounts,
} from '@/modules/line-oa-studio/application/line-oa-account-service'

const DOMAINS_WITH_STUDIO = ['projects', 'people', 'platform', 'line-oa']

let tenant, business, otherBusiness, edgeBusiness, provider
let owner, publisher, member, blindMember, foreignOwner
let edgeKey
let seq = 0

async function lineConnection(target, label = `line-${++seq}`) {
  return createIntegrationConnection({
    tenantId: tenant.id,
    businessId: target.id,
    providerId: provider.id,
    name: `LINE OA ${label}`,
    externalAccountId: `U-${label}`,
    purpose: 'GENERAL',
    status: 'ACTIVE',
  })
}

describe('FR-146 LineOaAccount', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-LINE-OA', name: 'LINE OA Studio Group' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-LINE-OA', name: 'LINE OA Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-LINE-OA', name: 'Cloud Business' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-LINE-OA-2', name: 'Other Business' })
    edgeBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-LINE-OA-EDGE', name: 'Edge Business' })
    provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account' })

    owner = makeViewer({
      visibleBusinessIds: [business.id, edgeBusiness.id],
      ownedBusinessIds: [business.id, edgeBusiness.id],
      visibleDomains: DOMAINS_WITH_STUDIO,
    })
    publisher = makeViewer({
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [],
      visibleDomains: DOMAINS_WITH_STUDIO,
      rolesByBusinessId: { [business.id]: [ROLE_LINE_OA_PUBLISHER] },
    })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: DOMAINS_WITH_STUDIO })
    blindMember = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: ['projects'] })
    foreignOwner = ownsElsewhere({ owns: otherBusiness.id, sees: business.id, seesDomains: DOMAINS_WITH_STUDIO, visibleDomains: DOMAINS_WITH_STUDIO })

    // The edge Business holds an ACTIVE device credential, so ADR-059 D5's
    // rule makes its accounts default to EDGE transport.
    const minted = await mintEdgeDeviceCredential({ businessId: edgeBusiness.id, deviceId: 'DEV-LINE', label: 'Shop node', viewer: owner })
    edgeKey = minted.key
  })

  it('AC-146.1 — connects an existing LINE_OA connection as the Business\'s first, default, cloud account', async () => {
    const connection = await lineConnection(business, 'main')
    const account = await connectLineOaAccount({
      businessId: business.id, integrationConnectionId: connection.id, code: 'oa-cloud-main', displayName: 'Cloud Main', basicId: '@cloudmain',
    }, { viewer: owner })

    expect(account).toMatchObject({
      code: 'oa-cloud-main', businessId: business.id, tenantId: tenant.id, integrationConnectionId: connection.id,
      status: 'DRAFT', effectiveStatus: 'DRAFT', transportMode: 'CLOUD', isDefaultForBusiness: true, version: 1, bindingCode: null,
    })
    // Health names its sources and reports what is not wired instead of guessing.
    expect(account.health.connection).toMatchObject({ status: 'ACTIVE', secretConfigured: false, secretStatus: 'MISSING', lastWebhookAt: null })
    expect(account.health.binding).toEqual({ code: null, status: 'UNKNOWN' })
    expect(account.health.transportJobs).toBeNull()
    expect(account.health.quota).toBeNull()
    expect(account.health.sources.binding).toMatch(/not wired/)

    const audit = await prisma.auditEvent.findMany({ where: { entityId: account.id, action: 'LINE_OA_ACCOUNT_CONNECTED' } })
    expect(audit).toHaveLength(1)
    expect(JSON.parse(audit[0].payloadJson)).toMatchObject({ transportMode: 'CLOUD', transportModeSource: 'NO_EDGE_CREDENTIAL', status: 'DRAFT' })
  })

  it('AC-146.2 — defaults to EDGE where the Business holds an ACTIVE edge credential, and a publisher may override at connect time', async () => {
    const first = await connectLineOaAccount({
      businessId: edgeBusiness.id, integrationConnectionId: (await lineConnection(edgeBusiness)).id, code: 'oa-edge-main', displayName: 'Edge Main',
    }, { viewer: owner })
    expect(first.transportMode).toBe('EDGE')

    const overridden = await connectLineOaAccount({
      businessId: edgeBusiness.id, integrationConnectionId: (await lineConnection(edgeBusiness)).id, code: 'oa-edge-cloud', displayName: 'Edge but cloud', transportMode: 'CLOUD',
    }, { viewer: owner })
    expect(overridden.transportMode).toBe('CLOUD')
    expect(overridden.isDefaultForBusiness).toBe(false)
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: overridden.id, action: 'LINE_OA_ACCOUNT_CONNECTED' } })
    expect(JSON.parse(audit.payloadJson).transportModeSource).toBe('OVERRIDE')
    // No audit row anywhere carries the device key that made this Business "edge".
    const all = await prisma.auditEvent.findMany({ where: { entityType: 'LINE_OA_ACCOUNT' } })
    expect(all.every((row) => !row.payloadJson.includes(edgeKey))).toBe(true)
  })

  it('AC-146.3 — a binding code makes the account CONNECTED, and only one account is default per Business', async () => {
    const second = await connectLineOaAccount({
      businessId: business.id, integrationConnectionId: (await lineConnection(business)).id, code: 'oa-cloud-support', displayName: 'Support', bindingCode: 'cloud-support-binding',
    }, { viewer: owner })
    expect(second).toMatchObject({ status: 'CONNECTED', effectiveStatus: 'CONNECTED', isDefaultForBusiness: false, bindingCode: 'cloud-support-binding' })
    expect(second.health.binding).toEqual({ code: 'cloud-support-binding', status: 'UNKNOWN' })

    const moved = await applyLineOaAccountAction(second.id, { action: 'SET_DEFAULT', version: second.version }, { viewer: owner })
    expect(moved.isDefaultForBusiness).toBe(true)
    const { accounts } = await listLineOaAccounts({ businessId: business.id, viewer: owner })
    expect(accounts.filter((row) => row.isDefaultForBusiness)).toHaveLength(1)
    expect(accounts[0].id).toBe(second.id)
    expect(accounts.every((row) => row.businessId === business.id)).toBe(true)
  })

  it('AC-146.4 — identity rules: one code per Tenant, one account per connection, one binding per Tenant, same-Business connections only', async () => {
    const taken = accounts => accounts
    const existing = await prisma.lineOaAccount.findFirst({ where: { code: 'oa-cloud-main' } })
    await expect(connectLineOaAccount({
      businessId: business.id, integrationConnectionId: (await lineConnection(business)).id, code: 'oa-cloud-main', displayName: 'Dup code',
    }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_ACCOUNT_CODE_TAKEN' })
    await expect(connectLineOaAccount({
      businessId: business.id, integrationConnectionId: existing.integrationConnectionId, code: 'oa-dup-conn', displayName: 'Dup connection',
    }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_CONNECTION_ALREADY_BOUND' })
    await expect(connectLineOaAccount({
      businessId: business.id, integrationConnectionId: (await lineConnection(business)).id, code: 'oa-dup-binding', displayName: 'Dup binding', bindingCode: 'cloud-support-binding',
    }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_BINDING_CODE_TAKEN' })
    // A connection of another Business in the same Tenant is a mapping error, not a near miss.
    await expect(connectLineOaAccount({
      businessId: business.id, integrationConnectionId: (await lineConnection(otherBusiness)).id, code: 'oa-wrong-biz', displayName: 'Wrong',
    }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_CONNECTION_OUTSIDE_BUSINESS' })
    await expect(connectLineOaAccount({
      businessId: business.id, integrationConnectionId: 'does-not-exist', code: 'oa-ghost', displayName: 'Ghost',
    }, { viewer: owner })).rejects.toMatchObject({ status: 404, message: 'Integration connection not found' })
    expect(taken).toBeTypeOf('function')
  })

  it('AC-146.5 — the authority ladder: view needs the domain, publish needs OWNER or LINE_OA_PUBLISHER, everything else is one 404', async () => {
    // A member who sees the domain may list and read but not connect.
    const listed = await listLineOaAccounts({ businessId: business.id, viewer: member })
    expect(listed.accounts.length).toBeGreaterThan(0)
    await expect(connectLineOaAccount({
      businessId: business.id, integrationConnectionId: (await lineConnection(business)).id, code: 'oa-member', displayName: 'Member',
    }, { viewer: member })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(applyLineOaAccountAction(listed.accounts[0].id, { action: 'PAUSE', version: listed.accounts[0].version }, { viewer: member }))
      .rejects.toMatchObject({ status: 404 })

    // A member without the line-oa domain grant sees nothing at all.
    await expect(listLineOaAccounts({ businessId: business.id, viewer: blindMember })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(getLineOaAccount(listed.accounts[0].id, { viewer: blindMember })).rejects.toMatchObject({ status: 404, message: 'Business not found' })

    // Owning another Business grants nothing here.
    await expect(connectLineOaAccount({
      businessId: business.id, integrationConnectionId: (await lineConnection(business)).id, code: 'oa-foreign', displayName: 'Foreign',
    }, { viewer: foreignOwner })).rejects.toMatchObject({ status: 404 })

    // The confirmed publisher role is enough, and an unknown Business answers the same 404.
    const byPublisher = await connectLineOaAccount({
      businessId: business.id, integrationConnectionId: (await lineConnection(business)).id, code: 'oa-by-publisher', displayName: 'By publisher',
    }, { viewer: publisher })
    expect(byPublisher.code).toBe('oa-by-publisher')
    await expect(listLineOaAccounts({ businessId: 'no-such-business', viewer: owner })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(getLineOaAccount('no-such-account', { viewer: owner })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
  })

  it('AC-146.6 — versioned actions: the stored machine, compare-and-swap, and the audited transport switch', async () => {
    const draft = await prisma.lineOaAccount.findFirst({ where: { code: 'oa-cloud-main' } })
    await expect(applyLineOaAccountAction(draft.id, { action: 'PAUSE', version: draft.version }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'LINE_OA_ACCOUNT_TRANSITION_INVALID' })

    const connected = await prisma.lineOaAccount.findFirst({ where: { code: 'oa-cloud-support' } })
    const paused = await applyLineOaAccountAction(connected.id, { action: 'PAUSE', version: connected.version }, { viewer: owner })
    expect(paused).toMatchObject({ status: 'PAUSED', version: connected.version + 1 })
    // The version the caller read is now stale: refused, nothing written.
    await expect(applyLineOaAccountAction(connected.id, { action: 'RESUME', version: connected.version }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'LINE_OA_ACCOUNT_VERSION_CONFLICT' })
    const resumed = await applyLineOaAccountAction(connected.id, { action: 'RESUME', version: paused.version }, { viewer: publisher })
    expect(resumed.status).toBe('CONNECTED')

    await expect(applyLineOaAccountAction(connected.id, { action: 'SWITCH_TRANSPORT_MODE', version: resumed.version, transportMode: 'CLOUD' }, { viewer: owner }))
      .rejects.toMatchObject({ status: 409, message: 'LINE_OA_TRANSPORT_MODE_UNCHANGED' })
    const switched = await applyLineOaAccountAction(connected.id, { action: 'SWITCH_TRANSPORT_MODE', version: resumed.version, transportMode: 'EDGE' }, { viewer: owner })
    expect(switched.transportMode).toBe('EDGE')
    const switchAudit = await prisma.auditEvent.findFirst({ where: { entityId: connected.id, action: 'LINE_OA_ACCOUNT_TRANSPORT_MODE_SWITCHED' } })
    expect(JSON.parse(switchAudit.payloadJson)).toMatchObject({ from: { transportMode: 'CLOUD' }, to: { transportMode: 'EDGE' }, cancelledTransportJobs: 0 })

    const archived = await applyLineOaAccountAction(connected.id, { action: 'ARCHIVE', version: switched.version }, { viewer: owner })
    expect(archived).toMatchObject({ status: 'ARCHIVED', isDefaultForBusiness: false })
    expect(archived.archivedAt).not.toBeNull()
    for (const action of [{ action: 'RESUME' }, { action: 'SET_DEFAULT' }, { action: 'SWITCH_TRANSPORT_MODE', transportMode: 'CLOUD' }]) {
      await expect(applyLineOaAccountAction(connected.id, { ...action, version: archived.version }, { viewer: owner })).rejects.toMatchObject({ status: 409 })
    }
    const visible = await listLineOaAccounts({ businessId: business.id, viewer: owner })
    expect(visible.accounts.map((row) => row.id)).not.toContain(connected.id)
    const all = await listLineOaAccounts({ businessId: business.id, includeArchived: true, viewer: owner })
    expect(all.accounts.map((row) => row.id)).toContain(connected.id)

    const trail = await prisma.auditEvent.findMany({ where: { entityId: connected.id }, orderBy: { occurredAt: 'asc' } })
    expect(trail.map((row) => row.action)).toEqual([
      'LINE_OA_ACCOUNT_CONNECTED', 'LINE_OA_ACCOUNT_DEFAULT_SET', 'LINE_OA_ACCOUNT_PAUSED', 'LINE_OA_ACCOUNT_RESUMED',
      'LINE_OA_ACCOUNT_TRANSPORT_MODE_SWITCHED', 'LINE_OA_ACCOUNT_ARCHIVED',
    ])
    expect(trail.every((row) => !/secret|token/i.test(row.payloadJson))).toBe(true)
  })

  it('AC-146.7 — LIVE is derived from the agent lane\'s binding through the port, never stored', async () => {
    const account = await prisma.lineOaAccount.findFirst({ where: { code: 'oa-by-publisher' } })
    const withBinding = await applyLineOaAccountAction(account.id, { action: 'ARCHIVE', version: account.version }, { viewer: owner, ports: { bindingStatus: async () => 'ACTIVE' } })
    // Archived stays archived whatever the binding says.
    expect(withBinding.effectiveStatus).toBe('ARCHIVED')

    const connected = await connectLineOaAccount({
      businessId: business.id, integrationConnectionId: (await lineConnection(business)).id, code: 'oa-live', displayName: 'Live', bindingCode: 'live-binding',
    }, { viewer: owner, ports: { bindingStatus: async () => 'ACTIVE' } })
    expect(connected.status).toBe('CONNECTED')
    expect(connected.effectiveStatus).toBe('LIVE')
    expect(connected.health.binding).toEqual({ code: 'live-binding', status: 'ACTIVE' })
    const stored = await prisma.lineOaAccount.findUnique({ where: { id: connected.id } })
    expect(stored.status).toBe('CONNECTED')
    // Without the port the same row reports UNKNOWN and is not LIVE.
    const plain = await getLineOaAccount(connected.id, { viewer: owner })
    expect(plain.effectiveStatus).toBe('CONNECTED')
  })

  it('refuses malformed input before touching the database', async () => {
    for (const input of [
      { businessId: business.id, integrationConnectionId: 'c', code: 'OA X', displayName: 'X' },
      { businessId: business.id, integrationConnectionId: 'c', code: 'oa-ok', displayName: '' },
      { businessId: business.id, integrationConnectionId: 'c', code: 'oa-ok', displayName: 'X', status: 'LIVE' },
      { businessId: business.id, integrationConnectionId: 'c', code: 'oa-ok', displayName: 'X', transportMode: 'HYBRID' },
    ]) {
      await expect(connectLineOaAccount(input, { viewer: owner })).rejects.toThrow()
    }
    await expect(listLineOaAccounts({ businessId: '', viewer: owner })).rejects.toMatchObject({ status: 400 })
  })
})
