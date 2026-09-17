import prisma from '@/lib/db'
import { getPipelineMonitor } from './pipeline-tracking-service'

// @req FR-254 — owning integration read port for complete, paged FR-071 runs.
// @spec ADR-030, ADR-050, ADR-072, SEC-001
// @tested tests/integration/fr254-knowledge-console.test.js
const select = {
  id: true, executionRunId: true, tenantId: true, businessId: true,
  dataPipelineDefinitionId: true, status: true, currentStageId: true,
  createdAt: true, updatedAt: true, startedAt: true, finishedAt: true,
}
export function createPipelineConsoleReadPort(db = prisma) {
  return {
    page({ businessId, tenantId, status }, after, take) {
      return db.pipelineRun.findMany({
        where: { businessId, tenantId, ...(status ? { status } : {}), ...(after ? { OR: [
          { createdAt: { lt: new Date(after.createdAt) } },
          { createdAt: new Date(after.createdAt), id: { lt: after.id } },
        ] } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take, select,
      })
    },
    run: (executionRunId) => db.pipelineRun.findUnique({ where: { executionRunId }, select }),
    steps: (runId) => db.pipelineStep.findMany({ where: { runId }, orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }], select: {
      executionStepId: true, pipelineStageId: true, sequence: true, attemptId: true,
      status: true, inputHash: true, outputHash: true, actualCount: true, failedCount: true,
      failureCode: true, retryable: true, startedAt: true, finishedAt: true,
    } }),
    monitor: (executionRunId, viewer) => getPipelineMonitor(executionRunId, { db, viewer }),
  }
}
