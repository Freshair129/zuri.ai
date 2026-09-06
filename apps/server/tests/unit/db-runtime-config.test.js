// @req FR-030, FR-076, FR-078 — production database selection is server-only
// and must not contain a source-level credential fallback.
// @req FR-145 — the Supavisor pooler mode follows runtime topology
//   (session by default, transaction on Vercel, ZURI_DB_POOL_MODE overrides).
// @spec ADR-018, docs/DB-MIGRATION-NOTES.md, ADR-058 D9
// @tested tests/unit/db-runtime-config.test.js

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { requireProductionDatabaseUrl, resolvePoolMode, resolvePostgresUrl } from '@/lib/db'

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/lib/db.js')

describe('production database runtime configuration', () => {
  it('accepts only server-provided Postgres environment values', () => {
    const configured = 'postgresql://runtime:placeholder@db.example.test:5432/zuri'

    expect(resolvePostgresUrl({ POSTGRES_PRISMA_URL: configured })).toBe(configured)
    expect(resolvePostgresUrl({ DATABASE_URL: 'file:./dev.db' })).toBeNull()
  })

  it('adds pgbouncer=true to an existing Supabase transaction-pooler URL on Vercel', () => {
    const configured = 'postgresql://postgres.ref:placeholder@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'

    const resolved = new URL(resolvePostgresUrl({ DATABASE_URL: configured, VERCEL: '1' }))

    expect(resolved.port).toBe('6543')
    expect(resolved.searchParams.get('pgbouncer')).toBe('true')
  })

  it('preserves existing pooler query parameters without duplicating pgbouncer, on Vercel', () => {
    const configured = 'postgresql://postgres.ref:placeholder@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true'

    const resolved = resolvePostgresUrl({ DATABASE_URL: configured, VERCEL: '1' })

    expect(new URL(resolved).searchParams.get('sslmode')).toBe('require')
    expect(resolved.match(/pgbouncer=true/g)).toHaveLength(1)
  })

  // @req FR-145
  describe('pooler mode follows runtime topology (FR-145, ADR-058 D9)', () => {
    it('defaults to session-mode pooling off Vercel — fast, for a long-running process', () => {
      const configured = 'postgresql://postgres.ref:placeholder@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true'

      const resolved = new URL(resolvePostgresUrl({ DATABASE_URL: configured }))

      expect(resolved.port).toBe('5432')
      expect(resolved.searchParams.has('pgbouncer')).toBe(false)
    })

    it('defaults to transaction-mode pooling on Vercel — many concurrent short-lived invocations', () => {
      const configured = 'postgresql://postgres.ref:placeholder@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'

      const resolved = new URL(resolvePostgresUrl({ DATABASE_URL: configured, VERCEL: '1' }))

      expect(resolved.port).toBe('6543')
      expect(resolved.searchParams.get('pgbouncer')).toBe('true')
    })

    it('ZURI_DB_POOL_MODE=session overrides Vercel — an explicit operator choice wins', () => {
      const configured = 'postgresql://postgres.ref:placeholder@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'

      const resolved = new URL(resolvePostgresUrl({ DATABASE_URL: configured, VERCEL: '1', ZURI_DB_POOL_MODE: 'session' }))

      expect(resolved.port).toBe('5432')
      expect(resolved.searchParams.has('pgbouncer')).toBe(false)
    })

    it('ZURI_DB_POOL_MODE=transaction forces pooling off Vercel too — e.g. multiple container replicas', () => {
      const configured = 'postgresql://postgres.ref:placeholder@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'

      const resolved = new URL(resolvePostgresUrl({ DATABASE_URL: configured, ZURI_DB_POOL_MODE: 'transaction' }))

      expect(resolved.port).toBe('6543')
      expect(resolved.searchParams.get('pgbouncer')).toBe('true')
    })

    it('an unrecognized ZURI_DB_POOL_MODE value is ignored, not trusted verbatim', () => {
      expect(resolvePoolMode({ ZURI_DB_POOL_MODE: 'yolo' })).toBe('session')
      expect(resolvePoolMode({ ZURI_DB_POOL_MODE: 'yolo', VERCEL: '1' })).toBe('transaction')
    })

    it('a non-pooler host is untouched regardless of pool mode', () => {
      const direct = 'postgresql://runtime:placeholder@db.example.test:5432/zuri'

      expect(resolvePostgresUrl({ DATABASE_URL: direct })).toBe(direct)
      expect(resolvePostgresUrl({ DATABASE_URL: direct, VERCEL: '1' })).toBe(direct)
    })
  })

  it('fails closed when production has no Postgres environment value', () => {
    expect(() => requireProductionDatabaseUrl({ NODE_ENV: 'production' })).toThrow(
      'PRODUCTION_DATABASE_URL_REQUIRED',
    )
  })

  it('allows Next production build analysis without weakening runtime enforcement', () => {
    expect(
      requireProductionDatabaseUrl({
        NODE_ENV: 'production',
        NEXT_PHASE: 'phase-production-build',
      }),
    ).toBeNull()
  })

  it('does not contain a credential-bearing URL or named default fallback', () => {
    const source = fs.readFileSync(sourcePath, 'utf8')

    expect(source).not.toMatch(/postgres(?:ql)?:\/\/[^\s'"`]+@/i)
    expect(source).not.toContain('SUPABASE_DEFAULT_POSTGRES_URL')
  })
})
