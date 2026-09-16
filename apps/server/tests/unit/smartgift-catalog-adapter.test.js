// @req FR-187 — the SmartGift structured-record adapter splits one frozen
// projection into N immutable records with byte-stable identity, hashes and
// per-record deny decisions, and never synthesizes a pipeline stage result.
// @spec ADR-075 D2, ADR-075 D3, ADR-075 D4, ADR-075 D5, BR-002
// @tested tests/unit/smartgift-catalog-adapter.test.js
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalGenesisRag17Json, hashGenesisRag17Text } from '@/modules/knowledge/genesisrag17-contract'
import {
  parseSmartGiftCatalogFile,
  smartGiftRecordIdempotencySeed,
  smartGiftSourceKey,
  SMARTGIFT_CATALOG_ENTITY_TYPES,
  SMARTGIFT_CATALOG_FORMAT,
  SMARTGIFT_CATALOG_MAX_FILE_BYTES,
  SMARTGIFT_CATALOG_PROVIDER,
  splitSmartGiftCatalogRecords,
} from '@/modules/knowledge/smartgift-catalog-adapter'

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/genesisrag17/smartgift-catalog',
)
const read = (name) => readFileSync(path.join(fixtureDir, name), 'utf8')
const manifest = JSON.parse(read('manifest.json'))

function split(name, over = {}) {
  return splitSmartGiftCatalogRecords({
    content: read(name),
    fileAssetId: 'file-smartgift-1',
    fileSha256: 'a'.repeat(64),
    fileName: name,
    ...over,
  })
}

describe('SmartGift catalog adapter', () => {
  it('declares the Phase 1 surface constants', () => {
    expect(SMARTGIFT_CATALOG_FORMAT).toBe('SMARTGIFT_CATALOG_V1')
    expect(SMARTGIFT_CATALOG_PROVIDER).toBe('SMARTGIFT_CATALOG')
    expect(SMARTGIFT_CATALOG_ENTITY_TYPES).toEqual(['ProductMaster', 'BundleOffer', 'PriceListEntry'])
    // A file-level bound distinct from the 1 MiB per-record limit; upstream's
    // real pricelist_master.json is ~6.4 MB.
    expect(SMARTGIFT_CATALOG_MAX_FILE_BYTES).toBe(16 * 1024 * 1024)
  })

  it.each([
    ['products.json', 5, 'ProductMaster'],
    ['bundles.json', 2, 'BundleOffer'],
    ['pricelist.json', 15, 'PriceListEntry'],
  ])('splits %s into the record count its manifest declares', (name, expected, entityType) => {
    const manifestEntry = manifest.files.find((file) => file.file === name)
    expect(manifestEntry.recordCount).toBe(expected)

    const result = split(name)
    expect(result.recordCount).toBe(expected)
    expect(result.records).toHaveLength(expected)
    expect(result.denied).toEqual([])
    expect(new Set(result.records.map((record) => record.entityType))).toEqual(new Set([entityType]))
  })

  it('derives byte-stable identity, hashes and per-record idempotency seeds', () => {
    const result = split('products.json')
    const first = result.records[0]
    expect(first.sourceKey).toBe('smartgift-catalog:products.json#PM-BOTTLE-LED')
    expect(first.sourceKey).toBe(smartGiftSourceKey({ fileName: 'products.json', recordCode: 'PM-BOTTLE-LED' }))
    // ADR-075 D3 — the file-level registry hash is every record's version.
    expect(result.records.every((record) => record.version === 'a'.repeat(64))).toBe(true)
    expect(first.content).toBe(canonicalGenesisRag17Json(first.record))
    expect(first.contentHash).toBe(hashGenesisRag17Text(first.content))
    expect(first.idempotencySeed).toBe(smartGiftRecordIdempotencySeed({
      fileAssetId: 'file-smartgift-1',
      fileSha256: 'a'.repeat(64),
      externalId: 'PM-BOTTLE-LED',
    }))
    expect(new Set(result.records.map((record) => record.sourceKey)).size).toBe(result.records.length)
  })

  it('is deterministic for identical bytes and differs for a changed record', () => {
    const first = split('products.json')
    const second = split('products.json')
    expect(second.records.map((record) => record.contentHash)).toEqual(first.records.map((record) => record.contentHash))
    expect(second.records.map((record) => record.idempotencySeed)).toEqual(first.records.map((record) => record.idempotencySeed))

    const rows = JSON.parse(read('products.json'))
    rows[0].srpPriceThbQty1 = 999
    const mutated = splitSmartGiftCatalogRecords({
      content: JSON.stringify(rows),
      fileAssetId: 'file-smartgift-1',
      fileSha256: 'b'.repeat(64),
      fileName: 'products.json',
    })
    expect(mutated.records[0].contentHash).not.toBe(first.records[0].contentHash)
    // The record key is stable across the change; only the content hash and the
    // file-derived version move, which is what makes Stage 6 see a new version
    // of the same record rather than a different record.
    expect(mutated.records[0].sourceKey).toBe(first.records[0].sourceKey)
    expect(mutated.records[0].idempotencySeed).not.toBe(first.records[0].idempotencySeed)
  })

  it('carries the FlowAccount code as an attribute, never as the record key', () => {
    const product = split('products.json').records.find((record) => record.externalId === 'PM-TMB')
    expect(product.record.flowaccountModelCode).toBe('BW00-0')
    expect(product.sourceKey).not.toContain('BW00-0')
    expect(product.externalId).toBe('PM-TMB')
  })

  it('denies a customer-shaped record per record, leaving its siblings admissible', () => {
    const rows = JSON.parse(read('products.json'))
    rows[1] = { ...rows[1], provenance: { ...rows[1].provenance, upstreamFile: 'data-pipeline/01_raw/05_crm_customer_data/export.json' } }
    const result = splitSmartGiftCatalogRecords({
      content: JSON.stringify(rows),
      fileAssetId: 'file-smartgift-1',
      fileSha256: 'c'.repeat(64),
      fileName: 'products.json',
    })
    expect(result.recordCount).toBe(5)
    expect(result.records).toHaveLength(4)
    expect(result.denied).toEqual([
      { index: 1, externalId: 'PM-NB', entityType: 'ProductMaster', field: 'record.provenance.upstreamFile', term: '05_crm_customer_data' },
    ])
    expect(result.records.map((record) => record.externalId)).not.toContain('PM-NB')
  })

  it('refuses a file that is not a JSON array of known record shapes', () => {
    expect(() => parseSmartGiftCatalogFile('not json')).toThrow(expect.objectContaining({ status: 422, code: 'KNOWLEDGE_STRUCTURED_FORMAT_INVALID' }))
    expect(() => parseSmartGiftCatalogFile('{"entityType":"ProductMaster"}')).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_STRUCTURED_FORMAT_INVALID' }))
    expect(() => parseSmartGiftCatalogFile('[]')).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_STRUCTURED_RECORD_INVALID' }))
    expect(() => parseSmartGiftCatalogFile('[{"entityType":"CustomerOrder"}]')).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_STRUCTURED_RECORD_INVALID' }))
    // Strict shapes: an unexpected upstream field must be declared before it can
    // ride along, so a stripped cost column cannot reappear unnoticed.
    const rows = JSON.parse(read('products.json'))
    rows[0].base_cost = 120
    expect(() => parseSmartGiftCatalogFile(JSON.stringify(rows))).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_STRUCTURED_RECORD_INVALID' }))
  })

  it('refuses a repeated record identity inside one file', () => {
    const rows = JSON.parse(read('products.json'))
    rows.push(rows[0])
    expect(() => splitSmartGiftCatalogRecords({
      content: JSON.stringify(rows),
      fileAssetId: 'file-smartgift-1',
      fileSha256: 'd'.repeat(64),
      fileName: 'products.json',
    })).toThrow(expect.objectContaining({ status: 422, code: 'KNOWLEDGE_STRUCTURED_RECORD_DUPLICATE' }))
  })

  it('enforces the per-record byte limit after splitting', () => {
    expect(() => split('products.json', { maxRecordBytes: 200 }))
      .toThrow(expect.objectContaining({ status: 413, code: 'KNOWLEDGE_CONTENT_TOO_LARGE' }))
    expect(() => split('products.json', { maxRecordBytes: 1024 * 1024 })).not.toThrow()
  })

  it('requires the frozen file identity it derives record identity from', () => {
    expect(() => split('products.json', { fileAssetId: '' })).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_STRUCTURED_SOURCE_INVALID' }))
    expect(() => split('products.json', { fileSha256: '' })).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_STRUCTURED_SOURCE_INVALID' }))
    expect(() => split('products.json', { fileName: '' })).toThrow(expect.objectContaining({ code: 'KNOWLEDGE_STRUCTURED_SOURCE_INVALID' }))
  })
})
