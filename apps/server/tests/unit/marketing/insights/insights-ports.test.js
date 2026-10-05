import { describe, expect, it } from 'vitest'
import {
  zDailyObservation, zAssetBinding, parseDailyReadResult, UNAVAILABLE_PORTS, assertInsightsRepository,
} from '@/modules/marketing/insights/ports/insights-ports'
import { fixtureBindings } from '../../../fixtures/marketing-insights/fixture-insights-repository'

const row = { assetId: 'a', metricKey: 'views', date: '2026-09-01', distribution: 'ALL', value: 1, unit: 'count', quality: 'OBSERVED', fetchedAt: '2026-09-02T00:00:00.000Z', revision: 1 }
const snapshot = { snapshotId: 's', generatedAt: '2026-09-02T00:00:00.000Z', coveredUntil: '2026-09-01', state: 'COMPLETE', partialReason: null }

describe('insights ports', () => {
  it('accepts every synthetic binding and refuses a namespace that does not match its kind', () => {
    for (const binding of fixtureBindings()) expect(() => zAssetBinding.parse(binding)).not.toThrow()
    expect(() => zAssetBinding.parse({ ...fixtureBindings()[0], namespace: 'meta.ad_account' })).toThrow()
  })

  it('refuses rows that would lie about a value', () => {
    expect(() => zDailyObservation.parse(row)).not.toThrow()
    expect(() => zDailyObservation.parse({ ...row, value: null })).toThrow()
    expect(() => zDailyObservation.parse({ ...row, quality: 'NOT_SYNCED' })).toThrow()
    expect(() => zDailyObservation.parse({ ...row, value: 1.5 })).toThrow()
    expect(() => zDailyObservation.parse({ ...row, value: -1 })).toThrow()
    expect(() => zDailyObservation.parse({ ...row, value: 2 ** 53 })).toThrow()
    expect(() => zDailyObservation.parse({ ...row, metricKey: 'net_follows' })).toThrow()
    expect(() => zDailyObservation.parse({ ...row, token: 'x' })).toThrow()
  })

  it('fails a read that contains a row for another asset', () => {
    expect(() => parseDailyReadResult({ snapshot, observations: [row], windowAggregates: [] }, { assetId: 'a' })).not.toThrow()
    expect(() => parseDailyReadResult({ snapshot, observations: [{ ...row, assetId: 'b' }], windowAggregates: [] }, { assetId: 'a' }))
      .toThrow(/outside the requested scope/)
  })

  it('provider-facing ports refuse honestly until an owner supplies an adapter', async () => {
    expect(UNAVAILABLE_PORTS.metaInsightsRead).toMatchObject({ available: false, reasonCode: 'EXISTING_META_CLIENT_NOT_FOUND' })
    expect(UNAVAILABLE_PORTS.reportNotification.reasonCode).toBe('LINE_NOTIFY_TERMINATED_NO_APPROVED_REPLACEMENT')
    await expect(UNAVAILABLE_PORTS.syncRequest.invoke({})).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 503 })
  })

  it('checks an injected repository at composition time', () => {
    expect(() => assertInsightsRepository({})).toThrow(/readDailyObservations/)
  })
})
