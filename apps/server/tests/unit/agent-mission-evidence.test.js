import { beforeEach, describe, expect, it } from 'vitest'
import { canonicalJson, sha256 } from '@/modules/agent/execution-trace'
import { createMissionEvidencePort } from '@/modules/agent/mission-evidence'

const ids = Object.freeze({
  proposal: '11111111-1111-4111-8111-111111111111',
  sourceTurn: '22222222-2222-4222-8222-222222222222',
  confirmation: '33333333-3333-4333-8333-333333333333',
  inbound: '44444444-4444-4444-8444-444444444444',
  actor: '55555555-5555-4555-8555-555555555555',
  tenant: '66666666-6666-4666-8666-666666666666',
  business: '77777777-7777-4777-8777-777777777777',
  project: '88888888-8888-4888-8888-888888888888',
  workstream: '99999999-9999-4999-8999-999999999999',
  execution: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  trace: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  traceEvent: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
})

const missionSnapshot = Object.freeze({ title: 'Review customer onboarding flow', status: 'PLANNED' })
const missionDigest = sha256(canonicalJson(missionSnapshot))

function producerSource(overrides = {}) {
  return {
    proposalId: ids.proposal,
    confirmationJobId: ids.confirmation,
    origin: 'HUMAN_AUTHORED',
    actorId: ids.actor,
    sourceTurnId: ids.sourceTurn,
    executionId: ids.execution,
    scope: { tenantId: ids.tenant, businessId: ids.business, projectId: ids.project, workstreamId: ids.workstream },
    confirmation: { jobId: ids.confirmation, inboundId: ids.inbound, actorId: ids.actor, identityVersion: '7' },
    missionSnapshot,
    ...overrides,
  }
}

function createMemoryRepository() {
  const rows = new Map()
  let currentSource = producerSource()
  let readResult = null
  const repository = {
    rows,
    setSource(source) { currentSource = source },
    setReadResult(result) { readResult = result },
    async transaction(callback) {
      return callback({
        resolveConfirmedMissionSource: async refs => {
          expect(refs).toEqual({ proposalId: ids.proposal, confirmationJobId: ids.confirmation })
          return currentSource
        },
        findByIdempotencyKey: async key => rows.get(key) ?? null,
        insertImmutable: async row => {
          if (rows.has(row.idempotencyKey)) throw Object.assign(new Error('unique'), { code: 'P2002' })
          rows.set(row.idempotencyKey, structuredClone(row))
          return rows.get(row.idempotencyKey)
        },
      })
    },
    async findByIdempotencyKey(key) { return rows.get(key) ?? null },
    async authorizedRead({ evidenceId }) {
      if (readResult) return readResult
      const evidence = [...rows.values()].find(row => row.evidenceId === evidenceId)
      return evidence ? { status: 'found', evidence } : { status: 'unavailable' }
    },
  }
  return repository
}

describe('Agent mission evidence port (PM-MISSION-02)', () => {
  let repository
  let port

  beforeEach(() => {
    repository = createMemoryRepository()
    port = createMissionEvidencePort({ repository })
  })

  it('records a human-authored source only after repository-confirmed distinct human confirmation', async () => {
    const result = await port.recordConfirmed({ proposalId: ids.proposal, confirmationJobId: ids.confirmation })
    expect(result).toMatchObject({ status: 'verified', duplicate: false, evidence: {
      origin: 'HUMAN_AUTHORED', actorId: ids.actor, digest: missionDigest,
      source: { turnId: ids.sourceTurn, executionId: ids.execution },
      confirmation: { jobId: ids.confirmation, inboundId: ids.inbound, actorId: ids.actor },
      scope: { tenantId: ids.tenant, businessId: ids.business, projectId: ids.project, workstreamId: ids.workstream },
    } })
    expect(result.evidence).not.toHaveProperty('missionSnapshot')
    expect([...repository.rows.values()][0]).not.toHaveProperty('missionSnapshot')
  })

  it('does not accept caller-supplied identity or scope as authority', async () => {
    const result = await port.recordConfirmed({ proposalId: ids.proposal, confirmationJobId: ids.confirmation,
      actorId: ids.tenant, scope: { tenantId: ids.tenant, businessId: ids.tenant } })
    expect(result.evidence.actorId).toBe(ids.actor)
    expect(result.evidence.scope.businessId).toBe(ids.business)
  })

  it('returns the same immutable evidence on an exact retry and conflicts on changed confirmation', async () => {
    const first = await port.recordConfirmed({ proposalId: ids.proposal, confirmationJobId: ids.confirmation })
    const retry = await port.recordConfirmed({ proposalId: ids.proposal, confirmationJobId: ids.confirmation })
    expect(retry).toMatchObject({ duplicate: true, evidence: { evidenceId: first.evidence.evidenceId } })

    repository.setSource(producerSource({ confirmation: { jobId: ids.confirmation, inboundId: ids.inbound,
      actorId: ids.tenant, identityVersion: '7' } }))
    await expect(port.recordConfirmed({ proposalId: ids.proposal, confirmationJobId: ids.confirmation }))
      .rejects.toMatchObject({ code: 'MISSION_EVIDENCE_CONFIRMATION_INVALID' })
  })

  it('accepts Agent provenance only for a persisted draft bound to the same turn, execution, actor, scope, and digest', async () => {
    const source = producerSource({ origin: 'AGENT_DRAFT_HUMAN_CONFIRMED', agentDraft: {
      authority: 'SERVER_PERSISTED_DRAFT', turnId: ids.sourceTurn, executionId: ids.execution,
      actorId: ids.actor, scope: { tenantId: ids.tenant, businessId: ids.business, projectId: ids.project, workstreamId: ids.workstream },
      traceId: ids.trace, eventId: ids.traceEvent, revision: 2, digest: missionDigest,
    } })
    repository.setSource(source)
    const recorded = await port.recordConfirmed({ proposalId: ids.proposal, confirmationJobId: ids.confirmation })
    expect(recorded.evidence).toMatchObject({ origin: 'AGENT_DRAFT_HUMAN_CONFIRMED', agentDraft: {
      traceId: ids.trace, eventId: ids.traceEvent, revision: 2, digest: missionDigest,
    } })

    repository.setSource(producerSource({ origin: 'AGENT_DRAFT_HUMAN_CONFIRMED' }))
    await expect(port.recordConfirmed({ proposalId: ids.proposal, confirmationJobId: ids.confirmation }))
      .rejects.toMatchObject({ code: 'MISSION_EVIDENCE_DRAFT_UNVERIFIED' })
  })

  it.each([
    [producerSource({ confirmation: { jobId: ids.sourceTurn, inboundId: ids.inbound, actorId: ids.actor, identityVersion: '7' } }), 'MISSION_EVIDENCE_CONFIRMATION_INVALID'],
    [producerSource({ origin: 'AGENT_DRAFT_HUMAN_CONFIRMED', agentDraft: {
      authority: 'SERVER_PERSISTED_DRAFT', turnId: ids.sourceTurn, executionId: ids.execution, actorId: ids.actor,
      scope: { tenantId: ids.tenant, businessId: ids.business, projectId: ids.tenant, workstreamId: ids.workstream },
      traceId: ids.trace, eventId: ids.traceEvent, revision: 1, digest: missionDigest,
    } }), 'MISSION_EVIDENCE_SCOPE_MISMATCH'],
    [producerSource({ missionSnapshot: { title: 'x', apiKey: 'synthetic-secret' } }), 'MISSION_EVIDENCE_INVALID'],
    [producerSource({ origin: 'MODEL_ROLE', agentDraft: null }), 'MISSION_EVIDENCE_INVALID'],
  ])('refuses invalid producer evidence (%s)', async (source, code) => {
    repository.setSource(source)
    await expect(port.recordConfirmed({ proposalId: ids.proposal, confirmationJobId: ids.confirmation }))
      .rejects.toMatchObject({ code })
  })

  it('fails closed for absent, forbidden, revoked, erased and malformed evidence reads', async () => {
    expect(await port.read({ evidenceId: ids.proposal })).toEqual({ status: 'unavailable', code: 'MISSION_EVIDENCE_UNAVAILABLE' })
    repository.setReadResult({ status: 'forbidden' })
    expect(await port.read({ evidenceId: ids.proposal })).toEqual({ status: 'forbidden', code: 'MISSION_EVIDENCE_FORBIDDEN' })
    repository.setReadResult({ status: 'revoked' })
    expect(await port.read({ evidenceId: ids.proposal })).toEqual({ status: 'unavailable', code: 'MISSION_EVIDENCE_REVOKED' })
    repository.setReadResult({ status: 'erased' })
    expect(await port.read({ evidenceId: ids.proposal })).toEqual({ status: 'unavailable', code: 'MISSION_EVIDENCE_REVOKED' })
    repository.setReadResult({ status: 'found', evidence: { evidenceId: ids.proposal, revision: 1, digest: 'bad', origin: 'HUMAN_AUTHORED', status: 'ACTIVE' } })
    expect(await port.read({ evidenceId: ids.proposal })).toEqual({ status: 'invalid', code: 'MISSION_EVIDENCE_INVALID' })
    expect(await port.read({ evidenceId: 'not-an-id' })).toEqual({ status: 'invalid', code: 'MISSION_EVIDENCE_INVALID' })
  })

  it('does not expose trace or mission payloads through a verified read', async () => {
    const created = await port.recordConfirmed({ proposalId: ids.proposal, confirmationJobId: ids.confirmation })
    const read = await port.read({ evidenceId: created.evidence.evidenceId, scope: { businessId: ids.tenant } })
    expect(read).toMatchObject({ status: 'verified', evidence: { digest: missionDigest, origin: 'HUMAN_AUTHORED' } })
    expect(JSON.stringify(read)).not.toContain('Review customer onboarding flow')
    expect(read.evidence).not.toHaveProperty('missionSnapshot')
  })

  it('maps storage failures to unavailable rather than a fabricated invalid finding', async () => {
    repository.authorizedRead = async () => { throw new Error('synthetic database unavailable') }
    expect(await port.read({ evidenceId: ids.proposal })).toEqual({ status: 'unavailable', code: 'MISSION_EVIDENCE_UNAVAILABLE' })
  })
})
