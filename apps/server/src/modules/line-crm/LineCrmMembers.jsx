'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Search, Users } from 'lucide-react'
import { useScope } from '@/context/ScopeContext'
import { useFetch } from '@/modules/project-manager/components/useApi'
import {
  buildCustomerRows,
  buildRegistryRows,
  formatDateTime,
  selectionFor,
} from './lineCrmViewModels'

// @req FR-091, FR-078, FR-080, FR-103 — CRM Member 360 Directory and detail drawer.
// @spec SDD-050, BR-001
// @tested tests/unit/line-crm-members-render.test.js

function SourceMessage({ loading, error, data, emptyText }) {
  if (error) {
    return <p role="alert" className="px-4 py-8 text-center text-xs text-rose-700">ไม่สามารถโหลดข้อมูลได้: {error}</p>
  }
  if (loading || data == null) {
    return <p role="status" className="px-4 py-8 text-center text-xs text-slate-500">กำลังโหลดข้อมูล…</p>
  }
  return <p className="px-4 py-8 text-center text-xs text-slate-500">{emptyText}</p>
}

function CustomerTable({ members, onSelect }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-xs">
        <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3">ลูกค้า</th>
            <th className="px-4 py-3">ช่วงวงจรลูกค้า</th>
            <th className="px-4 py-3">Consent</th>
            <th className="px-4 py-3">ช่องทาง</th>
            <th className="px-4 py-3">บทสนทนา</th>
            <th className="px-4 py-3">ข้อความล่าสุด</th>
            <th className="px-4 py-3 text-right">รายละเอียด</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {members.map((member) => (
            <tr key={member.id} className="hover:bg-purple-50/40 dark:hover:bg-purple-950/20">
              <td className="px-4 py-3.5">
                <div className="font-bold text-slate-900 dark:text-white">{member.displayName}</div>
                <div className="text-[10px] text-slate-400">{member.code || 'ไม่ทราบรหัส'}</div>
              </td>
              <td className="px-4 py-3.5">{member.lifecycleStage}</td>
              <td className="px-4 py-3.5">
                <div>{member.consentLabel}</div>
                {member.consentRecordedAt && <time className="text-[10px] text-slate-400">{formatDateTime(member.consentRecordedAt)}</time>}
              </td>
              <td className="px-4 py-3.5">{member.channels.length ? member.channels.join(' · ') : 'ไม่ทราบ'}</td>
              <td className="px-4 py-3.5">{member.conversationCount}</td>
              <td className="px-4 py-3.5">{formatDateTime(member.lastMessageAt)}</td>
              <td className="px-4 py-3.5 text-right">
                <button type="button" onClick={() => onSelect(member)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-purple-700 hover:bg-purple-50 dark:border-slate-700 dark:bg-slate-800 dark:text-purple-300">
                  ดูข้อมูล
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RegistryTable({ members, onSelect }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-xs">
        <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3">ชื่อ</th>
            <th className="px-4 py-3">LINE user ID</th>
            <th className="px-4 py-3">โทรศัพท์</th>
            <th className="px-4 py-3">สถานะการลงทะเบียน</th>
            <th className="px-4 py-3">บทบาท / แผนก</th>
            <th className="px-4 py-3">เวลาลงทะเบียน</th>
            <th className="px-4 py-3">Consent</th>
            <th className="px-4 py-3 text-right">รายละเอียด</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {members.map((member, index) => (
            <tr key={member.id || member.externalAccountId || index} className="hover:bg-purple-50/40 dark:hover:bg-purple-950/20">
              <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-white">{member.name}</td>
              <td className="px-4 py-3.5 font-mono">{member.externalAccountId || 'ไม่ทราบ'}</td>
              <td className="px-4 py-3.5">{member.phone || 'ไม่มีข้อมูล'}</td>
              <td className="px-4 py-3.5">{member.status || 'ไม่ทราบ'}</td>
              <td className="px-4 py-3.5">
                {[member.role && 'บทบาท: ' + member.role, member.department && 'แผนก: ' + member.department].filter(Boolean).join(' · ') || '—'}
              </td>
              <td className="px-4 py-3.5">{formatDateTime(member.createdAt)}</td>
              <td className="px-4 py-3.5">{member.consentLabel}</td>
              <td className="px-4 py-3.5 text-right">
                <button type="button" onClick={() => onSelect(member)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-purple-700 hover:bg-purple-50 dark:border-slate-700 dark:bg-slate-800 dark:text-purple-300">
                  ดูข้อมูล
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MemberDetail({ member, onClose, onOpenInbox }) {
  if (!member) return null
  const isCustomer = member.kind === 'customer'
  const name = isCustomer ? member.displayName : member.name

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm" role="presentation">
      <section role="dialog" aria-modal="true" aria-label="รายละเอียดข้อมูล" className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">รายละเอียดข้อมูล</h2>
          <button type="button" aria-label="ปิด" onClick={onClose} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">ปิด</button>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-600 text-base font-bold text-white">{(name || 'ไม่ระบุชื่อ').slice(0, 2)}</div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{name}</h3>
            {isCustomer
              ? <p className="text-xs font-mono text-slate-500">{member.code || 'ไม่ทราบรหัส'}</p>
              : <p className="text-xs font-mono text-slate-500">{member.externalAccountId || 'ไม่ทราบ'}</p>}
          </div>
        </div>

        <div className="mt-6 space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
          {isCustomer ? (
            <>
              <div className="flex justify-between gap-3"><span className="text-slate-500">ช่วงวงจรลูกค้า</span><span>{member.lifecycleStage}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">ช่องทาง</span><span>{member.channels.length ? member.channels.join(' · ') : 'ไม่ทราบ'}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">จำนวนบทสนทนา</span><span>{member.conversationCount}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">ข้อความล่าสุด</span><span>{formatDateTime(member.lastMessageAt)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">สถานะ consent</span><span>{member.consentLabel}</span></div>
              {member.consentRecordedAt && <div className="flex justify-between gap-3"><span className="text-slate-500">บันทึก consent เมื่อ</span><time>{formatDateTime(member.consentRecordedAt)}</time></div>}
            </>
          ) : (
            <>
              <div className="flex justify-between gap-3"><span className="text-slate-500">สถานะการลงทะเบียน</span><span>{member.status || 'ไม่ทราบ'}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">โทรศัพท์</span><span>{member.phone || 'ไม่มีข้อมูล'}</span></div>
              {member.role && <div className="flex justify-between gap-3"><span className="text-slate-500">บทบาท</span><span>{member.role}</span></div>}
              {member.department && <div className="flex justify-between gap-3"><span className="text-slate-500">แผนก</span><span>{member.department}</span></div>}
              <div className="flex justify-between gap-3"><span className="text-slate-500">เวลาลงทะเบียน</span><time>{formatDateTime(member.createdAt)}</time></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">สถานะ consent</span><span>{member.consentLabel}</span></div>
            </>
          )}
        </div>

        <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/20">
          <h4 className="font-bold text-slate-800 dark:text-white">ข้อมูลสะสม</h4>
          <div className="mt-2 space-y-2">
            <div className="flex justify-between"><span>แต้มสะสม</span><span>ไม่มีข้อมูล</span></div>
            <div className="flex justify-between"><span>ระดับสมาชิก</span><span>ไม่มีข้อมูล</span></div>
            <div className="flex justify-between"><span>ยอดซื้อสะสม</span><span>ไม่มีข้อมูล</span></div>
          </div>
        </section>

        <div className="mt-8">
          {isCustomer && typeof onOpenInbox === 'function' ? (
            <button type="button" onClick={onOpenInbox} className="w-full rounded-xl bg-purple-600 py-2.5 text-xs font-bold text-white hover:bg-purple-700">ไปที่กล่องข้อความ</button>
          ) : (
            <button type="button" onClick={onClose} className="w-full rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">ปิด</button>
          )}
        </div>
      </section>
    </div>
  )
}

export default function LineCrmMembers({ onNavigate }) {
  const { shell } = useScope()
  const businessId = shell.activeBusinessId
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState(null)

  useEffect(() => {
    setSelection(null)
  }, [businessId])

  const conversationsPath = businessId
    ? '/api/crm/conversations?businessId=' + encodeURIComponent(businessId)
    : null
  const registryPath = businessId
    ? '/api/platform/integrations/line-registry?businessId=' + encodeURIComponent(businessId)
    : null
  const liveInbox = useFetch(conversationsPath, [businessId])
  const integrations = useFetch(registryPath, [businessId])

  const conversationsPathMatches = !conversationsPath || !liveInbox.requestKey || liveInbox.requestKey === conversationsPath
  const registryPathMatches = !registryPath || !integrations.requestKey || integrations.requestKey === registryPath
  const conversationsData = conversationsPathMatches ? liveInbox.data : null
  const registryData = registryPathMatches ? integrations.data : null
  const conversationsError = conversationsPathMatches ? liveInbox.error : null
  const registryError = registryPathMatches ? integrations.error : null
  const conversationsLoading = !conversationsPathMatches || liveInbox.loading
  const registryLoading = !registryPathMatches || integrations.loading
  const conversationsLoaded = Boolean(businessId && conversationsData != null && !conversationsLoading && !conversationsError)
  const registryLoaded = Boolean(businessId && registryData != null && !registryLoading && !registryError)

  const customerRows = useMemo(() => buildCustomerRows(conversationsData?.conversations), [conversationsData])
  const registryRows = useMemo(() => buildRegistryRows(registryData), [registryData])
  const searchText = search.trim().toLocaleLowerCase()
  const matchesSearch = (values) => !searchText || values.some((value) => String(value || '').toLocaleLowerCase().includes(searchText))
  const filteredCustomers = customerRows.filter((member) => matchesSearch([member.displayName, member.code]))
  const filteredRegistry = registryRows.filter((member) => matchesSearch([member.name, member.externalAccountId, member.phone]))
  const selectedMember = selectionFor(businessId, selection)
  const sourceCaption = conversationsData?.truncated
    ? 'รายการนี้มาจากบทสนทนาในกล่องข้อความ โดยอ่านเฉพาะ ' + conversationsData.limit + ' รายการล่าสุด'
    : 'รายการนี้มาจากลูกค้าที่มีบทสนทนาในกล่องข้อความนี้'

  function selectMember(member) {
    setSelection({ businessId, member })
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">ข้อมูลลูกค้าและผู้ใช้ LINE</h1>
            {conversationsLoaded && <span className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600">ลูกค้า CRM {customerRows.length}</span>}
            {registryLoaded && <span className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600">ผู้ใช้ LINE {registryRows.length}</span>}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">รายชื่อจาก CRM และ Integration ที่บันทึกไว้ แสดงแยกตามแหล่งข้อมูล</p>
        </div>
      </header>

      <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
        ยังไม่มีระบบสะสมแต้ม จึงไม่มีข้อมูลแต้มสะสม ระดับสมาชิก และยอดซื้อสะสม
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          type="search"
          placeholder="ค้นหาชื่อ รหัสลูกค้า LINE user ID หรือโทรศัพท์"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-purple-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
      </div>

      {!businessId ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          <Users className="mx-auto mb-2 h-6 w-6 text-slate-400" />
          เลือก Business เพื่อดูข้อมูลลูกค้าและผู้ใช้ LINE
        </div>
      ) : (
        <>
          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-labelledby="crm-customers-heading">
            <div className="border-b border-slate-100 px-4 py-4 dark:border-slate-800">
              <h2 id="crm-customers-heading" className="text-sm font-bold text-slate-900 dark:text-white">ลูกค้า CRM</h2>
              <p className="mt-1 text-[11px] text-slate-500">{sourceCaption}</p>
            </div>
            {conversationsError || conversationsLoading || conversationsData == null ? (
              <SourceMessage loading={conversationsLoading} error={conversationsError} data={conversationsData} emptyText="ยังไม่มีลูกค้า CRM ในกล่องข้อความ" />
            ) : customerRows.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">ยังไม่มีลูกค้า CRM ในกล่องข้อความ</p>
            ) : filteredCustomers.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">ไม่พบลูกค้า CRM ที่ตรงกับการค้นหา</p>
            ) : (
              <CustomerTable members={filteredCustomers} onSelect={selectMember} />
            )}
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-labelledby="line-registrations-heading">
            <div className="border-b border-slate-100 px-4 py-4 dark:border-slate-800">
              <h2 id="line-registrations-heading" className="text-sm font-bold text-slate-900 dark:text-white">ผู้ใช้ LINE ที่ลงทะเบียน (Integration)</h2>
              <p className="mt-1 text-[11px] text-slate-500">รายการลงทะเบียน LINE จาก Integration แสดงแยกจากรายการลูกค้า CRM</p>
            </div>
            {registryError || registryLoading || registryData == null ? (
              <SourceMessage loading={registryLoading} error={registryError} data={registryData} emptyText="ยังไม่มีผู้ใช้ LINE ที่ลงทะเบียน" />
            ) : registryRows.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">ยังไม่มีผู้ใช้ LINE ที่ลงทะเบียน</p>
            ) : filteredRegistry.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">ไม่พบผู้ใช้ LINE ที่ตรงกับการค้นหา</p>
            ) : (
              <RegistryTable members={filteredRegistry} onSelect={selectMember} />
            )}
          </section>
        </>
      )}

      {selectedMember && (
        <MemberDetail
          member={selectedMember}
          onClose={() => setSelection(null)}
          onOpenInbox={selectedMember.kind === 'customer' && typeof onNavigate === 'function'
            ? () => { onNavigate('chat'); setSelection(null) }
            : undefined}
        />
      )}
    </div>
  )
}
