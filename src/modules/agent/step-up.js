import { mintStepUpLinkToken } from '@/modules/identity/link-line-identity'
import { zIssueStepUpInput } from '@/lib/validation/entities'

// @req FR-026 — step-up re-authentication for HIGH-sensitivity agent actions (Gate F).
// @spec ADR-007 §P7 / Gate E→F — "the most important boundary": a writing agent is not
//   safe until authorization, audit AND step-up auth are proven. A HIGH action (refund,
//   cancel, deactivate) must present a fresh, single-use, expiring proof that the
//   principal re-authenticated — not merely that they are logged in.
// @spec D2-domain-identity-02 — the agent domain owns no Prisma models by design
//   (docs/domains/agent/CHARTER.md); minting the proof is `identity`'s
//   `mintStepUpLinkToken` (src/modules/identity/link-line-identity.js), not a
//   direct `prisma.identityLinkToken.create` here. `issueStepUp` is now a thin
//   validation-and-delegate wrapper so every existing caller (agent/index.js,
//   agent-action-gate.js, the integration tests) keeps its exact signature.
// @tested tests/integration/agent-action-gate.test.js
//
// Storage: reuses the IdentityLinkToken table's single-use/expiring/(tenant,person)-scoped
// proof shape with provider 'STEPUP' — a step-up is exactly that primitive, so this adds
// no new model. It is a distinct provider from 'LINE' account-linking tokens.

const PROVIDER = 'STEPUP'

/**
 * Issue a single-use, short-lived step-up token for a principal.
 * @returns {{ token: string, expiresAt: Date }}
 */
export async function issueStepUp(input) {
  const { tenantId, personId, ttlSeconds } = zIssueStepUpInput.parse(input)
  return mintStepUpLinkToken({ tenantId, personId, ttlSeconds })
}

/**
 * Consume a step-up token atomically, within the caller's transaction. Throws
 * `STEP_UP_REQUIRED` when the token is absent/expired/consumed or bound to a different
 * principal — so a failed action rolls the consumption back with the rest of the write.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export async function consumeStepUp(tx, { tenantId, personId, token }) {
  if (!token) throw new Error('STEP_UP_REQUIRED: this action needs a step-up token')
  const row = await tx.identityLinkToken.findUnique({ where: { token } })
  if (
    !row ||
    row.provider !== PROVIDER ||
    row.tenantId !== tenantId ||
    row.personId !== personId ||
    row.consumedAt ||
    row.expiresAt.getTime() <= Date.now()
  ) {
    throw new Error('STEP_UP_REQUIRED: step-up token is invalid, expired, or already used')
  }
  await tx.identityLinkToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } })
  return row.id
}
