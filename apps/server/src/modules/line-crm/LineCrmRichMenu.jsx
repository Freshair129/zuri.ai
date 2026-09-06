'use client'

import React, { useState } from 'react'
import {
  Grid,
  Plus,
  Upload,
  Layers,
  Sparkles,
  ExternalLink,
  Home,
  ShoppingBag,
  Star,
  Gift,
  Phone,
  User,
  CheckCircle2
} from 'lucide-react'

// @req FR-151, FR-152, FR-153 — LineCRM Rich Menu Visual Designer
// @spec SDD-050, ADR-060, ADR-061

export default function LineCrmRichMenu() {
  const [selectedCell, setSelectedCell] = useState(2) // 0-indexed cell 2 = 'แต้มของฉัน'
  const [actionType, setActionType] = useState('liff')
  const [actionUrl, setActionUrl] = useState('/portal/points')
  const [activeMenuId, setActiveMenuId] = useState('menu-1')
  const [publishSuccess, setPublishSuccess] = useState(false)

  const CELLS = [
    { id: 0, title: 'หน้าแรก', icon: Home, color: 'text-amber-500', action: 'เปิดเว็บ', dest: 'https://zuri.ai' },
    { id: 1, title: 'สินค้า', icon: ShoppingBag, color: 'text-purple-600', action: 'ส่งข้อความ', dest: 'ดูรายการสินค้า' },
    { id: 2, title: 'แต้มของฉัน', icon: Star, color: 'text-amber-500', action: 'เปิด LIFF (Member Portal)', dest: '/portal/points' },
    { id: 3, title: 'แลกรางวัล', icon: Gift, color: 'text-rose-500', action: 'เปิด LIFF (Member Portal)', dest: '/portal/rewards' },
    { id: 4, title: 'ติดต่อเรา', icon: Phone, color: 'text-pink-500', action: 'ส่งข้อความ', dest: 'ติดต่อเจ้าหน้าที่' },
    { id: 5, title: 'โปรไฟล์', icon: User, color: 'text-blue-600', action: 'เปิด LIFF (Member Portal)', dest: '/portal/profile' },
  ]

  const handlePublish = () => {
    setPublishSuccess(true)
    setTimeout(() => setPublishSuccess(false), 3000)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Rich Menu
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            ออกแบบและจัดการเมนูลัดด้านล่างของแชท LINE พร้อมกำหนด action แต่ละช่อง
          </p>
        </div>
        <button className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:from-purple-700 hover:to-indigo-700">
          <Plus className="h-4 w-4" />
          <span>สร้าง Rich Menu ใหม่</span>
        </button>
      </div>

      {publishSuccess && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300 animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>เผยแพร่ Rich Menu ไปยัง LINE OA สำเร็จเรียบร้อยแล้ว</span>
        </div>
      )}

      {/* Main Grid & Library Container */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left/Center: Visual Editor (8 cols) */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm lg:col-span-8 dark:border-slate-800 dark:bg-slate-900/90">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">ตัวออกแบบเมนู</h3>
              <p className="text-xs text-slate-400">เทมเพลต 6 ช่อง (2×3)</p>
            </div>
            <div className="flex items-center gap-2">
              <button className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                เลย์เอาต์ ▼
              </button>
              <button className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                🖼️ อัปโหลดพื้นหลัง
              </button>
            </div>
          </div>

          {/* Interactive 2x3 Visual Canvas */}
          <div className="mt-4 overflow-hidden rounded-2xl border-2 border-dashed border-purple-200 bg-gradient-to-br from-purple-50/40 via-pink-50/20 to-slate-50/40 p-2 dark:border-purple-900/50 dark:from-purple-950/20 dark:to-slate-900">
            <div className="grid grid-cols-3 gap-2">
              {CELLS.map((cell) => {
                const Icon = cell.icon
                const isSelected = selectedCell === cell.id
                return (
                  <button
                    key={cell.id}
                    onClick={() => setSelectedCell(cell.id)}
                    className={`flex h-36 flex-col items-center justify-center rounded-xl p-3 text-center transition-all ${
                      isSelected
                        ? 'border-2 border-purple-600 bg-white shadow-md ring-4 ring-purple-100 dark:bg-slate-800 dark:ring-purple-950'
                        : 'border border-slate-200/80 bg-white/60 hover:bg-white dark:border-slate-800 dark:bg-slate-800/60'
                    }`}
                  >
                    <Icon className={`h-8 w-8 ${cell.color} mb-2`} />
                    <span className="text-xs font-bold text-slate-800 dark:text-white">{cell.title}</span>
                    <span className="mt-0.5 text-[10px] text-slate-400 truncate max-w-[90px]">{cell.dest}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Action Configurator for Selected Cell */}
          <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="text-xs font-bold text-slate-800 dark:text-white mb-3">
              Action ของช่องที่เลือก: <span className="text-purple-600 font-extrabold">{CELLS[selectedCell].title}</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">ประเภท Action</label>
                <select
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs focus:border-purple-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="liff">เปิด LIFF (Member Portal)</option>
                  <option value="message">ส่งข้อความอัตโนมัติ</option>
                  <option value="url">เปิด URL เว็บไซต์</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">ปลายทาง (Destination)</label>
                <input
                  type="text"
                  value={actionUrl}
                  onChange={(e) => setActionUrl(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs focus:border-purple-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                บันทึกร่าง
              </button>
              <button
                onClick={handlePublish}
                className="rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-md hover:from-purple-700 hover:to-indigo-700"
              >
                🚀 เผยแพร่เมนู
              </button>
            </div>
          </div>
        </div>

        {/* Right: Rich Menu Catalog (4 cols) */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm lg:col-span-4 dark:border-slate-800 dark:bg-slate-900/90">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">เมนูทั้งหมด</h3>
          <p className="text-xs text-slate-400 mb-4">สลับเมนูหรือตั้งเป็น Default สำหรับผู้ใช้</p>

          <div className="space-y-3">
            {/* Menu 1 */}
            <div
              onClick={() => setActiveMenuId('menu-1')}
              className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                activeMenuId === 'menu-1'
                  ? 'border-purple-400 bg-purple-50/40 ring-2 ring-purple-200 dark:border-purple-800 dark:bg-purple-950/30'
                  : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60'
              }`}
            >
              <div className="h-16 rounded-xl bg-gradient-to-r from-purple-200 via-pink-200 to-indigo-200 dark:from-purple-900 dark:to-indigo-950 mb-2" />
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">เมนูหลัก (6 ช่อง)</h4>
                  <p className="text-[10px] text-slate-400">อัปเดต 5 ส.ค. 2569</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  ใช้งาน
                </span>
              </div>
            </div>

            {/* Menu 2 */}
            <div
              onClick={() => setActiveMenuId('menu-2')}
              className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                activeMenuId === 'menu-2'
                  ? 'border-purple-400 bg-purple-50/40 ring-2 ring-purple-200 dark:border-purple-800 dark:bg-purple-950/30'
                  : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60'
              }`}
            >
              <div className="h-16 rounded-xl bg-gradient-to-r from-emerald-200 via-teal-200 to-cyan-200 dark:from-emerald-900 dark:to-teal-950 mb-2" />
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">โปรโมชั่น (2 ช่อง)</h4>
                  <p className="text-[10px] text-slate-400">อัปเดต 1 ส.ค. 2569</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  ร่าง
                </span>
              </div>
            </div>

            {/* Menu 3 */}
            <div
              onClick={() => setActiveMenuId('menu-3')}
              className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                activeMenuId === 'menu-3'
                  ? 'border-purple-400 bg-purple-50/40 ring-2 ring-purple-200 dark:border-purple-800 dark:bg-purple-950/30'
                  : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60'
              }`}
            >
              <div className="h-16 rounded-xl bg-gradient-to-r from-amber-200 via-orange-200 to-rose-200 dark:from-amber-900 dark:to-rose-950 mb-2" />
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">สมาชิก VIP (3 ช่อง)</h4>
                  <p className="text-[10px] text-slate-400">อัปเดต 28 ก.ค. 2569</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  ร่าง
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
