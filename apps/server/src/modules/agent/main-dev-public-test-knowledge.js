import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  createInMemoryBusinessKnowledgeReader,
  normalizeBusinessKnowledgeRecord,
} from '@/modules/knowledge'
import { MAIN_DEV_LOCAL_OLLAMA_SOURCE } from './main-dev-local-ollama'

// @req FR-079 — the main-dev local profile answers only from its pinned TEST ONLY Product projection.
// @spec ADR-100 D9, SEC-001 — exact scope and digest, no live/private corpus or commercial facts.
// @tested tests/unit/main-dev-public-test-knowledge.test.js

const MAX_FIXTURE_BYTES = 64 * 1024
const MAX_FIXTURE_RECORDS = 8
const EXPECTED_PURPOSE = 'TEST_ONLY_PUBLIC'
const EXPECTED_SCHEMA_VERSION = '1.0.0'
const EXPECTED_FIXTURE_SHA256 = /^[a-f0-9]{64}$/

function fail(suffix) {
  const error = new Error(`MAIN_DEV_LOCAL_OLLAMA_${suffix}`)
  error.code = `MAIN_DEV_LOCAL_OLLAMA_${suffix}`
  return error
}

function isUncOrNetworkPath(value) {
  return /^(?:\\\\|\/\/)/.test(value) || /^\\\\\?\\UNC\\/i.test(value)
}

function validateFixturePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || isUncOrNetworkPath(value)) {
    throw fail('FIXTURE_PATH_INVALID')
  }
  if (!path.isAbsolute(value) || path.normalize(value) !== value) throw fail('FIXTURE_PATH_INVALID')

  const root = path.parse(value).root
  const components = value.slice(root.length).split(path.sep).filter(Boolean)
  let current = root
  try {
    const rootStat = fs.lstatSync(root)
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw fail('FIXTURE_PATH_INVALID')
    for (let index = 0; index < components.length; index += 1) {
      current = path.join(current, components[index])
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink()) throw fail('FIXTURE_PATH_INVALID')
      if (index < components.length - 1 && !stat.isDirectory()) throw fail('FIXTURE_PATH_INVALID')
      if (index === components.length - 1 && !stat.isFile()) throw fail('FIXTURE_PATH_INVALID')
    }
  } catch (error) {
    if (error?.code === 'MAIN_DEV_LOCAL_OLLAMA_FIXTURE_PATH_INVALID') throw error
    throw fail('FIXTURE_PATH_INVALID')
  }
  if (components.length === 0) throw fail('FIXTURE_PATH_INVALID')
  return value
}

function readBoundedFixtureBytes(filePath) {
  validateFixturePath(filePath)
  const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0
  let descriptor
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow)
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size > MAX_FIXTURE_BYTES) throw fail('FIXTURE_TOO_LARGE')

    // Check size before allocating; the one-byte sentinel detects growth after fstat.
    const bytes = Buffer.allocUnsafe(stat.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count === 0) break
      offset += count
      if (offset > MAX_FIXTURE_BYTES) throw fail('FIXTURE_TOO_LARGE')
    }
    if (offset !== stat.size) throw fail('FIXTURE_CHANGED_DURING_READ')
    return Buffer.from(bytes.subarray(0, offset))
  } catch (error) {
    if (typeof error?.code === 'string' && error.code.startsWith('MAIN_DEV_LOCAL_OLLAMA_')) throw error
    throw fail('FIXTURE_SOURCE_UNAVAILABLE')
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor) } catch {}
    }
  }
}

function parseFixture(rawBytes, { expectedSha256, tenantId, businessId, accountId }) {
  if (typeof expectedSha256 !== 'string' || !EXPECTED_FIXTURE_SHA256.test(expectedSha256)) {
    throw fail('FIXTURE_CONFIGURATION_INVALID')
  }

  const actualSha256 = crypto.createHash('sha256').update(rawBytes).digest('hex')
  if (actualSha256 !== expectedSha256) throw fail('FIXTURE_HASH_MISMATCH')

  let envelope
  try {
    envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBytes))
  } catch {
    throw fail('FIXTURE_INVALID')
  }

  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
    || Object.keys(envelope).sort().join(',') !== 'purpose,records,schemaVersion,scope'
    || envelope.schemaVersion !== EXPECTED_SCHEMA_VERSION
    || envelope.purpose !== EXPECTED_PURPOSE
    || !Array.isArray(envelope.records)
    || envelope.records.length < 1
    || envelope.records.length > MAX_FIXTURE_RECORDS) throw fail('FIXTURE_INVALID')
  if (!envelope.scope || typeof envelope.scope !== 'object' || Array.isArray(envelope.scope)
    || Object.keys(envelope.scope).sort().join(',') !== 'accountId,businessId,tenantId'
    || envelope.scope.tenantId !== tenantId
    || envelope.scope.businessId !== businessId
    || envelope.scope.accountId !== accountId) throw fail('FIXTURE_SCOPE_MISMATCH')

  let records
  try {
    records = envelope.records.map((input) => normalizeBusinessKnowledgeRecord(input))
  } catch {
    throw fail('FIXTURE_INVALID')
  }

  const productCodes = new Set()
  const knowledgeIds = new Set()
  for (const record of records) {
    if (record.business_id !== businessId
      || record.knowledge_type !== 'PRODUCT'
      || !record.product_code.startsWith('TEST-ONLY-')
      || record.is_active !== true
      || record.sensitivity !== 'PUBLIC'
      || record.sell_price !== null
      || record.currency !== null
      || record.moq !== null
      || productCodes.has(record.product_code)
      || knowledgeIds.has(record.knowledge_id)) {
      throw fail('FIXTURE_INVALID')
    }
    productCodes.add(record.product_code)
    knowledgeIds.add(record.knowledge_id)
  }

  return records
}

function assertReaderScope(profile, tenantId, businessId, accountId) {
  if (!profile?.enabled || profile.runtimeSource !== MAIN_DEV_LOCAL_OLLAMA_SOURCE) {
    throw fail('PROFILE_DISABLED')
  }
  if (!profile.allowedTenantIds?.includes(tenantId)
    || !profile.allowedBusinessIds?.includes(businessId)
    || !profile.allowedLineOaAccountIds?.includes(accountId)) {
    throw fail('SCOPE_DENIED')
  }
}

/**
 * Lazily read and pin the private main-dev fixture. The returned reader exposes
 * only the existing registered BusinessKnowledge query contract.
 */
export function createMainDevPublicTestKnowledgeReader({
  profile,
  tenantId,
  businessId,
  accountId,
} = {}) {
  assertReaderScope(profile, tenantId, businessId, accountId)
  let readerPromise

  return Object.freeze({
    async query(input) {
      assertReaderScope(profile, tenantId, businessId, accountId)
      if (input?.tenantId !== undefined && input.tenantId !== tenantId) throw fail('SCOPE_DENIED')
      if (input?.businessId !== businessId) throw fail('SCOPE_DENIED')
      if (!readerPromise) {
        readerPromise = Promise.resolve().then(() => {
          const rawBytes = readBoundedFixtureBytes(profile.testFixturePath)
          const records = parseFixture(rawBytes, {
            expectedSha256: profile.testFixtureSha256,
            tenantId,
            businessId,
            accountId,
          })
          return createInMemoryBusinessKnowledgeReader(records)
        })
      }
      const reader = await readerPromise
      return reader.query(input)
    },
  })
}
