// @req FR-068 — the Roadmap UI is a Project Work sub-view and displays linked
// Business Goals from the single authorized read model.
// @spec SDD-039, ADR-028
// @tested tests/unit/project-roadmap-ui.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REASON_CODE_LABELS,
  humanizeEnumValue,
  reasonLabel,
  resolveContainerLabel,
  resolveItemLabel,
} from '@/modules/project-manager/application/project-roadmap-labels'

const page = readFileSync(resolve(process.cwd(), 'src/app/(pm)/projects/[projectId]/roadmap/page.jsx'), 'utf8')
const route = readFileSync(resolve(process.cwd(), 'src/app/api/projects/[id]/roadmap/route.js'), 'utf8')
const readModelSrc = readFileSync(
  resolve(process.cwd(), 'src/modules/project-manager/application/project-roadmap-read-model.js'),
  'utf8',
)

// Extracts every reason code the read model can actually emit, from both
// forms it uses: unavailable('CODE') / unavailable(cond ? 'A' : 'B'), and the
// one literal UNAVAILABLE object that does not go through the unavailable()
// helper (risks: { status: 'UNAVAILABLE', ..., reasonCode: 'CODE' }).
function extractReasonCodes(src) {
  const codes = new Set()
  const callRe = /unavailable\(([^)]*)\)/g
  let match
  while ((match = callRe.exec(src))) {
    const literalRe = /'([A-Z][A-Z0-9_]*)'/g
    let literalMatch
    while ((literalMatch = literalRe.exec(match[1]))) codes.add(literalMatch[1])
  }
  const literalReasonRe = /reasonCode:\s*'([A-Z][A-Z0-9_]*)'/g
  while ((match = literalReasonRe.exec(src))) codes.add(match[1])
  return codes
}

// Extracts the deadlineState enum's declared value list from the read
// model's zod schema, so the humanizer is checked against the real
// vocabulary rather than a hand-copied guess of it.
function extractDeadlineStates(src) {
  const match = src.match(/deadlineState:\s*z\.enum\(\[([^\]]*)\]\)/)
  if (!match) return []
  return Array.from(match[1].matchAll(/'([A-Z_]+)'/g)).map((entry) => entry[1])
}

describe('Execution Roadmap UI boundary', () => {
  it('uses one Project Roadmap response and renders Business Goals', () => {
    expect(page).toContain("/api/projects/${projectId}/roadmap")
    expect(page).toContain('Business Goals')
    expect(page).toContain('No Business Goals linked')
    expect(page).toContain('aria-label="Roadmap dependency list"')
    expect(page).toContain('<WorkViewTabs projectId={projectId} />')
  })

  it('renders the roadmap contract fields and explicit unavailable states', () => {
    expect(page).toContain('Linked Business Goal IDs')
    expect(page).toContain('Project risk IDs')
    expect(page).toContain('Active source')
    expect(page).toContain('Identity references')
    expect(page).toContain('Execution plan identities')
    expect(page).toContain('Progress evidence')
    expect(page).toContain('Completion evidence')
    expect(page).toContain('Blocker owner')
    expect(page).toContain('carry-over')
    expect(page).toContain('<ul')
  })

  it('authorizes the server-side Roadmap route through the request viewer', () => {
    expect(route).toContain('resolveRequestViewer(request)')
    expect(route).toContain('getProjectRoadmap(params.id, { viewer })')
  })

  // --- UAT presentation fixes -------------------------------------------

  it('never prints a raw UNAVAILABLE reason code to the reader', () => {
    // The old defect: `Unavailable ({value.reasonCode})` rendered e.g.
    // "Unavailable (TAGS_NOT_MODELED)" straight from the wire.
    expect(page).not.toMatch(/Unavailable \(\{/)
    expect(page).toContain('reasonLabel(value.reasonCode)')
  })

  it('labels every UNAVAILABLE reason code the read model can actually emit', () => {
    const codes = extractReasonCodes(readModelSrc)
    // Plausibility guard: this must not pass by matching nothing.
    expect(codes.size).toBeGreaterThanOrEqual(10)
    for (const code of codes) {
      expect(REASON_CODE_LABELS).toHaveProperty(code)
      expect(typeof REASON_CODE_LABELS[code]).toBe('string')
      expect(REASON_CODE_LABELS[code].length).toBeGreaterThan(0)
      expect(reasonLabel(code)).toBe(REASON_CODE_LABELS[code])
    }
  })

  it('distinguishes "not modeled" from "modeled but unresolved" reason codes', () => {
    expect(REASON_CODE_LABELS.TAGS_NOT_MODELED).toMatch(/not modeled/i)
    expect(REASON_CODE_LABELS.NO_ASSIGNEE).not.toMatch(/not modeled/i)
    expect(REASON_CODE_LABELS.ASSIGNEE_NOT_RESOLVED).not.toMatch(/not modeled/i)
    expect(REASON_CODE_LABELS.TAGS_NOT_MODELED).not.toBe(REASON_CODE_LABELS.NO_ASSIGNEE)
  })

  it('falls back to a human sentence for a reason code the label map does not know yet', () => {
    expect(reasonLabel('SOME_FUTURE_CODE_NOBODY_MAPPED')).toMatch(/[a-z]/)
    expect(reasonLabel('SOME_FUTURE_CODE_NOBODY_MAPPED')).not.toBe('SOME_FUTURE_CODE_NOBODY_MAPPED')
  })

  it('derives the Deadline label from deadlineState instead of hand-copying it', () => {
    expect(page).not.toContain('Deadline: ${data.summary.deadlineState}')
    expect(page).toContain('humanizeEnumValue(data.summary.deadlineState)')
    const states = extractDeadlineStates(readModelSrc)
    expect(states.length).toBeGreaterThanOrEqual(3)
    for (const state of states) {
      expect(humanizeEnumValue(state)).not.toBe(state)
      expect(humanizeEnumValue(state)).not.toMatch(/_/)
    }
    expect(humanizeEnumValue('ON_TRACK')).toBe('On Track')
    expect(humanizeEnumValue(null)).toBe('—')
  })

  it('never prints a bare uuid as body text', () => {
    expect(page).not.toContain('gate_id={gate.id}')
    expect(page).not.toContain('{item.typedId.key}={item.typedId.value}')
    expect(page).not.toContain('{container.typedId.key}={container.typedId.value}')
    expect(page).not.toContain('Plan ID: {plan.planId}')
    expect(page).not.toContain('Parent: {container.parentContainerId')
    expect(page).not.toContain('Current container: {plan.currentContainerId')
    expect(page).not.toContain('Affected item: {edge.affectedItemId')
    expect(page).not.toContain('{edge.source.endpointType}:{edge.source.endpointId}')
  })

  it('keeps every raw id reachable (title attribute) instead of deleting it', () => {
    expect(page).toContain('title={`${item.typedId.key} = ${item.typedId.value}`}')
    expect(page).toContain('title={`${container.typedId.key} = ${container.typedId.value}`}')
    expect(page).toContain('title={`Plan ID: ${plan.planId}`}')
    expect(page).toContain('title={`Gate ID: ${gate.id}`}')
    expect(page).toContain('Current container ID: ${plan.currentContainerId}')
    expect(page).toContain('Parent container ID: ${container.parentContainerId}')
    expect(page).toContain('${edge.source.endpointType}:${edge.source.endpointId}')
  })

  it('resolves container and item ids to their human code where the data is available', () => {
    const containers = [{ containerId: 'c-1', code: 'SPR-1' }, { containerId: 'c-2', code: 'REL-2' }]
    expect(resolveContainerLabel(containers, 'c-2')).toBe('REL-2')
    expect(resolveContainerLabel(containers, null)).toBe(null)
    expect(resolveContainerLabel(containers, 'missing')).toBe('Unresolved container')

    const items = [{ workItemId: 'i-1', code: 'TASK-1' }]
    expect(resolveItemLabel(items, 'i-1')).toBe('TASK-1')
    expect(resolveItemLabel(items, null)).toBe(null)
    expect(resolveItemLabel(items, 'missing')).toBe('Unresolved item')
  })
})
