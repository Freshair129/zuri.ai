import prisma from '@/lib/db'
import { createLineMissionDraftRepository } from '@/modules/agent/line-project-work-tools'
import { createMissionDraftPort } from '@/modules/agent/mission-draft'
import { createAgentMissionIntakeService } from './agent-mission-intake'

// Server composition root for the bounded PM intake. The LINE repository's
// source-creation path still validates its claimed job, lease, verified
// identity, OWNER scope, and committed trace. PM reads/submissions use the
// authenticated human viewer and join evidence writes to the PM transaction.
export function createAgentMissionIntakeRuntime({ db = prisma, ...options } = {}) {
  const agentMissionPort = options.agentMissionPort ?? createMissionDraftPort({
    repository: createLineMissionDraftRepository({ db }),
  })
  return createAgentMissionIntakeService({ db, ...options, agentMissionPort })
}

export const agentMissionIntakeService = createAgentMissionIntakeRuntime()
