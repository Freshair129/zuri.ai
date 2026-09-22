// @req FR-252 — process-only protected recovery and complete-family export.
// @spec docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/integration/phase-b-recovery.test.js

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'
import {
  PHASE_B_ERROR_CODES,
  PHASE_B_FAMILY_DELEGATES,
  PHASE_B_FAMILY_MODEL_NAMES,
  PHASE_B_RECOVERY_MANIFEST_VERSION,
  PhaseBRecoveryError,
  computeSnapshotSha256,
  normalizePhaseBSchemaInventory,
  validatePhaseBSnapshot,
} from '../src/modules/project-manager/application/phase-b-backup.js'

const { Pool } = pg
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_INVENTORY_PATH = path.resolve(THIS_DIR, '../../../docs/architecture/project-manager-system/contracts/phase-b/target-schema.inventory.json')
const DEFAULT_SCHEMA_PATH = path.resolve(THIS_DIR, '../prisma/schema.prisma')
const MIGRATION_TABLES = new Set(['_prisma_migrations', 'schema_migrations'])
const FROZEN_SCHEMA_SHA256 = '5167f82e334c25d39657c732fcdd2b32f1020e0b28037bd63160085f01309200'
const FROZEN_TARGET_SCHEMA_SHA256 = '4bed3ff2382a0a1ea75906c14eb6f01a5ea61eb4bd5570179fb44a074c301a53'
const FROZEN_APPLICATION_TABLE_COUNT = 184

function ordinalCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function absolutePath(value, flag) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `${flag} must be an absolute path`)
  return path.normalize(value)
}

function parseTimestampWithoutTimeZoneAsUtc(value) {
  const match = /^(\d{1,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(String(value))
  if (!match) return new Date(value)
  const [, year, month, day, hour, minute, second, fraction = ''] = match
  const milliseconds = Number(`0.${fraction.slice(0, 3).padEnd(3, '0')}`) * 1000
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), milliseconds))
  if (Number(year) >= 0 && Number(year) < 100) date.setUTCFullYear(Number(year))
  return date
}

function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'Frozen inventory contains an unsafe identifier')
  return `"${value.replaceAll('"', '""')}"`
}

function tableName(entry) {
  return `${identifier(entry.schemaName)}.${identifier(entry.tableName)}`
}

function findInventoryEntry(inventory, model) {
  return inventory.applicationTables.find((entry) => entry.modelName === model
    || entry.modelName[0].toLowerCase() + entry.modelName.slice(1) === model)
}

function normalizeInventory(inventory) {
  const result = normalizePhaseBSchemaInventory(inventory)
  if (!result.valid) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'Frozen application table inventory is invalid')
  const normalized = result.inventory
  const modelNames = new Set()
  const tableNames = new Set()
  const pinned = normalized.schemaSha256 === FROZEN_SCHEMA_SHA256
    && normalized.targetSchemaSha256 === FROZEN_TARGET_SCHEMA_SHA256
    && normalized.applicationTables.length === FROZEN_APPLICATION_TABLE_COUNT
  if (pinned) {
    for (const entry of normalized.applicationTables) {
      if (entry.schemaName !== 'public' || entry.tableName !== entry.modelName
        || modelNames.has(entry.modelName) || tableNames.has(entry.tableName)) {
        throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'Frozen application table inventory is not the approved public model mapping')
      }
      modelNames.add(entry.modelName)
      tableNames.add(entry.tableName)
    }
  }
  if (!pinned || modelNames.size !== FROZEN_APPLICATION_TABLE_COUNT || tableNames.size !== FROZEN_APPLICATION_TABLE_COUNT) {
    throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'Frozen application table inventory is not the approved 184-table inventory')
  }
  return normalized
}

function inventorySet(inventory) {
  return new Set(inventory.applicationTables.map((entry) => `${entry.schemaName}\u0000${entry.tableName}`))
}

function incomingCount(snapshot, descriptor) {
  const delegate = PHASE_B_FAMILY_DELEGATES[PHASE_B_FAMILY_MODEL_NAMES.indexOf(descriptor.modelName)]
  const tables = snapshot?.tables
  if (!tables || typeof tables !== 'object') return 0
  const camelName = descriptor.modelName[0].toLowerCase() + descriptor.modelName.slice(1)
  const keys = [...new Set([descriptor.modelName, camelName, delegate].filter(Boolean))]
  const present = keys.filter((key) => Object.prototype.hasOwnProperty.call(tables, key))
  if (present.length !== 1 || !Array.isArray(tables[present[0]])) return 0
  const rows = tables[present[0]]
  return rows?.length ?? 0
}

function incomingCounts(snapshot, inventory) {
  return Object.fromEntries(inventory.applicationTables.map((entry) => [entry.modelName, incomingCount(snapshot, entry)]))
}

function normalizeIncludedModels(includedModels, inventory, excludedModels) {
  if (!Array.isArray(includedModels) || includedModels.length === 0) return null
  const names = []
  const seen = new Set()
  for (const value of includedModels) {
    if (typeof value !== 'string') return null
    const entry = findInventoryEntry(inventory, value)
    if (!entry) return null
    if (seen.has(entry.modelName)) return null
    seen.add(entry.modelName)
    names.push(entry.modelName)
  }
  const required = PHASE_B_FAMILY_MODEL_NAMES.every((name) => seen.has(name))
  if (!required) return null
  if (Array.isArray(excludedModels)) {
    const excluded = []
    const excludedSeen = new Set()
    for (const value of excludedModels) {
      if (typeof value !== 'string') return null
      const entry = findInventoryEntry(inventory, value)
      if (!entry || seen.has(entry.modelName) || excludedSeen.has(entry.modelName)) return null
      excludedSeen.add(entry.modelName)
      excluded.push(entry.modelName)
    }
    const allNames = [...seen, ...excluded].sort(ordinalCompare)
    if (JSON.stringify(allNames) !== JSON.stringify(countKeys(inventory))) return null
  } else return null
  return names.sort(ordinalCompare)
}

function reconcileIncludedModelCounts(snapshot, includedModels, excludedModels, inventory, targetCounts) {
  const modelNames = normalizeIncludedModels(includedModels, inventory, excludedModels)
  if (!modelNames || !completeCounts(targetCounts, inventory)) {
    throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE, 'Protected export did not provide a complete included-model contract')
  }
  const incoming = {}
  for (const modelName of modelNames) {
    const descriptor = inventory.applicationTables.find((entry) => entry.modelName === modelName)
    const tables = snapshot?.tables
    const camelName = modelName[0].toLowerCase() + modelName.slice(1)
    const keys = [...new Set([modelName, camelName].filter(Boolean))]
    const present = keys.filter((key) => Object.prototype.hasOwnProperty.call(tables || {}, key))
    if (present.length !== 1 || !Array.isArray(tables[present[0]])) {
      throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE, `Protected export is missing the included ${modelName} array`)
    }
    incoming[modelName] = tables[present[0]].length
    if (incoming[modelName] !== targetCounts[modelName]) {
      throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE, `Protected export count did not reconcile for ${modelName}`)
    }
  }
  return { modelNames, incoming }
}

function countKeys(inventory) {
  return (inventory?.applicationTables || []).map((entry) => entry.modelName).sort(ordinalCompare)
}

function completeCounts(counts, inventory) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return false
  const expected = countKeys(inventory)
  const actual = Object.keys(counts).sort(ordinalCompare)
  return expected.length > 0
    && JSON.stringify(expected) === JSON.stringify(actual)
    && expected.every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0)
}

function allZero(counts, inventory) {
  return completeCounts(counts, inventory) && Object.values(counts).every((value) => value === 0)
}

function countsEqual(expected, actual) {
  const keys = new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})])
  return [...keys].every((key) => Number(expected?.[key] ?? 0) === Number(actual?.[key] ?? 0))
}

function comparable(value) {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(comparable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, comparable(value[key])]))
  return value
}

function comparableJson(value) {
  return JSON.stringify(comparable(value))
}

function redactedResult({ status, errorCode = null, snapshotSha256 = null, targetSchemaSha256 = null, schemaVisibility = 'UNVERIFIED', applicationTableCount = null, targetCounts = null, incomingCounts = null, insertedCounts = null, outputPath = null }) {
  return { status, errorCode, snapshotSha256, targetSchemaSha256, schemaVisibility, applicationTableCount, targetCounts, incomingCounts, insertedCounts, outputPath }
}

/**
 * Small Prisma-shaped read facade for the composed backup extractor. The
 * source service already owns SNAPSHOT_MODELS, manifest/redaction rules and
 * dependency order; this facade only lets it read through the same pg
 * transaction that established the maintenance visibility proof.
 */
export function createPrismaTransactionFacade(tx, inventory) {
  const normalized = normalizeInventory(inventory)
  const byDelegate = new Map(normalized.applicationTables.map((entry) => [entry.modelName[0].toLowerCase() + entry.modelName.slice(1), entry]))
  const target = {
    _activeProvider: 'postgresql',
    async $queryRawUnsafe(sql, ...params) {
      const result = await tx.client.query(sql, params)
      return result.rows
    },
    async $executeRawUnsafe(sql, ...params) {
      const result = await tx.client.query(sql, params)
      return result.rowCount
    },
  }
  return new Proxy(target, {
    get(object, property, receiver) {
      if (Reflect.has(object, property)) return Reflect.get(object, property, receiver)
      const entry = byDelegate.get(String(property))
      if (!entry) return undefined
      return {
        async findMany() { return tx.readRows(entry.modelName) },
        async count() {
          const counts = await tx.countAllApplicationTables()
          return counts[entry.modelName] ?? 0
        },
      }
    },
  })
}

export async function loadFrozenSchemaInventory({ modulePath = DEFAULT_INVENTORY_PATH, schemaPath = DEFAULT_SCHEMA_PATH } = {}) {
  const selected = absolutePath(modulePath, 'inventory path')
  try {
    let inventory
    if (selected.toLowerCase().endsWith('.json')) inventory = JSON.parse(await readFile(selected, 'utf8'))
    else {
      const module = await import(pathToFileURL(selected).href)
      inventory = module.PHASE_B_SCHEMA_INVENTORY || module.default || null
    }
    if (!inventory) return null
    const schemaBytes = await readFile(absolutePath(schemaPath, 'schema path'))
    const schemaSha256 = createHash('sha256').update(schemaBytes).digest('hex')
    const normalized = normalizeInventory(inventory)
    if (schemaSha256 !== FROZEN_SCHEMA_SHA256 || inventory.schemaSha256 !== schemaSha256
      || normalized.targetSchemaSha256 !== FROZEN_TARGET_SCHEMA_SHA256
      || normalized.applicationTables.length !== FROZEN_APPLICATION_TABLE_COUNT
      || normalized.applicationTables.some((entry) => entry.schemaName !== 'public' || entry.tableName !== entry.modelName)) return null
    const declaredModels = [...schemaBytes.toString('utf8').matchAll(/^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm)]
      .map((match) => match[1])
      .sort(ordinalCompare)
    const inventoryModels = normalized.applicationTables.map((entry) => entry.modelName).sort(ordinalCompare)
    if (declaredModels.length !== FROZEN_APPLICATION_TABLE_COUNT
      || JSON.stringify(declaredModels) !== JSON.stringify(inventoryModels)) return null
    return normalized
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND') return null
    throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'Frozen application table inventory could not be loaded')
  }
}

export async function parseSnapshotBytes(snapshotBytes) {
  const bytes = Buffer.isBuffer(snapshotBytes) ? snapshotBytes : Buffer.from(snapshotBytes)
  try {
    return { bytes, snapshot: JSON.parse(bytes.toString('utf8')) }
  } catch {
    throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, 'Snapshot is not valid JSON')
  }
}

export function createPostgresRecoveryAdapter({ connectionString, inventory, lockTimeoutMs = 5000, poolOptions = {} } = {}) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_CONNECTION_UNAVAILABLE, 'Recovery connection is unavailable')
  const normalizedInventory = normalizeInventory(inventory)
  const types = new pg.TypeOverrides()
  types.setTypeParser(1114, parseTimestampWithoutTimeZoneAsUtc)
  const pool = new Pool({ connectionString, max: 1, types, ...poolOptions })
  let closed = false
  return {
    inventory: normalizedInventory,
    async begin({ readOnly = false } = {}) {
      if (closed) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_CONNECTION_UNAVAILABLE, 'Recovery connection is closed')
      let client
      try {
        client = await pool.connect()
        await client.query(`BEGIN ISOLATION LEVEL REPEATABLE READ${readOnly ? ' READ ONLY' : ''}`)
      } catch {
        client?.release()
        throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_CONNECTION_UNAVAILABLE, 'Recovery connection could not begin a transaction')
      }
      let finished = false
      const tx = {
        client,
        async setRowSecurityOff() {
          try {
            await client.query('SET LOCAL row_security = off')
          } catch {
            throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_EMPTY_UNVERIFIED, 'Complete target visibility could not be established')
          }
        },
        async reconcileCatalog() {
          const schemas = [...new Set(normalizedInventory.applicationTables.map((entry) => entry.schemaName))]
          let rows
          try {
            const result = await client.query(
              `SELECT n.nspname AS "schemaName", c.relname AS "tableName"
                 FROM pg_catalog.pg_class c
                 JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = ANY($1::text[])
                  AND c.relkind IN ('r', 'p')`,
              [schemas],
            )
            rows = result.rows
          } catch {
            throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'PostgreSQL application table catalog could not be read')
          }
          const expected = inventorySet(normalizedInventory)
          const actual = new Set(rows.map((row) => `${row.schemaName}\u0000${row.tableName}`))
          // Migration bookkeeping is explicitly allowed only in the frozen
          // public schema.  Compare schema-qualified keys so an unrelated
          // table with the same name in another schema cannot bypass catalog
          // reconciliation.
          const allowed = new Set([...MIGRATION_TABLES, ...(normalizedInventory.migrationTables || [])]
            .map((name) => `public\u0000${name}`))
          const missing = [...expected].filter((key) => !actual.has(key))
          const unexpected = [...actual].filter((key) => !expected.has(key) && !allowed.has(key))
          if (missing.length || unexpected.length) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, 'PostgreSQL catalog does not match the frozen application table inventory')
          return { expectedCount: expected.size, catalogCount: actual.size - [...actual].filter((key) => allowed.has(key)).length }
        },
        async assertPrivileges({ write = false } = {}) {
          for (const entry of normalizedInventory.applicationTables) {
            try {
              const privileges = await client.query(
                'SELECT has_table_privilege(current_user, $1, \'SELECT\') AS "canSelect", has_table_privilege(current_user, $1, \'INSERT\') AS "canInsert"',
                [tableName(entry)],
              )
              const row = privileges.rows[0]
              if (!row?.canSelect || (write && !row.canInsert)) throw new Error('missing privilege')
            } catch {
              throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_PRIVILEGE_UNAVAILABLE, 'Recovery connection lacks the required table privileges')
            }
          }
        },
        async lockApplicationTables() {
          try {
            await client.query(`SET LOCAL lock_timeout = '${Math.max(1, Math.floor(lockTimeoutMs))}ms'`)
            const ordered = [...normalizedInventory.applicationTables].sort((a, b) => ordinalCompare(a.schemaName, b.schemaName) || ordinalCompare(a.tableName, b.tableName))
            for (const entry of ordered) await client.query(`LOCK TABLE ${tableName(entry)} IN SHARE ROW EXCLUSIVE MODE`)
          } catch {
            throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_LOCK_UNAVAILABLE, 'Recovery connection could not acquire bounded application table locks')
          }
        },
        async countAllApplicationTables() {
          const counts = {}
          try {
            for (const entry of normalizedInventory.applicationTables) {
              const result = await client.query(`SELECT COUNT(*)::text AS "count" FROM ${tableName(entry)}`)
              const count = Number(result.rows[0]?.count)
              if (!Number.isSafeInteger(count) || count < 0) throw new Error('invalid count')
              counts[entry.modelName] = count
            }
          } catch (error) {
            if (error instanceof PhaseBRecoveryError) throw error
            throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_EMPTY_UNVERIFIED, 'Complete application table counts could not be established')
          }
          return counts
        },
        async readRows(modelName) {
          const entry = findInventoryEntry(normalizedInventory, modelName)
          if (!entry) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, `Frozen inventory is missing ${modelName}`)
          try {
            const result = await client.query(`SELECT * FROM ${tableName(entry)}`)
            return result.rows
          } catch {
            throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE, 'Application family could not be read completely')
          }
        },
        async reconcileSnapshot(snapshot) {
          // The existing model restore may intentionally transform unrelated
          // rows (for example LINE account leases). The six protected families
          // are immutable/append-only, so every selected row must match by
          // complete identity/version/hash tuple after insertion.
          for (const modelName of PHASE_B_FAMILY_MODEL_NAMES) {
            const delegate = PHASE_B_FAMILY_DELEGATES[PHASE_B_FAMILY_MODEL_NAMES.indexOf(modelName)]
            const expected = Array.isArray(snapshot?.tables?.[modelName])
              ? snapshot.tables[modelName]
              : (Array.isArray(snapshot?.tables?.[delegate]) ? snapshot.tables[delegate] : [])
            const actual = await this.readRows(modelName)
            if (actual.length !== expected.length) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.WRITE_ROLLED_BACK, 'Protected family count reconciliation failed')
            const expectedRows = expected.map(comparableJson).sort()
            const actualRows = actual.map(comparableJson).sort()
            if (expectedRows.some((row, index) => row !== actualRows[index])) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.WRITE_ROLLED_BACK, 'Protected family identity reconciliation failed')
          }
        },
        async insertRows(modelName, rows) {
          if (!Array.isArray(rows)) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `Rows for ${modelName} are not an array`)
          if (rows.length === 0) return 0
          const entry = findInventoryEntry(normalizedInventory, modelName)
          if (!entry) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, `Frozen inventory is missing ${modelName}`)
          try {
            for (const row of rows) {
              if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('row is not an object')
              const columns = Object.keys(row)
              if (columns.length === 0 || columns.some((column) => !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(column))) throw new Error('unsafe row column')
              const values = columns.map((column) => {
                const value = row[column]
                if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) return JSON.stringify(value)
                return value
              })
              const placeholders = values.map((_, index) => `$${index + 1}`).join(', ')
              await client.query(`INSERT INTO ${tableName(entry)} (${columns.map(identifier).join(', ')}) VALUES (${placeholders})`, values)
            }
          } catch (error) {
            throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.WRITE_ROLLED_BACK, 'Snapshot insertion failed')
          }
          return rows.length
        },
        async commit() {
          if (finished) return
          await client.query('COMMIT')
          finished = true
          client.release()
        },
        async rollback() {
          if (finished) return
          try { await client.query('ROLLBACK') } finally { finished = true; client.release() }
        },
      }
      return tx
    },
    async close() {
      if (closed) return
      closed = true
      await pool.end()
    },
  }
}

async function rollbackQuietly(tx) {
  try { await tx?.rollback() } catch { /* preserve original bounded result */ }
}

export async function runCleanTargetRestore({ snapshotBytes, snapshot, expectedSnapshotSha256, inventory, confirmation, adapter, insertSnapshot, validateSnapshotRecovery, requireConfirmation = true } = {}) {
  const bytes = Buffer.isBuffer(snapshotBytes) ? snapshotBytes : Buffer.from(snapshotBytes || '')
  const snapshotSha256 = computeSnapshotSha256(bytes)
  const normalized = (() => {
    try { return normalizeInventory(inventory) } catch { return null }
  })()
  const base = { snapshotSha256, targetSchemaSha256: normalized?.targetSchemaSha256 || null }
  if (!normalized) return redactedResult({ status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, ...base })
  if (typeof expectedSnapshotSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedSnapshotSha256) || expectedSnapshotSha256 !== snapshotSha256) return redactedResult({ status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.SNAPSHOT_DIGEST_MISMATCH, ...base })
  if (!adapter || typeof adapter.begin !== 'function') return redactedResult({ status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.TARGET_CONNECTION_UNAVAILABLE, ...base })
  if (typeof validateSnapshotRecovery !== 'function') return redactedResult({ status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.TARGET_PRIVILEGE_UNAVAILABLE, ...base })

  // The retained byte buffer is the recovery authority. A separately passed
  // object is checked only for consistency and is never used for validation or
  // insertion, so a caller cannot hash one artifact while restoring another.
  let effectiveSnapshot
  try {
    effectiveSnapshot = JSON.parse(bytes.toString('utf8'))
  } catch {
    return redactedResult({ status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, ...base })
  }
  if (snapshot !== undefined && comparableJson(snapshot) !== comparableJson(effectiveSnapshot)) {
    return redactedResult({ status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, ...base })
  }
  try {
    const sharedValidation = await validateSnapshotRecovery(effectiveSnapshot)
    if (!sharedValidation || sharedValidation.valid !== true) {
      return redactedResult({ status: 'REFUSED', errorCode: sharedValidation?.errorCode || PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, ...base })
    }
  } catch (error) {
    return redactedResult({ status: 'REFUSED', errorCode: error?.code || PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, ...base })
  }

  let tx
  let wrote = false
  try {
    tx = await adapter.begin({ readOnly: false })
    await tx.setRowSecurityOff()
    await tx.reconcileCatalog()
    await tx.assertPrivileges({ write: true })
    await tx.lockApplicationTables()
    const targetCounts = await tx.countAllApplicationTables()
    if (!completeCounts(targetCounts, normalized)) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_EMPTY_UNVERIFIED, 'Complete application table counts could not be established')
    const validation = validatePhaseBSnapshot(effectiveSnapshot, {
      source: 'recovery', schemaInventory: normalized, expectedSnapshotSha256, snapshotBytes: bytes,
      targetCounts, schemaVisibility: 'FULL', requireTargetSchema: true,
    })
    if (!validation.valid) {
      await rollbackQuietly(tx)
      return redactedResult({ status: 'REFUSED', errorCode: validation.errorCode || PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, ...base, schemaVisibility: validation.schemaVisibility, applicationTableCount: normalized.applicationTables.length, targetCounts, incomingCounts: validation.incomingCounts })
    }
    if (!allZero(targetCounts, normalized)) {
      await rollbackQuietly(tx)
      return redactedResult({ status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.TARGET_NOT_EMPTY, ...base, schemaVisibility: 'FULL', applicationTableCount: normalized.applicationTables.length, targetCounts, incomingCounts: validation.incomingCounts })
    }
    if (requireConfirmation && confirmation !== 'PHASE_B_EMPTY_TARGET') {
      await rollbackQuietly(tx)
      return redactedResult({ status: 'READY', errorCode: null, ...base, schemaVisibility: 'FULL', applicationTableCount: normalized.applicationTables.length, targetCounts, incomingCounts: validation.incomingCounts, insertedCounts: null })
    }
    const rechecked = await tx.countAllApplicationTables()
    if (!completeCounts(rechecked, normalized)) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_EMPTY_UNVERIFIED, 'Complete application table counts could not be established before insertion')
    if (!allZero(rechecked, normalized)) {
      await rollbackQuietly(tx)
      return redactedResult({ status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.TARGET_NOT_EMPTY, ...base, schemaVisibility: 'FULL', applicationTableCount: normalized.applicationTables.length, targetCounts: rechecked, incomingCounts: validation.incomingCounts })
    }
    if (typeof insertSnapshot !== 'function') throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_PRIVILEGE_UNAVAILABLE, 'No approved snapshot insertion boundary was supplied')
    // Mark the write attempt before entering the callback. The callback may
    // insert several models and fail after a prefix; that transaction must be
    // reported as rolled back rather than as a harmless preflight refusal.
    wrote = true
    const inserted = await insertSnapshot({ tx, adapter, snapshot: effectiveSnapshot, rowsInDependencyOrder: true, phaseBFamilyDelegates: PHASE_B_FAMILY_DELEGATES })
    const insertedCounts = inserted?.insertedCounts || null
    if (typeof tx.reconcileSnapshot !== 'function') throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.WRITE_ROLLED_BACK, 'Protected family reconciliation boundary was not supplied')
    await tx.reconcileSnapshot(effectiveSnapshot)
    const actual = await tx.countAllApplicationTables()
    const expected = incomingCounts(effectiveSnapshot, normalized)
    if (!completeCounts(actual, normalized) || !countsEqual(expected, actual)) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.WRITE_ROLLED_BACK, 'Inserted row counts do not reconcile with the retained snapshot')
    await tx.commit()
    return redactedResult({ status: 'RESTORED', errorCode: null, ...base, schemaVisibility: 'FULL', applicationTableCount: normalized.applicationTables.length, targetCounts: rechecked, incomingCounts: expected, insertedCounts: insertedCounts || expected })
  } catch (error) {
    await rollbackQuietly(tx)
    const errorCode = wrote || error?.code === PHASE_B_ERROR_CODES.WRITE_ROLLED_BACK
      ? PHASE_B_ERROR_CODES.WRITE_ROLLED_BACK
      : (error?.code || PHASE_B_ERROR_CODES.TARGET_CONNECTION_UNAVAILABLE)
    return redactedResult({ status: wrote ? 'ROLLED_BACK' : 'REFUSED', errorCode, ...base })
  }
}

export async function runProtectedExport({ inventory, adapter, extractSnapshot, validateSnapshotRecovery } = {}) {
  const normalized = (() => {
    try { return normalizeInventory(inventory) } catch { return null }
  })()
  if (!normalized) return { ...redactedResult({ status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED }), snapshot: null }
  if (!adapter || typeof adapter.begin !== 'function' || typeof extractSnapshot !== 'function') return { ...redactedResult({ status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.TARGET_CONNECTION_UNAVAILABLE, targetSchemaSha256: normalized.targetSchemaSha256 }), snapshot: null }
  if (typeof validateSnapshotRecovery !== 'function') return { ...redactedResult({ status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE, targetSchemaSha256: normalized.targetSchemaSha256 }), snapshot: null }
  let tx
  try {
    tx = await adapter.begin({ readOnly: true })
    await tx.setRowSecurityOff()
    await tx.reconcileCatalog()
    await tx.assertPrivileges({ write: false })
    const targetCounts = await tx.countAllApplicationTables()
    if (!completeCounts(targetCounts, normalized)) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE, 'Complete source application table counts could not be established')
    const extracted = await extractSnapshot({ tx, adapter, includeBinaryContent: false })
    const snapshot = extracted && typeof extracted === 'object' && !Array.isArray(extracted) && extracted.snapshot
      ? extracted.snapshot
      : extracted
    const includedModels = extracted && typeof extracted === 'object' && !Array.isArray(extracted) && extracted.snapshot
      ? extracted.includedModels
      : null
    const excludedModels = extracted && typeof extracted === 'object' && !Array.isArray(extracted) && extracted.snapshot
      ? extracted.excludedModels
      : null
    const bound = {
      ...snapshot,
      targetSchemaSha256: normalized.targetSchemaSha256,
      phaseBRecovery: {
        version: PHASE_B_RECOVERY_MANIFEST_VERSION,
        requiredTables: [...PHASE_B_FAMILY_DELEGATES],
        targetSchemaSha256: normalized.targetSchemaSha256,
      },
    }
    let sharedValidation
    try {
      sharedValidation = await validateSnapshotRecovery(bound)
    } catch {
      throw new PhaseBRecoveryError(
        PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE,
        'Existing snapshot recovery validation was unavailable before export commit',
      )
    }
    if (!sharedValidation || sharedValidation.valid !== true) throw new PhaseBRecoveryError(
      PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE,
      'Existing snapshot recovery validation failed before export commit',
    )
    const validation = validatePhaseBSnapshot(bound, {
      source: 'export', schemaInventory: normalized, targetCounts, schemaVisibility: 'FULL', requireTargetSchema: true,
    })
    if (!validation.valid) {
      await rollbackQuietly(tx)
      return { ...redactedResult({ status: 'REFUSED', errorCode: validation.errorCode || PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE, targetSchemaSha256: normalized.targetSchemaSha256, schemaVisibility: 'FULL', applicationTableCount: normalized.applicationTables.length, targetCounts, incomingCounts: validation.incomingCounts }), snapshot: null }
    }
    reconcileIncludedModelCounts(bound, includedModels, excludedModels, normalized, targetCounts)
    const actualIncoming = incomingCounts(bound, normalized)
    const expectedPhaseB = Object.fromEntries(PHASE_B_FAMILY_DELEGATES.map((delegate, index) => [delegate, targetCounts[PHASE_B_FAMILY_MODEL_NAMES[index]] ?? 0]))
    const actualPhaseB = Object.fromEntries(PHASE_B_FAMILY_DELEGATES.map((delegate) => [delegate, actualIncoming[PHASE_B_FAMILY_MODEL_NAMES[PHASE_B_FAMILY_DELEGATES.indexOf(delegate)]] ?? actualIncoming[delegate] ?? 0]))
    if (!countsEqual(expectedPhaseB, actualPhaseB)) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE, 'Protected family counts did not reconcile in the same transaction')
    await tx.commit()
    return { ...redactedResult({ status: 'EXPORTED', errorCode: null, targetSchemaSha256: normalized.targetSchemaSha256, schemaVisibility: 'FULL', applicationTableCount: normalized.applicationTables.length, targetCounts, incomingCounts: actualIncoming, insertedCounts: null }), snapshot: bound }
  } catch (error) {
    await rollbackQuietly(tx)
    const errorCode = error?.code === PHASE_B_ERROR_CODES.TARGET_EMPTY_UNVERIFIED
      ? PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE
      : (error?.code || PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE)
    return { ...redactedResult({ status: 'REFUSED', errorCode, targetSchemaSha256: normalized.targetSchemaSha256 }), snapshot: null }
  }
}

export async function readSnapshotFile(snapshotPath) {
  const absolute = absolutePath(snapshotPath, 'snapshot path')
  return parseSnapshotBytes(await readFile(absolute))
}
