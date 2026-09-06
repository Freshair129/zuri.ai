import { describe, it, expect } from 'vitest'
import { createToolRegistry, defaultReadOnlyTools } from '@/modules/agent'

// @req FR-025 — the read-only tool registry enforces Gate E: search / read / recommend /
//   answer only. No write tool may be registered until Gate F.

describe('read-only tool registry (FR-025, Gate E)', () => {
  it('rejects a write tool: register({ readOnly:false }) throws', () => {
    const registry = createToolRegistry()
    expect(() => registry.register({ name: 'refund', readOnly: false })).toThrow()
  })

  it('rejects a tool that omits readOnly entirely (default-deny)', () => {
    const registry = createToolRegistry()
    expect(() => registry.register({ name: 'cancel_order' })).toThrow()
  })

  it('accepts a read-only tool and returns it from get() and list()', () => {
    const registry = createToolRegistry()
    registry.register({ name: 'read_thing', readOnly: true, description: 'reads a thing' })

    expect(registry.get('read_thing')).toMatchObject({ name: 'read_thing', readOnly: true })

    const listed = registry.list()
    expect(listed).toEqual([{ name: 'read_thing', description: 'reads a thing' }])
  })

  it('list() exposes only name + description, never the handler', () => {
    const registry = createToolRegistry()
    registry.register({ name: 'read_thing', readOnly: true, description: 'd', handler: async () => 42 })
    for (const tool of registry.list()) {
      expect(tool).not.toHaveProperty('handler')
      expect(tool).not.toHaveProperty('readOnly')
    }
  })

  it('defaultReadOnlyTools() ships exactly the 3 Gate E tools', () => {
    const listed = defaultReadOnlyTools().list()
    expect(listed).toHaveLength(3)
    expect(listed.map((t) => t.name).sort()).toEqual(
      ['answer_from_knowledge', 'read_customer_profile', 'search_conversations'].sort(),
    )
  })
})
