// @req FR-012, FR-069 — commitPlan's interactive transaction must survive a
// real programme-sized envelope against production Postgres, not just Prisma's
// 5 s default.
// @spec BR-009, SDD-006, SDD-009
// @tested tests/unit/plan-import-commit-transaction.test.js
//
// 2026-09-14: importing a 28-item, 9-workstream PlanEnvelope into production
// rolled back whole with "Transaction API error: Transaction not found" —
// Prisma's message for a client still writing after the server closed the
// transaction, because `commitPlan` opened `db.$transaction(fn)` with no
// options and inherited the 5 s interactive default. This proves the fix
// (`PLAN_COMMIT_TRANSACTION_OPTIONS`) is actually passed to the real call,
// without needing a live database: a fake `db` captures the transaction's
// arguments and aborts before running the callback, since the numbers being
// passed — not the callback's own behaviour, already covered by
// tests/integration/plan-import.test.js — are what regressed.
import { describe, expect, it } from 'vitest'
import { makeViewer } from '../factories/viewer'
import { commitPlan, PLAN_COMMIT_TRANSACTION_OPTIONS } from '@/modules/project-manager/import/plan-import-service'

const WORKSPACE = { id: 'ws-1', code: 'WS-X', name: 'X Workspace', businessId: 'biz-1', scopeType: 'BUSINESS' }

const PLAN = {
  schemaVersion: '1.0',
  scope: { workspaceCode: WORKSPACE.code },
  project: { code: 'PRJ-X', name: 'X' },
  workstreams: [],
}

/**
 * Enough of `db` for `dryRunPlan` to resolve this minimal, workstream-free
 * plan as a fresh insert: the Workspace lookup, and the project's own
 * findFirst/findUnique classification calls. `$transaction` captures its
 * arguments and throws — deliberately, so the test never has to mock the
 * dozens of writer calls the commit body makes, which is not what regressed.
 */
function fakeDb({ captured }) {
  return {
    workspace: { findUnique: async () => WORKSPACE },
    project: {
      findFirst: async () => null,
      findUnique: async () => null,
    },
    $transaction: async (fn, options) => {
      captured.push({ fn, options })
      throw new Error('STOP_AFTER_CAPTURE — the transaction body is intentionally never run')
    },
  }
}

describe('commitPlan transaction sizing (2026-09-14 production incident)', () => {
  it('opens the interactive transaction with PLAN_COMMIT_TRANSACTION_OPTIONS, not the 5 s default', async () => {
    const captured = []
    const viewer = makeViewer({ ownedBusinessIds: [WORKSPACE.businessId], visibleBusinessIds: [WORKSPACE.businessId] })

    await expect(
      commitPlan(PLAN, { viewer, db: fakeDb({ captured }) })
    ).rejects.toThrow('STOP_AFTER_CAPTURE')

    expect(captured).toHaveLength(1)
    expect(captured[0].options).toBe(PLAN_COMMIT_TRANSACTION_OPTIONS)
    expect(captured[0].options).toEqual({ maxWait: 10_000, timeout: 120_000 })
    // A regression back to "no options" is exactly the bug this test exists to
    // catch, so assert the shape explicitly rather than only truthiness.
    expect(typeof captured[0].fn).toBe('function')
  })
})
