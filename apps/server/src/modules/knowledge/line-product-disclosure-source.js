import { createHash } from 'node:crypto'
import prisma from '@/lib/db'
import { resolveFileAssetContent } from '@/modules/project-manager/application/file-asset-service'
import { readAuthorizedKnowledgeManifest } from './knowledge-corpus-service'
import {
  SMARTGIFT_CATALOG_CONTENT_TYPE,
  SMARTGIFT_CATALOG_FORMAT,
  SMARTGIFT_CATALOG_MAX_FILE_BYTES,
  SMARTGIFT_CATALOG_PROVIDER,
  smartGiftSourceKey,
  splitSmartGiftCatalogRecords,
} from './smartgift-catalog-adapter'
import { hashGenesisRag17Json, hashGenesisRag17Text } from './genesisrag17-contract'
import { DISCLOSURE_FIELDS } from './line-product-disclosure-contract'

// @req FR-079, FR-235 — a customer-safe field projection is derived only from
// one currently published, receipt-backed ProductMaster record and one live
// Product explicitly paired with that source.
// @spec SEC-001, SEC-032 — immutable bytes, manifest receipt, live scoped
// identities and versioned Product state are checked across storage reads.
// @tested tests/unit/line-product-disclosure-source.test.js

const SHA256 = /^[a-f0-9]{64}$/
const MAX_TEXT_LENGTH = 500
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u
const unavailable = () => Object.assign(new Error('LINE_PRODUCT_DISCLOSURE_SOURCE_UNAVAILABLE'), {
  code: 'LINE_PRODUCT_DISCLOSURE_SOURCE_UNAVAILABLE',
})
const insist = (condition) => { if (!condition) throw unavailable() }
const requiredText = (value, limit = MAX_TEXT_LENGTH) => typeof value === 'string'
  && value.length > 0 && value.length <= limit && value.trim() === value && !CONTROL_CHARACTERS.test(value)
const safeTimestamp = (value) => value instanceof Date ? value.toISOString() : value ?? null
const jsonHash = (value) => hashGenesisRag17Json(value)

const businessSelect = { id: true, tenantId: true, status: true }
const accountSelect = {
  id: true, tenantId: true, businessId: true, status: true, transportMode: true,
  archivedAt: true, version: true,
}
const productSelect = {
  id: true, tenantId: true, businessId: true, code: true, name: true, unit: true,
  status: true, itemKind: true, dedicatedCustomerId: true, dedicatedSalesOrderId: true,
  archivedAt: true, version: true,
  productMasterId:true, productMaster:{select:{id:true,tenantId:true,businessId:true,status:true,nature:true,version:true}},
}
const sourceSelect = {
  id: true, corpusId: true, sourceKey: true, kind: true, title: true, fileAssetId: true,
  desiredRevision: true, activeIngestionId: true, version: true, revokedAt: true, deletedAt: true,
}
const ingestionSelect = {
  id: true, corpusId: true, sourceId: true, revision: true, sourceVersion: true,
  contentHash: true, content: true, sourceMetaJson: true, status: true, executionRunId: true,
  rawArtifactId: true, parsedArtifactId: true, snapshotId: true, snapshotGeneration: true, receiptHash: true,
}
const assetSelect = {
  id: true, tenantId: true, businessId: true, projectId: true, workItemId: true,
  storageKind: true, relativePath: true, externalUrl: true, blobRef: true, name: true,
  mime: true, size: true, sha256: true, status: true, version: true, deletedAt: true,
}

function assetIdentity(asset) {
  return {
    id: asset?.id ?? null,
    tenantId: asset?.tenantId ?? null,
    businessId: asset?.businessId ?? null,
    projectId: asset?.projectId ?? null,
    workItemId: asset?.workItemId ?? null,
    storageKind: asset?.storageKind ?? null,
    relativePath: asset?.relativePath ?? null,
    externalUrl: asset?.externalUrl ?? null,
    blobRef: asset?.blobRef ?? null,
    name: asset?.name ?? null,
    mime: asset?.mime ?? null,
    size: asset?.size ?? null,
    sha256: asset?.sha256 ?? null,
    status: asset?.status ?? null,
    version: asset?.version ?? null,
    deletedAt: safeTimestamp(asset?.deletedAt),
  }
}

function sourceIdentity(source) {
  return {
    id: source?.id ?? null,
    corpusId: source?.corpusId ?? null,
    sourceKey: source?.sourceKey ?? null,
    kind: source?.kind ?? null,
    title: source?.title ?? null,
    fileAssetId: source?.fileAssetId ?? null,
    desiredRevision: source?.desiredRevision ?? null,
    activeIngestionId: source?.activeIngestionId ?? null,
    version: source?.version ?? null,
    revokedAt: safeTimestamp(source?.revokedAt),
    deletedAt: safeTimestamp(source?.deletedAt),
  }
}

function ingestionIdentity(ingestion) {
  return {
    id: ingestion?.id ?? null,
    corpusId: ingestion?.corpusId ?? null,
    sourceId: ingestion?.sourceId ?? null,
    revision: ingestion?.revision ?? null,
    sourceVersion: ingestion?.sourceVersion ?? null,
    contentHash: ingestion?.contentHash ?? null,
    status: ingestion?.status ?? null,
    executionRunId: ingestion?.executionRunId ?? null,
    snapshotId: ingestion?.snapshotId ?? null,
    snapshotGeneration: ingestion?.snapshotGeneration ?? null,
    receiptHash: ingestion?.receiptHash ?? null,
    rawArtifactId: ingestion?.rawArtifactId ?? null,
    parsedArtifactId: ingestion?.parsedArtifactId ?? null,
    sourceMetaSha256: typeof ingestion?.sourceMetaJson === 'string'
      ? hashGenesisRag17Text(ingestion.sourceMetaJson) : null,
    contentSha256: typeof ingestion?.content === 'string' ? hashGenesisRag17Text(ingestion.content) : null,
  }
}

function productIdentity(product) {
  return {
    id: product?.id ?? null,
    tenantId: product?.tenantId ?? null,
    businessId: product?.businessId ?? null,
    code: product?.code ?? null,
    name: product?.name ?? null,
    unit: product?.unit ?? null,
    status: product?.status ?? null,
    itemKind: product?.itemKind ?? null,
    dedicatedCustomerId: product?.dedicatedCustomerId ?? null,
    dedicatedSalesOrderId: product?.dedicatedSalesOrderId ?? null,
    archivedAt: safeTimestamp(product?.archivedAt),
    version: product?.version ?? null,
    productMasterId:product?.productMasterId ?? null,
    productMaster:product?.productMaster ? {id:product.productMaster.id,tenantId:product.productMaster.tenantId,
      businessId:product.productMaster.businessId,status:product.productMaster.status,nature:product.productMaster.nature,
      version:product.productMaster.version} : null,
  }
}

function accountIdentity(account) {
  return {
    id: account?.id ?? null,
    tenantId: account?.tenantId ?? null,
    businessId: account?.businessId ?? null,
    status: account?.status ?? null,
    transportMode: account?.transportMode ?? null,
    archivedAt: safeTimestamp(account?.archivedAt),
    version: account?.version ?? null,
  }
}

function businessIdentity(business) {
  return { id: business?.id ?? null, tenantId: business?.tenantId ?? null, status: business?.status ?? null }
}

function entryIdentity(entry) {
  return {
    sourceId: entry?.sourceId ?? null,
    ingestionId: entry?.ingestionId ?? null,
    sourceVersion: entry?.sourceVersion ?? null,
    revision: entry?.revision ?? null,
    executionRunId: entry?.executionRunId ?? null,
    snapshotId: entry?.snapshotId ?? null,
    generation: entry?.generation ?? null,
    receiptHash: entry?.receiptHash ?? null,
    rawArtifactId: entry?.rawArtifactId ?? null,
    parsedArtifactId: entry?.parsedArtifactId ?? null,
    contentHash: entry?.contentHash ?? null,
    fileAssetId: entry?.fileAssetId ?? null,
    title: entry?.title ?? null,
    scope: entry?.scope ?? null,
  }
}

function sameManifest(left, right) {
  return Boolean(left && right && left.corpusId === right.corpusId
    && left.corpusGeneration === right.corpusGeneration && left.manifestHash === right.manifestHash
    && jsonHash(left.scope) === jsonHash(right.scope)
    && Array.isArray(left.entries) && Array.isArray(right.entries)
    && jsonHash(left.entries) === jsonHash(right.entries))
}

function parseSourceMeta(value) {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch { return null }
}

function validateInput(input) {
  insist(input && typeof input === 'object' && !Array.isArray(input))
  const inputKeys = Object.keys(input).sort()
  insist(inputKeys.length === 6 && inputKeys.join(',') === 'accountId,businessId,fields,productId,sourceId,tenantId')
  for (const key of ['tenantId', 'businessId', 'accountId', 'productId', 'sourceId']) {
    insist(requiredText(input[key], 200))
  }
  insist(Array.isArray(input.fields) && input.fields.length > 0 && input.fields.length <= DISCLOSURE_FIELDS.length)
  const fields = new Set()
  for (const field of input.fields) {
    insist(typeof field === 'string' && DISCLOSURE_FIELDS.includes(field) && !fields.has(field))
    fields.add(field)
  }
  return DISCLOSURE_FIELDS.filter((field) => fields.has(field))
}

function validateManifest(manifest, { tenantId, businessId, sourceId }) {
  insist(manifest && manifest.scope?.tenantId === tenantId && manifest.scope?.businessId === businessId
    && requiredText(manifest.corpusId, 200) && Number.isSafeInteger(manifest.corpusGeneration)
    && manifest.corpusGeneration >= 1 && SHA256.test(manifest.manifestHash) && Array.isArray(manifest.entries))
  const matches = manifest.entries.filter((entry) => entry?.sourceId === sourceId)
  insist(matches.length === 1)
  const entry = matches[0]
  insist(requiredText(entry.ingestionId, 200) && requiredText(entry.fileAssetId, 200)
    && Number.isSafeInteger(entry.revision) && entry.revision >= 1
    && SHA256.test(entry.contentHash) && SHA256.test(entry.sourceVersion)
    && SHA256.test(entry.receiptHash) && entry.scope?.tenantId === tenantId
    && entry.scope?.businessId === businessId && jsonHash(entry.scope) === jsonHash(manifest.scope)
    && requiredText(entry.snapshotId, 500) && requiredText(entry.generation, 500)
    && requiredText(entry.executionRunId, 200) && requiredText(entry.rawArtifactId, 500)
    && requiredText(entry.parsedArtifactId, 500) && requiredText(entry.title, 500))
  return entry
}

function validateLiveScope({ business, account, product, input }) {
  insist(product?.productMaster?.id===product?.productMasterId
    && product.productMaster.tenantId===input.tenantId && product.productMaster.businessId===input.businessId
    && product.productMaster.status==='ACTIVE' && product.productMaster.nature==='GOOD')
  insist(business && business.id === input.businessId && business.tenantId === input.tenantId
    && business.status === 'ACTIVE')
  insist(account && account.id === input.accountId && account.tenantId === input.tenantId
    && account.businessId === input.businessId && account.status === 'CONNECTED'
    && account.transportMode === 'CLOUD' && account.archivedAt == null)
  insist(product && product.id === input.productId && product.tenantId === input.tenantId
    && product.businessId === input.businessId && product.status === 'ACTIVE'
    && product.archivedAt == null && product.itemKind !== 'CUSTOM_COMPONENT'
    && product.dedicatedCustomerId == null && product.dedicatedSalesOrderId == null
    && requiredText(product.code, 200) && requiredText(product.unit, 100))
}

function validateSourceAndIngestion({ source, ingestion, entry, manifest, asset, input }) {
  insist(source && source.id === input.sourceId && source.corpusId === manifest.corpusId
    && source.kind === 'FILE' && source.title === entry.title && source.fileAssetId === entry.fileAssetId
    && source.activeIngestionId === entry.ingestionId && source.desiredRevision === entry.revision
    && source.revokedAt == null && source.deletedAt == null && Number.isSafeInteger(source.version))
  insist(ingestion && ingestion.id === entry.ingestionId && ingestion.corpusId === manifest.corpusId
    && ingestion.sourceId === source.id && ingestion.status === 'PUBLISHED'
    && ingestion.revision === entry.revision && ingestion.sourceVersion === entry.sourceVersion
    && ingestion.contentHash === entry.contentHash && typeof ingestion.content === 'string'
    && ingestion.contentHash === hashGenesisRag17Text(ingestion.content)
    && ingestion.executionRunId === entry.executionRunId && ingestion.snapshotId === entry.snapshotId
    && ingestion.snapshotGeneration === entry.generation && ingestion.receiptHash === entry.receiptHash
    && ingestion.rawArtifactId === entry.rawArtifactId && ingestion.parsedArtifactId === entry.parsedArtifactId
    && requiredText(ingestion.sourceMetaJson, SMARTGIFT_CATALOG_MAX_FILE_BYTES))
  insist(asset && asset.id === entry.fileAssetId && asset.tenantId === input.tenantId
    && asset.businessId === input.businessId && asset.projectId == null && asset.workItemId == null
    && asset.storageKind === 'MANAGED_BLOB' && asset.mime === SMARTGIFT_CATALOG_CONTENT_TYPE
    && /^PCAT-[a-f0-9]{64}$/.test(asset.code ?? '') && requiredText(asset.name, 255)
    && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= SMARTGIFT_CATALOG_MAX_FILE_BYTES
    && SHA256.test(asset.sha256 ?? '') && asset.status === 'ACTIVE' && asset.deletedAt == null
    && Number.isSafeInteger(asset.version))

  const sourceMeta = parseSourceMeta(ingestion.sourceMetaJson)
  const descriptor = sourceMeta?.structured
  insist(sourceMeta?.kind === 'FILE' && sourceMeta.title === source.title
    && sourceMeta.sourceKey === source.sourceKey && sourceMeta.fileAssetId === asset.id
    && sourceMeta.fileAssetVersion === asset.version && sourceMeta.mime === asset.mime
    && sourceMeta.size === Buffer.byteLength(ingestion.content, 'utf8')
    && sourceMeta.storageKind === asset.storageKind && sourceMeta.sourceVersion === ingestion.sourceVersion
    && sourceMeta.contentHash === ingestion.contentHash
    && descriptor?.format === SMARTGIFT_CATALOG_FORMAT && descriptor.provider === SMARTGIFT_CATALOG_PROVIDER
    && descriptor.entityType === 'ProductMaster' && descriptor.contentType === SMARTGIFT_CATALOG_CONTENT_TYPE
    && requiredText(descriptor.externalId, 500) && Number.isSafeInteger(descriptor.recordIndex)
    && descriptor.recordIndex >= 0 && Number.isSafeInteger(descriptor.recordCount)
    && descriptor.recordCount > descriptor.recordIndex && descriptor.fileSha256 === asset.sha256
    && source.sourceKey === smartGiftSourceKey({ fileName: asset.name, recordCode: descriptor.externalId })
    && source.title === `ProductMaster ${descriptor.externalId}`
    && ingestion.sourceVersion === asset.sha256)
  return { sourceMeta, descriptor }
}

function projectValues({ fields, product, record }) {
  const commerceExternalId = `commerce-sku:${product.id}`
  const isCommerceProducer = record.externalId.startsWith('commerce-sku:')
  if (isCommerceProducer) {
    insist(record.externalId === commerceExternalId && record.code === commerceExternalId
      && requiredText(product.name) && record.nameTh === `${product.code} — ${product.name}`)
  }
  const byField = {
    sku: product.code,
    nameTh: isCommerceProducer ? product.name : record.nameTh,
    nameEn: record.nameEn ?? null,
    unit: product.unit,
    category: record.category ?? null,
    productFamily: record.productFamily ?? null,
    dimensionsCm: record.dimensionsCm ?? null,
    unitWeightKg: record.unitWeightKg ?? null,
  }
  return fields.map((field) => {
    const value = byField[field]
    if (['sku', 'nameTh', 'nameEn', 'unit', 'category', 'productFamily'].includes(field) && value !== null) {
      insist(requiredText(value))
    }
    if (field === 'dimensionsCm' && value !== null) {
      insist(value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).sort().join(',') === 'height,length,width'
        && ['height', 'length', 'width'].every((key) => typeof value[key] === 'number'
          && Number.isFinite(value[key]) && value[key] >= 0))
    }
    if (field === 'unitWeightKg' && value !== null) insist(typeof value === 'number' && Number.isFinite(value) && value >= 0)
    return { field, value: value === undefined ? null : structuredClone(value) }
  })
}

function publicBinding({ input, manifest, entry, source, ingestion, asset, descriptor, record, product, business, account, projectionSha256 }) {
  return {
    schema: 'zuri.line-product-disclosure.binding.v1',
    tenantId: input.tenantId,
    businessId: input.businessId,
    accountId: input.accountId,
    business: { id: business.id, identitySha256: jsonHash(businessIdentity(business)) },
    account: { id: account.id, version: account.version, identitySha256: jsonHash(accountIdentity(account)) },
    product: { id: product.id, version: product.version, identitySha256: jsonHash(productIdentity(product)) },
    source: {
      id: source.id,
      corpusId: source.corpusId,
      fileAssetId: source.fileAssetId,
      activeIngestionId: source.activeIngestionId,
      desiredRevision: source.desiredRevision,
      version: source.version,
      identitySha256: jsonHash(sourceIdentity(source)),
    },
    ingestion: {
      id: ingestion.id,
      sourceId: ingestion.sourceId,
      revision: ingestion.revision,
      sourceVersion: ingestion.sourceVersion,
      contentHash: ingestion.contentHash,
      status: ingestion.status,
      snapshotId: ingestion.snapshotId,
      snapshotGeneration: ingestion.snapshotGeneration,
      receiptHash: ingestion.receiptHash,
      identitySha256: jsonHash(ingestionIdentity(ingestion)),
    },
    asset: {
      id: asset.id,
      tenantId: asset.tenantId,
      businessId: asset.businessId,
      projectId: asset.projectId,
      mime: asset.mime,
      size: asset.size,
      sha256: asset.sha256,
      storageKind: asset.storageKind,
      version: asset.version,
      identitySha256: jsonHash(assetIdentity(asset)),
    },
    record: {
      entityType: 'ProductMaster',
      externalIdSha256: createHash('sha256').update(descriptor.externalId, 'utf8').digest('hex'),
      recordIndex: descriptor.recordIndex,
      recordCount: descriptor.recordCount,
      contentHash: ingestion.contentHash,
      sourceVersion: ingestion.sourceVersion,
    },
    publication: {
      corpusId: manifest.corpusId,
      corpusGeneration: manifest.corpusGeneration,
      manifestHash: manifest.manifestHash,
      entrySha256: jsonHash(entry),
    },
    projectionSha256,
    mappingSha256: jsonHash({ sourceId: source.id, productId: product.id, externalId: record.externalId }),
  }
}

async function loadRows(db, input, entry, corpusId) {
  const [business, account, product, source, ingestion, asset] = await Promise.all([
    db.business.findUnique({ where: { id: input.businessId }, select: businessSelect }),
    db.lineOaAccount.findFirst({
      where: { id: input.accountId, tenantId: input.tenantId, businessId: input.businessId, archivedAt: null },
      select: accountSelect,
    }),
    db.product.findFirst({
      where: { id: input.productId, tenantId: input.tenantId, businessId: input.businessId },
      select: productSelect,
    }),
    db.knowledgeSource.findUnique({ where: { id: input.sourceId }, select: sourceSelect }),
    db.knowledgeIngestion.findUnique({ where: { id: entry.ingestionId }, select: ingestionSelect }),
    db.fileAsset.findUnique({ where: { id: entry.fileAssetId }, select: assetSelect }),
  ])
  validateLiveScope({ business, account, product, input })
  const { sourceMeta, descriptor } = validateSourceAndIngestion({ source, ingestion, entry, manifest: { corpusId }, asset, input })
  return { business, account, product, source, ingestion, asset, sourceMeta, descriptor }
}

/** Resolve one explicitly selected Product/source pair to selected verified values. */
export async function resolveLineProductDisclosureSource(input, options = {}) {
  try {
    const fields = validateInput(input)
    const {
      db = prisma,
      env = process.env,
      readManifest = readAuthorizedKnowledgeManifest,
      fileContentResolver = resolveFileAssetContent,
    } = options
    insist(db && typeof readManifest === 'function' && typeof fileContentResolver === 'function')
    const viewer = Object.freeze({ visibleBusinessIds: Object.freeze([input.businessId]) })
    const manifest = await readManifest({ businessId: input.businessId, projectId: null }, { db, viewer, env })
    const entry = validateManifest(manifest, input)
    const loaded = await loadRows(db, input, entry, manifest.corpusId)
    const { business, account, product, source, ingestion, asset, descriptor } = loaded

    const resolved = await fileContentResolver(asset.id, { db, visibleBusinessIds: [input.businessId] })
    insist(resolved && jsonHash(assetIdentity(asset)) === jsonHash(assetIdentity(resolved.asset)))
    const bytes = Buffer.from(resolved.content)
    insist(bytes.length === asset.size && createHash('sha256').update(bytes).digest('hex') === asset.sha256)
    let content
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { throw unavailable() }
    const split = splitSmartGiftCatalogRecords({
      content, fileAssetId: asset.id, fileSha256: asset.sha256, fileName: asset.name,
    })
    insist(split.recordCount === descriptor.recordCount && descriptor.recordIndex < split.recordCount)
    const recordSplit = split.records.filter((row) => row.index === descriptor.recordIndex)
    insist(recordSplit.length === 1)
    const admitted = recordSplit[0]
    insist(admitted.entityType === 'ProductMaster' && admitted.externalId === descriptor.externalId
      && admitted.sourceKey === source.sourceKey && admitted.content === ingestion.content
      && admitted.contentHash === ingestion.contentHash
      && admitted.record.entityType === 'ProductMaster' && admitted.record.externalId === descriptor.externalId)

    const values = projectValues({ fields, product, record: admitted.record })
    const projectionSha256 = jsonHash({ schema: 'zuri.line-product-disclosure.projection.v1', values })
    const [currentManifest, currentRows] = await Promise.all([
      readManifest({ businessId: input.businessId, projectId: null }, { db, viewer, env }),
      loadRows(db, input, entry, manifest.corpusId),
    ])
    insist(sameManifest(manifest, currentManifest))
    const currentEntry = validateManifest(currentManifest, input)
    insist(jsonHash(entryIdentity(entry)) === jsonHash(entryIdentity(currentEntry)))
    for (const key of ['business', 'account', 'product', 'source', 'ingestion', 'asset']) {
      const identity = {
        business: businessIdentity,
        account: accountIdentity,
        product: productIdentity,
        source: sourceIdentity,
        ingestion: ingestionIdentity,
        asset: assetIdentity,
      }[key]
      insist(jsonHash(identity(loaded[key])) === jsonHash(identity(currentRows[key])))
    }

    return {
      values,
      binding: publicBinding({ input, manifest: currentManifest, entry: currentEntry,
        source: currentRows.source, ingestion: currentRows.ingestion, asset: currentRows.asset,
        descriptor: currentRows.descriptor, record: admitted.record, product: currentRows.product,
        business: currentRows.business, account: currentRows.account, projectionSha256 }),
      projectionSha256,
      retrievalRef: {
        sourceId: source.id,
        ingestionId: ingestion.id,
        snapshotId: entry.snapshotId,
        generation: entry.generation,
        manifestHash: currentManifest.manifestHash,
        corpusGeneration: currentManifest.corpusGeneration,
      },
    }
  } catch {
    throw unavailable()
  }
}
