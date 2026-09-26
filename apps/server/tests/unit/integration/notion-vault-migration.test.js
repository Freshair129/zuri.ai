// @req FR-273 — the additive Notion Vault migration gives the new credential kind
//   dedicated SECURITY DEFINER functions and leaves the live LINE functions alone.
// @spec ADR-109 D1; SEC-030; SEC-033; SEC-037; ADR-057
// @tested tests/unit/integration/notion-vault-migration.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = path.join(process.cwd(), 'supabase', 'migrations')
const names = fs.readdirSync(dir).filter(name => name.endsWith('_notion_oauth_webhook.sql'))
expect(names).toHaveLength(1)
const migration = fs.readFileSync(path.join(dir, names[0]), 'utf8')
const bodyOf = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION zuri_core.${name}(`)
  expect(start).toBeGreaterThan(-1)
  return migration.slice(start, migration.indexOf('$function$;', start))
}

describe('Notion Vault migration (ADR-109)', () => {
  it('is additive, explicitly unapplied, and never redefines the existing LINE functions', () => {
    expect(migration).toMatch(/NOT APPLIED by this change/)
    expect(migration).toMatch(/^BEGIN;$/im)
    expect(migration).toMatch(/^COMMIT;$/im)
    for (const name of ['channel_secret_write', 'channel_secret_activate', 'channel_secret_revoke', 'channel_secret_resolve']) {
      expect(migration).not.toContain(`CREATE OR REPLACE FUNCTION zuri_core.${name}(`)
    }
  })

  it('pins SECURITY DEFINER functions to a fixed search path and refuses cross-kind writes before Vault creation', () => {
    for (const name of ['notion_secret_write', 'notion_secret_resolve']) {
      const body = bodyOf(name)
      expect(body).toMatch(/SECURITY DEFINER/)
      expect(body).toMatch(/SET search_path = pg_catalog, pg_temp/)
    }
    const write = bodyOf('notion_secret_write')
    expect(write).toContain("v_credential.\"secretKind\" IS DISTINCT FROM 'NOTION_OAUTH_TOKEN'")
    expect(write.indexOf("RAISE EXCEPTION 'CREDENTIAL_KIND_MISMATCH'")).toBeLessThan(write.indexOf('vault.create_secret'))
    expect(write).toContain("p_bundle ? 'accessToken'")
    expect(write).toContain("p_bundle ? 'refreshToken'")
    expect(bodyOf('notion_secret_resolve')).toContain("cr.\"secretKind\" = 'NOTION_OAUTH_TOKEN'")
  })

  it('grants only the existing vault writer and reader roles', () => {
    const grants = [...migration.matchAll(/^GRANT EXECUTE ON FUNCTION zuri_core\.(\w+)\([^)]*\) TO (\w+);$/gm)].map(match => [match[1], match[2]])
    expect(grants).toEqual([
      ['notion_secret_write', 'zuri_channel_vault_writer'],
      ['notion_secret_resolve', 'zuri_channel_vault_reader'],
    ])
  })
})
