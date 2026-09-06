'use client'

import React, { useState } from 'react'
import {
  ShieldCheck,
  Download,
  Search,
  Filter,
  AlertTriangle,
  Lock,
  Edit,
  UserCheck,
  CheckCircle2,
  XCircle,
  Clock
} from 'lucide-react'
import { AUDIT_LOGS } from './mockData'

// @req SEC-005, FR-022, FR-103 — PDPA / ISO 27001 Audit Log Screen
// @spec SDD-050, BR-001

export default function LineCrmAuditLog() {
  const [logs, setLogs] = useState(AUDIT_LOGS)
  const [search, setSearch] = useState('')
  const [selectedAction, setSelectedAction] = useState('ALL')
  const [selectedUser, setSelectedUser] = useState('ALL')
  const [selectedStatus, setSelectedStatus] = useState('ALL')

  const filteredLogs = logs.filter((log) => {
    const matchSearch = log.details.toLowerCase().includes(search.toLowerCase()) ||
      log.user.toLowerCase().includes(search.toLowerCase()) ||
      log.ip.includes(search)
    const matchAction = selectedAction === 'ALL' || log.action === selectedAction
    const matchUser = selectedUser === 'ALL' || log.user.includes(selectedUser)
    const matchStatus = selectedStatus === 'ALL' || (selectedStatus === 'SUCCESS' ? log.status.includes('สำเร็จ') : log.status.includes('ล้มเหลว'))
    return matchSearch && matchAction && matchUser && matchStatus
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Audit Log
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            บันทึกกิจกรรมทั้งหมดในระบบเพื่อความปลอดภัยและการตรวจสอบย้อนหลัง (PDPA / ISO 27001)
          </p>
        </div>
        <button className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <Download className="h-4 w-4 text-slate-500" />
          <span>ส่งออก CSV</span>
        </button>
      </div>

      {/* Row 1: 4 Stat Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Stat 1 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <ShieldCheck className="h-4 w-4 text-purple-600" />
            <span>เหตุการณ์วันนี้</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            1,842
          </div>
          <div className="mt-1 text-[11px] text-slate-400">บันทึกเรียลไทม์</div>
        </div>

        {/* Stat 2 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Lock className="h-4 w-4 text-blue-500" />
            <span>การเข้าสู่ระบบ</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            248
          </div>
          <div className="mt-1 text-[11px] text-rose-500 font-semibold">ล้มเหลว 3</div>
        </div>

        {/* Stat 3 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Edit className="h-4 w-4 text-amber-500" />
            <span>แก้ไขข้อมูล</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            526
          </div>
          <div className="mt-1 text-[11px] text-slate-400">UPDATE / DELETE</div>
        </div>

        {/* Stat 4 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <AlertTriangle className="h-4 w-4 text-rose-500" />
            <span>เหตุการณ์เสี่ยง</span>
          </div>
          <div className="mt-2 text-2xl font-black text-rose-600">
            3
          </div>
          <div className="mt-1 text-[11px] text-slate-400">ต้องตรวจสอบ</div>
        </div>
      </div>

      {/* Row 2: Filter Bar & Audit Table */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหา log (ผู้ใช้, action, IP)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-purple-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <select
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <option value="ALL">ทุก action</option>
            <option value="UPDATE">UPDATE</option>
            <option value="CREATE">CREATE</option>
            <option value="DELETE">DELETE</option>
            <option value="EXPORT">EXPORT</option>
            <option value="LOGIN">LOGIN</option>
          </select>

          <select
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <option value="ALL">ทุกผู้ใช้</option>
            <option value="Admin">Admin Demo</option>
            <option value="สมหญิง">สมหญิง</option>
            <option value="วิชัย">วิชัย</option>
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <option value="ALL">ทุกสถานะ</option>
            <option value="SUCCESS">สำเร็จ</option>
            <option value="FAIL">ล้มเหลว</option>
          </select>
        </div>

        {/* Audit Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 text-[11px] font-bold text-slate-400 dark:border-slate-800">
              <tr>
                <th className="py-2.5 pr-3">เวลา</th>
                <th className="py-2.5 px-3">ผู้ใช้</th>
                <th className="py-2.5 px-3">Action</th>
                <th className="py-2.5 px-3">รายละเอียด / Object</th>
                <th className="py-2.5 px-3">IP Address</th>
                <th className="py-2.5 pl-3 text-right">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                  <td className="py-3 pr-3 text-slate-500 font-mono text-[11px]">{log.time}</td>
                  <td className="py-3 px-3 font-semibold text-slate-800 dark:text-white">{log.user}</td>
                  <td className="py-3 px-3">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold font-mono ${log.actionColor}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-slate-700 dark:text-slate-300">{log.details}</td>
                  <td className="py-3 px-3 font-mono text-slate-400 text-[11px]">{log.ip}</td>
                  <td className="py-3 pl-3 text-right">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${log.statusColor}`}>
                      {log.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-400 dark:border-slate-800">
          <span>แสดง 1 - {filteredLogs.length} จาก 1,842 รายการ</span>
          <div className="flex gap-1">
            <span className="rounded bg-purple-600 px-2 py-0.5 font-bold text-white">1</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">2</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">3</span>
            <span>...</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">264</span>
          </div>
        </div>
      </div>
    </div>
  )
}
