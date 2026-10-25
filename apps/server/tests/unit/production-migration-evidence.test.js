import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assertMatchingArtifacts,
  buildHashedArtifact,
  readHashedArtifact,
  verifyDependencyBackup,
} from '../../scripts/production-migration-evidence.mjs'
import { assertOwnedDisposableTestDatabase } from '../../scripts/production-migration-test-target.mjs'

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex')

describe('production migration evidence artifacts', () => {
  it('verifies the externally pinned file hash and the embedded canonical hash', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-evidence-'))
    const filePath = path.join(directory, 'receipt.json')
    const artifact = buildHashedArtifact({
      mode: 'READ_ONLY',
      projectRef: 'qcnmhyglarzcpudjorzc',
      target: { projectRef: 'qcnmhyglarzcpudjorzc', host: 'db.qcnmhyglarzcpudjorzc.supabase.co' },
      baselineId: 'baseline-1',
      baseline: { migrationLedger: { sha256: sha256('ledger') } },
    })
    const bytes = `${JSON.stringify(artifact, null, 2)}\n`
    fs.writeFileSync(filePath, bytes)
    expect(readHashedArtifact(filePath, sha256(bytes), 'READ_ONLY')).toEqual(artifact)
    expect(() => readHashedArtifact(filePath, sha256(`${bytes}x`), 'READ_ONLY')).toThrow(/file hash/)
    const tamperedBytes = bytes.replace('baseline-1', 'baseline-2')
    fs.writeFileSync(filePath, tamperedBytes)
    expect(() => readHashedArtifact(filePath, sha256(tamperedBytes), 'READ_ONLY')).toThrow(/embedded content hash/)
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('rejects artifact pairs with different targets or baseline identities', () => {
    const target = { projectRef: 'qcnmhyglarzcpudjorzc', host: 'db.qcnmhyglarzcpudjorzc.supabase.co' }
    const preflight = { target, baselineId: 'baseline-1', baseline: { rows: 2 } }
    const snapshot = { target, baselineId: 'baseline-1', baseline: { rows: 2 } }
    expect(() => assertMatchingArtifacts(preflight, snapshot, target)).not.toThrow()
    expect(() => assertMatchingArtifacts(preflight, { ...snapshot, baselineId: 'baseline-2' }, target)).toThrow(/baseline/)
    expect(() => assertMatchingArtifacts(preflight, snapshot, { ...target, host: 'wrong.example' })).toThrow(/target/)
  })

  it('streams and verifies the Dependency row sidecar without buffering the whole file', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-backup-'))
    const snapshotPath = path.join(directory, 'snapshot.json')
    const backupFile = 'snapshot.json.dependency.ndjson'
    const backupPath = path.join(directory, backupFile)
    const contents = '{"contractJson":"{\\"link\\":true}","id":"legacy-1"}\n{"contractJson":null,"id":"legacy-2"}\n'
    fs.writeFileSync(snapshotPath, '{}\n')
    fs.writeFileSync(backupPath, contents)
    const snapshot = {
      baseline: { dependency: { rowCount: 2, fullRowsSha256: sha256(contents) } },
      dependencyBackup: { file: backupFile, rowCount: 2, sha256: sha256(contents) },
    }
    expect(await verifyDependencyBackup(snapshot, snapshotPath)).toBe(backupPath)
    await expect(verifyDependencyBackup({
      ...snapshot,
      baseline: { dependency: { rowCount: 2, fullRowsSha256: sha256('different rows') } },
    }, snapshotPath)).rejects.toThrow(/complete-row snapshot baseline/)
    fs.appendFileSync(backupPath, '{"id":"tampered"}\n')
    await expect(verifyDependencyBackup(snapshot, snapshotPath)).rejects.toThrow(/file hash mismatch/)
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('accepts only a test-owned auto-removed loopback Postgres container with tmpfs storage', () => {
    const ownerToken = 'a'.repeat(64)
    const containerId = 'b'.repeat(64)
    const container = {
      Id: containerId,
      Name: '/pm-migration-isolated-test',
      Config: {
        Image: 'postgres:17-alpine',
        Labels: {
          'com.zuri-ai.test.purpose': 'production-migration-isolated',
          'com.zuri-ai.test.owner-token': ownerToken,
        },
        Env: ['POSTGRES_USER=postgres', 'POSTGRES_DB=pm_migration_test'],
      },
      State: { Running: true },
      HostConfig: {
        AutoRemove: true,
        Tmpfs: { '/var/lib/postgresql/data': 'rw,noexec,nosuid,size=268435456' },
        Binds: null,
      },
      Mounts: [],
      NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55432' }] } },
    }
    const args = {
      databaseUrl: 'postgresql://postgres:ephemeral@127.0.0.1:55432/pm_migration_test',
      containerId,
      ownerToken,
      container,
    }
    expect(assertOwnedDisposableTestDatabase(args)).toEqual({ host: '127.0.0.1', port: 55432, database: 'pm_migration_test' })
    expect(() => assertOwnedDisposableTestDatabase({ ...args, ownerToken: undefined })).toThrow(/owner proof/)
    expect(() => assertOwnedDisposableTestDatabase({ ...args, ownerToken: 'c'.repeat(64) })).toThrow(/owner label/)
    expect(() => assertOwnedDisposableTestDatabase({ ...args, databaseUrl: `${args.databaseUrl}?sslmode=disable` })).toThrow(/query overrides/)
    expect(() => assertOwnedDisposableTestDatabase({ ...args, container: { ...container, HostConfig: { ...container.HostConfig, AutoRemove: false } } }))
      .toThrow(/auto-removed/)
    expect(() => assertOwnedDisposableTestDatabase({ ...args, container: { ...container, Mounts: [{ Type: 'volume', Destination: '/var/lib/postgresql/data' }] } }))
      .toThrow(/tmpfs/)
    expect(() => assertOwnedDisposableTestDatabase({ ...args, container: { ...container, NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55432' }] } } } }))
      .toThrow(/loopback-only/)
  })
})
