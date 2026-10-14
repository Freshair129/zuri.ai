// @req FR-012 — the manual JSON intake click sends PlanEnvelope data, never the UI event.
import React from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  state: [],
  cursor: 0,
  api: vi.fn(async () => ({
    valid: true,
    preview: { inserts: [], updates: [], conflicts: [], dependencyCount: 0 },
    workspace: { code: 'WS-1' },
  })),
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useState(initialValue) {
      const index = harness.cursor++
      if (!(index in harness.state)) {
        harness.state[index] = typeof initialValue === 'function' ? initialValue() : initialValue
      }
      return [harness.state[index], (nextValue) => {
        harness.state[index] = typeof nextValue === 'function' ? nextValue(harness.state[index]) : nextValue
      }]
    },
    useRef(initialValue) {
      const index = harness.cursor++
      if (!(index in harness.state)) harness.state[index] = { current: initialValue }
      return harness.state[index]
    },
  }
})

vi.mock('lucide-react', () => ({
  Download: () => null,
  FileSpreadsheet: () => null,
  WandSparkles: () => null,
}))

vi.mock('@/components/ui', () => ({
  Card: () => null,
  EmptyState: () => null,
  PageHeader: () => null,
  SectionTitle: () => null,
}))

vi.mock('@/context/ScopeContext', () => ({
  useScope: () => ({ scopedWorkspaces: [], refresh: vi.fn() }),
}))

vi.mock('@/modules/project-manager/components/useApi', () => ({
  api: (...args) => harness.api(...args),
  useFetch: () => ({ data: { workspaceId: 'workspace-1' } }),
}))

vi.mock('@/modules/project-manager/components/HumanPlanBuilderModal', () => ({
  default: () => null,
}))

let PlanImportPanel

beforeAll(async () => {
  // esbuild's classic JSX output references React.createElement directly.
  globalThis.React = React
  ;({ default: PlanImportPanel } = await import('@/modules/project-manager/views/PlanImportPanel'))
})

function renderPanel() {
  harness.cursor = 0
  return PlanImportPanel({ projectId: 'project-1' })
}

function findElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate)
      if (found) return found
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const value of Object.values(node.props || {})) {
    const found = findElement(value, predicate)
    if (found) return found
  }
  return null
}

describe('PlanImportPanel dry-run click handler', () => {
  beforeEach(() => {
    harness.state = []
    harness.cursor = 0
    harness.api.mockClear()
  })

  it('uses the parsed JSON plan and selected target scope, never the circular click event', async () => {
    const plan = {
      schemaVersion: '1.0',
      project: { code: 'PRJ-CLICK-1', name: 'Click handler test' },
      workstreams: [{ code: 'WST-CLICK-1', name: 'Operations', executionMode: 'OPERATIONS', progressStrategy: 'SLA_SCORE' }],
    }
    const textarea = findElement(renderPanel(), (element) => element.type === 'textarea')
    textarea.props.onChange({ target: { value: JSON.stringify(plan) } })

    const button = findElement(
      renderPanel(),
      (element) => element.type === 'button' && element.props.children === 'Validate + dry run',
    )
    const clickEvent = { type: 'click' }
    clickEvent.currentTarget = clickEvent

    await button.props.onClick(clickEvent)

    expect(harness.api).toHaveBeenCalledTimes(1)
    expect(harness.api).toHaveBeenCalledWith('/api/import/dry-run', {
      method: 'POST',
      body: { plan, workspaceId: 'workspace-1', projectId: 'project-1' },
    })
  })
})
