const DIRECTIONS = new Set(['INBOUND', 'OUTBOUND'])

function required(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`MEMORY_PROJECTION_${field.toUpperCase()}_REQUIRED`)
  return value.trim()
}

function receiptKey(jobId, direction) {
  return { lineConversationJobId_direction: { lineConversationJobId: jobId, direction } }
}

function assertSameProjection(row, expected) {
  for (const field of ['tenantId', 'businessId', 'lineConversationJobId', 'principalId', 'direction',
    'episodicMemoryOptIn', 'mspThreadId', 'mspSessionId', 'mspMessageId', 'mspExchangeId']) {
    if (row[field] !== expected[field]) throw new Error('MEMORY_PROJECTION_RECEIPT_CONFLICT')
  }
  if (expected.crmMessageId && row.crmMessageId && row.crmMessageId !== expected.crmMessageId) {
    throw new Error('MEMORY_PROJECTION_RECEIPT_CONFLICT')
  }
}

/** Persist only MSP/CRM identifiers and acknowledgement state, never message content. */
export async function recordMemoryProjectionReceipt(db, input = {}) {
  const { job } = input
  const direction = required(input.direction, 'direction')
  if (!DIRECTIONS.has(direction)) throw new Error('MEMORY_PROJECTION_DIRECTION_INVALID')
  const data = {
    tenantId: required(job?.tenantId, 'tenant_id'),
    businessId: required(job?.businessId, 'business_id'),
    lineConversationJobId: required(job?.id, 'job_id'),
    crmMessageId: input.crmMessageId ? required(input.crmMessageId, 'crm_message_id') : null,
    principalId: required(input.principalId, 'principal_id'),
    direction,
    episodicMemoryOptIn: job.episodicMemoryOptIn === true,
    mspThreadId: required(input.threadId, 'msp_thread_id'),
    mspSessionId: required(input.sessionId, 'msp_session_id'),
    mspMessageId: required(input.messageId, 'msp_message_id'),
    mspExchangeId: required(input.exchangeId, 'msp_exchange_id'),
    acknowledgedAt: input.acknowledgedAt ? new Date(input.acknowledgedAt) : new Date(),
  }
  if (Number.isNaN(data.acknowledgedAt.getTime())) throw new Error('MEMORY_PROJECTION_ACK_TIME_INVALID')
  if (direction === 'INBOUND' && !data.crmMessageId) throw new Error('MEMORY_PROJECTION_CRM_MESSAGE_REQUIRED')
  data.deliveryState = direction === 'INBOUND' ? 'ACKNOWLEDGED' : 'PENDING'
  data.deliveryAcknowledgedAt = direction === 'INBOUND' ? data.acknowledgedAt : null

  const persist = async tx => {
    const currentJob = await tx.lineConversationJob.findUnique({ where: { id: data.lineConversationJobId },
      select: { tenantId: true, businessId: true, memorySyncOptIn: true, errorCode: true } })
    if (!currentJob || currentJob.tenantId !== data.tenantId || currentJob.businessId !== data.businessId
      || currentJob.memorySyncOptIn !== true) throw new Error('MEMORY_PROJECTION_JOB_SCOPE_MISMATCH')
    const expected = { ...data, erasureStatus: currentJob.errorCode === 'PDPA_ERASURE' ? 'PENDING_MSP' : 'ACTIVE' }
    const existing = await tx.memoryProjectionReceipt.findUnique({ where: receiptKey(data.lineConversationJobId, direction) })
    if (existing) {
      assertSameProjection(existing, expected)
      if (expected.crmMessageId && !existing.crmMessageId) {
        return tx.memoryProjectionReceipt.update({ where: { id: existing.id }, data: {
          crmMessageId: expected.crmMessageId,
          ...(direction === 'OUTBOUND' ? { deliveryState: 'ACKNOWLEDGED', deliveryAcknowledgedAt: expected.acknowledgedAt } : {}),
        } })
      }
      return existing
    }
    return tx.memoryProjectionReceipt.create({ data: expected })
  }
  return typeof db?.$transaction === 'function' ? db.$transaction(persist) : persist(db)
}

export async function settleMemoryProjectionDelivery(tx, { job, crmMessageId, mspMessageId = null, receiptId, acknowledgedAt } = {}) {
  const key = receiptKey(required(job?.id, 'job_id'), 'OUTBOUND')
  const row = await tx.memoryProjectionReceipt.findUnique({ where: key })
  if (!row || row.tenantId !== job.tenantId || row.businessId !== job.businessId
    || (mspMessageId && row.mspMessageId !== required(mspMessageId, 'msp_message_id'))) {
    throw new Error('MEMORY_PROJECTION_RECEIPT_REQUIRED')
  }
  const crmId = required(crmMessageId, 'crm_message_id')
  if (row.crmMessageId && row.crmMessageId !== crmId) throw new Error('MEMORY_PROJECTION_RECEIPT_CONFLICT')
  return tx.memoryProjectionReceipt.update({ where: { id: row.id }, data: {
    crmMessageId: crmId,
    deliveryState: 'ACKNOWLEDGED',
    deliveryAcknowledgedAt: acknowledgedAt,
    deliveryReceiptId: receiptId ? required(receiptId, 'delivery_receipt_id') : null,
  } })
}

export async function closeMemoryProjectionDelivery(tx, jobId) {
  return tx.memoryProjectionReceipt.updateMany({ where: { lineConversationJobId: jobId, direction: 'OUTBOUND' },
    data: { deliveryState: 'CLOSED' } })
}

export async function markMemoryProjectionErasurePending(tx, { tenantId, principalId } = {}) {
  return tx.memoryProjectionReceipt.updateMany({ where: { tenantId, principalId, erasureStatus: { not: 'ERASED' } },
    data: { erasureStatus: 'PENDING_MSP', erasureReceiptId: null } })
}

export async function acknowledgeMemoryProjectionErasure(tx, { tenantId, principalId, erasureReceiptId } = {}) {
  const receiptId = required(erasureReceiptId, 'erasure_receipt_id')
  const result = await tx.memoryProjectionReceipt.updateMany({ where: { tenantId, principalId, erasureStatus: 'PENDING_MSP' },
    data: { erasureStatus: 'ERASED', erasureReceiptId: receiptId } })
  await tx.customer.updateMany({ where: { tenantId, personId: principalId, memoryErasureStatus: 'PENDING_MSP' },
    data: { memoryErasureStatus: 'ERASED' } })
  return result
}
