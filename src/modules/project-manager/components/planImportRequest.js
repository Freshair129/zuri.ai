// @req FR-012, FR-017 — shared request-body builder for the PlanEnvelope
// dry-run → commit pipeline (POST /api/import/dry-run, POST /api/import/commit).
// Every UI surface that imports a plan (Plan Mode Customizer, Upload Plan modal,
// PlanImportPanel) builds its request through this one function so the target
// workspace/project sent to the preview leg can never drift from what is sent
// to the commit leg — a mismatch there would let a dry run authorize one scope
// while the commit writes to another.
// @spec BR-009, SDD-009 — every intake surface converges on one envelope →
// dry-run preview → confirm → single transaction.
// @tested tests/unit/plan-import-request.test.js

/**
 * Build the JSON body shared by both legs of the import pipeline.
 * Pure — no fetch, no side effects.
 *
 * @param {object} plan - the PlanEnvelope to validate/commit.
 * @param {{workspaceId?: string, projectId?: string}} [target]
 * @returns {{plan: object, workspaceId: (string|undefined), projectId: (string|undefined)}}
 */
export function buildPlanImportRequest(plan, { workspaceId, projectId } = {}) {
  return {
    plan,
    workspaceId: workspaceId || undefined,
    projectId: projectId || undefined,
  }
}
