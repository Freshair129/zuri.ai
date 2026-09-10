'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Radio, RefreshCw, ShieldCheck } from 'lucide-react'
import { useScope } from '@/context/ScopeContext'

// @req FR-146, FR-147 — CRM exposes a read-only LINE OA status projection.
// @spec SDD-050, ADR-060, ADR-061 — LINE OA Studio owns account identity,
//   webhook and transport configuration; CRM must not keep a second mock editor.
// @tested tests/unit/line-oa-settings-consolidation.test.js

export default function LineCrmMultiOa() {
  const scope = useScope()
  const business = scope?.shell?.activeBusiness
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestVersion = useRef(0)

  const loadAccounts = useCallback(async () => {
    const requestId = ++requestVersion.current
    if (!business?.id) {
      setAccounts([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/line-oa/accounts?businessId=${encodeURIComponent(business.id)}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'โหลดบัญชี LINE OA ไม่สำเร็จ')
      if (requestId !== requestVersion.current) return
      setAccounts(data.accounts || [])
    } catch (caught) {
      if (requestId !== requestVersion.current) return
      setAccounts([])
      setError(caught.message || 'โหลดบัญชี LINE OA ไม่สำเร็จ')
    } finally {
      if (requestId === requestVersion.current) setLoading(false)
    }
  }, [business?.id])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">LINE OA</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            CRM แสดงสถานะบัญชีของ Business ปัจจุบันแบบ read-only; LINE OA Studio เป็นเจ้าของการตั้งค่า
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadAccounts}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> รีเฟรช
          </button>
          <a href="/line-oa/projects" className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">
            <ExternalLink className="h-3.5 w-3.5" /> เปิด LINE OA Studio
          </a>
        </div>
      </div>

      {!business && <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">เลือก Business ก่อนดูบัญชี LINE OA</p>}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900">กำลังโหลดสถานะบัญชี…</div>
      ) : accounts.length === 0 && business ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900">ยังไม่มีบัญชี LINE OA ใน Business นี้</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {accounts.map((account) => {
            const status = account.effectiveStatus || account.status || 'UNKNOWN'
            const transport = account.serverEnabled
              ? 'Zuri Server'
              : account.transportMode === 'EDGE'
                ? 'Edge worker'
                : 'ยังไม่เปิด transport'
            return (
              <div key={account.id} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><Radio className="h-4 w-4 text-emerald-600" /> {account.displayName || account.code || 'LINE OA'}</h2>
                    <p className="mt-1 text-[11px] text-slate-500">{account.basicId || account.code || '—'} · {transport}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{status}</span>
                </div>
                <div className="mt-4 grid gap-3 border-t border-slate-100 pt-3 text-xs dark:border-slate-800 sm:grid-cols-2">
                  <div><span className="text-slate-500">Connection</span><p className="font-semibold">{account.health?.connection?.status || 'UNKNOWN'}</p></div>
                  <div><span className="text-slate-500">Webhook</span><p className="font-mono text-[11px]">/api/line-oa/accounts/{account.id}/webhook</p></div>
                </div>
                <a href="/line-oa/edge-connection" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"><ShieldCheck className="h-3.5 w-3.5" /> จัดการใน LINE OA Studio</a>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
