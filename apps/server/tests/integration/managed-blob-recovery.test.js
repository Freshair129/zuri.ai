// @req FR-292 — preparation requires real persisted session and live ownership.
// @spec ADR-115, SEC-008
import { randomUUID } from 'node:crypto'
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { generateSessionToken, persistSession } from '@/modules/identity/auth-service'
import { readManagedBlobRecoveryPreparation } from '@/modules/project-manager/application/managed-blob-recovery-service'
import { recoverySha256 } from '@/modules/project-manager/application/managed-blob-recovery-contract'

const env = { ZURI_SESSION_SECRET: 'isolated-or1-test-session-signing-secret-only',
  ZURI_ASSET_STORAGE_PROVIDER: 's3', ZURI_ASSET_EVIDENCE_BUCKET: 'asset-private',
  ZURI_ASSET_STORAGE_ENDPOINT: 'http://storage.test:9000', ZURI_ASSET_STORAGE_ACCESS_KEY: 'test-access', ZURI_ASSET_STORAGE_SECRET_KEY: 'test-secret',
  ZURI_KNOWLEDGE_CATALOG_STORAGE_PROVIDER: 's3', ZURI_KNOWLEDGE_CATALOG_BUCKET: 'catalog-private',
  ZURI_KNOWLEDGE_CATALOG_STORAGE_ENDPOINT: 'http://storage.test:9000', ZURI_KNOWLEDGE_CATALOG_STORAGE_ACCESS_KEY: 'test-catalog', ZURI_KNOWLEDGE_CATALOG_STORAGE_SECRET_KEY: 'test-catalog-secret',
  ZURI_KNOWLEDGE_STORAGE_BUCKET: 'knowledge-private',
}
let tenant, foreignTenant, business, otherBusiness, person, member, session, cookie, file
const fetchSpy = vi.fn(() => { throw new Error('Preparation must not access provider') })
const request = token => new Request('http://localhost/api/files', { headers: token ? { cookie: 'zuri_session=' + token } : {} })
const prepare = (token = cookie, options = {}) => readManagedBlobRecoveryPreparation({
  request: request(token), fileId: file.id, input: { expectedVersion: file.version },
}, { env, ...options })

describe('OR1 persisted-authority preparation input (no durable operation)', () => {
  beforeAll(async () => {
    const suffix = randomUUID()
    const portfolio = await createPortfolio({ name: 'OR1', code: 'PF-' + suffix })
    tenant = await createTenant({ portfolioId: portfolio.id, name: 'OR1', code: 'TNT-' + suffix })
    foreignTenant = await createTenant({ portfolioId: portfolio.id, name: 'Foreign', code: 'TNT-OTHER-' + suffix })
    business = await createBusiness({ tenantId: tenant.id, name: 'OR1', code: 'BUS-' + suffix })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'Other', code: 'BUS-OTHER-' + suffix })
    person = await prisma.person.create({ data: { displayName: 'OR1 owner', code: 'PER-' + suffix } })
    member = await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER' } })
    const sessionId = randomUUID()
    cookie = generateSessionToken(person.id, { secret: env.ZURI_SESSION_SECRET, sessionId })
    session = await persistSession({ token: cookie, sessionId, personId: person.id, env })
    file = await prisma.fileAsset.create({ data: { code: 'FIL-' + suffix, tenantId: tenant.id, businessId: business.id,
      storageKind: 'MANAGED_BLOB', status: 'ACTIVE', name: 'original.pdf', mime: 'application/pdf',
      sha256: recoverySha256(Buffer.from('original')), size: 8,
      blobRef: `s3-business://asset/asset-private/asset-evidence/${tenant.id}/${business.id}/original/file.pdf?versionId=v1` } })
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await prisma.membership.update({ where: { id: member.id }, data: { role: 'OWNER', status: 'ACTIVE', expiresAt: null, scopeType: 'BUSINESS', businessId: business.id, tenantId: tenant.id } })
    await prisma.session.update({ where: { id: session.id }, data: { status: 'ACTIVE', revokedAt: null, expiresAt: new Date(Date.now() + 600000) } })
    await prisma.person.update({ where: { id: person.id }, data: { accessDisabledAt: null } })
    await prisma.fileAsset.update({ where: { id: file.id }, data: { status: 'ACTIVE', deletedAt: null, blobRef: file.blobRef } })
    await prisma.business.update({ where: { id: business.id }, data: { status: 'ACTIVE' } })
    await prisma.tenant.update({ where: { id: tenant.id }, data: { status: 'ACTIVE' } })
    fetchSpy.mockClear()
  })
  it('returns evidence only, with zero mutation, source availability claim or provider IO', async () => {
    vi.stubGlobal('fetch', fetchSpy)
    const before = await prisma.fileAsset.findUnique({ where: { id: file.id } })
    const count = await prisma.auditEvent.count()
    const result = await prepare()
    expect(Object.keys(result)).toEqual(['descriptor'])
    expect(result.descriptor).toMatchObject({ fileId: file.id, purpose: 'asset', fileVersion: file.version })
    expect(await prisma.fileAsset.findUnique({ where: { id: file.id } })).toEqual(before)
    expect(await prisma.auditEvent.count()).toBe(count)
    expect(JSON.stringify(result)).not.toMatch(/blobRef|asset-private|operationId|PREPARED|test-secret/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it.each(['TENANT', 'legacy-null-business'])('honors current %s OWNER compatibility', async kind => {
    await prisma.membership.update({ where: { id: member.id }, data: { scopeType: kind === 'TENANT' ? 'TENANT' : 'BUSINESS', businessId: null } })
    await expect(prepare()).resolves.toHaveProperty('descriptor.fileId', file.id)
  })
  it('prepares catalog evidence using only its separately configured purpose bucket', async () => {
    await prisma.fileAsset.update({ where: { id: file.id }, data: {
      blobRef: file.blobRef.replace('://asset/asset-private/asset-evidence/', '://catalog/catalog-private/business-catalog/'),
    } })
    await expect(prepare()).resolves.toHaveProperty('descriptor.purpose', 'catalog')
  })
  it('does not turn a persisted installation OPERATOR grant into Business ownership', async () => {
    await prisma.membership.update({ where: { id: member.id }, data: { role: 'MEMBER' } })
    const grant = await prisma.platformGrant.create({ data: { personId: person.id, capability: 'OPERATOR', status: 'ACTIVE' } })
    try { await expect(prepare()).rejects.toMatchObject({ status: 404 }) }
    finally { await prisma.platformGrant.delete({ where: { id: grant.id } }) }
  })
  it('refuses a mismatched persisted membership Tenant even if the general Viewer includes its Business', async () => {
    await prisma.membership.update({ where: { id: member.id }, data: { tenantId: foreignTenant.id } })
    await expect(prepare()).rejects.toMatchObject({ status: 404 })
  })
  it.each(['member', 'owner-elsewhere', 'revoked', 'expired'])('denies %s like nonexistent, before configuration or provider access', async kind => {
    const patches = { member: { role: 'MEMBER' }, 'owner-elsewhere': { businessId: otherBusiness.id },
      revoked: { status: 'REVOKED' }, expired: { expiresAt: new Date(0) } }
    await prisma.membership.update({ where: { id: member.id }, data: patches[kind] })
    vi.stubGlobal('fetch', fetchSpy)
    const options = { env: { ...env, ZURI_ASSET_STORAGE_ENDPOINT: 'invalid-secret-endpoint' } }
    await expect(prepare(cookie, options)).rejects.toMatchObject({ status: 404, code: 'MANAGED_BLOB_RECOVERY_NOT_FOUND' })
    await expect(readManagedBlobRecoveryPreparation({ request: request(cookie), fileId: randomUUID(), input: { expectedVersion: 1 } }, options))
      .rejects.toMatchObject({ status: 404, code: 'MANAGED_BLOB_RECOVERY_NOT_FOUND' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it.each(['missing', 'legacy', 'unpersisted', 'wrong-token', 'revoked', 'expired', 'disabled', 'trailing-token'])('refuses %s session in development too', async kind => {
    let token = cookie
    if (kind === 'missing') token = null
    if (kind === 'legacy') token = generateSessionToken(person.id, { secret: env.ZURI_SESSION_SECRET })
    if (kind === 'unpersisted') token = generateSessionToken(person.id, { secret: env.ZURI_SESSION_SECRET, sessionId: randomUUID() })
    if (kind === 'wrong-token') token = generateSessionToken(person.id, { secret: env.ZURI_SESSION_SECRET, sessionId: session.id, now: Date.now() - 2000 })
    if (kind === 'revoked') await prisma.session.update({ where: { id: session.id }, data: { status: 'REVOKED', revokedAt: new Date() } })
    if (kind === 'expired') await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(0) } })
    if (kind === 'disabled') await prisma.person.update({ where: { id: person.id }, data: { accessDisabledAt: new Date() } })
    if (kind === 'trailing-token') token += '.extra'
    await expect(prepare(token)).rejects.toMatchObject({ status: 401 })
  })
  it.each(['business', 'tenant', 'file-deleted', 'file-quarantined'])('refuses inactive %s without disclosing evidence', async kind => {
    if (kind === 'business') await prisma.business.update({ where: { id: business.id }, data: { status: 'ARCHIVED' } })
    if (kind === 'tenant') await prisma.tenant.update({ where: { id: tenant.id }, data: { status: 'ARCHIVED' } })
    if (kind === 'file-deleted') await prisma.fileAsset.update({ where: { id: file.id }, data: { deletedAt: new Date() } })
    if (kind === 'file-quarantined') await prisma.fileAsset.update({ where: { id: file.id }, data: { status: 'QUARANTINED' } })
    await expect(prepare()).rejects.toMatchObject({ status: 404 })
  })
  it('refuses mismatched source configuration, tuple or caller scope without effects', async () => {
    for (const blobRef of [file.blobRef.replace('asset-private', 'foreign-bucket'), file.blobRef.replace(business.id, otherBusiness.id)]) {
      await prisma.fileAsset.update({ where: { id: file.id }, data: { blobRef } })
      await expect(prepare()).rejects.toThrow('Recovery request refused')
    }
    await prisma.fileAsset.update({ where: { id: file.id }, data: { blobRef: file.blobRef } })
    for (const input of [{ expectedVersion: 2 }, { expectedVersion: 1, businessId: business.id }]) {
      await expect(readManagedBlobRecoveryPreparation({ request: request(cookie), fileId: file.id, input }, { env }))
        .rejects.toThrow('Recovery request refused')
    }
    await expect(prepare(cookie, { env: { ...env, ZURI_ASSET_STORAGE_PROVIDER: 'supabase' } })).rejects.toMatchObject({ status: 503 })
  })
  it('sanitizes DB/store failures and never falls back to a Viewer', async () => {
    const db = { $transaction: async () => { throw new Error('db password secret') } }
    await expect(prepare(cookie, { db })).rejects.toMatchObject({ status: 503, message: 'Recovery request refused' })
  })
})
