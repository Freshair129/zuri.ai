import prisma from '@/lib/db'
import { resolveViewer } from './resolve-viewer'
import { mintEdgeDeviceCredential } from './edge-device-credential'
import { isInstallationOperator } from './viewer-authority'
import { createEdgePairingService } from './edge-pairing'

// @req FR-144 — use the existing transactional credential mint and fresh Business authority.
// @spec SEC-025, SEC-001
// @tested tests/integration/edge-pairing.test.js
const slot = Symbol.for('zuri.edge-pairing.v1')
export function edgePairingService() {
  if (!globalThis[slot]) globalThis[slot] = createEdgePairingService({
    refreshViewer: input => resolveViewer(input),
    businesses: viewer => prisma.business.findMany({
      where: { id: { in: isInstallationOperator(viewer) ? viewer.visibleBusinessIds : viewer.ownedBusinessIds } },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    }),
    mint: input => prisma.$transaction(tx => mintEdgeDeviceCredential({ ...input, db: tx })),
  })
  return globalThis[slot]
}
