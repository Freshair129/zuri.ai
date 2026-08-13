// @req FR-040 — project-local Dependency Map read contract.
// @spec SDD-019, ADR-012
// @tested tests/unit/project-dependency-map.test.js

export const PROJECT_DEPENDENCY_GRAPH_VERSION = '1.0'

export const PROJECT_DEPENDENCY_ENDPOINT_TYPES = Object.freeze([
  'PROJECT',
  'WORKSTREAM',
  'MILESTONE',
  'GATE',
  'WORK_CONTAINER',
  'WORK_ITEM',
])

export const dependencyNodeKey = (type, id) => `${type}:${id}`

const endpointLabel = (endpoint, type, id) => ({
  type,
  id,
  code: endpoint?.code || null,
  title: endpoint?.title || endpoint?.name || endpoint?.code || `${type} ${id}`,
  status: endpoint?.status || null,
})

/**
 * Project-local graph projection. `entityKeys` is the complete set of canonical
 * endpoint keys owned by the opened Project. Both edge endpoints must be in that
 * set; this is deliberately stricter than the global dependency list filter.
 */
export function projectDependencyGraph({ projectId, dependencies = [], entityKeys }) {
  if (!projectId) throw new Error('projectId is required')
  if (!(entityKeys instanceof Set)) throw new Error('entityKeys must be a Set')

  const contained = dependencies
    .filter((dependency) => isProjectContainedDependency(dependency, entityKeys))
    .sort(compareDependencies)

  const nodes = new Map()
  const edges = contained.map((dependency) => {
    const sourceId = dependencyNodeKey(dependency.sourceType, dependency.sourceId)
    const targetId = dependencyNodeKey(dependency.targetType, dependency.targetId)
    nodes.set(sourceId, {
      ...endpointLabel(dependency.source, dependency.sourceType, dependency.sourceId),
      id: sourceId,
    })
    nodes.set(targetId, {
      ...endpointLabel(dependency.target, dependency.targetType, dependency.targetId),
      id: targetId,
    })
    return {
      id: dependency.id,
      source: sourceId,
      target: targetId,
      dependencyType: dependency.dependencyType,
      label: dependency.dependencyType.replace(/_/g, ' '),
    }
  })

  return {
    version: PROJECT_DEPENDENCY_GRAPH_VERSION,
    projectId,
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges,
  }
}

export function isProjectContainedDependency(dependency, entityKeys) {
  if (!dependency || !(entityKeys instanceof Set)) return false
  return entityKeys.has(dependencyNodeKey(dependency.sourceType, dependency.sourceId))
    && entityKeys.has(dependencyNodeKey(dependency.targetType, dependency.targetId))
}

function compareDependencies(a, b) {
  const left = [
    dependencyNodeKey(a.sourceType, a.sourceId),
    dependencyNodeKey(a.targetType, a.targetId),
    a.dependencyType,
    a.id,
  ].join('|')
  const right = [
    dependencyNodeKey(b.sourceType, b.sourceId),
    dependencyNodeKey(b.targetType, b.targetId),
    b.dependencyType,
    b.id,
  ].join('|')
  return left.localeCompare(right)
}
