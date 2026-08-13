import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rootLayout = readFileSync(resolve(process.cwd(), 'src/app/layout.jsx'), 'utf8')

describe('FR-044 route boundary', () => {
  it('keeps the root layout provider-only so EntryShell is outside BusinessShell', () => {
    expect(rootLayout).toContain('ScopeProvider')
    expect(rootLayout).not.toContain("import AppShell")
    expect(rootLayout).not.toContain('<AppShell>')
  })

  it('has a dedicated PM layout boundary for the BusinessShell', () => {
    expect(existsSync(resolve(process.cwd(), 'src/app/(pm)/layout.jsx'))).toBe(true)
  })
})
