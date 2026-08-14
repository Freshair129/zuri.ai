import { readFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseDedicatedRuntimeDatabaseUrl,
  readRuntimeDatabaseCa,
} from '@/modules/knowledge/runtime-postgres-config'

// @req FR-052, FR-054 — production runtime accepts the approved pooler and verifies its CA.
// @spec SDD-026, SDD-027, SEC-010, SEC-011
// @tested tests/unit/runtime-postgres-config.test.js

describe('runtime Postgres configuration', () => {
  it('normalizes the approved direct and Supavisor usernames to the dedicated login role', () => {
    expect(parseDedicatedRuntimeDatabaseUrl(
      'postgresql://zuri_line_smartgift_login:password@db.qcnmhyglarzcpudjorzc.supabase.co:5432/postgres',
    ).role).toBe('zuri_line_smartgift_login')
    expect(parseDedicatedRuntimeDatabaseUrl(
      'postgresql://zuri_line_smartgift_login.qcnmhyglarzcpudjorzc:password@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
    ).role).toBe('zuri_line_smartgift_login')
    expect(() => parseDedicatedRuntimeDatabaseUrl(
      'postgresql://zuri_line_smartgift_login.qcnmhyglarzcpudjorzc:password@aws-0-eu-west-1.pooler.supabase.com:5432/postgres',
    )).toThrow('PHASE1_DATABASE_ROLE_FORBIDDEN')
  })

  it('loads only a PEM CA file and keeps verification enabled', () => {
    const caFile = resolve(process.cwd(), 'certs', 'supabase-prod-ca-2021.crt')
    const ssl = readRuntimeDatabaseCa({ ZURI_LINE_DB_CA_FILE: caFile })
    const certificate = new X509Certificate(ssl.ca)

    expect(ssl).toEqual({ rejectUnauthorized: true, ca: readFileSync(caFile, 'utf8') })
    expect(certificate.fingerprint256).toBe('80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA')
    expect(() => readRuntimeDatabaseCa({})).toThrow('PHASE1_DATABASE_CA_REQUIRED')
  })
})
