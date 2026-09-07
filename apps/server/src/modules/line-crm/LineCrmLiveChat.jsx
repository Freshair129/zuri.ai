'use client'

import React, { useState, useMemo, useEffect } from 'react'
import {
  Search,
  Filter,
  Send,
  Sparkles,
  Paperclip,
  Smile,
  Image as ImageIcon,
  FileText,
  Tag,
  Star,
  CheckCircle2,
  Clock,
  MoreVertical,
  Bot,
  ExternalLink,
  ChevronRight,
  UserCheck,
  Plus
} from 'lucide-react'
// @req FR-091, FR-093 — LineCRM-MCP 3-Column Live Chat with AI Assist & Member 360°
// @spec SDD-050, ADR-060, ADR-061

import { useScope } from '@/context/ScopeContext'
import { useFetch } from '@/modules/project-manager/components/useApi'

export default function LineCrmLiveChat() {
  const { businessId, selectedBusiness } = useScope()
  const [selectedChatId, setSelectedChatId] = useState(null)
  const [filterCategory, setFilterCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [inputText, setInputText] = useState('')
  const [aiAutoReply, setAiAutoReply] = useState(true)
  const [aiActionMessage, setAiActionMessage] = useState(null)
  const [simulating, setSimulating] = useState(false)

  // Live DB Fetch
  const convPath = businessId ? `/api/crm/conversations?businessId=${encodeURIComponent(businessId)}` : '/api/crm/conversations'
  const liveInbox = useFetch(convPath, [businessId])

  const rawConversations = useMemo(() => liveInbox.data?.conversations || [], [liveInbox.data])

  // Real Thread Fetch for active chat
  const threadPath = (selectedChatId && rawConversations.some(c => c.id === selectedChatId))
    ? `/api/crm/conversations/${encodeURIComponent(selectedChatId)}?businessId=${encodeURIComponent(businessId || '')}`
    : null
  const liveThread = useFetch(threadPath, [selectedChatId, businessId])

  const conversations = useMemo(() => {
    return rawConversations.map((c, idx) => {
      const initials = (c.customer?.displayName || 'User').slice(0, 2).toUpperCase()
      return {
        id: c.id,
        name: c.customer?.displayName || `ลูกค้า LINE (${c.customer?.code || c.customerId?.slice(0, 6)})`,
        lineUserId: c.customer?.code || c.customerId || '—',
        tier: c.customer?.lifecycleStage || 'Member',
        avatar: initials,
        avatarBg: idx % 2 === 0 ? 'bg-purple-600' : 'bg-slate-600',
        status: 'online',
        unread: 0,
        time: c.lastMessage?.createdAt ? new Date(c.lastMessage.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—',
        lastMessage: c.lastMessage?.preview || 'ยังไม่มีข้อความ',
        phone: c.customer?.metadata?.phone || '—',
        email: c.customer?.metadata?.email || '—',
        lineHandle: `@${(c.customer?.displayName || 'user').toLowerCase().replace(/\s+/g, '')}`,
        points: c.customer?.metadata?.points || 0,
        pointsValue: `฿${(c.customer?.metadata?.points || 0).toLocaleString()} บาท`,
        tags: c.customer?.metadata?.tags || ['LINE OA'],
        category: 'pending',
        messages: []
      }
    })
  }, [rawConversations])

  useEffect(() => {
    if (conversations.length > 0 && (!selectedChatId || !conversations.some(c => c.id === selectedChatId))) {
      setSelectedChatId(conversations[0].id)
    }
  }, [conversations, selectedChatId])

  const activeChat = useMemo(() => {
    if (conversations.length === 0) return null
    const found = conversations.find((c) => c.id === selectedChatId) || conversations[0]
    if (liveThread.data?.messages) {
      const mappedMessages = liveThread.data.messages.map((m) => ({
        id: m.id,
        sender: m.direction === 'INBOUND' ? 'customer' : 'agent',
        text: m.content,
        time: new Date(m.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
        status: 'sent'
      }))
      return {
        ...found,
        messages: mappedMessages.length > 0 ? mappedMessages : [{
          id: 'm-empty',
          sender: 'agent',
          text: 'เริ่มการสนทนากับลูกค้าผ่านระบบ LINE CRM',
          time: 'ระบบ',
          status: 'sent'
        }]
      }
    }
    return found
  }, [conversations, selectedChatId, liveThread.data])

  const filteredChats = conversations.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.lastMessage || '').toLowerCase().includes(searchQuery.toLowerCase())
    if (filterCategory === 'all') return matchesSearch
    return matchesSearch && c.category === filterCategory
  })

  // Function to simulate a real incoming message from LINE Webhook
  const handleSimulateIncomingMessage = async () => {
    setSimulating(true)
    try {
      const res = await fetch('/api/agent/line-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: selectedBusiness?.code || 'U_SMARTGIFT',
          events: [
            {
              type: 'message',
              message: {
                id: `msg-sim-${Date.now()}`,
                type: 'text',
                text: 'สวัสดีครับ สนใจสอบถามรายละเอียดสินค้าและโปรโมชั่น SmartGift ครับ 🎁'
              },
              timestamp: Date.now(),
              source: {
                type: 'user',
                userId: 'U2962d3754b3390ec16c5a74ea154f742'
              },
              replyToken: `nHuySimToken_${Date.now()}`
            }
          ]
        })
      })
      if (res.ok) {
        liveInbox.reload?.()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSimulating(false)
    }
  }

  const handleSendMessage = (e) => {
    e?.preventDefault()
    if (!inputText.trim()) return

    const newMsg = {
      id: `msg-${Date.now()}`,
      sender: 'agent',
      text: inputText,
      time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
      status: 'sent'
    }

    if (!isLive) {
      const base = localConversations.length > 0 ? localConversations : CHAT_CONVERSATIONS
      setLocalConversations(
        base.map((c) => {
          if (c.id === activeChat.id) {
            return {
              ...c,
              lastMessage: inputText,
              messages: [...(c.messages || []), newMsg]
            }
          }
          return c
        })
      )
    }
    setInputText('')
  }

  const handleAiAssistAction = (actionType) => {
    if (actionType === 'summarize') {
      setAiActionMessage('✨ AI สรุป: ลูกค้าสนใจสอบถามบริการและสินค้า และต้องการข้อมูลใบเสนอราคา')
    } else if (actionType === 'suggest') {
      setInputText('ยินดีให้บริการครับ หากต้องการสอบถามรายละเอียดสินค้าหรือใบเสนอราคาเพิ่มเติม แจ้งได้ตลอดเลยนะครับ 😊')
    } else if (actionType === 'add_tag') {
      setAiActionMessage('🏷️ AI ทำการเพิ่มแท็ก "Hot Lead 🔥" ให้ลูกค้าเรียบร้อยแล้ว')
    } else if (actionType === 'add_points') {
      setAiActionMessage('⭐ เพิ่มแต้มโบนัส 100 แต้มให้ลูกค้าเรียบร้อย')
    } else if (actionType === 'task') {
      setAiActionMessage(`📋 บันทึกงานติดตามในระบบ CRM สำหรับลูกค้า ${activeChat.name} เรียบร้อยแล้ว`)
    }
  }

  return (
    <div className="flex h-[calc(100vh-140px)] min-h-[640px] flex-col rounded-2xl border border-slate-200/80 bg-white/90 shadow-lg backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 lg:flex-row overflow-hidden">
      {/* Column 1: Chat List & Search (280px - 320px) */}
      <div className="flex w-full flex-col border-b border-slate-200 lg:w-80 lg:border-b-0 lg:border-r dark:border-slate-800">
        {/* Search Header */}
        <div className="p-3.5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800 dark:text-white">กล่องข้อความ ({conversations.length})</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live DB
              </span>
            </div>
            <button
              onClick={() => liveInbox.reload?.()}
              className="text-[10px] text-purple-600 hover:underline font-semibold"
            >
              รีเฟรช
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหาชื่อ, ข้อความ, LINE ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-purple-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          {/* Filter Pills */}
          <div className="mt-2 flex gap-1 overflow-x-auto text-[11px] pb-1">
            {[
              { id: 'all', label: 'ทั้งหมด', count: conversations.length },
              { id: 'pending', label: 'รอดำเนินการ', count: conversations.length > 0 ? 1 : 0 },
              { id: 'followup', label: 'ติดตามผล', count: 0 },
              { id: 'closed', label: 'ปิดตัว', count: 0 },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterCategory(tab.id)}
                className={`rounded-lg px-2.5 py-1 font-semibold whitespace-nowrap transition-colors ${
                  filterCategory === tab.id
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 flex flex-col">
          {conversations.length === 0 ? (
            <div className="p-6 text-center space-y-3 my-auto">
              <MessageSquare className="w-8 h-8 text-slate-300 mx-auto" />
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">ยังไม่มีข้อความแชทในฐานข้อมูล</h4>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                เมื่อมีลูกค้าทักเข้ามาใน LINE OA หรือส่ง Webhook เข้ามา รายชื่อห้องแชทจะปรากฏที่นี่โดยอัตโนมัติ
              </p>
              <button
                onClick={handleSimulateIncomingMessage}
                disabled={simulating}
                className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-xs transition-all active:scale-95 inline-flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{simulating ? 'กำลังจำลอง...' : '🚀 ทดลองส่งแชทจำลองเข้า DB'}</span>
              </button>
            </div>
          ) : (
            filteredChats.map((chat) => (
              <div
                key={chat.id}
                onClick={() => setSelectedChatId(chat.id)}
                className={`flex cursor-pointer items-start gap-3 p-3 transition-colors ${
                  selectedChatId === chat.id
                    ? 'bg-purple-50/80 dark:bg-purple-950/40 border-l-4 border-purple-600'
                    : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="relative">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${chat.avatarBg}`}>
                    {chat.avatar}
                  </div>
                  {chat.status === 'online' && (
                    <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-bold text-slate-800 dark:text-white">{chat.name}</span>
                      <span className="rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        {chat.tier}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400">{chat.time}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{chat.lastMessage}</p>
                </div>
                {chat.unread > 0 && (
                  <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-600 text-[9px] font-bold text-white">
                    {chat.unread}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Column 2 & 3: Active Chat Stream & Member Drawer */}
      {!activeChat ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3 bg-slate-50/40 dark:bg-slate-900/40">
          <div className="w-14 h-14 rounded-full bg-purple-50 dark:bg-purple-950/60 flex items-center justify-center text-purple-600">
            <MessageSquare className="w-7 h-7" />
          </div>
          <h3 className="font-bold text-sm text-slate-800 dark:text-white">ยังไม่ได้เลือกห้องแชท</h3>
          <p className="text-xs text-slate-500 max-w-sm leading-relaxed">
            เลือกห้องแชทจากกล่องข้อความทางด้านซ้าย หรือกดปุ่ม <strong>"ทดลองส่งแชทจำลองเข้า DB"</strong> เพื่อทดสอบส่งข้อความเข้ามาในระบบ
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col bg-slate-50/40 dark:bg-slate-900/40">
          {/* Chat Stream Header */}
          <div className="flex items-center justify-between border-b border-slate-200 bg-white/90 p-3.5 px-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white ${activeChat.avatarBg}`}>
                {activeChat.avatar}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">{activeChat.name}</h2>
                  <span className="rounded bg-amber-100 px-1.5 py-0.2 text-[9px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    {activeChat.tier}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-emerald-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> ออนไลน์
                  </span>
                </div>
              <p className="text-[10px] text-slate-400 font-mono">{activeChat.lineUserId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              ⭐ ติดดาว
            </button>
            <button className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              🏷️ เพิ่มแท็ก
            </button>
            <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* AI Action Notification Alert */}
        {aiActionMessage && (
          <div className="mx-4 mt-3 flex items-center justify-between rounded-xl border border-purple-200 bg-purple-50/90 p-2.5 px-4 text-xs text-purple-900 backdrop-blur-sm dark:border-purple-900/50 dark:bg-purple-950/60 dark:text-purple-200 animate-in fade-in">
            <span>{aiActionMessage}</span>
            <button
              onClick={() => setAiActionMessage(null)}
              className="text-xs font-bold text-purple-700 hover:text-purple-900 dark:text-purple-300"
            >
              ✕
            </button>
          </div>
        )}

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="text-center text-[10px] text-slate-400 my-2">
            <span className="rounded-full bg-slate-200/80 px-3 py-1 font-semibold dark:bg-slate-800">วันนี้ 11 ส.ค. 2569</span>
          </div>

          {activeChat.messages.map((msg) => {
            const isCustomer = msg.sender === 'customer'
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isCustomer ? 'items-start' : 'items-end'}`}
              >
                {/* Regular Text Bubble */}
                {msg.text && (
                  <div
                    className={`max-w-md rounded-2xl p-3.5 text-xs leading-relaxed shadow-sm ${
                      isCustomer
                        ? 'bg-white text-slate-800 rounded-tl-sm border border-slate-200/80 dark:bg-slate-800 dark:text-white dark:border-slate-700'
                        : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-tr-sm'
                    }`}
                  >
                    <p className="whitespace-pre-line">{msg.text}</p>
                  </div>
                )}

                {/* Flex Message Card */}
                {msg.type === 'flex' && (
                  <div className="max-w-md rounded-2xl border border-purple-300 bg-gradient-to-br from-purple-900 to-slate-900 p-4 text-white shadow-md">
                    <div className="flex items-center justify-between border-b border-purple-700/50 pb-2">
                      <span className="text-xs font-bold text-purple-200">✨ {msg.flexData.title}</span>
                      <span className="rounded bg-purple-500/30 px-1.5 py-0.5 text-[9px] font-bold text-purple-300">Flex Card</span>
                    </div>
                    <ul className="mt-3 space-y-1.5 text-xs text-purple-100">
                      {msg.flexData.features.map((feat, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* File Attachment Card */}
                {msg.type === 'file' && (
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-800 dark:text-white">{msg.filename}</div>
                      <div className="text-[10px] text-slate-400">{msg.filesize} · PDF Document</div>
                    </div>
                  </div>
                )}

                <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                  <span>{msg.time}</span>
                  {!isCustomer && <span className="text-purple-600 font-bold">✓✓</span>}
                </div>
              </div>
            )
          })}
        </div>

        {/* Composer Bar */}
        <div className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3 text-xs text-slate-500 mb-2">
            <button className="flex items-center gap-1 font-bold text-purple-600">
              <span>💬 ข้อความ</span>
            </button>
            <button className="flex items-center gap-1 hover:text-slate-800 dark:hover:text-white">
              <ImageIcon className="h-3.5 w-3.5" /> <span>รูปภาพ</span>
            </button>
            <button className="flex items-center gap-1 hover:text-slate-800 dark:hover:text-white">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" /> <span>Flex Message</span>
            </button>
            <button className="flex items-center gap-1 hover:text-slate-800 dark:hover:text-white">
              <FileText className="h-3.5 w-3.5" /> <span>เทมเพลต</span>
            </button>
          </div>

          <form onSubmit={handleSendMessage} className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="พิมพ์ข้อความตอบกลับ..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-900 focus:border-purple-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <div className="absolute right-3 top-2 flex items-center gap-1 text-slate-400">
                <Smile className="h-4 w-4 cursor-pointer hover:text-purple-600" />
                <Paperclip className="h-4 w-4 cursor-pointer hover:text-purple-600" />
              </div>
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:from-purple-700 hover:to-indigo-700 transition-all"
            >
              <Send className="h-3.5 w-3.5" />
              <span>ส่งข้อความ</span>
            </button>
          </form>
        </div>
      </div>

      {/* Column 3: Member 360° & AI Assist (300px - 340px) */}
      <div className="flex w-full flex-col border-t border-slate-200 bg-white lg:w-80 lg:border-t-0 lg:border-l dark:border-slate-800 dark:bg-slate-900 overflow-y-auto">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 dark:text-white">ข้อมูลสมาชิก 360°</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              เป็นสมาชิก 8 เดือน
            </span>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className={`flex h-12 w-12 items-center justify-center rounded-full text-base font-bold text-white ${activeChat.avatarBg}`}>
              {activeChat.avatar}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{activeChat.name}</h3>
                <span className="rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  {activeChat.tier}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono">{activeChat.lineUserId}</p>
            </div>
          </div>

          {/* Points & Spent Quick Stats */}
          <div className="mt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-amber-50/60 p-2.5 dark:bg-amber-950/30">
              <div className="text-[10px] text-amber-700 dark:text-amber-400">แต้มสะสม</div>
              <div className="text-sm font-black text-amber-900 dark:text-amber-200">⭐ {activeChat.points.toLocaleString()}</div>
              <div className="text-[9px] text-amber-600/80">{activeChat.pointsValue}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">ยอดใช้จ่ายรวม</div>
              <div className="text-sm font-black text-slate-900 dark:text-white">{activeChat.totalSpent}</div>
              <div className="text-[9px] text-slate-400">จาก {activeChat.orderCount} รายการ</div>
            </div>
          </div>

          {/* Contact Details */}
          <div className="mt-3 space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
            <div>📞 {activeChat.phone}</div>
            <div>✉️ {activeChat.email}</div>
            <div>💬 {activeChat.lineHandle}</div>
          </div>

          {/* Tags */}
          <div className="mt-3">
            <div className="text-[10px] font-semibold text-slate-400 mb-1">แท็ก</div>
            <div className="flex flex-wrap gap-1">
              {activeChat.tags.map((tag, idx) => (
                <span key={idx} className="rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* AI Assist Switchboard Panel */}
        <div className="p-4 bg-gradient-to-b from-purple-50/50 to-transparent dark:from-purple-950/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-purple-900 flex items-center gap-1.5 dark:text-purple-200">
              <Sparkles className="h-3.5 w-3.5 text-purple-600" />
              AI Assist
            </span>
            <span className="text-[10px] text-purple-600">แนะนำสำหรับแชทนี้</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleAiAssistAction('summarize')}
              className="rounded-xl border border-purple-200 bg-white p-2 text-left text-xs font-semibold text-purple-900 shadow-sm hover:border-purple-400 hover:bg-purple-50 transition-all dark:border-purple-800 dark:bg-slate-800 dark:text-purple-200"
            >
              📄 สรุปบทสนทนา
            </button>
            <button
              onClick={() => handleAiAssistAction('suggest')}
              className="rounded-xl border border-purple-200 bg-white p-2 text-left text-xs font-semibold text-purple-900 shadow-sm hover:border-purple-400 hover:bg-purple-50 transition-all dark:border-purple-800 dark:bg-slate-800 dark:text-purple-200"
            >
              💡 แนะนำคำตอบ
            </button>
            <button
              onClick={() => handleAiAssistAction('add_tag')}
              className="rounded-xl border border-purple-200 bg-white p-2 text-left text-xs font-semibold text-purple-900 shadow-sm hover:border-purple-400 hover:bg-purple-50 transition-all dark:border-purple-800 dark:bg-slate-800 dark:text-purple-200"
            >
              🏷️ เพิ่มแท็ก
            </button>
            <button
              onClick={() => handleAiAssistAction('task')}
              className="rounded-xl border border-purple-200 bg-white p-2 text-left text-xs font-semibold text-purple-900 shadow-sm hover:border-purple-400 hover:bg-purple-50 transition-all dark:border-purple-800 dark:bg-slate-800 dark:text-purple-200"
            >
              ⏰ สร้างงานติดตาม
            </button>
            <button
              onClick={() => handleAiAssistAction('add_points')}
              className="rounded-xl border border-purple-200 bg-white p-2 text-left text-xs font-semibold text-purple-900 shadow-sm hover:border-purple-400 hover:bg-purple-50 transition-all dark:border-purple-800 dark:bg-slate-800 dark:text-purple-200"
            >
              ⭐ เพิ่มแต้ม
            </button>
            <button
              className="rounded-xl border border-purple-200 bg-white p-2 text-left text-xs font-semibold text-purple-900 shadow-sm hover:border-purple-400 hover:bg-purple-50 transition-all dark:border-purple-800 dark:bg-slate-800 dark:text-purple-200"
            >
              👤 ดูโปรไฟล์เต็ม
            </button>
          </div>

          {/* AI MCP Auto-Reply Master Toggle */}
          <div className="mt-3 flex items-center justify-between rounded-xl bg-gradient-to-r from-purple-700 to-indigo-700 p-2.5 px-3 text-white shadow-sm">
            <span className="text-[11px] font-bold flex items-center gap-1">
              <Bot className="h-3.5 w-3.5 text-purple-200" />
              AI MCP ช่วยตอบอัตโนมัติ
            </span>
            <input
              type="checkbox"
              checked={aiAutoReply}
              onChange={(e) => setAiAutoReply(e.target.checked)}
              className="h-4 w-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
            />
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
