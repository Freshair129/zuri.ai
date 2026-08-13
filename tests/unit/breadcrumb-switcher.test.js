import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const breadcrumb = readFileSync(resolve(process.cwd(), 'src/components/layouts/Breadcrumb.jsx'), 'utf8')

describe('Breadcrumb scope switcher', () => {
  it('maps only shell context back to Home', () => {
    expect(breadcrumb).toContain("href: '/', switcher: true")
  })

  it('keeps Workspace, Organization, and Business in the context trail', () => {
    expect(breadcrumb).toContain('scope.currentPortfolio')
    expect(breadcrumb).toContain('scope.currentTenant')
    expect(breadcrumb).toContain('scope.currentBusiness')
    expect(breadcrumb).toContain("eyebrow: 'Workspace'")
    expect(breadcrumb).toContain("eyebrow: 'Organization'")
    expect(breadcrumb).toContain("eyebrow: 'Business'")
  })

  it('does not elevate Space or Project to a scope switcher', () => {
    expect(breadcrumb).not.toContain("href: '/workspaces'")
    expect(breadcrumb).not.toContain("href: '/projects'")
  })
})
