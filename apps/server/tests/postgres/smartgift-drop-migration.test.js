// @spec ADR-119 — the SmartGift Business drop migration, applied to a disposable embedded PostgreSQL.
// @spec ADR-057 (no production database is ever a test target; this file starts its own cluster)
// @tested tests/postgres/smartgift-drop-migration.test.js
//
// The cluster, schema and every row here are created by this test. The schema is the current
// generated Postgres Prisma schema. The migration is executed exactly as an operator would run it:
// the file text through one simple query.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { startEmbeddedPostgres } from '../helpers/embedded-postgres.js'

const ROOT = path.resolve(__dirname, '..', '..')
const MIGRATION = readFileSync(path.join(ROOT, 'supabase/migrations/20261120000000_drop_smartgift_business_data.sql'), 'utf8')
const TENANT = '77cdbe70-3111-4a04-922a-8059be99a8b0'
const TARGET = '834fa869-62f3-431c-a287-e9a95e91175b'
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000001'

let server, client
const columnCache = new Map()
let sequence = 0
const notices = []

async function insert(table, values) {
  if (!columnCache.has(table)) {
    const { rows } = await client.query(`SELECT column_name, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])
    columnCache.set(table, rows)
  }
  const row = { ...values }
  for (const c of columnCache.get(table)) {
    if (c.column_name in row || c.is_nullable === 'YES' || c.column_default != null) continue
    sequence += 1
    row[c.column_name] = /int|numeric|float/.test(c.udt_name) ? 0 : c.udt_name === 'bool' ? false
      : /timestamp/.test(c.udt_name) ? new Date() : c.udt_name === 'bytea' ? Buffer.from([1]) : `${table}-${c.column_name}-${sequence}`
  }
  const names = Object.keys(row)
  await client.query(`INSERT INTO "${table}" (${names.map(n => `"${n}"`).join(',')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(',')})`, names.map(n => row[n]))
  return row
}
const count = async (table, where = '', params = []) => Number((await client.query(`SELECT count(*) AS n FROM "${table}" ${where}`, params)).rows[0].n)

async function seedBusiness(businessId, code, tag) {
  const personId = `p-${tag}`
  await insert('Person', { id: personId })
  await insert('Business', { id: businessId, code, tenantId: TENANT, name: `${tag} business` })
  await insert('Membership', { id: `m-${tag}`, tenantId: TENANT, businessId, personId })
  await insert('RoleBinding', { id: `rb-${tag}`, tenantId: TENANT, businessId, personId })
  await insert('Customer', { id: `c-${tag}`, tenantId: TENANT, businessId, personId })
  await insert('Conversation', { id: `conv-${tag}`, tenantId: TENANT, businessId, customerId: `c-${tag}` })
  await insert('Message', { id: `msg-${tag}`, conversationId: `conv-${tag}` })
  await insert('PricingRuleSet', { id: `prs-a-${tag}`, tenantId: TENANT, businessId })
  await insert('PricingRuleSet', { id: `prs-b-${tag}`, tenantId: TENANT, businessId, sourceRuleSetId: `prs-a-${tag}` })
  await insert('KnowledgeCorpus', { id: `kc-${tag}`, tenantId: TENANT, businessId })
  await insert('KnowledgeSource', { id: `ks-${tag}`, corpusId: `kc-${tag}` })
}

beforeAll(async () => {
  server = await startEmbeddedPostgres({ label: 'smartgift-drop', database: 'smartgift_drop_test' })
  const prismaCli = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js')
  const ddl = execFileSync(process.execPath, [prismaCli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.postgres.prisma', '--script'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  client = new pg.Client({ connectionString: server.url })
  client.on('notice', n => notices.push(n.message))
  await client.connect()
  await client.query(ddl)
  await insert('Portfolio', { id: 'portfolio-1' })
  await insert('Tenant', { id: TENANT, portfolioId: 'portfolio-1' })
}, 180000)

afterAll(async () => {
  try { await client?.end() } finally { await server?.stop() }
})

describe('SmartGift Business drop migration', () => {
  it('is a data-only file: no DROP, ALTER, TRUNCATE or zuri_core access', () => {
    // ON COMMIT DROP only removes the migration's own temp tables at commit; it is not a DROP statement.
    const code = MIGRATION.replace(/^--.*$/gm, '').replaceAll('ON COMMIT DROP', '')
    expect(code).not.toMatch(/\b(DROP|ALTER|TRUNCATE|GRANT|REVOKE)\b/i)
    expect(code).not.toMatch(/zuri_core/i)
  })

  it('lists exactly the foreign-key closure of Business, children before parents (checked against the real catalog)', async () => {
    // While this migration is unapplied, a new table that references Business-scoped data must be added
    // to its list; once the owner has applied it, this closure assertion should be retired with the file.
    const spec = JSON.parse(/'(\[\n[\s\S]*?\n\])'::jsonb/.exec(MIGRATION)[1])
    const names = spec.map(s => s.t)
    expect(new Set(names).size).toBe(names.length)
    const fks = (await client.query(`SELECT cl.relname AS child, pl.relname AS parent FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_class pl ON pl.oid = c.confrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'`)).rows
    const plain = (await client.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public'
      AND column_name = 'businessId' AND table_name NOT IN ('AuditEvent', 'Business')`)).rows.map(r => r.table_name)
    const closure = new Set(['Business', ...plain])
    for (let grew = true; grew;) {
      grew = false
      for (const { child, parent } of fks) if (closure.has(parent) && !closure.has(child)) { closure.add(child); grew = true }
    }
    closure.delete('Business')
    expect([...closure].sort()).toEqual([...names].sort())
    const position = new Map(names.map((n, i) => [n, i]))
    for (const { child, parent } of fks) {
      if (position.has(child) && position.has(parent) && child !== parent) {
        expect(position.get(child), `${child} must be deleted before ${parent}`).toBeLessThan(position.get(parent))
      }
    }
    // every foreign key the list claims exists in the catalog
    const edges = new Set(fks.map(f => `${f.child}>${f.parent}`))
    for (const s of spec) for (const f of s.fk) {
      if (f.p === 'Business' && plain.includes(s.t) && !edges.has(`${s.t}>Business`)) continue // plain businessId column, no constraint
      expect(edges.has(`${s.t}>${f.p}`), `${s.t} -> ${f.p}`).toBe(true)
    }
  })

  it('does nothing when the Business is absent (fresh install)', async () => {
    notices.length = 0
    await client.query(MIGRATION)
    expect(notices.some(n => n.includes('already absent'))).toBe(true)
  })

  describe('with the SmartGift Business and another Business in the same tenant', () => {
    beforeAll(async () => {
      await seedBusiness(TARGET, 'BUS-SMARTGIFT', 'sg')
      await seedBusiness(OTHER, 'BUS-OTHER', 'ot')
      await client.query(`INSERT INTO "AuditEvent" (id, "entityType", "entityId", action, "businessId") VALUES ('audit-sg', 'Business', $1, 'x', $1)`, [TARGET])
    })

    it('refuses a Business whose id matches but whose code differs', async () => {
      await client.query(`UPDATE "Business" SET code = 'BUS-RENAMED' WHERE id = $1`, [TARGET])
      await expect(client.query(MIGRATION)).rejects.toThrow(/SMARTGIFT_DROP_TARGET_MISMATCH/)
      await client.query(`UPDATE "Business" SET code = 'BUS-SMARTGIFT' WHERE id = $1`, [TARGET])
      expect(await count('Business', 'WHERE id = $1', [TARGET])).toBe(1)
    })

    it('aborts, deleting nothing, when another Business references a row of the target', async () => {
      // a SalesOrder of OTHER pointing at the target's customer
      await insert('SalesOrder', { id: 'so-x', tenantId: TENANT, businessId: OTHER, customerId: 'c-sg' })
      await expect(client.query(MIGRATION)).rejects.toThrow(/SMARTGIFT_DROP_CROSS_BUSINESS_REFERENCES/)
      expect(await count('Customer', 'WHERE id = $1', ['c-sg'])).toBe(1)
      expect(await count('Business', 'WHERE id = $1', [TARGET])).toBe(1)
      await client.query(`DELETE FROM "SalesOrder" WHERE id = 'so-x'`)
    })

    it('runs every step in a dry run and rolls everything back', async () => {
      await client.query(`SET zuri.smartgift_drop_dry_run = 'on'`)
      try {
        await expect(client.query(MIGRATION)).rejects.toThrow(/SMARTGIFT_DROP_DRY_RUN: \d+ row\(s\) would be deleted/)
      } finally { await client.query('RESET zuri.smartgift_drop_dry_run') }
      expect(await count('Business', 'WHERE id = $1', [TARGET])).toBe(1)
      expect(await count('Message', 'WHERE id = $1', ['msg-sg'])).toBe(1)
    })

    it('deletes exactly the target Business and its dependants, keeps everything else', async () => {
      notices.length = 0
      await client.query(MIGRATION)
      for (const [table, id] of [['Business', TARGET], ['Membership', 'm-sg'], ['RoleBinding', 'rb-sg'], ['Customer', 'c-sg'], ['Conversation', 'conv-sg'],
        ['Message', 'msg-sg'], ['PricingRuleSet', 'prs-a-sg'], ['PricingRuleSet', 'prs-b-sg'], ['KnowledgeCorpus', 'kc-sg'], ['KnowledgeSource', 'ks-sg']]) {
        expect(await count(table, 'WHERE id = $1', [id]), `${table} ${id}`).toBe(0)
      }
      for (const [table, id] of [['Business', OTHER], ['Membership', 'm-ot'], ['RoleBinding', 'rb-ot'], ['Customer', 'c-ot'], ['Conversation', 'conv-ot'],
        ['Message', 'msg-ot'], ['PricingRuleSet', 'prs-a-ot'], ['PricingRuleSet', 'prs-b-ot'], ['KnowledgeCorpus', 'kc-ot'], ['KnowledgeSource', 'ks-ot'],
        ['Tenant', TENANT], ['Person', 'p-sg'], ['Person', 'p-ot'], ['AuditEvent', 'audit-sg']]) {
        expect(await count(table, 'WHERE id = $1', [id]), `${table} ${id}`).toBe(1)
      }
      expect(notices.some(n => /SMARTGIFT_DROP: Membership: 1 row\(s\)/.test(n))).toBe(true)
      expect(notices.some(n => /SMARTGIFT_DROP: Business: 1 row\(s\)/.test(n))).toBe(true)
    })

    it('is idempotent: a second run is a no-op', async () => {
      notices.length = 0
      await client.query(MIGRATION)
      expect(notices.some(n => n.includes('already absent'))).toBe(true)
      expect(await count('Business')).toBe(1)
    })
  })

  describe('retained marketing-report evidence', () => {
    it('aborts instead of attempting a delete the retention triggers would refuse', async () => {
      // Re-create the SmartGift identity (its row was removed above) with a retained policy row.
      await insert('Business', { id: TARGET, code: 'BUS-SMARTGIFT', tenantId: TENANT, name: 'sg again' })
      await insert('MarketingReportPolicy', { businessId: TARGET, tenantId: TENANT })
      await expect(client.query(MIGRATION)).rejects.toThrow(/SMARTGIFT_DROP_BLOCKED_RETAINED_MARKETING_REPORT_EVIDENCE/)
      expect(await count('Business', 'WHERE id = $1', [TARGET])).toBe(1)
    })
  })
})
