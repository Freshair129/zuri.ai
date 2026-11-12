// @req FR-091, FR-093 — the Live CRM inbox renders recorded conversations and messages.
// @spec SDD-050, ADR-060, ADR-061
// @tested tests/unit/line-crm-live-chat-render.test.js
import React, { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LineCrmLiveChat from '@/modules/line-crm/LineCrmLiveChat'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'

globalThis.React = React

const h = vi.hoisted(() => ({ responses: new Map(), requests: [] }))

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

vi.mock('@/modules/project-manager/components/useApi', () => ({
  api: () => Promise.resolve(),
  useFetch: (path) => {
    if (path) h.requests.push(path)
    return path
      ? h.responses.get(path) || { data: null, loading: true, error: null }
      : { data: null, loading: false, error: null }
  },
}))

const inboxPath = '/api/crm/conversations?businessId=biz-1'

const conversation = {
  id: 'conversation-1',
  channel: 'LINE',
  status: 'OPEN',
  unreadCount: 2,
  lastMessage: {
    direction: 'INBOUND',
    preview: 'Recorded inbox preview',
    createdAt: '2026-11-10T08:15:00.000Z',
  },
  customer: {
    id: 'customer-1',
    code: 'CUS-001',
    displayName: 'Recorded Customer',
    lifecycleStage: 'LEAD',
    consentStatus: 'PENDING',
    consentRecordedAt: '2026-11-10T08:00:00.000Z',
  },
}

const threadPath = '/api/crm/conversations/conversation-1?businessId=biz-1'

function renderChat(businessId = 'biz-1') {
  return renderToStaticMarkup(createElement(
    ScopeProvider,
    { inventory: sampleInventory(), selection: businessId ? { businessId } : {} },
    createElement(LineCrmLiveChat),
  ))
}

function setInbox(result) {
  h.responses = new Map([[inboxPath, result]])
  h.requests = []
}

function setConversationThread(messages = [{
  id: 'message-1',
  direction: 'INBOUND',
  body: 'Recorded message body',
  createdAt: '2026-11-10T08:30:00.000Z',
}]) {
  setInbox({ data: { conversations: [conversation] }, loading: false, error: null })
  h.responses.set(threadPath, {
    data: { conversation, messages },
    loading: false,
    error: null,
  })
}

afterEach(() => {
  h.responses = new Map()
  h.requests = []
})

describe('Live CRM inbox source states', () => {
  it('shows loading without claiming the inbox is empty', () => {
    setInbox({ data: null, loading: true, error: null })
    const html = renderChat()

    expect(html).toContain('กำลังโหลดบทสนทนา')
    expect(html).not.toContain('ยังไม่มีข้อความแชทในฐานข้อมูล')
  })

  it('shows the inbox error without claiming the inbox is empty', () => {
    setInbox({ data: null, loading: false, error: 'INBOX_READ_FAILED' })
    const html = renderChat()

    expect(html).toContain('INBOX_READ_FAILED')
    expect(html).not.toContain('ยังไม่มีข้อความแชทในฐานข้อมูล')
  })

  it('shows the empty message only for a completed empty response', () => {
    setInbox({ data: { conversations: [] }, loading: false, error: null })
    const html = renderChat()

    expect(html).toContain('ยังไม่มีข้อความแชทในฐานข้อมูล')
    expect(html).toContain('ยังไม่ได้เลือกห้องแชท')
    expect(html).toContain('lucide-message-square')
    expect(html).toContain('Live DB')
  })

  it('ignores an inbox response tied to a different request key and keeps loading', () => {
    setInbox({
      data: { conversations: [{ ...conversation, customer: { ...conversation.customer, displayName: 'Stale Inbox Customer' } }] },
      loading: false,
      error: null,
      requestKey: '/api/crm/conversations?businessId=biz-2',
    })
    const html = renderChat()

    expect(html).toContain('กำลังโหลดบทสนทนา')
    expect(html).not.toContain('Stale Inbox Customer')
  })

  it('labels a truncated inbox as the most recent limited conversation read', () => {
    setInbox({ data: { conversations: [conversation], truncated: true, limit: 25 }, loading: false, error: null })
    const html = renderChat()

    expect(html).toContain('กล่องข้อความ (1)')
    expect(html).toContain('อ่านเฉพาะ 25 บทสนทนาล่าสุด')
  })
})

describe('Live CRM recorded thread rendering', () => {
  it('renders recorded body, consent and unavailable controls without a reply composer', () => {
    setConversationThread()
    const html = renderChat()

    expect(html).toContain('Recorded message body')
    expect(html).toContain('รอยืนยัน consent')
    expect(html).toContain('ยังไม่มีระบบสะสมแต้ม')
    expect(html).toContain('ไม่มีข้อมูล')
    expect(html).toContain('href="/customer/conversations"')
    expect(html).toContain('ต้องเป็นเจ้าของ Business')
    expect(html).not.toContain('<input type="text"')
    expect(html).not.toMatch(/<textarea\b/)

    const disabledButtons = [...html.matchAll(/<button\b[^>]*disabled=""[^>]*>(.*?)<\/button>/g)]
      .map((match) => match[1])
      .join(' ')
    expect(disabledButtons).toContain('แนะนำคำตอบ')
    expect(disabledButtons).toContain('เพิ่มแท็ก')
    expect(disabledButtons).toContain('สร้างงานติดตาม')
    expect(disabledButtons).toContain('เพิ่มแต้ม')
    expect(disabledButtons).toContain('ดูโปรไฟล์เต็ม')
    expect((disabledButtons.match(/ยังไม่พร้อมใช้งาน/g) || []).length).toBe(5)
    expect(html).toMatch(/<dt[^>]*>ช่องทาง<\/dt><dd>LINE<\/dd>/)
    expect(html).toMatch(/<dt[^>]*>สถานะบทสนทนา<\/dt><dd>OPEN<\/dd>/)
    expect(html).toMatch(/<dt[^>]*>ข้อความยังไม่อ่าน<\/dt><dd>2<\/dd>/)
    expect(html).toContain('CUS-001')
    expect(html).toContain('LEAD')
    expect(html).toContain('Recorded inbox preview')
  })

  it('wraps a long unbroken recorded message body', () => {
    const body = 'x'.repeat(300)
    setConversationThread([{ id: 'long-message', direction: 'INBOUND', body, createdAt: '2026-11-10T08:30:00.000Z' }])
    const html = renderChat()
    const bodyElement = html.match(/<p class="([^"]*)">x{300}<\/p>/)

    expect(bodyElement).not.toBeNull()
    expect(bodyElement[1]).toContain('whitespace-pre-line')
    expect(bodyElement[1]).toContain('break-words')
    expect(bodyElement[1]).toContain('[overflow-wrap:anywhere]')
  })

  it('shows a plain empty-thread line only after the thread request completes', () => {
    setConversationThread([])
    const html = renderChat()

    expect(html).toContain('ห้องนี้ยังไม่มีข้อความ')
    expect(html).not.toContain('เริ่มการสนทนากับลูกค้าผ่านระบบ LINE CRM')
  })

  it('shows thread loading and error states instead of empty or synthetic messages', () => {
    setInbox({ data: { conversations: [conversation] }, loading: false, error: null })
    h.responses.set(threadPath, { data: null, loading: true, error: null })
    const loadingHtml = renderChat()
    expect(loadingHtml).toContain('กำลังโหลดข้อความ')
    expect(loadingHtml).not.toContain('ห้องนี้ยังไม่มีข้อความ')
    expect(loadingHtml).not.toContain('เริ่มการสนทนากับลูกค้าผ่านระบบ LINE CRM')

    h.responses.set(threadPath, { data: null, loading: false, error: 'THREAD_READ_FAILED' })
    const errorHtml = renderChat()
    expect(errorHtml).toContain('THREAD_READ_FAILED')
    expect(errorHtml).not.toContain('ห้องนี้ยังไม่มีข้อความ')
  })

  it('ignores thread data tied to a different request key and keeps loading', () => {
    setConversationThread([{
      id: 'stale-message',
      direction: 'INBOUND',
      body: 'Stale thread response body',
      createdAt: '2026-11-10T08:30:00.000Z',
    }])
    h.responses.set(threadPath, {
      ...h.responses.get(threadPath),
      requestKey: '/api/crm/conversations/another-conversation?businessId=biz-1',
    })
    const html = renderChat()

    expect(html).toContain('กำลังโหลดข้อความ')
    expect(html).not.toContain('Stale thread response body')
  })

  it('does not show online, read receipts, a fixed date, or the inactive auto-reply toggle', () => {
    setConversationThread()
    const html = renderChat()

    for (const inventedValue of ['ออนไลน์', '8 เดือน', '11 ส.ค. 2569', '✓✓', 'AI MCP ช่วยตอบอัตโนมัติ']) {
      expect(html).not.toContain(inventedValue)
    }
  })

  it('keeps the source free of canned actions, follow-up task creation and a second reply surface', () => {
    const source = readFileSync(new URL('../../src/modules/line-crm/LineCrmLiveChat.jsx', import.meta.url), 'utf8')
    const viewModelsSource = readFileSync(new URL('../../src/modules/line-crm/lineCrmViewModels.js', import.meta.url), 'utf8')

    for (const forbidden of [
      'AI สรุป',
      'Hot Lead',
      'เพิ่มแต้มโบนัส',
      'ฉบับร่าง',
      'เรียบร้อย',
      '/reply',
      'aiAutoReply',
      'metadata?.',
      "|| 'Member'",
    ]) {
      expect(source).not.toContain(forbidden)
    }
    expect(source).not.toContain('/api/crm/sales-tasks')
    expect(source).not.toContain('createFollowUpTask')
    expect(viewModelsSource).not.toContain('/api/crm/sales-tasks')
  })
})

describe('Live CRM Business-scoped requests', () => {
  it.each(['biz-1', 'biz-2'])('loads conversations for selected Business %s', (businessId) => {
    setInbox({ data: { conversations: [] }, loading: false, error: null })
    renderChat(businessId)

    expect(h.requests).toEqual([`/api/crm/conversations?businessId=${businessId}`])
  })

  it('waits for a Business before requesting conversations', () => {
    setInbox({ data: null, loading: false, error: null })
    renderChat(null)

    expect(h.requests).toEqual([])
  })
})
