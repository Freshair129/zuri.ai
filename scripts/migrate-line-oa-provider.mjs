import prisma from '../src/lib/db.js'

// Relative imports only, like operator-bootstrap.js and manage-line-binding.mjs:
// this CLI runs under plain `node`, which never resolves the `@/*` alias
// Next.js's bundler provides. `LINE_OA_PROVIDER_CODE`
// (src/platform/integrations/core/integration-registry.js) and
// `LEGACY_LINE_OA_PROVIDER_CODE`
// (src/modules/integration/application/line-registry-service.js) both start
// with `import ... from '@/lib/db'`, so importing either module here would
// fail outside the bundler. The values are copied instead;
// tests/integration/line-oa-provider-migration.test.js imports the real
// constants and asserts they still match these copies.
const LINE_OA_PROVIDER_CODE = 'LINE_OA'
const LEGACY_LINE_OA_PROVIDER_CODE = 'line-oa'

// @req FR-080 — merge the legacy lowercase `line-oa` IntegrationProvider identity
// into the canonical `LINE_OA` one (BR-002: one identity per provider). This is
// the wave-1 open item line-registry-service.js names in its read-tolerance
// comment — see docs/runbooks/line-oa-provider-merge.md for the apply
// procedure. The companion Postgres migration is
// supabase/migrations/20260902110000_merge_line_oa_provider_code.sql; this
// script performs the identical logic through Prisma against the SQLite dev
// database, `--dry-run` by default.
// @spec BR-002, SEC-016, ADR-032
// @tested tests/integration/line-oa-provider-migration.test.js

export const MERGE_REASON = 'LINE_OA_PROVIDER_MERGE'

/**
 * `metadataJson` is a TEXT column holding an application-written JSON object
 * (never an array — every writer here uses `JSON.stringify({...})`). A row
 * whose column does not parse to a plain object cannot be safely merged: this
 * script would either lose it or corrupt it, so it is reported as unresolved
 * instead of guessed at.
 */
function safeParseMetadataObject(json) {
  try {
    const parsed = JSON.parse(json ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ok: true, value: parsed }
    return { ok: false, value: null }
  } catch {
    return { ok: false, value: null }
  }
}

function collisionKey(tenantId, externalAccountId) {
  return `${tenantId}::${externalAccountId}`
}

/**
 * Read-only: what the merge would do, without writing anything.
 *
 * A legacy connection collides with a canonical one when they share
 * (tenantId, externalAccountId) — the same granularity as the
 * `@@unique([tenantId, providerId, externalAccountId])` constraint the merge
 * must not violate once both rows sit under the same providerId. `null`
 * externalAccountId never collides: the unique index treats NULL as distinct
 * from NULL, so two such rows can share a provider without conflict.
 */
/**
 * Optional tenant scope. Production runs want the whole installation; a test
 * (or a cautious operator) wants one or two tenants. Without it, every
 * legacy row in the database is in scope — which is also why the integration
 * test scopes itself: the shared per-run SQLite database holds legacy rows
 * seeded by other suites, and a whole-database plan would count theirs.
 */
function tenantScope(tenantIds) {
  return Array.isArray(tenantIds) && tenantIds.length > 0 ? { tenantId: { in: tenantIds } } : {}
}

export async function planLineOaProviderMerge(db, { tenantIds } = {}) {
  const legacyProvider = await db.integrationProvider.findUnique({ where: { code: LEGACY_LINE_OA_PROVIDER_CODE } })
  const canonicalProvider = await db.integrationProvider.findUnique({ where: { code: LINE_OA_PROVIDER_CODE } })

  if (!legacyProvider) {
    return {
      legacyProviderExists: false,
      legacyProviderId: null,
      canonicalProviderExists: Boolean(canonicalProvider),
      canonicalProviderId: canonicalProvider?.id ?? null,
      repoint: [],
      disable: [],
      unresolved: [],
    }
  }

  const [legacyConnections, canonicalConnections] = await Promise.all([
    db.integrationConnection.findMany({ where: { providerId: legacyProvider.id, ...tenantScope(tenantIds) } }),
    canonicalProvider
      ? db.integrationConnection.findMany({ where: { providerId: canonicalProvider.id, ...tenantScope(tenantIds) } })
      : Promise.resolve([]),
  ])

  const canonicalByKey = new Map()
  for (const connection of canonicalConnections) {
    if (connection.externalAccountId == null) continue
    canonicalByKey.set(collisionKey(connection.tenantId, connection.externalAccountId), connection)
  }

  const repoint = []
  const disable = []
  const unresolved = []

  for (const legacy of legacyConnections) {
    const collidesWith = legacy.externalAccountId != null
      ? canonicalByKey.get(collisionKey(legacy.tenantId, legacy.externalAccountId))
      : null

    if (!collidesWith) {
      repoint.push(legacy)
      continue
    }

    const parsedMetadata = safeParseMetadataObject(legacy.metadataJson)
    if (!parsedMetadata.ok) {
      unresolved.push({ connection: legacy, collidesWith, reason: 'METADATA_JSON_UNPARSEABLE' })
      continue
    }

    // Already disabled and tagged by a previous run of this same merge —
    // nothing left to do for this row, and it must not be re-queued (a second
    // pass would otherwise re-append the tag or, worse, misreport it as a
    // fresh collision every time the plan is read).
    if (legacy.status === 'DISABLED' && parsedMetadata.value.reason === MERGE_REASON) continue

    disable.push({ connection: legacy, collidesWith, metadata: parsedMetadata.value })
  }

  return {
    legacyProviderExists: true,
    legacyProviderId: legacyProvider.id,
    canonicalProviderExists: Boolean(canonicalProvider),
    canonicalProviderId: canonicalProvider?.id ?? null,
    repoint,
    disable,
    unresolved,
  }
}

/**
 * Apply the merge in one transaction. Refuses (throws, writes nothing) when
 * the plan has any unresolved collision — this is the "exit non-zero on any
 * collision it cannot resolve" contract; a resolvable collision (disable +
 * tag) is not a refusal, it is the expected outcome.
 */
export async function applyLineOaProviderMerge(db, { now = new Date(), tenantIds } = {}) {
  const plan = await planLineOaProviderMerge(db, { tenantIds })
  if (plan.unresolved.length > 0) {
    const error = new Error('LINE_OA_PROVIDER_MERGE_UNRESOLVED_COLLISION')
    error.unresolved = plan.unresolved
    throw error
  }

  return db.$transaction(async (tx) => {
    // Idempotent: present whether or not there was ever a legacy row to merge.
    const canonical = await tx.integrationProvider.upsert({
      where: { code: LINE_OA_PROVIDER_CODE },
      update: {},
      create: { code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account', status: 'ACTIVE' },
    })

    for (const { connection, collidesWith, metadata } of plan.disable) {
      await tx.integrationConnection.update({
        where: { id: connection.id },
        data: {
          status: 'DISABLED',
          metadataJson: JSON.stringify({ ...metadata, mergedInto: collidesWith.id, reason: MERGE_REASON }),
          updatedAt: now,
        },
      })
    }

    for (const connection of plan.repoint) {
      await tx.integrationConnection.update({
        where: { id: connection.id },
        data: { providerId: canonical.id, updatedAt: now },
      })
    }

    // The disabled duplicates above stay pointed at the legacy provider on
    // purpose (they are its historical record), so the legacy row survives
    // exactly as long as one of them does. Only a legacy provider with zero
    // remaining references is deleted.
    let legacyProviderDeleted = false
    if (plan.legacyProviderExists) {
      const remaining = await tx.integrationConnection.count({ where: { providerId: plan.legacyProviderId } })
      if (remaining === 0) {
        await tx.integrationProvider.delete({ where: { id: plan.legacyProviderId } })
        legacyProviderDeleted = true
      }
    }

    return {
      applied: true,
      legacyProviderExisted: plan.legacyProviderExists,
      canonicalProviderId: canonical.id,
      repointedCount: plan.repoint.length,
      disabledCount: plan.disable.length,
      legacyProviderDeleted,
    }
  })
}

export function parseArgs(argv) {
  const apply = argv.includes('--apply')
  const dryRun = argv.includes('--dry-run')
  if (apply && dryRun) throw new Error('LINE_OA_PROVIDER_MERGE_CLI_CONFLICTING_FLAGS — pass --apply or --dry-run, not both')
  const tenantIds = []
  const rest = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--tenant') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error('LINE_OA_PROVIDER_MERGE_CLI_TENANT_REQUIRES_VALUE — --tenant <tenantId>')
      tenantIds.push(value)
      i += 1
      continue
    }
    rest.push(argv[i])
  }
  const known = new Set(['--apply', '--dry-run'])
  const unknown = rest.find((token) => !known.has(token))
  if (unknown) throw new Error(`LINE_OA_PROVIDER_MERGE_CLI_UNKNOWN_OPTION — ${unknown}`)
  return { apply, tenantIds }
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const db = dependencies.db ?? prisma
  const log = dependencies.log ?? console.log
  const { apply, tenantIds } = parseArgs(argv)

  if (!apply) {
    const plan = await planLineOaProviderMerge(db, { tenantIds })
    const summary = {
      mode: 'DRY_RUN',
      tenantScope: tenantIds.length > 0 ? tenantIds : 'ALL',
      legacyProviderExists: plan.legacyProviderExists,
      canonicalProviderExists: plan.canonicalProviderExists,
      wouldRepoint: plan.repoint.length,
      wouldDisable: plan.disable.length,
      unresolvedCollisions: plan.unresolved.length,
    }
    log(JSON.stringify(summary, null, 2))
    if (plan.unresolved.length > 0) process.exitCode = 1
    return summary
  }

  const result = await applyLineOaProviderMerge(db, { tenantIds })
  log(JSON.stringify({ mode: 'APPLY', tenantScope: tenantIds.length > 0 ? tenantIds : 'ALL', ...result }, null, 2))
  return result
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? 'LINE_OA_PROVIDER_MERGE_FAILED'}\n`)
    process.exitCode = 1
  })
}
