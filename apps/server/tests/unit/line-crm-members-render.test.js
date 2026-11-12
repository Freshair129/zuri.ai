// @req FR-091, FR-103, FR-078 — Member 360 shows recorded CRM and Integration values separately.
// @spec SDD-050, SEC-005, BR-001
// @tested tests/unit/line-crm-members-render.test.js
import React, { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LineCrmMembers, { MemberDetail } from '@/modules/line-crm/LineCrmMembers'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'
import { buildCustomerRows, buildRegistryRows } from '@/modules/line-crm/lineCrmViewModels'

globalThis.React = React

const h = vi.hoisted(() => ({ responses: new Map(), requests: [] }))

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

vi.mock('@/modules/project-manager/components/useApi', () => ({
  useFetch: (path) => {
    if (path) h.requests.push(path)
    return path
      ? h.responses.get(path) || { data: null, loading: true, error: null }
      : { data: null, loading: false, error: null }
  },
}))

const customerResponse = {
  conversations: [
    {
      id: 'conversation-pending-1',
      channel: 'LINE',
      customer: {
        id: 'customer-pending',
        code: 'CUS-PENDING',
        displayName: 'Pending Customer',
        lifecycleStage: 'LEAD',
        consentStatus: 'PENDING',
        consentRecordedAt: '2026-11-10T08:00:00.000Z',
      },
      lastMessage: { createdAt: '2026-11-10T08:10:00.000Z' },
    },
    {
      id: 'conversation-pending-2',
      channel: 'FACEBOOK',
      customer: {
        id: 'customer-pending',
        code: 'CUS-PENDING',
        displayName: 'Pending Customer',
        lifecycleStage: 'LEAD',
        consentStatus: 'PENDING',
        consentRecordedAt: '2026-11-10T08:00:00.000Z',
      },
      lastMessage: { createdAt: '2026-11-10T09:10:00.000Z' },
    },
    {
      id: 'conversation-granted',
      channel: 'LINE',
      customer: {
        id: 'customer-granted',
        code: 'CUS-GRANTED',
        displayName: 'Granted Customer',
        lifecycleStage: 'ACTIVE',
        consentStatus: 'GRANTED',
        consentRecordedAt: '2026-11-10T10:00:00.000Z',
      },
      lastMessage: null,
    },
  ],
  limit: 200,
  truncated: false,
}

const registryResponse = [{
  id: 'registration-1',
  name: 'Registered LINE User',
  externalAccountId: 'U-REG-001',
  kind: 'USER',
  status: 'ACTIVE',
  role: 'SECONDARY',
  metadata: { role: 'SALES_REP', department: 'Sales' },
  createdAt: '2026-11-10T07:00:00.000Z',
}]

function renderMembers({ selection = { businessId: 'biz-1' }, onNavigate } = {}) {
  return renderToStaticMarkup(createElement(
    ScopeProvider,
    { inventory: sampleInventory(), selection },
    createElement(LineCrmMembers, { onNavigate }),
  ))
}

function setResponses(overrides = {}) {
  const businessId = 'biz-1'
  h.responses = new Map([
    [`/api/crm/conversations?businessId=${businessId}`, { data: customerResponse, loading: false, error: null }],
    [`/api/platform/integrations/line-registry?businessId=${businessId}`, { data: registryResponse, loading: false, error: null }],
    ...Object.entries(overrides),
  ])
  h.requests = []
}

afterEach(() => {
  h.responses = new Map()
  h.requests = []
})

describe('LINE CRM Member 360 rendering', () => {
  it('shows recorded pending and granted consent without a hard-coded grant', () => {
    setResponses()
    const html = renderMembers()

    expect(html).toContain('รอยืนยัน consent')
    expect(html).toContain('ยืนยัน consent แล้ว')
    expect(html).not.toContain('ยินยอมแล้ว (Granted)')
  })

  it('omits loyalty defaults and explains that no loyalty system supplies these values', () => {
    setResponses()
    const html = renderMembers()

    expect(html).not.toContain('⭐')
    expect(html).not.toMatch(/Bronze|Silver|Gold|Platinum/)
    expect(html).toContain('ยังไม่มีระบบสะสมแต้ม')
  })

  it('renders CRM customers and Integration registrations separately and deduplicates customers', () => {
    setResponses()
    const html = renderMembers()

    expect(html).toContain('ลูกค้า CRM')
    expect(html).toContain('ผู้ใช้ LINE ที่ลงทะเบียน (Integration)')
    expect(html).toContain('Registered LINE User')
    expect(html).toContain('บทบาท: SALES_REP')
    expect(html).not.toContain('SECONDARY')
    expect((html.match(/Pending Customer/g) || []).length).toBe(1)
    expect(html).toContain('FACEBOOK')
    expect(html).toContain('ไม่เชื่อมโยงกับลูกค้า CRM')
  })

  it('requests exactly the two Business-scoped sources', () => {
    setResponses()
    renderMembers()

    expect(h.requests).toEqual([
      '/api/crm/conversations?businessId=biz-1',
      '/api/platform/integrations/line-registry?businessId=biz-1',
    ])
  })

  it('waits for a selected Business without making either request', () => {
    setResponses()
    const html = renderMembers({ selection: {} })

    expect(h.requests).toEqual([])
    expect(html).toContain('เลือก Business')
    expect(html).not.toContain('<table')
  })

  it('shows a conversation-source error without the empty-list copy', () => {
    setResponses({
      ['/api/crm/conversations?businessId=biz-1']: { data: null, loading: false, error: 'CRM_READ_FAILED' },
    })
    const html = renderMembers()

    expect(html).toContain('CRM_READ_FAILED')
    expect(html).not.toContain('ยังไม่มีลูกค้า CRM ในกล่องข้อความ')
  })

  it('does not show the conversation-source empty copy while loading', () => {
    setResponses({
      ['/api/crm/conversations?businessId=biz-1']: { data: null, loading: true, error: null },
    })
    const html = renderMembers()

    expect(html).toContain('กำลังโหลด')
    expect(html).not.toContain('ยังไม่มีลูกค้า CRM ในกล่องข้อความ')
  })

  it('shows the CRM empty state only after a successful response and names the truncation limit', () => {
    setResponses({
      ['/api/crm/conversations?businessId=biz-1']: {
        data: { conversations: [], truncated: true, limit: 25 },
        loading: false,
        error: null,
      },
      ['/api/platform/integrations/line-registry?businessId=biz-1']: { data: [], loading: false, error: null },
    })
    const html = renderMembers()

    expect(html).toContain('ยังไม่มีลูกค้า CRM ในกล่องข้อความ')
    expect(html).toContain('อ่านเฉพาะ 25 รายการล่าสุด')
    expect(html).toContain('ยังไม่มีผู้ใช้ LINE ที่ลงทะเบียน')
  })

  it('shows a registry error without claiming that no LINE users are registered', () => {
    setResponses({
      ['/api/platform/integrations/line-registry?businessId=biz-1']: {
        data: null,
        loading: false,
        error: 'REGISTRY_READ_FAILED',
      },
    })
    const html = renderMembers()

    expect(html).toContain('REGISTRY_READ_FAILED')
    expect(html).not.toContain('ยังไม่มีผู้ใช้ LINE ที่ลงทะเบียน')
  })

  it('ignores customer and registry data tied to different request keys and keeps both sources loading', () => {
    setResponses({
      ['/api/crm/conversations?businessId=biz-1']: {
        data: { conversations: [{
          id: 'stale-conversation',
          customer: { id: 'stale-customer', displayName: 'Stale CRM Customer' },
        }] },
        loading: false,
        error: null,
        requestKey: '/api/crm/conversations?businessId=biz-2',
      },
      ['/api/platform/integrations/line-registry?businessId=biz-1']: {
        data: [{ id: 'stale-registration', kind: 'USER', name: 'Stale Registry User' }],
        loading: false,
        error: null,
        requestKey: '/api/platform/integrations/line-registry?businessId=biz-2',
      },
    })
    const html = renderMembers()

    expect(html).toContain('กำลังโหลด')
    expect(html).not.toContain('Stale CRM Customer')
    expect(html).not.toContain('Stale Registry User')
  })

  it('renders a pending customer detail and three unavailable loyalty values', () => {
    const [member] = buildCustomerRows(customerResponse.conversations)
    const html = renderToStaticMarkup(createElement(MemberDetail, { member, onClose: () => {} }))

    expect(html).toContain('รอยืนยัน consent')
    expect((html.match(/ไม่มีข้อมูล/g) || []).length).toBe(3)
    expect(html).toContain('แต้มสะสม')
    expect(html).toContain('ระดับสมาชิก')
    expect(html).toContain('ยอดซื้อสะสม')
  })

  it('renders no consent data for an Integration registration detail', () => {
    const [member] = buildRegistryRows(registryResponse)
    const html = renderToStaticMarkup(createElement(MemberDetail, { member, onClose: () => {} }))

    expect(html).toMatch(/สถานะ consent<\/span><span>ไม่มีข้อมูล<\/span>/)
    expect(html).toContain('aria-label="ปิด"')
    expect(html).not.toContain('ไปที่กล่องข้อความ')
    for (const consentLabel of ['รอยืนยัน consent', 'ยืนยัน consent แล้ว', 'ลูกค้าปฏิเสธ', 'ลูกค้าเก่า (ก่อนมีระบบนี้)']) {
      expect(html).not.toContain(consentLabel)
    }
  })

  it('offers inbox navigation only when the customer detail receives a callback', () => {
    const [member] = buildCustomerRows(customerResponse.conversations)
    const html = renderToStaticMarkup(createElement(MemberDetail, {
      member,
      onClose: () => {},
      onOpenInbox: () => {},
    }))

    expect(html).toContain('ไปที่กล่องข้อความ')
    expect(html).toContain('aria-label="ปิด"')
  })

  it('keeps a customer detail closable when no inbox callback is provided', () => {
    const [member] = buildCustomerRows(customerResponse.conversations)
    const html = renderToStaticMarkup(createElement(MemberDetail, { member, onClose: () => {} }))

    expect(html).toContain('aria-label="ปิด"')
    expect(html).not.toContain('ไปที่กล่องข้อความ')
  })

  it('does not offer inbox navigation for a registry detail even when a callback is passed', () => {
    const [member] = buildRegistryRows(registryResponse)
    const html = renderToStaticMarkup(createElement(MemberDetail, {
      member,
      onClose: () => {},
      onOpenInbox: () => {},
    }))

    expect(html).toContain('aria-label="ปิด"')
    expect(html).not.toContain('ไปที่กล่องข้อความ')
  })

  it('keeps the member source free of fabricated identity and loyalty values', () => {
    const source = readFileSync(new URL('../../src/modules/line-crm/LineCrmMembers.jsx', import.meta.url), 'utf8')

    for (const forbidden of [
      '|| 100',
      "'Silver'",
      "'Member'",
      'metadata?.points',
      'ยินยอมแล้ว (Granted)',
      'ใช้งานปกติ (Active)',
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
