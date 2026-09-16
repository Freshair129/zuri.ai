'use client'

// @req FR-185 — browser-safe labels for the durable planning intent; this
// module deliberately contains no server crypto or owner reader.
// @spec SDD-086, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-broadcast-client-contract.test.js

export const BROADCAST_DISPATCH_UNAVAILABLE = Object.freeze({
  state: 'UNAVAILABLE',
  reasonCode: 'LINE_BROADCAST_OWNER_CONTRACT_UNAVAILABLE',
})

export const BROADCAST_INTENT_STATUSES = Object.freeze(['PLANNING', 'ARCHIVED'])

export function classifyMarketingQuestion(question = '') {
  const normalized = String(question || '').trim().toLowerCase()
  if (normalized.includes('roas') || normalized.includes('revenue') || normalized.includes('รายได้') || normalized.includes('ยอดจริง')) return 'ANALYZE_ROAS'
  if (normalized.includes('fatigue') || normalized.includes('frequency') || normalized.includes('ล้า') || normalized.includes('ความถี่')) return 'DETECT_FATIGUE'
  if (!normalized || normalized === 'overview') return 'EXECUTIVE_OVERVIEW'
  return 'UNSUPPORTED'
}

export function broadcastPayloadTemplate({ briefId = '', contentVersionId = '', payloadHash = '', lineOaAccountId = '', accountVersion = 1, criteriaHash = '' } = {}) {
  const account = lineOaAccountId.trim() ? { lineOaAccountId: lineOaAccountId.trim(), accountVersion: Number(accountVersion) || 1 } : null
  return {
    channel: 'LINE',
    ...(account ? { account } : { account: null, accountState: 'UNAVAILABLE', accountReasonCode: 'LINE_ACCOUNT_NOT_SELECTED' }),
    content: { briefId: briefId.trim(), contentVersionId: contentVersionId.trim(), payloadHash: payloadHash.trim() },
    audience: {
      source: 'CRM_CONVERSATION_READ_MODEL', sourceVersion: null, audienceSpecVersion: '1.0',
      filter: { consentStatus: 'GRANTED' }, criteriaHash: criteriaHash.trim(), resolutionState: 'UNAVAILABLE', resolutionRef: null,
    },
    consent: {
      source: 'CRM_CUSTOMER.consentStatus', requiredValue: 'GRANTED', policyReference: 'FR-103',
      policyVersion: null, snapshotRef: null, snapshotVersion: null, state: 'UNAVAILABLE',
    },
  }
}

