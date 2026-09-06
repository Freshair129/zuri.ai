import { describe, expect, it } from 'vitest'
import {
  customerReviewRuntimeDatabaseUrlFromAdmin,
} from '../../scripts/provision-customer-review-runtime-login.mjs'

// @req FR-078 — provision only the dedicated server-side customer-review login.
// @spec ADR-018 D3, ADR-033 D8 — never reuse the migration/admin URL at runtime.
// @tested tests/unit/customer-review-runtime-login.test.js

describe('FR-078 customer review runtime login provisioning', () => {
  it('maps the project pooler admin URL to the dedicated login without changing the host', () => {
    const url = customerReviewRuntimeDatabaseUrlFromAdmin(
      'postgresql://postgres.qcnmhyglarzcpudjorzc:admin@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
      'a'.repeat(43),
    )
    const parsed = new URL(url)
    expect(parsed.username).toBe('zuri_customer_review_login.qcnmhyglarzcpudjorzc')
    expect(parsed.password).toBe('a'.repeat(43))
    expect(parsed.hostname).toBe('aws-0-ap-northeast-2.pooler.supabase.com')
  })

  it('rejects a non-project admin URL or weak runtime password', () => {
    expect(() => customerReviewRuntimeDatabaseUrlFromAdmin(
      'postgresql://postgres.other:admin@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
      'a'.repeat(43),
    )).toThrow('ADMIN_DATABASE_PROJECT_OR_ROLE_FORBIDDEN')
    expect(() => customerReviewRuntimeDatabaseUrlFromAdmin(
      'postgresql://postgres.qcnmhyglarzcpudjorzc:admin@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
      'short',
    )).toThrow('CUSTOMER_REVIEW_RUNTIME_PASSWORD_INVALID')
  })
})
