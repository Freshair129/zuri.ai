// @req FR-040 — project-local Dependency Map projection.
// @spec SDD-019, ADR-012
// @tested tests/unit/project-dependency-map.test.js
import { describe, expect, it } from 'vitest'
import {
  dependencyNodeKey,
  isProjectContainedDependency,
  projectDependencyGraph,
} from '@/modules/project-manager/application/project-dependency-map'
import { PROJECT_A, PROJECT_DEPENDENCY_FIXTURES } from '../fixtures/project-dependency-map'

describe('projectDependencyGraph', () => {
  it('projects only edges whose source and target belong to the opened project', () => {
    const graph = projectDependencyGraph({
      projectId: PROJECT_A.id,
      dependencies: PROJECT_DEPENDENCY_FIXTURES,
      entityKeys: PROJECT_A.entityKeys,
    })

    expect(graph.version).toBe('1.0')
    expect(graph.projectId).toBe('project-a')
    expect(graph.edges).toEqual([
      {
        id: 'dep-a-internal',
        source: 'WORK_ITEM:item-a-1',
        target: 'WORK_ITEM:item-a-2',
        dependencyType: 'BLOCKS',
        label: 'BLOCKS',
      },
    ])
    expect(graph.nodes.map((node) => node.id)).toEqual(['WORK_ITEM:item-a-1', 'WORK_ITEM:item-a-2'])
    expect(graph.nodes.map((node) => node.code)).toEqual(['WI-A1', 'WI-A2'])
  })

  it('sorts graph output deterministically independent of input order', () => {
    const reversed = projectDependencyGraph({
      projectId: PROJECT_A.id,
      dependencies: [...PROJECT_DEPENDENCY_FIXTURES].reverse(),
      entityKeys: PROJECT_A.entityKeys,
    })
    const ordered = projectDependencyGraph({
      projectId: PROJECT_A.id,
      dependencies: PROJECT_DEPENDENCY_FIXTURES,
      entityKeys: PROJECT_A.entityKeys,
    })

    expect(reversed).toEqual(ordered)
  })

  it('uses stable endpoint keys for containment checks', () => {
    expect(dependencyNodeKey('PROJECT', 'project-a')).toBe('PROJECT:project-a')
    expect(isProjectContainedDependency(PROJECT_DEPENDENCY_FIXTURES[0], PROJECT_A.entityKeys)).toBe(true)
    expect(isProjectContainedDependency(PROJECT_DEPENDENCY_FIXTURES[1], PROJECT_A.entityKeys)).toBe(false)
  })

  it('rejects incomplete contract inputs', () => {
    expect(() => projectDependencyGraph({ dependencies: [], entityKeys: PROJECT_A.entityKeys })).toThrow('projectId is required')
    expect(() => projectDependencyGraph({ projectId: PROJECT_A.id, dependencies: [], entityKeys: [] })).toThrow('entityKeys must be a Set')
  })
})
