'use client'

import { useEffect, useMemo, useState } from 'react'
import { MessageSquare, RefreshCw } from 'lucide-react'

import { Card, EmptyState, ErrorState, PageHeader, StatusPill, TruncationNotice } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'

// @req FR-091 — the CRM Conversation Inbox: the first surface able to read what the
// LINE ingress has been writing since FR-023.
// @spec SDD-050, BR-001, BR-011, SDD-007
// @tested tests/unit/fr091-inbox-ui-contract.test.js, tests/e2e/fr091-conversation-inbox.spec.js
//
// There is no reply box on this page and its absence is the design (BR-011): the reply
// token lives for about thirty seconds and belongs to the edge runtime that received
// the message. A second reply owner is the failure that rule exists to prevent.

const DIRECTION_LABEL = { INBOUND: 'ลูกค้า', OUTBOUND: 'ร้าน' }

const timeOf = (iso) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })

function ConversationRow({ row, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row.id)}
      aria-current={active ? 'true' : undefined}
      className={`w-full rounded-xl border p-3 text-left transition-colors ${
        active
          ? 'border-[var(--brand)] bg-[var(--brand-tint)]'
          : 'border-[var(--border)] hover:bg-[var(--brand-tint)]'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-bold">{row.customer.displayName}</span>
        <span className="shrink-0 text-[10px] text-muted">
          {row.lastMessage ? timeOf(row.lastMessage.createdAt) : timeOf(row.updatedAt)}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] text-muted">
        {row.lastMessage
          ? `${DIRECTION_LABEL[row.lastMessage.direction] || row.lastMessage.direction}: ${row.lastMessage.preview}`
          : 'ยังไม่มีข้อความในห้องนี้'}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted">
        <span className="pill pill-planned">{row.channel}</span>
        <span>{row.messageCount} ข้อความ</span>
        <span>·</span>
        {/* A conversation with no Business is shared by the tenant (BR-001), not
            missing data — so it is labelled rather than left blank. */}
        <span>{row.businessName || 'ทั้ง tenant'}</span>
      </div>
    </button>
  )
}

function Thread({ businessId, conversationId }) {
  const path = conversationId
    ? `/api/crm/conversations/${encodeURIComponent(conversationId)}?businessId=${encodeURIComponent(businessId)}`
    : null
  const thread = useFetch(path, [conversationId, businessId])

  if (!conversationId) {
    return <EmptyState title="เลือกห้องสนทนาทางซ้าย" hint="เพื่อดูข้อความทั้งหมดของลูกค้ารายนั้น" />
  }
  if (thread.error) return <ErrorState title="เปิดห้องสนทนาไม่ได้" detail={thread.error} retry={thread.reload} />
  // `loading` is not the only not-yet state. `useFetch` starts its request in an
  // effect, so the render between "a conversation was selected" and "the fetch began"
  // has a path, `loading: false` and no data — which destructured straight into a
  // crash the first time this page was opened in a browser.
  if (thread.loading || !thread.data) return <LoadingCard />

  const { conversation, messages } = thread.data

  return (
    <Card className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div>
          <p className="text-sm font-bold">{conversation.customer.displayName}</p>
          <p className="mt-0.5 font-mono text-[10px] text-muted">
            {conversation.customer.code} · {conversation.channel} · {conversation.businessName || 'ทั้ง tenant'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={conversation.customer.lifecycleStage} />
          <StatusPill status={conversation.status} />
        </div>
      </div>

      <div className="mt-3 flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && <p className="text-xs text-muted">ห้องนี้ยังไม่มีข้อความ</p>}
        {messages.map((message) => {
          const inbound = message.direction === 'INBOUND'
          return (
            <div key={message.id} className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-xs ${
                  inbound ? 'bg-[var(--surface-2,rgba(0,0,0,0.04))]' : 'bg-[var(--brand-tint)]'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
                <p className="mt-1 text-[10px] text-muted">
                  {DIRECTION_LABEL[message.direction] || message.direction} · {timeOf(message.createdAt)}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-3 border-t border-[var(--border)] pt-3 text-[10px] text-muted">
        หน้านี้อ่านอย่างเดียว — การตอบกลับเป็นหน้าที่ของ runtime ที่รับข้อความ (BR-011) ไม่ใช่ของ console
      </p>
    </Card>
  )
}

export default function ConversationInboxPage() {
  const scope = useScope()
  const businessId = scope.currentBusiness?.id || ''
  const path = businessId ? `/api/crm/conversations?businessId=${encodeURIComponent(businessId)}` : null
  const inbox = useFetch(path, [businessId])
  const [selected, setSelected] = useState(null)

  const rows = useMemo(() => inbox.data?.conversations ?? [], [inbox.data])

  // The thread pane opens on the newest conversation rather than on an empty state the
  // reader has to dismiss. Re-selecting only when the current pick is gone keeps a
  // refresh from yanking the reader back to the top of the list.
  useEffect(() => {
    if (rows.length === 0) {
      setSelected(null)
      return
    }
    setSelected((current) => (current && rows.some((row) => row.id === current) ? current : rows[0].id))
  }, [rows])

  if (!businessId) return <EmptyState title="เลือกธุรกิจก่อน" hint="Inbox อ่านตาม tenant ของธุรกิจที่เปิดอยู่" />
  if (inbox.error) return <ErrorState title="โหลด Inbox ไม่ได้" detail={inbox.error} retry={inbox.reload} />
  if (inbox.loading || !inbox.data) return <LoadingCard />

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="CRM"
        title="Inbox"
        subtitle={`${inbox.data.counts.conversations} ห้องสนทนา · ${inbox.data.counts.messages} ข้อความ · ${inbox.data.counts.customers} ลูกค้า`}
        actions={
          <button type="button" className="btn" onClick={inbox.reload}>
            <RefreshCw className="h-4 w-4" aria-hidden /> รีเฟรช
          </button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="ยังไม่มีข้อความจากลูกค้า"
          hint="ข้อความจาก LINE OA จะปรากฏที่นี่ทันทีที่ webhook รับเข้ามา — หน้านี้ไม่ได้อัปเดตเอง กด รีเฟรช เพื่อดูข้อความใหม่"
        />
      ) : (
        <>
          {inbox.data.truncated && (
            <TruncationNotice
              shown={rows.length}
              limit={inbox.data.limit}
              noun="ห้องสนทนา"
              hint="เรียงตามข้อความล่าสุด"
            />
          )}
          <div className="grid grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
            <div
              className="space-y-2 overflow-y-auto max-lg:max-h-[320px] lg:max-h-[70vh]"
              role="list"
              aria-label="ห้องสนทนา"
            >
              {rows.map((row) => (
                <div role="listitem" key={row.id}>
                  <ConversationRow row={row} active={row.id === selected} onSelect={setSelected} />
                </div>
              ))}
            </div>
            <div className="lg:max-h-[70vh]">
              <Thread businessId={businessId} conversationId={selected} />
            </div>
          </div>
        </>
      )}

      <p className="flex items-center gap-2 text-[10px] text-muted">
        <MessageSquare className="h-3 w-3" aria-hidden />
        ขอบเขต: tenant ของ {inbox.data.scope.businessName} — ธุรกิจใน tenant เดียวกันแชร์ CRM ได้ (BR-001)
      </p>
    </div>
  )
}
