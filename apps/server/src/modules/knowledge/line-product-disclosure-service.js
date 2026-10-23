import { createHash } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { LINE_OA_DOMAIN_KEY } from '@/modules/line-oa-studio/domain/line-oa-account'
import { readAuthorizedKnowledgeManifest } from './knowledge-corpus-service'
import {
  SMARTGIFT_CATALOG_CONTENT_TYPE,
  SMARTGIFT_CATALOG_FORMAT,
  SMARTGIFT_CATALOG_MAX_FILE_BYTES,
  SMARTGIFT_CATALOG_PROVIDER,
  smartGiftSourceKey,
} from './smartgift-catalog-adapter'
import {
  DISCLOSURE_FIELDS,
  disclosureLookupHash,
  projectDisclosureFacts,
  renderDisclosureFacts,
} from './line-product-disclosure-contract'
import { resolveLineProductDisclosureSource } from './line-product-disclosure-source'

// @req FR-235 — a Business OWNER approves the exact selected ProductMaster
//   projection for one LINE OA account; preview is non-granting and withdrawal
//   preserves history while clearing public lookup aliases.
// @spec ADR-098, ADR-106; docs/change-requests/integration/line-customer-product-disclosure-20261024.md
// @tested tests/integration/line-product-disclosure-policy.test.js

const MAX_PRODUCTS = 100
const MAX_SOURCES = 100
const SOURCE_SCAN_SIZE = MAX_SOURCES * 2
const MAX_POLICIES = 100
const SHA256 = /^[a-f0-9]{64}$/
const ID = z.string().trim().min(1).max(200)
const fieldEnum = z.enum(DISCLOSURE_FIELDS)
const fieldsSchema = z.array(fieldEnum).min(1).max(DISCLOSURE_FIELDS.length)
  .refine((fields) => new Set(fields).size === fields.length, 'Duplicate fields are not allowed')

const listInputSchema = z.object({
  businessId: ID,
  accountId: ID,
  q: z.string().trim().max(100).optional(),
  sourceQuery: z.string().trim().min(1).max(100).optional(),
  sourceCursor: ID.optional(),
}).strict()
const previewInputSchema = z.object({
  businessId: ID,
  accountId: ID,
  productId: ID,
  sourceId: ID,
  fields: fieldsSchema,
}).strict()
const approveInputSchema = previewInputSchema.extend({
  expectedVersion: z.number().int().nonnegative().safe(),
  previewHash: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().trim().min(1).max(2000),
}).strict()
const withdrawInputSchema = z.object({
  businessId: ID,
  accountId: ID,
  productId: ID,
  expectedVersion: z.number().int().positive().safe(),
  reason: z.string().trim().min(1).max(2000),
}).strict()

const notFound = () => failure(404, 'LINE_PRODUCT_DISCLOSURE_NOT_FOUND')
const conflict = () => failure(409, 'LINE_PRODUCT_DISCLOSURE_VERSION_CONFLICT')
const staleSource = () => failure(409, 'LINE_PRODUCT_DISCLOSURE_SOURCE_STALE')
const sendInProgress = () => failure(409, 'LINE_PRODUCT_DISCLOSURE_SEND_IN_PROGRESS')

function failure(status, code) {
  return Object.assign(new Error(code), { status, code })
}

function parse(schema, input) {
  const result = schema.safeParse(input)
  if (!result.success) throw failure(400, 'LINE_PRODUCT_DISCLOSURE_INPUT_INVALID')
  return result.data
}

function requireOwner(viewer, businessId) {
  if (!ownsBusiness(viewer, businessId)) throw notFound()
  try {
    assertDomainVisible(viewer, businessId, LINE_OA_DOMAIN_KEY)
  } catch {
    throw notFound()
  }
  const personId = typeof viewer?.principal?.id === 'string' ? viewer.principal.id.trim() : ''
  if (!personId) throw notFound()
  return personId
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function normalizedFields(fields) {
  return DISCLOSURE_FIELDS.filter((field) => fields.includes(field))
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function makePreviewHash({ businessId, accountId, productId, sourceId, fields, expectedVersion, projectionSha256, binding, values }) {
  return digest(canonicalJson({
    schema: 'zuri.line-product-disclosure.preview.v1',
    businessId,
    accountId,
    productId,
    sourceId,
    fields,
    expectedVersion,
    projectionSha256,
    binding,
    values,
  }))
}

async function loadScope(tx, input, { requireActive = true } = {}) {
  const business = await tx.business.findUnique({ where: { id: input.businessId }, select: { id: true, tenantId: true, status: true } })
  if (!business || (requireActive && business.status !== 'ACTIVE')) throw notFound()
  const account = await tx.lineOaAccount.findFirst({ where: {
    id: input.accountId,
    tenantId: business.tenantId,
    businessId: business.id,
    ...(requireActive ? { archivedAt: null, serverEnabled: true, transportMode: 'CLOUD', status: 'CONNECTED' } : {}),
  }, select: { id: true, tenantId: true, businessId: true, status: true, serverEnabled: true, transportMode: true, archivedAt: true, version: true } })
  if (!account) throw notFound()
  return { business, account }
}

async function lockAccountForPolicyChange(tx, scope) {
  const { account, business } = scope
  const fence = await tx.lineOaAccount.updateMany({ where: { id: account.id, tenantId: business.tenantId,
    businessId: business.id, version: account.version }, data: { version: { increment: 1 } } })
  const pendingDeliveryCount = await tx.lineConversationJob.count({ where: { accountId: account.id,
    OR: [{ status: { in: ['SENDING', 'UNKNOWN'] } }, { status: 'READY', firstSendAt: { not: null } }] } })
  if (pendingDeliveryCount) throw sendInProgress()
  if (fence.count !== 1) throw failure(409, 'LINE_OA_ACCOUNT_VERSION_CONFLICT')
}

async function loadEligibleProduct(tx, scope, productId) {
  const product = await tx.product.findFirst({ where: {
    id: productId,
    tenantId: scope.business.tenantId,
    businessId: scope.business.id,
    status: 'ACTIVE',
    archivedAt: null,
    itemKind: { not: 'CUSTOM_COMPONENT' },
    dedicatedCustomerId: null,
    dedicatedSalesOrderId: null,
    productMaster: { status: 'ACTIVE', nature: 'GOOD' },
  }, select: { id: true, tenantId: true, businessId: true, status: true, archivedAt: true, code: true, unit: true,
    itemKind: true, dedicatedCustomerId: true, dedicatedSalesOrderId: true, productMaster: { select: { id: true, status: true, nature: true } } } })
  if (!product) throw notFound()
  return product
}

async function resolveProjection(input, scope, product, fields, { db, env, expectedVersion }) {
  let source
  try {
    source = await resolveLineProductDisclosureSource({
      tenantId: scope.business.tenantId,
      businessId: scope.business.id,
      accountId: scope.account.id,
      productId: product.id,
      sourceId: input.sourceId,
      fields,
    }, { db, env })
  } catch {
    throw staleSource()
  }
  if (!source || !Array.isArray(source.values) || !source.binding || !/^[0-9a-f]{64}$/.test(source.projectionSha256 || '')) {
    throw staleSource()
  }
  const values = source.values
  const seen = new Set()
  const available = new Set()
  for (const entry of values) {
    if (!entry || !fields.includes(entry.field) || seen.has(entry.field)) throw staleSource()
    seen.add(entry.field)
    if (entry.value != null) available.add(entry.field)
  }
  if (fields.some((field) => !available.has(field))) throw failure(422, 'LINE_PRODUCT_DISCLOSURE_FIELD_UNAVAILABLE')
  const facts = projectDisclosureFacts(values)
  if (!Array.isArray(facts) || facts.length !== values.length || facts.some((fact) => typeof fact?.id !== 'string')) throw staleSource()
  const exampleText = renderDisclosureFacts(facts, facts.map((fact) => fact.id))
  if (typeof exampleText !== 'string' || !exampleText.trim()) throw staleSource()
  const bindingJson = canonicalJson(source.binding)
  const previewHash = makePreviewHash({
    businessId: scope.business.id,
    accountId: scope.account.id,
    productId: product.id,
    sourceId: input.sourceId,
    fields,
    expectedVersion,
    projectionSha256: source.projectionSha256,
    binding: source.binding,
    values,
  })
  return { values, exampleText, bindingJson, projectionSha256: source.projectionSha256, previewHash }
}

function lookupHash(field, fields, values) {
  if (!fields.includes(field)) return null
  const value = values.find((entry) => entry.field === field)?.value
  if (typeof value !== 'string' || !value.trim()) return null
  return disclosureLookupHash(value)
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length)
  let nextIndex = 0
  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      output[index] = await mapper(items[index], index)
    }
  }))
  return output
}

function parseFields(fieldsJson) {
  try {
    const parsed = JSON.parse(fieldsJson)
    return Array.isArray(parsed) && parsed.every((field) => DISCLOSURE_FIELDS.includes(field))
      ? normalizedFields(parsed) : null
  } catch {
    return null
  }
}

async function isPolicyStale(policy, { db, env }) {
  const fields = parseFields(policy.fieldsJson)
  if (!fields?.length) return true
  try {
    const resolved = await resolveLineProductDisclosureSource({
      tenantId: policy.tenantId,
      businessId: policy.businessId,
      accountId: policy.lineOaAccountId,
      productId: policy.productId,
      sourceId: policy.sourceId,
      fields,
    }, { db, env })
    return resolved.projectionSha256 !== policy.projectionSha256
      || canonicalJson(resolved.binding) !== policy.sourceBindingJson
  } catch {
    return true
  }
}

function parseSourceMetadata(value) {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isCurrentProductMasterCandidate({ source, ingestion, asset, entry, corpusId, scope }) {
  if (!source || !ingestion || !asset || !entry
    || source.corpusId !== corpusId || source.id !== entry.sourceId || source.kind !== 'FILE'
    || source.revokedAt != null || source.deletedAt != null || source.activeIngestionId !== entry.ingestionId
    || source.desiredRevision !== entry.revision || source.fileAssetId !== entry.fileAssetId
    || source.title !== entry.title || ingestion.id !== entry.ingestionId || ingestion.corpusId !== corpusId
    || ingestion.sourceId !== source.id || ingestion.status !== 'PUBLISHED' || ingestion.revision !== entry.revision
    || ingestion.sourceVersion !== entry.sourceVersion || ingestion.contentHash !== entry.contentHash
    || ingestion.executionRunId !== entry.executionRunId || ingestion.snapshotId !== entry.snapshotId
    || ingestion.snapshotGeneration !== entry.generation || ingestion.receiptHash !== entry.receiptHash
    || ingestion.rawArtifactId !== entry.rawArtifactId || ingestion.parsedArtifactId !== entry.parsedArtifactId
    || asset.id !== entry.fileAssetId || asset.tenantId !== scope.business.tenantId
    || asset.businessId !== scope.business.id || asset.projectId != null || asset.workItemId != null
    || asset.storageKind !== 'MANAGED_BLOB' || asset.mime !== SMARTGIFT_CATALOG_CONTENT_TYPE
    || !/^PCAT-[a-f0-9]{64}$/.test(asset.code || '') || typeof asset.name !== 'string'
    || asset.name.length < 1 || asset.name.length > 255 || asset.name.trim() !== asset.name
    || !Number.isSafeInteger(asset.size)
    || asset.size <= 0 || asset.size > SMARTGIFT_CATALOG_MAX_FILE_BYTES || !SHA256.test(asset.sha256 || '')
    || asset.status !== 'ACTIVE' || asset.deletedAt != null || !Number.isSafeInteger(source.version)
    || entry.scope?.tenantId !== scope.business.tenantId || entry.scope?.businessId !== scope.business.id) return false

  if (typeof ingestion.sourceMetaJson !== 'string' || Buffer.byteLength(ingestion.sourceMetaJson, 'utf8') > 64 * 1024) return false
  const metadata = parseSourceMetadata(ingestion.sourceMetaJson)
  const descriptor = metadata?.structured
  return metadata?.kind === 'FILE' && metadata.title === source.title && metadata.sourceKey === source.sourceKey
    && metadata.fileAssetId === asset.id && metadata.fileAssetVersion === asset.version
    && metadata.mime === asset.mime && metadata.storageKind === asset.storageKind
    && Number.isSafeInteger(metadata.size) && metadata.size > 0 && metadata.size <= asset.size
    && metadata.sourceVersion === ingestion.sourceVersion && metadata.contentHash === ingestion.contentHash
    && descriptor?.format === SMARTGIFT_CATALOG_FORMAT && descriptor.provider === SMARTGIFT_CATALOG_PROVIDER
    && descriptor.entityType === 'ProductMaster' && descriptor.contentType === SMARTGIFT_CATALOG_CONTENT_TYPE
    && typeof descriptor.externalId === 'string' && descriptor.externalId.length > 0
    && descriptor.externalId.trim() === descriptor.externalId
    && Number.isSafeInteger(descriptor.recordIndex) && descriptor.recordIndex >= 0
    && Number.isSafeInteger(descriptor.recordCount) && descriptor.recordCount > descriptor.recordIndex
    && descriptor.fileSha256 === asset.sha256
    && source.sourceKey === smartGiftSourceKey({ fileName: asset.name, recordCode: descriptor.externalId })
    && source.title === `ProductMaster ${descriptor.externalId}`
    && ingestion.sourceVersion === asset.sha256
}

async function listCurrentProductMasterSources(scope, viewer, db, env, { sourceQuery, sourceCursor } = {}) {
  let manifest
  try {
    manifest = await readAuthorizedKnowledgeManifest({ businessId: scope.business.id, projectId: null }, { db, viewer, env })
  } catch (error) {
    if (error?.code === 'KNOWLEDGE_CORPUS_NOT_FOUND') return { sources: [], sourcesNextCursor: null }
    throw error
  }
  if (!manifest || manifest.scope?.tenantId !== scope.business.tenantId
    || manifest.scope?.businessId !== scope.business.id || !Array.isArray(manifest.entries)) {
    return { sources: [], sourcesNextCursor: null }
  }

  // The manifest reader validates its immutable receipt and file ACL. Scan a
  // bounded keyset page; preview and approval re-resolve the explicitly selected
  // pair. The cursor advances over scanned rows, including non-matches, so a
  // source query can find eligible catalogs beyond the first page.
  const entries = manifest.entries.filter((entry) => entry?.fileAssetId && typeof entry.sourceId === 'string')
  const sourceIds = [...new Set(entries.map((entry) => entry.sourceId))].sort()
  const afterCursor = sourceCursor ? sourceIds.filter((id) => id > sourceCursor) : sourceIds
  const sourcePageIds = afterCursor.slice(0, SOURCE_SCAN_SIZE)
  const hasMoreEntries = afterCursor.length > SOURCE_SCAN_SIZE
  if (!sourcePageIds.length) return { sources: [], sourcesNextCursor: null }
  const pageIdSet = new Set(sourcePageIds)
  const pageEntries = entries.filter((entry) => pageIdSet.has(entry.sourceId))
  const sourceRows = await db.knowledgeSource.findMany({
    where: {
      id: { in: sourcePageIds },
      corpusId: manifest.corpusId,
      kind: 'FILE',
      revokedAt: null,
      deletedAt: null,
      activeIngestionId: { not: null },
    },
    orderBy: { id: 'asc' },
    take: sourcePageIds.length,
    select: { id: true, corpusId: true, sourceKey: true, kind: true, title: true, fileAssetId: true,
      desiredRevision: true, activeIngestionId: true, version: true, revokedAt: true, deletedAt: true },
  })
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]))
  const entriesBySourceId = new Map()
  for (const entry of pageEntries) {
    const source = sourceById.get(entry.sourceId)
    if (source?.activeIngestionId !== entry.ingestionId || source?.desiredRevision !== entry.revision) continue
    const matches = entriesBySourceId.get(entry.sourceId) || []
    matches.push(entry)
    entriesBySourceId.set(entry.sourceId, matches)
  }
  const pageRows = sourceRows.slice(0, SOURCE_SCAN_SIZE)
  const selectedEntries = pageRows.flatMap((source) => (entriesBySourceId.get(source.id) || [])
    .filter((entry) => source.activeIngestionId === entry.ingestionId && source.desiredRevision === entry.revision)
    .map((entry) => ({ source, entry })))
  if (!selectedEntries.length) {
    return {
      sources: [],
      sourcesNextCursor: hasMoreEntries ? sourcePageIds.at(-1) ?? null : null,
    }
  }

  const ingestionIds = [...new Set(selectedEntries.map(({ entry }) => entry.ingestionId))]
  const assetIds = [...new Set(selectedEntries.map(({ entry }) => entry.fileAssetId).filter(Boolean))]
  const [ingestions, assets] = await Promise.all([
    db.knowledgeIngestion.findMany({ where: { id: { in: ingestionIds }, status: 'PUBLISHED' },
      select: { id: true, corpusId: true, sourceId: true, revision: true, sourceVersion: true, contentHash: true,
        sourceMetaJson: true, status: true, executionRunId: true, rawArtifactId: true, parsedArtifactId: true,
        snapshotId: true, snapshotGeneration: true, receiptHash: true } }),
    db.fileAsset.findMany({ where: { id: { in: assetIds }, tenantId: scope.business.tenantId, businessId: scope.business.id,
      projectId: null, workItemId: null, storageKind: 'MANAGED_BLOB', status: 'ACTIVE', deletedAt: null },
      select: { id: true, code: true, tenantId: true, businessId: true, projectId: true, workItemId: true,
        storageKind: true, name: true, mime: true, size: true, sha256: true, status: true, version: true, deletedAt: true } }),
  ])
  const ingestionById = new Map(ingestions.map((row) => [row.id, row]))
  const assetById = new Map(assets.map((row) => [row.id, row]))
  const candidates = []
  for (const { source, entry } of selectedEntries) {
    const ingestion = ingestionById.get(entry.ingestionId)
    const asset = assetById.get(entry.fileAssetId)
    if (isCurrentProductMasterCandidate({ source, ingestion, asset, entry, corpusId: manifest.corpusId, scope })
      && (!sourceQuery || source.title.toLocaleLowerCase().includes(sourceQuery.toLocaleLowerCase()))) {
      candidates.push({ id: source.id, title: source.title })
    }
  }
  const limited = candidates.slice(0, MAX_SOURCES)
  const sourcesNextCursor = candidates.length > MAX_SOURCES
    ? limited.at(-1)?.id ?? null
    : hasMoreEntries ? sourcePageIds.at(-1) ?? null : null
  return { sources: limited, sourcesNextCursor }
}

/** Return bounded owner-visible candidate products, active published FILE sources, and policy summaries. */
export async function listLineProductDisclosure(input, { viewer, db = prisma, env = process.env } = {}) {
  const value = parse(listInputSchema, input)
  requireOwner(viewer, value.businessId)
  const scope = await loadScope(db, value)
  const productWhere = {
    tenantId: scope.business.tenantId,
    businessId: scope.business.id,
    status: 'ACTIVE',
    archivedAt: null,
    itemKind: { not: 'CUSTOM_COMPONENT' },
    dedicatedCustomerId: null,
    dedicatedSalesOrderId: null,
    productMaster: { status: 'ACTIVE', nature: 'GOOD' },
    ...(value.q ? { OR: [
      { code: { contains: value.q } },
      { name: { contains: value.q } },
      { productMaster: { nameTh: { contains: value.q } } },
      { productMaster: { nameEn: { contains: value.q } } },
    ] } : {}),
  }
  const [products, sourcePage] = await Promise.all([
    db.product.findMany({ where: productWhere, orderBy: { code: 'asc' }, take: MAX_PRODUCTS,
      select: { id: true, code: true, name: true, productMaster: { select: { nameTh: true } } } }),
    listCurrentProductMasterSources(scope, viewer, db, env, value),
  ])
  const productIds = products.map((product) => product.id)
  const policies = productIds.length
    ? await db.lineProductDisclosurePolicy.findMany({ where: { tenantId: scope.business.tenantId, businessId: scope.business.id,
      lineOaAccountId: scope.account.id, productId: { in: productIds } }, orderBy: { updatedAt: 'desc' }, take: MAX_POLICIES })
    : []
  const policySummaries = await mapWithConcurrency(policies, 4, async (policy) => ({
    productId: policy.productId,
    sourceId: policy.sourceId,
    fields: parseFields(policy.fieldsJson) || [],
    enabled: policy.enabled,
    version: policy.version,
    stale: await isPolicyStale(policy, { db, env }),
  }))
  return {
    products: products.map((product) => ({ id: product.id, code: product.code, name: product.name || product.productMaster?.nameTh || product.code })),
    sources: sourcePage.sources,
    sourcesNextCursor: sourcePage.sourcesNextCursor,
    policies: policySummaries,
    fields: [...DISCLOSURE_FIELDS],
  }
}

/** Preview a selected product/source/field set without changing policy state. */
export async function previewLineProductDisclosure(input, { viewer, db = prisma, env = process.env } = {}) {
  const value = parse(previewInputSchema, input)
  requireOwner(viewer, value.businessId)
  const scope = await loadScope(db, value)
  const product = await loadEligibleProduct(db, scope, value.productId)
  const fields = normalizedFields(value.fields)
  const current = await db.lineProductDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: {
    tenantId: scope.business.tenantId, businessId: scope.business.id, lineOaAccountId: scope.account.id, productId: product.id,
  } }, select: { version: true } })
  const expectedVersion = current?.version ?? 0
  const projection = await resolveProjection(value, scope, product, fields, { db, env, expectedVersion })
  return { previewHash: projection.previewHash, expectedVersion, values: projection.values, exampleText: projection.exampleText }
}

/** Approve the exact current preview with scoped compare-and-swap and atomic audit. */
export async function setLineProductDisclosure(input, { viewer, db = prisma, env = process.env, now = new Date() } = {}) {
  const value = parse(approveInputSchema, input)
  const actorPersonId = requireOwner(viewer, value.businessId)
  const fields = normalizedFields(value.fields)
  const at = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(at.valueOf())) throw failure(400, 'LINE_PRODUCT_DISCLOSURE_TIME_INVALID')
  try {
    return await db.$transaction(async (tx) => {
      const scope = await loadScope(tx, value)
      await lockAccountForPolicyChange(tx, scope)
      const product = await loadEligibleProduct(tx, scope, value.productId)
      const key = { tenantId: scope.business.tenantId, businessId: scope.business.id,
        lineOaAccountId: scope.account.id, productId: product.id }
      const current = await tx.lineProductDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: key } })
      if (value.expectedVersion === 0 ? Boolean(current) : !current || current.version !== value.expectedVersion) throw conflict()
      const projection = await resolveProjection(value, scope, product, fields, { db: tx, env, expectedVersion: value.expectedVersion })
      if (projection.previewHash !== value.previewHash) throw conflict()
      const data = {
        sourceId: value.sourceId,
        fieldsJson: JSON.stringify(fields),
        sourceBindingJson: projection.bindingJson,
        projectionSha256: projection.projectionSha256,
        skuLookupSha256: lookupHash('sku', fields, projection.values),
        nameThLookupSha256: lookupHash('nameTh', fields, projection.values),
        nameEnLookupSha256: lookupHash('nameEn', fields, projection.values),
        approvedByPersonId: actorPersonId,
        approvedAt: at,
        reason: value.reason,
        enabled: true,
        updatedAt: at,
      }
      let row
      if (value.expectedVersion === 0) {
        row = await tx.lineProductDisclosurePolicy.create({ data: {
          ...key,
          ...data,
          version: 1,
          createdAt: at,
        } })
      } else {
        const update = await tx.lineProductDisclosurePolicy.updateMany({ where: { ...key, version: value.expectedVersion },
          data: { ...data, version: { increment: 1 } } })
        if (update.count !== 1) throw conflict()
        row = await tx.lineProductDisclosurePolicy.findUnique({ where: { id: current.id } })
      }
      await recordAudit(tx, {
        entityType: 'LINE_PRODUCT_DISCLOSURE_POLICY', entityId: row.id, action: 'LINE_PRODUCT_DISCLOSURE_APPROVED',
        actorId: actorPersonId, tenantId: row.tenantId, businessId: row.businessId, reason: value.reason,
        payload: { lineOaAccountId: row.lineOaAccountId, productId: row.productId, sourceId: row.sourceId,
          fields, enabled: true, version: row.version, projectionSha256: row.projectionSha256 },
      })
      return row
    })
  } catch (error) {
    if (value.expectedVersion === 0 && error?.code === 'P2002') throw conflict()
    if (error?.code === 'P2034' || error?.code === 'P2025') throw conflict()
    throw error
  }
}

/** Withdraw without consulting source availability; the disabled row and audit remain. */
export async function withdrawLineProductDisclosure(input, { viewer, db = prisma, now = new Date() } = {}) {
  const value = parse(withdrawInputSchema, input)
  const actorPersonId = requireOwner(viewer, value.businessId)
  const at = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(at.valueOf())) throw failure(400, 'LINE_PRODUCT_DISCLOSURE_TIME_INVALID')
  try {
    return await db.$transaction(async (tx) => {
      const scope = await loadScope(tx, value, { requireActive: false })
      await lockAccountForPolicyChange(tx, scope)
      const product = await tx.product.findFirst({ where: { id: value.productId, tenantId: scope.business.tenantId,
        businessId: scope.business.id }, select: { id: true } })
      if (!product) throw notFound()
      const key = { tenantId: scope.business.tenantId, businessId: scope.business.id,
        lineOaAccountId: scope.account.id, productId: product.id }
      const current = await tx.lineProductDisclosurePolicy.findUnique({ where: { tenantId_businessId_lineOaAccountId_productId: key } })
      if (!current || current.version !== value.expectedVersion) throw conflict()
      const update = await tx.lineProductDisclosurePolicy.updateMany({ where: { ...key, version: value.expectedVersion }, data: {
        enabled: false,
        skuLookupSha256: null,
        nameThLookupSha256: null,
        nameEnLookupSha256: null,
        reason: value.reason,
        updatedAt: at,
        version: { increment: 1 },
      } })
      if (update.count !== 1) throw conflict()
      const row = await tx.lineProductDisclosurePolicy.findUnique({ where: { id: current.id } })
      await recordAudit(tx, {
        entityType: 'LINE_PRODUCT_DISCLOSURE_POLICY', entityId: row.id, action: 'LINE_PRODUCT_DISCLOSURE_WITHDRAWN',
        actorId: actorPersonId, tenantId: row.tenantId, businessId: row.businessId, reason: value.reason,
        payload: { lineOaAccountId: row.lineOaAccountId, productId: row.productId, sourceId: row.sourceId,
          enabled: false, version: row.version },
      })
      return row
    })
  } catch (error) {
    if (error?.code === 'P2034' || error?.code === 'P2025') throw conflict()
    throw error
  }
}
