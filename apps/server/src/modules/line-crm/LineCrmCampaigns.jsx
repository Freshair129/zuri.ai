'use client'

import React, { useState } from 'react'
import {
  Send,
  Plus,
  BarChart3,
  Users,
  Eye,
  MousePointerClick,
  Sparkles,
  Calendar,
  MoreVertical,
  CheckCircle2,
  Clock,
  FileText
} from 'lucide-react'
import { CAMPAIGNS } from './mockData'

// @req FR-091, FR-148 — LineCRM Broadcast Campaigns Screen
// @spec SDD-050, ADR-060

export default function LineCrmCampaigns() {
  const [campaigns, setCampaigns] = useState(CAMPAIGNS)
  const [filterTab, setFilterTab] = useState('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newCampaignName, setNewCampaignName] = useState('')
  const [newCampaignTarget, setNewCampaignTarget] = useState('all')
  const [newCampaignFormat, setNewCampaignFormat] = useState('flex')

  const filteredCampaigns = campaigns.filter((c) => {
    if (filterTab === 'all') return true
    return c.status === filterTab
  })

  const handleCreateCampaign = (e) => {
    e.preventDefault()
    if (!newCampaignName) return

    const newCamp = {
      id: `c-${Date.now()}`,
      name: newCampaignName,
      format: newCampaignFormat === 'flex' ? 'Flex Message' : 'ข้อความ + รูปภาพ',
      status: 'sending',
      statusText: 'กำลังส่ง',
      target: newCampaignTarget === 'all' ? 'สมาชิกทั้งหมด' : 'สมาชิก VIP + Gold',
      sent: '2,458',
      opened: '0 (0.0%)',
      clicked: '0 (0.0%)',
      scheduled: 'วันนี้'
    }

    setCampaigns([newCamp, ...campaigns])
    setShowCreateModal(false)
    setNewCampaignName('')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            แคมเปญ (Broadcast)
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            สร้างและติดตามแคมเปญ Broadcast, กลุ่มเป้าหมาย และประสิทธิภาพการส่ง
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:from-purple-700 hover:to-indigo-700"
        >
          <Plus className="h-4 w-4" />
          <span>สร้างแคมเปญใหม่</span>
        </button>
      </div>

      {/* Row 1: 4 Stat Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Stat 1 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Send className="h-4 w-4 text-purple-600" />
            <span>แคมเปญทั้งหมด</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            48
          </div>
          <div className="mt-1 text-[11px] text-slate-400">กำลังทำงาน 7</div>
        </div>

        {/* Stat 2 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <FileText className="h-4 w-4 text-blue-500" />
            <span>ส่งข้อความเดือนนี้</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            12,458
          </div>
          <div className="mt-1 text-[11px] text-slate-400">จากโควตา 30,000</div>
        </div>

        {/* Stat 3 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Eye className="h-4 w-4 text-emerald-500" />
            <span>อัตราเปิดอ่านเฉลี่ย</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white">62.9%</span>
            <span className="text-[11px] font-bold text-emerald-600">▲ 3.1%</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">สูงกว่าค่าเฉลี่ยอุตสาหกรรม</div>
        </div>

        {/* Stat 4 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <MousePointerClick className="h-4 w-4 text-pink-500" />
            <span>Conversion เฉลี่ย</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            2.61%
          </div>
          <div className="mt-1 text-[11px] text-slate-400">325 คอนเวอร์ชัน</div>
        </div>
      </div>

      {/* Row 2: Campaign Filter Tabs & Table */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
        {/* Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          {[
            { id: 'all', label: 'ทั้งหมด', count: 48 },
            { id: 'sending', label: 'กำลังส่ง', count: 7 },
            { id: 'scheduled', label: 'ตั้งเวลา', count: 5 },
            { id: 'draft', label: 'ร่าง', count: 12 },
            { id: 'completed', label: 'เสร็จสิ้น', count: 24 },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterTab(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                filterTab === tab.id
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {tab.label} {tab.count}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 text-[11px] font-bold text-slate-400 dark:border-slate-800">
              <tr>
                <th className="py-2.5 pr-3">แคมเปญ</th>
                <th className="py-2.5 px-3">สถานะ</th>
                <th className="py-2.5 px-3">กลุ่มเป้าหมาย</th>
                <th className="py-2.5 px-3">ส่ง</th>
                <th className="py-2.5 px-3">เปิดอ่าน</th>
                <th className="py-2.5 px-3">คลิก / กำหนดส่ง</th>
                <th className="py-2.5 pl-3 text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredCampaigns.map((camp) => (
                <tr key={camp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                  <td className="py-3 pr-3">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                        {camp.name}
                      </div>
                      <div className="text-[10px] text-slate-400">{camp.format}</div>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        camp.status === 'sending'
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : camp.status === 'scheduled'
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                          : camp.status === 'completed'
                          ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                      }`}
                    >
                      {camp.statusText}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-semibold text-slate-700 dark:text-slate-300">
                    {camp.target}
                  </td>
                  <td className="py-3 px-3 font-bold text-slate-800 dark:text-white">{camp.sent}</td>
                  <td className="py-3 px-3 text-purple-600 font-bold">{camp.opened}</td>
                  <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                    {camp.clicked !== '-' && <span className="font-bold text-pink-600 mr-2">{camp.clicked}</span>}
                    <span>{camp.scheduled}</span>
                  </td>
                  <td className="py-3 pl-3 text-right">
                    <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Campaign Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">สร้างแคมเปญ Broadcast ใหม่</h3>
            <p className="text-xs text-slate-400 mt-1">ส่งข้อความหาผู้ติดตามหรือกลุ่มสมาชิกเป้าหมายผ่าน LINE OA</p>

            <form onSubmit={handleCreateCampaign} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">ชื่อแคมเปญ</label>
                <input
                  type="text"
                  placeholder="เช่น โปรโมชั่น Flash Sale 9.9"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-purple-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">กลุ่มเป้าหมาย (Segment)</label>
                <select
                  value={newCampaignTarget}
                  onChange={(e) => setNewCampaignTarget(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-purple-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="all">สมาชิกทั้งหมด (2,458 คน)</option>
                  <option value="vip">สมาชิก VIP + Gold (445 คน)</option>
                  <option value="birthday">วันเกิดเดือนนี้ (128 คน)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">รูปแบบข้อความ</label>
                <select
                  value={newCampaignFormat}
                  onChange={(e) => setNewCampaignFormat(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-purple-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="flex">Flex Message (Interactive Card)</option>
                  <option value="carousel">Carousel (หลายสินค้า)</option>
                  <option value="text">ข้อความทั่วไป + รูปภาพ</option>
                </select>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-700"
                >
                  ส่งแคมเปญทันที
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
