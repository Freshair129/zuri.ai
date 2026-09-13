// @req FR-220 — harness pairing follows FR-144: anonymous bounded start, approval
//   by a signed-in person who may approve for themselves (never a bare signup),
//   one redemption by the device secret, fresh authority at redemption, and
//   nothing for an expired, denied or already redeemed request.
// @spec ADR-087 D1, D2; SEC-025
// @tested tests/unit/harness-pairing.test.js
import { describe, expect, it, vi } from 'vitest'
import { createHarnessPairingService, HARNESS_PAIRING_TTL_MS } from '@/modules/identity/harness-pairing'
import { makeViewer } from '../factories/viewer.js'

const ORIGIN = 'https://zuri.example'
const code = (approvalUrl) => approvalUrl.split('#')[1]

function setup({ refreshed } = {}) {
  let clock = 1_000_000
  const now = () => clock
  const member = makeViewer({ role: 'MEMBER', visibleBusinessIds: ['b-1'], principal: { id: 'per-1', code: 'PER-1', displayName: 'Ploy' } })
  const mint = vi.fn(async ({ viewer, harness, deviceLabel }) => ({
    key: 'hrnk_' + 'k'.repeat(43),
    credential: { installationId: 'inst-1', personDisplayName: viewer.principal.displayName, status: 'PENDING_ACTIVATION', deviceLabel, harness },
  }))
  const service = createHarnessPairingService({ mint, refreshViewer: vi.fn(async () => refreshed ?? member), now })
  return { service, mint, member, tick: (ms) => { clock += ms } }
}

describe('FR-220 harness pairing', () => {
  it('pairs once: start, inspect with the same check code, approve, then one redemption', async () => {
    const { service, mint, member, tick } = setup()
    const started = service.start({ harness: 'CLAUDE_CODE', deviceLabel: 'DESKTOP-VETATMQ', osUser: 'pc', origin: ORIGIN })
    expect(started).toMatchObject({ state: 'PENDING', harness: 'CLAUDE_CODE', deviceLabel: 'DESKTOP-VETATMQ', osUser: 'pc' })
    expect(started.approvalUrl.startsWith(`${ORIGIN}/harness/pair#`)).toBe(true)
    expect(started.deviceSecret).toHaveLength(43)

    const inspected = service.inspect({ code: code(started.approvalUrl), viewer: member })
    expect(inspected).toMatchObject({ checkCode: started.checkCode, person: 'Ploy', allowed: true })
    expect(inspected).not.toHaveProperty('deviceSecret')

    expect((await service.poll({ requestId: started.requestId, deviceSecret: started.deviceSecret })).state).toBe('PENDING')
    service.decide({ code: code(started.approvalUrl), action: 'approve', viewer: member })
    tick(2000)
    const paired = await service.poll({ requestId: started.requestId, deviceSecret: started.deviceSecret })
    expect(paired).toMatchObject({ state: 'PAIRED', pairing: { installationId: 'inst-1', personDisplayName: 'Ploy', status: 'PENDING_ACTIVATION', apiBaseUrl: ORIGIN } })
    expect(paired.pairing.key.startsWith('hrnk_')).toBe(true)
    expect(mint).toHaveBeenCalledTimes(1)
    await expect(service.poll({ requestId: started.requestId, deviceSecret: started.deviceSecret })).rejects.toMatchObject({ status: 410, message: 'PAIRING_ALREADY_USED_START_AGAIN' })
  })

  it('refuses a bare signup, an unsigned browser, a wrong device secret and an expired request', async () => {
    const { service, tick } = setup()
    const signup = makeViewer({ role: 'MEMBER', visibleBusinessIds: [], principal: { id: 'per-9', code: 'PER-9', displayName: 'New' } })
    const started = service.start({ harness: 'CODEX', deviceLabel: 'laptop', origin: ORIGIN })
    expect(service.inspect({ code: code(started.approvalUrl), viewer: signup }).allowed).toBe(false)
    expect(() => service.decide({ code: code(started.approvalUrl), action: 'approve', viewer: signup })).toThrow('HARNESS_PAIRING_NOT_ALLOWED')
    expect(() => service.inspect({ code: code(started.approvalUrl), viewer: null })).toThrow('AUTH_REQUIRED')
    await expect(service.poll({ requestId: started.requestId, deviceSecret: 'x'.repeat(43) })).rejects.toMatchObject({ status: 410 })
    tick(HARNESS_PAIRING_TTL_MS + 1)
    await expect(service.poll({ requestId: started.requestId, deviceSecret: started.deviceSecret })).rejects.toMatchObject({ status: 410 })
  })

  it('gives nothing to a denied request, and re-reads authority at redemption', async () => {
    const { service, member, mint } = setup()
    const denied = service.start({ harness: 'CODEX', deviceLabel: 'laptop', origin: ORIGIN })
    service.decide({ code: code(denied.approvalUrl), action: 'deny', viewer: member })
    expect((await service.poll({ requestId: denied.requestId, deviceSecret: denied.deviceSecret })).state).toBe('DENIED')

    const lost = setup({ refreshed: makeViewer({ role: 'MEMBER', visibleBusinessIds: [], principal: { id: 'per-1', code: 'PER-1', displayName: 'Ploy' } }) })
    const started = lost.service.start({ harness: 'CODEX', deviceLabel: 'laptop', origin: ORIGIN })
    lost.service.decide({ code: code(started.approvalUrl), action: 'approve', viewer: lost.member })
    await expect(lost.service.poll({ requestId: started.requestId, deviceSecret: started.deviceSecret })).rejects.toMatchObject({ status: 403, message: 'PAIRING_REDEMPTION_FAILED' })
    expect(lost.mint).not.toHaveBeenCalled()
    expect(mint).not.toHaveBeenCalled()
  })

  it('validates the harness and label, and bounds starts', () => {
    const { service } = setup()
    expect(() => service.start({ harness: 'CURSOR', deviceLabel: 'x', origin: ORIGIN })).toThrow('HARNESS_REQUIRED')
    expect(() => service.start({ harness: 'CODEX', deviceLabel: ' ', origin: ORIGIN })).toThrow('HARNESS_DEVICE_LABEL_REQUIRED')
    const burst = setup()
    for (let i = 0; i < 30; i += 1) burst.service.start({ harness: 'CODEX', deviceLabel: `d${i}`, origin: ORIGIN })
    expect(() => burst.service.start({ harness: 'CODEX', deviceLabel: 'one too many', origin: ORIGIN })).toThrow('PAIRING_BUSY_TRY_LATER')
  })
})
