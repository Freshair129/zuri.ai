import { readWorkerObservability } from '../../../../../../tools/delivery-control/worker-observability-reader.mjs'

// This adapter deliberately passes only the repository root and the requested
// event baseline. The reader opens controller and receipt sources read-only.
export function readWorkerObservabilitySource({ repoRoot = process.cwd(), since = null } = {}) {
  return readWorkerObservability({ repoRoot, since })
}
