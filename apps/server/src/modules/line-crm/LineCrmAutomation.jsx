'use client'

import React, { useState } from 'react'
import {
  Zap,
  Plus,
  Play,
  CheckCircle2,
  Clock,
  Sparkles,
  ArrowRight,
  ShoppingCart,
  FileText,
  UserPlus,
  Tag,
  Star,
  Settings
} from 'lucide-react'
import { AUTOMATION_FLOWS } from './mockData'

// @req FR-091 — LineCRM Automation Engine Screen
// @spec SDD-050, ADR-060

export default function LineCrmAutomation() {
  const [flows, setFlows] = useState(AUTOMATION_FLOWS)

  const toggleFlow = (id) => {
    setFlows((prev) =>
      prev.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f))
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Automation
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            สร้าง flow อัตโนมัติแบบ Trigger → Condition → Action สำหรับตอบและดูแลลูกค้า
          </p>
        </div>
        <button className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:from-purple-700 hover:to-indigo-700">
          <Plus className="h-4 w-4" />
          <span>สร้าง Flow ใหม่</span>
        </button>
      </div>

      {/* Row 1: 4 Stat Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Stat 1 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Zap className="h-4 w-4 text-purple-600" />
            <span>Flow ทั้งหมด</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            14
          </div>
          <div className="mt-1 text-[11px] text-slate-400">ทำงานอยู่ 9</div>
        </div>

        {/* Stat 2 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Play className="h-4 w-4 text-blue-500" />
            <span>ทำงานวันนี้</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            1,284
          </div>
          <div className="mt-1 text-[11px] text-slate-400">ครั้ง</div>
        </div>

        {/* Stat 3 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>อัตราสำเร็จ</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            98.6%
          </div>
          <div className="mt-1 text-[11px] text-slate-400">ล้มเหลว 18 ครั้ง</div>
        </div>

        {/* Stat 4 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Clock className="h-4 w-4 text-amber-500" />
            <span>เวลาตอบเฉลี่ย</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            1.2 <span className="text-sm font-bold text-slate-400">วินาที</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">ตอบอัตโนมัติ</div>
        </div>
      </div>

      {/* Row 2: Flow List & Sidebar */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Flow Cards (8 cols) */}
        <div className="space-y-4 lg:col-span-8">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Flow ทั้งหมด</h3>

          {flows.map((flow) => (
            <div
              key={flow.id}
              className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm transition-all dark:border-slate-800 dark:bg-slate-900/90"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${flow.iconColor} font-bold`}>
                    <Zap className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">{flow.name}</h4>
                    <p className="text-[11px] text-slate-400">ทำงาน {flow.runsToday} ครั้งวันนี้</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={flow.enabled}
                  onChange={() => toggleFlow(flow.id)}
                  className="h-5 w-5 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                />
              </div>

              {/* Visual Pipeline Steps */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50/80 p-3 text-xs dark:bg-slate-800/40">
                {flow.steps.map((step, idx) => (
                  <React.Fragment key={idx}>
                    <span className="rounded-lg bg-white px-2.5 py-1 font-semibold text-slate-800 shadow-2xs dark:bg-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700">
                      {step}
                    </span>
                    {idx < flow.steps.length - 1 && (
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Right: Templates & Recent Execution Feed (4 cols) */}
        <div className="space-y-6 lg:col-span-4">
          {/* Templates Box */}
          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/90">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white">เทมเพลตพร้อมใช้</h4>
            <div className="mt-3 space-y-2 text-xs">
              {[
                { name: '🎂 อวยพรวันเกิด + แต้มโบนัส', tag: '+ ใช้งาน' },
                { name: '🚚 แจ้งสถานะจัดส่ง', tag: '+ ใช้งาน' },
                { name: '⭐ เตือนแต้มใกล้หมดอายุ', tag: '+ ใช้งาน' },
                { name: '🤖 Auto-reply ด้วย AI MCP', tag: '+ ใช้งาน' },
              ].map((tmpl, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 p-2.5 hover:bg-slate-100 cursor-pointer dark:border-slate-800 dark:bg-slate-800/40"
                >
                  <span className="font-semibold text-slate-700 dark:text-slate-300">{tmpl.name}</span>
                  <span className="text-[10px] text-purple-600 font-bold">{tmpl.tag}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Execution Activity Feed */}
          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/90">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white">การทำงานล่าสุด</h4>
            <div className="mt-3 space-y-3 text-xs">
              {[
                { flow: 'ต้อนรับสมาชิกใหม่ → คุณบีม', time: '14:25', status: 'success' },
                { flow: 'ยืนยันคำสั่งซื้อ → ORD-0893', time: '14:18', status: 'success' },
                { flow: 'Win-back → Nattaya S.', time: '13:40', status: 'success' },
              ].map((act, idx) => (
                <div key={idx} className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="font-medium text-slate-800 dark:text-white">{act.flow}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">{act.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
