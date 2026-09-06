'use client'

import React, { useState } from 'react'
import {
  Star,
  Gift,
  ShoppingCart,
  Users,
  Plus,
  Coins,
  ArrowUpRight,
  Settings,
  Tag,
  Shirt,
  Coffee
} from 'lucide-react'
import { LOYALTY_RULES, REWARDS, POINT_TRANSACTIONS } from './mockData'

// @req FR-091 — Loyalty & Points Management Screen
// @spec SDD-050, ADR-060

export default function LineCrmLoyalty() {
  const [rules, setRules] = useState(LOYALTY_RULES)
  const [rewards, setRewards] = useState(REWARDS)
  const [transactions, setTransactions] = useState(POINT_TRANSACTIONS)
  const [showAdjustModal, setShowAdjustModal] = useState(false)
  const [adjustPoints, setAdjustPoints] = useState('')
  const [adjustReason, setAdjustReason] = useState('')

  const toggleRule = (id) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    )
  }

  const handleManualAdjust = (e) => {
    e.preventDefault()
    if (!adjustPoints) return

    const newTx = {
      id: `pt-${Date.now()}`,
      member: 'Admin Demo (ปรับปรุง)',
      tier: 'VIP',
      type: Number(adjustPoints) >= 0 ? 'received' : 'redeemed',
      desc: adjustReason || 'ปรับแต้มด้วยตนเองโดยแอดมิน',
      points: Number(adjustPoints) >= 0 ? `+${adjustPoints}` : `${adjustPoints}`,
      balance: '78,750',
      time: 'เมื่อสักครู่'
    }

    setTransactions([newTx, ...transactions])
    setShowAdjustModal(false)
    setAdjustPoints('')
    setAdjustReason('')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            แต้มสะสม (Loyalty)
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            จัดการแต้ม กฎการให้แต้ม และของรางวัลแลกแต้มของสมาชิก
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <Settings className="h-4 w-4 text-slate-500" />
            <span>ตั้งกฎการให้แต้ม</span>
          </button>
          <button
            onClick={() => setShowAdjustModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:from-purple-700 hover:to-indigo-700"
          >
            <Coins className="h-4 w-4" />
            <span>ปรับแต้มด้วยตนเอง</span>
          </button>
        </div>
      </div>

      {/* Row 1: 4 Stat Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Stat 1 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Star className="h-4 w-4 text-amber-500" />
            <span>แต้มที่แจกทั้งหมด</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            1,284,500
          </div>
          <div className="mt-1 text-[11px] text-slate-400">สะสมตั้งแต่เปิดระบบ</div>
        </div>

        {/* Stat 2 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Gift className="h-4 w-4 text-rose-500" />
            <span>แต้มที่ถูกใช้แลก</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            642,180
          </div>
          <div className="mt-1 text-[11px] text-slate-400">อัตราแลก 50.0%</div>
        </div>

        {/* Stat 3 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Coins className="h-4 w-4 text-amber-500" />
            <span>แต้มคงเหลือรวม</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white">78,650</span>
            <span className="inline-flex items-center text-[11px] font-bold text-emerald-600">
              <ArrowUpRight className="h-3 w-3" /> 6.2%
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">มูลค่า ฿78,650</div>
        </div>

        {/* Stat 4 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Users className="h-4 w-4 text-purple-600" />
            <span>สมาชิกที่มีแต้ม</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            2,102
          </div>
          <div className="mt-1 text-[11px] text-slate-400">85.5% ของสมาชิก</div>
        </div>
      </div>

      {/* Row 2: Point Movement Ledger (Left) + Earning Rules (Right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Transactions Table (8 cols) */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm lg:col-span-8 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">ประวัติการเคลื่อนไหวแต้ม</h3>
              <p className="text-xs text-slate-400">รายการรับแต้มและแลกแต้มของสมาชิกแบบ Real-time</p>
            </div>
            <div className="flex items-center gap-2">
              <select className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <option value="all">ทั้งหมด</option>
                <option value="received">เฉพาะได้รับ</option>
                <option value="redeemed">เฉพาะแลก</option>
              </select>
              <button className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                ส่งออก
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 text-[11px] font-bold text-slate-400 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 pr-2">สมาชิก</th>
                  <th className="py-2.5 px-2">ประเภท</th>
                  <th className="py-2.5 px-2">รายละเอียด</th>
                  <th className="py-2.5 px-2">แต้ม</th>
                  <th className="py-2.5 px-2">คงเหลือ</th>
                  <th className="py-2.5 pl-2 text-right">เวลา</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="py-2.5 pr-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">
                          {tx.member.slice(0, 2)}
                        </div>
                        <span className="font-semibold text-slate-800 dark:text-white">{tx.member}</span>
                        <span className="rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          {tx.tier}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          tx.type === 'received'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                        }`}
                      >
                        {tx.type === 'received' ? 'ได้รับ' : 'แลก'}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-slate-600 dark:text-slate-300">{tx.desc}</td>
                    <td className={`py-2.5 px-2 font-bold ${tx.points.startsWith('+') ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {tx.points}
                    </td>
                    <td className="py-2.5 px-2 font-semibold text-slate-800 dark:text-white">{tx.balance}</td>
                    <td className="py-2.5 pl-2 text-right text-slate-400 text-[11px]">{tx.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Earning Rules Switchboard (4 cols) */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm lg:col-span-4 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">กฎการให้แต้ม</h3>
            <span className="text-[10px] text-slate-400">ระบบอัตโนมัติ</span>
          </div>

          <div className="mt-4 space-y-3">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/40"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-300">
                    <Star className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">{rule.name}</div>
                    <div className="text-[11px] text-slate-400">{rule.desc}</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => toggleRule(rule.id)}
                  className="h-4 w-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                />
              </div>
            ))}

            <button className="w-full rounded-xl border border-dashed border-purple-300 p-2 text-center text-xs font-bold text-purple-600 hover:bg-purple-50 transition-colors dark:border-purple-800 dark:text-purple-400 dark:hover:bg-purple-950/40">
              + เพิ่มกฎใหม่
            </button>
          </div>
        </div>
      </div>

      {/* Row 3: Rewards Catalog */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">ของรางวัลแลกแต้ม</h3>
            <p className="text-xs text-slate-400">ของรางวัลที่สมาชิกสามารถกดแลกผ่าน LINE Official Account / LIFF</p>
          </div>
          <button className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-md hover:from-purple-700 hover:to-indigo-700">
            <Plus className="h-3.5 w-3.5" />
            <span>เพิ่มของรางวัล</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {rewards.map((reward) => (
            <div
              key={reward.id}
              className="group relative flex flex-col justify-between rounded-2xl border border-slate-100 bg-slate-50/60 p-4 shadow-sm transition-all hover:-translate-y-1 hover:border-purple-200 hover:bg-white hover:shadow-md dark:border-slate-800 dark:bg-slate-800/40 dark:hover:bg-slate-800"
            >
              <div className="flex items-center justify-center h-28 rounded-xl bg-white dark:bg-slate-900/80 mb-3 shadow-inner">
                <Gift className="h-10 w-10 text-purple-500 group-hover:scale-110 transition-transform" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-900 dark:text-white">{reward.name}</h4>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs font-black text-amber-600">⭐ {reward.points.toLocaleString()} แต้ม</span>
                  <span className="text-[10px] text-slate-400">แลกแล้ว {reward.redeemed}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Adjust Points Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">ปรับแต้มด้วยตนเอง</h3>
            <p className="text-xs text-slate-400 mt-1">เพิ่มหรือลดแต้มให้สมาชิกเป็นกรณีพิเศษ</p>

            <form onSubmit={handleManualAdjust} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">จำนวนแต้ม (ใส่ลบเพื่อหักแต้ม)</label>
                <input
                  type="number"
                  placeholder="เช่น 100 หรือ -50"
                  value={adjustPoints}
                  onChange={(e) => setAdjustPoints(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-purple-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">เหตุผลในการปรับแต้ม</label>
                <input
                  type="text"
                  placeholder="เช่น ชดเชยระบบล่าช้า, กิจกรรมพิเศษ"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-purple-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-700"
                >
                  ยืนยันการปรับแต้ม
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
