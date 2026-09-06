import { describe, it, expect } from 'vitest'
import { newId, codeFragment, humanCode, uniqueHumanCode, isInternalId } from '@/lib/ids'

describe('ids', () => {
  it('generates uuid internal ids', () => {
    const id = newId()
    expect(isInternalId(id)).toBe(true)
  })

  it('normalizes names into code fragments', () => {
    expect(codeFragment('Customer Data')).toBe('CUSTOMER-DATA')
    expect(codeFragment('  spaced   out  ')).toBe('SPACED-OUT')
    expect(codeFragment('ครัว Thai')).toBe('THAI')
  })

  it('builds human codes', () => {
    expect(humanCode('PRJ', 'Customer Data')).toBe('PRJ-CUSTOMER-DATA')
  })

  it('retries on collision with numeric suffix', async () => {
    const taken = new Set(['WST-ALPHA', 'WST-ALPHA-2'])
    const code = await uniqueHumanCode('WST', 'Alpha', async (c) => taken.has(c))
    expect(code).toBe('WST-ALPHA-3')
  })

  it('external identifiers are not internal ids', () => {
    expect(isInternalId('0105500000001')).toBe(false) // TH tax id
    expect(isInternalId('Freshair129/zuri')).toBe(false) // GitHub full name
    expect(isInternalId('U4af4980629...')).toBe(false) // LINE user id
  })
})
