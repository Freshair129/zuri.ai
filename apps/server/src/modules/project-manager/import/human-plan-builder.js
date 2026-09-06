import {
  EXECUTION_MODES,
  EXECUTION_MODE_CONTRACTS,
  MODE_DEFAULT_STRATEGY,
} from '@/lib/validation/enums'

// @req FR-017, FR-069 — the Human Plan Builder turns plain form input into the
// same PlanEnvelope consumed by the shared dry-run/commit pipeline.
// @spec BR-003, BR-009, SDD-006
// @tested tests/unit/human-plan-builder.test.js

export const HUMAN_PLAN_GENERATOR = 'zuri-v2 UI plan builder'

export function slug(value, maxLength = 18) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .toUpperCase()
    .slice(0, maxLength)
    .replace(/-+$/g, '')
  return normalized || 'X'
}

export function uniqueCode(prefix, value, usedCodes, suffix) {
  const base = `${prefix}-${slug(value)}`
  let code = `${base}-${suffix}`
  let counter = 2
  while (usedCodes.has(code)) code = `${base}-${suffix}-${counter++}`
  usedCodes.add(code)
  return code
}

function normalizeMode(mode) {
  return EXECUTION_MODES.includes(mode) ? mode : EXECUTION_MODES[0]
}

export function buildHumanPlan({
  objective,
  description = '',
  targetAt = '',
  workspaceCode = '',
  streams = [],
  generatedAt = new Date().toISOString(),
  suffix = `UI${Date.now().toString(36).toUpperCase().slice(-6)}`,
}) {
  const name = String(objective || '').trim()
  if (!name) throw new Error('Project objective is required')

  const usedCodes = new Set()
  const workstreams = streams
    .filter((stream) => String(stream?.name || '').trim())
    .map((stream) => {
      const streamName = String(stream.name).trim()
      const mode = normalizeMode(stream.mode)
      const contract = EXECUTION_MODE_CONTRACTS[mode]
      const items = String(stream.itemsText || '')
        .split('\n')
        .map((title) => title.trim())
        .filter(Boolean)
        .map((title) => ({
          code: uniqueCode('WI', title, usedCodes, suffix),
          subtype: contract.itemSubtypes[0],
          title,
          status: 'PLANNED',
        }))

      return {
        code: uniqueCode('WST', streamName, usedCodes, suffix),
        name: streamName,
        executionMode: mode,
        progressStrategy: MODE_DEFAULT_STRATEGY[mode],
        progressWeight: 1,
        items,
      }
    })

  return {
    schemaVersion: '1.0',
    generatedBy: HUMAN_PLAN_GENERATOR,
    generatedAt,
    scope: workspaceCode ? { workspaceCode } : {},
    project: {
      code: uniqueCode('PRJ', name, usedCodes, suffix),
      name,
      ...(String(description).trim() ? { description: String(description).trim() } : {}),
      ...(targetAt ? { targetAt } : {}),
      type: 'GENERAL',
      status: 'PLANNED',
    },
    workstreams,
  }
}
