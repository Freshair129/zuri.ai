import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(resolve(process.cwd(), 'src/app/(entry)/waiting-room/page.jsx'), 'utf8')

// @req FR-066 — Waiting Room identifies the current session principal and
// offers a route back to the public Home without widening the people boundary.
// @spec SDD-034, ADR-027
// @tested tests/unit/waiting-room-page.test.js

describe('FR-066 Waiting Room presentation', () => {
  it('renders the current onboarding profile returned by the existing state API', () => {
    expect(page).toContain("useFetch('/api/onboarding/state')")
    expect(page).toContain('data.profile.displayName')
    expect(page).toContain('data.profile.email')
    expect(page).toContain('data.profile.phone')
    expect(page).toContain('โปรไฟล์ของผู้รอ')
    expect(page).not.toContain('/api/people')
  })

  it('offers an explicit route back to Home', () => {
    expect(page).toMatch(/<Link[^>]+href="\/"[^>]*>/)
    expect(page).toContain('กลับหน้าแรก')
  })
})
