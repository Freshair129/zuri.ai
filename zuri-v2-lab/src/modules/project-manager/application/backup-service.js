import prisma from '@/lib/db'
import { recordAudit } from './audit'

// @req FR-013 — snapshot export/import with preview + confirmation
// @spec BR-008 — never silently overwrites; restore requires confirm=true
// @tested tests/integration/backup.test.js
// Offline snapshot backup: full-domain JSON export + preview-then-confirm import.

export const SNAPSHOT_SCHEMA_VERSION = '1.0'

const SNAPSHOT_MODELS = [
  'portfolio',
  'tenant',
  'legalEntity',
  'legalEntityIdentifier',
  'business',
  'branch',
  'person',
  'membership',
  'workspace',
  'project',
  'workstream',
  'workContainer',
  'workItem',
  'milestone',
  'gate',
  'dependency',
  'repository',
  'projectRepository',
  // FR-019 — customer id mappings travel with the data; losing them on restore
  // would orphan every integration. Snapshots written before this table existed
  // still restore (a missing table reads as an empty list), so the snapshot
  // schemaVersion stays 1.0.
  'externalRef',
  // FR-021 — identity mappings must survive a restore; losing them orphans every
  // linked LINE user. A snapshot written before this model existed still restores
  // (a missing table reads as an empty list), so the snapshot version stays 1.0.
  'externalIdentity',
  'auditEvent',
]

export async function exportSnapshot() {
  const snapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables: {},
  }
  for (const model of SNAPSHOT_MODELS) {
    snapshot.tables[model] = await prisma[model].findMany()
  }
  await recordAudit(prisma, {
    entityType: 'SNAPSHOT',
    entityId: 'local',
    action: 'EXPORTED',
    payload: Object.fromEntries(Object.entries(snapshot.tables).map(([k, v]) => [k, v.length])),
  })
  return snapshot
}

export function previewSnapshot(snapshot) {
  const errors = []
  if (!snapshot || typeof snapshot !== 'object') errors.push('Snapshot is not an object')
  else {
    if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      errors.push(`Unsupported snapshot schemaVersion: ${snapshot.schemaVersion} (expected ${SNAPSHOT_SCHEMA_VERSION})`)
    }
    if (!snapshot.tables || typeof snapshot.tables !== 'object') errors.push('Snapshot has no tables')
  }
  if (errors.length > 0) return { valid: false, errors, counts: null }
  const counts = {}
  for (const model of SNAPSHOT_MODELS) {
    const rows = snapshot.tables[model]
    counts[model] = Array.isArray(rows) ? rows.length : 0
  }
  return { valid: true, errors: [], counts, exportedAt: snapshot.exportedAt || null }
}

/**
 * Import preview against the live DB: current vs incoming row counts.
 */
export async function previewImport(snapshot) {
  const base = previewSnapshot(snapshot)
  if (!base.valid) return base
  const current = {}
  for (const model of SNAPSHOT_MODELS) {
    current[model] = await prisma[model].count()
  }
  const wouldReplace = Object.values(current).some((n) => n > 0)
  return { ...base, current, wouldReplace }
}

/**
 * Restore a snapshot. Destructive replace of local data — requires confirm=true.
 * Runs in a single transaction: delete children-first, insert parents-first.
 */
export async function importSnapshot(snapshot, { confirm = false } = {}) {
  const preview = await previewImport(snapshot)
  if (!preview.valid) return { restored: false, ...preview }
  if (!confirm) return { restored: false, needsConfirmation: true, ...preview }

  const deleteOrder = [...SNAPSHOT_MODELS].reverse()
  await prisma.$transaction(async (tx) => {
    for (const model of deleteOrder) {
      await tx[model].deleteMany()
    }
    for (const model of SNAPSHOT_MODELS) {
      const rows = snapshot.tables[model] || []
      for (const row of rows) {
        await tx[model].create({ data: row })
      }
    }
    await recordAudit(tx, {
      entityType: 'SNAPSHOT',
      entityId: 'local',
      action: 'RESTORED',
      payload: { exportedAt: snapshot.exportedAt || null, counts: preview.counts },
    })
  })
  return { restored: true, counts: preview.counts }
}
