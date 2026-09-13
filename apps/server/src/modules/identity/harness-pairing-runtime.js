import prisma from '@/lib/db'
import { resolveViewer } from './resolve-viewer'
import { mintHarnessCredential } from './harness-credential'
import { createHarnessPairingService } from './harness-pairing'

// @req FR-220 — the process-wide harness pairing service: fresh authority at
// redemption through resolveViewer, and the transactional credential mint.
// @spec ADR-087 D1-D3, SEC-025
// @tested tests/unit/harness-pairing.test.js
const slot = Symbol.for('zuri.harness-pairing.v1')
export function harnessPairingService() {
  if (!globalThis[slot]) globalThis[slot] = createHarnessPairingService({
    refreshViewer: (input) => resolveViewer(input),
    mint: (input) => prisma.$transaction((tx) => mintHarnessCredential({ ...input, db: tx })),
  })
  return globalThis[slot]
}
