// @req FR-091 — only backed CRM modules are reachable from customer surfaces.
// @spec SDD-050, ADR-061
// @tested tests/unit/line-crm-module-availability.test.js
import React, { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import LineCrmShell from '@/modules/line-crm/LineCrmShell'
import { LINE_CRM_MODULES, normalizeLineCrmTab } from '@/modules/line-crm/lineCrmModules'

globalThis.React = React

vi.mock('@/modules/line-crm/LineCrmLiveChat', () => ({ default: () => 'LIVE_CHAT_CHILD' }))
vi.mock('@/modules/line-crm/LineCrmMembers', () => ({ default: () => 'LIVE_MEMBERS_CHILD' }))
vi.mock('@/modules/line-crm/LineCrmMultiOa', () => ({ default: () => 'LIVE_LINE_OA_CHILD' }))
vi.mock('@/modules/line-crm/LineCrmRichMenu', () => ({ default: () => 'LIVE_RICH_MENU_CHILD' }))
vi.mock('@/modules/line-crm/LineCrmDashboard', () => ({ default: () => 'MOCK_DASHBOARD_CHILD' }))
vi.mock('@/modules/line-crm/LineCrmLoyalty', () => ({ default: () => 'MOCK_LOYALTY_CHILD' }))
vi.mock('@/modules/line-crm/LineCrmCampaigns', () => ({ default: () => 'MOCK_CAMPAIGNS_CHILD' }))
vi.mock('@/modules/line-crm/LineCrmAutomation', () => ({ default: () => 'MOCK_AUTOMATION_CHILD' }))
vi.mock('@/modules/line-crm/LineCrmAiMcp', () => ({ default: () => 'MOCK_AI_MCP_CHILD' }))
vi.mock('@/modules/line-crm/LineCrmMemberPortal', () => ({ default: () => 'MOCK_MEMBER_PORTAL_CHILD' }))
vi.mock('@/modules/line-crm/LineCrmAuditLog', () => ({ default: () => 'MOCK_AUDIT_LOG_CHILD' }))
vi.mock('@/modules/line-crm/LineCrmSettings', () => ({ default: () => 'MOCK_SETTINGS_CHILD' }))

const shellSource = readFileSync(new URL('../../src/modules/line-crm/LineCrmShell.jsx', import.meta.url), 'utf8')
const hubSource = readFileSync(new URL('../../src/modules/line-crm/LineCrmHub.jsx', import.meta.url), 'utf8')
const studioSource = readFileSync(new URL('../../src/modules/line-oa-studio/ui/LineStudioLiveCrm.jsx', import.meta.url), 'utf8')

function renderShell(initialTab) {
  return renderToStaticMarkup(createElement(LineCrmShell, { initialTab }))
}

describe('LINE CRM module availability', () => {
  it('marks exactly chat, members, LINE OA, and Rich Menu available', () => {
    expect(LINE_CRM_MODULES.every(({ available }) => typeof available === 'boolean')).toBe(true)
    expect(LINE_CRM_MODULES.map(({ id }) => id)).toEqual([
      'dashboard',
      'chat',
      'members',
      'loyalty',
      'campaigns',
      'line-oa',
      'rich-menu',
      'automation',
      'ai-mcp',
      'member-portal',
      'audit-log',
      'settings',
    ])
    expect(LINE_CRM_MODULES.filter(({ available }) => available).map(({ id }) => id)).toEqual([
      'chat',
      'members',
      'line-oa',
      'rich-menu',
    ])
  })

  it.each(['dashboard', 'loyalty', 'campaigns', 'settings', 'automation', 'ai-mcp', 'member-portal', 'audit-log', 'bogus'])(
    'renders the hub for unavailable or unknown tab %s without rendering mock modules',
    (initialTab) => {
      const html = renderShell(initialTab)

      expect(html).toContain('จัดการ LINE OA และลูกค้า')
      expect(html).not.toMatch(/MOCK_(?:DASHBOARD|LOYALTY|CAMPAIGNS|AUTOMATION|AI_MCP|MEMBER_PORTAL|AUDIT_LOG|SETTINGS)_CHILD/)
    },
  )

  it('keeps unavailable modules out of desktop navigation, mobile tabs, and hub cards', () => {
    const html = renderShell('hub')

    for (const module of LINE_CRM_MODULES.filter(({ available }) => !available)) {
      expect(html).not.toContain(module.label)
    }
    for (const id of ['LineCrmDashboard', 'LineCrmLoyalty', 'LineCrmCampaigns', 'LineCrmAutomation', 'LineCrmAiMcp', 'LineCrmMemberPortal', 'LineCrmAuditLog', 'LineCrmSettings']) {
      expect(shellSource).not.toMatch(new RegExp(`import\\s+${id}\\b`))
    }
  })

  it.each(['dashboard', 'loyalty', 'campaigns', 'settings', 'bogus'])(
    'normalizes callback destination %s to the hub',
    (moduleId) => {
      expect(normalizeLineCrmTab(moduleId)).toBe('hub')
    },
  )

  it('routes hub selections and module navigation through the availability guard', () => {
    expect(shellSource).toContain('const navigateToModule = (moduleId) => setActiveTab(normalizeLineCrmTab(moduleId))')
    expect(shellSource).toContain('<LineCrmHub onSelectModule={navigateToModule} />')
    expect(shellSource).toContain('<ActiveModule onNavigate={navigateToModule} />')
    expect(hubSource).toContain('onSelectModule?.(normalizeLineCrmTab(moduleId))')
  })

  it('removes fabricated shell badges and the no-op AI MCP toggle', () => {
    expect(shellSource).not.toMatch(/badge\s*:\s*['"]12['"]|>\s*12\s*</)
    expect(shellSource).not.toContain('AI MCP Active')
    expect(shellSource).not.toContain('aiMcpActive')
  })

  it('does not expose loyalty or campaigns in LINE Studio Live CRM', () => {
    expect(studioSource).not.toMatch(/import\s+LineCrmLoyalty\b/)
    expect(studioSource).not.toMatch(/import\s+LineCrmCampaigns\b/)
  })
})
