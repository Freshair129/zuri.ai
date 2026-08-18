import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { DOMAINS, domainForPath } from '@/config/domains'

// @req FR-080 — Integration metadata has a Platform route and never exposes a
// browser-side raw-secret input or activation control.
// @spec ADR-032 D1/D2/D4, SDD-044, SEC-016
// @tested tests/unit/fr080-ui-contract.test.js

describe('FR-080 Platform Integrations UI contract', () => {
  const page = () => readFileSync('src/app/(pm)/platform/integrations/page.jsx', 'utf8')

  it('registers Integrations under Platform and resolves the route there', () => {
    const platform = DOMAINS.find((domain) => domain.key === 'platform')
    expect(platform.sub).toContainEqual(expect.objectContaining({ label: 'Integrations', path: '/platform/integrations' }))
    expect(domainForPath('/platform/integrations').key).toBe('platform')
  })

  it('uses the metadata API and does not render a raw secret field', () => {
    const source = page()
    expect(source).toContain('/api/platform/integrations')
    expect(source).toContain('supabase-vault:')
    expect(source).toMatch(/Vault|Secret Manager/i)
    expect(source).not.toMatch(/type=["']password["']/i)
    expect(source).not.toMatch(/secretValue|apiKey|accessToken|rawSecret/i)
    expect(source).not.toMatch(/promote|activate|canary|ACCEPTED_BY_LINE/i)
  })

  it('keeps the API behind the trusted viewer route boundary', () => {
    const route = readFileSync('src/app/api/platform/integrations/route.js', 'utf8')
    expect(route).toContain('resolveRequestViewer')
    expect(route).toContain('listPhase1Integrations')
    expect(route).toContain('createPhase1Integration')
    expect(route).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/i)
  })
})
