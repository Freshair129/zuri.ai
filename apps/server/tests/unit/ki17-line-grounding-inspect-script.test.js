import { describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'

// @req FR-235 — exercise the read-only inspector contract and run its failed-
//   query path with a mocked database adapter, without live credentials.
// @spec ADR-057 — production reads/writes are DIRECT_URL-first; never a
//   mutating statement.
// @tested tests/unit/ki17-line-grounding-inspect-script.test.js

const script = readFileSync(resolve(process.cwd(), 'scripts/ki17-line-grounding-inspect.mjs'), 'utf8')
const inspectorLib = readFileSync(resolve(process.cwd(), 'scripts/ki17-line-grounding-inspect-lib.mjs'), 'utf8')

describe('the read-only LINE grounding inspection script', () => {
  it('requires the approved DIRECT_URL source and never falls back to DATABASE_URL', () => {
    expect(script).toContain('const connectionString = process.env.DIRECT_URL || null')
    expect(script).not.toContain('process.env.DATABASE_URL')
    expect(script).toContain('DIRECT_URL is required')
  })

  it('performs no write: no INSERT/UPDATE/DELETE/TRUNCATE/ALTER/DROP/CREATE statement', () => {
    expect(script).not.toMatch(/\b(insert\s+into|update\s+public|delete\s+from|truncate|alter\s+table|drop\s+table|create\s+table)\b/i)
  })

  it('queries exact mode and shadow audit actions without a global truncation cap', () => {
    expect(inspectorLib).toContain("'LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_CONFIGURED'")
    expect(inspectorLib).toContain("'LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_SHADOW_CONFIGURED'")
    expect(script).toContain("'LINE_OA_ACCOUNT'")
    expect(script).toContain('row_number() over')
    expect(script).toContain('"payloadJson", "beforeJson", "afterJson"')
    expect(script).not.toMatch(/limit\s+500/i)
  })

  it('reads LineOaAccount joined to Business, quoted for Postgres case sensitivity', () => {
    expect(script).toContain('public."LineOaAccount"')
    expect(script).toContain('public."Business"')
    expect(script).toContain('"knowledgeGrounding"')
    expect(script).toContain('"runtimeOwner"')
    expect(script).toContain('"transportMode"')
    expect(script).toContain('"knowledgeGroundingShadow"')
  })

  it('delegates report shaping to the pure lib module rather than inlining it', () => {
    expect(script).toContain("from './ki17-line-grounding-inspect-lib.mjs'")
    expect(script).toContain('buildGroundingInspectionReport(')
  })

  it('writes a JSON report and closes the pool in a finally block', () => {
    expect(script).toContain('JSON.stringify(report')
    expect(script).toMatch(/finally\s*\{[\s\S]*pool\.end\(\)/)
  })

  it('fails closed with no connection string rather than defaulting to a guessed one', () => {
    expect(script).toContain('if (!connectionString)')
    expect(script).toContain('process.exit(1)')
  })

  it('reports required-query failures as incomplete and returns a failing exit code', async () => {
    expect(script).toContain('buildGroundingInspectionReport({ accountRows, jobAudienceRows, auditRows, queryFailures })')
    expect(script).toContain('required query set is incomplete')
    expect(script).toContain('process.exitCode = 1')

    const previousDirectUrl = process.env.DIRECT_URL
    const previousArgv = process.argv
    const previousExitCode = process.exitCode
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    class AuditQueryFailurePool {
      async query(sql) {
        if (sql.includes('public."AuditEvent"')) {
          throw Object.assign(new Error('relation unavailable'), { code: '42P01' })
        }
        return { rows: [] }
      }
      async end() {}
    }

    try {
      process.env.DIRECT_URL = 'postgresql://reader:fixture@127.0.0.1:55432/inspection?sslmode=disable'
      process.argv = [process.execPath, resolve(process.cwd(), 'scripts/ki17-line-grounding-inspect.mjs')]
      process.exitCode = undefined
      vi.resetModules()
      vi.doMock('pg', () => ({ default: { Pool: AuditQueryFailurePool } }))
      await import('../../scripts/ki17-line-grounding-inspect.mjs?query-failure-test')

      const report = JSON.parse(output.mock.calls[0][0])
      expect(report).toMatchObject({
        inspectionStatus: 'INCOMPLETE',
        queryFailures: { knowledge_grounding_audit_latest_by_action: '42P01' },
      })
      expect(process.exitCode).toBe(1)
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('required query set is incomplete'))
    } finally {
      vi.doUnmock('pg')
      vi.resetModules()
      output.mockRestore()
      errors.mockRestore()
      process.argv = previousArgv
      process.exitCode = previousExitCode
      if (previousDirectUrl === undefined) delete process.env.DIRECT_URL
      else process.env.DIRECT_URL = previousDirectUrl
    }
  })
})

async function runFixture({ url, outputPath, calls = { configs: [], queries: [] } }) {
  const previous = { url: process.env.DIRECT_URL, argv: process.argv, exitCode: process.exitCode,
    ca: process.env.KI17_GROUNDING_INSPECT_CA_FILE, window: process.env.KI17_GROUNDING_INSPECT_WINDOW_DAYS }
  const output = vi.spyOn(console, 'log').mockImplementation(() => {})
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  class FixturePool {
    constructor(config) { calls.configs.push(config) }
    async query(sql) { calls.queries.push(sql); return { rows: [] } }
    async end() { calls.closed = true }
  }
  try {
    process.env.DIRECT_URL = url
    delete process.env.KI17_GROUNDING_INSPECT_CA_FILE
    delete process.env.KI17_GROUNDING_INSPECT_WINDOW_DAYS
    process.argv = [process.execPath, resolve(process.cwd(), 'scripts/ki17-line-grounding-inspect.mjs'), ...(outputPath ? [outputPath] : [])]
    process.exitCode = undefined
    vi.resetModules()
    vi.doMock('pg', () => ({ default: { Pool: FixturePool } }))
    await import('../../scripts/ki17-line-grounding-inspect.mjs?target-fixture')
    return { report: JSON.parse(output.mock.calls[0][0]), calls }
  } finally {
    vi.doUnmock('pg')
    vi.resetModules()
    output.mockRestore()
    errors.mockRestore()
    process.argv = previous.argv
    process.exitCode = previous.exitCode
    for (const [name, value] of [['DIRECT_URL', previous.url], ['KI17_GROUNDING_INSPECT_CA_FILE', previous.ca], ['KI17_GROUNDING_INSPECT_WINDOW_DAYS', previous.window]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

describe('executed target and report-file boundaries', () => {
  const localUrl = 'postgresql://reader:fixture@127.0.0.1:55432/inspection?sslmode=disable'

  it('rejects a known Supabase pooler even when it is supplied as DIRECT_URL', async () => {
    const calls = { configs: [], queries: [] }
    await expect(runFixture({ url: 'postgresql://reader:fixture@aws-0-us-east-1.pooler.supabase.com:6543/postgres', calls })).rejects.toThrow(/pooler/i)
    expect(calls.configs).toHaveLength(0)
  })

  it('verifies remote TLS and reports only the configured non-secret target', async () => {
    const { report, calls } = await runFixture({ url: 'postgresql://reader:TOP_SECRET@db.example.supabase.co:5432/postgres?sslmode=require' })
    expect(calls.configs[0].ssl).toMatchObject({ rejectUnauthorized: true, servername: 'db.example.supabase.co' })
    expect(calls.configs[0]).not.toHaveProperty('connectionString')
    expect(report.connectionTarget).toMatchObject({ host: 'db.example.supabase.co', database: 'postgres', user: 'reader', port: 5432, tlsMode: 'VERIFY_FULL' })
    expect(JSON.stringify(report)).not.toContain('TOP_SECRET')
    expect(calls.closed).toBe(true)
  })

  it('refuses URL options that would disable certificate verification before constructing a pool', async () => {
    const calls = { configs: [], queries: [] }
    await expect(runFixture({ url: 'postgresql://reader:fixture@db.example.supabase.co/postgres?sslmode=no-verify', calls })).rejects.toThrow(/TLS|sslmode/i)
    expect(calls.configs).toHaveLength(0)
  })

  it('refuses to overwrite an existing report before querying the database', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'grounding-report-'))
    const outputPath = resolve(dir, 'existing.json')
    const calls = { configs: [], queries: [] }
    writeFileSync(outputPath, 'original receipt')
    try {
      await expect(runFixture({ url: localUrl, outputPath, calls })).rejects.toThrow(/exist|overwrite/i)
      expect(readFileSync(outputPath, 'utf8')).toBe('original receipt')
      expect(calls.configs).toHaveLength(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects a repository output path, including an outside symlink into the repository', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'grounding-symlink-'))
    const ownRepoFile = resolve(process.cwd(), `.grounding-report-${basename(dir)}.json`)
    const alias = resolve(dir, 'repo')
    symlinkSync(process.cwd(), alias, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      for (const outputPath of [ownRepoFile, resolve(alias, basename(ownRepoFile))]) {
        const calls = { configs: [], queries: [] }
        await expect(runFixture({ url: localUrl, outputPath, calls })).rejects.toThrow(/repository/i)
        expect(calls.configs).toHaveLength(0)
      }
      expect(existsSync(ownRepoFile)).toBe(false)
    } finally {
      rmSync(ownRepoFile, { force: true })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates one new outside report, preserving stdout and explicit loopback operation', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'grounding-report-'))
    const outputPath = resolve(dir, 'new', 'report.json')
    try {
      const { report, calls } = await runFixture({ url: localUrl, outputPath })
      expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual(report)
      expect(report.connectionTarget).toMatchObject({ host: '127.0.0.1', database: 'inspection', port: 55432, tlsMode: 'DISABLED_LOOPBACK' })
      expect(calls.configs[0].ssl).toBe(false)
      expect(calls.queries).toHaveLength(3)
      expect(calls.closed).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('everything the script imports is a local, committed file', () => {
  it('imports only pg, node builtins and committed sibling helpers', () => {
    const importSpecifiers = Array.from(
      script.matchAll(/^import[\s\S]*?from\s+'([^']+)'/gm),
      (match) => match[1],
    )
    const allowedSpecifiers = new Set([
      'pg',
      'node:fs',
      'node:path',
      'node:url',
      './production-migration-evidence.mjs',
      './ki17-line-grounding-inspect-lib.mjs',
    ])

    expect(importSpecifiers.length).toBeGreaterThan(0)
    expect(script).not.toMatch(/\bimport\s*\(/)
    expect(script).not.toMatch(/\brequire\s*\(/)
    for (const specifier of importSpecifiers) {
      expect(allowedSpecifiers.has(specifier)).toBe(true)
    }
  })
})
