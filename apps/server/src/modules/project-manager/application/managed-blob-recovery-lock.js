// @req FR-292, FR-293 — read-only-safe cross-process recovery/snapshot exclusion.
// @spec ADR-115
// @tested tests/postgres/managed-blob-recovery-races.test.js
// Separate two-int advisory namespace from Pipeline's one-bigint graph key.
export const RECOVERY_MUTEX = Object.freeze([115, 292])
const holders = new WeakMap(), active = new WeakSet()
// The offline bridge bundles application code separately. A non-serializable,
// non-writable closure carries the originating lock lifetime across that bundle;
// a JSON/body property or an expired/reused pool client cannot supply it.
const READ_ONLY_PROOF = Symbol.for('zuri.pm.recovery.read-only-fence.v1')

// The protected exporter acquires before READ ONLY BEGIN, so its snapshot is
// established AFTER exclusion. No persistent setting, role or DB row changes.
// Try-only admission is bounded; contention refuses instead of stale extraction.
export async function acquireReadOnlyRecoveryFence(client) {
  if (holders.has(client)) throw Object.assign(new Error('Recovery snapshot fence unavailable'), { code: 'TARGET_LOCK_UNAVAILABLE' })
  const result = await client.query('SELECT pg_try_advisory_lock($1::int,$2::int) AS locked', RECOVERY_MUTEX)
  if (result.rows[0]?.locked !== true) throw Object.assign(new Error('Recovery snapshot fence unavailable'), { code: 'TARGET_LOCK_UNAVAILABLE' })
  const token = {}
  holders.set(client, token); active.add(token)
  return async () => {
    active.delete(token); holders.delete(client)
    const released = await client.query('SELECT pg_advisory_unlock($1::int,$2::int) AS unlocked', RECOVERY_MUTEX)
    if (released.rows[0]?.unlocked !== true) throw new Error('Recovery snapshot fence release failed')
  }
}
export function registerReadOnlyRecoveryFacade(facade, client) {
  const token = holders.get(client)
  if (token && active.has(token)) Object.defineProperty(facade, READ_ONLY_PROOF, { value: () => active.has(token) })
  return facade
}
export const hasReadOnlyRecoveryFence = facade => Object.hasOwn(facade, READ_ONLY_PROOF)
  && typeof facade[READ_ONLY_PROOF] === 'function' && facade[READ_ONLY_PROOF]() === true
