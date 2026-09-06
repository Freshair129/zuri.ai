// @req FR-080 — AC-075.3 promises health fields on the Integration read model.
//   This is that field, computed rather than stored.
// @spec ADR-032 D1-D4, SEC-016 — metadata only; no secret material is read here,
//   only whether a reference exists and whether it has expired.
// @tested tests/unit/connection-health.test.js
//
// WHY COMPUTED, NEVER STORED
// --------------------------
// The same rule progress lives under: a stored status column is a claim that was
// true once, and the failure mode is a dashboard that says CONNECTED while every
// event is failing. Health here is a pure function of evidence the database already
// holds, so it cannot go stale on its own and there is no cache to reconcile.
//
// WHY THERE IS NO "UNKNOWN"
// -------------------------
// A channel that is enabled and correctly configured but has never received an
// event is DEGRADED, not CONNECTED. We have never observed it working, and
// reporting green on the strength of configuration alone is exactly the claim an
// operator would act on and regret. The reason code says which it is.

export const CONNECTION_HEALTH_STATES = Object.freeze([
  'CONNECTED',
  'DEGRADED',
  'ERROR',
  'DISABLED',
  'MISCONFIGURED',
])

export const CONNECTION_KINDS = Object.freeze(['CHANNEL', 'MODEL_PROVIDER'])

/** A channel quiet for longer than this has stopped proving it works. */
export const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000

function connectionMetadata(connection) {
  try {
    const parsed = JSON.parse(connection?.metadataJson ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Configuration a connection cannot work without, by kind.
 *
 * A CHANNEL needs the provider account it listens to. Its channel secret is NOT
 * required here: under BR-011 the LINE channel secret belongs to zuri-cli, and
 * demanding one would report MISCONFIGURED for a channel that is working fine.
 *
 * A MODEL_PROVIDER needs a model and a credential reference — except Ollama, which
 * is a local evaluation provider and carries no credential by design (FR-079).
 */
function missingConfiguration(connection, credential, kind) {
  const missing = []
  const providerCode = String(connection?.provider?.code ?? '').trim()
  if (!providerCode) missing.push('PROVIDER')

  if (kind === 'CHANNEL') {
    if (!String(connection?.externalAccountId ?? '').trim()) missing.push('EXTERNAL_ACCOUNT_ID')
    return missing
  }

  if (!String(connectionMetadata(connection).model ?? '').trim()) missing.push('MODEL')
  if (providerCode.toLowerCase() !== 'ollama' && !String(credential?.secretRef ?? '').trim()) {
    missing.push('SECRET_REF')
  }
  return missing
}

function credentialFailures(credential, now) {
  const failures = []
  if (!credential) return failures
  if (credential.status && credential.status !== 'ACTIVE') {
    failures.push(`CREDENTIAL_${credential.status}`)
  }
  if (credential.expiresAt && new Date(credential.expiresAt).getTime() <= now.getTime()) {
    failures.push('CREDENTIAL_EXPIRED')
  }
  return failures
}

/**
 * Evaluate one connection's health from evidence.
 *
 * Precedence is DISABLED → MISCONFIGURED → ERROR → DEGRADED → CONNECTED. DISABLED
 * leads because an operator who has not enabled a connection does not need to be
 * told its optional fields are blank; that becomes actionable the moment they do.
 * Nothing observed is hidden by the precedence, though — `reasons` carries every
 * finding, so a disabled *and* misconfigured connection says both.
 *
 * @param {object}  input
 * @param {object}  input.connection            IntegrationConnection (+ provider)
 * @param {object}  [input.credential]          IntegrationCredential, if any
 * @param {Date|string|null} [input.lastEventAt] newest inbound evidence for this
 *   connection; only meaningful for a CHANNEL
 * @param {'CHANNEL'|'MODEL_PROVIDER'} [input.kind]
 * @param {Date}    [input.now]
 * @param {number}  [input.staleAfterMs]
 * @returns {{ state: string, reasons: string[], evidence: object }}
 */
export function evaluateConnectionHealth({
  connection,
  credential = null,
  lastEventAt = null,
  kind = 'MODEL_PROVIDER',
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  if (!connection) throw new Error('CONNECTION_REQUIRED')
  if (!CONNECTION_KINDS.includes(kind)) throw new Error('CONNECTION_KIND_INVALID')

  const reasons = []
  const enabled = connection.status === 'ACTIVE'
  if (!enabled) reasons.push(`CONNECTION_${connection.status ?? 'UNKNOWN'}`)

  const missing = missingConfiguration(connection, credential, kind)
  reasons.push(...missing.map((field) => `MISSING_${field}`))

  const credentialProblems = credentialFailures(credential, now)
  reasons.push(...credentialProblems)

  const lastEvent = lastEventAt ? new Date(lastEventAt) : null
  const ageMs = lastEvent ? now.getTime() - lastEvent.getTime() : null
  // Traffic is only evidence for a channel. A model provider has no inbound stream,
  // so judging it on silence would leave every LLM connection permanently DEGRADED.
  const trafficMatters = kind === 'CHANNEL' && enabled && missing.length === 0
  if (trafficMatters) {
    if (!lastEvent) reasons.push('NO_TRAFFIC_OBSERVED')
    else if (ageMs > staleAfterMs) reasons.push('TRAFFIC_STALE')
  }

  const state = !enabled ? 'DISABLED'
    : missing.length ? 'MISCONFIGURED'
      : credentialProblems.length ? 'ERROR'
        : (trafficMatters && (!lastEvent || ageMs > staleAfterMs)) ? 'DEGRADED'
          : 'CONNECTED'

  return {
    state,
    reasons,
    evidence: {
      kind,
      status: connection.status ?? null,
      role: connection.role ?? null,
      provider: connection.provider?.code ?? null,
      credentialStatus: credential?.status ?? (credential ? null : 'MISSING'),
      expiresAt: credential?.expiresAt ?? null,
      lastEventAt: lastEvent ? lastEvent.toISOString() : null,
      lastEventAgeMs: ageMs,
      staleAfterMs: kind === 'CHANNEL' ? staleAfterMs : null,
    },
  }
}
