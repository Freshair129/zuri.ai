// Marketing Insights (S6) — what each tab reads. Pure orchestration over an
// injected `load(url, { signal })`; the page supplies the HTTP call, so this
// module never opens a network path of its own.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md (R-10)
// @tested tests/unit/marketing/insights/insights-ui.test.js

import { DAILY_METRIC_KEYS } from '../domain/metric-catalog'
import { insightsApiPath, selectionKey } from './insights-format'

/**
 * @returns {Promise<{ key, tab, summary?, series?, content?, viewsSeries?, errors }>}
 * Per-metric failures on Results are reported per chart, not as a page error.
 */
export async function loadInsightsTab({ tab, selection, load, signal, apiBase }) {
  if (!selection?.brand) throw new Error('loadInsightsTab requires a brand')
  const key = selectionKey(selection, tab === 'content' ? 'content' : tab)

  if (tab === 'overview') {
    const summary = await load(insightsApiPath('summary', selection, { apiBase }), { signal })
    return { key, tab, summary, errors: {} }
  }

  if (tab === 'results') {
    const settled = await Promise.allSettled(DAILY_METRIC_KEYS.map((metricKey) => load(insightsApiPath('metric', selection, { apiBase, metricKey }), { signal })))
    const series = {}
    const errors = {}
    settled.forEach((result, index) => {
      const metricKey = DAILY_METRIC_KEYS[index]
      if (result.status === 'fulfilled') series[metricKey] = result.value
      else errors[metricKey] = result.reason?.code || 'ERROR'
    })
    if (Object.keys(series).length === 0 && settled.length > 0) throw settled[0].reason
    return { key, tab, series, errors }
  }

  if (tab === 'content') {
    const [content, views] = await Promise.allSettled([
      load(insightsApiPath('content', selection, { apiBase }), { signal }),
      load(insightsApiPath('metric', selection, { apiBase, metricKey: 'views' }), { signal }),
    ])
    if (content.status === 'rejected') throw content.reason
    return {
      key, tab,
      content: content.value,
      viewsSeries: views.status === 'fulfilled' ? views.value : null,
      errors: views.status === 'rejected' ? { views: views.reason?.code || 'ERROR' } : {},
    }
  }

  throw new Error(`unknown insights tab: ${tab}`)
}

/** Apply a response only if it still answers the current selection. */
export function acceptsResponse(currentSelection, response) {
  if (!response) return false
  const kind = response.tab === 'content' ? 'content' : response.tab
  return response.tab === currentSelection.tab && response.key === selectionKey(currentSelection, kind)
}
