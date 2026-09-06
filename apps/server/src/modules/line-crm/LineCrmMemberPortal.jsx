'use client'

import React, { useState } from 'react'
import {
  Smartphone,
  Copy,
  CheckCircle2,
  Gift,
  History,
  Tag,
  User,
  Star,
  QrCode,
  Sparkles,
  Eye,
  Send
} from 'lucide-react'

// @req FR-153 — Member Portal (LIFF) Mobile Emulator & Config
// @spec SDD-050, ADR-060

export default function LineCrmMemberPortal() {
  const [copied, setCopied] = useState(false)
  const [portalTheme, setPortalTheme] = useState('purple')
  const [features, setFeatures] = useState({
    redeem: true,
    history: true,
    coupons: true,
    scanQr: false,
  })

  const THEMES = {
    purple: 'from-purple-600 to-indigo-600',
    emerald: 'from-emerald-500 to-teal-600',
    amber: 'from-amber-500 to-orange-600',
    blue: 'from-blue-600 to-cyan-600',
  }

  const handleCopy = () => {
    navigator.clipboard?.writeText('https://liff.line.me/1657xxxxxx')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const toggleFeature = (key) => {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Member Portal (LIFF)
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            หน้าสมาชิกบนมือถือผ่าน LINE — ดูแต้ม แลกรางวัล ประวัติ และโปรไฟล์
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <Eye className="h-4 w-4 text-slate-500" />
            <span>พรีวิว</span>
          </button>
          <button className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:from-purple-700 hover:to-indigo-700">
            <Send className="h-4 w-4" />
            <span>เผยแพร่</span>
          </button>
        </div>
      </div>

      {/* LIFF URL Banner */}
      <div className="flex items-center justify-between rounded-2xl border border-purple-200 bg-purple-50/60 p-3 px-5 text-xs text-purple-900 dark:border-purple-900/50 dark:bg-purple-950/40 dark:text-purple-200">
        <div className="flex items-center gap-2">
          <span className="font-bold">LIFF URL:</span>
          <span className="font-mono text-purple-700 dark:text-purple-300">https://liff.line.me/1657xxxxxx</span>
        </div>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1 font-bold text-purple-600 hover:text-purple-800 dark:text-purple-300"
        >
          {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          <span>{copied ? 'คัดลอกแล้ว!' : 'คัดลอก URL'}</span>
        </button>
      </div>

      {/* Main Grid: Mobile Phone Frame (Left) + Config Panel (Right) */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left: Smartphone Emulator Bezel (5 cols) */}
        <div className="flex justify-center lg:col-span-5">
          <div className="relative w-80 rounded-[40px] border-8 border-slate-800 bg-slate-900 p-3 shadow-2xl ring-1 ring-slate-900/50">
            {/* Camera Notch */}
            <div className="absolute left-1/2 top-5 -translate-x-1/2 h-4 w-24 rounded-full bg-black z-20" />

            {/* Screen Content */}
            <div className="overflow-hidden rounded-[28px] bg-slate-50 pt-8 pb-4 text-slate-800 min-h-[520px] flex flex-col justify-between">
              <div>
                {/* Member Header Card */}
                <div className={`mx-3 rounded-2xl bg-gradient-to-br ${THEMES[portalTheme]} p-4 text-white shadow-md`}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-bold backdrop-blur-md">
                      กป
                    </div>
                    <div>
                      <h4 className="text-xs font-bold">กิตติพงศ์ ป.</h4>
                      <span className="rounded bg-amber-400/20 px-1.5 py-0.2 text-[9px] font-bold text-amber-200">
                        ⭐ สมาชิก Gold
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/20">
                    <div className="text-[10px] text-white/80">แต้มสะสม</div>
                    <div className="text-xl font-black">1,245 <span className="text-xs font-normal">แต้ม</span></div>
                    <div className="text-[9px] text-white/70">มูลค่า ฿1,245</div>
                  </div>
                </div>

                {/* Quick Menu Icons */}
                <div className="mx-3 mt-4 grid grid-cols-4 gap-2 rounded-2xl bg-white p-3 text-center shadow-xs">
                  {features.redeem && (
                    <div className="flex flex-col items-center">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                        <Gift className="h-4 w-4" />
                      </div>
                      <span className="mt-1 text-[9px] font-semibold">แลกรางวัล</span>
                    </div>
                  )}
                  {features.history && (
                    <div className="flex flex-col items-center">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                        <History className="h-4 w-4" />
                      </div>
                      <span className="mt-1 text-[9px] font-semibold">ประวัติ</span>
                    </div>
                  )}
                  {features.coupons && (
                    <div className="flex flex-col items-center">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
                        <Tag className="h-4 w-4" />
                      </div>
                      <span className="mt-1 text-[9px] font-semibold">คูปอง</span>
                    </div>
                  )}
                  <div className="flex flex-col items-center">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      <User className="h-4 w-4" />
                    </div>
                    <span className="mt-1 text-[9px] font-semibold">โปรไฟล์</span>
                  </div>
                </div>

                {/* Recommended Rewards */}
                <div className="mx-3 mt-4">
                  <div className="text-[10px] font-bold text-slate-500 mb-2">ของรางวัลแนะนำ</div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-xl bg-white p-2.5 shadow-2xs">
                      <div className="flex items-center gap-2">
                        <Tag className="h-4 w-4 text-amber-500" />
                        <div>
                          <div className="text-[11px] font-bold">ส่วนลด ฿100</div>
                          <div className="text-[9px] text-slate-400">500 แต้ม</div>
                        </div>
                      </div>
                      <button className="rounded-lg bg-purple-600 px-2.5 py-1 text-[9px] font-bold text-white">
                        แลก
                      </button>
                    </div>

                    <div className="flex items-center justify-between rounded-xl bg-white p-2.5 shadow-2xs">
                      <div className="flex items-center gap-2">
                        <Gift className="h-4 w-4 text-rose-500" />
                        <div>
                          <div className="text-[11px] font-bold">บัตรกาแฟ ฿150</div>
                          <div className="text-[9px] text-slate-400">700 แต้ม</div>
                        </div>
                      </div>
                      <button className="rounded-lg bg-purple-600 px-2.5 py-1 text-[9px] font-bold text-white">
                        แลก
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-center text-[9px] text-slate-400">
                powered by LineCRM-MCP
              </div>
            </div>
          </div>
        </div>

        {/* Right: Portal Controls & Theme Picker (7 cols) */}
        <div className="space-y-6 lg:col-span-7">
          {/* Menu Features Config */}
          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/90">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-4">เมนูใน Portal</h3>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                <div>
                  <div className="text-xs font-bold text-slate-800 dark:text-white">🎁 แลกของรางวัล</div>
                  <div className="text-[10px] text-slate-400 font-mono">/portal/rewards</div>
                </div>
                <input
                  type="checkbox"
                  checked={features.redeem}
                  onChange={() => toggleFeature('redeem')}
                  className="h-4 w-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                <div>
                  <div className="text-xs font-bold text-slate-800 dark:text-white">📜 ประวัติแต้ม</div>
                  <div className="text-[10px] text-slate-400 font-mono">/portal/history</div>
                </div>
                <input
                  type="checkbox"
                  checked={features.history}
                  onChange={() => toggleFeature('history')}
                  className="h-4 w-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                <div>
                  <div className="text-xs font-bold text-slate-800 dark:text-white">🏷️ คูปองของฉัน</div>
                  <div className="text-[10px] text-slate-400 font-mono">/portal/coupons</div>
                </div>
                <input
                  type="checkbox"
                  checked={features.coupons}
                  onChange={() => toggleFeature('coupons')}
                  className="h-4 w-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                <div>
                  <div className="text-xs font-bold text-slate-800 dark:text-white">📷 สแกน QR รับแต้ม</div>
                  <div className="text-[10px] text-slate-400 font-mono">/portal/scan (ปิด)</div>
                </div>
                <input
                  type="checkbox"
                  checked={features.scanQr}
                  onChange={() => toggleFeature('scanQr')}
                  className="h-4 w-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Usage Metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200/80 bg-white/80 p-3 text-center dark:border-slate-800 dark:bg-slate-900/80">
              <div className="text-[10px] text-slate-400">เข้าใช้วันนี้</div>
              <div className="text-lg font-black text-slate-900 dark:text-white">642</div>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white/80 p-3 text-center dark:border-slate-800 dark:bg-slate-900/80">
              <div className="text-[10px] text-slate-400">แลกรางวัลวันนี้</div>
              <div className="text-lg font-black text-purple-600">38</div>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white/80 p-3 text-center dark:border-slate-800 dark:bg-slate-900/80">
              <div className="text-[10px] text-slate-400">คูปองใช้แล้ว</div>
              <div className="text-lg font-black text-amber-600">124</div>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white/80 p-3 text-center dark:border-slate-800 dark:bg-slate-900/80">
              <div className="text-[10px] text-slate-400">คะแนน UX</div>
              <div className="text-lg font-black text-emerald-600">4.8★</div>
            </div>
          </div>

          {/* Portal Theme Color Picker */}
          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/90">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">ธีมของ Portal</h3>
            <div className="flex gap-3">
              {[
                { id: 'purple', class: 'bg-gradient-to-r from-purple-600 to-indigo-600' },
                { id: 'emerald', class: 'bg-gradient-to-r from-emerald-500 to-teal-600' },
                { id: 'amber', class: 'bg-gradient-to-r from-amber-500 to-orange-600' },
                { id: 'blue', class: 'bg-gradient-to-r from-blue-600 to-cyan-600' },
              ].map((th) => (
                <button
                  key={th.id}
                  onClick={() => setPortalTheme(th.id)}
                  className={`h-10 w-10 rounded-xl ${th.class} transition-all ${
                    portalTheme === th.id ? 'ring-4 ring-purple-200 scale-110 shadow-md' : 'opacity-80 hover:opacity-100'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
