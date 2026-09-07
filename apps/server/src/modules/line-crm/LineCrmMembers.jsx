'use client'

import React, { useState, useMemo } from 'react'
import {
  Users,
  Search,
  Filter,
  Download,
  Plus,
  MoreVertical,
  Star,
  ShoppingBag,
  ExternalLink,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react'
import { CRM_MEMBERS_DIRECTORY, TIERS } from './mockData'
import { useScope } from '@/context/ScopeContext'
import { useFetch } from '@/modules/project-manager/components/useApi'

// @req FR-091, FR-078 — CRM Member 360 Directory & Slide-over Drawer
// @spec SDD-050, BR-001

export default function LineCrmMembers() {
  const { businessId, selectedBusiness } = useScope()
  const [dataMode, setDataMode] = useState('auto') // 'auto' | 'demo'
  const [search, setSearch] = useState('')
  const [selectedTier, setSelectedTier] = useState('ALL')
  const [activeMember, setActiveMember] = useState(null)

  // Fetch real registered LINE users & customers
  const regPath = businessId ? `/api/platform/integrations?businessId=${encodeURIComponent(businessId)}` : '/api/platform/integrations'
  const integrations = useFetch(regPath, [businessId])

  const convPath = businessId ? `/api/crm/conversations?businessId=${encodeURIComponent(businessId)}` : '/api/crm/conversations'
  const liveInbox = useFetch(convPath, [businessId])

  const registeredUsers = useMemo(() => {
    const registry = integrations.data?.lineRegistry || []
    return registry.filter(r => r.kind === 'USER')
  }, [integrations.data])

  const realCustomers = useMemo(() => {
    return liveInbox.data?.conversations || []
  }, [liveInbox.data])

  const hasRealMembers = registeredUsers.length > 0 || realCustomers.length > 0
  const isLive = dataMode === 'demo' ? false : hasRealMembers

  const members = useMemo(() => {
    const list = []
    registeredUsers.forEach((u, i) => {
      list.push({
        id: u.externalAccountId || `REG-${i + 1}`,
        name: u.name || 'พนักงาน / ผู้ใช้ LINE',
        phone: u.metadata?.phone || '—',
        email: u.metadata?.email || '—',
        lineHandle: `@${(u.name || 'user').toLowerCase().replace(/\s+/g, '')}`,
        tier: u.metadata?.role || 'Member',
        points: u.metadata?.points || 100,
        totalSpend: 0,
        ordersCount: 0,
        joinDate: u.createdAt ? new Date(u.createdAt).toLocaleDateString('th-TH') : 'วันนี้',
        tags: [u.metadata?.department || 'ฝ่ายขาย', 'LINE Registry'],
        lastActive: u.updatedAt ? new Date(u.updatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : 'เมื่อสักครู่',
        notes: `ลงทะเบียนในบทบาท ${u.metadata?.role || 'พนักงาน'} (${u.metadata?.department || 'ทั่วไป'})`,
        recentOrders: []
      })
    })

    realCustomers.forEach((c) => {
      if (!list.some(m => m.id === c.customerId)) {
        list.push({
          id: c.customerId || c.id,
          name: c.customer?.displayName || 'ลูกค้า LINE',
          phone: c.customer?.metadata?.phone || '—',
          email: c.customer?.metadata?.email || '—',
          lineHandle: `@${(c.customer?.displayName || 'user').toLowerCase().replace(/\s+/g, '')}`,
          tier: c.customer?.lifecycleStage || 'Silver',
          points: c.customer?.metadata?.points || 0,
          totalSpend: c.customer?.metadata?.spend || 0,
          ordersCount: 1,
          joinDate: c.createdAt ? new Date(c.createdAt).toLocaleDateString('th-TH') : 'วันนี้',
          tags: ['ลูกค้าแชท', c.channel || 'LINE'],
          lastActive: c.lastMessage?.createdAt ? new Date(c.lastMessage.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—',
          notes: 'ลูกค้าที่ทักเข้ามาผ่านระบบ LINE OA',
          recentOrders: []
        })
      }
    })

    return list
  }, [registeredUsers, realCustomers])

  const filteredMembers = members.filter((m) => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.phone.includes(search) || m.id.toLowerCase().includes(search.toLowerCase())
    if (selectedTier === 'ALL') return matchSearch
    return matchSearch && m.tier.toUpperCase() === selectedTier.toUpperCase()
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              สมาชิก CRM (Member 360°)
            </h1>
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live DB ({members.length})
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            รายชื่อสมาชิก ฐานข้อมูลลูกค้าประวัติการสะสมแต้ม และยอดใช้จ่ายสะสม
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <Download className="h-4 w-4 text-slate-500" />
            <span>ส่งออก CSV</span>
          </button>
          <button className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:from-purple-700 hover:to-indigo-700">
            <Plus className="h-4 w-4" />
            <span>เพิ่มสมาชิกใหม่</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="ค้นหาชื่อ, เบอร์โทร, รหัสสมาชิก..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-1.5 text-xs text-slate-900 focus:border-purple-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto">
          {['ALL', 'Bronze', 'Silver', 'Gold', 'Platinum'].map((tier) => (
            <button
              key={tier}
              onClick={() => setSelectedTier(tier)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedTier === tier
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {tier === 'ALL' ? 'ทุกระดับ (Tier)' : tier}
            </button>
          ))}
        </div>
      </div>

      {/* Members Directory Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">สมาชิก</th>
              <th className="px-4 py-3">ระดับ (Tier)</th>
              <th className="px-4 py-3">แต้มสะสม</th>
              <th className="px-4 py-3">ยอดซื้อสะสม</th>
              <th className="px-4 py-3">แท็ก</th>
              <th className="px-4 py-3">ใช้งานล่าสุด</th>
              <th className="px-4 py-3 text-right">การจัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                  <div className="space-y-1">
                    <p className="font-semibold text-slate-600 dark:text-slate-300">ยังไม่มีรายชื่อสมาชิกในระบบ</p>
                    <p className="text-[11px] text-slate-400">เมื่อมีการลงทะเบียนพนักงานหรือลูกค้าทักแชทเข้ามา รายชื่อสมาชิก 360° จะปรากฏที่นี่</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredMembers.map((m) => (
              <tr
                key={m.id}
                onClick={() => setActiveMember(m)}
                className="cursor-pointer hover:bg-purple-50/40 dark:hover:bg-purple-950/20 transition-colors"
              >
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 font-bold text-white text-xs">
                      {m.name.slice(0, 2)}
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{m.name}</div>
                      <div className="text-[10px] text-slate-400">{m.id} · {m.phone}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    {m.tier}
                  </span>
                </td>
                <td className="px-4 py-3.5 font-bold text-amber-600">
                  ⭐ {m.points.toLocaleString()}
                </td>
                <td className="px-4 py-3.5 font-bold text-slate-800 dark:text-white">
                  {m.spent} <span className="text-[10px] text-slate-400 font-normal">({m.orders} ออเดอร์)</span>
                </td>
                <td className="px-4 py-3.5">
                  <div className="flex flex-wrap gap-1">
                    {m.tags.map((t, idx) => (
                      <span key={idx} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3.5 text-slate-500 dark:text-slate-400 text-[11px]">
                  {m.lastActive}
                </td>
                <td className="px-4 py-3.5 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveMember(m)
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-purple-600 hover:bg-purple-50 dark:border-slate-700 dark:bg-slate-800 dark:text-purple-400"
                  >
                    ดู 360°
                  </button>
                </td>
              </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Slide-over Drawer for Member 360 */}
      {activeMember && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm">
          <div className="h-full w-full max-w-md bg-white p-6 shadow-2xl overflow-y-auto dark:bg-slate-900 animate-in slide-in-from-right">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">ข้อมูลลูกค้า 360°</h3>
              <button
                onClick={() => setActiveMember(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="mt-6 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-indigo-600 text-xl font-bold text-white shadow-lg">
                {activeMember.name.slice(0, 2)}
              </div>
              <h4 className="mt-3 text-lg font-bold text-slate-900 dark:text-white">{activeMember.name}</h4>
              <p className="text-xs text-slate-400 font-mono">{activeMember.lineUserId}</p>
              <span className="mt-2 inline-block rounded-full bg-amber-100 px-3 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {activeMember.tier} Member
              </span>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-amber-50 p-3 text-center dark:bg-amber-950/40">
                <div className="text-xs text-amber-700 dark:text-amber-300">แต้มสะสมปัจจุบัน</div>
                <div className="text-xl font-black text-amber-900 dark:text-amber-100">⭐ {activeMember.points.toLocaleString()}</div>
              </div>
              <div className="rounded-xl bg-purple-50 p-3 text-center dark:bg-purple-950/40">
                <div className="text-xs text-purple-700 dark:text-purple-300">ยอดซื้อรวมทั้งหมด</div>
                <div className="text-xl font-black text-purple-900 dark:text-purple-100">{activeMember.spent}</div>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <h5 className="text-xs font-bold text-slate-800 dark:text-white">ข้อมูลการติดต่อ & บัญชี</h5>
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-xs space-y-2 dark:border-slate-800 dark:bg-slate-800/40">
                <div className="flex justify-between"><span className="text-slate-400">เบอร์โทรศัพท์:</span> <span className="font-semibold text-slate-800 dark:text-white">{activeMember.phone}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">สถานะสมาชิก:</span> <span className="font-semibold text-emerald-600">ใช้งานปกติ (Active)</span></div>
                <div className="flex justify-between"><span className="text-slate-400">PDPA Consent:</span> <span className="font-semibold text-emerald-600">ยินยอมแล้ว (Granted)</span></div>
              </div>
            </div>

            <div className="mt-8 flex gap-2">
              <button
                onClick={() => setActiveMember(null)}
                className="flex-1 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 py-2.5 text-xs font-bold text-white shadow-md hover:from-purple-700 hover:to-indigo-700"
              >
                เปิดแชทกับสมาชิกคนนี้
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
