import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { resolveKnowledgeRequestViewer } from './knowledge-http'

// @req FR-254 — console requests resolve trusted authority again after slow reads.
// @spec ADR-072, SEC-001, SEC-008
// @tested tests/unit/fr254-knowledge-console-routes.test.js
export const consoleParameters = (request) => Object.fromEntries(new URL(request.url).searchParams)

export async function consoleRequest(request, operation) {
  try {
    const viewer = await resolveKnowledgeRequestViewer(request)
    const result = await operation({ viewer, resolveCurrentViewer: () => resolveKnowledgeRequestViewer(request) })
    return result instanceof Response ? result : NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const status = error instanceof ZodError ? 400 : Number(error.status) || 500
    const message = status === 404 || status === 403 ? 'Knowledge resource not found'
      : status >= 500 ? 'Knowledge data is temporarily unavailable. Retry the request.'
        : error instanceof ZodError ? 'Invalid knowledge console request' : error.message
    return NextResponse.json({ error: message }, { status: status === 403 ? 404 : status, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
