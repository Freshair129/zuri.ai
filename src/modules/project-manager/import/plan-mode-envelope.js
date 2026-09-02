// @req FR-009, FR-017 — the Plan Mode Customizer's form becomes the same
// PlanEnvelope every other human surface produces (buildHumanPlan), with the
// Delegator / Approver binding carried where the schema allows it: on each
// item's `metadata` (what the All Work "Delegator / Approver" column reads)
// and as `generatedBy`. The envelope schema is strict, so the top-level
// `metadata` block the modal used to send, its guessed progressStrategy and
// its off-contract item subtype are all things a dry run would have refused.
// @spec BR-003, BR-004, BR-009, SDD-006
// @tested tests/unit/plan-intake-flow.test.js, tests/integration/plan-mode-modal-intake.test.js

import { buildHumanPlan } from './human-plan-builder'

export function buildPlanModeEnvelope({
  objective,
  description = '',
  targetAt = '',
  workspaceCode = '',
  streams = [],
  delegator = '',
  approver = '',
  generatedAt,
  suffix,
}) {
  // `generatedAt` / `suffix` left undefined take the builder's own defaults.
  const plan = buildHumanPlan({ objective, description, targetAt, workspaceCode, streams, generatedAt, suffix })

  const actors = {}
  const delegatedBy = String(delegator || '').trim()
  const approvedBy = String(approver || '').trim()
  if (delegatedBy) actors.delegator = delegatedBy
  if (approvedBy) actors.approver = approvedBy
  const hasActors = Object.keys(actors).length > 0

  return {
    ...plan,
    ...(delegatedBy ? { generatedBy: delegatedBy } : {}),
    workstreams: plan.workstreams.map((workstream) => ({
      ...workstream,
      items: workstream.items.map((item) => (hasActors ? { ...item, metadata: { ...actors } } : item)),
    })),
  }
}
