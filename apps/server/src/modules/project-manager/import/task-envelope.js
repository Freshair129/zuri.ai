// @req FR-005, FR-017 — one task from the Create Task modal becomes a
// PlanEnvelope for the shared intake pipeline, never a direct write. The
// envelope names its target by code so the dry run classifies an existing
// Project and Workstream as updates (nothing is duplicated) and the one new
// item as an insert. A "standalone" task — one the user does not bind to a
// Project — lands in the Business's inbox Project, whose codes are derived
// from the Business code so a second Business can never collide with it, and
// which is itself created through this same envelope the first time.
// @spec BR-004, BR-009, SDD-009 — mode contracts decide the item subtype;
// one pipeline for every surface.
// @tested tests/unit/task-intake-modal.test.js, tests/integration/task-modal-intake.test.js
//
// Why the existing records are carried in full: commit upserts by code and
// rewrites `name`, `executionMode`, `progressStrategy` and `progressWeight` on
// an update, so an envelope that named a Workstream by code alone would reset
// its weight to 1 and its name to whatever the form guessed. The caller hands
// over the record it fetched and the builder copies those fields verbatim.

import { EXECUTION_MODE_CONTRACTS, MODE_DEFAULT_STRATEGY } from '@/lib/validation/enums'
import { HUMAN_PLAN_GENERATOR, slug, uniqueCode } from './human-plan-builder'

export const INBOX_WORKSTREAM_NAME = 'General Tasks & Operations'
export const INBOX_MODE = 'OPERATIONS'

/** The Business inbox Project a standalone task attaches to. Deterministic per Business. */
export function inboxProjectFor(business) {
  const code = slug(business?.code || business?.name || 'BUSINESS', 24)
  return {
    code: `PRJ-${code}-INBOX`,
    name: `งานทั่วไป — ${business?.name || business?.code || 'Business'}`,
    description: 'Standalone tasks created from All Work land here until they are bound to a Project.',
  }
}

/** The single OPERATIONS workstream inside the inbox Project. */
export function inboxWorkstreamFor(business) {
  const code = slug(business?.code || business?.name || 'BUSINESS', 24)
  return {
    code: `WST-${code}-INBOX`,
    name: INBOX_WORKSTREAM_NAME,
    executionMode: INBOX_MODE,
    progressStrategy: MODE_DEFAULT_STRATEGY[INBOX_MODE],
    progressWeight: 1,
  }
}

/** A fresh general workstream for a Project that has none yet. */
export function generalWorkstreamFor(project) {
  return {
    code: `WST-${slug(project?.code || 'PROJECT', 24)}-GENERAL`,
    name: INBOX_WORKSTREAM_NAME,
    executionMode: INBOX_MODE,
    progressStrategy: MODE_DEFAULT_STRATEGY[INBOX_MODE],
    progressWeight: 1,
  }
}

/** Item subtypes the target workstream's mode contract allows (BR-004). */
export function allowedItemSubtypes(executionMode) {
  return EXECUTION_MODE_CONTRACTS[executionMode]?.itemSubtypes || []
}

/**
 * Build the envelope for one task.
 *
 * `project` / `workstream` are the records to attach to, exactly as fetched
 * (`{ code, name, ... }`); both optional. Missing project → the Business inbox
 * Project. Missing workstream → the Project's general workstream (or the
 * inbox workstream). The task's subtype must be one the workstream's mode
 * allows; an unknown one falls back to the contract's first subtype rather
 * than producing an envelope the dry run would refuse.
 */
export function buildTaskEnvelope({
  business,
  project = null,
  workstream = null,
  task,
  generatedAt = new Date().toISOString(),
  suffix = `UI${Date.now().toString(36).toUpperCase().slice(-6)}`,
}) {
  const title = String(task?.title || '').trim()
  if (!title) throw new Error('Task title is required')

  const targetProject = project
    ? { code: project.code, name: project.name }
    : inboxProjectFor(business)
  const targetWorkstream = workstream
    ? {
        code: workstream.code,
        name: workstream.name,
        executionMode: workstream.executionMode,
        progressStrategy: workstream.progressStrategy || MODE_DEFAULT_STRATEGY[workstream.executionMode],
        progressWeight: workstream.progressWeight ?? 1,
      }
    : project
      ? generalWorkstreamFor(project)
      : inboxWorkstreamFor(business)

  const subtypes = allowedItemSubtypes(targetWorkstream.executionMode)
  const subtype = subtypes.includes(task.subtype) ? task.subtype : subtypes[0]
  if (!subtype) throw new Error(`No item subtype is allowed for mode ${targetWorkstream.executionMode}`)

  const metadata = {}
  const put = (key, value) => {
    const text = typeof value === 'string' ? value.trim() : value
    if (text !== undefined && text !== null && text !== '') metadata[key] = text
  }
  put('description', task.description)
  put('createdBy', task.createdBy)
  put('delegator', task.delegator)
  put('approver', task.approver)
  metadata.isStandalone = !project

  const usedCodes = new Set([targetProject.code, targetWorkstream.code])
  const weight = Number(task.weight)

  return {
    schemaVersion: '1.0',
    generatedBy: HUMAN_PLAN_GENERATOR,
    generatedAt,
    ...(project?.workspace?.code || task.workspaceCode
      ? { scope: { workspaceCode: project?.workspace?.code || task.workspaceCode } }
      : {}),
    project: targetProject,
    workstreams: [
      {
        ...targetWorkstream,
        items: [
          {
            code: uniqueCode('WI', title, usedCodes, suffix),
            subtype,
            title,
            status: task.status || 'PLANNED',
            weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
            metadata,
          },
        ],
      },
    ],
  }
}
