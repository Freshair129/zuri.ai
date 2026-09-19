import { describe, it, expect } from 'vitest'
import { lineTraceSummary } from '@/modules/line-oa-studio/domain/line-trace-summary'
// @req FR-171, FR-150
// @spec ADR-070, SEC-001
describe('LINE operational trace summary', () => {
  it('distinguishes deadline, reply readiness and provider acceptance without rendering content', () => {
    const result = lineTraceSummary({ executionId: '10c0eacf-1e65-413a-a6c1-3f6d125cf123',
      payload: { text: 'PRIVATE QUESTION', memory: 'PRIVATE MEMORY', replyToken: 'SECRET',
        executionBudget: { deliveryMode: 'REPLY', remainingBudgetMs: 31000, answerDeadlineAt: '2026-09-17T00:00:40Z' },
        completedAt: '2026-09-17T00:00:29Z' } })
    expect(result).toContain('31000 ms')
    expect(result).toContain('11000 ms')
    expect(result).not.toMatch(/PRIVATE|SECRET|ACCEPTED/)
    expect(lineTraceSummary({ payload: { method: 'PUSH', providerOutcome: 'ACCEPTED_BY_LINE' } }))
      .toBe('DELAYED_PUSH · ACCEPTED_BY_LINE')
  })
  it('discards injected strings and invalid numeric telemetry', () => {
    expect(lineTraceSummary({ executionId: 'SECRET', payload: { method: 'PRIVATE', providerOutcome: 'SECRET',
      executionBudget: { deliveryMode: 'SECRET', remainingBudgetMs: -1, answerDeadlineAt: 'SECRET' } } })).toBe('')
  })
  it('renders only bounded model/tool lifecycle metadata', () => {
    expect(lineTraceSummary({ payload: { phase: 'MODEL_SUBMITTED', modelRef: 'openai-compatible:qwen3.5:9b',
      durationMs: 125, prompt: 'PRIVATE', toolArgs: { secret: 'SECRET' } } }))
      .toBe('MODEL_SUBMITTED · openai-compatible:qwen3.5:9b · 125 ms')
    expect(lineTraceSummary({ payload: { phase: 'PRIVATE', modelRef: 'private prompt with spaces',
      toolName: 'secret_tool', durationMs: 240001, receiptId: 'PRIVATE' } })).toBe('')
  })
})
