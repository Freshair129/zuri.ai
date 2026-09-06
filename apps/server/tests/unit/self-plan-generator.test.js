import { describe, it, expect } from 'vitest'
import { buildSelfPlan, assertModeVocabulary } from '../../scripts/self-plan.mjs'
import { EXECUTION_MODE_CONTRACTS } from '@/lib/validation/enums'
import { validatePlanSemantics } from '@/modules/project-manager/import/plan-schema'

// @req FR-012, FR-069 — the dogfood generator writes a real PlanEnvelope, so it is
//   bound by the same execution-mode contract as any other intake artifact.
// @spec ADR-009 §D5, BR-004, BR-009
// @tested tests/unit/self-plan-generator.test.js
//
// The defect this pins: the generator emitted `APPROVAL` for an ADR node and
// `DELIVERABLE` for a document node into a SOFTWARE_SPRINT workstream. Those subtypes
// belong to BUSINESS_EXPANSION and PRODUCT_LAUNCH, so `validatePlanSemantics` rejected
// every one of them and the generated file could never be imported through the pipeline
// its own header points at. Importing the module must not write a file — that is why
// `buildSelfPlan` is pure and the CLI is guarded by a main-module check.

const graph = {
  nodes: [
    { id: 'req:FR-001', type: 'requirement', family: 'FR', label: 'Scope hierarchy', declared: 'done' },
    { id: 'spec:ADR-009-governance', type: 'adr', title: 'ADR-009 — Governance IR', path: 'docs/decisions/ADR-009.md' },
    { id: 'doc:PRODUCT', type: 'doc', title: 'PRODUCT.md', path: 'docs/PRODUCT.md', status: 'active' },
    { id: 'doc:OLD-PRODUCT', type: 'doc', title: 'Old product brief', path: 'docs/archive/OLD.md', status: 'superseded' },
  ],
  edges: [
    { from: 'code:src/modules/project-manager/application/scope-service.js', to: 'req:FR-001', type: 'implements' },
    { from: 'test:tests/integration/project-core.test.js', to: 'req:FR-001', type: 'verifies' },
    { from: 'doc:PRODUCT', to: 'doc:OLD-PRODUCT', type: 'supersedes' },
    { from: 'spec:ADR-009-governance', to: 'doc:PRODUCT', type: 'relates' },
  ],
}

describe('self-plan generator', () => {
  const envelope = buildSelfPlan(graph)

  it('produces an envelope the intake pipeline accepts', () => {
    expect(validatePlanSemantics(envelope)).toEqual([])
  })

  it('emits only item subtypes the workstream execution mode allows', () => {
    for (const ws of envelope.workstreams) {
      const allowed = EXECUTION_MODE_CONTRACTS[ws.executionMode].itemSubtypes
      for (const item of ws.items) expect(allowed).toContain(item.subtype)
    }
  })

  it('takes the progress strategy from the mode contract, not a copied string', () => {
    for (const ws of envelope.workstreams) {
      expect(ws.progressStrategy).toBe(EXECUTION_MODE_CONTRACTS[ws.executionMode].progressStrategy)
    }
  })

  it('keeps the governance record kind in metadata now that subtype cannot carry it', () => {
    const items = envelope.workstreams.flatMap((ws) => ws.items)
    const kinds = Object.fromEntries(items.map((i) => [i.code, i.metadata.kind]))
    expect(kinds['GOV-ADR-009']).toBe('adr')
    expect(kinds['GOV-DOC-PRODUCT']).toBe('document')
    expect(kinds['GOV-FR-001']).toBe('requirement')
  })

  it('carries lineage edges as dependencies whose endpoints exist in the envelope', () => {
    const codes = new Set(envelope.workstreams.flatMap((ws) => ws.items.map((i) => i.code)))
    expect(envelope.dependencies.length).toBeGreaterThan(0)
    for (const dep of envelope.dependencies) {
      expect(codes.has(dep.sourceRef)).toBe(true)
      expect(codes.has(dep.targetRef)).toBe(true)
    }
  })

  it('refuses to hand back an envelope carrying a foreign subtype', () => {
    const smuggled = {
      workstreams: [
        {
          code: 'WST-GOV-GOVERNANCE',
          executionMode: 'SOFTWARE_SPRINT',
          progressStrategy: 'TASK_WEIGHT',
          items: [{ code: 'GOV-ADR-009', subtype: 'APPROVAL' }],
        },
      ],
    }
    expect(() => assertModeVocabulary(smuggled)).toThrow(/APPROVAL.*not allowed in SOFTWARE_SPRINT/)
  })

  it('refuses a strategy that does not belong to the mode', () => {
    const mismatched = {
      workstreams: [
        {
          code: 'WST-GOV-GOVERNANCE',
          executionMode: 'SOFTWARE_SPRINT',
          progressStrategy: 'KPI_ATTAINMENT',
          items: [],
        },
      ],
    }
    expect(() => assertModeVocabulary(mismatched)).toThrow(/requires progressStrategy TASK_WEIGHT/)
  })
})
