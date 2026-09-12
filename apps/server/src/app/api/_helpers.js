import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

// @req FR-077, FR-149, FR-151 — the shared route error mapper: a database failure
//   is reported as a server error, not as the caller's invalid input.
// @spec SDD-008 — the Zod boundary no compiler enforces, so its contract is a test.
// @tested tests/unit/api-error-mapping.test.js
//
// Root cause and evidence: .brain/rca/2026-09-11-fr077-inventory-expired-transaction.md

export function ok(data, init) {
  return NextResponse.json(data, init)
}

/**
 * Throw from a route handler to choose the status explicitly instead of
 * relying on message sniffing (used by the enterprise API, where integrators
 * branch on the status code).
 */
export function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

/**
 * Prisma's own error classes, by name.
 *
 * Matched on `name` rather than with `instanceof` on purpose. This app builds two
 * Prisma clients — `@prisma/client` for the SQLite dev/test database and
 * `@zuri/prisma-postgres` for production (`src/lib/db.js`) — and their error classes
 * are distinct constructors: an `instanceof` check against either one is false for
 * every error thrown by the other. A fix written that way would work in test and be
 * absent in production, which is the environment this mapping matters most in.
 */
const PRISMA_ERROR_NAMES = new Set([
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientValidationError',
  'PrismaClientInitializationError',
  'PrismaClientRustPanicError',
])

/**
 * The status a Prisma failure deserves, or `null` when the error is not Prisma's.
 *
 * A database failure is never a statement about the caller's input, but Prisma's
 * messages are full of the words the refusal sniff below reads as one: an expired
 * interactive transaction says "cannot be executed", a malformed query says
 * "Unknown argument". Both used to reach the browser as HTTP 400 with no field to
 * blame — the FR-077 e2e flake, and the FR-149/FR-151 provisioning traces whose call
 * sites raised their transaction timeouts to work around the symptom. Classifying by
 * type before sniffing text keeps an infrastructure failure legible as one.
 */
function prismaErrorStatus(err) {
  if (!PRISMA_ERROR_NAMES.has(err?.name)) return null
  // P2025 is the one Prisma code that genuinely describes the request rather than the
  // database: the row the caller named does not exist. It already answered 404 through
  // the "not found" branch below, and keeps doing so.
  return err?.code === 'P2025' ? 404 : 500
}

export async function handle(fn) {
  try {
    const data = await fn()
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 }
      )
    }
    const message = err?.message || 'Unknown error'
    const notFound = /not found/i.test(message)
    const denied = /denied|not allowed|cycle|must|cannot|requires|unknown/i.test(message)
    // A status the service chose still wins — a P2002 race that a caller deliberately
    // reports as a retryable 409 is that caller's decision, not a lost server error.
    const status = Number(err?.status) || prismaErrorStatus(err) || (notFound ? 404 : denied ? 400 : 500)
    // A refusal may carry a structured list the caller needs to act on (FR-156:
    // which components a recipe build is short of). Passed through only when
    // the service set it deliberately as an array; never the raw error object.
    const details = Array.isArray(err?.details) ? err.details : undefined
    return NextResponse.json(details ? { error: message, details } : { error: message }, { status })
  }
}

export function queryParams(request) {
  const url = new URL(request.url)
  return Object.fromEntries(url.searchParams.entries())
}
