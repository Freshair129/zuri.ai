// @req FR-146, FR-151, FR-080 — LINE Studio account status and navigation
// @req FR-190 — each account also shows whether LINE can still reach this
//   deployment: silence, and whether the endpoint LINE has configured is ours.
// @spec SDD-060, SDD-061, ADR-041, ADR-061 — one owner for LINE identity,
//   webhook and transport configuration; model metadata remains in Platform.
// @tested tests/unit/line-oa-settings-consolidation.test.js
'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ExternalLink, Radio, RefreshCw, Settings, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useScope } from '@/context/ScopeContext'
import { describeTransportHealth } from '@/modules/line-oa-studio/domain/transport-health-presentation'

export default function LineStudioSettings() {
  const router = useRouter()
  const scope = useScope()
  const business = scope?.shell?.activeBusiness
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // FR-190 — one read per listed account, keyed by id. A failed read leaves the
  // account without a chip rather than turning the page into an error: this is a
  // diagnostic, and it must never be the reason the account list stops rendering.
  const [health, setHealth] = useState({})

  const loadAccounts = useCallback(async () => {
    if (!business?.id) {
      setAccounts([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/line-oa/accounts?businessId=${encodeURIComponent(business.id)}`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || result.issues?.join(' · ') || 'โหลดบัญชี LINE OA ไม่สำเร็จ')
      setAccounts(result.accounts ?? [])
    } catch (caught) {
      setError(caught.message)
    } finally {
      setLoading(false)
    }
  }, [business?.id])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    let cancelled = false
    const ids = accounts.map((account) => account.id).filter(Boolean)
    if (ids.length === 0) return undefined
    Promise.all(ids.map(async (id) => {
      try {
        const response = await fetch(`/api/line-oa/accounts/${encodeURIComponent(id)}/transport-health`)
        if (!response.ok) return [id, null]
        return [id, await response.json()]
      } catch {
        return [id, null]
      }
    })).then((entries) => {
      if (cancelled) return
      setHealth(Object.fromEntries(entries))
    })
    return () => { cancelled = true }
  }, [accounts])

  return (
    <div className="max-w-4xl space-y-6 pb-12 font-thai">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            <Settings className="h-6 w-6 text-brand-amber" />
            สถานะบัญชี LINE OA
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            LINE OA Studio เป็นเจ้าของบัญชี, webhook และ transport; ตั้งค่า model metadata ต่อใน Platform Integrations
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadAccounts()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900"
        >
          <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> รีเฟรช
        </button>
      </div>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
      {!business && <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">เลือก Business ก่อนจัดการบัญชี LINE OA</p>}

      <div className="grid gap-4">
        {accounts.map((account) => {
          const status = account.effectiveStatus || account.status || 'UNKNOWN'
          const chip = describeTransportHealth(health[account.id])
          const chipClass = {
            ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
            warn: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
            bad: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
            muted: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
          }[chip.tone]
          const transport = account.serverEnabled
            ? 'Zuri Server'
            : account.transportMode === 'EDGE'
              ? 'Edge worker'
              : 'ยังไม่เปิด Server'
          return (
            <div key={account.id} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                    <Radio className="h-4 w-4 text-emerald-600" />
                    {account.displayName || account.code}
                  </h2>
                  <p className="mt-1 text-[11px] text-slate-500">{account.basicId || account.code} · {transport}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${chipClass}`} title={chip.detail}>{chip.label}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{status}</span>
                </div>
              </div>
              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-3 text-xs dark:border-slate-800 md:grid-cols-3">
                <div><span className="text-slate-500">Connection</span><p className="font-semibold">{account.health?.connection?.status || 'UNKNOWN'}</p></div>
                <div><span className="text-slate-500">Webhook</span><p className="font-mono text-[11px]">/api/line-oa/accounts/{account.id}/webhook</p></div>
                <div><span className="text-slate-500">Binding</span><p className="font-semibold">{account.health?.binding?.status || 'UNKNOWN'}</p></div>
              </div>
              {chip.detail && <p className="mt-3 text-[11px] text-slate-500">{chip.detail}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => router.push('/line-oa/edge-connection')} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"><ShieldCheck className="h-3.5 w-3.5" /> จัดการบัญชีและ transport</button>
                <button type="button" onClick={() => router.push('/platform/integrations')} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900"><ExternalLink className="h-3.5 w-3.5" /> Model metadata</button>
              </div>
            </div>
          )
        })}
      </div>

      {!loading && business && accounts.length === 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> ยังไม่มีบัญชี LINE OA ใน Business นี้ — เชื่อมบัญชีจาก Edge & การเชื่อมต่อ
        </div>
      )}
    </div>
  )
}
