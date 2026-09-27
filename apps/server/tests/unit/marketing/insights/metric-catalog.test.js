import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DAILY_METRICS, STORED_METRIC_KEYS, OVERVIEW_CARDS, AGGREGATION, PROVIDER_STATUS, getMetricDefinition,
} from '@/modules/marketing/insights/domain/metric-catalog'

const INSIGHTS_ROOT = path.resolve(__dirname, '../../../../src/modules/marketing/insights')

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? sources(full) : /\.jsx?$/.test(entry.name) ? [full] : []
  })
}

describe('metric catalog', () => {
  it('covers the contract §4 metric keys, plus derived net follows', () => {
    expect(STORED_METRIC_KEYS).toEqual(['views', 'viewers', 'interactions', 'three_sec_views', 'watch_time', 'visits', 'follows', 'unfollows', 'link_clicks'])
    expect(getMetricDefinition('net_follows')).toMatchObject({ aggregation: AGGREGATION.DERIVED_DIFFERENCE, derivedFrom: ['follows', 'unfollows'] })
  })

  it('never lets Views and Viewers share one definition', () => {
    const views = getMetricDefinition('views')
    const viewers = getMetricDefinition('viewers')
    expect(views.aggregation).toBe(AGGREGATION.ADDITIVE)
    expect(viewers.aggregation).toBe(AGGREGATION.NON_ADDITIVE_UNIQUE)
    expect(views.unit).not.toBe(viewers.unit)
  })

  it('records every contract field whose Meta metric is listed as deprecated', () => {
    const deprecated = DAILY_METRICS.filter((item) => item.providerStatus === PROVIDER_STATUS.CONTRACT_FIELD_DEPRECATED).map((item) => item.metricKey)
    expect(deprecated).toEqual(['views', 'viewers', 'follows', 'unfollows', 'net_follows'])
    expect(DAILY_METRICS.every((item) => Object.values(PROVIDER_STATUS).includes(item.providerStatus))).toBe(true)
  })

  it('keeps Conversions a placeholder with no metric behind it', () => {
    expect(OVERVIEW_CARDS.find((card) => card.cardKey === 'conversions')).toMatchObject({ metricKeys: [], placeholder: 'CONVERSIONS_NOT_CONNECTED' })
  })

  it('the insights module has no provider client, env, Next or database import (no live request path)', () => {
    const forbidden = [/graph\.facebook\.com/i, /\bfetch\s*\(/, /process\.env/, /from ['"]next\//, /@\/lib\/db/, /@prisma\/client/, /n8n/i, /\baxios\b/]
    const files = sources(INSIGHTS_ROOT)
    expect(files.length).toBeGreaterThan(5)
    for (const file of files) {
      const text = readFileSync(file, 'utf8').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
      for (const pattern of forbidden) expect(pattern.test(text), `${path.basename(file)} matches ${pattern}`).toBe(false)
    }
  })
})
