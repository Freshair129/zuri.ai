import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { resolveLineIdentity } from '@/modules/identity/resolve-line-identity'
import { zIngestLineMessageInput } from '@/lib/validation/entities'

// @req FR-023 — the Zuri Backend Slice LINE gateway (ADR-007 P2): one inbound LINE
//   message becomes identity → customer → conversation → message, in one transaction.
// @spec ADR-007 P3/P2 — every LINE message resolves through the ONE identity seam
//   (resolveLineIdentity, FR-021) before it touches a customer; memory/CRM are keyed
//   by the resolved principal, never by the raw lineUserId.
// @spec BR-001, SEC-001 — tenant-scoped throughout; a business scope is optional.
// @tested tests/integration/line-ingest.test.js

const CHANNEL = 'LINE'

const customerCodeExists = async (code) => Boolean(await prisma.customer.findUnique({ where: { code } }))

/**
 * The conversation's identity: tenant + channel + the provider's thread id.
 *
 * Every lookup goes through this key rather than through `externalThreadId` alone.
 * That is the whole isolation guarantee — the key cannot return another tenant's
 * conversation, so there is no scope to re-check afterwards (BR-001, SEC-001).
 */
const conversationKey = (tenantId, threadId) => ({
  tenantId_channel_externalThreadId: { tenantId, channel: CHANNEL, externalThreadId: threadId },
})

/**
 * Ingest one LINE message. Idempotent on externalMessageId within its conversation
 * (a redelivered webhook does not double-store). Returns the resolved ids.
 * @returns {{ personId, customerId, conversationId, messageId, created: {customer:boolean, conversation:boolean, message:boolean} }}
 */
export async function ingestLineMessage(input) {
  const data = zIngestLineMessageInput.parse(input)
  const { tenantId, businessId, lineUserId, displayName, threadId, text, externalMessageId, direction, correlationId } = data

  // 1. Identity — the single seam. Resolves (or creates) the Person principal.
  const identity = await resolveLineIdentity({ tenantId, lineUserId, displayName })

  // 2. Idempotency: a redelivered message short-circuits before any write.
  //    Both lookups are scoped by construction. A provider message id is unique
  //    inside its own thread, never globally, so it is only meaningful once the
  //    conversation is known — which is also what keeps another tenant's message id
  //    from resolving (and disclosing) a conversation that is not ours.
  if (externalMessageId) {
    const existing = await prisma.conversation.findUnique({ where: conversationKey(tenantId, threadId) })
    if (existing) {
      const dup = await prisma.message.findUnique({
        where: { conversationId_externalMessageId: { conversationId: existing.id, externalMessageId } },
      })
      if (dup) {
        return {
          personId: identity.personId,
          customerId: existing.customerId,
          conversationId: existing.id,
          messageId: dup.id,
          created: { customer: false, conversation: false, message: false },
        }
      }
    }
  }

  const custCode = await uniqueHumanCode('CUS', displayName || lineUserId, customerCodeExists)

  return prisma.$transaction(async (tx) => {
    // 3. Customer — one per (tenant, principal); shared across the tenant's businesses.
    let customer = await tx.customer.findUnique({ where: { tenantId_personId: { tenantId, personId: identity.personId } } })
    const createdCustomer = !customer
    if (!customer) {
      customer = await tx.customer.create({
        data: { code: custCode, tenantId, businessId: businessId ?? null, personId: identity.personId, displayName: displayName || 'LINE customer' },
      })
    }

    // 4. Conversation — one per (tenant, channel, external thread).
    let conversation = await tx.conversation.findUnique({ where: conversationKey(tenantId, threadId) })
    const createdConversation = !conversation
    if (!conversation) {
      conversation = await tx.conversation.create({
        data: { tenantId, businessId: businessId ?? null, customerId: customer.id, channel: CHANNEL, externalThreadId: threadId },
      })
    }

    // 5. Message — appended; (conversationId, externalMessageId) enforces idempotency
    //    at the database, which is what makes step 2 an optimisation rather than the
    //    guarantee: two concurrent redeliveries still collide on the constraint.
    const message = await tx.message.create({
      data: { conversationId: conversation.id, direction, body: text, externalMessageId: externalMessageId ?? null },
    })

    await recordAudit(tx, {
      entityType: 'CONVERSATION',
      entityId: conversation.id,
      action: 'MESSAGE_INGESTED',
      actorType: 'LINE',
      // @spec NFR-017 — the audit row is the DURABLE end of the correlation chain. A log
      //   stream is sampled, rotated and eventually gone; this row is append-only, so
      //   "which webhook delivery produced this message" stays answerable afterwards.
      payload: {
        tenantId,
        customerId: customer.id,
        direction,
        messageId: message.id,
        ...(correlationId ? { correlationId } : {}),
      },
    })

    return {
      personId: identity.personId,
      customerId: customer.id,
      conversationId: conversation.id,
      messageId: message.id,
      created: { customer: createdCustomer, conversation: createdConversation, message: true },
    }
  })
}
