import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const overview = readFileSync(resolve(process.cwd(), 'src/app/(pm)/overview/page.jsx'), 'utf8')

describe('Business-first Overview', () => {
  it('does not render a Group roll-up and includes strategy/domain surfaces', () => {
    expect(overview).not.toContain("scope.shell.landing === 'PORTFOLIO'")
    expect(overview).toContain('Business Strategy')
    expect(overview).toContain('Business domains')
    // @req FR-060 — the shortcut list still hides reserved domains, and now also
    // excludes Business Home itself, since this page *is* Business Home.
    expect(overview).toContain("DOMAINS.filter((domain) => !domain.soon && domain.key !== 'business-home')")
    // Business-first, but the "no Business yet" case is not this page's to own:
    // BusinessShellGuard redirects to `/businesses` before the `(pm)` layout
    // mounts anything, so the empty state this line used to pin was
    // unreachable. ADR-015: BusinessShell can assume an authorized
    // `activeBusinessId`.
    expect(overview).toContain('scope.shell.activeBusinessId')
    expect(overview).not.toContain('Choose a Business to open Overview')
    expect(overview).toContain('module-local Workspace')
  })
})
