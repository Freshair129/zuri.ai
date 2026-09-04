import prisma from '@/lib/db'

// @req FR-143 — which provider extracts a candidate for this Business.
// @spec ADR-059 D5, ADR-056 D4
// @tested tests/unit/asset-extraction-provider.test.js
//
// An explicit `ZURI_ASSET_EVIDENCE_PROVIDER` always wins: an operator who names
// a provider gets it, and a wrong name is a refusal rather than a silent
// fallback. Unset, the rule is "use what is actually available": with no OpenAI
// key configured and at least one paired edge device for the Business, the edge
// is the only thing that can extract, so choose it; otherwise stay on the
// pre-existing OpenAI path so nothing changes for an installation that has not
// paired a device.

export const ASSET_EXTRACTION_PROVIDERS = Object.freeze(['openai', 'edge'])

export function parseConfiguredProvider(env = process.env) {
  const raw = typeof env?.ZURI_ASSET_EVIDENCE_PROVIDER === 'string' ? env.ZURI_ASSET_EVIDENCE_PROVIDER.trim().toLowerCase() : ''
  if (!raw) return null
  if (!ASSET_EXTRACTION_PROVIDERS.includes(raw)) {
    const error = new Error(`ZURI_ASSET_EVIDENCE_PROVIDER must be one of ${ASSET_EXTRACTION_PROVIDERS.join(', ')}`)
    error.status = 500
    throw error
  }
  return raw
}

/** The pure half of the decision, so the fallback rule is testable without a database. */
export function decideExtractionProvider({ configured = null, hasOpenAiKey = false, hasActiveEdgeDevice = false } = {}) {
  if (configured) return configured
  if (!hasOpenAiKey && hasActiveEdgeDevice) return 'edge'
  return 'openai'
}

export async function resolveExtractionProvider({ businessId, db = prisma, env = process.env } = {}) {
  const configured = parseConfiguredProvider(env)
  if (configured) return configured
  const hasOpenAiKey = Boolean(typeof env?.OPENAI_API_KEY === 'string' && env.OPENAI_API_KEY.trim())
  let hasActiveEdgeDevice = false
  if (!hasOpenAiKey && businessId) {
    const paired = await db.edgeDeviceCredential.findFirst({
      where: { businessId, status: 'ACTIVE' },
      select: { id: true },
    })
    hasActiveEdgeDevice = Boolean(paired)
  }
  return decideExtractionProvider({ configured, hasOpenAiKey, hasActiveEdgeDevice })
}
