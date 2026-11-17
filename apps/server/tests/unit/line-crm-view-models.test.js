// @req FR-091, FR-103 — LINE CRM views use recorded CRM and Integration values.
// @spec SDD-050, SEC-005, BR-001, FR-127
// @tested tests/unit/line-crm-view-models.test.js
import { describe, expect, it, vi } from 'vitest'
import { CUSTOMER_CONSENT_STATUSES } from '@/lib/validation/enums'
import {
  buildCustomerRows,
  buildRegistryRows,
  formatDateTime,
  getConsentLabel,
  loadRecordedAnalysis,
  selectionFor,
} from '@/modules/line-crm/lineCrmViewModels'

describe('LINE CRM recorded-value view models', () => {
  it('formats a recorded timestamp with both its date and time', () => {
    const formatted = formatDateTime('2026-11-10T08:30:00.000Z')

    expect(formatted).toMatch(/10 พ\.ย\. 2569/)
    expect(formatted).toMatch(/\d{1,2}:\d{2}/)
  })

  it('shows a selected member only for the Business that owns the selection', () => {
    const member = { id: 'member-1' }

    expect(selectionFor('biz-1', { businessId: 'biz-1', member })).toBe(member)
    expect(selectionFor('biz-2', { businessId: 'biz-1', member })).toBeNull()
    expect(selectionFor(null, { businessId: 'biz-1', member })).toBeNull()
    expect(selectionFor('biz-1', null)).toBeNull()
    expect(selectionFor('biz-1', undefined)).toBeNull()
    expect(selectionFor('biz-1', { member })).toBeNull()
  })

  it('labels every recorded consent status and leaves unknown values unknown', () => {
    for (const status of CUSTOMER_CONSENT_STATUSES) {
      expect(getConsentLabel(status)).toBeTruthy()
    }

    for (const status of CUSTOMER_CONSENT_STATUSES) {
      expect(getConsentLabel(status) === 'ยืนยัน consent แล้ว').toBe(status === 'GRANTED')
    }
    expect(getConsentLabel(undefined)).toBe('ไม่ทราบสถานะ')
    expect(getConsentLabel(null)).toBe('ไม่ทราบสถานะ')
    expect(getConsentLabel('UNRECOGNIZED')).toBe('ไม่ทราบสถานะ')
  })

  it('groups conversations by recorded Customer id without adding loyalty or contact fields', () => {
    const rows = buildCustomerRows([
      {
        id: 'conversation-1',
        channel: 'LINE',
        customer: {
          id: 'customer-1',
          code: 'CUS-001',
          displayName: 'Recorded Name',
          lifecycleStage: 'LEAD',
          consentStatus: 'PENDING',
          consentRecordedAt: '2026-11-10T08:00:00.000Z',
        },
        lastMessage: { createdAt: '2026-11-10T08:15:00.000Z' },
      },
      {
        id: 'conversation-2',
        channel: 'FACEBOOK',
        customer: {
          id: 'customer-1',
          code: 'CUS-001',
          displayName: 'Recorded Name',
          lifecycleStage: 'LEAD',
          consentStatus: 'PENDING',
          consentRecordedAt: '2026-11-10T08:00:00.000Z',
        },
        lastMessage: { createdAt: '2026-11-10T09:15:00.000Z' },
      },
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      displayName: 'Recorded Name',
      code: 'CUS-001',
      lifecycleStage: 'LEAD',
      consentStatus: 'PENDING',
      conversationCount: 2,
      channels: ['LINE', 'FACEBOOK'],
      lastMessageAt: '2026-11-10T09:15:00.000Z',
    })
    for (const key of ['points', 'tier', 'spend', 'orders', 'phone', 'email']) {
      expect(rows[0]).not.toHaveProperty(key)
    }
  })

  it('uses explicit unknown text for missing customer name and lifecycle stage', () => {
    const [row] = buildCustomerRows([{
      id: 'conversation-unknown',
      customer: { id: 'customer-unknown', consentStatus: 'NOT_A_STATUS' },
      lastMessage: null,
    }])

    expect(row.displayName).toBe('ไม่ระบุชื่อ')
    expect(row.lifecycleStage).toBe('ไม่ทราบ')
    expect(row.consentLabel).toBe('ไม่ทราบสถานะ')
    expect(row.lastMessageAt).toBeNull()
  })

  it('keeps registry values optional and marks its consent as unavailable', () => {
    const [row] = buildRegistryRows([{
      id: 'registration-1',
      kind: 'USER',
      name: 'Registered LINE User',
      externalAccountId: 'U123',
      status: 'ACTIVE',
      role: 'SECONDARY',
      metadata: {},
    }])

    expect(row).toMatchObject({
      name: 'Registered LINE User',
      externalAccountId: 'U123',
      status: 'ACTIVE',
      consentLabel: 'ไม่มีข้อมูล',
    })
    expect(row.role).toBeUndefined()
    expect(row.department).toBeUndefined()
    expect(row.phone).toBeUndefined()
    expect(row.createdAt).toBeUndefined()
  })

  it('uses recorded person role and phone from metadata, not the connection role', () => {
    const [row] = buildRegistryRows([{
      id: 'registration-2',
      kind: 'USER',
      role: 'SECONDARY',
      metadata: { role: 'SALES_REP', department: 'Sales', phone: '0812345678' },
    }])

    expect(row.role).toBe('SALES_REP')
    expect(row.role).not.toBe('SECONDARY')
    expect(row.department).toBe('Sales')
    expect(row.phone).toBe('0812345678')
  })
})

describe('LINE CRM recorded conversation analysis', () => {
  const request = vi.fn()

  it('blocks analysis without granted consent and makes no request', async () => {
    request.mockClear()
    const result = await loadRecordedAnalysis({
      request,
      businessId: 'business-1',
      conversationId: 'conversation-1',
      consentStatus: 'PENDING',
    })

    expect(result.state).toBe('CONSENT_BLOCKED')
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects an analysis payload for a different conversation', async () => {
    request.mockResolvedValue({ conversationId: 'conversation-2', analyses: [] })
    const result = await loadRecordedAnalysis({
      request,
      businessId: 'business-1',
      conversationId: 'conversation-1',
      consentStatus: 'GRANTED',
    })

    expect(result.state).toBe('ERROR')
  })

  it('returns EMPTY when the recorded analysis list is empty', async () => {
    request.mockResolvedValue({ conversationId: 'conversation-1', analyses: [] })
    const result = await loadRecordedAnalysis({
      request,
      businessId: 'business-1',
      conversationId: 'conversation-1',
      consentStatus: 'GRANTED',
    })

    expect(result.state).toBe('EMPTY')
  })

  it('returns the newest recorded analysis', async () => {
    const newest = { id: 'analysis-new', analyzedAt: '2026-11-11T12:00:00.000Z', summary: 'Newest' }
    request.mockResolvedValue({
      conversationId: 'conversation-1',
      analyses: [
        { id: 'analysis-old', analyzedAt: '2026-11-10T12:00:00.000Z', summary: 'Oldest' },
        newest,
      ],
    })
    const result = await loadRecordedAnalysis({
      request,
      businessId: 'business-1',
      conversationId: 'conversation-1',
      consentStatus: 'GRANTED',
    })

    expect(result).toEqual({ state: 'READY', analysis: newest })
  })
})
