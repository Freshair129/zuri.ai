import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { zLineOaAccountAction } from '@/modules/line-oa-studio/domain/line-oa-account'
import { LINE_OA_ACCOUNT_ACTIONS } from '@/lib/validation/enums'
import { SESSION_CODE_PATTERN } from '@/modules/line-oa-studio/application/line-conversation-jobs'

// @req FR-243 — what the two surfaces promise about sessions (TASK-ZAI-107): the inbox
//   draws a divider only where the session changes, the LINE studio sets the idle
//   timeout through the versioned action and filters the job list by session code
//   with each job's trace, and the schema bounds the timeout to 10–120 minutes.
// @spec ADR-094 D3, D4
// @tested tests/unit/conversation-session-ui.test.js

const inboxPage = () => readFileSync('src/app/(pm)/customer/conversations/page.jsx', 'utf8')
const studio = () => readFileSync('src/modules/line-oa-studio/ui/LineStudioAccountConsole.jsx', 'utf8')

describe('inbox session divider', () => {
  it('opens a divider only when a message has a session different from the one before it', () => {
    const source = inboxPage()
    expect(source).toMatch(/Boolean\(message\.sessionId\) && message\.sessionId !== messages\[index - 1\]\?\.sessionId/)
    expect(source).toContain('role="separator"')
    expect(source).toContain('session {message.sessionCode} · เริ่ม {timeOf(message.sessionOpenedAt || message.createdAt)}')
  })

  it('still offers no reply control', () => {
    expect(inboxPage()).not.toMatch(/method:\s*['"]POST['"][^\n]*reply/i)
  })
})

describe('LINE studio session controls', () => {
  it('saves the idle timeout through CONFIGURE_SESSION_TIMEOUT only when it is a whole number from 10 to 120', () => {
    const source = studio()
    expect(source).toContain('action: "CONFIGURE_SESSION_TIMEOUT", sessionIdleTimeoutMinutes: timeoutMinutes')
    expect(source).toMatch(/Number\.isInteger\(timeoutMinutes\) && timeoutMinutes >= 10 && timeoutMinutes <= 120/)
    expect(source).toContain('min={10}')
    expect(source).toContain('max={120}')
  })

  it('filters the job list by session code and opens each job\'s trace from the existing trace route', () => {
    const source = studio()
    expect(source).toContain('`/api/line-oa/accounts/${account.id}/jobs${query}`')
    expect(source).toContain('?session=${encodeURIComponent(code.trim().toUpperCase())}')
    expect(source).toContain('`/api/line-oa/jobs/${job.id}/trace`')
    expect(source).toContain('{job.sessionCode || "—"}')
  })
})

describe('session timeout action schema', () => {
  const parse = (value) => zLineOaAccountAction.safeParse({ action: 'CONFIGURE_SESSION_TIMEOUT', version: 1, ...value })

  it('is a declared account action', () => {
    expect(LINE_OA_ACCOUNT_ACTIONS).toContain('CONFIGURE_SESSION_TIMEOUT')
  })

  it('accepts 10 and 120 and refuses 9, 121, a fraction and a missing value', () => {
    expect(parse({ sessionIdleTimeoutMinutes: 10 }).success).toBe(true)
    expect(parse({ sessionIdleTimeoutMinutes: 120 }).success).toBe(true)
    for (const sessionIdleTimeoutMinutes of [9, 121, 30.5]) expect(parse({ sessionIdleTimeoutMinutes }).success).toBe(false)
    expect(parse({}).success).toBe(false)
  })

  it('matches the session code format the service writes', () => {
    expect(SESSION_CODE_PATTERN.test('S-20260916-7K2Q9A')).toBe(true)
    expect(SESSION_CODE_PATTERN.test('S-2026-bad')).toBe(false)
  })
})
