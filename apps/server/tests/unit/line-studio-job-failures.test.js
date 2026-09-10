// @req FR-149 — the component that turns the FAILED-job read model into the
//   red count on screen.
// @spec ADR-061
// @tested this file
//
// This repo's render-based UI test harness (tests/unit/sot-pipeline-scope-render.test.js,
// tests/unit/market-intelligence/market-dashboard-render.test.js) renders with
// react-dom/server's renderToStaticMarkup, which never runs effects. The
// default export still fetches inside a `useEffect` (LineStudioEdgeConnection's
// own convention, copied verbatim), so it stays covered only for the one state
// reachable without an effect running at all: no active Business. Everything
// the effect would otherwise hide — whether the red count, its errorCode
// breakdown, and the recent-failures table actually render — is proven
// directly against the pure `LineStudioJobFailuresCard` export instead, the
// same renderToStaticMarkup style as sot-pipeline-scope-render.test.js.

import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

globalThis.React = React

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

const { ScopeProvider } = await import('@/context/ScopeContext')
const { sampleInventory } = await import('../factories/scope-context')
const LineStudioJobFailuresModule = await import('@/modules/line-oa-studio/ui/LineStudioJobFailures')
const {
  default: LineStudioJobFailures,
  LineStudioJobFailuresCard,
  shortJobId,
  formatErrorCodeLabel,
  formatJobTime,
  formatFailureHeadline,
} = LineStudioJobFailuresModule

describe('formatting helpers (the component logic that does not need a browser)', () => {
  it('shortJobId keeps only the first 8 characters, never the full LINE-adjacent id', () => {
    expect(shortJobId('12345678-abcd-ef00-0000-000000000000')).toBe('12345678')
    expect(shortJobId('')).toBe('')
    expect(shortJobId(undefined)).toBe('')
    expect(shortJobId(null)).toBe('')
  })

  it('formatErrorCodeLabel reports a real errorCode verbatim', () => {
    expect(formatErrorCodeLabel('LOCAL_POLICY_UNAVAILABLE')).toBe('LOCAL_POLICY_UNAVAILABLE')
    expect(formatErrorCodeLabel('EXECUTION_EXPIRED')).toBe('EXECUTION_EXPIRED')
  })

  it('formatErrorCodeLabel labels a null/empty errorCode honestly, never as an invented telemetry value', () => {
    expect(formatErrorCodeLabel(null)).not.toMatch(/unknown/i)
    expect(formatErrorCodeLabel(null)).toBeTruthy()
    expect(formatErrorCodeLabel(undefined)).toBe(formatErrorCodeLabel(null))
    expect(formatErrorCodeLabel('')).toBe(formatErrorCodeLabel(null))
  })

  it('formatJobTime renders a real timestamp and degrades safely on a bad one', () => {
    expect(formatJobTime(new Date('2026-09-07T10:00:00Z').toISOString())).not.toBe('')
    expect(formatJobTime(null)).toBe('')
    expect(formatJobTime(undefined)).toBe('')
    expect(formatJobTime('not-a-date')).toBe('')
  })

  it('formatFailureHeadline carries the exact count, never a rounded or bucketed one', () => {
    expect(formatFailureHeadline(4)).toContain('4')
    expect(formatFailureHeadline(0)).toContain('0')
    expect(formatFailureHeadline(1234)).toContain('1234')
  })
})

describe('LineStudioJobFailures — the one state reachable without a browser', () => {
  it('renders nothing when there is no active Business (no fetch, no effect needed to see this)', () => {
    const html = renderToStaticMarkup(
      createElement(
        ScopeProvider,
        { inventory: sampleInventory(), selection: {} },
        createElement(LineStudioJobFailures),
      ),
    )
    expect(html).toBe('')
  })
})

describe('LineStudioJobFailuresCard — the pure render, proven with renderToStaticMarkup', () => {
  it('the red state renders the truth: exact count, both error codes, alert/status roles, rose styling', () => {
    const summary = {
      total: 4,
      byErrorCode: [
        { errorCode: 'LOCAL_POLICY_UNAVAILABLE', count: 3 },
        { errorCode: 'EXECUTION_EXPIRED', count: 1 },
      ],
      failures: [
        { id: 'job-aaaaaaaa-0001', updatedAt: '2026-09-07T10:00:00Z', errorCode: 'LOCAL_POLICY_UNAVAILABLE', executionMode: 'EDGE' },
        { id: 'job-bbbbbbbb-0002', updatedAt: '2026-09-07T11:00:00Z', errorCode: 'EXECUTION_EXPIRED', executionMode: 'CLOUD' },
      ],
    }
    const html = renderToStaticMarkup(createElement(LineStudioJobFailuresCard, { summary }))

    expect(html).toContain('4')
    expect(html).toContain('LOCAL_POLICY_UNAVAILABLE')
    expect(html).toContain('EXECUTION_EXPIRED')
    expect(html).toContain('role="alert"')
    expect(html).toContain('role="status"')
    expect(html).toMatch(/rose-/)
    expect(html).not.toContain('ยังไม่มีข้อความที่ส่งไม่สำเร็จสำหรับ Business นี้')
  })

  it('zero renders honestly and is not red', () => {
    const summary = { total: 0, byErrorCode: [], failures: [] }
    const html = renderToStaticMarkup(createElement(LineStudioJobFailuresCard, { summary }))

    expect(html).toContain('ยังไม่มีข้อความที่ส่งไม่สำเร็จสำหรับ Business นี้')
    expect(html).not.toContain('role="alert"')
    expect(html).not.toMatch(/bg-rose-/)
  })

  it('a null errorCode is not invented as UNKNOWN or null', () => {
    const summary = {
      total: 2,
      byErrorCode: [{ errorCode: null, count: 2 }],
      failures: [],
    }
    const html = renderToStaticMarkup(createElement(LineStudioJobFailuresCard, { summary }))

    expect(html).not.toMatch(/UNKNOWN/)
    expect(html).not.toMatch(/>null</)
    expect(html).toContain(formatErrorCodeLabel(null))
  })

  it('never leaks sensitive fields or the full job id, even when the row defensively carries them', () => {
    const fullId = 'job-cccccccc-full-id-should-not-appear'
    const summary = {
      total: 1,
      byErrorCode: [{ errorCode: 'LOCAL_POLICY_UNAVAILABLE', count: 1 }],
      failures: [
        {
          id: fullId,
          updatedAt: '2026-09-07T10:00:00Z',
          errorCode: 'LOCAL_POLICY_UNAVAILABLE',
          executionMode: 'EDGE',
          answerText: 'a private reply the customer received',
          recipientId: 'U-secret-recipient',
          sourceUserId: 'U-secret-source',
          sealedReplyToken: 'reply-token-should-never-render',
        },
      ],
    }
    const html = renderToStaticMarkup(createElement(LineStudioJobFailuresCard, { summary }))

    expect(html).not.toContain(fullId)
    expect(html).not.toContain('a private reply the customer received')
    expect(html).not.toContain('U-secret-recipient')
    expect(html).not.toContain('U-secret-source')
    expect(html).not.toContain('reply-token-should-never-render')
    expect(html).toContain(shortJobId(fullId))
  })

  it('the loading state renders its own branch, not the card', () => {
    const html = renderToStaticMarkup(createElement(LineStudioJobFailuresCard, { loading: true, summary: null }))

    expect(html).toContain('กำลังตรวจสอบข้อความที่ส่งไม่สำเร็จ')
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('ยังไม่มีข้อความที่ส่งไม่สำเร็จสำหรับ Business นี้')
  })

  it('the error state renders its own branch, not the card', () => {
    const html = renderToStaticMarkup(
      createElement(LineStudioJobFailuresCard, { error: 'Request failed', summary: null }),
    )

    expect(html).toContain('Request failed')
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('กำลังตรวจสอบข้อความที่ส่งไม่สำเร็จ')
  })
})
