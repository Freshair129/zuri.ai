// @req FR-117 — deduplication and version relationships within one tenant
// @spec SEC-021, BR-021, docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §11 — never across tenants
// @tested tests/unit/knowledge-dedup.test.js

import { createHash } from 'node:crypto'

/** The four parts BR-021 names, joined behind the tenant the comparison happens inside. */
const IDENTITY_FIELDS = Object.freeze(['source_id', 'source_version', 'content_hash', 'pipeline_version'])

/**
 * Unit separator, the same choice FR-081's key makes, and for the same reason:
 * a space is legal inside a source id and a version, so joining on one lets a
 * field borrow from its neighbour — `{'a b', 'c'}` and `{'a', 'b c'}` hash
 * identically. A colliding key in the module whose only job is not colliding.
 */
const FIELD_SEPARATOR = ''

/**
 * BR-021's four-part ingestion identity, computed inside a tenant.
 *
 * The tenant is folded into the hash, and that is the security property rather
 * than a convenience. Two tenants holding a byte-identical document hold two
 * facts; collapsing them is a cross-tenant disclosure wearing the costume of an
 * optimisation (SEC-021). Folding the tenant in means the collapse cannot be
 * expressed — there is no comparison to forbid, and nothing a later reader can
 * delete as redundant.
 *
 * This is NOT FR-081's raw-boundary key, which is
 * sha256(tenantId, connectionId, entityType, externalId, payloadHash) and
 * answers "have I already received this delivery". This one answers "is this
 * the same knowledge", and a change of pipeline version makes the answer no
 * even when every byte is identical — a reparse under a new parser is a new
 * derivation, which is what makes reprocessing a whole corpus safe.
 *
 * Nothing is defaulted. A missing part is refused rather than hashed as an
 * empty string, because a hole in a key is not an absence: it is a value that
 * every other artifact missing the same part collides with.
 */
export function ingestionIdentity(artifact) {
  const tenantId = artifact?.scope?.tenantId
  if (!tenantId) {
    throw new Error(
      `ingestion identity requires a scope naming a tenantId${label(artifact)}; a comparison without one is a comparison across tenants`,
    )
  }
  for (const field of IDENTITY_FIELDS) {
    const value = artifact[field]
    if (value === undefined || value === null || value === '') {
      throw new Error(`ingestion identity requires ${field}${label(artifact)}`)
    }
  }
  return createHash('sha256')
    .update([tenantId, ...IDENTITY_FIELDS.map((field) => String(artifact[field]))].join(FIELD_SEPARATOR))
    .digest('hex')
}

/** Enough to find the offending artifact in a corpus, without dumping its content into a log. */
function label(artifact) {
  const id = artifact?.source_id
  return id ? ` (source_id ${id})` : ''
}

/**
 * Orders two versions, or declines to.
 *
 * Numeric versions order numerically. Anything else — `draft` against `final`,
 * a date format, a git sha — has no order this module can establish, and
 * guessing one would put a direction in the graph that nothing supports.
 */
function isEarlier(candidate, incoming) {
  const a = Number(candidate.source_version)
  const b = Number(incoming.source_version)
  if (Number.isFinite(a) && Number.isFinite(b)) return a < b
  return null
}

/**
 * Places an artifact against the ones already held, using only what the
 * artifacts say about themselves.
 *
 * `compared` reports which candidates were actually considered, so a caller can
 * see that an out-of-scope candidate was not judged independent — it was never
 * looked at.
 */
export function classifyAgainst(artifact, candidates = []) {
  const identity = ingestionIdentity(artifact)
  const compared = candidates.filter((candidate) => candidate?.scope?.tenantId === artifact?.scope?.tenantId)
  const warnings = []

  const withIdentity = compared.map((candidate) => ({ candidate, identity: ingestionIdentity(candidate) }))

  const duplicate = withIdentity.find((entry) => entry.identity === identity)
  if (duplicate) {
    // A duplicate replaced nothing, so it earns no edge. Emitting one would put
    // a supersession in the graph for an artifact that changed nothing.
    return { relationship: 'DUPLICATE_OF', of: duplicate.identity, identity, compared, edges: [], warnings }
  }

  const sameSource = withIdentity.filter((entry) => entry.candidate.source_id === artifact.source_id)
  if (!sameSource.length) {
    return { relationship: 'INDEPENDENT', identity, compared, edges: [], warnings }
  }

  // Supersede EVERY prior this artifact is determinably later than, not merely
  // the first the caller happened to pass. Superseding one of three leaves the
  // other two with no answer to "what replaced this?" — the missing back edge
  // this function argues against, reintroduced through arity.
  const superseded = []
  for (const entry of sameSource) {
    const earlier = isEarlier(entry.candidate, artifact)
    if (earlier === null) {
      warnings.push(
        `cannot order source_version ${JSON.stringify(entry.candidate.source_version)} against ${JSON.stringify(artifact.source_version)}; recorded as a revision with no direction`,
      )
    } else if (earlier) {
      superseded.push(entry.identity)
    }
  }

  const edges = superseded.flatMap((priorIdentity) => [
    { from: identity, type: 'SUPERSEDES', to: priorIdentity },
    { from: priorIdentity, type: 'SUPERSEDED_BY', to: identity },
  ])

  return {
    relationship: 'REVISION_OF',
    of: sameSource[0].identity,
    supersedes: superseded[0] ?? null,
    identity,
    compared,
    edges,
    warnings,
  }
}
