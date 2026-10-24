import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @req FR-230 — deployment authenticated one-shot retention caller.
// @spec SEC-001, SEC-031, ADR-091
const mocks = vi.hoisted(() => ({ run: vi.fn(), reconcile: vi.fn() }))
vi.mock('@/modules/agent/msp-retention-service', () => ({ runMspRetentionSweep: mocks.run, reconcileMspRetentionRun: mocks.reconcile }))
import { POST } from '@/app/api/agent/memory-retention/route'
import { resolveMspRetentionWorkerConfig, runMspRetentionOnce, formatMspRetentionLog } from '../../scripts/msp-retention-worker-run.mjs'
const token = 'r'.repeat(40)
const request = (bearer = token, query = '') => new Request(`http://localhost/api/agent/memory-retention${query}`, { method: 'POST', headers: { authorization: `Bearer ${bearer}` } })
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('ZURI_MSP_RETENTION_SWEEP_TOKEN', token); mocks.run.mockResolvedValue({ ok: true, runId: 'run', tenants: [] }) })
afterEach(() => vi.unstubAllEnvs())
describe('MSP retention route', () => {
  it('recovery accepts only exact run/container attestation after the operator bearer', async () => {
    const body = { reconcileRunId: '00000000-0000-4000-8000-000000000001', stoppedContainerId: 'a'.repeat(64), proof: { claims: {}, signature: 'host-proof' } }
    const req = (value, auth = token, query = '') => new Request(`http://localhost/api/agent/memory-retention${query}`, {
      method: 'POST', headers: { authorization: `Bearer ${auth}` }, body: JSON.stringify(value) })
    expect((await POST(req(body, 'wrong'))).status).toBe(401)
    expect((await POST(req({ ...body, tenantId: 'foreign' }))).status).toBe(400)
    expect((await POST(req(body, token, '?dry_run=true'))).status).toBe(400)
    expect(mocks.reconcile).not.toHaveBeenCalled()
    mocks.reconcile.mockResolvedValue({ ok: true, reconciled: true })
    expect((await POST(req(body))).status).toBe(200)
    expect(mocks.reconcile).toHaveBeenCalledWith({ runId: body.reconcileRunId, stoppedContainerId: body.stoppedContainerId, proof: body.proof })
  })
  it('rejects absent/incorrect/short configured bearer before any maintenance', async () => {
    for (const value of ['', 'short', 'x'.repeat(40)]) expect((await POST(request(value))).status).toBe(401)
    vi.stubEnv('ZURI_MSP_RETENTION_SWEEP_TOKEN', '')
    expect((await POST(request())).status).toBe(401); expect(mocks.run).not.toHaveBeenCalled()
  })
  it('accepts only strict dry_run and never caller scope/time/body selection', async () => {
    for (const query of ['?tenant_id=other', '?now=2099', '?dry_run=1', '?dry_run=true&dry_run=false']) expect((await POST(request(token, query))).status).toBe(400)
    expect(mocks.run).not.toHaveBeenCalled()
    expect((await POST(request(token, '?dry_run=true'))).status).toBe(200)
    expect(mocks.run).toHaveBeenCalledWith({ dryRun: true })
  })
  it('reports deferred/partial as unavailable and redacts unexpected errors', async () => {
    mocks.run.mockResolvedValueOnce({ ok: false, tenants: [{ status: 'DEFERRED' }] })
    expect((await POST(request())).status).toBe(503)
    mocks.run.mockRejectedValueOnce(new Error('private db secret'))
    const res = await POST(request()); expect(res.status).toBe(503); expect(JSON.stringify(await res.json())).not.toContain('private db secret')
  })
})
describe('MSP retention one-shot caller', () => {
  it('pins loopback endpoint and requires separate credential', () => {
    expect(resolveMspRetentionWorkerConfig({ ZURI_MSP_RETENTION_SWEEP_TOKEN: token }).endpoint.href).toBe('http://127.0.0.1:3000/api/agent/memory-retention')
    for (const endpoint of ['https://evil.invalid/api/agent/memory-retention', 'http://127.0.0.1:3000/wrong', 'http://a:b@localhost/api/agent/memory-retention', 'http://localhost/api/agent/memory-retention?dry_run=false']) {
      expect(() => resolveMspRetentionWorkerConfig({ ZURI_MSP_RETENTION_SWEEP_TOKEN: token, ZURI_MSP_RETENTION_SWEEP_URL: endpoint })).toThrow()
    }
    expect(() => resolveMspRetentionWorkerConfig({ ZURI_RETENTION_SWEEP_TOKEN: token })).toThrow()
  })
  it('sends one authenticated request, refuses redirects and preserves failure exits', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, dryRun: true, runId: '00000000-0000-4000-8000-000000000001', tenants: [{ status: 'DRY_RUN' }] }) }))
    const result = await runMspRetentionOnce({ ...resolveMspRetentionWorkerConfig({ ZURI_MSP_RETENTION_SWEEP_TOKEN: token }), dryRun: true, fetchImpl })
    expect(result.ok).toBe(true); expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0].search).toBe('?dry_run=true')
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}` } })
    for (const reply of [{ ok: true, status: 200, json: async () => ({ secret: token }) },
      { ok: true, status: 200, json: async () => ({ ok: true, runId: token, tenants: [{ status: 'COMPLETE' }] }) },
      { ok: false, status: 503, json: async () => ({ ok: false, secret: token }) }]) {
      const failed = await runMspRetentionOnce({ endpoint: new URL('http://localhost/api/agent/memory-retention'), token, fetchImpl: async () => reply })
      expect(failed.ok).toBe(false); expect(formatMspRetentionLog(failed)).not.toContain(token)
    }
  })
  it('logs no server payload/error content on transport failure', async () => {
    const out = await runMspRetentionOnce({ endpoint: new URL('http://localhost/api/agent/memory-retention'), token, fetchImpl: async () => { throw new Error(token) } })
    expect(out.ok).toBe(false); expect(formatMspRetentionLog(out)).not.toContain(token)
  })
  it('refuses a live response to a dry-run request, including a forged dryRun flag', async () => {
    for (const dryRun of [false, true]) {
      const out = await runMspRetentionOnce({ endpoint: new URL('http://localhost/api/agent/memory-retention'), token, dryRun: true,
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, dryRun, runId: '00000000-0000-4000-8000-000000000001', tenants: [{ status: 'COMPLETE' }] }) }) })
      expect(out.ok).toBe(false)
    }
  })
})
