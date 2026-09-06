'use client'

import React, { useState } from 'react'
import {
  Settings,
  Users,
  Bell,
  ShieldCheck,
  CheckCircle2,
  Globe,
  Calendar,
  DollarSign,
  Moon,
  Sun,
  Save
} from 'lucide-react'

// @req BR-001, SEC-005 — LineCRM Settings & System Config
// @spec SDD-050, ADR-060

export default function LineCrmSettings({ isDark, onToggleDark }) {
  const [activeTab, setActiveTab] = useState('general')
  const [workspaceName, setWorkspaceName] = useState('Demo Workspace')
  const [workspaceId, setWorkspaceId] = useState('@demo_workspace')
  const [timezone, setTimezone] = useState('Asia/Bangkok (GMT+7)')
  const [dateFormat, setDateFormat] = useState('buddhist')
  const [currency, setCurrency] = useState('THB')
  const [language, setLanguage] = useState('th')
  const [allowThemeToggle, setAllowThemeToggle] = useState(true)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const handleSave = (e) => {
    e.preventDefault()
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 2500)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          ตั้งค่า
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          จัดการค่าทั่วไป ผู้ใช้และสิทธิ์ การแจ้งเตือน และความปลอดภัยของ workspace
        </p>
      </div>

      {saveSuccess && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300 animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>บันทึกการเปลี่ยนแปลงการตั้งค่าเรียบร้อยแล้ว</span>
        </div>
      )}

      {/* Main Container: Left Tabs + Right Form */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Tabs (4 cols) */}
        <div className="space-y-1 lg:col-span-3">
          {[
            { id: 'general', label: 'ทั่วไป', icon: Settings },
            { id: 'rbac', label: 'ผู้ใช้ & สิทธิ์ (RBAC)', icon: Users },
            { id: 'notifications', label: 'การแจ้งเตือน', icon: Bell },
            { id: 'security', label: 'ความปลอดภัย', icon: ShieldCheck },
          ].map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex w-full items-center gap-2.5 rounded-xl px-4 py-2.5 text-xs font-bold transition-all ${
                  activeTab === tab.id
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Right Content Form (9 cols) */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur-sm lg:col-span-9 dark:border-slate-800 dark:bg-slate-900/90">
          {activeTab === 'general' && (
            <form onSubmit={handleSave} className="space-y-5">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 pb-3 dark:border-slate-800">
                ข้อมูลทั่วไป
              </h3>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">ชื่อ Workspace</label>
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-purple-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Workspace ID</label>
                  <input
                    type="text"
                    value={workspaceId}
                    disabled
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">เขตเวลา (Timezone)</label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-purple-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="Asia/Bangkok (GMT+7)">Asia/Bangkok (GMT+7)</option>
                    <option value="UTC">UTC (+0)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">รูปแบบวันที่</label>
                  <select
                    value={dateFormat}
                    onChange={(e) => setDateFormat(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-purple-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="buddhist">พุทธศักราช (พ.ศ.) · 11 ส.ค. 2569</option>
                    <option value="gregorian">คริสต์ศักราช (ค.ศ.) · 11 Aug 2026</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">สกุลเงิน</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-purple-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="THB">บาท (฿ THB)</option>
                    <option value="USD">US Dollar ($ USD)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">ภาษาเริ่มต้น</label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-purple-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="th">ไทย</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>

              {/* Dark/Light Theme Switch */}
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">โหมดธีม Dark/Light</div>
                  <div className="text-[11px] text-slate-400">ให้ผู้ใช้สลับโหมดการแสดงผลสว่าง/มืดได้เองอย่างราบรื่น</div>
                </div>
                <input
                  type="checkbox"
                  checked={allowThemeToggle}
                  onChange={(e) => {
                    setAllowThemeToggle(e.target.checked)
                    onToggleDark && onToggleDark()
                  }}
                  className="h-5 w-5 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                />
              </div>

              {/* Form Buttons */}
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-md hover:from-purple-700 hover:to-indigo-700"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>บันทึกการเปลี่ยนแปลง</span>
                </button>
              </div>
            </form>
          )}

          {activeTab === 'rbac' && (
            <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 pb-3 dark:border-slate-800">
                ผู้ใช้ & สิทธิ์การใช้งาน (RBAC)
              </h3>
              <div className="space-y-2">
                {[
                  { name: 'Admin Demo', email: 'owner@example.com', role: 'Owner (ผู้ดูแลสูงสุด)', status: 'Active' },
                  { name: 'สมหญิง การดี', email: 'somying@example.com', role: 'Agent (เจ้าหน้าที่แชท)', status: 'Active' },
                  { name: 'วิชัย มั่นคง', email: 'wichai@example.com', role: 'Manager (ผู้จัดการ)', status: 'Active' },
                ].map((user, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded-xl border border-slate-100 p-3 dark:border-slate-800">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{user.name}</div>
                      <div className="text-[10px] text-slate-400">{user.email} · {user.role}</div>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      {user.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 pb-3 dark:border-slate-800">
                การแจ้งเตือนระบบ
              </h3>
              <p className="text-slate-400">กำหนดช่องทางการแจ้งเตือนเมื่อมีคำสั่งซื้อใหม่ หรือ Webhook ทำงานผิดพลาด</p>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 pb-3 dark:border-slate-800">
                ความปลอดภัย & PDPA
              </h3>
              <p className="text-slate-400">นโยบายความเป็นส่วนตัว การจัดเก็บคีย์ Vault และการลบข้อมูล (Erasure Request)</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
