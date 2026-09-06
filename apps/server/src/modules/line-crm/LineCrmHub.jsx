'use client'

import React from 'react'
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Star,
  Send,
  Radio,
  Grid,
  Zap,
  Bot,
  Smartphone,
  ShieldCheck,
  Settings,
  Sparkles
} from 'lucide-react'

// @req FR-091 — LineCRM-MCP Mockup Hub launchpad
// @spec SDD-050, ADR-060

export default function LineCrmHub({ onSelectModule }) {
  const MODULES = [
    {
      id: 'dashboard',
      title: 'แดชบอร์ด',
      subtitle: 'KPI, กราฟ, สรุป Tier, การสนทนา',
      icon: LayoutDashboard,
      color: 'bg-orange-500/10 text-orange-600 border-orange-200',
      badge: 'All-in-One',
    },
    {
      id: 'chat',
      title: 'แชทสด / Live Chat',
      subtitle: '3 คอลัมน์ + AI Assist + member 360°',
      icon: MessageSquare,
      color: 'bg-purple-500/10 text-purple-600 border-purple-200',
      badge: '12 ข้อความใหม่',
      badgeColor: 'bg-rose-500 text-white',
    },
    {
      id: 'members',
      title: 'สมาชิก CRM',
      subtitle: 'ตารางสมาชิก + panel ข้อมูล 360°',
      icon: Users,
      color: 'bg-blue-500/10 text-blue-600 border-blue-200',
      badge: '2,458 สมาชิก',
    },
    {
      id: 'loyalty',
      title: 'แต้มสะสม',
      subtitle: 'ประวัติแต้ม, กฎ, ของรางวัล',
      icon: Star,
      color: 'bg-amber-500/10 text-amber-600 border-amber-200',
      badge: '78,650 แต้มคงเหลือ',
    },
    {
      id: 'campaigns',
      title: 'แคมเปญ',
      subtitle: 'Broadcast + สถิติเปิดอ่าน/คลิก',
      icon: Send,
      color: 'bg-rose-500/10 text-rose-600 border-rose-200',
      badge: '7 กำลังส่ง',
    },
    {
      id: 'line-oa',
      title: 'LINE OA',
      subtitle: 'Multi-OA + สถานะ Webhook',
      icon: Radio,
      color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200',
      badge: '3 บัญชีเชื่อมต่อ',
    },
    {
      id: 'rich-menu',
      title: 'Rich Menu',
      subtitle: 'ตัวออกแบบเมนู + preview',
      icon: Grid,
      color: 'bg-green-500/10 text-green-600 border-green-200',
      badge: '3 เมนู',
    },
    {
      id: 'automation',
      title: 'Automation',
      subtitle: 'Flow trigger → action',
      icon: Zap,
      color: 'bg-indigo-500/10 text-indigo-600 border-indigo-200',
      badge: '14 Flows',
    },
    {
      id: 'ai-mcp',
      title: 'AI MCP',
      subtitle: 'MCP Tools + Task Queue',
      icon: Bot,
      color: 'bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-200',
      badge: 'Beta · 18 Tools',
      badgeColor: 'bg-gradient-to-r from-purple-600 to-pink-600 text-white',
    },
    {
      id: 'member-portal',
      title: 'Member Portal',
      subtitle: 'LIFF พรีวิวมือถือ + config',
      icon: Smartphone,
      color: 'bg-cyan-500/10 text-cyan-600 border-cyan-200',
      badge: 'LIFF พร้อมใช้',
    },
    {
      id: 'audit-log',
      title: 'Audit Log',
      subtitle: 'บันทึกกิจกรรม PDPA/ISO',
      icon: ShieldCheck,
      color: 'bg-amber-500/10 text-amber-700 border-amber-200',
      badge: '1,842 บันทึกวันนี้',
    },
    {
      id: 'settings',
      title: 'ตั้งค่า',
      subtitle: 'ทั่วไป, RBAC, แจ้งเตือน, security',
      icon: Settings,
      color: 'bg-slate-500/10 text-slate-600 border-slate-200',
      badge: 'ระบบ',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-purple-950 to-indigo-950 p-8 text-white shadow-xl">
        <div className="relative z-10 max-w-3xl space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span>LineCRM-MCP — Mockup Suite</span>
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">v1.0 Ready</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            ชุดระบบบริหารจัดการ LINE OA และ CRM อัจฉริยะ ครบ 12 เมนู
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            Prompt + Glassmorphism + Dark/Light Mode + ปฏิทิน พ.ศ. พร้อมระบบ AI MCP Control Plane และ Live Simulator
          </p>
        </div>
        <div className="absolute right-0 top-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-purple-500/20 blur-3xl pointer-events-none" />
        <div className="absolute right-32 bottom-0 h-40 w-40 rounded-full bg-amber-500/20 blur-2xl pointer-events-none" />
      </div>

      {/* 12 Module Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((mod) => {
          const Icon = mod.icon
          return (
            <button
              key={mod.id}
              onClick={() => onSelectModule(mod.id)}
              className="group relative flex flex-col justify-between rounded-2xl border border-white/60 bg-white/80 p-5 text-left shadow-sm backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-purple-300 hover:bg-white hover:shadow-md dark:border-slate-800 dark:bg-slate-900/80 dark:hover:bg-slate-900"
            >
              <div className="flex items-start justify-between">
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl border ${mod.color}`}>
                  <Icon className="h-6 w-6" />
                </div>
                {mod.badge && (
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${mod.badgeColor || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                    {mod.badge}
                  </span>
                )}
              </div>
              <div className="mt-4 space-y-1">
                <h3 className="text-base font-bold text-slate-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                  {mod.title}
                </h3>
                <p className="text-xs text-slate-500 line-clamp-2 dark:text-slate-400">
                  {mod.subtitle}
                </p>
              </div>
              <div className="mt-4 flex items-center text-xs font-semibold text-purple-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-purple-400">
                <span>เปิดใช้งานหน้านี้</span>
                <span className="ml-1">→</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
