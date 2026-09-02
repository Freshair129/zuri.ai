import { describe, expect, it, vi, beforeEach } from 'vitest'
import { makeViewer, ownsElsewhere } from '../factories/viewer'

// @req FR-103 — SEC-005 PDPA consent attestation: owner-gated, tenant-scoped
// through the caller's own Business, held without a database.
// @spec SDD-053, BR-001, SEC-005

const calls = { businessFind: 0, customerFind: 0, update: 0, audit: 0, transaction: 0 }
let businessRow = null
let customerRow = null

vi.mock('@/lib/db', () => ({
  default: {
    business: {
      findUnique: async () => {
        calls.businessFind += 1
        return businessRow
      },
    },
    customer: {
      findFirst: async () => {
        calls.customerFind += 1
        return customerRow
      },
    },
    $transaction: async (fn) => {
      calls.transaction += 1
      return fn({
        auditEvent: {
          create: async ({ data }) => {
            calls.audit += 1
            return { id: 'audit-1', ...data }
          },
        },
        customer: {
          update: async ({ data }) => {
            calls.update += 1
            return { id: customerRow.id, code: customerRow.code, displayName: customerRow.displayName, ...data }
          },
        },
      })
    },
  },
}))

const { recordCustomerConsent, zRecordCustomerConsent } = await import('@/modules/crm/customer-consent-service')

// @req FR-061 — consent is a CRM action, so the service now asks for the per-Business
// `customer` grant before it asks about ownership. Every fixture here states that grant
// explicitly: without it these cases would be refused by the domain gate and would stop
// testing the ownership rule they are named for. `tests/integration/domain-visibility-server.test.js`
// is where the gate itself is proved.
const CRM_DOMAINS = ['customer', 'projects', 'people', 'platform']

const owner = () => makeViewer({ ownedBusinessIds: ['b-1'], visibleBusinessIds: ['b-1'], visibleDomains: CRM_DOMAINS })

beforeEach(() => {
  calls.businessFind = 0
  calls.customerFind = 0
  calls.update = 0
  calls.audit = 0
  calls.transaction = 0
  businessRow = { id: 'b-1', tenantId: 't-1' }
  customerRow = { id: 'cust-1', code: 'CUST-1', displayName: 'คุณสมชาย', consentStatus: 'PENDING' }
})

describe('consent attestation contract', () => {
  it('accepts GRANTED and DECLINED only', () => {
    expect(zRecordCustomerConsent.parse({ businessId: 'b-1', status: 'GRANTED' }).status).toBe('GRANTED')
    expect(zRecordCustomerConsent.parse({ businessId: 'b-1', status: 'DECLINED' }).status).toBe('DECLINED')
  })

  it('refuses PENDING and GRANDFATHERED — those are never something a staff member attests', () => {
    expect(() => zRecordCustomerConsent.parse({ businessId: 'b-1', status: 'PENDING' })).toThrow()
    expect(() => zRecordCustomerConsent.parse({ businessId: 'b-1', status: 'GRANDFATHERED' })).toThrow()
  })

  it('refuses an unknown field instead of ignoring it', () => {
    expect(() => zRecordCustomerConsent.parse({ businessId: 'b-1', status: 'GRANTED', tenantId: 't-1' })).toThrow()
  })

  it('refuses a note longer than the field allows', () => {
    expect(() =>
      zRecordCustomerConsent.parse({ businessId: 'b-1', status: 'GRANTED', note: 'a'.repeat(1001) }),
    ).toThrow()
  })
})

describe('recordCustomerConsent authorization', () => {
  it('refuses a Member — recording consent requires owning the Business, not merely seeing it', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: [], visibleDomains: CRM_DOMAINS })
    await expect(
      recordCustomerConsent('cust-1', { businessId: 'b-1', status: 'GRANTED' }, { viewer }),
    ).rejects.toMatchObject({ status: 403 })
    expect(calls.businessFind).toBe(0) // authorization runs before any read
    expect(calls.transaction).toBe(0)
  })

  it('refuses an owner of a different Business, even though the target Business is visible', async () => {
    const viewer = ownsElsewhere({ owns: 'b-2', sees: 'b-1', visibleDomains: CRM_DOMAINS })
    await expect(
      recordCustomerConsent('cust-1', { businessId: 'b-1', status: 'GRANTED' }, { viewer }),
    ).rejects.toMatchObject({ status: 403 })
    expect(calls.transaction).toBe(0)
  })

  it('allows the Business owner', async () => {
    const result = await recordCustomerConsent('cust-1', { businessId: 'b-1', status: 'GRANTED' }, { viewer: owner() })
    expect(result.consentStatus).toBe('GRANTED')
    expect(calls.transaction).toBe(1)
  })
})

describe('recordCustomerConsent scope', () => {
  it('404s when the named Business does not exist, before reading Customer at all', async () => {
    businessRow = null
    await expect(
      recordCustomerConsent('cust-1', { businessId: 'b-1', status: 'GRANTED' }, { viewer: owner() }),
    ).rejects.toMatchObject({ status: 404 })
    expect(calls.customerFind).toBe(0)
  })

  it('404s when the Customer is outside this Business tenant — the lookup itself is the bound, not a check after', async () => {
    customerRow = null
    await expect(
      recordCustomerConsent('cust-1', { businessId: 'b-1', status: 'GRANTED' }, { viewer: owner() }),
    ).rejects.toMatchObject({ status: 404 })
    expect(calls.transaction).toBe(0)
  })

  it('400s when no customerId is supplied, and never reaches the database', async () => {
    await expect(
      recordCustomerConsent('', { businessId: 'b-1', status: 'GRANTED' }, { viewer: owner() }),
    ).rejects.toMatchObject({ status: 400 })
    expect(calls.businessFind).toBe(0)
  })
})

describe('recordCustomerConsent write', () => {
  it('records the attesting Person, an audit event, and an optional note', async () => {
    const viewer = makeViewer({ ownedBusinessIds: ['b-1'], visibleBusinessIds: ['b-1'], visibleDomains: CRM_DOMAINS, principal: { id: 'per-owner' } })
    const result = await recordCustomerConsent(
      'cust-1',
      { businessId: 'b-1', status: 'DECLINED', note: 'ลูกค้าขอไม่ให้เก็บข้อมูล' },
      { viewer },
    )
    expect(result.consentStatus).toBe('DECLINED')
    expect(result.consentRecordedByPersonId).toBe('per-owner')
    expect(result.auditEventId).toBe('audit-1')
    expect(calls.audit).toBe(1)
    expect(calls.update).toBe(1)
  })

  it('never trusts a caller-supplied tenantId — scope comes only from the resolved Business', async () => {
    // The contract has no tenantId field at all; this proves it by omission —
    // an extra field is rejected by .strict(), covered above, and the resolved
    // scope always comes from `business.tenantId`, never from the input.
    expect(Object.keys(zRecordCustomerConsent.shape)).toEqual(['businessId', 'status', 'note'])
  })
})
