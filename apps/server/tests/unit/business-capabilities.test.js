import { describe, expect, it } from 'vitest'
import { BUSINESS_CAPABILITIES, businessHasCapability, parseCapabilities } from '@/lib/business-capabilities'

// @req FR-169 — a Business capability differs from a Membership grant: a
//   grant says who may open a module, a capability says whether the module
//   applies to the Business at all. Reading never throws.
// @tested tests/unit/business-capabilities.test.js

describe('parseCapabilities', () => {
  it('returns the parsed object for valid JSON, {} for anything untrustworthy', () => {
    expect(parseCapabilities('{"physicalStock": false}')).toEqual({ physicalStock: false })
    expect(parseCapabilities('{}')).toEqual({})
    expect(parseCapabilities(undefined)).toEqual({})
    expect(parseCapabilities(null)).toEqual({})
    expect(parseCapabilities('not json')).toEqual({})
    expect(parseCapabilities('[]')).toEqual({})
    expect(parseCapabilities('"a string"')).toEqual({})
  })
})

describe('businessHasCapability', () => {
  it('an unset capability reads its own stated default, not a blanket true or false', () => {
    expect(BUSINESS_CAPABILITIES.physicalStock.default).toBe(true)
    expect(businessHasCapability({ capabilitiesJson: '{}' }, 'physicalStock')).toBe(true)
    expect(businessHasCapability({ capabilitiesJson: '{"physicalStock": false}' }, 'physicalStock')).toBe(false)
    expect(businessHasCapability({ capabilitiesJson: '{"physicalStock": true}' }, 'physicalStock')).toBe(true)
  })

  it('accepts a raw Business row or an already-parsed capabilities object', () => {
    expect(businessHasCapability({ capabilitiesJson: '{"physicalStock": false}' }, 'physicalStock')).toBe(false)
    expect(businessHasCapability({ physicalStock: false }, 'physicalStock')).toBe(false)
  })

  it('fails to the default rather than throwing on no Business, no column or a non-boolean value', () => {
    expect(businessHasCapability(null, 'physicalStock')).toBe(true)
    expect(businessHasCapability(undefined, 'physicalStock')).toBe(true)
    expect(businessHasCapability({}, 'physicalStock')).toBe(true)
    expect(businessHasCapability({ capabilitiesJson: 'garbage' }, 'physicalStock')).toBe(true)
    expect(businessHasCapability({ capabilitiesJson: '{"physicalStock": "yes"}' }, 'physicalStock')).toBe(true)
  })

  it('refuses an unknown capability name rather than silently answering false', () => {
    expect(() => businessHasCapability({}, 'notARealCapability')).toThrow(/unknown capability/)
  })
})
