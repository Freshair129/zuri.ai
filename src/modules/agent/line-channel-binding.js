import crypto from 'node:crypto'
import { z } from 'zod'

// @req FR-052 — resolve public LINE scope only from an active server-owned binding.
// @spec ADR-018, BR-012, SEC-010
// @tested tests/unit/line-channel-binding.test.js, tests/integration/agent-webhook-route.test.js

const zBinding = z.object({
  bindingId: z.string().min(1),
  destinationSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  tenantId: z.string().min(1),
  businessId: z.string().min(1),
  status: z.enum(['ACTIVE', 'INACTIVE']),
}).strict()

function equalSecret(left, right) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function bindingError() {
  const error = new Error('LINE_BINDING_DENIED')
  error.status = 401
  return error
}

export function createConfiguredLineBindingResolver(env = process.env) {
  const binding = zBinding.parse({
    bindingId: env.ZURI_LINE_BINDING_ID,
    destinationSha256: env.ZURI_LINE_BINDING_DESTINATION_SHA256,
    tenantId: env.ZURI_LINE_BINDING_TENANT_ID,
    businessId: env.ZURI_LINE_BINDING_BUSINESS_ID,
    status: env.ZURI_LINE_BINDING_STATUS,
  })

  return {
    async resolve(input) {
      if (
        binding.status !== 'ACTIVE' ||
        typeof input?.bindingId !== 'string' ||
        typeof input?.destination !== 'string' ||
        !equalSecret(input.bindingId, binding.bindingId) ||
        !equalSecret(crypto.createHash('sha256').update(input.destination).digest('hex'), binding.destinationSha256)
      ) throw bindingError()

      return Object.freeze({
        bindingId: binding.bindingId,
        tenantId: binding.tenantId,
        businessId: binding.businessId,
      })
    },
  }
}
