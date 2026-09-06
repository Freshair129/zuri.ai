import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

import prisma from '@/lib/db'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import {
  countPendingSotDecisionsByPhase,
  decideSotDecision,
  exportSotDecisions,
  hashSotPayload,
  listSotDecisions,
  submitSotDecisions,
} from '@/modules/integration/application/sot-decision-service'

// @req FR-100 — submit is idempotent by payload hash, deciding is audited and
// immutable, export is a stable-cursor pull of decided rows only.
// @tested tests/unit/sot-decision-service.test.js

const t = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
let tenantId
let businessId

function operator() {
  return makeOperatorViewer()
}

beforeAll(async () => {
  tenantId = randomUUID()
  await prisma.tenant.create({
    data: {
      id: tenantId, code: `TEN-SOT-${t}`, name: 'SoT Tenant',
      portfolio: { create: { id: randomUUID(), code: `PF-SOT-${t}`, name: 'PF' } },
    },
  })
  const business = await prisma.business.create({
    data: { id: randomUUID(), tenantId, code: `BUS-SOT-${t}`, name: 'SmartGift' },
  })
  businessId = business.id
})

function submitInput(items) {
  return { tenantId, submittedBy: 'sot-data-plane', items }
}

describe('FR-100 sot decisions — submit', () => {
  it('rejects a non-operator submitter', async () => {
    const viewer = makeViewer({ role: 'OWNER', visibleBusinessIds: [businessId], ownedBusinessIds: [businessId] })
    await expect(submitSotDecisions(submitInput([
      { decisionType: 'PRICE_ROW', subjectRef: `S-${t}-x`, payload: { a: 1 } },
    ]), { viewer })).rejects.toThrow(/installation operator/)
  })

  it('creates v1, returns UNCHANGED on identical payload, versions on a changed payload', async () => {
    const subjectRef = `BASE-${t}-1`
    const item = { businessId, decisionType: 'PRICE_ROW', subjectRef, phaseId: 'P3', payload: { base: subjectRef, tiers: [10, 100] } }

    const first = await submitSotDecisions(submitInput([item]), { viewer: operator() })
    expect(first.results[0]).toMatchObject({ outcome: 'CREATED', decisionVersion: 1, status: 'PENDING' })

    const again = await submitSotDecisions(submitInput([item]), { viewer: operator() })
    expect(again.results[0]).toMatchObject({ outcome: 'UNCHANGED', decisionVersion: 1 })

    const changed = await submitSotDecisions(submitInput([{ ...item, payload: { base: subjectRef, tiers: [10, 100, 500] } }]), { viewer: operator() })
    expect(changed.results[0]).toMatchObject({ outcome: 'CREATED', decisionVersion: 2, status: 'PENDING' })
  })

  it('payload hash is key-order independent', () => {
    expect(hashSotPayload({ a: 1, b: { c: 2, d: 3 } })).toBe(hashSotPayload({ b: { d: 3, c: 2 }, a: 1 }))
    expect(hashSotPayload({ a: 1 })).not.toBe(hashSotPayload({ a: 2 }))
  })

  it('rejects unknown envelope fields (SEC-002)', async () => {
    await expect(submitSotDecisions({ ...submitInput([{ decisionType: 'ENTITY', subjectRef: 'x', payload: {} }]), extra: true }, { viewer: operator() }))
      .rejects.toThrow()
  })

  // @req FR-102 — the data plane authenticates with a Tenant-bound service
  // account, not an installation operator grant.
  it('accepts a data-plane key bound to the submitted tenantId', async () => {
    const dataPlaneViewer = { isSotDataPlane: true, tenantId, serviceAccountId: 'sdpk-1' }
    const out = await submitSotDecisions(submitInput([
      { decisionType: 'PRICE_ROW', subjectRef: `DP-${t}-1`, payload: { a: 1 } },
    ]), { viewer: dataPlaneViewer })
    expect(out.results[0].outcome).toBe('CREATED')
  })

  it('refuses a data-plane key bound to a different tenantId', async () => {
    const foreignViewer = { isSotDataPlane: true, tenantId: randomUUID(), serviceAccountId: 'sdpk-2' }
    await expect(submitSotDecisions(submitInput([
      { decisionType: 'PRICE_ROW', subjectRef: `DP-${t}-2`, payload: { a: 1 } },
    ]), { viewer: foreignViewer })).rejects.toThrow(/installation operator/)
  })
})

describe('FR-100 sot decisions — decide', () => {
  async function pendingDecision(subjectRef) {
    const out = await submitSotDecisions(submitInput([
      { businessId, decisionType: 'ENTITY', subjectRef, phaseId: 'P3', payload: { name: subjectRef } },
    ]), { viewer: operator() })
    return out.results[0].id
  }

  it('a business owner approves; the row becomes immutable and audited', async () => {
    const id = await pendingDecision(`ENT-${t}-appr`)
    const owner = makeViewer({ role: 'OWNER', visibleBusinessIds: [businessId], ownedBusinessIds: [businessId] })

    const decided = await decideSotDecision(id, { decision: 'APPROVED' }, { viewer: owner })
    expect(decided.status).toBe('APPROVED')
    expect(decided.decidedAt).toBeTruthy()
    // resolveViewer returns `{ principal: { id }, ... }`, never a top-level
    // personId — `viewer?.personId` reads as undefined through the real route,
    // which is exactly the bug this asserts against (found while building
    // FR-103's customer-consent-service.js, which needed the same field).
    expect(decided.decidedByPersonId).toBe(owner.principal.id)

    const row = await prisma.sotDecision.findUnique({ where: { id } })
    expect(row.decidedByPersonId).toBe(owner.principal.id)
    expect(row.auditEventId).toBeTruthy()
    const audit = await prisma.auditEvent.findUnique({ where: { id: row.auditEventId } })
    expect(audit.action).toBe('SOT_DECISION_APPROVED')
    expect(audit.actorId).toBe(owner.principal.id)

    await expect(decideSotDecision(id, { decision: 'REJECTED', reason: 'x' }, { viewer: owner }))
      .rejects.toThrow(/already decided/)
  })

  it('rejecting requires a reason; a non-owner viewer is refused', async () => {
    const id = await pendingDecision(`ENT-${t}-rej`)
    const owner = makeViewer({ role: 'OWNER', visibleBusinessIds: [businessId], ownedBusinessIds: [businessId] })
    await expect(decideSotDecision(id, { decision: 'REJECTED' }, { viewer: owner })).rejects.toThrow(/reason/)

    const stranger = makeViewer({ role: 'MEMBER', visibleBusinessIds: [businessId], ownedBusinessIds: [] })
    await expect(decideSotDecision(id, { decision: 'APPROVED' }, { viewer: stranger })).rejects.toThrow(/authority/)
  })
})

describe('FR-100 sot decisions — list, counts and export', () => {
  it('pending counts group by phase', async () => {
    const subjectRef = `CNT-${t}-1`
    await submitSotDecisions(submitInput([
      { businessId, decisionType: 'FILE_CLASSIFICATION', subjectRef, phaseId: 'P0', payload: { f: 1 } },
    ]), { viewer: operator() })
    const counts = await countPendingSotDecisionsByPhase(tenantId)
    expect(counts.get('P0')).toBeGreaterThanOrEqual(1)
  })

  it('list is scope-checked and filterable', async () => {
    const owner = makeViewer({ role: 'OWNER', visibleBusinessIds: [businessId], ownedBusinessIds: [businessId] })
    const { decisions } = await listSotDecisions({ tenantId, businessId, status: 'PENDING' }, { viewer: owner })
    expect(decisions.every((d) => d.status === 'PENDING')).toBe(true)

    const stranger = makeViewer({ role: 'MEMBER', visibleBusinessIds: [], ownedBusinessIds: [] })
    await expect(listSotDecisions({ tenantId, businessId }, { viewer: stranger })).rejects.toThrow(/scope/)
  })

  it('export returns only decided rows, in stable cursor order, resumable', async () => {
    const owner = makeViewer({ role: 'OWNER', visibleBusinessIds: [businessId], ownedBusinessIds: [businessId] })
    const refs = [`EXP-${t}-a`, `EXP-${t}-b`, `EXP-${t}-c`]
    for (const subjectRef of refs) {
      const out = await submitSotDecisions(submitInput([
        { businessId, decisionType: 'PRICE_ROW', subjectRef, phaseId: 'P3', payload: { p: subjectRef } },
      ]), { viewer: operator() })
      await decideSotDecision(out.results[0].id, { decision: 'APPROVED' }, { viewer: owner })
    }

    await expect(exportSotDecisions({ tenantId }, { viewer: owner })).rejects.toThrow(/installation operator/)

    const first = await exportSotDecisions({ tenantId, limit: 2 }, { viewer: operator() })
    expect(first.decisions.length).toBe(2)
    expect(first.decisions.every((d) => d.status !== 'PENDING')).toBe(true)

    const rest = await exportSotDecisions({ tenantId, since: first.nextCursor }, { viewer: operator() })
    const all = [...first.decisions, ...rest.decisions].map((d) => d.id)
    expect(new Set(all).size).toBe(all.length)
    const exported = new Set([...first.decisions, ...rest.decisions].map((d) => d.subjectRef))
    for (const subjectRef of refs) expect(exported.has(subjectRef)).toBe(true)
  })

  // @req FR-102 — the same Tenant-bound data-plane key that may submit may
  // also pull its own tenant's decided rows; a foreign tenant's key may not.
  it('a data-plane key exports only its own tenant', async () => {
    const dataPlaneViewer = { isSotDataPlane: true, tenantId, serviceAccountId: 'sdpk-3' }
    const out = await exportSotDecisions({ tenantId, limit: 1 }, { viewer: dataPlaneViewer })
    expect(out.decisions.length).toBeLessThanOrEqual(1)

    const foreignViewer = { isSotDataPlane: true, tenantId: randomUUID(), serviceAccountId: 'sdpk-4' }
    await expect(exportSotDecisions({ tenantId }, { viewer: foreignViewer })).rejects.toThrow(/installation operator/)
  })
})
