import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @tested tests/unit/platform-control-route-contract.test.js

const fromRoot = (...path) => resolve(process.cwd(), ...path)

describe('Developer Delivery Control moved-route contract', () => {
  const roadmapPath = fromRoot('src', 'app', 'roadmap', 'page.jsx')
  const controlRoadmapPath = fromRoot('src', 'app', 'control', 'roadmap', 'page.jsx')
  const noticePath = fromRoot('src', 'app', 'roadmap', 'moved-notice.jsx')
  const roadmap = readFileSync(roadmapPath, 'utf8')
  const controlRoadmap = readFileSync(controlRoadmapPath, 'utf8')
  const notice = readFileSync(noticePath, 'utf8')

  it('replaces both duplicate roadmap pages with a noindex moved notice', () => {
    expect(existsSync(fromRoot('src', 'app', '(control)', 'control', 'roadmap', 'page.jsx'))).toBe(false)
    for (const page of [roadmap, controlRoadmap]) {
      expect(page).toContain('index: false')
      expect(page).toContain('follow: false')
      expect(page).not.toMatch(/ProgramRoadmapBoard|PROGRAMME_|programme-member-view|projectDomainMap/)
    }
    expect(roadmap).toContain("renderSignedInMovedNotice('/roadmap')")
    expect(controlRoadmap).toContain("renderSignedInMovedNotice('/control/roadmap')")
  })

  it('points to the private standalone repository and local loopback dashboard', () => {
    expect(notice).toContain('https://github.com/Freshair129/zuri-delivery-control')
    expect(notice).toContain('Freshair129/zuri-delivery-control')
    expect(notice).toContain('http://127.0.0.1:4191')
    expect(notice).toMatch(/repository README to configure/i)
    expect(notice).toContain('<code>npm start</code>')
    expect(notice).not.toMatch(/task prompt|private event payload|local log/i)
  })

  it('keeps the moved notice signed-in, but does not require an Operator grant', () => {
    expect(notice).toContain('resolveRequestViewer')
    expect(notice).toContain("redirect('/login')")
    expect(notice).toContain("failure === 'SESSION_UNAVAILABLE'")
    expect(notice).not.toMatch(/isInstallationOperator|resolvePlatformControlDecision|notFound\(/)
    expect(controlRoadmap).not.toContain('PlatformControlGuard')
  })

  it('keeps control routes outside the Business DOMAINS registry', () => {
    const domains = readFileSync(fromRoot('src', 'config', 'domains.js'), 'utf8')
    expect(domains).not.toContain('/control/roadmap')
    expect(domains).not.toContain("key: 'platform-control'")
  })
})
