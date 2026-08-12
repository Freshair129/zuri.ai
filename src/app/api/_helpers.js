import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

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
    const status = Number(err?.status) || (notFound ? 404 : denied ? 400 : 500)
    return NextResponse.json({ error: message }, { status })
  }
}

export function queryParams(request) {
  const url = new URL(request.url)
  return Object.fromEntries(url.searchParams.entries())
}
