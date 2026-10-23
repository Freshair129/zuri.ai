import { afterEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMainDevPublicTestKnowledgeReader } from '@/modules/agent/main-dev-public-test-knowledge'

// @req FR-079 — ordinary-chat evidence in the local profile is the pinned TEST ONLY Product projection.
// @spec ADR-100 D9, SEC-001 — exact scope, bounded local source, no live/private corpus or commercial facts.
// @tested tests/unit/main-dev-public-test-knowledge.test.js

const TENANT_ID = '26d0a24b-a2ef-44dd-8e8c-c9a0d5b3ca94'
const BUSINESS_ID = 'ad4f8f05-cc9e-41a9-9a57-0b0a84bf2f8f'
const ACCOUNT_ID = '03019679-ea52-4e6c-95ab-241e60260edd'
const PRODUCT_CODE = 'TEST-ONLY-PCAT-SKU-AD4F8F05CC9E41A99A570B0A84BF2F8F'
const OTHER_BUSINESS_ID = '11111111-1111-4111-8111-111111111111'
const temporaryDirectories = []

function fixtureRecord(overrides = {}) {
  return {
    knowledge_id: 'commerce-sku:4a0ebfcf-ab47-4622-bdc8-e9e7b8240907',
    business_id: BUSINESS_ID,
    knowledge_type: 'PRODUCT',
    product_code: PRODUCT_CODE,
    name: 'TEST ONLY PCAT fixture SKU AD4F8F05CC9E41A99A570B0A84BF2F8F',
    category: null,
    description: null,
    unit: 'EA',
    sell_price: null,
    currency: null,
    moq: null,
    colors: [],
    specification: {},
    source_ref: 'main-dev-test-pcat:fixture#commerce-sku:4a0ebfcf-ab47-4622-bdc8-e9e7b8240907',
    source_sha256: 'c2b2782415ae3ffc49885307d1a168d04a8c20e8a35297ad3c9cd0a399628842',
    as_of: '2026-10-23T15:30:03.673Z',
    approved_at: '2026-10-23T15:30:03.673Z',
    is_active: true,
    sensitivity: 'PUBLIC',
    contract_version: '1.0.0',
    ...overrides,
  }
}

function fixtureEnvelope({ scope = {}, records = [fixtureRecord()], ...overrides } = {}) {
  return {
    schemaVersion: '1.0.0',
    purpose: 'TEST_ONLY_PUBLIC',
    scope: { tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID, ...scope },
    records,
    ...overrides,
  }
}

function makeReader(rawText = JSON.stringify(fixtureEnvelope()), overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-main-dev-public-fixture-'))
  temporaryDirectories.push(directory)
  const fixturePath = path.join(directory, 'ollama-test-only-public.json')
  fs.writeFileSync(fixturePath, rawText, { encoding: 'utf8', flag: 'wx' })
  const expectedSha256 = crypto.createHash('sha256').update(rawText).digest('hex')
  const profile = {
    enabled: true,
    runtimeSource: 'MAIN_DEV_LOCAL_OLLAMA',
    testFixturePath: fixturePath,
    testFixtureSha256: expectedSha256,
    allowedTenantIds: [TENANT_ID],
    allowedBusinessIds: [BUSINESS_ID],
    allowedLineOaAccountIds: [ACCOUNT_ID],
    ...overrides,
  }
  return { profile, fixturePath }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('main-dev TEST_ONLY_PUBLIC BusinessKnowledge reader', () => {
  it('returns only the exact scoped synthetic Product metadata through registered queries', async () => {
    const { profile } = makeReader()
    const reader = createMainDevPublicTestKnowledgeReader({
      profile, tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID,
    })

    const result = await reader.query({
      tenantId: TENANT_ID, businessId: BUSINESS_ID, queryId: 'product_search',
      params: { term: PRODUCT_CODE }, limit: 5,
    })

    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      product_code: PRODUCT_CODE, knowledge_type: 'PRODUCT', sell_price: null,
      currency: null, moq: null, unit: 'EA', colors: [], specification: {},
    })
  })

  it('rejects bytes over 64 KiB before attempting JSON parsing', async () => {
    const { profile } = makeReader('{'.repeat(64 * 1024 + 1))
    const reader = createMainDevPublicTestKnowledgeReader({
      profile, tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID,
    })

    await expect(reader.query({
      tenantId: TENANT_ID, businessId: BUSINESS_ID, queryId: 'product_search', params: { term: 'TEST-ONLY' },
    })).rejects.toThrow('MAIN_DEV_LOCAL_OLLAMA_FIXTURE_TOO_LARGE')
  })

  it.each([
    ['wrong expected hash', (profile) => ({ ...profile, testFixtureSha256: '0'.repeat(64) }), /FIXTURE_HASH_MISMATCH/],
    ['wrong tenant scope', (profile) => profile, /FIXTURE_SCOPE_MISMATCH/],
  ])('fails closed for %s', async (label, changeProfile, errorPattern) => {
    const envelope = label === 'wrong tenant scope'
      ? fixtureEnvelope({ scope: { tenantId: OTHER_BUSINESS_ID } })
      : fixtureEnvelope()
    const { profile } = makeReader(JSON.stringify(envelope))
    const reader = createMainDevPublicTestKnowledgeReader({
      profile: changeProfile(profile), tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID,
    })

    await expect(reader.query({
      tenantId: TENANT_ID, businessId: BUSINESS_ID, queryId: 'product_search', params: { term: 'TEST-ONLY' },
    })).rejects.toThrow(errorPattern)
  })

  it.each([
    ['wrong purpose', fixtureEnvelope({ purpose: 'PUBLIC' }), /FIXTURE_INVALID/],
    ['non-test product code', fixtureEnvelope({ records: [fixtureRecord({ product_code: 'REAL-SKU-1' })] }), /FIXTURE_INVALID/],
    ['commercial price', fixtureEnvelope({ records: [fixtureRecord({ sell_price: 12.34, currency: 'THB' })] }), /FIXTURE_INVALID/],
    ['stock field', fixtureEnvelope({ records: [fixtureRecord({ stock_quantity: 5 })] }), /FIXTURE_INVALID/],
  ])('rejects %s from the fixture', async (_label, envelope, errorPattern) => {
    const { profile } = makeReader(JSON.stringify(envelope))
    const reader = createMainDevPublicTestKnowledgeReader({
      profile, tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID,
    })

    await expect(reader.query({
      tenantId: TENANT_ID, businessId: BUSINESS_ID, queryId: 'product_search', params: { term: 'TEST-ONLY' },
    })).rejects.toThrow(errorPattern)
  })

  it('enforces the eight-record cap after hash verification and JSON parsing', async () => {
    const records = Array.from({ length: 9 }, (_, index) => fixtureRecord({
      knowledge_id: `commerce-sku:test-${index}`,
      product_code: `TEST-ONLY-SKU-${index}`,
    }))
    const { profile } = makeReader(JSON.stringify(fixtureEnvelope({ records })))
    const reader = createMainDevPublicTestKnowledgeReader({
      profile, tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID,
    })

    await expect(reader.query({
      tenantId: TENANT_ID, businessId: BUSINESS_ID, queryId: 'product_search', params: { term: 'TEST-ONLY' },
    })).rejects.toThrow('MAIN_DEV_LOCAL_OLLAMA_FIXTURE_INVALID')
  })

  it('refuses query scope changes and unregistered query IDs', async () => {
    const { profile } = makeReader()
    const reader = createMainDevPublicTestKnowledgeReader({
      profile, tenantId: TENANT_ID, businessId: BUSINESS_ID, accountId: ACCOUNT_ID,
    })

    await expect(reader.query({
      tenantId: TENANT_ID, businessId: OTHER_BUSINESS_ID, queryId: 'product_search', params: { term: 'TEST-ONLY' },
    })).rejects.toThrow('MAIN_DEV_LOCAL_OLLAMA_SCOPE_DENIED')
    await expect(reader.query({
      tenantId: TENANT_ID, businessId: BUSINESS_ID, queryId: 'arbitrary_sql', params: {},
    })).rejects.toThrow()
  })
})
