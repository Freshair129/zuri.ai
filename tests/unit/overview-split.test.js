import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const overview = readFileSync(resolve(process.cwd(), 'src/app/(pm)/overview/page.jsx'), 'utf8')

describe('Business-first Overview', () => {
  it('does not render a Group roll-up and includes strategy/domain surfaces', () => {
    expect(overview).not.toContain("scope.shell.landing === 'PORTFOLIO'")
    expect(overview).toContain('Business Strategy')
    expect(overview).toContain('Business domains')
    expect(overview).toContain('DOMAINS.filter((domain) => !domain.soon)')
    expect(overview).toContain('Choose a Business to open Overview')
    expect(overview).toContain('module-local Workspace')
  })
})
