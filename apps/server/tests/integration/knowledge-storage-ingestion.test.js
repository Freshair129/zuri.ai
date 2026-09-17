// @req FR-109, FR-173 — an opted-in raw run stores exact bytes and verifies the
// object version before Stage 1 evidence continues.
// @spec TASK-ZAI-049 storage spec, ADR-072
// @tested src/platform/integrations/core/genesisrag17-executor.js
import { randomUUID, createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { makeOperatorViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { ingestGenesisRag17Raw } from '@/platform/integrations/core/genesisrag17-executor'
import { GENESIS_RAG17_SCHEMA_VERSION } from '@/modules/knowledge/genesisrag17-contract'

describe('TASK-ZAI-049 raw ingestion storage binding', () => {
  let scope
  let connectionId
  let viewer

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8)
    const portfolio = await createPortfolio({ name: `Storage portfolio ${suffix}`, code: `ST-PF-${suffix}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `Storage tenant ${suffix}`, code: `ST-TN-${suffix}` })
    const business = await createBusiness({ tenantId: tenant.id, name: `Storage business ${suffix}`, code: `ST-BU-${suffix}` })
    const provider = await prisma.integrationProvider.create({ data: { code: `ST-${suffix}`, name: 'Storage test source', status: 'ACTIVE' } })
    const connection = await prisma.integrationConnection.create({ data: { tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'Storage source', status: 'ACTIVE' } })
    scope = { portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: `workspace-${suffix}`, agentId: `agent-${suffix}`, visibility: 'private' }
    connectionId = connection.id
    viewer = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
  })

  it('stores the exact UTF-8 bytes and returns a READY version-bound reference', async () => {
    const content = 'ราคา 10 บาท\nบรรทัดสอง'
    const objects = new Map()
    const storage = {
      putImmutable: async ({ key, content: bytes, expectedSha256 }) => {
        const versionId = 'storage-version-1'
        objects.set(`${key}|${versionId}`, Buffer.from(bytes))
        return { key, versionId, sha256: expectedSha256, byteLength: bytes.length }
      },
      readExact: async ({ key, versionId }) => {
        const bytes = objects.get(`${key}|${versionId}`)
        return { bytes, versionId, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length }
      },
    }
    const transport = async (name, request) => ({ schemaVersion: GENESIS_RAG17_SCHEMA_VERSION, scope: request.scope, batchId: request.batch.batchId, decisionId: null, status: 'PENDING' })
    const result = await ingestGenesisRag17Raw({ scope, policy: { allowEmbedding: true, allowPublication: true }, source: {
      sourceId: `storage://source/${randomUUID()}`, documentId: 'storage-doc', version: '1', content, connectionId, sourceType: 'TEXT', sourceUri: 'storage-test',
    } }, { db: prisma, viewer, transport, credential: 'storage-test', storagePort: storage, storageBinding: { id: 'minio-local', revision: 1, bucket: 'knowledge-raw' } })
    const stored = await prisma.knowledgeArtifactStorage.findUnique({ where: { rawArtifactId: result.source.rawArtifactId } })
    expect(stored).toMatchObject({ status: 'READY', objectVersionId: 'storage-version-1', bucket: 'knowledge-raw', byteLength: Buffer.byteLength(content), contentType: 'text/plain' })
    expect(stored.sha256).toBe(createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex'))
    expect(objects.size).toBe(1)
  })
})
