const PRIVATE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  Vary: 'Cookie, Origin',
})

export function unknownWorkerObservabilitySnapshot(reason = 'SOURCE_UNAVAILABLE', now = new Date()) {
  const observedAt = Number.isFinite(Date.parse(now)) ? new Date(now).toISOString() : new Date().toISOString()
  return {
    schemaVersion: 'worker-observability/v1',
    state: 'UNKNOWN',
    freshness: 'UNKNOWN',
    observedAt,
    reason: /^[A-Z][A-Z0-9_-]{0,95}$/.test(reason) ? reason : 'SOURCE_UNAVAILABLE',
    source: { kind: 'LOCAL_DELIVERY_CONTROLLER', proofScope: 'LOCAL_ONLY', controllerLiveness: 'UNKNOWN', eventChain: 'UNKNOWN', supervisorReceipts: 'UNKNOWN', ciReceipts: 'UNKNOWN' },
    summary: { activeWorkers: 0, queuedWorkers: 0, activeTasks: 0, mode: 'UNKNOWN' },
    tasks: [],
    assignments: [],
    events: [],
    localTags: [],
    localTagCount: 0,
    localTagsTruncated: false,
    localTagSetFingerprint: null,
    localStatus: { changedFiles: null, fingerprint: null, headCommit: null, observedAt },
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: PRIVATE_HEADERS })
}

function isSameOriginRead(request) {
  let requestOrigin
  try { requestOrigin = new URL(request.url).origin } catch { return false }
  const host = request.headers.get('host')
  if (host && host.toLowerCase() !== new URL(request.url).host.toLowerCase()) return false
  const origin = request.headers.get('origin')
  if (origin) {
    try { if (new URL(origin).origin !== requestOrigin) return false } catch { return false }
  }
  const fetchSite = request.headers.get('sec-fetch-site')
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none'
}

export function createWorkerObservabilityGet({ resolveViewer, isOperator, readSnapshot }) {
  if (typeof resolveViewer !== 'function' || typeof isOperator !== 'function' || typeof readSnapshot !== 'function') {
    throw new TypeError('Worker observability dependencies are required.')
  }
  return async function workerObservabilityGet(request) {
    if (request.method !== 'GET') return json({ error: 'READ_ONLY' }, 405)
    if (!isSameOriginRead(request)) return json({ error: 'SAME_ORIGIN_REQUIRED' }, 403)
    let viewer
    try { viewer = await resolveViewer(request) } catch (error) {
      const status = [401, 503].includes(Number(error?.status)) ? Number(error.status) : 401
      return json({ error: status === 503 ? 'SESSION_UNAVAILABLE' : 'AUTH_REQUIRED' }, status)
    }
    if (!viewer) return json({ error: 'AUTH_REQUIRED' }, 401)
    if (!isOperator(viewer)) return json({ error: 'OPERATOR_REQUIRED' }, 403)

    let snapshot
    try {
      const url = new URL(request.url)
      const since = url.searchParams.get('since')
      snapshot = await readSnapshot({ since: since && Number.isFinite(Date.parse(since)) ? since : null })
    } catch {
      snapshot = unknownWorkerObservabilitySnapshot()
    }
    if (!snapshot || snapshot.schemaVersion !== 'worker-observability/v1'
        || !['LIVE', 'UNKNOWN'].includes(snapshot.state)) {
      snapshot = unknownWorkerObservabilitySnapshot('SOURCE_INVALID')
    }
    return json(snapshot)
  }
}

export function createWorkerObservabilityMethodNotAllowed() {
  return json({ error: 'READ_ONLY' }, 405)
}
