// @req FR-030 — enforce the ADR-007 P4 hard boundary: the Zuri DB and the MSP DB are
//   separate stores. MVP may share one Postgres *instance*, but never the same database
//   /schema/role — an MSP migration failure must never drag Zuri's CRM/audit down.
// @spec ADR-007 §P4 — "DB boundary: Zuri DB ≠ MSP DB."
// @tested tests/unit/db-boundary.test.js
//
// MSP lives in its own repo (D:\msp) reached over stdio; its store is configured by
// MSP_DB_URL / MSP_DB_PATH, never by DATABASE_URL. This guard catches the ops mistake of
// pointing them at one place.

/** Normalize a store reference (Postgres URL or SQLite file) for comparison. */
export function normalizeStore(ref) {
  if (!ref) return null
  let s = String(ref).trim().toLowerCase()
  s = s.replace(/^file:/, '') // sqlite `file:./x.db` → `./x.db`
  // For a Postgres URL, compare on host+port+db+schema, dropping credentials/params.
  const m = s.match(/^(postgres(?:ql)?):\/\/(?:[^@]*@)?([^/?]+)\/([^?]+)(?:\?(.*))?$/)
  if (m) {
    const host = m[2]
    const db = m[3]
    const schema = (m[4] || '').match(/schema=([^&]+)/)?.[1] || 'public'
    return `pg://${host}/${db}?schema=${schema}`
  }
  return s
}

/**
 * Throw if the Zuri store and the MSP store resolve to the same place. A missing MSP
 * store is fine (stdio MSP not configured) — the boundary only bites when both exist.
 */
export function assertDistinctStores(zuriRef, mspRef) {
  const zuri = normalizeStore(zuriRef)
  const msp = normalizeStore(mspRef)
  if (!zuri || !msp) return
  if (zuri === msp) {
    throw new Error(
      'DB boundary violated (ADR-007 P4): the MSP store and the Zuri store must not be the same — ' +
        'MSP and Zuri have different lifecycles; an MSP migration must never risk Zuri data.',
    )
  }
}

export function resolveZuriDbUrl(env = process.env) {
  return env.DATABASE_URL || null
}

export function resolveMspStore(env = process.env) {
  return env.MSP_DB_URL || env.MSP_DB_PATH || null
}

/** Enforce the boundary from the environment; call at startup where both are configured. */
export function assertDbBoundary(env = process.env) {
  assertDistinctStores(resolveZuriDbUrl(env), resolveMspStore(env))
}
