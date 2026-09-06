import { describe, expect, it } from 'vitest'
import { AGENT_REQUESTABLE_SENSITIVITY } from '@/modules/agent/auth-context'
import { KNOWLEDGE_SENSITIVITY_LEVELS } from '@/lib/validation/enums'

// @req FR-057, SEC-013 — the agent domain may request only a subset of FR-111's
//   knowledge sensitivity lattice, because no entitlement model yet grants a
//   principal any level; AGENT_REQUESTABLE_SENSITIVITY is that subset.
// @spec FR-111 — KNOWLEDGE_SENSITIVITY_LEVELS is the lattice this is a subset of.
// @tested tests/unit/agent-requestable-sensitivity.test.js
//
// Two describe blocks on purpose, not one test with two assertions — they pin
// invariants with different lifetimes. Vocabulary is ETERNAL: a ceiling member
// that is not a lattice member is always a bug, at any policy. Exactness is
// CURRENT POLICY: the ceiling is PUBLIC-only until an entitlement model exists,
// and is expected to fail exactly once, the day that model lands. Folding both
// into one test risks the wrong fix on that day — loosening whichever
// assertion is in the way, which may be the eternal one, to make the test
// green again. Keeping them separate means widening the policy touches only
// the policy test.
//
// This does not guard HEIGHT — that a request above the ceiling is actually
// refused. See tests/integration/agent-request-envelope.test.js for that.

describe('FR-057 agent-requestable sensitivity — vocabulary (eternal)', () => {
  it('contains only members declared in KNOWLEDGE_SENSITIVITY_LEVELS', () => {
    for (const level of AGENT_REQUESTABLE_SENSITIVITY) {
      expect(
        KNOWLEDGE_SENSITIVITY_LEVELS,
        `"${level}" is in AGENT_REQUESTABLE_SENSITIVITY but not in the FR-111 lattice — ` +
          'either it is a typo, or a lattice member was renamed or removed without updating the ceiling',
      ).toContain(level)
    }
  })
})

describe('FR-057 agent-requestable sensitivity — current policy (expected to change)', () => {
  it('authorizes only PUBLIC today', () => {
    expect(
      AGENT_REQUESTABLE_SENSITIVITY,
      'This is expected to fail the day an entitlement model exists to authorize a principal ' +
        'for a level above PUBLIC. A validated request level is not an authorized one — widen ' +
        'this list only once something now checks the request against that entitlement, and ' +
        'update this assertion (and this message) to say so when you do.',
    ).toEqual(['PUBLIC'])
  })
})
