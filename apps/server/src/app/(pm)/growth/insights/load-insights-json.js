// Marketing Insights page — the `load` function this page injects into <InsightsLayout>: JSON GET,
// abortable, and a refusal keeps the typed code the route returned so the UI can explain it.
//
// @req FR-275
// @tested tests/unit/marketing/insights/insights-routes.test.js

export async function loadInsightsJson(url, { signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { signal, credentials: 'same-origin', headers: { accept: 'application/json' } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw Object.assign(new Error(body.error || `HTTP ${response.status}`), { code: body.code || `HTTP_${response.status}`, status: response.status })
  }
  return body
}
