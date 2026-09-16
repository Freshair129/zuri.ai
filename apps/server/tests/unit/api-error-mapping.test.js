// @req FR-077, FR-149, FR-151 — a failure of the database is reported as a server
//   error, not as the caller's invalid input. FR-077's e2e flake was the first
//   confirmed instance; the FR-149/FR-151 provisioning traces are two more.
// @spec SDD-008 — the Zod boundary no compiler enforces, so its contract is a test.
// @tested tests/unit/api-error-mapping.test.js
//
// Root cause and evidence: .brain/rca/2026-09-11-fr077-inventory-expired-transaction.md
//
// `handle()` classifies an error by sniffing its message for refusal words. Prisma's
// own messages are full of them — "cannot be executed on an expired transaction",
// "Unknown argument" — so an expired transaction or a malformed query reached the
// browser as HTTP 400 "with no field to blame" (the phrase used at two call sites
// that worked around it by raising their transaction timeouts instead).
import { describe, expect, it } from 'vitest'
import { ZodError, z } from 'zod'
import { handle, httpError } from '@/app/api/_helpers'

// Built by name and code, exactly as Prisma builds them. Constructing the real class
// would tie this test to one of the two generated clients, which is the very coupling
// the fix avoids.
function prismaError(name, message, code) {
  const err = new Error(message)
  err.name = name
  if (code) err.code = code
  err.clientVersion = '5.22.0'
  return err
}

async function statusOf(err) {
  const response = await handle(() => { throw err })
  return { status: response.status, body: await response.json() }
}

describe('handle() error mapping', () => {
  describe('Prisma failures are server errors, not client errors', () => {
    it('maps an expired interactive transaction (P2028) to 500, not 400', async () => {
      const { status } = await statusOf(prismaError(
        'PrismaClientKnownRequestError',
        'Transaction API error: Transaction already closed: A batch query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 6001 ms passed since the start of the transaction.',
        'P2028',
      ))
      expect(status).toBe(500)
    })

    it('maps a malformed query (PrismaClientValidationError) to 500, not 400', async () => {
      // Contains "Unknown", which the refusal sniff treats as a client error.
      const { status } = await statusOf(prismaError('PrismaClientValidationError', 'Unknown argument `workstremId`. Did you mean `workstreamId`?'))
      expect(status).toBe(500)
    })

    it('maps an unreachable database (PrismaClientInitializationError) to 500', async () => {
      const { status } = await statusOf(prismaError('PrismaClientInitializationError', "Can't reach database server at `db:5432`", 'P1001'))
      expect(status).toBe(500)
    })

    it('maps an engine panic (PrismaClientRustPanicError) to 500', async () => {
      const { status } = await statusOf(prismaError('PrismaClientRustPanicError', 'Query engine panicked: cannot recover'))
      expect(status).toBe(500)
    })

    it('detects the error by name, so both generated clients are covered', async () => {
      // Production runs `@zuri/prisma-postgres` and dev/test run `@prisma/client`.
      // Their error classes are distinct constructors, so an `instanceof` check
      // against either one is false for every error thrown by the other — the fix
      // would have worked in test and been absent in production.
      const fromOtherClient = prismaError('PrismaClientKnownRequestError', 'A batch query cannot be executed on an expired transaction', 'P2028')
      Object.setPrototypeOf(fromOtherClient, Error.prototype)
      const { status } = await statusOf(fromOtherClient)
      expect(status).toBe(500)
    })

    it('still answers 404 for P2025, the one Prisma code that is about the request', async () => {
      const { status } = await statusOf(prismaError(
        'PrismaClientKnownRequestError',
        'An operation failed because it depends on one or more records that were required but not found.',
        'P2025',
      ))
      expect(status).toBe(404)
    })

    it('lets a service-chosen status win over the Prisma default', async () => {
      // knowledge-corpus-service marks a P2002 race retryable with an explicit 409.
      const err = prismaError('PrismaClientKnownRequestError', 'Unique constraint failed on the fields: (`code`)', 'P2002')
      err.status = 409
      const { status } = await statusOf(err)
      expect(status).toBe(409)
    })
  })

  describe('the existing contract is unchanged', () => {
    it('answers 400 with issues for a ZodError', async () => {
      const schema = z.object({ name: z.string() })
      let zodError
      try { schema.parse({ name: 1 }) } catch (err) { zodError = err }
      expect(zodError).toBeInstanceOf(ZodError)
      const { status, body } = await statusOf(zodError)
      expect(status).toBe(400)
      expect(body.error).toBe('Validation failed')
      expect(body.issues).toHaveLength(1)
    })

    it('answers 404 for a "not found" refusal', async () => {
      expect((await statusOf(new Error('Project not found'))).status).toBe(404)
    })

    it('answers 400 for a domain refusal', async () => {
      expect((await statusOf(new Error('Dependency cycle detected'))).status).toBe(400)
      expect((await statusOf(new Error('Access denied'))).status).toBe(400)
      expect((await statusOf(new Error('Code must be unique'))).status).toBe(400)
    })

    it('honours an explicit httpError status', async () => {
      expect((await statusOf(httpError(403, 'Forbidden'))).status).toBe(403)
    })

    it('answers 500 for an unclassified error', async () => {
      expect((await statusOf(new Error('boom'))).status).toBe(500)
    })

    it('passes through a deliberate details array', async () => {
      const err = new Error('Recipe is short of components')
      err.status = 409
      err.details = [{ component: 'CMP-1', short: 2 }]
      const { status, body } = await statusOf(err)
      expect(status).toBe(409)
      expect(body.details).toEqual([{ component: 'CMP-1', short: 2 }])
    })
  })
})
