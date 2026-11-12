'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Search } from 'lucide-react'
import { useScope } from '@/context/ScopeContext'
import { api, useFetch } from '@/modules/project-manager/components/useApi'
import {
  createFollowUpTask,
  followUpTaskNotice,
  formatDateTime,
  getConsentLabel,
  loadRecordedAnalysis,
} from './lineCrmViewModels'

// @req FR-091, FR-093, FR-127, FR-161 — Live CRM renders recorded conversations, analysis and follow-up actions.
// @spec SDD-050, ADR-060, ADR-061
// @tested tests/unit/line-crm-live-chat-render.test.js

function UnavailableButton({ label }) {
  return (
    <button type="button" disabled className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2 text-left text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
      <span>{label}</span>
      <span className="shrink-0 text-[10px] font-normal text-slate-500">ยังไม่พร้อมใช้งาน</span>
    </button>
  )
}

function recordedText(value, unknown = 'ไม่ทราบ') {
  return typeof value === 'string' && value.trim() ? value : unknown
}

export default function LineCrmLiveChat() {
  const { shell } = useScope()
  const businessId = shell.activeBusinessId
  const [selectedChatId, setSelectedChatId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [taskForm, setTaskForm] = useState({ key: null, open: false, title: '', dueDate: '', pending: false })
  const [taskNotice, setTaskNotice] = useState(null)
  const [analysisState, setAnalysisState] = useState({ key: null, state: 'IDLE' })
  const currentConversationKey = useRef(null)

  const inboxPath = businessId
    ? '/api/crm/conversations?businessId=' + encodeURIComponent(businessId)
    : null
  const liveInbox = useFetch(inboxPath, [businessId])
  const inboxPathMatches = !inboxPath || !liveInbox.requestKey || liveInbox.requestKey === inboxPath
  const inboxData = inboxPathMatches ? liveInbox.data : null
  const inboxError = inboxPathMatches ? liveInbox.error : null
  const inboxLoading = Boolean(businessId && (!inboxPathMatches || liveInbox.loading))
  const inboxLoaded = Boolean(businessId && inboxData != null && !inboxLoading && !inboxError)
  const rawConversations = useMemo(
    () => inboxLoaded && Array.isArray(inboxData?.conversations) ? inboxData.conversations : [],
    [inboxData, inboxLoaded],
  )

  const selectedConversationId = rawConversations.some((conversation) => conversation.id === selectedChatId)
    ? selectedChatId
    : rawConversations[0]?.id || null
  const activeConversation = rawConversations.find((conversation) => conversation.id === selectedConversationId) || null
  const conversationKey = businessId && selectedConversationId
    ? businessId + ':' + selectedConversationId
    : null
  currentConversationKey.current = conversationKey

  const threadPath = activeConversation
    ? '/api/crm/conversations/' + encodeURIComponent(activeConversation.id) + '?businessId=' + encodeURIComponent(businessId)
    : null
  const liveThread = useFetch(threadPath, [selectedConversationId, businessId])
  const threadPathMatches = !threadPath || !liveThread.requestKey || liveThread.requestKey === threadPath
  const threadError = threadPathMatches ? liveThread.error : null
  const threadData = threadPathMatches && liveThread.data?.conversation?.id === selectedConversationId
    ? liveThread.data
    : null
  const threadLoading = Boolean(threadPath && (!threadPathMatches || liveThread.loading || (!threadData && !threadError)))
  const threadLoaded = Boolean(threadData && !threadLoading && !threadError)

  useEffect(() => {
    setTaskForm({ key: conversationKey, open: false, title: '', dueDate: '', pending: false })
    setTaskNotice(null)
    setAnalysisState({ key: conversationKey, state: 'IDLE' })
  }, [businessId, conversationKey])

  const searchText = searchQuery.trim().toLocaleLowerCase()
  const filteredConversations = rawConversations.filter((conversation) => {
    const customer = conversation.customer || {}
    const values = [
      customer.displayName,
      customer.code,
      conversation.lastMessage?.preview,
    ]
    return !searchText || values.some((value) => String(value || '').toLocaleLowerCase().includes(searchText))
  })

  const activeName = recordedText(activeConversation?.customer?.displayName, 'ไม่ระบุชื่อ')
  const visibleTaskForm = taskForm.key === conversationKey
    ? taskForm
    : { key: conversationKey, open: false, title: '', dueDate: '', pending: false }
  const visibleTaskNotice = taskNotice?.key === conversationKey ? taskNotice : null
  const visibleAnalysis = analysisState.key === conversationKey ? analysisState : { key: conversationKey, state: 'IDLE' }

  function openFollowUpForm() {
    if (!activeConversation) return
    setTaskNotice(null)
    setTaskForm({
      key: conversationKey,
      open: true,
      title: 'ติดตามลูกค้า ' + activeName,
      dueDate: '',
      pending: false,
    })
  }

  async function submitFollowUpTask(event) {
    event.preventDefault()
    if (!activeConversation || visibleTaskForm.pending) return
    const requestKey = conversationKey
    setTaskForm((current) => current.key === requestKey ? { ...current, pending: true } : current)
    const result = await createFollowUpTask({
      request: api,
      businessId,
      conversationId: activeConversation.id,
      title: visibleTaskForm.title,
      dueDate: visibleTaskForm.dueDate,
    })
    if (currentConversationKey.current !== requestKey) return

    const notice = followUpTaskNotice(result)
    setTaskNotice({ key: requestKey, ...notice })
    setTaskForm((current) => current.key === requestKey
      ? { ...current, pending: false, open: !result.ok }
      : current)
  }

  async function viewRecordedAnalysis() {
    if (!activeConversation) return
    const requestKey = conversationKey
    if (activeConversation.customer?.consentStatus === 'GRANTED') {
      setAnalysisState({ key: requestKey, state: 'LOADING' })
    }
    const result = await loadRecordedAnalysis({
      request: api,
      businessId,
      conversationId: activeConversation.id,
      consentStatus: activeConversation.customer?.consentStatus,
    })
    if (currentConversationKey.current === requestKey) {
      setAnalysisState({ key: requestKey, ...result })
    }
  }

  const analysis = visibleAnalysis.analysis
  const messages = threadLoaded && Array.isArray(threadData.messages) ? threadData.messages : []

  return (
    <div className="flex h-[calc(100vh-140px)] min-h-[640px] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-lg backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 lg:flex-row">
      <aside className="flex w-full flex-col border-b border-slate-200 dark:border-slate-800 lg:w-80 lg:border-b-0 lg:border-r">
        <div className="border-b border-slate-100 p-3.5 dark:border-slate-800">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800 dark:text-white">
                {inboxLoaded ? 'กล่องข้อความ (' + rawConversations.length + ')' : 'กล่องข้อความ'}
              </span>
              {inboxLoaded && <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Live DB</span>}
            </div>
            {businessId && <button type="button" onClick={() => liveInbox.reload?.()} className="text-[10px] font-semibold text-purple-600 hover:underline">รีเฟรช</button>}
          </div>
          {inboxLoaded && inboxData?.truncated && (
            <p className="mb-2 text-[10px] text-slate-500">{Number.isFinite(inboxData.limit) ? `อ่านเฉพาะ ${inboxData.limit} บทสนทนาล่าสุด` : 'อ่านเฉพาะบทสนทนาล่าสุด'}</p>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="search"
              placeholder="ค้นหาชื่อ รหัสลูกค้า หรือข้อความ"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-1.5 pl-9 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-purple-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </div>

        <div className="flex flex-1 flex-col divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
          {!businessId ? (
            <p className="my-auto p-6 text-center text-xs text-slate-500">เลือก Business เพื่อดูบทสนทนา</p>
          ) : inboxLoading ? (
            <p role="status" className="my-auto p-6 text-center text-xs text-slate-500">กำลังโหลดบทสนทนา…</p>
          ) : inboxError ? (
            <p role="alert" className="my-auto p-6 text-center text-xs text-rose-700">ไม่สามารถโหลดกล่องข้อความได้: {inboxError}</p>
          ) : !inboxLoaded ? (
            <p role="status" className="my-auto p-6 text-center text-xs text-slate-500">ยังไม่มีข้อมูลกล่องข้อความที่อ่านได้</p>
          ) : rawConversations.length === 0 ? (
            <div className="my-auto space-y-3 p-6 text-center">
              <MessageSquare className="mx-auto h-8 w-8 text-slate-300" />
              <h2 className="text-xs font-bold text-slate-700 dark:text-slate-200">ยังไม่มีข้อความแชทในฐานข้อมูล</h2>
              <p className="text-[11px] leading-relaxed text-slate-400">รายการห้องแชทจะแสดงเมื่อตรวจพบข้อมูลบทสนทนาในฐานข้อมูล</p>
            </div>
          ) : filteredConversations.length === 0 ? (
            <p className="my-auto p-6 text-center text-xs text-slate-500">ไม่พบบทสนทนาที่ตรงกับการค้นหา</p>
          ) : (
            filteredConversations.map((conversation) => {
              const customer = conversation.customer || {}
              const name = recordedText(customer.displayName, 'ไม่ระบุชื่อ')
              const initials = name.slice(0, 2).toUpperCase()
              const unreadCount = Number.isFinite(conversation.unreadCount) ? conversation.unreadCount : 0
              return (
                <button
                  type="button"
                  key={conversation.id}
                  onClick={() => setSelectedChatId(conversation.id)}
                  className={'flex items-start gap-3 p-3 text-left transition-colors ' + (selectedConversationId === conversation.id
                    ? 'border-l-4 border-purple-600 bg-purple-50/80 dark:bg-purple-950/40'
                    : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40')}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">{initials}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-bold text-slate-800 dark:text-white">{name}</span>
                      <time className="shrink-0 text-[10px] text-slate-400">{formatDateTime(conversation.lastMessage?.createdAt)}</time>
                    </span>
                    <span className="mt-1 block truncate text-[10px] text-slate-500">{recordedText(customer.code, 'ไม่ทราบรหัส')} · {recordedText(conversation.channel)}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500 dark:text-slate-400">{recordedText(conversation.lastMessage?.preview, 'ไม่มีข้อความล่าสุด')}</span>
                  </span>
                  {unreadCount > 0 && <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-purple-600 px-1 text-[9px] font-bold text-white">{unreadCount}</span>}
                </button>
              )
            })
          )}
        </div>
      </aside>

      {!activeConversation ? (
        <section className="flex flex-1 flex-col items-center justify-center space-y-3 bg-slate-50/40 p-8 text-center dark:bg-slate-900/40">
          <MessageSquare className="h-8 w-8 text-purple-500" />
          <h2 className="text-sm font-bold text-slate-800 dark:text-white">ยังไม่ได้เลือกห้องแชท</h2>
        </section>
      ) : (
        <>
          <section className="flex min-w-0 flex-1 flex-col bg-slate-50/40 dark:bg-slate-900/40">
            <header className="flex items-center gap-3 border-b border-slate-200 bg-white/90 p-3.5 px-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">{activeName.slice(0, 2).toUpperCase()}</div>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-bold text-slate-900 dark:text-white">{activeName}</h2>
                <p className="truncate text-[10px] font-mono text-slate-400">{recordedText(activeConversation.customer?.code, 'ไม่ทราบรหัส')}</p>
              </div>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {threadError ? (
                <p role="alert" className="text-center text-xs text-rose-700">ไม่สามารถโหลดข้อความได้: {threadError}</p>
              ) : threadLoading ? (
                <p role="status" className="text-center text-xs text-slate-500">กำลังโหลดข้อความ…</p>
              ) : !threadLoaded ? (
                <p role="status" className="text-center text-xs text-slate-500">ยังไม่มีข้อมูลบทสนทนาที่อ่านได้</p>
              ) : messages.length === 0 ? (
                <p className="text-center text-xs text-slate-500">ห้องนี้ยังไม่มีข้อความ</p>
              ) : (
                messages.map((message) => {
                  const isInbound = message.direction === 'INBOUND'
                  return (
                    <div key={message.id} className={'flex flex-col ' + (isInbound ? 'items-start' : 'items-end')}>
                      <div className={'max-w-md rounded-2xl border p-3.5 text-xs leading-relaxed shadow-sm ' + (isInbound
                        ? 'rounded-tl-sm border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-white'
                        : 'rounded-tr-sm border-purple-700 bg-purple-600 text-white')}>
                        <p className="whitespace-pre-line">{message.body == null ? 'เนื้อหาข้อความไม่พร้อมใช้งาน' : message.body}</p>
                      </div>
                      <time className="mt-1 text-[10px] text-slate-400">{formatDateTime(message.createdAt)}</time>
                    </div>
                  )
                })
              )}
            </div>

            <div className="border-t border-slate-200 bg-white p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              หน้านี้ยังส่งข้อความไม่ได้ ไปที่กล่องข้อความหลักเพื่อดูและตอบข้อความ: <a className="font-semibold text-purple-700 underline dark:text-purple-300" href="/customer/conversations">กล่องข้อความหลัก</a>
            </div>
          </section>

          <aside className="flex w-full flex-col overflow-y-auto border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:w-80 lg:border-l lg:border-t-0">
            <section className="border-b border-slate-100 p-4 dark:border-slate-800">
              <h2 className="text-xs font-bold text-slate-800 dark:text-white">ข้อมูลลูกค้า</h2>
              <div className="mt-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{activeName}</h3>
                <p className="font-mono text-[10px] text-slate-400">{recordedText(activeConversation.customer?.code, 'ไม่ทราบรหัส')}</p>
              </div>
              <dl className="mt-4 space-y-2 text-[11px]">
                <div className="flex justify-between gap-3"><dt className="text-slate-500">ช่วงวงจรลูกค้า</dt><dd>{recordedText(activeConversation.customer?.lifecycleStage)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">สถานะ consent</dt><dd>{getConsentLabel(activeConversation.customer?.consentStatus)}</dd></div>
                {activeConversation.customer?.consentRecordedAt && <div className="flex justify-between gap-3"><dt className="text-slate-500">บันทึก consent เมื่อ</dt><dd>{formatDateTime(activeConversation.customer.consentRecordedAt)}</dd></div>}
                <div className="flex justify-between gap-3"><dt className="text-slate-500">ช่องทาง</dt><dd>{recordedText(activeConversation.channel)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">สถานะบทสนทนา</dt><dd>{recordedText(activeConversation.status)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">ข้อความยังไม่อ่าน</dt><dd>{Number.isFinite(activeConversation.unreadCount) ? activeConversation.unreadCount : 'ไม่ทราบ'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">ข้อความล่าสุด</dt><dd className="max-w-[60%] text-right">{recordedText(activeConversation.lastMessage?.preview, 'ไม่มีข้อความล่าสุด')}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">เวลาข้อความล่าสุด</dt><dd>{formatDateTime(activeConversation.lastMessage?.createdAt)}</dd></div>
              </dl>
            </section>

            <section className="border-b border-slate-100 p-4 dark:border-slate-800">
              <h2 className="text-xs font-bold text-slate-800 dark:text-white">ข้อมูลสะสม</h2>
              <p className="mt-2 rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                ไม่มีข้อมูลแต้มสะสม มูลค่าแต้ม ยอดใช้จ่ายรวม หรือจำนวนรายการ เพราะยังไม่มีระบบสะสมแต้ม
              </p>
            </section>

            <section className="p-4">
              <h2 className="text-xs font-bold text-slate-800 dark:text-white">เครื่องมือสำหรับบทสนทนา</h2>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <button type="button" onClick={viewRecordedAnalysis} className="rounded-xl border border-purple-200 bg-white p-2 text-left text-xs font-semibold text-purple-900 hover:bg-purple-50 dark:border-purple-800 dark:bg-slate-800 dark:text-purple-200">📄 ดูสรุปที่บันทึกไว้</button>
                <UnavailableButton label="💡 แนะนำคำตอบ" />
                <UnavailableButton label="🏷️ เพิ่มแท็ก" />
                <button type="button" onClick={openFollowUpForm} className="rounded-xl border border-purple-200 bg-white p-2 text-left text-xs font-semibold text-purple-900 hover:bg-purple-50 dark:border-purple-800 dark:bg-slate-800 dark:text-purple-200">⏰ สร้างงานติดตาม</button>
                <UnavailableButton label="⭐ เพิ่มแต้ม" />
                <UnavailableButton label="👤 ดูโปรไฟล์เต็ม" />
              </div>

              {visibleAnalysis.state === 'LOADING' && <p role="status" className="mt-3 text-[11px] text-slate-500">กำลังโหลดผลวิเคราะห์ที่บันทึกไว้…</p>}
              {visibleAnalysis.state === 'CONSENT_BLOCKED' && <p role="status" className="mt-3 text-[11px] text-slate-600">ไม่สามารถแสดงผลวิเคราะห์ได้ในสถานะ consent ปัจจุบัน</p>}
              {visibleAnalysis.state === 'EMPTY' && <p className="mt-3 text-[11px] text-slate-600">ยังไม่มีผลวิเคราะห์สำหรับบทสนทนานี้</p>}
              {visibleAnalysis.state === 'ERROR' && <p role="alert" className="mt-3 text-[11px] text-rose-700">ไม่สามารถโหลดผลวิเคราะห์ที่บันทึกไว้ได้: {visibleAnalysis.error}</p>}
              {visibleAnalysis.state === 'READY' && analysis && (
                <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <p className="text-[10px] text-slate-500">ข้อมูลสรุปเพื่อช่วยประกอบการพิจารณา ไม่ใช่ข้อเท็จจริงที่ยืนยันแล้ว</p>
                  <time className="mt-1 block text-[10px] text-slate-400">{formatDateTime(analysis.analyzedAt)}</time>
                  <p className="mt-2 whitespace-pre-wrap text-xs">{analysis.summary}</p>
                </div>
              )}

              {visibleTaskForm.open && (
                <form onSubmit={submitFollowUpTask} className="mt-3 space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                    หัวข้องาน
                    <input
                      type="text"
                      required
                      value={visibleTaskForm.title}
                      onChange={(event) => setTaskForm((current) => current.key === conversationKey ? { ...current, title: event.target.value } : current)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                  </label>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                    วันที่ติดตาม
                    <input
                      type="date"
                      required
                      value={visibleTaskForm.dueDate}
                      onChange={(event) => setTaskForm((current) => current.key === conversationKey ? { ...current, dueDate: event.target.value } : current)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button type="submit" disabled={visibleTaskForm.pending} className="rounded-lg bg-purple-600 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-60">
                      {visibleTaskForm.pending ? 'กำลังบันทึก…' : 'บันทึกงานติดตาม'}
                    </button>
                    <button type="button" disabled={visibleTaskForm.pending} onClick={() => setTaskForm({ key: conversationKey, open: false, title: '', dueDate: '', pending: false })} className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] dark:border-slate-700">ยกเลิก</button>
                  </div>
                </form>
              )}
              {visibleTaskNotice && <p role={visibleTaskNotice.type === 'error' ? 'alert' : 'status'} className={'mt-3 text-[11px] ' + (visibleTaskNotice.type === 'error' ? 'text-rose-700' : 'text-emerald-700')}>{visibleTaskNotice.text}</p>}
            </section>
          </aside>
        </>
      )}
    </div>
  )
}
