'use client'

// @req FR-012 — every modal intake surface on /work converges on the one
// PlanEnvelope pipeline: POST /api/import/dry-run (read-only preview), a human
// confirms what the preview shows, then POST /api/import/commit with the exact
// envelope that was previewed. The modals used to POST to an import/plan route
// that never existed and skipped the preview entirely; a modal that commits
// without a preview would be a second write path.
// @spec BR-009, SDD-009 — preview-then-confirm, one pipeline for every surface
// @tested tests/unit/plan-intake-flow.test.js

import { useMemo, useState } from 'react'
import { api } from './useApi'

export const PLAN_DRY_RUN_PATH = '/api/import/dry-run'
export const PLAN_COMMIT_PATH = '/api/import/commit'

export const IDLE_PLAN_INTAKE = Object.freeze({
  // The envelope that was previewed — the only one confirm() may ever send.
  plan: null,
  // { workspaceId?, projectId? } exactly as the dry run received it.
  target: null,
  // The dry-run result, kept only when it produced a preview.
  dryRun: null,
  // Validation errors, with or without a preview (conflicts keep both).
  errors: null,
  // The commit receipt: { committed: true, projectId, projectCode, … }.
  committed: null,
  busy: false,
})

/**
 * The target the import routes resolve (`resolveImportWorkspaceId`): an
 * explicit `workspaceId` wins, else `projectId` falls back to that project's
 * Space. Only defined keys are sent, so a `workspaceId: undefined` never
 * shadows a `projectId` in the JSON body.
 */
export function importTarget({ workspaceId, projectId } = {}) {
  const target = {}
  if (workspaceId) target.workspaceId = workspaceId
  if (projectId) target.projectId = projectId
  return target
}

export function requestPlanDryRun(plan, target, { request = api } = {}) {
  return request(PLAN_DRY_RUN_PATH, { method: 'POST', body: { plan, ...importTarget(target) } })
}

export function requestPlanCommit(plan, target, { request = api } = {}) {
  return request(PLAN_COMMIT_PATH, { method: 'POST', body: { plan, ...importTarget(target) } })
}

/**
 * Read a dry-run result the way PlanImportPanel does: no preview means the
 * plan never got past validation; a preview that is not valid (conflicts) is
 * shown to the human but cannot be confirmed.
 */
export function readDryRun(result) {
  if (!result || typeof result !== 'object') {
    return { dryRun: null, errors: ['Dry run returned no result'] }
  }
  if (!result.valid && !result.preview) {
    return { dryRun: null, errors: result.errors?.length ? result.errors : ['Dry run failed'] }
  }
  return { dryRun: result, errors: result.valid ? null : result.errors || [] }
}

export function canConfirmPlan(dryRun) {
  return Boolean(dryRun && dryRun.valid && dryRun.preview)
}

/**
 * The intake state machine, framework-free so a test can drive it without a
 * DOM. `onChange` receives every transition; the hook below feeds it into
 * React state. `request` is the JSON client (`api`) and is injectable.
 */
export function createPlanIntake({ request = api, onChange = () => {} } = {}) {
  let state = IDLE_PLAN_INTAKE
  const set = (patch) => {
    state = { ...state, ...patch }
    onChange(state)
    return state
  }

  return {
    getState: () => state,

    reset: () => set(IDLE_PLAN_INTAKE),

    /** Read-only preview. Nothing is written by this leg. */
    async preview(plan, target = {}) {
      set({ ...IDLE_PLAN_INTAKE, busy: true })
      const sent = importTarget(target)
      try {
        const result = await requestPlanDryRun(plan, sent, { request })
        const { dryRun, errors } = readDryRun(result)
        return set({ plan, target: sent, dryRun, errors, busy: false })
      } catch (err) {
        return set({ plan, target: sent, errors: [err?.message || String(err)], busy: false })
      }
    },

    /**
     * Adopt a dry run another leg already ran — the FR-018 Excel upload
     * returns the converted envelope together with its dry run — so confirm()
     * commits that envelope through the same commit leg as pasted JSON.
     */
    adopt(plan, target, result) {
      const { dryRun, errors } = readDryRun(result)
      return set({ ...IDLE_PLAN_INTAKE, plan, target: importTarget(target), dryRun, errors })
    },

    /** Commit exactly the previewed envelope. Refuses without a valid preview. */
    async confirm() {
      if (!canConfirmPlan(state.dryRun) || !state.plan) {
        return set({ errors: ['Run a dry run first — nothing is imported without a preview'] })
      }
      set({ busy: true, errors: null })
      try {
        const result = await requestPlanCommit(state.plan, state.target, { request })
        if (result?.committed) return set({ committed: result, dryRun: null, busy: false })
        return set({ errors: result?.errors?.length ? result.errors : ['Import was refused'], busy: false })
      } catch (err) {
        return set({ errors: [err?.message || String(err)], busy: false })
      }
    },
  }
}

export function usePlanIntake({ request = api } = {}) {
  const [state, setState] = useState(IDLE_PLAN_INTAKE)
  const intake = useMemo(() => createPlanIntake({ request, onChange: setState }), [request])
  return {
    ...state,
    canConfirm: canConfirmPlan(state.dryRun),
    preview: intake.preview,
    adopt: intake.adopt,
    confirm: intake.confirm,
    reset: intake.reset,
  }
}
