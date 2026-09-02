import { describe, it, expect } from 'vitest'
import { eraseCustomerPrincipal } from '@/modules/identity/erase-customer-principal'
import { makeViewer } from '../factories/viewer'

// @req FR-022 — the confirmation gate on PDPA erasure.
// @spec SEC-001, SEC-005
//
// The db handed in here throws on every access. That is the assertion, not a
// convenience: a confirmation check that ran *after* the lookup would still return
// 400, and this test would still pass — while a mis-wired client had already been
// told that a particular Customer exists, and a bug one refactor away would have
// erased it. Making the stub explode proves the gate is reached first.

const explodingDb = new Proxy({}, {
  get(_target, model) {
    throw new Error(`the erasure gate touched the database (db.${String(model)}) before confirming`)
  },
})

const owner = () => makeViewer({ role: 'OWNER', visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })

describe('PDPA erasure confirmation gate (FR-022)', () => {
  it('refuses a request with no confirmation at all, before any lookup', async () => {
    await expect(
      eraseCustomerPrincipal('cus-1', { businessId: 'b-1' }, { viewer: owner(), db: explodingDb }),
    ).rejects.toMatchObject({ name: 'ZodError' })
  })

  it('refuses the wrong word with 400 and says which word is required', async () => {
    await expect(
      eraseCustomerPrincipal('cus-1', { businessId: 'b-1', confirmation: 'erase' }, { viewer: owner(), db: explodingDb }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('ERASE') })
  })

  it('is case-sensitive and does not accept a near miss', async () => {
    for (const near of ['Erase', 'ERASE ', 'ERASED', 'yes', '']) {
      await expect(
        eraseCustomerPrincipal('cus-1', { businessId: 'b-1', confirmation: near }, { viewer: owner(), db: explodingDb }),
      ).rejects.toMatchObject({ status: 400 })
    }
  })

  it('rejects an unknown field rather than ignoring it', async () => {
    // `strict()` matters here more than usual: a client that sent `{ confirm: 'ERASE' }`
    // must be told it sent nothing, not have the field silently dropped and then be
    // refused for a reason that does not name the real mistake.
    await expect(
      eraseCustomerPrincipal(
        'cus-1',
        { businessId: 'b-1', confirmation: 'ERASE', reason: 'ลูกค้าขอให้ลบ' },
        { viewer: owner(), db: explodingDb },
      ),
    ).rejects.toMatchObject({ name: 'ZodError' })
  })

  it('requires a customer id before anything else', async () => {
    await expect(
      eraseCustomerPrincipal('', { businessId: 'b-1', confirmation: 'ERASE' }, { viewer: owner(), db: explodingDb }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('refuses a viewer who does not own the named Business as not-found, still without a lookup', async () => {
    // Authority is a pure predicate over the viewer, so it too is decided before the
    // database is reached — and it answers 404, disclosing nothing about the target.
    const member = makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: [] })
    await expect(
      eraseCustomerPrincipal('cus-1', { businessId: 'b-1', confirmation: 'ERASE' }, { viewer: member, db: explodingDb }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
