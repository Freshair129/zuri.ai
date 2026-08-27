import { beforeAll, describe, expect, it } from 'vitest'
import { resolveAgentAuthorization } from '@/modules/agent/auth-context'
import { resolveLineIdentity } from '@/modules/identity/resolve-line-identity'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'

// @req FR-057 — the per-turn AuthContext `request` envelope is server-built, and its
//   three asserted fields (capability, sensitivity, consent) each have a floor the
//   caller cannot fall below by omitting them, passing null, or passing blanks.
// @req FR-111 — `sensitivity` additionally has a CEILING: a request above what
//   AGENT_REQUESTABLE_SENSITIVITY currently authorizes is rejected, not admitted.
// @spec ADR-022 D3/D7 — the policy engine evaluates the *requested* capability and
//   sensitivity; SEC-013 — no client/model/prompt value may widen a request.
// @tested tests/integration/agent-request-envelope.test.js
//
// Why the floor cases are spelled out rather than folded into one: `capability` and
// `consent` reach their floor only through a parameter default (an omitted
// argument) and a `clean(...) ?? ...` fallback (present but nullish) — two sites, so
// each is exercised separately. `sensitivity` no longer has that split (see
// resolveRequestedSensitivity in auth-context.js), but the floor cases stay
// explicit for symmetry with the two fields that do.
//
// Why the rejection case matters: this is the behavioural half of the CEILING —
// tests/unit/agent-requestable-sensitivity.test.js proves the ceiling is a subset
// of the FR-111 lattice (vocabulary), this proves a request past the ceiling is
// actually refused (height). Widening AGENT_REQUESTABLE_SENSITIVITY without
// building the entitlement check it promises breaks this test on purpose.

let tenant
let business

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Request Envelope Group', code: 'PF-REQ-ENV' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Request Envelope Tenant', code: 'TNT-REQ-ENV' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Request Envelope Business', code: 'BUS-REQ-ENV' })
})

async function authorize(overrides) {
  const lineUserId = `U-req-env-${overrides.label}`
  await resolveLineIdentity({
    tenantId: tenant.id,
    channelAccountId: 'LINE-ACCOUNT-REQ-ENV',
    lineUserId,
  })
  return resolveAgentAuthorization({
    tenantId: tenant.id,
    businessId: business.id,
    lineUserId,
    serverScope: {
      transportVerified: true,
      channelAccountId: 'LINE-ACCOUNT-REQ-ENV',
      businessId: business.id,
    },
    ...overrides.input,
  })
}

async function requestEnvelope(overrides) {
  const { authContext } = await authorize(overrides)
  return authContext.request
}

describe('FR-057 AuthContext request envelope floors', () => {
  it('floors an omitted sensitivity at PUBLIC — the narrowest level a turn may request', async () => {
    const request = await requestEnvelope({ label: 'omitted', input: {} })
    expect(request.sensitivity).toBe('PUBLIC')
  })

  // The case the parameter default does NOT cover: the argument is present, so the
  // default never fires, and only the `clean(sensitivity) ?? 'PUBLIC'` fallback keeps
  // the envelope from carrying a null classification into the policy seam.
  it('floors an explicitly null sensitivity at PUBLIC, not at null', async () => {
    const request = await requestEnvelope({ label: 'null', input: { sensitivity: null } })
    expect(request.sensitivity).toBe('PUBLIC')
  })

  it('floors a blank sensitivity at PUBLIC', async () => {
    const request = await requestEnvelope({ label: 'blank', input: { sensitivity: '   ' } })
    expect(request.sensitivity).toBe('PUBLIC')
  })

  // capability and consent share the shape, and share the same two-path hazard.
  it('floors an explicitly null capability at READ — never a wider verb', async () => {
    const request = await requestEnvelope({ label: 'cap-null', input: { capability: null } })
    expect(request.capability).toBe('READ')
  })

  it('floors an explicitly null consent at UNKNOWN — never at granted', async () => {
    const request = await requestEnvelope({ label: 'consent-null', input: { consent: null } })
    expect(request.consent).toBe('UNKNOWN')
  })

  // The ceiling. INTERNAL specifically — not a garbage string — because it is the
  // value a well-meaning future widening (once the lattice is already in scope)
  // would reach for first: it is real, it is one step past PUBLIC, and nothing
  // behind this envelope authorizes it yet. Read as a promise, not an oversight:
  // building the entitlement check AGENT_REQUESTABLE_SENSITIVITY's comment
  // describes is what turns this red, and that is the point of writing it this way.
  it('rejects a request above the ceiling — INTERNAL is a real lattice level with nothing behind it to authorize it', async () => {
    await expect(authorize({ label: 'above-ceiling', input: { sensitivity: 'INTERNAL' } }))
      .rejects.toThrow(/sensitivity "INTERNAL" is not requestable/)
  })

  it('rejects a request for a value the lattice does not even have', async () => {
    await expect(authorize({ label: 'garbage', input: { sensitivity: 'banana' } }))
      .rejects.toThrow(/sensitivity "banana" is not requestable/)
  })
})
