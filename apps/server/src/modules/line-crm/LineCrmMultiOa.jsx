'use client'

import React, { useState } from 'react'
import {
  Radio,
  Plus,
  Users,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Settings,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  Key
} from 'lucide-react'
import { CONNECTED_LINE_OAS } from './mockData'

// @req FR-146, FR-147 — Multi-OA Management Screen
// @spec SDD-050, ADR-060, ADR-061

export default function LineCrmMultiOa() {
  const [oas, setOas] = useState(CONNECTED_LINE_OAS)
  const [testWebhookOa, setTestWebhookOa] = useState(null)
  const [testResult, setTestResult] = useState(null)

  const handleTestWebhook = (oa) => {
    setTestWebhookOa(oa)
    setTestResult('testing')
    setTimeout(() => {
      setTestResult('success')
    }, 1000)
  }

  const handleRenewToken = (oaId) => {
    setOas((prev) =>
      prev.map((o) =>
        o.id === oaId
          ? { ...o, status: 'normal', statusText: 'ปกติ', tokenStatus: 'ใช้งานได้ (ต่ออายุแล้ว)', webhookStatus: 'Verified', webhookFailRate: null }
          : o
      )
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            LINE OA (Multi-OA)
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            เชื่อมต่อและจัดการหลาย LINE Official Account พร้อมตรวจสอบสถานะ Webhook
          </p>
        </div>
        <button className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:from-purple-700 hover:to-indigo-700">
          <Plus className="h-4 w-4" />
          <span>เชื่อมต่อ OA ใหม่</span>
        </button>
      </div>

      {/* Row 1: 4 Stat Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Stat 1 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Radio className="h-4 w-4 text-purple-600" />
            <span>OA ที่เชื่อมต่อ</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            {oas.length}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">พร้อมใช้งาน 2 · เตือน 1</div>
        </div>

        {/* Stat 2 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Users className="h-4 w-4 text-blue-500" />
            <span>ผู้ติดตามรวม</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            18,942
          </div>
          <div className="mt-1 text-[11px] text-slate-400">ทุก OA</div>
        </div>

        {/* Stat 3 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>Webhook สำเร็จ</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            94.3%
          </div>
          <div className="mt-1 text-[11px] text-slate-400">3,512 / 3,726 วันนี้</div>
        </div>

        {/* Stat 4 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Key className="h-4 w-4 text-amber-500" />
            <span>โควตา Push เดือนนี้</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            12,458
          </div>
          <div className="mt-1 text-[11px] text-slate-400">จาก 30,000</div>
        </div>
      </div>

      {/* Connected LINE OA Cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {oas.map((oa) => (
          <div
            key={oa.id}
            className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/90"
          >
            <div>
              {/* Card Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl font-bold text-white text-base ${oa.color} shadow-sm`}>
                    {oa.name.slice(0, 2)}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{oa.name}</h3>
                    <p className="text-[11px] text-slate-400">{oa.handle}</p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                    oa.status === 'normal'
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                  }`}
                >
                  {oa.statusText}
                </span>
              </div>

              {/* Stats row */}
              <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-800/60">
                <div>
                  <div className="text-[10px] text-slate-400">ผู้ติดตาม</div>
                  <div className="text-sm font-bold text-slate-800 dark:text-white">{oa.followers}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Webhook</div>
                  <div className={`text-sm font-bold ${oa.webhookFailRate ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {oa.webhookStatus}
                  </div>
                </div>
              </div>

              {/* Technical Details */}
              <div className="mt-4 space-y-1.5 text-xs text-slate-600 dark:text-slate-400 border-t border-slate-100 pt-3 dark:border-slate-800">
                <div className="flex justify-between">
                  <span className="text-slate-400">Channel ID:</span>
                  <span className="font-mono text-slate-800 dark:text-white">{oa.channelId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Access Token:</span>
                  <span className={`font-semibold ${oa.status === 'expiring' ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {oa.tokenStatus}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">อัปเดตล่าสุด:</span>
                  <span>{oa.lastUpdated}</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-5 flex gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              {oa.status === 'expiring' ? (
                <button
                  onClick={() => handleRenewToken(oa.id)}
                  className="w-full rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 py-2 text-xs font-bold text-white shadow-md hover:from-pink-700 hover:to-purple-700"
                >
                  🔑 ต่ออายุ Token
                </button>
              ) : (
                <>
                  <button className="flex-1 rounded-xl border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    ⚙️ ตั้งค่า
                  </button>
                  <button
                    onClick={() => handleTestWebhook(oa)}
                    className="flex-1 rounded-xl border border-purple-200 bg-purple-50 py-2 text-xs font-bold text-purple-700 hover:bg-purple-100 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-300"
                  >
                    ⚡ ทดสอบ Webhook
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Webhook Test Modal */}
      {testWebhookOa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">ทดสอบ Webhook: {testWebhookOa.name}</h3>
            <p className="text-xs text-slate-400 mt-1">ส่ง Ping Event ไปยังระบบปลายทางเพื่อตรวจสอบการตอบสนอง</p>

            <div className="mt-4 rounded-xl bg-slate-50 p-4 text-xs dark:bg-slate-800 space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Endpoint:</span>
                <span className="font-mono text-purple-600">/api/agent/line-webhook</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Status Code:</span>
                <span className="font-bold text-emerald-600">200 OK (Verified)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Latency:</span>
                <span className="font-bold text-slate-800 dark:text-white">42ms</span>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setTestWebhookOa(null)}
                className="rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-700"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
