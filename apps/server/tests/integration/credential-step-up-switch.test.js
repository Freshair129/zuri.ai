// @req FR-224 — the operator may suspend the credential-write step-up for an
//   installation, and only the step-up: login, both rate limits and the audit trail
//   stay in force, and anything but the exact value `off` leaves the gate on.
// @spec ADR-100 D8; ADR-089 D4; SEC-030
// @tested tests/integration/credential-step-up-switch.test.js
import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import {
  CREDENTIAL_STEP_UP_ENV,
  CREDENTIAL_STEP_UP_SUSPENDED_ACTION,
  createCredentialWriteGuard,
  isCredentialStepUpSuspended,
} from '@/modules/identity/credential-write-gate'

let business, person, viewer

const OFF = { [CREDENTIAL_STEP_UP_ENV]: 'off' }
// A Person with NO TOTP factor and a Session that was never stepped up: exactly the
// owner's state on 2026-09-21, when the key form answered MFA_FACTOR_REQUIRED.
const guard = (env) => createCredentialWriteGuard({ session: null, env })
const write = (env, action = 'ROTATE') => guard(env).assertWriteAllowed({ viewer, businessId: business.id, action })
const suspendedRows = () => prisma.auditEvent.findMany({
  where: { action: CREDENTIAL_STEP_UP_SUSPENDED_ACTION, businessId: business.id },
})

describe('credential-write step-up switch', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-STEPUP', name: 'Step-up switch' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-STEPUP', name: 'Step-up switch' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-STEPUP', name: 'Step-up switch' })
    person = await prisma.person.create({ data: { code: `PER-${randomUUID().slice(0, 8)}`, displayName: 'No factor yet' } })
    viewer = makeViewer({
      principal: { id: person.id, code: person.code, displayName: person.displayName },
      visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['line-oa'],
    })
  })

  beforeEach(async () => {
    await prisma.rateLimitBucket.deleteMany({})
    await prisma.auditEvent.deleteMany({ where: { action: CREDENTIAL_STEP_UP_SUSPENDED_ACTION, businessId: business.id } })
  })

  it('keeps the gate on by default: no factor is still MFA_FACTOR_REQUIRED', async () => {
    await expect(write({})).rejects.toMatchObject({ status: 403, code: 'MFA_FACTOR_REQUIRED' })
  })

  it('lets a logged-in Person without a factor through when the operator sets it off', async () => {
    await expect(write(OFF)).resolves.toBeUndefined()
  })

  it('records every write it lets through without a second factor, naming no credential', async () => {
    await write(OFF, 'ROTATE')
    await write(OFF, 'REVOKE')
    const rows = await suspendedRows()
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row).toMatchObject({ entityType: 'CREDENTIAL_WRITE_GATE', actorId: person.id, businessId: business.id })
    }
    const payloads = rows.map((row) => JSON.parse(row.payloadJson))
    expect(payloads.map((p) => p.credentialAction).sort()).toEqual(['REVOKE', 'ROTATE'])
    expect(payloads[0].setting).toBe(`${CREDENTIAL_STEP_UP_ENV}=off`)
    // Nothing but the action and the setting: no key, no secret, no session.
    expect(Object.keys(payloads[0]).sort()).toEqual(['credentialAction', 'setting'])
  })

  it('writes no suspension row while the gate is on', async () => {
    await write({}).catch(() => {})
    expect(await suspendedRows()).toHaveLength(0)
  })

  it('never admits a request with no logged-in Person', async () => {
    for (const anonymous of [null, {}, { principal: {} }]) {
      await expect(createCredentialWriteGuard({ session: null, env: OFF }).assertWriteAllowed({ viewer: anonymous, businessId: business.id, action: 'ROTATE' }))
        .rejects.toMatchObject({ status: 401, code: 'AUTH_REQUIRED' })
    }
    expect(await suspendedRows()).toHaveLength(0)
  })

  it('keeps the per-Person-and-Business rate limit while the step-up is suspended', async () => {
    // Five writes in fifteen minutes (FR-224); the sixth is refused, and is not
    // recorded as a suspended write, because it never got through.
    for (let i = 0; i < 5; i += 1) await write(OFF, 'VALIDATE_MODEL_KEY')
    await expect(write(OFF, 'VALIDATE_MODEL_KEY')).rejects.toMatchObject({ status: 429, code: 'CREDENTIAL_RATE_LIMITED' })
    expect(await suspendedRows()).toHaveLength(5)
  })

  it('treats only the exact value off as suspension, so a mistake fails safe', () => {
    for (const value of ['off', 'OFF', ' off ']) expect(isCredentialStepUpSuspended({ [CREDENTIAL_STEP_UP_ENV]: value })).toBe(true)
    for (const value of [undefined, '', 'on', 'false', '0', 'no', 'disabled', 'of', 'offf']) {
      expect(isCredentialStepUpSuspended({ [CREDENTIAL_STEP_UP_ENV]: value })).toBe(false)
    }
  })
})
