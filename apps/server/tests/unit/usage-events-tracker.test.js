// @req FR-248, FR-249 — recordAction() posts one ACTION beacon and never
//   throws back to its caller on a network failure; the page-view tracker
//   is wired the same way, source-asserted per this repo's established idiom
//   for UI logic with no DOM harness (tests/unit/fr059-strategy-edit-ui.test.js).
// @spec ADR-095 D2
// @tested tests/unit/usage-events-tracker.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { recordAction } from '@/modules/platform-control/components/UsagePageViewTracker'

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')
const tracker = read('src/modules/platform-control/components/UsagePageViewTracker.jsx')
const shell = read('src/components/layouts/PlatformControlShell.jsx')

describe('FR-249 recordAction()', () => {
  it('posts one ACTION beacon with the given static name, keepalive, and nothing else', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true })
    recordAction('platform_control.sign_out', fetcher)
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/api/platform/usage-events')
    expect(init.method).toBe('POST')
    expect(init.keepalive).toBe(true)
    expect(JSON.parse(init.body)).toEqual({ kind: 'ACTION', actionName: 'platform_control.sign_out' })
  })

  it('never throws back to the caller when the beacon fails — the action it describes must not be blocked by it', () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
    expect(() => recordAction('x', fetcher)).not.toThrow()
    const throwing = () => { throw new Error('no fetch') }
    expect(() => recordAction('x', throwing)).not.toThrow()
  })
})

describe('FR-248 UsagePageViewTracker', () => {
  it('fires one PAGE_VIEW beacon per pathname change, keyed on usePathname(), and renders nothing', () => {
    expect(tracker).toContain("usePathname()")
    expect(tracker).toContain("kind: 'PAGE_VIEW', route: pathname")
    // guards against firing twice for the same pathname (StrictMode double-effect, or no real navigation)
    expect(tracker).toContain('pathname === last.current')
    expect(tracker).toMatch(/return null/)
  })

  it('never imports a database or server-only module — this is a client beacon, not a write path', () => {
    expect(tracker).not.toMatch(/@\/lib\/db/)
    expect(tracker).toContain("'use client'")
  })
})

describe('FR-248, FR-249 mounted once in PlatformControlShell, not per page', () => {
  it('mounts the tracker and instruments sign-out as the first action', () => {
    expect(shell).toContain('<UsagePageViewTracker')
    expect(shell).toContain("recordAction('platform_control.sign_out')")
  })
})
