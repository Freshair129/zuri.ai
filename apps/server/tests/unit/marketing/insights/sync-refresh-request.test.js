import { describe, expect, it } from 'vitest'
import { planRefreshRequest, refreshRequestSignature, SyncPolicyError } from '@/modules/marketing/insights/domain/sync-refresh-request'

const request = {
  assetId: 'fx-asset-infresh-page-a',
  dataset: 'DAILY_OBSERVATIONS',
  window: { from: '2026-09-01', to: '2026-09-28' },
  idempotencyKey: 'fx-key-1',
}

function neverCalled() {
  throw new Error('generateSyncRunId should not be called')
}

describe('sync refresh request policy', () => {
  it('accepts a brand-new request and mints a syncRunId', () => {
    const plan = planRefreshRequest({ request, pendingRuns: [], generateSyncRunId: () => 'fx-sync-1' })
    expect(plan).toMatchObject({ state: 'ACCEPTED', syncRunId: 'fx-sync-1', requestSignature: refreshRequestSignature(request) })
  })

  it('returns the same run for an idempotent retry of the exact same request', () => {
    const pendingRuns = [{ syncRunId: 'fx-sync-1', idempotencyKey: 'fx-key-1', requestSignature: refreshRequestSignature(request) }]
    const plan = planRefreshRequest({ request, pendingRuns, generateSyncRunId: neverCalled })
    expect(plan).toMatchObject({ state: 'ACCEPTED', syncRunId: 'fx-sync-1' })
  })

  it('refuses reusing an idempotency key for a different asset, dataset or window', () => {
    const pendingRuns = [{ syncRunId: 'fx-sync-1', idempotencyKey: 'fx-key-1', requestSignature: refreshRequestSignature(request) }]
    const different = { ...request, window: { from: '2026-08-01', to: '2026-08-28' } }
    expect(() => planRefreshRequest({ request: different, pendingRuns, generateSyncRunId: neverCalled }))
      .toThrow(SyncPolicyError)
    try {
      planRefreshRequest({ request: different, pendingRuns, generateSyncRunId: neverCalled })
    } catch (error) {
      expect(error).toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT', status: 409 })
    }
  })

  it('coalesces an identical asset/dataset/window request under a different idempotency key', () => {
    const pendingRuns = [{ syncRunId: 'fx-sync-1', idempotencyKey: 'fx-key-1', requestSignature: refreshRequestSignature(request) }]
    const plan = planRefreshRequest({ request: { ...request, idempotencyKey: 'fx-key-2' }, pendingRuns, generateSyncRunId: neverCalled })
    expect(plan).toMatchObject({ state: 'COALESCED', syncRunId: 'fx-sync-1' })
  })

  it('does not coalesce against a run for a different asset', () => {
    const pendingRuns = [{ syncRunId: 'fx-sync-1', idempotencyKey: 'fx-key-1', requestSignature: refreshRequestSignature(request) }]
    const plan = planRefreshRequest({
      request: { ...request, assetId: 'fx-asset-glowcea-page', idempotencyKey: 'fx-key-3' },
      pendingRuns,
      generateSyncRunId: () => 'fx-sync-2',
    })
    expect(plan).toMatchObject({ state: 'ACCEPTED', syncRunId: 'fx-sync-2' })
  })

  it('refuses a malformed request', () => {
    expect(() => planRefreshRequest({ request: { ...request, dataset: 'AD_ACCOUNTS' }, generateSyncRunId: neverCalled })).toThrow()
    expect(() => planRefreshRequest({ request: { ...request, window: { from: '2026-09-01' } }, generateSyncRunId: neverCalled })).toThrow()
    expect(() => planRefreshRequest({ request: { ...request, extra: 'nope' }, generateSyncRunId: neverCalled })).toThrow()
  })

  it('requires a syncRunId generator for a genuinely new request', () => {
    expect(() => planRefreshRequest({ request, pendingRuns: [] })).toThrow(/generateSyncRunId/)
  })
})
