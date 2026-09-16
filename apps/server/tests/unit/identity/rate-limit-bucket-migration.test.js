// @req FR-224 — static guarantees of design migration 8 and the model it creates.
// @spec ADR-089 D4; ADR-057
// @tested tests/unit/identity/rate-limit-bucket-migration.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SNAPSHOT_EXCLUDED_MODELS } from '@/modules/project-manager/application/backup-service'

vi.mock('@/lib/db', () => ({ default: {} }))

const dir = path.join(process.cwd(), 'supabase', 'migrations')
const [file] = fs.readdirSync(dir).filter(name => name.endsWith('_rate_limit_bucket.sql'))
const sql = fs.readFileSync(path.join(dir, file), 'utf8')
const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')

describe('migration 8 — RateLimitBucket', () => {
  it('creates every column the model declares, a unique key, and a private table, unapplied', () => {
    const model = /model RateLimitBucket \{([\s\S]*?)\n\}/.exec(schema)[1]
    for (const field of model.split('\n').map(l => /^\s+(\w+)\s+\w/.exec(l)?.[1]).filter(Boolean)) {
      expect(sql).toContain(`"${field}"`)
    }
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "RateLimitBucket_key_key"')
    expect(sql).toContain('ALTER TABLE "RateLimitBucket" FORCE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON TABLE "RateLimitBucket" FROM public, anon, authenticated, service_role')
    expect(sql).toMatch(/NOT APPLIED by the change that writes it/)
  })

  it('is excluded from backup export as ephemeral', () => {
    expect(SNAPSHOT_EXCLUDED_MODELS.rateLimitBucket).toMatch(/ephemeral/)
  })
})
