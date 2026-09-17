import prisma from '@/lib/db'
import { isAccountWithinBusinessHours } from '../domain/line-oa-account'

// @req FR-244 — local model residency by business hours: the compute-owned edge
//   worker asks whether it should keep the model resident, without ever learning
//   which LINE OA account, tenant or Business it is answering for (ADR-061's
//   identity boundary; the job-claim wire contract already carries none of that).
//   The answer is one aggregate boolean derived from every server-enabled
//   account's declared hours, never a per-account schedule.
// @spec ADR-094 D6 option A; ADR-061
// @tested tests/unit/model-residency-service.test.js, tests/integration/fr244-line-oa-business-hours.test.js

/**
 * Pure: should the model stay resident right now, given this set of accounts?
 *
 * True when at least one account either declared no hours (stays resident always,
 * today's behaviour) or is currently inside its declared hours. False only when
 * every account has declared hours and every one of them is currently closed —
 * including the vacuous case of no accounts at all, which sheds the model rather
 * than holding VRAM for nothing.
 */
export function computeShouldBeWarm(accounts, now = new Date()) {
  return accounts.some((account) => isAccountWithinBusinessHours(account, now))
}

/**
 * The directive the edge worker polls for. Loads every server-enabled,
 * non-archived account's business hours — nothing else identifying — and
 * reduces them to the one aggregate boolean above.
 */
export async function getModelResidencyDirective({ db = prisma, now = new Date() } = {}) {
  const accounts = await db.lineOaAccount.findMany({
    where: { serverEnabled: true, status: { not: 'ARCHIVED' } },
    select: { businessHoursOpen: true, businessHoursClose: true },
  })
  return { shouldBeWarm: computeShouldBeWarm(accounts, now) }
}
