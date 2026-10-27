// @req FR-281, FR-282 — policy/binding mutations and intake serialize before authority reads.
// @spec ADR-115, SDD-112
// @tested tests/unit/marketing-report-lock.test.js, tests/postgres/marketing-report-native.test.js, tests/integration/marketing-report-native.test.js
import { setTimeout as delay } from 'node:timers/promises'
import { reportError } from './marketing-report-wire.js'

export function marketingReportRetryable(error, provider = 'sqlite') {
  if (error?.code === 'P1008' || error?.code === 'P2034') return true
  if (error?.code === 'P2010') return (provider === 'postgresql' ? ['55P03', '40P01', '40001', '57014'] : ['5', '6', 'SQLITE_BUSY', 'SQLITE_LOCKED']).includes(String(error.meta?.code))
  return error?.code === 'P2002' && /bindingId.*sourceReportId|sourceReportId.*bindingId/.test(String(error.meta?.target))
}

export async function lockMarketingReportScope(tx, { provider, businessId, bindingId, keyHash } = {}) {
  if (provider === 'sqlite') {
    // Even zero matching rows acquire SQLite's writer transaction. Direct SQL
    // preserves id/version/updatedAt and the reviewed binding no-op guard.
    if (keyHash) await tx.$executeRaw`UPDATE "MarketingReportBinding" SET "id"="id" WHERE "keyHash"=${keyHash}`
    else if (bindingId) await tx.$executeRaw`UPDATE "MarketingReportBinding" SET "id"="id" WHERE "id"=${bindingId}`
    else await tx.$executeRaw`UPDATE "MarketingReportBinding" SET "id"="id" WHERE "businessId"=${businessId}`
    return
  }
  if (provider !== 'postgresql' || typeof businessId !== 'string' || !businessId) throw reportError(503, 'REPORT_RECEIVER_UNAVAILABLE')
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout='750ms'")
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout='1100ms'")
  const policy = await tx.$queryRaw`SELECT "businessId" FROM "MarketingReportPolicy" WHERE "businessId"=${businessId} FOR UPDATE`
  if (!policy.length) {
    // There is no row to lock yet. This per-Business transaction lock orders
    // creation, then a READ COMMITTED reread sees any just-committed policy.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(115,hashtext(${businessId}))::text AS locked`
    await tx.$queryRaw`SELECT "businessId" FROM "MarketingReportPolicy" WHERE "businessId"=${businessId} FOR UPDATE`
  }
  if (bindingId) await tx.$queryRaw`SELECT "id" FROM "MarketingReportBinding" WHERE "id"=${bindingId} AND "businessId"=${businessId} FOR UPDATE`
}

export async function lockMarketingReportTarget(tx, { provider, businessId, initiativeId } = {}) {
  if (provider === 'sqlite') return // The installation-wide writer is already held.
  if (provider !== 'postgresql') throw reportError(503, 'REPORT_RECEIVER_UNAVAILABLE')
  // Policy -> Binding -> Business -> Plan -> Initiative. Native scope updates
  // must finish before these reads or wait until the retained report commits.
  const business = await tx.$queryRaw`SELECT "id" FROM "Business" WHERE "id"=${businessId} FOR UPDATE`
  if (!business.length) throw reportError(404, 'REPORT_SCOPE_UNAVAILABLE')
  const hint = await tx.marketingInitiative.findFirst({ where: { id: initiativeId, businessId }, select: { planId: true } })
  if (!hint) throw reportError(404, 'REPORT_SCOPE_UNAVAILABLE')
  const plan = await tx.$queryRaw`SELECT "id" FROM "MarketingPlan" WHERE "id"=${hint.planId} AND "businessId"=${businessId} FOR UPDATE`
  if (!plan.length) throw reportError(404, 'REPORT_SCOPE_UNAVAILABLE')
  const initiative = await tx.$queryRaw`SELECT "id","planId" FROM "MarketingInitiative" WHERE "id"=${initiativeId} AND "businessId"=${businessId} FOR UPDATE`
  if (!initiative.length) throw reportError(404, 'REPORT_SCOPE_UNAVAILABLE')
  // A native writer may have changed the plan between the hint and row lock.
  // Roll back and reacquire the whole order; never inspect an unlocked new plan.
  if (initiative[0].planId !== hint.planId) throw Object.assign(new Error('REPORT_SCOPE_LOCK_RETRY'), { code: 'P2034' })
}

export async function withMarketingReportTransaction(db, provider, action) {
  if (!['sqlite', 'postgresql'].includes(provider) || typeof db?.$transaction !== 'function') throw reportError(503, 'REPORT_RECEIVER_UNAVAILABLE')
  // Prisma5.22 exposes its generated provider. A forgotten provider argument
  // must not run the SQLite locking protocol on the real PostgreSQL client.
  if (['sqlite', 'postgresql'].includes(db._activeProvider) && db._activeProvider !== provider) throw reportError(503, 'REPORT_RECEIVER_UNAVAILABLE')
  const deadline = performance.now() + 5000
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = Math.floor(deadline - performance.now())
    if (remaining < 3) break
    try {
      const maxWait = Math.min(1000, Math.floor(remaining / 2)), timeout = Math.min(1200, remaining - maxWait - 1)
      const result = await db.$transaction(action, { maxWait, timeout, ...(provider === 'postgresql' ? { isolationLevel: 'ReadCommitted' } : {}) })
      if (performance.now() >= deadline) throw reportError(503, 'REPORT_RECEIVER_UNAVAILABLE')
      return result
    } catch (error) {
      if (error?.status) throw error
      if (!marketingReportRetryable(error, provider) || attempt === 2) throw reportError(503, 'REPORT_RECEIVER_UNAVAILABLE')
      const wait = attempt === 0 ? 25 : 100
      if (performance.now() + wait >= deadline) break
      await delay(wait)
    }
  }
  throw reportError(503, 'REPORT_RECEIVER_UNAVAILABLE')
}
