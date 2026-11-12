// @req FR-091, FR-103, FR-127, FR-161 — LINE CRM view models use recorded values and existing CRM contracts.
// @spec SDD-050, SEC-005, BR-001
// @tested tests/unit/line-crm-view-models.test.js, tests/unit/line-crm-members-render.test.js, tests/unit/line-crm-live-chat-render.test.js

const CONSENT_LABELS = Object.freeze({
  PENDING: 'รอยืนยัน consent',
  GRANTED: 'ยืนยัน consent แล้ว',
  DECLINED: 'ลูกค้าปฏิเสธ',
  GRANDFATHERED: 'ลูกค้าเก่า (ก่อนมีระบบนี้)',
})

export const UNKNOWN_CONSENT_LABEL = 'ไม่ทราบสถานะ'
export const NO_DATA_LABEL = 'ไม่มีข้อมูล'

export function getConsentLabel(status) {
  return typeof status === 'string' ? CONSENT_LABELS[status] || UNKNOWN_CONSENT_LABEL : UNKNOWN_CONSENT_LABEL
}

export function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}

export function buildCustomerRows(conversations) {
  const grouped = new Map()
  for (const conversation of Array.isArray(conversations) ? conversations : []) {
    const customer = conversation?.customer
    if (customer?.id == null) continue
    const group = grouped.get(customer.id) || { customer, conversations: [] }
    group.conversations.push(conversation)
    grouped.set(customer.id, group)
  }

  return [...grouped.entries()].map(([id, group]) => {
    const messageTimes = group.conversations
      .map((conversation) => conversation?.lastMessage?.createdAt)
      .filter(Boolean)
    const lastMessageAt = messageTimes.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null
    const customer = group.customer

    return {
      kind: 'customer',
      id,
      displayName: customer.displayName || 'ไม่ระบุชื่อ',
      code: customer.code,
      lifecycleStage: customer.lifecycleStage || 'ไม่ทราบ',
      consentStatus: customer.consentStatus,
      consentLabel: getConsentLabel(customer.consentStatus),
      consentRecordedAt: customer.consentRecordedAt || null,
      channels: [...new Set(group.conversations.map((conversation) => conversation?.channel).filter(Boolean))],
      conversationCount: group.conversations.length,
      lastMessageAt,
    }
  })
}

function storedText(value) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function buildRegistryRows(registry) {
  return (Array.isArray(registry) ? registry : [])
    .filter((registration) => registration?.kind === 'USER')
    .map((registration) => {
      const metadata = registration.metadata && typeof registration.metadata === 'object'
        ? registration.metadata
        : {}
      return {
        kind: 'registry',
        id: registration.id,
        name: storedText(registration.name) || 'ไม่ระบุชื่อ',
        externalAccountId: storedText(registration.externalAccountId),
        status: storedText(registration.status),
        role: storedText(metadata.role),
        department: storedText(metadata.department),
        createdAt: registration.createdAt,
        consentLabel: NO_DATA_LABEL,
      }
    })
}

export async function createFollowUpTask(input = {}) {
  const { request, businessId, conversationId, title, dueDate } = input && typeof input === 'object' ? input : {}
  const cleanTitle = typeof title === 'string' ? title.trim() : ''
  const cleanDueDate = typeof dueDate === 'string' ? dueDate.trim() : ''
  if (!businessId || !conversationId || !cleanTitle || !cleanDueDate || typeof request !== 'function') {
    return { ok: false, status: null, error: 'กรุณาระบุ Business บทสนทนา หัวข้องาน และวันที่ติดตาม' }
  }

  try {
    const task = await request('/api/crm/sales-tasks', {
      method: 'POST',
      body: { businessId, conversationId, title: cleanTitle, type: 'FOLLOW_UP', dueDate: cleanDueDate },
    })
    if (!task?.id || !task?.code) {
      return { ok: false, status: null, error: 'ยืนยันผลการสร้างงานติดตามไม่ได้จากข้อมูลตอบกลับ' }
    }
    return { ok: true, task }
  } catch (error) {
    return {
      ok: false,
      status: Number.isInteger(error?.status) ? error.status : null,
      error: typeof error?.message === 'string' && error.message ? error.message : 'ไม่สามารถสร้างงานติดตามได้',
    }
  }
}

export function followUpTaskNotice(result) {
  if (result?.ok && result.task?.id && result.task?.code) {
    return { type: 'success', text: `สร้างงานติดตาม ${result.task.code} แล้ว` }
  }
  if (result?.status === 403) {
    const permissionMessage = 'ต้องเป็นเจ้าของ Business หรือมีสิทธิ์ SALES_REP จึงจะสร้างงานติดตามได้'
    return { type: 'error', text: result.error ? permissionMessage + ': ' + result.error : permissionMessage }
  }
  return { type: 'error', text: result?.error || 'ไม่สามารถสร้างงานติดตามได้' }
}

export async function loadRecordedAnalysis({ request, businessId, conversationId, consentStatus }) {
  if (consentStatus !== 'GRANTED') return { state: 'CONSENT_BLOCKED' }
  if (!businessId || !conversationId || typeof request !== 'function') {
    return { state: 'ERROR', error: 'ข้อมูลสำหรับอ่านผลวิเคราะห์ไม่ครบ' }
  }

  try {
    const path = `/api/crm/conversations/${encodeURIComponent(conversationId)}/analysis?businessId=${encodeURIComponent(businessId)}`
    const payload = await request(path)
    if (payload?.conversationId !== conversationId || !Array.isArray(payload?.analyses)) {
      return { state: 'ERROR', error: 'ข้อมูลผลวิเคราะห์ไม่ตรงกับบทสนทนาที่เลือก' }
    }
    if (payload.analyses.length === 0) return { state: 'EMPTY' }

    const [analysis] = [...payload.analyses].sort((left, right) =>
      new Date(right?.analyzedAt).getTime() - new Date(left?.analyzedAt).getTime())
    return analysis ? { state: 'READY', analysis } : { state: 'EMPTY' }
  } catch (error) {
    return {
      state: 'ERROR',
      error: typeof error?.message === 'string' && error.message ? error.message : 'ไม่สามารถอ่านผลวิเคราะห์ได้',
    }
  }
}
