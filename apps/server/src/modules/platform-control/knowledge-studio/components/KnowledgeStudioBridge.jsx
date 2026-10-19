'use client'

// @req FR-289 — bridge the operator page to the local graph component and reader APIs.
// @spec ADR-048 D1-D3
// @tested tests/e2e/knowledge-studio/knowledge-studio.spec.js

import { useEffect, useMemo, useRef, useState } from 'react'

const DEFAULT_STUDIO_ORIGIN = 'http://127.0.0.1:19860'
const CHANNEL = 'zuri-knowledge-studio/v1'

function resolveStudioOrigin(candidate) {
  try {
    const url = new URL(candidate || DEFAULT_STUDIO_ORIGIN)
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname)) return DEFAULT_STUDIO_ORIGIN
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== (candidate || DEFAULT_STUDIO_ORIGIN)) return DEFAULT_STUDIO_ORIGIN
    return url.origin
  } catch {
    return DEFAULT_STUDIO_ORIGIN
  }
}

const STUDIO_ORIGIN = resolveStudioOrigin(process.env.NEXT_PUBLIC_ZURI_KNOWLEDGE_STUDIO_ORIGIN)

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export default function KnowledgeStudioBridge() {
  const frameRef = useRef(null)
  const allowedNodeIds = useRef(new Set())
  const [parentOrigin, setParentOrigin] = useState('')
  const [retry, setRetry] = useState(0)
  const [status, setStatus] = useState('Connecting to the local graph component…')
  const [statusKind, setStatusKind] = useState('loading')

  const frameSrc = useMemo(() => {
    const url = new URL('/components', STUDIO_ORIGIN)
    url.searchParams.set('presentation', '1')
    url.searchParams.set('shell', '1')
    url.searchParams.set('bridge', '1')
    url.searchParams.set('wrapperMode', 'optimized')
    url.searchParams.set('profile', '0')
    url.searchParams.set('latencyProbe', '1')
    url.searchParams.set('parentOrigin', parentOrigin)
    url.searchParams.set('connectionAttempt', String(retry))
    return url.toString()
  }, [parentOrigin, retry])

  useEffect(() => {
    setParentOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    let disposed = false
    let connectionTimeout
    let graphRequestInFlight = false
    const frame = frameRef.current
    if (!frame) return undefined

    const post = (message) => {
      if (!disposed && frame?.contentWindow) frame.contentWindow.postMessage({ channel: CHANNEL, ...message }, STUDIO_ORIGIN)
    }

    const showError = (message) => {
      setStatus(message)
      setStatusKind('error')
    }

    const loadGraph = async () => {
      if (graphRequestInFlight || disposed) return
      graphRequestInFlight = true
      setStatus('Loading the generated Zuri document graph…')
      setStatusKind('loading')
      try {
        const response = await fetch('/api/control/knowledge-studio/graph', { credentials: 'same-origin', cache: 'no-store' })
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !isRecord(result.dataset) || !Array.isArray(result.nodeIds)) {
          throw new Error(typeof result.error === 'string' ? result.error : `Graph request failed (${response.status}).`)
        }
        if (disposed) return
        allowedNodeIds.current = new Set(result.nodeIds)
        post({ type: 'dataset', dataset: result.dataset })
        setStatus(`Sending ${result.counts?.nodes ?? result.nodeIds.length} indexed documents to the original graph…`)
        setStatusKind('loading')
      } catch (error) {
        if (disposed) return
        post({ type: 'dataset-error', message: String(error?.message || 'The Zuri document graph could not be loaded.') })
        showError(String(error?.message || 'The Zuri document graph could not be loaded.'))
      } finally {
        graphRequestInFlight = false
      }
    }

    const loadDocument = async (nodeId) => {
      if (!allowedNodeIds.current.has(nodeId)) return
      try {
        const url = new URL('/api/control/knowledge-studio/document', window.location.origin)
        url.searchParams.set('nodeId', nodeId)
        const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        const result = await response.json().catch(() => ({}))
        if (!response.ok || typeof result.markdown !== 'string' || result.nodeId !== nodeId) {
          throw new Error(typeof result.error === 'string' ? result.error : `Document request failed (${response.status}).`)
        }
        post({ type: 'document', nodeId, markdown: result.markdown, path: result.path })
      } catch (error) {
        post({ type: 'document-error', nodeId, message: String(error?.message || 'The Markdown source could not be loaded.') })
      }
    }

    const receive = (event) => {
      if (disposed || event.origin !== STUDIO_ORIGIN || event.source !== frame?.contentWindow) return
      const message = event.data
      if (!isRecord(message) || message.channel !== CHANNEL || typeof message.type !== 'string') return
      if (message.type === 'bridge-ready') {
        clearTimeout(connectionTimeout)
        void loadGraph()
      } else if (message.type === 'studio-ready' && isRecord(message.counts)) {
        setStatus(`Connected · ${Number(message.counts.nodes || 0).toLocaleString()} documents · ${Number(message.counts.edges || 0).toLocaleString()} relations`)
        setStatusKind('ready')
      } else if (message.type === 'document-request' && typeof message.nodeId === 'string') {
        void loadDocument(message.nodeId)
      } else if (message.type === 'bridge-error' && typeof message.message === 'string') {
        showError(message.message)
      }
    }

    window.addEventListener('message', receive)
    connectionTimeout = setTimeout(() => {
      if (!disposed) showError(`The local graph component is not responding at ${new URL(STUDIO_ORIGIN).host}. Start its local host, then retry.`)
    }, 9000)

    return () => {
      disposed = true
      clearTimeout(connectionTimeout)
      window.removeEventListener('message', receive)
    }
  }, [frameSrc])

  return (
    <section className="space-y-3" aria-label="Zuri documentation graph studio">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
        <div role="status" aria-live="polite" data-state={statusKind} className="min-w-0 text-slate-700">
          <strong className="mr-2">Local graph bridge</strong>{status}
        </div>
        {statusKind === 'error' && (
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold hover:bg-slate-50" onClick={() => { setStatusKind('loading'); setStatus('Reconnecting to the local graph component…'); setRetry((value) => value + 1) }}>
            Retry
          </button>
        )}
      </div>
      {parentOrigin && <iframe
        key={retry}
        ref={frameRef}
        src={frameSrc}
        title="Original Knowledge Graph Studio component"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin"
        className="h-[min(82vh,980px)] min-h-[680px] w-full rounded-xl border border-slate-300 bg-slate-950 shadow-lg max-lg:min-h-[580px] max-md:min-h-[520px]"
      />}
    </section>
  )
}
