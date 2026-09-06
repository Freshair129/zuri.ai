// @req FR-040 — deterministic fixtures for the project-local Dependency Map.
// @spec SDD-019, ADR-012

export const PROJECT_A = {
  id: 'project-a',
  entityKeys: new Set([
    'PROJECT:project-a',
    'WORKSTREAM:stream-a',
    'WORK_ITEM:item-a-1',
    'WORK_ITEM:item-a-2',
  ]),
}

export const PROJECT_B = {
  id: 'project-b',
  entityKeys: new Set(['PROJECT:project-b', 'WORKSTREAM:stream-b']),
}

export const PROJECT_DEPENDENCY_FIXTURES = [
  {
    id: 'dep-a-internal',
    sourceType: 'WORK_ITEM',
    sourceId: 'item-a-1',
    targetType: 'WORK_ITEM',
    targetId: 'item-a-2',
    dependencyType: 'BLOCKS',
    source: { code: 'WI-A1', title: 'Design', status: 'DONE' },
    target: { code: 'WI-A2', title: 'Build', status: 'IN_PROGRESS' },
  },
  {
    id: 'dep-cross-project',
    sourceType: 'WORKSTREAM',
    sourceId: 'stream-a',
    targetType: 'WORKSTREAM',
    targetId: 'stream-b',
    dependencyType: 'REQUIRES',
    source: { code: 'WS-A', title: 'Project A delivery' },
    target: { code: 'WS-B', title: 'Project B delivery' },
  },
]
