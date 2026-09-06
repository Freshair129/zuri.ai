import { z } from 'zod'
import { createLineReadQueryFromEnv } from './phase1-runtime'

// @req FR-147 — a read-only, Tenant/Business-scoped view of the agent lane's
//   `zuri_core.line_channel_binding` for one binding code, answering one
//   question: is there a currently valid ACTIVE binding here? It selects no
//   hash or credential column, mutates nothing (ADR-020 stays the only
//   activation path), and takes Tenant, Business and code from the caller's
//   own server-owned row — never from a request.
// @spec FR-052, SEC-010 — same `zuri_line_smartgift_ro` read role and forced
//   RLS as the Phase 1 runtime. That role's policy exposes only ACTIVE,
//   in-window rows of the scope it is granted for, so this reader can honestly
//   distinguish "visible and active" from "not visible" and nothing finer:
//   pending, inactive, expired, rotated, absent and out-of-policy all read as
//   NOT_ACTIVE. Saying more would be inventing state the role cannot see.
// @spec ADR-060 D3 — the LINE OA Studio account's `effectiveStatus` reaches
//   LIVE only on ACTIVE from this contract.
// @tested tests/unit/line-binding-status.test.js, tests/integration/fr146-line-oa-account.test.js

export const LINE_BINDING_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  NOT_ACTIVE: 'NOT_ACTIVE',
  NO_BINDING: 'NO_BINDING',
  UNKNOWN: 'UNKNOWN',
})

const zReadInput = z.object({
  tenantId: z.string().min(1).max(200),
  businessId: z.string().min(1).max(200),
  code: z.string().min(1).max(200),
}).strict()

// Only columns that describe the binding's *state*. The two hash columns and
// the id are deliberately absent: a status view has no use for them, and a
// contract that never selects them cannot leak them.
const READ_SQL = `
  select code, status, valid_from, expires_at, rotated_at, version
  from zuri_core.line_channel_binding
  where tenant_id = $1
    and business_id = $2
    and code = $3
  limit 1
`

export function createPostgresLineBindingStatusReader({ queryFn } = {}) {
  if (typeof queryFn !== 'function') throw new Error('POSTGRES_QUERY_FUNCTION_REQUIRED')
  return {
    /**
     * The visible binding row for (tenantId, businessId, code), or `null` when
     * the read role sees none. Input is validated before any query so a
     * malformed scope never reaches the database.
     */
    async read(input) {
      const parsed = zReadInput.parse(input)
      const result = await queryFn(READ_SQL, [parsed.tenantId, parsed.businessId, parsed.code])
      const row = result?.rows?.[0]
      if (!row) return null
      return {
        code: row.code,
        status: row.status,
        validFrom: row.valid_from ?? null,
        expiresAt: row.expires_at ?? null,
        rotatedAt: row.rotated_at ?? null,
        version: row.version ?? null,
      }
    },
  }
}

/**
 * The reader for this process, or `null` when the LINE runtime database is
 * not configured — the dev/test default, and the reason a consumer reports
 * UNKNOWN rather than guessing. Reuses the Phase 1 runtime's shared pool and
 * its read-role transaction wrapper; a `queryFn` may be injected for tests.
 */
export function createLineBindingStatusReaderFromEnv(env = process.env, { queryFn } = {}) {
  const execute = queryFn ?? createLineReadQueryFromEnv(env)
  return execute ? createPostgresLineBindingStatusReader({ queryFn: execute }) : null
}

/**
 * The four honest labels a consumer can show. `reader` may be `null`.
 */
export async function readLineBindingStatusLabel(reader, { tenantId, businessId, code } = {}) {
  if (!code) return LINE_BINDING_STATUS.NO_BINDING
  if (!reader) return LINE_BINDING_STATUS.UNKNOWN
  const row = await reader.read({ tenantId, businessId, code })
  // The read role only ever returns ACTIVE, in-window rows, but the status is
  // checked rather than assumed so a future, wider policy cannot promote a
  // PENDING or INACTIVE row to ACTIVE through this label.
  return row && row.status === 'ACTIVE' ? LINE_BINDING_STATUS.ACTIVE : LINE_BINDING_STATUS.NOT_ACTIVE
}
