import { describe, expect, it } from 'vitest'

import {
  CONNECTOR_CATALOG,
  CONNECTOR_NOT_CONNECTED,
  CONNECTOR_REASONS,
  CONNECTOR_STATES,
  deriveConnectorCatalog,
  deriveConnectorStatus,
} from '@/platform/integrations/core/connector-catalog'
import { LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { PUBLIC_LINE_PROVIDERS } from '@/modules/agent/model-provider'

// @req FR-080 — the connectors catalog is a read model over connection evidence.
// @req FR-130 — the tile that said CONNECTED while nothing connected.
// @spec docs/domains/integration/features/FR-130-github-repository-projection.md
// @tested tests/unit/platform/connector-catalog.test.js

const entry = (id) => CONNECTOR_CATALOG.find((item) => item.id === id)

const connection = (provider, state, reasons = []) => ({
  id: `conn-${provider}-${state}`,
  provider,
  health: { state, reasons, evidence: {} },
})

describe('FR-130 connector catalog states what the evidence supports', () => {
  it('declares no literal status anywhere in the catalog', () => {
    // The defect this closes was one word in a data literal. A catalog entry
    // must not be able to carry a state at all — deriving it correctly today
    // does not stop somebody adding `status: 'CONNECTED'` back tomorrow.
    for (const item of CONNECTOR_CATALOG) {
      expect(item).not.toHaveProperty('status')
      expect(item).not.toHaveProperty('state')
      expect(Array.isArray(item.providerCodes)).toBe(true)
    }
  })

  it('only names provider codes this system can actually register a connection for', () => {
    // The guard against faking green a second time: `providerCodes: ['github']`
    // would make the GitHub tile derivable-looking while no GitHub provider
    // exists, so the list is checked against the two real sources of provider
    // codes rather than against itself.
    const known = new Set([LINE_OA_PROVIDER_CODE, ...PUBLIC_LINE_PROVIDERS].map((code) => code.toLowerCase()))
    for (const item of CONNECTOR_CATALOG) {
      for (const code of item.providerCodes) {
        expect(known, `${item.id} names an unknown provider code ${code}`).toContain(code.toLowerCase())
      }
    }
  })

  it('reports GitHub as not connected, because no connector for it exists', () => {
    const github = entry('github')
    expect(github.providerCodes).toEqual([])
    expect(deriveConnectorStatus(github, [])).toEqual({
      state: CONNECTOR_NOT_CONNECTED,
      reasons: [CONNECTOR_REASONS.CONNECTOR_NOT_IMPLEMENTED],
      connectionCount: 0,
    })
  })

  it('keeps GitHub not connected even when unrelated connections are healthy', () => {
    // The previous literal was green regardless of the world. This asserts the
    // opposite property: a page full of working connections still cannot make
    // this tile claim one.
    const rows = [
      connection(LINE_OA_PROVIDER_CODE, 'CONNECTED'),
      connection('openrouter', 'CONNECTED'),
    ]
    expect(deriveConnectorStatus(entry('github'), rows).state).toBe(CONNECTOR_NOT_CONNECTED)
    expect(deriveConnectorStatus(entry('vercel-webhook'), rows).state).toBe(CONNECTOR_NOT_CONNECTED)
  })

  it('separates "nothing to connect" from "nothing configured yet"', () => {
    expect(deriveConnectorStatus(entry('slack'), []).reasons)
      .toEqual([CONNECTOR_REASONS.CONNECTOR_NOT_IMPLEMENTED])
    expect(deriveConnectorStatus(entry('openrouter'), []).reasons)
      .toEqual([CONNECTOR_REASONS.NO_CONNECTION_RECORDED])
  })

  it('carries a connectable connector state through from its connection health', () => {
    const rows = [connection('openrouter', 'MISCONFIGURED', ['MISSING_SECRET_REF'])]
    expect(deriveConnectorStatus(entry('openrouter'), rows)).toEqual({
      state: 'MISCONFIGURED',
      reasons: ['MISSING_SECRET_REF'],
      connectionCount: 1,
    })
  })

  it('matches the LINE channel on its provider code case-insensitively', () => {
    const rows = [connection('line_oa', 'DEGRADED', ['NO_TRAFFIC_OBSERVED'])]
    expect(deriveConnectorStatus(entry('line-oa'), rows).state).toBe('DEGRADED')
  })

  it('reports the best of several connections, and how many there are', () => {
    const rows = [
      connection('openrouter', 'DISABLED', ['CONNECTION_DRAFT']),
      connection('openrouter', 'CONNECTED'),
      connection('openrouter', 'ERROR', ['CREDENTIAL_EXPIRED']),
    ]
    const derived = deriveConnectorStatus(entry('openrouter'), rows)
    expect(derived.state).toBe('CONNECTED')
    expect(derived.connectionCount).toBe(3)
  })

  it('refuses to call a connection healthy when the read model sent no health', () => {
    const rows = [{ id: 'c1', provider: 'openrouter' }]
    expect(deriveConnectorStatus(entry('openrouter'), rows)).toEqual({
      state: CONNECTOR_NOT_CONNECTED,
      reasons: [CONNECTOR_REASONS.NO_HEALTH_EVIDENCE],
      connectionCount: 1,
    })
  })

  it('treats Gemini as connectable, which the old literal denied', () => {
    // AVAILABLE was wrong in the other direction here: `gemini` is in
    // PUBLIC_LINE_PROVIDERS, so the Phase 1 model form has always been able to
    // create this connection.
    expect(entry('google-gemini').providerCodes).toEqual(['gemini'])
    expect(deriveConnectorStatus(entry('google-gemini'), [connection('gemini', 'CONNECTED')]).state)
      .toBe('CONNECTED')
  })

  it('derives every entry, and none of them is connected on an empty read model', () => {
    const derived = deriveConnectorCatalog([])
    expect(derived).toHaveLength(CONNECTOR_CATALOG.length)
    for (const item of derived) {
      expect(CONNECTOR_STATES).toContain(item.state)
      expect(item.state).toBe(CONNECTOR_NOT_CONNECTED)
    }
  })

  it('tolerates a missing or malformed read model without reporting green', () => {
    for (const input of [undefined, null, 'nope', [null, undefined, {}]]) {
      expect(deriveConnectorStatus(entry('openrouter'), input).state).toBe(CONNECTOR_NOT_CONNECTED)
    }
  })
})
