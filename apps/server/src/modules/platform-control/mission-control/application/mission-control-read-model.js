import { PROGRAMME_CONTAINERS } from '@/modules/platform-control/program-roadmap-containers'
import { PROGRAMME_LANES } from '@/modules/platform-control/program-roadmap-telemetry'
import { ROADMAP_SOT, ROADMAP_TASK_LEDGER } from '@/modules/platform-control/roadmap-sot'
import { parseProgrammeOrchestrationObservation } from '@/modules/platform-control/mission-control/mission-control-contract'

// @req FR-260 — join the canonical roadmap DAG with an operator-only,
// read-only orchestration projection.
// @req FR-262 — distinguish same-wave candidate-parallel work from merge-safe
// work with explicit dependency, owner, lane, shared-file, revision and
// capability-identity gates.
// @spec ADR-048 D3, ADR-086 D1/D7, ADR-092 D3
// @tested tests/unit/mission-control-read-model.test.js

export const MISSION_CONTROL_SCHEMA_VERSION = 'mission-control.v1'
export const MISSION_CONTROL_GATE_STATES = Object.freeze(['PASS', 'FAIL', 'UNKNOWN'])
export const MISSION_CONTROL_MERGE_STATES = Object.freeze(['MERGE_SAFE', 'NOT_SAFE', 'UNKNOWN'])

const UNKNOWN_SOURCE = Object.freeze({ kind: 'PORL', ref: 'unconfigured' })

const SPECIAL_BLOCKER_FAMILIES = [
  {
    id: 'LINE-TEST-CHANNEL',
    label: 'Real LINE test-channel acceptance',
    taskIds: ['TASK-ZAI-081'],
    externalDependency: null,
  },
  {
    id: 'MSP-MEMORY-CHAIN',
    label: 'MSP memory and erasure dependency chain',
    taskIds: ['TASK-ZAI-100', 'TASK-ZAI-101', 'TASK-ZAI-102'],
    externalDependency: 'MSP',
  },
]

const SHARED_SOURCE_PATHS = new Set([
  'docs/roadmap/ROADMAP.md',
  'apps/server/src/modules/platform-control/roadmap-sot.js',
])

function dependencyIds(task) {
  if (Array.isArray(task?.dependsOn)) return task.dependsOn.filter(Boolean)
  if (!task?.dependsOn || task.dependsOn === '—') return []
  return String(task.dependsOn).split(';').map((id) => id.trim()).filter(Boolean)
}

function laneMatches(taskId, lanes) {
  return lanes.filter((lane) => Array.isArray(lane.tasks) && lane.tasks.includes(taskId))
}

function taskContainer(taskId, containers) {
  if (containers instanceof Map) return containers.get(taskId) || {}
  return containers?.[taskId] || {}
}

function gate(id, state, reason, source = 'ROADMAP.md') {
  return { id, state, reason, source }
}

function blocked(task) {
  return task?.status === 'blocked' || task?.implementationState === 'BLOCKED'
}

function buildDependencyMap(tasks) {
  return new Map(tasks.map((task) => [task.id, dependencyIds(task)]))
}

function reaches(start, target, dependencyMap) {
  const pending = [...(dependencyMap.get(start) || [])]
  const visited = new Set()
  while (pending.length) {
    const current = pending.pop()
    if (current === target) return true
    if (visited.has(current)) continue
    visited.add(current)
    pending.push(...(dependencyMap.get(current) || []))
  }
  return false
}

function selectObservation(existing, next) {
  if (!existing) return next
  const existingAt = existing.source.observedAt || existing.source.capturedAt || ''
  const nextAt = next.source.observedAt || next.source.capturedAt || ''
  return nextAt >= existingAt ? next : existing
}

function observationMap(porlResult = {}) {
  const observations = new Map()
  let invalidCount = Number(porlResult.invalidCount) || 0
  for (const item of porlResult.observations || []) {
    const parsed = parseProgrammeOrchestrationObservation(item)
    if (!parsed.ok) {
      invalidCount += 1
      continue
    }
    observations.set(parsed.value.taskId, selectObservation(observations.get(parsed.value.taskId), parsed.value))
  }
  return { observations, invalidCount }
}

function unknownExecution(reason) {
  return {
    freshness: 'UNKNOWN',
    runState: 'UNKNOWN',
    proofScope: 'UNKNOWN',
    source: null,
    observedAt: null,
    capturedAt: null,
    reason,
    checks: [{
      kind: 'orchestration',
      state: 'NOT_RUN',
      scope: 'UNKNOWN',
      evidenceRefs: [],
      reason,
    }],
    changedFiles: { state: 'UNKNOWN', paths: [], sourceRef: null },
    evidenceRefs: [],
    assignment: { ownerRef: null, workerRef: null, threadRef: null },
    revision: { branch: null, worktreeRef: null, baseCommit: null, headCommit: null },
    laneId: null,
    capabilityKey: null,
  }
}

function projectExecution(observation, reason) {
  if (!observation) return unknownExecution(reason)
  return {
    freshness: observation.freshness,
    runState: observation.runState,
    proofScope: observation.proofScope,
    source: observation.source,
    observedAt: observation.source.observedAt,
    capturedAt: observation.source.capturedAt,
    reason: observation.reason,
    checks: observation.checks.map((check) => ({ ...check, reason: check.state === 'UNKNOWN' ? observation.reason : null })),
    changedFiles: observation.changedFiles,
    evidenceRefs: observation.evidenceRefs,
    assignment: observation.assignment,
    revision: observation.revision,
    laneId: observation.laneId,
    capabilityKey: observation.capabilityKey,
  }
}

function dependencyGate(left, right, taskById, dependencyMap) {
  const involved = [left, right]
  const dependencies = [...new Set(involved.flatMap((task) => dependencyMap.get(task.id) || []))]
    .map((id) => taskById.get(id))
  const missing = dependencies.filter((task) => !task)
  if (missing.length) return gate('dependency', 'UNKNOWN', 'A declared dependency is absent from the roadmap projection')
  const blockedDependencies = dependencies.filter(blocked)
  if (blockedDependencies.length || involved.some(blocked)) {
    const ids = [...blockedDependencies, ...involved.filter(blocked)].map((task) => task.id)
    return gate('dependency', 'FAIL', 'blocked roadmap task: ' + [...new Set(ids)].join(', '))
  }
  const unresolved = dependencies.filter((task) => task.status !== 'done')
  if (unresolved.length) return gate('dependency', 'UNKNOWN', 'predecessor is not resolved: ' + unresolved.map((task) => task.id).join(', '))
  return gate('dependency', 'PASS', 'same-wave tasks have no dependency path and all predecessors are resolved')
}

function ownerGate(left, right) {
  const tasks = [left, right]
  if (tasks.some((task) => !task.owner)) return gate('owner-assignment', 'FAIL', 'a roadmap task has no declared owner')
  const missing = tasks.filter((task) => !task.execution.assignment.ownerRef || !task.execution.assignment.workerRef)
  if (missing.length) return gate('owner-assignment', 'UNKNOWN', 'PORL has not supplied one compatible active assignment per task')
  const mismatched = tasks.filter((task) => task.execution.assignment.ownerRef !== task.owner)
  if (mismatched.length) return gate('owner-assignment', 'FAIL', 'PORL owner does not match the declared owner for ' + mismatched.map((task) => task.id).join(', '))
  return gate('owner-assignment', 'PASS', 'declared owner and PORL assignment agree')
}

function laneGate(left, right) {
  const tasks = [left, right]
  if (tasks.some((task) => task.laneIds.length === 0)) return gate('lane', 'UNKNOWN', 'one task has no declared programme lane')
  if (tasks.some((task) => task.laneIds.length > 1)) return gate('lane', 'FAIL', 'a task belongs to more than one lane')
  const missing = tasks.filter((task) => !task.execution.laneId)
  if (missing.length) return gate('lane', 'UNKNOWN', 'PORL has not mapped every observation to its declared lane')
  const invalid = tasks.filter((task) => !task.laneIds.includes(task.execution.laneId))
  if (invalid.length) return gate('lane', 'FAIL', 'PORL lane mismatch for ' + invalid.map((task) => task.id).join(', '))
  const branchMismatch = tasks.filter((task) => {
    const lane = task.lanes[0]
    return lane?.branches?.length > 0 && task.execution.revision.branch && !lane.branches.includes(task.execution.revision.branch)
  })
  if (branchMismatch.length) return gate('lane', 'FAIL', 'branch is not permitted by the declared lane for ' + branchMismatch.map((task) => task.id).join(', '))
  return gate('lane', 'PASS', 'each observation maps to one declared lane and permitted branch')
}

function sharedFileGate(left, right) {
  const tasks = [left, right]
  if (tasks.some((task) => task.execution.changedFiles.state !== 'KNOWN')) {
    return gate('shared-file', 'UNKNOWN', 'PORL has not supplied a trustworthy changed-file manifest')
  }
  const paths = tasks.map((task) => new Set(task.execution.changedFiles.paths))
  const overlap = [...paths[0]].filter((path) => paths[1].has(path))
  if (overlap.length) return gate('shared-file', 'FAIL', 'changed-file overlap: ' + overlap.join(', '))
  const sharedSource = tasks.flatMap((task) => task.execution.changedFiles.paths).filter((path) => SHARED_SOURCE_PATHS.has(path))
  if (sharedSource.length) return gate('shared-file', 'FAIL', 'shared source path requires serial integration: ' + [...new Set(sharedSource)].join(', '))
  return gate('shared-file', 'PASS', 'changed-file manifests are disjoint')
}

function revisionGate(left, right) {
  const tasks = [left, right]
  const incomplete = tasks.filter((task) => {
    const revision = task.execution.revision
    return !revision.branch || !revision.worktreeRef || !revision.baseCommit || !revision.headCommit
  })
  if (incomplete.length) return gate('revision', 'UNKNOWN', 'PORL has not supplied a complete branch, worktree and base/head revision tuple')
  return gate('revision', 'PASS', 'base, head, branch and worktree identities are present')
}

function capabilityGate(left, right) {
  const keys = [left.execution.capabilityKey, right.execution.capabilityKey].filter(Boolean)
  if (keys.length === 2 && keys[0] === keys[1]) {
    return gate('capability-identity', 'FAIL', 'duplicate capability key has no explicit adapter, fallback or replacement relation')
  }
  return gate('capability-identity', 'PASS', 'no duplicate capability key was observed')
}

export function evaluateMergeGates(left, right, taskById, dependencyMap) {
  return [
    dependencyGate(left, right, taskById, dependencyMap),
    ownerGate(left, right),
    laneGate(left, right),
    sharedFileGate(left, right),
    revisionGate(left, right),
    capabilityGate(left, right),
  ]
}

function candidatePair(left, right, wave, taskById, dependencyMap) {
  const gates = evaluateMergeGates(left, right, taskById, dependencyMap)
  const firstUnmet = gates.find((item) => item.state !== 'PASS') || null
  const mergeState = firstUnmet?.state === 'FAIL'
    ? 'NOT_SAFE'
    : firstUnmet
      ? 'UNKNOWN'
      : 'MERGE_SAFE'
  return {
    id: left.id + '::' + right.id,
    wave,
    taskIds: [left.id, right.id],
    scheduling: 'CANDIDATE_PARALLEL',
    mergeState,
    mergeSafe: mergeState === 'MERGE_SAFE',
    firstUnmet,
    gates,
  }
}

function buildBlockerFamilies(taskById) {
  return SPECIAL_BLOCKER_FAMILIES.map((family) => {
    const tasks = family.taskIds.map((id) => taskById.get(id)).filter(Boolean)
    const state = tasks.some(blocked) ? 'BLOCKED' : 'UNKNOWN'
    return {
      ...family,
      state,
      source: 'ROADMAP.md',
      reason: family.externalDependency
        ? 'The roadmap task text names the external MSP thread/erase dependency; Mission Control does not claim that dependency is active or resolved.'
        : 'The roadmap task text requires a real LINE test channel and development-deployment evidence; Mission Control does not infer either one.',
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        proofScope: task.proofScope,
        implementationState: task.implementationState,
        dependsOn: dependencyIds(task),
      })),
    }
  })
}

export function buildMissionControlReadModel({
  roadmap = ROADMAP_SOT,
  taskLedger = ROADMAP_TASK_LEDGER,
  containers = PROGRAMME_CONTAINERS,
  lanes = PROGRAMME_LANES,
  porlResult = {},
} = {}) {
  const tasks = Array.isArray(taskLedger) ? taskLedger : []
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const dependencyMap = buildDependencyMap(tasks)
  const { observations, invalidCount } = observationMap(porlResult)
  const unavailableReason = porlResult.reason || 'PORL_SOURCE_UNAVAILABLE'

  const taskProjections = tasks.map((task) => {
    const container = taskContainer(task.id, containers)
    const taskLanes = laneMatches(task.id, lanes)
    const execution = projectExecution(observations.get(task.id), unavailableReason)
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      proofScope: task.proofScope,
      implementationState: task.implementationState,
      sprint: task.sprint,
      dependsOn: dependencyIds(task),
      owner: container.pic || container.owner || null,
      laneIds: taskLanes.map((lane) => lane.id),
      lanes: taskLanes.map((lane) => ({ id: lane.id, branches: lane.branches || [] })),
      execution,
    }
  })

  const projectedById = new Map(taskProjections.map((task) => [task.id, task]))
  const candidateParallelPairs = []
  const waves = (roadmap?.dag?.waves || []).map((wave) => {
    const waveTasks = wave.taskIds.map((id) => projectedById.get(id)).filter(Boolean)
    for (let leftIndex = 0; leftIndex < waveTasks.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < waveTasks.length; rightIndex += 1) {
        const left = waveTasks[leftIndex]
        const right = waveTasks[rightIndex]
        if (reaches(left.id, right.id, dependencyMap) || reaches(right.id, left.id, dependencyMap)) continue
        candidateParallelPairs.push(candidatePair(left, right, wave.wave, taskById, dependencyMap))
      }
    }
    return {
      wave: wave.wave,
      taskIds: wave.taskIds,
      candidatePairCount: candidateParallelPairs.filter((pair) => pair.wave === wave.wave).length,
    }
  })

  const freshnessCounts = { LIVE: 0, SNAPSHOT: 0, UNKNOWN: 0 }
  for (const task of taskProjections) freshnessCounts[task.execution.freshness] += 1
  const mergeSafePairCount = candidateParallelPairs.filter((pair) => pair.mergeSafe).length
  const blockedTaskCount = taskProjections.filter(blocked).length

  return {
    schemaVersion: MISSION_CONTROL_SCHEMA_VERSION,
    authority: {
      source: 'ROADMAP.md',
      generatedProjection: 'apps/server/src/modules/platform-control/roadmap-sot.js',
      nodeCount: roadmap?.dag?.nodeCount ?? 0,
      edgeCount: roadmap?.dag?.edgeCount ?? 0,
      waveCount: roadmap?.dag?.waveCount ?? 0,
      missingDependencies: roadmap?.dag?.missingDependencies || [],
      cycles: roadmap?.dag?.cycles || [],
      parallelPolicy: roadmap?.dag?.parallelPolicy || null,
    },
    porl: {
      availability: porlResult.availability || 'UNKNOWN',
      source: porlResult.source || { ...UNKNOWN_SOURCE },
      reason: unavailableReason,
      observationCount: observations.size,
      quarantinedCount: (porlResult.quarantined?.length || 0) + invalidCount,
      freshnessCounts,
    },
    summary: {
      taskCount: taskProjections.length,
      blockedTaskCount,
      candidateParallelPairCount: candidateParallelPairs.length,
      mergeSafePairCount,
      unknownPairCount: candidateParallelPairs.filter((pair) => pair.mergeState === 'UNKNOWN').length,
      notSafePairCount: candidateParallelPairs.filter((pair) => pair.mergeState === 'NOT_SAFE').length,
    },
    blockers: buildBlockerFamilies(taskById),
    tasks: taskProjections,
    waves,
    candidateParallelPairs,
  }
}
