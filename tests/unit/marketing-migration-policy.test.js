// @req FR-155, FR-154 — Marketing evidence is available through the authorized runtime only.
// @spec SEC-001, SDD-086
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Marketing Postgres migration security', () => {
  it('gives every newly created table a runtime policy and removes direct Data API grants', () => {
    const sql = readFileSync('supabase/migrations/20260906200000_marketing_strategy.sql', 'utf8')
    const tables = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(match => match[1])
    expect(tables).toHaveLength(5)
    for (const table of tables) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`)
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`)
      expect(sql).toContain(`CREATE POLICY zuri_app_runtime_all ON "${table}" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);`)
      expect(sql).toContain(`REVOKE ALL ON TABLE "${table}" FROM public, anon, authenticated, service_role;`)
    }
    expect(sql).not.toMatch(/GRANT\s+[^;]+\bTO\s+(?:public|anon|authenticated|service_role)\b/i)
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i)
  })
})
