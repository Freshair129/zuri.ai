import { describe, it, expect } from 'vitest'
import { createMspMemoryPort } from '@/modules/agent/msp-memory-port'

// @req FR-025 — MSP-backed memory port (principal-keyed), the real adapter behind the P6 seam.
// @spec ADR-007 §P6 — memory keyed by principal, not channel; vault = the principal key. The
//   demo's `vault: line:Uxxxx` is the forbidden anti-pattern; the adapter fails closed on it.
//
// No DB, no server, no stdio: a mock transport records every MSP tool call and returns canned
// API-009 responses. Test-data prefix: PF-MSP.

// A valid principal key (…/principal:{type}:{id}) — never a channel handle.
const PRINCIPAL_KEY = 'tenant:PF-MSP-T1/principal:customer:PF-MSP-P1'

/**
 * Mock MSP tool-caller. Same surface the real `createMspStdioCaller` exposes:
 * `(name, input) => Promise<payload>`, already unwrapped to the handler payload.
 * Records calls and answers by tool name.
 */
function mockTransport(responses = {}) {
  const calls = []
  const transport = async (name, input) => {
    calls.push({ name, input })
    return responses[name] ?? {}
  }
  transport.calls = calls
  return transport
}

describe('createMspMemoryPort (FR-025, ADR-007 §P6)', () => {
  describe('remember — writes via msp_memory_upsert scoped to the principal vault', () => {
    it('issues an upsert with vault_id === the principal key and body_json === the entry', async () => {
      const transport = mockTransport({
        msp_memory_upsert: { entity: {}, created: true, changed: true },
        msp_memory_list: { entities: [] },
      })
      const port = createMspMemoryPort({ transport })

      const entry = { key: 'PF-MSP-fact-1', text: 'ลูกค้าชอบสีแดง', role: 'note' }
      await port.remember(PRINCIPAL_KEY, entry)

      const upsert = transport.calls.find((c) => c.name === 'msp_memory_upsert')
      expect(upsert).toBeTruthy()
      // The whole point of P6: the vault IS the principal key, never a channel handle.
      expect(upsert.input.vault.vault_id).toBe(PRINCIPAL_KEY)
      expect(upsert.input.vault.vault_id).not.toContain('line:')
      expect(upsert.input.vault.vault_type).toBe('workspace_private')
      expect(upsert.input.key).toBe('PF-MSP-fact-1')
      expect(upsert.input.body_json).toEqual(entry)
      expect(typeof upsert.input.category).toBe('string')
    })

    it('passes through epistemic_state / confidence / valid_from when the entry sets them', async () => {
      const transport = mockTransport({
        msp_memory_upsert: {},
        msp_memory_list: { entities: [] },
      })
      const port = createMspMemoryPort({ transport })

      await port.remember(PRINCIPAL_KEY, {
        key: 'PF-MSP-fact-2',
        text: 'x',
        epistemic_state: 'confirmed',
        confidence: 1,
        valid_from: '2026-08-12T00:00:00.000Z',
      })

      const upsert = transport.calls.find((c) => c.name === 'msp_memory_upsert')
      expect(upsert.input.epistemic_state).toBe('confirmed')
      expect(upsert.input.confidence).toBe(1)
      expect(upsert.input.valid_from).toBe('2026-08-12T00:00:00.000Z')
    })

    it('returns the updated recall ({ key, entries }) after writing', async () => {
      const stored = { key: 'PF-MSP-fact-3', text: 'hello' }
      const transport = mockTransport({
        msp_memory_upsert: {},
        msp_memory_list: { entities: [{ entity_id: 'e1', body_json: stored }] },
      })
      const port = createMspMemoryPort({ transport })

      const recall = await port.remember(PRINCIPAL_KEY, stored)
      expect(recall.key).toBe(PRINCIPAL_KEY)
      expect(recall.entries).toEqual([stored])
      // remember must re-read the vault to produce the updated recall.
      expect(transport.calls.some((c) => c.name === 'msp_memory_list')).toBe(true)
    })
  })

  describe('recall — reads via msp_memory_list scoped to the principal vault', () => {
    it('issues a list keyed by vault_id and maps body_json -> entries', async () => {
      const a = { key: 'PF-MSP-a', text: 'one' }
      const b = { key: 'PF-MSP-b', text: 'two' }
      const transport = mockTransport({
        msp_memory_list: {
          entities: [
            { entity_id: 'e1', vault_id: PRINCIPAL_KEY, body_json: a },
            { entity_id: 'e2', vault_id: PRINCIPAL_KEY, body_json: b },
          ],
        },
      })
      const port = createMspMemoryPort({ transport })

      const recall = await port.recall(PRINCIPAL_KEY)

      const list = transport.calls.find((c) => c.name === 'msp_memory_list')
      expect(list).toBeTruthy()
      expect(list.input.vault_id).toBe(PRINCIPAL_KEY)
      expect(recall).toEqual({ key: PRINCIPAL_KEY, entries: [a, b] })
    })

    it('returns an empty entry list for an unknown key (read-only-safe)', async () => {
      const transport = mockTransport({ msp_memory_list: { entities: [] } })
      const port = createMspMemoryPort({ transport })

      const recall = await port.recall(PRINCIPAL_KEY)
      expect(recall).toEqual({ key: PRINCIPAL_KEY, entries: [] })
    })

    it('honours a custom vaultResolver but still guards the resolved vault', async () => {
      const transport = mockTransport({ msp_memory_list: { entities: [] } })
      const port = createMspMemoryPort({
        transport,
        // resolver still produces a principal-scoped vault.
        vaultResolver: (key) => `${key}#v2`,
      })

      await port.recall(PRINCIPAL_KEY)
      const list = transport.calls.find((c) => c.name === 'msp_memory_list')
      expect(list.input.vault_id).toBe(`${PRINCIPAL_KEY}#v2`)
    })
  })

  describe('fail-closed — refuses channel-scoped keys before any MSP round-trip', () => {
    it('rejects a key that embeds a channel handle (…/line:Uxxxx)', async () => {
      const transport = mockTransport({})
      const port = createMspMemoryPort({ transport })

      await expect(
        port.recall('tenant:PF-MSP-T1/line:U0123456789abcdef0123456789abcdef'),
      ).rejects.toThrow(/line:/)
      // Fail closed: nothing was ever sent to MSP.
      expect(transport.calls).toHaveLength(0)
    })

    it('rejects a bare LINE user handle used as a key', async () => {
      const transport = mockTransport({})
      const port = createMspMemoryPort({ transport })

      await expect(
        port.remember('U0123456789abcdef0123456789abcdef', { text: 'x' }),
      ).rejects.toThrow()
      expect(transport.calls).toHaveLength(0)
    })

    it('rejects a key that names no principal at all', async () => {
      const transport = mockTransport({})
      const port = createMspMemoryPort({ transport })

      await expect(port.recall('tenant:PF-MSP-T1/thread:PF-MSP-thread-1')).rejects.toThrow(
        /principal:/,
      )
      expect(transport.calls).toHaveLength(0)
    })

    it('rejects when a custom vaultResolver produces a channel-scoped vault', async () => {
      const transport = mockTransport({})
      const port = createMspMemoryPort({
        transport,
        vaultResolver: () => 'line:U0123456789abcdef0123456789abcdef',
      })

      await expect(port.recall(PRINCIPAL_KEY)).rejects.toThrow(/line:/)
      expect(transport.calls).toHaveLength(0)
    })
  })

  describe('transport injection — accepts the shapes the real MSP stack exposes', () => {
    it('accepts an object exposing .call(name, input) (MspClient style)', async () => {
      const calls = []
      const client = {
        call: async (name, input) => {
          calls.push({ name, input })
          return { entities: [] }
        },
      }
      const port = createMspMemoryPort({ transport: client })

      await port.recall(PRINCIPAL_KEY)
      expect(calls[0].name).toBe('msp_memory_list')
      expect(calls[0].input.vault_id).toBe(PRINCIPAL_KEY)
    })

    it('throws if no usable transport is injected', () => {
      expect(() => createMspMemoryPort({ transport: {} })).toThrow(/transport/)
    })
  })
})
