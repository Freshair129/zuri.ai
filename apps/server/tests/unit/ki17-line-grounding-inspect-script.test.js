import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// @req FR-235 — the TASK-ZAI-095 read-only inspection script is a thin wrapper
//   around ki17-line-grounding-inspect-lib.mjs (that module's own logic is
//   exercised in tests/unit/ki17-line-grounding-inspect-lib.test.js, no live
//   database there either). This test only checks the wrapper's shape — it
//   never opens a connection — following the same convention
//   tests/unit/server-retention-sweep-worker-script.test.js uses for
//   scripts/server-retention-sweep-worker.mjs: a script that reads
//   environment/hits a live dependency has no committed live-execution test in
//   this repo (readonly-supabase-preflight.mjs, the pattern this script is
//   modelled on, has none either), so the source-text shape is what is
//   verified.
// @spec ADR-057 — production reads/writes are DIRECT_URL-first; never a
//   mutating statement.
// @tested tests/unit/ki17-line-grounding-inspect-script.test.js

const script = readFileSync(resolve(process.cwd(), 'scripts/ki17-line-grounding-inspect.mjs'), 'utf8')

describe('the read-only LINE grounding inspection script', () => {
  it('prefers DIRECT_URL over the pooler DATABASE_URL, like readonly-supabase-preflight.mjs', () => {
    expect(script).toContain('process.env.DIRECT_URL || process.env.DATABASE_URL')
  })

  it('performs no write: no INSERT/UPDATE/DELETE/TRUNCATE/ALTER/DROP/CREATE statement', () => {
    expect(script).not.toMatch(/\b(insert\s+into|update\s+public|delete\s+from|truncate|alter\s+table|drop\s+table|create\s+table)\b/i)
  })

  it('queries the exact CONFIGURE_KNOWLEDGE_GROUNDING audit trail, not a guessed action name', () => {
    expect(script).toContain("'LINE_OA_ACCOUNT_KNOWLEDGE_GROUNDING_CONFIGURED'")
    expect(script).toContain("'LINE_OA_ACCOUNT'")
  })

  it('reads LineOaAccount joined to Business, quoted for Postgres case sensitivity', () => {
    expect(script).toContain('public."LineOaAccount"')
    expect(script).toContain('public."Business"')
    expect(script).toContain('"knowledgeGrounding"')
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
})

describe('everything the script imports is a local, committed file', () => {
  it('imports only pg, node builtins and the sibling lib module', () => {
    const importLines = script.split('\n').filter((line) => line.trim().startsWith('import '))
    for (const line of importLines) {
      expect(line).toMatch(/from '(pg|node:fs|node:path|\.\/ki17-line-grounding-inspect-lib\.mjs)'/)
    }
  })
})
