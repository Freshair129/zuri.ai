// @req FR-159, FR-158, FR-160 — Marketing evidence is available through the authorized runtime only.
// @spec SEC-001, SDD-086
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Marketing Postgres migration security', () => {
  it.each([['20260906200000_marketing_strategy.sql', 5], ['20260906220000_marketing_campaigns.sql', 1], ['20260906230000_marketing_content.sql', 4]])('gives every table in %s a private runtime policy', (file, count) => {
    const sql = readFileSync(`supabase/migrations/${file}`, 'utf8')
    const tables = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(match => match[1])
    expect(tables).toHaveLength(count)
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
