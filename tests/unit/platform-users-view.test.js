// @req FR-038 — the add-member form's pure decisions: which Businesses it
// offers, what it refuses to submit, and what each server refusal says.
// @req FR-106 — the Enterprise API key panel's pure decisions: the row model,
// who sees the panel at all, and the guarantee that no row carries key material.
// @spec SDD-017, SEC-001, SEC-006
// @tested tests/unit/platform-users-view.test.js
import { describe, expect, it } from 'vitest'
import { DOMAINS } from '@/config/domains'
import {
  DOMAIN_OPTIONS,
  apiKeyRow,
  buildApiKeyPanel,
  carriesKeyMaterial,
  describeInviteFailure,
  inviteBusinessOptions,
  validateMemberInvite,
} from '@/modules/identity/platform-users-view'

const businesses = [
  { id: 'biz-1', code: 'BUS-1', name: 'ธุรกิจหนึ่ง' },
  { id: 'biz-2', code: 'BUS-2', name: 'ธุรกิจสอง' },
]

describe('inviteBusinessOptions', () => {
  it('opens on the Business the shell has active', () => {
    const { options, defaultId } = inviteBusinessOptions({ businesses, activeBusinessId: 'biz-2' })
    expect(options.map((option) => option.id)).toEqual(['biz-1', 'biz-2'])
    expect(defaultId).toBe('biz-2')
  })

  it('falls back to the first option when no Business is active', () => {
    expect(inviteBusinessOptions({ businesses }).defaultId).toBe('biz-1')
  })

  // The Business the shell reports active can be one the roster does not
  // mention: FR-074(c) binds a Business's creator *tenant-wide*, so a freshly
  // created Business legitimately holds zero per-Business Membership rows.
  // Deriving the options from the roster would have hidden exactly the Business
  // an owner most wants to staff.
  it('never returns an id the caller cannot see, and stays empty with no inventory', () => {
    expect(inviteBusinessOptions({ businesses: [], activeBusinessId: 'biz-9' })).toEqual({ options: [], defaultId: null })
    expect(inviteBusinessOptions({}).defaultId).toBeNull()
  })

  it('labels a Business without a name by its code', () => {
    const { options } = inviteBusinessOptions({ businesses: [{ id: 'biz-3', code: 'BUS-3' }] })
    expect(options[0].label).toBe('BUS-3')
  })
})

describe('validateMemberInvite', () => {
  it('refuses a submission with no Business and no identifier', () => {
    expect(validateMemberInvite({ identifier: 'PER-1' }).ok).toBe(false)
    expect(validateMemberInvite({ businessId: 'biz-1', identifier: '   ' })).toMatchObject({ ok: false })
  })

  it('trims the identifier, because a pasted trailing space would fail an exact match invisibly', () => {
    expect(validateMemberInvite({ businessId: 'biz-1', identifier: '  a@b.co \n' }).payload)
      .toEqual({ businessId: 'biz-1', identifier: 'a@b.co', domainKeys: [] })
  })

  it('drops an unknown domain key rather than killing the whole submission', () => {
    const result = validateMemberInvite({ businessId: 'biz-1', identifier: 'PER-1', domainKeys: ['projects', 'not-a-domain'] })
    expect(result.ok).toBe(true)
    expect(result.payload.domainKeys).toEqual(['projects'])
  })

  it('offers exactly the domain registry as checkboxes', () => {
    expect(DOMAIN_OPTIONS.map((option) => option.key)).toEqual(DOMAINS.map((domain) => domain.key))
  })
})

describe('describeInviteFailure', () => {
  // These two must not read alike: "that Business is not yours" and "that
  // person has no account" call for completely different next steps.
  it('separates a missing Person from a Business outside the caller scope', () => {
    const person = describeInviteFailure(Object.assign(new Error('PERSON_NOT_FOUND'), { status: 404 }))
    const scope = describeInviteFailure(Object.assign(new Error('Membership is outside your owned scope'), { status: 404 }))
    expect(person).toContain('ไม่พบบุคคล')
    expect(scope).toContain('ไม่พบธุรกิจ')
    expect(person).not.toBe(scope)
  })

  it('names the duplicate case', () => {
    expect(describeInviteFailure(Object.assign(new Error('MEMBERSHIP_ALREADY_EXISTS'), { status: 409 })))
      .toContain('เป็นสมาชิกของธุรกิจนี้อยู่แล้ว')
  })

  it('passes an unrecognised message through instead of swallowing it', () => {
    expect(describeInviteFailure(new Error('Validation failed: identifier: Required')))
      .toContain('Validation failed')
    expect(describeInviteFailure(new Error(''))).toBe('เพิ่มสมาชิกไม่สำเร็จ')
  })
})

describe('apiKeyRow', () => {
  const active = { id: 'k-1', label: 'erp', tenantId: 'tnt-1', keyPrefix: 'apik_AbCdEfGh', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00.000Z' }

  it('shows the display prefix and offers revoke for an active key', () => {
    const row = apiKeyRow(active)
    expect(row.prefix).toBe('apik_AbCdEfGh…')
    expect(row.canRevoke).toBe(true)
    expect(row.statusLabel).toBe('ใช้งานอยู่')
  })

  // Re-revoking is a no-op the service reports as `revoked: false`, which reads
  // as a failure to the person who pressed it.
  it('shows a revoked key without a live revoke button', () => {
    const row = apiKeyRow({ ...active, status: 'REVOKED', revokedAt: '2026-09-02T00:00:00.000Z' })
    expect(row.canRevoke).toBe(false)
    expect(row.revoked).toBe(true)
    expect(row.statusLabel).toBe('ถูกเพิกถอนแล้ว')
  })

  // The whole design of FR-106 rests on the raw key existing exactly once. This
  // rebuilds the row field by field rather than spreading, so a secret arriving
  // in the payload — a future server change, a mint result reused as a list row
  // — cannot reach the DOM by being carried through.
  it('drops key material even when the payload carries it', () => {
    const row = apiKeyRow({ ...active, key: 'apik_RAW_SECRET_VALUE', keyHash: 'deadbeef' })
    expect(carriesKeyMaterial(active)).toBe(false)
    expect(carriesKeyMaterial(row)).toBe(false)
    expect(JSON.stringify(row)).not.toContain('RAW_SECRET_VALUE')
    expect(JSON.stringify(row)).not.toContain('deadbeef')
  })
})

describe('buildApiKeyPanel', () => {
  const tenants = [{ id: 'tnt-1', code: 'TNT-1', name: 'เทแนนต์หนึ่ง' }]
  const keys = [
    { id: 'k-1', label: 'erp', tenantId: 'tnt-1', keyPrefix: 'apik_11111111', status: 'ACTIVE' },
    { id: 'k-2', label: 'old', tenantId: 'tnt-1', keyPrefix: 'apik_22222222', status: 'REVOKED' },
  ]

  it('hides itself for a viewer the routes would refuse', () => {
    // Exactly what listApiAccessKeys returns for a caller who is neither the
    // installation operator nor a tenant-wide owner.
    expect(buildApiKeyPanel({ tenants: [], keys: [] }).available).toBe(false)
    expect(buildApiKeyPanel({}).available).toBe(false)
  })

  it('labels each row by its Tenant and counts only the live keys', () => {
    const panel = buildApiKeyPanel({ tenants, keys })
    expect(panel.available).toBe(true)
    expect(panel.defaultTenantId).toBe('tnt-1')
    expect(panel.rows.map((row) => row.tenantLabel)).toEqual(['เทแนนต์หนึ่ง', 'เทแนนต์หนึ่ง'])
    expect(panel.activeCount).toBe(1)
    expect(panel.rows.some((row) => carriesKeyMaterial(row))).toBe(false)
  })
})
