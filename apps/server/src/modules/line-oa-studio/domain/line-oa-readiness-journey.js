// @req FR-225, FR-227, FR-228, FR-150, FR-235 — resumable SaaS OA journey from persisted evidence.
// @req FR-265, FR-266 — step 5 was "เลือก Edge และโมเดล": pick EDGE execution with
//   LOCAL_ONLY model access, and count how many devices hold a pairing credential.
//   ADR-100 D1 retires that choice and ADR-100 D4 replaces it with the one thing a
//   server answer now actually needs — a validated model provider API key for this
//   Business. The step reads the credential's own persisted evidence, not a
//   configuration flag, for the same reason every other step here does: a saved
//   selection is not a working connection.
// @spec ADR-089, ADR-090, ADR-061, ADR-100 — configured transport is not full runtime qualification.
// @tested tests/unit/line-oa-readiness-journey.test.js

/**
 * `modelCredential` is the Business's MODEL_PROVIDER credential as the account
 * reader exposes it — `{ provider, status, lastValidatedAt }` — or null when the
 * Business has none. It never carries material (SEC-030).
 */
export function lineOaReadinessJourney({ account, modelCredential = null } = {}) {
  const connection = account?.health?.connection
  const webhook = account?.health?.webhook
  const validBusiness = Boolean(account?.id && account?.businessId && account?.tenantId)
  const credentialValidated = Boolean(connection?.secretConfigured && connection?.lastValidatedAt
    && ['ACTIVE', 'CONNECTED'].includes(connection?.status))
  const webhookVerified = Boolean(webhook?.active && webhook?.lastTestStatusCode === 200 && webhook?.lastTestAt
    && typeof webhook.endpoint === 'string' && webhook.endpoint.endsWith(`/api/line-oa/accounts/${account?.id}/webhook`))
  // Validated, not merely present: a key that was entered and then revoked, or one
  // whose last validation failed, cannot answer a customer, and a step that showed
  // COMPLETE for it would be reporting storage rather than readiness.
  const modelKeyReady = Boolean(modelCredential?.status === 'ACTIVE' && modelCredential?.lastValidatedAt)
  const gksSelected = ['GKS_CORPUS', 'GKS_THEN_BUSINESS_KNOWLEDGE'].includes(account?.knowledgeGrounding)
  const live = account?.serverEnabled === true && account?.transportMode === 'CLOUD' && account?.status === 'CONNECTED'
  const steps = [
    { id: 'business', title: 'เลือกธุรกิจ', status: validBusiness ? 'COMPLETE' : 'ACTION_REQUIRED',
      detail: validBusiness ? 'บัญชีนี้ผูกกับธุรกิจที่เลือกแล้ว สิทธิ์จะตรวจใหม่ทุกครั้งที่บันทึก' : 'เลือกธุรกิจก่อนเริ่มเชื่อมต่อ LINE OA' },
    { id: 'prepare', title: 'เตรียม LINE OA', status: account?.integrationConnectionId ? 'COMPLETE' : 'ACTION_REQUIRED',
      detail: 'เตรียมบัญชี LINE Official Account และเปิด Messaging API ใน LINE ก่อนเชื่อม Channel' },
    { id: 'credentials', title: 'เชื่อม Channel', status: credentialValidated ? 'COMPLETE' : 'ACTION_REQUIRED',
      detail: credentialValidated ? `มีข้อมูลรับรองที่ตรวจสอบแล้ว ${connection.lastValidatedAt}` : 'เชื่อม Channel ผ่านฟอร์มที่ยืนยันตัวตนสองขั้น ข้อมูลลับจะไม่แสดงกลับมาในหน้านี้' },
    { id: 'webhook', title: 'ตั้ง Webhook', status: webhookVerified ? 'COMPLETE' : 'ACTION_REQUIRED',
      detail: webhookVerified ? `LINE ยืนยัน endpoint และผลทดสอบ HTTP 200 เมื่อ ${webhook.lastTestAt}` : 'ลงทะเบียน endpoint แล้วตรวจสถานะและผลทดสอบจาก LINE หากมีระบบเดิม ต้องตกลงย้ายก่อน' },
    { id: 'model-key', title: 'ใส่ API key ของโมเดล', status: modelKeyReady ? 'COMPLETE' : 'ACTION_REQUIRED',
      detail: modelKeyReady
        ? `ใช้ผู้ให้บริการ ${modelCredential.provider} · ตรวจสอบกับผู้ให้บริการแล้วเมื่อ ${modelCredential.lastValidatedAt} · คีย์จะไม่แสดงกลับมาในหน้านี้`
        : 'ทุกคำตอบของ OA นี้เรียกโมเดลด้วย API key ของธุรกิจเอง ใส่คีย์แบบเขียนอย่างเดียวผ่านฟอร์มที่ยืนยันตัวตนสองขั้น ระบบจะตรวจกับผู้ให้บริการก่อนบันทึก และค่าใช้จ่ายการเรียกโมเดลเป็นของธุรกิจ' },
    { id: 'knowledge', title: 'เลือกความรู้และเครื่องมือ', status: gksSelected ? 'CONFIGURED' : 'ACTION_REQUIRED',
      detail: `${gksSelected ? 'เลือกคลัง GKS แล้ว' : 'เลือกคลัง GKS ที่เผยแพร่แล้ว'} · ต้องตรวจ published corpus, Graph/Vector, MSP MemoryOS และ CIN จาก trace จริง · การแก้ไขงานต้องให้ผู้ใช้ยืนยัน` },
    { id: 'test', title: 'ทดสอบจาก LINE จริง', status: 'NOT_RUN',
      detail: 'เจ้าของส่งคำถามสินค้าและสถานะงานจาก LINE แล้วตรวจ trace เดียวกัน: รับข้อความ → โมเดล → แหล่งอ้างอิง → LINE รับ Reply ยังไม่มีผลทดสอบครบเส้นทางที่ผูกกับ OA นี้' },
    { id: 'activate', title: 'เปิดใช้และตรวจสุขภาพ', status: live ? 'ACTIVE_UNQUALIFIED' : 'ACTION_REQUIRED',
      detail: live ? 'Server transport เปิดอยู่ แต่ยังไม่ได้รับรอง GKS/MSP ครบเส้นทาง ตรวจขั้นที่ยังไม่ผ่านก่อนประกาศพร้อมใช้งาน' : 'ตรวจสิทธิ์ แหล่งข้อมูล API key ของโมเดล และผลทดสอบก่อนเปิด Server transport ที่ส่วนตั้งค่าบัญชีด้านล่าง' },
  ]
  return { steps, completed: steps.filter(step => step.status === 'COMPLETE').length, qualified: false,
    modelKeyReady, gksSelected, live }
}
