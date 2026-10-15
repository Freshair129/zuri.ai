import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DOMAIN_GROUPS, DOMAINS } from '@/config/domains'
import { ROLE_CONFLICTS, ROLE_PERMISSIONS } from '@/modules/identity/rbac'
import {
  STANDARD_BUSINESS_APPLICATION_ROLES,
  STANDARD_BUSINESS_DOMAINS,
  STANDARD_BUSINESS_ROLE_CONFLICTS,
  STANDARD_BUSINESS_SCHEMA_VERSION,
  STANDARD_BUSINESS_SPACE_KEY,
  STANDARD_BUSINESS_TEMPLATE_ID,
  STANDARD_BUSINESS_TEMPLATE_VERSION,
  buildStandardBusinessTemplate,
  canonicalBusinessJson,
  standardBusinessSnapshotDigest,
  validateStoredBusinessProvisioning,
} from '@/modules/project-manager/application/business-provisioning-template'

// @req FR-286 — v1 is a pinned catalogue snapshot, not a grant.
// @spec FR-169, FR-191, FR-192
// @tested tests/integration/business-provisioning-template.test.js

const expectedScope = { businessId: 'business-a', tenantId: 'tenant-a', portfolioId: 'portfolio-a' }

function storedBusiness(snapshot, overrides = {}) {
  return {
    id: expectedScope.businessId,
    tenantId: expectedScope.tenantId,
    tenant: { id: expectedScope.tenantId, portfolioId: expectedScope.portfolioId },
    provisioningTemplateId: STANDARD_BUSINESS_TEMPLATE_ID,
    provisioningTemplateVersion: STANDARD_BUSINESS_TEMPLATE_VERSION,
    provisioningTemplateDigest: standardBusinessSnapshotDigest(snapshot),
    provisioningSnapshotJson: canonicalBusinessJson(snapshot),
    ...overrides,
  }
}

function standardSpace(overrides = {}) {
  return {
    id: 'space-a',
    scopeType: 'BUSINESS',
    businessId: expectedScope.businessId,
    tenantId: expectedScope.tenantId,
    portfolioId: expectedScope.portfolioId,
    provisioningKey: STANDARD_BUSINESS_SPACE_KEY,
    ...overrides,
  }
}

describe('FR-286 pinned Standard Business template', () => {
  it('matches the current domain and application role catalogues at v1 introduction', () => {
    const reserved = new Set(['operations', 'warehouse', 'platform'])
    const currentGrantableDomains = DOMAINS.map(({ key }) => key).filter((key) => !reserved.has(key))

    expect(currentGrantableDomains).toEqual(STANDARD_BUSINESS_DOMAINS)
    expect(DOMAIN_GROUPS.map(({ key }) => key).some((key) => STANDARD_BUSINESS_DOMAINS.includes(key))).toBe(false)
    expect(STANDARD_BUSINESS_APPLICATION_ROLES).toEqual(ROLE_PERMISSIONS)
    expect(STANDARD_BUSINESS_ROLE_CONFLICTS).toEqual(ROLE_CONFLICTS)
    expect(Object.isFrozen(STANDARD_BUSINESS_DOMAINS)).toBe(true)
    expect(Object.isFrozen(STANDARD_BUSINESS_APPLICATION_ROLES.SALES_REP)).toBe(true)
  })

  it('builds a deterministic full-scope catalog snapshot and digest', () => {
    const snapshot = buildStandardBusinessTemplate(expectedScope)

    expect(snapshot).toMatchObject({
      schemaVersion: STANDARD_BUSINESS_SCHEMA_VERSION,
      templateId: STANDARD_BUSINESS_TEMPLATE_ID,
      templateVersion: STANDARD_BUSINESS_TEMPLATE_VERSION,
      scope: expectedScope,
      domains: STANDARD_BUSINESS_DOMAINS,
      applicationRoles: STANDARD_BUSINESS_APPLICATION_ROLES,
      roleConflicts: STANDARD_BUSINESS_ROLE_CONFLICTS,
    })
    expect(standardBusinessSnapshotDigest(snapshot)).toBe(
      standardBusinessSnapshotDigest(JSON.parse(canonicalBusinessJson(snapshot))),
    )
    expect(() => buildStandardBusinessTemplate({ ...expectedScope, portfolioId: '' }))
      .toThrow('BUSINESS_PROVISIONING_SCOPE_INVALID')
  })

  it('accepts a valid stored v1 snapshot using its pinned definition after live catalog drift', () => {
    const snapshot = buildStandardBusinessTemplate(expectedScope)
    const business = storedBusiness(snapshot)
    const workspace = standardSpace()
    const laterLiveCatalog = [...DOMAINS.map(({ key }) => key), 'later-domain']
    expect(laterLiveCatalog).not.toEqual(STANDARD_BUSINESS_DOMAINS)

    expect(validateStoredBusinessProvisioning(business, workspace)).toMatchObject({
      status: 'VALID',
      templateId: STANDARD_BUSINESS_TEMPLATE_ID,
      templateVersion: STANDARD_BUSINESS_TEMPLATE_VERSION,
      digest: business.provisioningTemplateDigest,
      snapshot,
    })

    const implementation = readFileSync(fileURLToPath(new URL(
      '../../src/modules/project-manager/application/business-provisioning-template.js',
      import.meta.url,
    )), 'utf8')
    expect(implementation).not.toMatch(/from ['"]@\/(?:config\/domains|modules\/identity\/rbac)/)
  })

  it('accepts only a fully unmarked legacy Business with no standard Space key', () => {
    const legacy = {
      id: expectedScope.businessId,
      tenantId: expectedScope.tenantId,
      provisioningTemplateId: null,
      provisioningTemplateVersion: null,
      provisioningTemplateDigest: null,
      provisioningSnapshotJson: null,
    }
    expect(validateStoredBusinessProvisioning(legacy, null)).toEqual({ status: 'UNMARKED' })
    expect(validateStoredBusinessProvisioning(legacy, { provisioningKey: null })).toEqual({ status: 'UNMARKED' })
    expect(() => validateStoredBusinessProvisioning(legacy, standardSpace()))
      .toThrow('BUSINESS_PROVISIONING_CORRUPT')
  })

  it.each([
    ['partial marker', { provisioningTemplateDigest: null }, standardSpace()],
    ['wrong Business', { id: 'business-b' }, standardSpace()],
    ['wrong Tenant ancestry', { tenant: { id: 'tenant-a', portfolioId: 'other-portfolio' } }, standardSpace()],
    ['wrong Space key', {}, standardSpace({ provisioningKey: 'OTHER' })],
    ['wrong Space ancestry', {}, standardSpace({ portfolioId: 'other-portfolio' })],
    ['tampered snapshot with recomputed digest', {}, standardSpace()],
  ])('refuses %s without changing persisted input', (label, businessOverrides, workspace) => {
    const snapshot = buildStandardBusinessTemplate(expectedScope)
    const changed = structuredClone(snapshot)
    if (label === 'tampered snapshot with recomputed digest') {
      changed.applicationRoles.PRODUCT_OWNER.push('business.admin')
      businessOverrides.provisioningTemplateDigest = standardBusinessSnapshotDigest(changed)
      businessOverrides.provisioningSnapshotJson = canonicalBusinessJson(changed)
    }
    const business = storedBusiness(snapshot, businessOverrides)
    const before = structuredClone(business)
    expect(() => validateStoredBusinessProvisioning(business, workspace))
      .toThrow('BUSINESS_PROVISIONING')
    expect(business).toEqual(before)
  })

  it('uses a version conflict for unsupported stored versions', () => {
    const snapshot = buildStandardBusinessTemplate(expectedScope)
    const business = storedBusiness(snapshot, { provisioningTemplateVersion: '2.0.0' })
    expect(() => validateStoredBusinessProvisioning(business, standardSpace()))
      .toThrow('BUSINESS_PROVISIONING_VERSION_CONFLICT')
  })
})
