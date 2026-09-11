import { describe, expect, it } from 'vitest'
import {
  broadcastPayloadIdentity,
  classifyMarketingQuestion,
  criteriaHash,
  parseMarketingBroadcastPayload,
  zMarketingBroadcastPayloadInput,
} from '@/modules/marketing/domain/marketing-broadcast-contract'

// @req FR-185 — the planning payload has one strict shape, stable canonical
// hash and deterministic question classification.
// @spec FR-157, FR-159, FR-160, FR-103, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-broadcast-contract.test.js

function payload(account = { lineOaAccountId: 'account-1', accountVersion: 3 }) {
  return {
    channel: 'LINE',
    account,
    ...(account ? {} : { accountState: 'UNAVAILABLE', accountReasonCode: 'LINE_ACCOUNT_NOT_SELECTED' }),
    content: { briefId: 'brief-1', contentVersionId: 'content-version-1', payloadHash: 'a'.repeat(64) },
    audience: {
      source: 'CRM_CONVERSATION_READ_MODEL',
      sourceVersion: null,
      audienceSpecVersion: '1.0',
      filter: { consentStatus: 'GRANTED' },
      criteriaHash: criteriaHash(),
      resolutionState: 'UNAVAILABLE',
      resolutionRef: null,
    },
    consent: {
      source: 'CRM_CUSTOMER.consentStatus',
      requiredValue: 'GRANTED',
      policyReference: 'FR-103',
      policyVersion: null,
      snapshotRef: null,
      snapshotVersion: null,
      state: 'UNAVAILABLE',
    },
  }
}

describe('Marketing broadcast planning contract', () => {
  it('accepts a complete selected-account payload and canonicalizes key order', () => {
    const input = payload()
    const identity = broadcastPayloadIdentity(input)
    expect(identity.payloadHash).toMatch(/^[a-f0-9]{64}$/)
    expect(parseMarketingBroadcastPayload(identity.payloadJson, identity.payloadHash)).toEqual(input)
    expect(zMarketingBroadcastPayloadInput.parse({
      consent: input.consent,
      audience: input.audience,
      content: input.content,
      account: input.account,
      channel: input.channel,
    })).toEqual(input)
  })

  it('requires the explicit unavailable account state when no account is selected', () => {
    const input = payload(null)
    expect(zMarketingBroadcastPayloadInput.parse(input).account).toBeNull()
    expect(() => zMarketingBroadcastPayloadInput.parse({ ...input, accountState: undefined })).toThrow()
    expect(() => zMarketingBroadcastPayloadInput.parse({ ...input, unexpected: true })).toThrow()
  })

  it('rejects a fabricated criteria hash and classifies questions without a model', () => {
    expect(() => broadcastPayloadIdentity({ ...payload(), audience: { ...payload().audience, criteriaHash: 'b'.repeat(64) } })).toThrow('BROADCAST_AUDIENCE_CRITERIA_HASH_INVALID')
    expect(classifyMarketingQuestion('  ROAS for last month? ')).toBe('ANALYZE_ROAS')
    expect(classifyMarketingQuestion('ความถี่ของโฆษณา')).toBe('DETECT_FATIGUE')
    expect(classifyMarketingQuestion('')).toBe('EXECUTIVE_OVERVIEW')
    expect(classifyMarketingQuestion('overview')).toBe('EXECUTIVE_OVERVIEW')
    expect(classifyMarketingQuestion('send this now')).toBe('UNSUPPORTED')
  })
})
