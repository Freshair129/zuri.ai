import { describe, expect, it } from 'vitest'
import {
  assertSessionAssurance,
  resolveSessionAssurance,
} from '@/modules/identity/session-assurance'

// @req FR-094, FR-095, FR-096 — session assurance levels and step-up elevation
// @spec ADR-045 D2, D4, SDD-052, SEC-018
// @tested tests/unit/identity/session-assurance.test.js

describe('Session Assurance & Step-up Guard', () => {
  it('resolves default session to AAL1', () => {
    const session = {
      status: 'ACTIVE',
      assurance: 'PASSWORD',
      assuranceLevel: 'AAL1',
    }
    expect(resolveSessionAssurance(session)).toBe('AAL1')
    expect(assertSessionAssurance(session, 'AAL1')).toBe(true)
  })

  it('rejects AAL2 requirement when session is only AAL1', () => {
    const session = {
      status: 'ACTIVE',
      assurance: 'PASSWORD',
      assuranceLevel: 'AAL1',
    }
    expect(() => assertSessionAssurance(session, 'AAL2')).toThrow(/ASSURANCE_LEVEL_INSUFFICIENT/)
  })

  it('resolves session to AAL2 if assuranceLevel is AAL2', () => {
    const session = {
      status: 'ACTIVE',
      assurance: 'MFA_TOTP',
      assuranceLevel: 'AAL2',
    }
    expect(resolveSessionAssurance(session)).toBe('AAL2')
    expect(assertSessionAssurance(session, 'AAL2')).toBe(true)
  })

  it('resolves session to AAL2 during active elevated step-up window', () => {
    const session = {
      status: 'ACTIVE',
      assuranceLevel: 'AAL1',
      elevatedUntil: new Date(Date.now() + 60000), // 1 minute in future
    }
    expect(resolveSessionAssurance(session)).toBe('AAL2')
    expect(assertSessionAssurance(session, 'AAL2')).toBe(true)
  })

  it('falls back to AAL1 when elevated step-up window has expired', () => {
    const session = {
      status: 'ACTIVE',
      assuranceLevel: 'AAL1',
      elevatedUntil: new Date(Date.now() - 5000), // 5 seconds in past
    }
    expect(resolveSessionAssurance(session)).toBe('AAL1')
    expect(() => assertSessionAssurance(session, 'AAL2')).toThrow(/ASSURANCE_LEVEL_INSUFFICIENT/)
  })
})
