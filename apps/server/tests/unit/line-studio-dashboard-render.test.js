// @req FR-146 — the LINE OA Dashboard renders without an unsupported group count.
// @spec SDD-060
// @tested tests/unit/line-studio-dashboard-render.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import LineStudioDashboard from '@/modules/line-oa-studio/ui/LineStudioDashboard'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'

globalThis.React = React

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

describe('LINE OA Dashboard rendering', () => {
  it('marks the group count as unavailable before data arrives', () => {
    const html = renderToStaticMarkup(createElement(
      ScopeProvider,
      { inventory: sampleInventory(), selection: { businessId: 'biz-1' } },
      createElement(LineStudioDashboard),
    ))
    expect(html).toContain('กลุ่มแชท LINE ในระบบ')
    expect(html).toMatch(/>\s*—\s*<\/span>/)
    expect(html).toContain('ยังไม่มีข้อมูลจำนวนกลุ่ม')
    expect(html).not.toContain('Group ID Active')
  })
})
