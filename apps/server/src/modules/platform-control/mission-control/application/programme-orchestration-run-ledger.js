import { parseProgrammeOrchestrationObservation } from '@/modules/platform-control/mission-control/mission-control-contract'

// @req FR-261 — PORL is a read-only, provenance-bound adapter; absent or
// malformed source data remains UNKNOWN and is never treated as a live result.
// @spec ADR-048 D3, ADR-086 D1/D7
// @tested tests/unit/mission-control-contract.test.js, tests/unit/mission-control-read-model.test.js

const UNKNOWN_SOURCE = Object.freeze({ kind: 'PORL', ref: 'unconfigured' })

function unavailable(reason = 'PORL_SOURCE_UNAVAILABLE') {
  return {
    availability: 'UNKNOWN',
    source: UNKNOWN_SOURCE,
    observations: [],
    quarantined: [],
    reason,
  }
}

/**
 * The first release has no authoritative PORL writer or external connector.
 * A caller may inject a read-only source for tests or a later reviewed
 * integration, but this adapter never discovers processes, reads prompts, or
 * guesses ownership from the current browser or worktree.
 */
export function createProgrammeOrchestrationRunLedgerAdapter({ read = null } = {}) {
  if (typeof read !== 'function') {
    return Object.freeze({
      readOnly: true,
      async listObservations() {
        return unavailable()
      },
    })
  }

  return Object.freeze({
    readOnly: true,
    async listObservations(taskIds = []) {
      let raw
      try {
        raw = await read([...taskIds])
      } catch {
        return unavailable('PORL_SOURCE_UNAVAILABLE')
      }
      if (!Array.isArray(raw)) return unavailable('PORL_SOURCE_INVALID')

      const allowed = new Set(taskIds)
      const observations = []
      const quarantined = []
      for (const item of raw) {
        const parsed = parseProgrammeOrchestrationObservation(item)
        if (!parsed.ok) {
          quarantined.push({ reason: 'PORL_RECORD_INVALID' })
          continue
        }
        if (!allowed.has(parsed.value.taskId)) {
          quarantined.push({ reason: 'PORL_TASK_UNMAPPED' })
          continue
        }
        observations.push(parsed.value)
      }

      return {
        availability: observations.length > 0 && quarantined.length === 0 ? 'AVAILABLE' : 'UNKNOWN',
        source: { kind: 'PORL', ref: 'injected-read-only-source' },
        observations,
        quarantined,
        reason: observations.length > 0 ? null : 'PORL_NO_TRUSTED_RECORD',
      }
    },
  })
}
