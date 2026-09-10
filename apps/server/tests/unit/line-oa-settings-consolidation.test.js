import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// @req FR-080, FR-146, FR-151 — LINE identity and transport have one Studio owner.
// @spec ADR-060, ADR-061, SDD-060
// @tested tests/unit/line-oa-settings-consolidation.test.js

const source = (path) => readFileSync(path, 'utf8')
const settings = source('src/modules/line-oa-studio/ui/LineStudioSettings.jsx')
const projects = source('src/modules/line-oa-studio/ui/LineStudioProjects.jsx')
const designHub = source('src/modules/line-oa-studio/ui/LineStudioDesignHub.jsx')
const crmMenu = source('src/modules/line-crm/LineCrmRichMenu.jsx')
const edgeConnection = source('src/modules/line-oa-studio/ui/LineStudioEdgeConnection.jsx')
const liff = source('src/modules/line-oa-studio/ui/LineStudioLiffApp.jsx')
const shell = source('src/modules/line-oa-studio/ui/LineStudioShell.jsx')
const platform = source('src/app/(pm)/platform/integrations/page.jsx')
const crmMultiOa = source('src/modules/line-crm/LineCrmMultiOa.jsx')
const domains = source('src/config/domains.js')

describe('LINE settings ownership', () => {
  it('reads canonical account state and contains no duplicate credential editor or fake save', () => {
    expect(settings).toContain('/api/line-oa/accounts?businessId=')
    expect(settings).not.toMatch(/channelSecret|channelAccessToken|setTimeout|handleSaveSettings|api\/agent\/line-webhook/)
  })

  it('uses the owner-scoped registry endpoint without synthetic groups or webhook simulation', () => {
    expect(projects).toContain('/api/platform/integrations/line-registry?businessId=')
    expect(projects).toContain('method: "POST"')
    expect(projects).toContain('businessId: business.id')
    expect(projects).not.toContain('/line-oa/integrations')
    expect(projects).not.toMatch(/grp-smartgift|dev-simulation|fakeToken|api\/agent\/line-webhook|C423a|U2962/)
  })

  it('removes the duplicate Studio Integrations navigation while retaining Platform metadata', () => {
    expect(domains).not.toContain("path: '/line-oa/integrations'")
    expect(domains).toContain("path: '/platform/integrations'")
  })

  it('routes every rich-menu entry to the canonical workspace', () => {
    expect(designHub).toContain('RichMenusWorkspace')
    expect(crmMenu).toContain('/line-oa/design-studio?tool=rich-menu')
    expect(crmMenu).not.toMatch(/publishSuccess|เผยแพร่ Rich Menu ไปยัง LINE OA สำเร็จ/)
  })

  it('drops stale Business responses and does not invent registry identity or status', () => {
    expect(shell).toContain('accountRequestVersion')
    expect(shell).toContain('requestId !== accountRequestVersion.current')
    expect(projects).toContain('status: grp.status || "UNKNOWN"')
    expect(projects).toContain('status: user.status || "UNKNOWN"')
    expect(projects).not.toMatch(/C-GROUP-ID|U-LINE-ID|new Date\(\)\.toISOString\(\)/)
  })

  it('keeps Platform model metadata on the shell Business after a context switch', () => {
    expect(platform).toContain("setTargetBusinessId(currentBusiness?.id || businesses[0]?.id || '')")
    expect(platform).not.toContain('businesses.some((business) => business.id === previous)')
  })

  it('removes the CRM multi-OA mock data and keeps CRM read-only', () => {
    expect(crmMultiOa).toContain('/api/line-oa/accounts?businessId=')
    expect(crmMultiOa).toContain('read-only')
    expect(crmMultiOa).toContain('requestVersion')
    expect(crmMultiOa).not.toContain('CONNECTED_LINE_OAS')
    expect(crmMultiOa).not.toMatch(/200xxxxxx|18,942|94\.3%|200 OK \(Verified\)/)
  })

  it('keeps the selected Design Studio tool addressable without duplicating the workspace', () => {
    expect(designHub).toContain('useRouter')
    expect(designHub).toContain('toolParam === "rich-menu"')
    expect(designHub).toContain('params.set("tool", tabId === "richmenu" ? "rich-menu" : tabId)')
  })

  it('requires provider-issued destination and an existing deployment reference', () => {
    expect(edgeConnection).toContain('!/^U[0-9a-fA-F]{32}$/.test(destination)')
    expect(edgeConnection).toContain('!/^deployment-secret:[A-Za-z0-9_-]{1,100}$/.test(secretRef)')
    expect(edgeConnection).not.toMatch(/channelSecret|channelAccessToken|Auto-generate valid destination|Auto-generate secret reference/)
  })

  it('uses the LIFF registry DTO and preserves the selected account in navigation', () => {
    expect(liff).toContain('accountId,')
    expect(liff).toContain('scopes: ["profile", "openid"]')
    expect(liff).toContain('newCode.trim()')
    expect(liff).not.toMatch(/lineOaAccountId|scopesJson|Date\.now\(\)/)
    expect(shell).toContain('accountId')
    expect(shell).toContain('router.replace')
  })
})
