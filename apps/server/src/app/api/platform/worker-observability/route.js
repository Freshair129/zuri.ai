// @req FR-260 — installation-operator-only, read-only Mission Control observations.
// @spec docs/features/FEAT-044/requirements/FR-260.md
// @tested tests/unit/worker-observability-route.test.js, tests/e2e/worker-observability.spec.js
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'
import { readWorkerObservabilitySource } from '@/modules/platform-control/application/worker-observability-source'
import { createWorkerObservabilityGet, createWorkerObservabilityMethodNotAllowed } from '@/modules/platform-control/worker-observability-contract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const get = createWorkerObservabilityGet({
  resolveViewer: resolveRequestViewer,
  isOperator: isInstallationOperator,
  readSnapshot: readWorkerObservabilitySource,
})

export const GET = get
export const POST = createWorkerObservabilityMethodNotAllowed
export const PUT = createWorkerObservabilityMethodNotAllowed
export const PATCH = createWorkerObservabilityMethodNotAllowed
export const DELETE = createWorkerObservabilityMethodNotAllowed
export const OPTIONS = createWorkerObservabilityMethodNotAllowed
