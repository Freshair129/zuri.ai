import crypto from 'node:crypto'
import { z } from 'zod'

// @req FR-052 — resolve LINE Tenant/Business scope only from an active persisted binding.
// @req FR-097 — the binding code is the server-owned channel-account namespace.
// @spec ADR-018, SEC-010 — bearer and destination are HMACed before the database lookup.
// @spec ADR-044, ADR-045 D1/D5-D6, BR-020, SEC-018
// @tested tests/unit/line-binding-resolver.test.js

const zResolverOptions = z.object({ pepper: z.string().min(32).max(512) }).strict()
const zResolveInput = z.object({
  bindingId: z.string().uuid(),
  destination: z.string().min(1).max(512),
  authorization: z.string(),
}).strict()

function unauthorized() {
  const error = new Error('PHASE1_BINDING_UNAUTHORIZED')
  error.status = 401
  return error
}

export function hashBindingSecret(pepper, value) {
  return crypto.createHmac('sha256', pepper).update(value, 'utf8').digest('hex')
}

export function createPostgresLineBindingResolver({ queryFn, pepper }) {
  if (typeof queryFn !== 'function') throw new Error('POSTGRES_QUERY_FUNCTION_REQUIRED')
  const options = zResolverOptions.parse({ pepper })
  return {
    async resolve(input) {
      let parsed
      try {
        parsed = zResolveInput.parse(input)
      } catch {
        throw unauthorized()
      }
      const token = parsed.authorization.startsWith('Bearer ') ? parsed.authorization.slice(7) : ''
      if (token.length < 32) throw unauthorized()
      const values = [
        parsed.bindingId,
        hashBindingSecret(options.pepper, token),
        hashBindingSecret(options.pepper, parsed.destination),
      ]
      const result = await queryFn(`
        select id, code, tenant_id, business_id
        from zuri_core.line_channel_binding
        where id = $1
          and credential_hash = $2
          and external_channel_id_hash = $3
          and status = 'ACTIVE'
          and valid_from <= now()
          and (expires_at is null or expires_at > now())
        limit 1
      `, values)
      const row = result.rows?.[0]
      if (!row) throw unauthorized()
      return {
        id: row.id,
        code: row.code,
        channelAccountId: row.code,
        tenantId: row.tenant_id,
        businessId: row.business_id,
      }
    },
  }
}
