// @req FR-293 — transfer custody remains target-local and separate from snapshot tables.
// @spec ADR-115
// @tested tests/unit/managed-blob-transfer-schema.test.js
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = file => readFileSync(path.resolve(process.cwd(), file), 'utf8')
const modelBody = (schema, name) => schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] || ''

describe('FR-293 target-local transfer persistence contract', () => {
  const sqlite = read('prisma/schema.prisma')
  const postgres = read('prisma/schema.postgres.prisma')
  const backup = read('src/modules/project-manager/application/backup-service.js')
  const transfer = read('src/modules/project-manager/application/managed-blob-transfer-contract.js')

  it('declares identical durable job and entry models in both Prisma providers', () => {
    for (const name of ['ManagedBlobBackupTransferJob', 'ManagedBlobBackupTransferEntry']) {
      const local = modelBody(sqlite, name)
      expect(local).not.toBe('')
      expect(modelBody(postgres, name)).toBe(local)
      expect(local).toMatch(/id\s+String\s+@id/)
      expect(local).not.toContain('@relation')
    }
    const job = modelBody(sqlite, 'ManagedBlobBackupTransferJob')
    for (const field of ['actorId', 'kind', 'state', 'version', 'generation', 'packageSha256', 'targetConfigHash',
      'spoolId', 'spoolBytes', 'confirmationDigest', 'admissionId', 'expiresAt', 'workerId', 'workerStartedAt', 'epoch', 'leaseExpiresAt',
      'outcomeJson', 'restoreRemountsJson', 'restoreClaimedAt', 'cleanupState', 'unresolved']) expect(job).toContain(field)
    expect(job).toMatch(/admissionId\s+String\?\s+@unique/)
    const entry = modelBody(sqlite, 'ManagedBlobBackupTransferEntry')
    for (const field of ['jobId', 'objectId', 'purpose', 'sha256', 'byteLength', 'bindingsJson',
      'targetKey', 'targetRef', 'state', 'attempts', 'receiptJson']) expect(entry).toContain(field)
  })

  it('keeps transfer jobs, entries, recovery operations and fences out of portable snapshots', () => {
    const excluded = backup.slice(backup.indexOf('const SNAPSHOT_EXCLUDED_MODELS'), backup.indexOf('const SNAPSHOT_TABLES'))
    expect(excluded).toContain('managedBlobBackupTransferJob')
    expect(excluded).toContain('managedBlobBackupTransferEntry')
    for (const name of ['managedBlobBackupTransferJob', 'managedBlobBackupTransferEntry']) {
      expect(transfer).toContain(`'${name}'`)
    }
  })

  it('ships an additive local migration for both target-local tables', () => {
    const migrationDir = readdirSync(path.resolve(process.cwd(), 'prisma/migrations'))
      .find(name => name.includes('managed_blob_backup_transfer'))
    expect(migrationDir).toBeTruthy()
    const migration = read(`prisma/migrations/${migrationDir}/migration.sql`)
    for (const table of ['ManagedBlobBackupTransferJob', 'ManagedBlobBackupTransferEntry']) {
      expect(migration).toContain(`CREATE TABLE "${table}"`)
    }
    expect(migration).toContain('"workerStartedAt" DATETIME')
    expect(read('prisma/postgres/0001_init.sql')).toContain('"workerStartedAt" TIMESTAMP(3)')
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
  })
})
