import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { DOMAINS, domainForPath } from '@/config/domains'
import { isSupabaseVaultSecretRef } from '@/platform/integrations/core/secret-manager'

// @req FR-080 — Integration metadata has a Platform route and never exposes a
// browser-side raw-secret input or activation control.
// @spec ADR-032 D1/D2/D4, SDD-044, SEC-016, NFR-008
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

  it('renders the AC-075.3 health state with the reasons behind it', () => {
    const source = page()
    // a pill alone tells an operator something is wrong without telling them what
    // to fix — which is why `reasons` is a list and is rendered
    expect(source).toContain('row.health')
    expect(source).toMatch(/reasons\.map/)
    expect(source).toMatch(/StatusPill status=\{state\}/)
    // the channel's most actionable fact is when it was last heard from
    expect(source).toMatch(/lastEventAt/)
  })

  it('keeps channel rows read-only — provisioning is not a UI action', () => {
    const source = page()
    // the create form stays fixed to the Phase 1 model provider; a channel must not
    // gain an edit/activate affordance here (AC-075.6)
    expect(source).toMatch(/isChannel/)
    expect(source).not.toMatch(/editChannel|createChannel|activateChannel/i)
  })

  it('keeps the API behind the trusted viewer route boundary', () => {
    const route = readFileSync('src/app/api/platform/integrations/route.js', 'utf8')
    expect(route).toContain('resolveRequestViewer')
    expect(route).toContain('listPhase1Integrations')
    expect(route).toContain('createPhase1Integration')
    expect(route).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/i)
  })

  describe('Supabase Vault reference field — client-visible invalid state (NFR-008)', () => {
    // A field that warns "not an API key, only supabase-vault:<uuid>" and then
    // says nothing when a user pastes something else is not a warning. These
    // checks pin the moment-of-breach feedback: an aria-invalid input plus an
    // associated, announced Thai message — the same shape rendered value/error
    // already uses elsewhere on this page (message/error `role` blocks above).

    it('imports the exact predicate the API/service enforce, rather than re-declaring the pattern client-side', () => {
      const source = page()
      expect(source).toContain("import { isSupabaseVaultSecretRef } from '@/platform/integrations/core/secret-manager'")
      const service = readFileSync('src/modules/integration/application/integration-management-service.js', 'utf8')
      expect(service).toContain("import { isSupabaseVaultSecretRef } from '@/platform/integrations/core/secret-manager'")
    })

    it('treats a live-looking secret and any other malformed text as invalid, empty and a real reference as valid', () => {
      // The exact scenario from the walkthrough: a value shaped like a live
      // secret must be rejected by the same predicate the server uses.
      expect(isSupabaseVaultSecretRef('sk-live-abcdef1234567890')).toBe(false)
      expect(isSupabaseVaultSecretRef('not-a-reference')).toBe(false)
      expect(isSupabaseVaultSecretRef('supabase-vault:not-a-uuid')).toBe(false)
      expect(isSupabaseVaultSecretRef('supabase-vault:3b1f2a5e-6c7d-4e8f-9a0b-1c2d3e4f5a6b')).toBe(true)
    })

    it('marks the field aria-invalid and associates an announced Thai message only when the trimmed value is non-empty and malformed', () => {
      const source = page()
      expect(source).toContain('const secretRefTrimmed = secretRef.trim()')
      expect(source).toContain('const secretRefInvalid = secretRefTrimmed.length > 0 && !isSupabaseVaultSecretRef(secretRefTrimmed)')
      expect(source).toContain('aria-invalid={secretRefInvalid}')
      expect(source).toContain('aria-describedby={secretRefInvalid ? SECRET_REF_ERROR_ID : undefined}')
      expect(source).toMatch(/id=\{SECRET_REF_ERROR_ID\}\s+role="alert"/)
      // Thai copy, matching the surrounding page's language.
      expect(source).toMatch(/SECRET_REF_ERROR_TEXT = '[^']*supabase-vault:<uuid>[^']*'/)
    })

    it('never echoes the entered value into the error message — only the fixed copy string is rendered', () => {
      const source = page()
      // The error text is a single fixed constant; the field's live `secretRef`
      // value must never appear inside the message JSX itself.
      const errorBlockMatch = source.match(/\{secretRefInvalid && \(([\s\S]*?)\)\}/)
      expect(errorBlockMatch).toBeTruthy()
      expect(errorBlockMatch[1]).not.toMatch(/\{secretRef\b/)
      expect(errorBlockMatch[1]).toContain('SECRET_REF_ERROR_TEXT')
    })

    it('disables submit while invalid and also short-circuits submit as a second line of defence — never the only check', () => {
      const source = page()
      expect(source).toMatch(/disabled=\{busy \|\| !businessId \|\| !name\.trim\(\) \|\| !model\.trim\(\) \|\| secretRefInvalid\}/)
      expect(source).toContain('if (secretRefInvalid) return')
      // The service-side shape check must still exist — client validation is a
      // courtesy, never the sole authority (ADR-032 D2).
      const service = readFileSync('src/modules/integration/application/integration-management-service.js', 'utf8')
      expect(service).toContain('SECRET_REF_MUST_BE_SUPABASE_VAULT_OPAQUE_REFERENCE')
    })
  })
})
