// @req FR-143 — which provider extracts, and why.
// @spec ADR-059 D5
// @tested tests/unit/asset-extraction-provider.test.js
import { describe, expect, it } from 'vitest'
import {
  ASSET_EXTRACTION_PROVIDERS,
  decideExtractionProvider,
  parseConfiguredProvider,
  resolveExtractionProvider,
} from '@/modules/asset-management/application/asset-extraction-provider'

describe('asset extraction provider selection (FR-143, ADR-059 D5)', () => {
  it('reads an explicit provider, case- and space-insensitively', () => {
    expect(parseConfiguredProvider({ ZURI_ASSET_EVIDENCE_PROVIDER: ' Edge ' })).toBe('edge')
    expect(parseConfiguredProvider({ ZURI_ASSET_EVIDENCE_PROVIDER: 'openai' })).toBe('openai')
    expect(parseConfiguredProvider({})).toBeNull()
    expect(parseConfiguredProvider({ ZURI_ASSET_EVIDENCE_PROVIDER: '' })).toBeNull()
  })

  it('refuses an unknown provider name instead of falling back to one', () => {
    // A typo must stop the request, not silently route work to the other
    // provider — an operator who names a provider is making a decision.
    expect(() => parseConfiguredProvider({ ZURI_ASSET_EVIDENCE_PROVIDER: 'ollama' })).toThrow(/must be one of/)
    expect(ASSET_EXTRACTION_PROVIDERS).toEqual(['openai', 'edge'])
  })

  it('lets an explicit value win over what is available', () => {
    expect(decideExtractionProvider({ configured: 'openai', hasOpenAiKey: false, hasActiveEdgeDevice: true })).toBe('openai')
    expect(decideExtractionProvider({ configured: 'edge', hasOpenAiKey: true, hasActiveEdgeDevice: false })).toBe('edge')
  })

  it('falls back to the edge only when the cloud provider cannot run and a device is paired', () => {
    expect(decideExtractionProvider({ hasOpenAiKey: false, hasActiveEdgeDevice: true })).toBe('edge')
    // No key and no device: stay on openai so the caller gets FR-138's honest
    // 503 "OpenAI API key is not configured" instead of a job nothing will claim.
    expect(decideExtractionProvider({ hasOpenAiKey: false, hasActiveEdgeDevice: false })).toBe('openai')
    // A configured key keeps the pre-existing behaviour for an installation that
    // has paired a device but not decided to use it.
    expect(decideExtractionProvider({ hasOpenAiKey: true, hasActiveEdgeDevice: true })).toBe('openai')
  })

  it('does not query for devices when the cloud key is present', async () => {
    let queried = 0
    const db = { edgeDeviceCredential: { findFirst: async () => { queried += 1; return { id: 'x' } } } }
    const provider = await resolveExtractionProvider({ businessId: 'BUS', db, env: { OPENAI_API_KEY: 'sk-test' } })
    expect(provider).toBe('openai')
    expect(queried).toBe(0)
  })

  it('asks for an ACTIVE credential of that Business only', async () => {
    const seen = []
    const db = { edgeDeviceCredential: { findFirst: async (args) => { seen.push(args.where); return { id: 'cred' } } } }
    const provider = await resolveExtractionProvider({ businessId: 'BUS-1', db, env: {} })
    expect(provider).toBe('edge')
    expect(seen).toEqual([{ businessId: 'BUS-1', status: 'ACTIVE' }])
  })
})
