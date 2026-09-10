'use client'

// @req FR-185 — deterministic AskMarketing read-only UI exposes source state
// and never offers an action or provider call.
// @spec SDD-086, SEC-001, SEC-003
// @tested tests/e2e/marketing-p5.spec.js

import { useEffect, useRef, useState } from 'react'
import { Card, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { api } from '@/modules/project-manager/components/useApi'
import { ScopeNotice } from './MarketingState'

const SECTION_SOURCE_NAMES = Object.freeze({
  campaigns: 'MARKETING_CAMPAIGNS',
  operations: 'MARKETING_OPERATIONS',
  verifiedRevenue: 'VERIFIED_REVENUE',
})

function formatThbFromSatang(value) {
  if (value === null || value === undefined || value === '') return 'UNAVAILABLE'
  const satang = Number(value)
  if (!Number.isFinite(satang)) return 'UNAVAILABLE'
  return `${(satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} THB`
}

function measurementWindowLabel(window) {
  if (!window || typeof window !== 'object') return 'UNAVAILABLE (no window evidence)'
  const from = window.from ?? null
  const to = window.to ?? null
  if (from === null && to === null) return 'All time (from/to unbounded)'
  if (from === null) return `From all available history through ${to}`
  if (to === null) return `From ${from} onward (unbounded end)`
  return `${from} to ${to}`
}

function sourceForSection(section, sources) {
  const sourceName = SECTION_SOURCE_NAMES[section.key]
  return sourceName ? sources.find((item) => item.source === sourceName) : null
}

function stateForSection(section, sources) {
  return section.state || sourceForSection(section, sources)?.state || 'UNKNOWN'
}

function displaySectionValue(section, field, state) {
  const value = section[field]
  if (value === null || value === undefined || value === '') return state === 'UNKNOWN' ? 'UNKNOWN' : 'UNAVAILABLE'
  if (section.key === 'verifiedRevenue' && field === 'value') return formatThbFromSatang(value)
  return String(value)
}

export default function AskMarketingWorkspace({ businessId }) {
  const [question, setQuestion] = useState('overview')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(true)
  const requestSequenceRef = useRef(0)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  useEffect(() => {
    requestSequenceRef.current += 1
    setResult(null)
    setLoading(false)
  }, [businessId])
  if (!businessId) return <ScopeNotice />
  const sources = Array.isArray(result?.sources) ? result.sources : []
  const sections = Array.isArray(result?.answer?.sections) ? result.answer.sections : []
  const unavailable = Array.isArray(result?.unavailable) ? result.unavailable : []
  async function ask(event) {
    event.preventDefault()
    const requestId = ++requestSequenceRef.current
    setLoading(true)
    try {
      const next = await api('/api/growth/ask-marketing', { method: 'POST', body: { businessId, question } })
      if (mountedRef.current && requestSequenceRef.current === requestId) setResult(next)
    } catch (error) {
      if (mountedRef.current && requestSequenceRef.current === requestId) setResult({ state: 'UNKNOWN', unavailable: [{ source: 'ASK_MARKETING', reasonCode: error.message }] })
    } finally {
      if (mountedRef.current && requestSequenceRef.current === requestId) setLoading(false)
    }
  }
  return <main className="mx-auto max-w-3xl min-w-0 p-5 max-md:p-3"><PageHeader eyebrow="MARKETING" title="AskMarketing" subtitle="Deterministic read-only answers grounded in owner projections." /><Card><form onSubmit={ask} className="flex flex-wrap items-end gap-2 sm:flex-nowrap"><input aria-label="Marketing question" value={question} onChange={(event) => setQuestion(event.target.value)} className="input min-w-0 flex-1" /><button className="btn btn-primary shrink-0" disabled={loading}>{loading ? 'Reading…' : 'Ask'}</button></form>{result && <div className="mt-5 min-w-0" aria-live="polite"><div className="flex items-start justify-between gap-2"><SectionTitle caption={result.intentType || 'No classification'}>Result</SectionTitle><StatusPill status={result.state || 'UNKNOWN'} /></div>{sections.length ? <div className="space-y-2">{sections.map((section) => { const state = stateForSection(section, sources); const hasCount = Object.prototype.hasOwnProperty.call(section, 'count'); const hasValue = Object.prototype.hasOwnProperty.call(section, 'value'); return <div key={section.key} className="min-w-0 rounded-lg border border-[var(--border)] p-3 text-xs"><div className="flex items-start justify-between gap-2"><strong className="min-w-0 break-words">{section.title || section.key}</strong><StatusPill status={state} /></div><div className="mt-2 grid gap-1 text-muted">{hasCount && <p className="break-words">Count: {displaySectionValue(section, 'count', state)}</p>}{hasValue && <p className="break-words">Value: {displaySectionValue(section, 'value', state)}</p>}<p className="break-words">Measurement window: {measurementWindowLabel(section.window)}</p></div></div> })}</div> : <p className="break-words rounded-lg bg-[var(--brand-tint)] p-3 text-xs">No measured answer is available for this question.</p>}<section className="mt-5" aria-label="Owner source evidence"><SectionTitle caption="Each owner/source retains its state, reference and measurement window">Source evidence</SectionTitle>{sources.length ? <div className="space-y-2">{sources.map((item, index) => <div key={`${item.owner || 'OWNER'}-${item.source || 'SOURCE'}-${index}`} className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-[var(--border)] p-3"><div className="min-w-0 flex-1"><p className="break-words text-xs font-bold">{item.owner || 'OWNER'} · {item.source || 'SOURCE'}</p><p className="mt-1 break-words text-[10px] text-muted">State: {item.state || 'UNKNOWN'}</p><p className="mt-1 break-words text-[10px] text-muted">Measurement window: {measurementWindowLabel(item.window)}</p>{item.sourceVersion && <p className="mt-1 break-all text-[10px] text-muted">Source version: {item.sourceVersion}</p>}{item.ref && <p className="mt-1 break-all text-[10px] text-muted">Reference: {item.ref}</p>}{item.reasonCode && <p className="mt-1 break-all text-[10px] text-muted">Reason: {item.reasonCode}</p>}</div><StatusPill status={item.state || 'UNKNOWN'} /></div>)}</div> : <p className="break-words rounded-lg bg-[var(--brand-tint)] p-3 text-xs">Source evidence: UNAVAILABLE.</p>}</section>{unavailable.length > 0 && <ul className="mt-3 space-y-1 text-[11px] text-muted">{unavailable.map((item, index) => <li className="break-all" key={`${item.source || 'SOURCE'}-${index}`}>{item.source || 'SOURCE'}: {item.reasonCode || 'UNKNOWN'}</li>)}</ul>}</div>}</Card></main>
}
