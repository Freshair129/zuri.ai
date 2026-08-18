import { describe, expect, it } from 'vitest'
import { buildHumanPlan, HUMAN_PLAN_GENERATOR } from '@/modules/project-manager/import/human-plan-builder'

// @req FR-017, FR-069 — prove the popup form's normalized object is a valid
// shared PlanEnvelope shape before the browser sends it to the import API.
// @spec BR-003, BR-009
// @tested tests/unit/human-plan-builder.test.js

describe('Human Plan Builder', () => {
  it('builds one PlanEnvelope from objective, Space, modes and starter items', () => {
    const plan = buildHumanPlan({
      objective: 'เปิดสาขาเชียงใหม่',
      description: 'เตรียมสาขาแรก',
      targetAt: '2026-12-31',
      workspaceCode: 'WS-B01-MIG',
      suffix: 'UI123',
      generatedAt: '2026-08-19T00:00:00.000Z',
      streams: [
        { name: 'หาทำเล', mode: 'BUSINESS_EXPANSION', itemsText: 'สำรวจทำเล\nสรุปข้อเสนอ' },
        { name: 'วางระบบ', mode: 'OPERATIONS', itemsText: '' },
        { name: '', mode: 'SOFTWARE_SPRINT', itemsText: 'ignored' },
      ],
    })

    expect(plan).toMatchObject({
      schemaVersion: '1.0',
      generatedBy: HUMAN_PLAN_GENERATOR,
      generatedAt: '2026-08-19T00:00:00.000Z',
      scope: { workspaceCode: 'WS-B01-MIG' },
      project: { name: 'เปิดสาขาเชียงใหม่', description: 'เตรียมสาขาแรก', targetAt: '2026-12-31', status: 'PLANNED' },
    })
    expect(plan.workstreams).toHaveLength(2)
    expect(plan.workstreams[0]).toMatchObject({
      name: 'หาทำเล',
      executionMode: 'BUSINESS_EXPANSION',
      progressStrategy: 'EXPANSION_READINESS',
    })
    expect(plan.workstreams[0].items).toHaveLength(2)
    expect(plan.workstreams[0].items[0]).toMatchObject({ title: 'สำรวจทำเล', status: 'PLANNED' })
    expect(plan.workstreams[1].items).toEqual([])
  })

  it('requires an objective and keeps generated entity codes unique', () => {
    expect(() => buildHumanPlan({ streams: [] })).toThrow(/objective/i)
    const plan = buildHumanPlan({
      objective: 'Same',
      suffix: 'FIXED',
      streams: [
        { name: 'Same', mode: 'SOFTWARE_SPRINT', itemsText: 'Task\nTask' },
        { name: 'Same', mode: 'SOFTWARE_SPRINT', itemsText: 'Task' },
      ],
    })
    const codes = [plan.project.code, ...plan.workstreams.flatMap((stream) => [stream.code, ...stream.items.map((item) => item.code)])]
    expect(new Set(codes).size).toBe(codes.length)
  })
})
