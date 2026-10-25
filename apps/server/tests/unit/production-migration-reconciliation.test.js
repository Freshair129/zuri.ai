import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import {
  PRODUCTION_PROJECT_REF,
  PIPELINE_BUILDER_PLAN,
  RECONCILIATION_PLAN,
  assertPriorMigrationReceipts,
  parseArgs,
  withoutTransactionWrapper,
} from '../../scripts/production-migration-reconcile.mjs'
import {
  assertDatabaseIdentity,
  createDirectClientConfig,
  resolveDirectTarget,
} from '../../scripts/production-migration-target.mjs'

// @req FR-051, FR-069, FR-094, FR-095, FR-268, FR-272 — the production
// reconciliation lane is explicit, allowlisted and refuses an unreviewed
// target or an incomplete catalog/security precondition.
// @spec ADR-104, ADR-057, SEC-001, SEC-018
// @tested tests/unit/production-migration-reconciliation.test.js

const SERVER_ROOT = process.cwd()
const OPENSSL = process.env.OPENSSL_BIN
  ?? (process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl')
const OPENSSL_AVAILABLE = spawnSync(OPENSSL, ['version'], { stdio: 'ignore' }).status === 0

describe('production migration reconciliation contract', () => {
  it('pins one ordered version/name/path for every approved production step', () => {
    const versions = RECONCILIATION_PLAN.map((item) => item.version)
    expect(new Set(versions).size).toBe(versions.length)
    expect(versions).toEqual([...versions].sort())
    expect(RECONCILIATION_PLAN).toHaveLength(12)
    for (const item of RECONCILIATION_PLAN) {
      expect(item.name).toMatch(/^[a-z0-9_]+$/)
      expect(item.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(fs.existsSync(path.join(SERVER_ROOT, item.relativePath))).toBe(true)
    }
    expect(PRODUCTION_PROJECT_REF).toBe('qcnmhyglarzcpudjorzc')
  })

  it('keeps historical reconciliation separate from SQL execution', () => {
    expect(RECONCILIATION_PLAN.filter((item) => item.mode === 'record')).toHaveLength(6)
    expect(RECONCILIATION_PLAN.filter((item) => item.mode === 'apply')).toHaveLength(6)
    for (const item of RECONCILIATION_PLAN.filter((candidate) => candidate.mode === 'record')) {
      expect(item.checks).toBeDefined()
    }
  })

  it('limits this production operation to Pipeline Builder and requires all prior receipts', () => {
    const prior = RECONCILIATION_PLAN.slice(0, -1)
    expect(PIPELINE_BUILDER_PLAN).toHaveLength(1)
    expect(PIPELINE_BUILDER_PLAN[0]).toMatchObject({
      version: '20261024010000',
      name: 'dependency_handoff',
      mode: 'apply',
    })
    const completeLedger = new Map(prior.map((item) => [item.version, item.name]))
    expect(() => assertPriorMigrationReceipts(completeLedger, prior)).not.toThrow()
    expect(() => assertPriorMigrationReceipts(new Map(), prior)).toThrow(/prior migration .* missing from ledger/)
    const wrongName = new Map(completeLedger).set(prior[0].version, 'unexpected_name')
    expect(() => assertPriorMigrationReceipts(wrongName, prior)).toThrow(/prior migration ledger name mismatch/)
  })

  it('requires explicit target and evidence receipts before either dry-run or apply', () => {
    const hash = 'a'.repeat(64)
    expect(() => parseArgs([
      '--apply', '--project-ref', PRODUCTION_PROJECT_REF,
      '--preflight', 'preflight.json', '--preflight-sha256', hash,
      '--snapshot', 'snapshot.json', '--snapshot-sha256', hash,
    ])).not.toThrow()
    expect(() => parseArgs(['--unknown'])).toThrow(/unknown option/)
    expect(() => parseArgs(['--project-ref'])).toThrow(/requires a value/)
  })

  it('pins the additive Dependency handoff migration and its pre/post catalog contract', () => {
    const item = RECONCILIATION_PLAN.find((entry) => entry.version === '20261024010000')
    expect(item).toMatchObject({
      name: 'dependency_handoff',
      relativePath: 'supabase/migrations/20261024010000_dependency_handoff.sql',
      sha256: '7ebd65cccbb049f92a8e0c246b7866888f65e39958b855ae43ffbb704e965d19',
      mode: 'apply',
      pre: { tables: ['Dependency'], absentColumns: [['Dependency', 'contractJson']] },
      post: {
        columnDefinitions: [{
          table: 'Dependency', column: 'contractJson', dataType: 'text',
          isNullable: 'YES', columnDefault: null,
        }],
      },
    })
    expect(item?.checks).toBeUndefined()
  })

  it('accepts only the approved direct Supabase endpoint and authenticated TLS', () => {
    const directUrl = 'postgresql://postgres:fake-password@db.qcnmhyglarzcpudjorzc.supabase.co:5432/postgres'
    const target = resolveDirectTarget(directUrl)
    expect(target).toEqual({
      projectRef: PRODUCTION_PROJECT_REF,
      host: `db.${PRODUCTION_PROJECT_REF}.supabase.co`,
      port: 5432,
      database: 'postgres',
    })
    expect(createDirectClientConfig(directUrl)).toMatchObject({
      ssl: { rejectUnauthorized: true, servername: `db.${PRODUCTION_PROJECT_REF}.supabase.co` },
    })
    expect(createDirectClientConfig(`${directUrl}?sslmode=no-verify`)).toMatchObject({
      ssl: { rejectUnauthorized: true, servername: `db.${PRODUCTION_PROJECT_REF}.supabase.co` },
    })
    expect(assertDatabaseIdentity({ user: 'postgres', database: 'postgres', schema: 'public', server_version: '17.5' }, target))
      .toMatchObject({ ...target, user: 'postgres', schema: 'public', serverVersionMajor: '17' })
    expect(() => resolveDirectTarget(directUrl.replace('db.qcnmhyglarzcpudjorzc.', 'db.other-project.'))).toThrow(/endpoint/)
    expect(() => resolveDirectTarget(directUrl.replace(':5432/', ':6543/'))).toThrow(/direct/)
    expect(() => resolveDirectTarget(directUrl.replace('postgresql://postgres:', 'postgresql://reader:'))).toThrow(/database role/)
    expect(() => resolveDirectTarget('postgresql://postgres@db.qcnmhyglarzcpudjorzc.supabase.co:5432/postgres')).toThrow(/password explicitly/)
    expect(() => assertDatabaseIdentity({ user: 'service_role', database: 'postgres', schema: 'public', server_version: '17.5' }, target)).toThrow(/must be postgres/)
    expect(() => assertDatabaseIdentity({ user: 'postgres', database: 'postgres', schema: 'zuri_core', server_version: '17.5' }, target)).toThrow(/public schema/)
  })

  it.skipIf(!OPENSSL_AVAILABLE)('rejects untrusted certificates and hostname mismatches in a real TLS handshake', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-tls-'))
    const certificatePath = path.join(directory, 'wrong-host.pem')
    const privateKeyPath = path.join(directory, 'private-key.pem')
    execFileSync(OPENSSL, [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', privateKeyPath, '-out', certificatePath, '-days', '1',
      '-subj', '/CN=wrong.example', '-addext', 'subjectAltName=DNS:wrong.example',
    ], { stdio: 'ignore' })

    const certificate = fs.readFileSync(certificatePath)
    const privateKey = fs.readFileSync(privateKeyPath)
    const direct = createDirectClientConfig(
      'postgresql://postgres:test@db.qcnmhyglarzcpudjorzc.supabase.co:5432/postgres',
    )
    const server = tls.createServer({ cert: certificate, key: privateKey }, (socket) => socket.end())
    try {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const port = server.address().port
      const probe = (ssl) => new Promise((resolve) => {
        const socket = tls.connect({ host: '127.0.0.1', port, ...ssl })
        socket.once('secureConnect', () => { socket.end(); resolve('TLS_VERIFIED') })
        socket.once('error', (error) => resolve(error.code || 'TLS_REJECTED'))
      })

      const untrustedCertificate = await probe(direct.ssl)
      const wrongHostname = await probe({ ...direct.ssl, ca: certificate })
      const matchingHostname = await probe({ ...direct.ssl, ca: certificate, servername: 'wrong.example' })
      expect(untrustedCertificate).not.toBe('TLS_VERIFIED')
      expect(wrongHostname).toBe('ERR_TLS_CERT_ALTNAME_INVALID')
      expect(matchingHostname).toBe('TLS_VERIFIED')
    } finally {
      await new Promise((resolve) => server.close(resolve))
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('strips SQL transaction wrappers even when migration comments precede BEGIN', () => {
    for (const item of RECONCILIATION_PLAN.filter((candidate) => candidate.mode === 'apply')) {
      const sql = fs.readFileSync(path.join(SERVER_ROOT, item.relativePath), 'utf8')
      const stripped = withoutTransactionWrapper(sql)
      expect(stripped).not.toMatch(/\bBEGIN;\s*/i)
      expect(stripped).not.toMatch(/\bCOMMIT;\s*$/i)
    }
  })

  it('hardens every table that can be created by the approved set', () => {
    const sql = fs.readFileSync(
      path.join(SERVER_ROOT, 'supabase/migrations/20260923020000_pm_trace_and_iam_rls_hardening.sql'),
      'utf8',
    )
    for (const table of ['MfaFactor', 'PasskeyCredential', 'ProjectExecutionRun', 'ProjectExecutionStep']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.%I ENABLE ROW LEVEL SECURITY`, 'i'))
      expect(sql).toContain(`'${table}'`)
    }
    expect(sql).toMatch(/force row level security/i)
    expect(sql).toMatch(/create policy zuri_app_runtime_all/i)
    expect(sql).toMatch(/revoke all on table public\.%I from public, anon, authenticated, service_role/i)
    expect(sql).toMatch(/grant select, insert, update, delete on table public\.%I to zuri_app_runtime, zuri_web_login/i)
    expect(sql).not.toMatch(/schema_migrations/i)
  })
})
