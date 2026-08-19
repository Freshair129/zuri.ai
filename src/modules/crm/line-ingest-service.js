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
 * Refuse a row that resolved through a global external-id lookup but belongs to a
 * different tenant (or channel). Scope is a precondition here, not a filter applied
 * afterwards — the caller must never observe that the other tenant's row exists.
 * @spec BR-001, SEC-001
 */
function assertSameTenant(row, tenantId, channel) {
  if (!row) return
  if (row.tenantId !== tenantId) throw new Error('LINE_INGEST_TENANT_MISMATCH')
  if (channel && row.channel !== channel) throw new Error('LINE_INGEST_TENANT_MISMATCH')
}

/**
 * Ingest one LINE message. Idempotent on externalMessageId (a redelivered webhook
 * does not double-store). Returns the resolved ids.
 * @returns {{ personId, customerId, conversationId, messageId, created: {customer:boolean, conversation:boolean, message:boolean} }}
 */
export async function ingestLineMessage(input) {
  const data = zIngestLineMessageInput.parse(input)
  const { tenantId, businessId, lineUserId, displayName, threadId, text, externalMessageId, direction } = data

  // 1. Identity — the single seam. Resolves (or creates) the Person principal.
  const identity = await resolveLineIdentity({ tenantId, lineUserId, displayName })

  // 2. Idempotency: a redelivered message id short-circuits before any write.
  if (externalMessageId) {
    const dup = await prisma.message.findUnique({ where: { externalMessageId } })
    if (dup) {
      const conv = await prisma.conversation.findUnique({ where: { id: dup.conversationId } })
      // The external namespace is not tenant-partitioned in the schema
      // (`Message.externalMessageId` is a GLOBAL @unique), so a match proves the id
      // was seen — not that this tenant is the one that saw it. Returning another
      // tenant's conversation/customer ids here would disclose them across the
      // isolation boundary (SEC-001), so an out-of-tenant hit is refused, not reused.
      assertSameTenant(conv, tenantId)
      return {
        personId: identity.personId,
        customerId: conv?.customerId,
        conversationId: dup.conversationId,
        messageId: dup.id,
        created: { customer: false, conversation: false, message: false },
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

    // 4. Conversation — one per external thread (channel-unique).
    // Same reasoning as the idempotency guard above: `externalThreadId` is a global
    // @unique, so a hit must be proven to belong to this tenant and channel before it
    // is continued. Without this a caller presenting another tenant's thread id would
    // append its message into that tenant's conversation.
    let conversation = await tx.conversation.findUnique({ where: { externalThreadId: threadId } })
    assertSameTenant(conversation, tenantId, CHANNEL)
    const createdConversation = !conversation
    if (!conversation) {
      conversation = await tx.conversation.create({
        data: { tenantId, businessId: businessId ?? null, customerId: customer.id, channel: CHANNEL, externalThreadId: threadId },
      })
    }

    // 5. Message — appended; externalMessageId (if any) enforces idempotency at the DB.
    const message = await tx.message.create({
      data: { conversationId: conversation.id, direction, body: text, externalMessageId: externalMessageId ?? null },
    })

    await recordAudit(tx, {
      entityType: 'CONVERSATION',
      entityId: conversation.id,
      action: 'MESSAGE_INGESTED',
      actorType: 'LINE',
      payload: { tenantId, customerId: customer.id, direction, messageId: message.id },
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
