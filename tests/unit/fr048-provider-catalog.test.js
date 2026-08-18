import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { PUBLIC_LINE_PROVIDERS } from '@/modules/agent/model-provider'
import { LLM_PROVIDER_CATALOG, LLM_PROVIDER_KEYS, providerByKey } from '@/platform/integrations/llm/provider-catalog'

// @req FR-048 — one allow-list, shared. The Platform page may not offer a
// provider the port would reject, nor hide one it accepts.
// @spec SDD-025, SEC-009
// @tested tests/unit/fr048-provider-catalog.test.js

describe('FR-048 LLM provider catalog', () => {
  it('covers exactly the provider port allow-list, in its order', () => {
    expect(LLM_PROVIDER_KEYS).toEqual([...PUBLIC_LINE_PROVIDERS])
  })

  it('gives every provider a display name and a model hint', () => {
    for (const provider of LLM_PROVIDER_CATALOG) {
      expect(provider.name, `${provider.key} needs a name`).toBeTruthy()
      expect(provider.modelHint, `${provider.key} needs a model hint`).toBeTruthy()
    }
  })

  it('never exposes a local evaluation provider to the public surface', () => {
    // Ollama is local/dev/test only (integration CHARTER). Offering it in a
    // Business-facing form is how it would reach a production connection.
    expect(LLM_PROVIDER_KEYS).not.toContain('ollama')
  })

  it('resolves a known key and refuses an unknown one', () => {
    expect(providerByKey('openrouter')).toMatchObject({ key: 'openrouter', name: 'OpenRouter' })
    expect(providerByKey('no-such-provider')).toBeNull()
  })

  it('leaves no hand-copied provider list in the Platform page', () => {
    // The control for this whole module: if the page grows its own array again,
    // the catalog stops being the single source and this test says so.
    const page = readFileSync('src/app/(pm)/platform/integrations/page.jsx', 'utf8')
    expect(page).toContain('LLM_PROVIDER_CATALOG')
    expect(page).not.toMatch(/\[\s*'openrouter'\s*,/)
  })
})
