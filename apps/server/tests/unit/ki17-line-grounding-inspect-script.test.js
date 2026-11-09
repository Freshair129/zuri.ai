import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
      process.env.DIRECT_URL = 'postgres://inspection-test'
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

describe('everything the script imports is a local, committed file', () => {
  it('imports only pg, node builtins and the sibling lib module', () => {
    const importSpecifiers = Array.from(
      script.matchAll(/^import[\s\S]*?from\s+'([^']+)'/gm),
      (match) => match[1],
    )
    const allowedSpecifiers = new Set([
      'pg',
      'node:fs',
      'node:path',
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
