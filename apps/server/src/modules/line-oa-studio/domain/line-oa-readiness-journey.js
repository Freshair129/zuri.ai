// @req FR-225, FR-227, FR-228, FR-150, FR-235 — resumable SaaS OA journey from persisted evidence.
// @spec ADR-089, ADR-090, ADR-061 — configured transport is not full runtime qualification.
// @tested tests/unit/line-oa-readiness-journey.test.js
export const LINE_LOCAL_MODEL = 'qwen3.5:9b'
export const LINE_LOCAL_QUANTIZATION = 'Q4_K_M'
export function lineOaReadinessJourney({ account, credentials = [] } = {}) {
  const connection = account?.health?.connection
  const webhook = account?.health?.webhook
  const validBusiness = Boolean(account?.id && account?.businessId && account?.tenantId)
  const credentialValidated = Boolean(connection?.secretConfigured && connection?.lastValidatedAt
    && ['ACTIVE', 'CONNECTED'].includes(connection?.status))
  const webhookVerified = Boolean(webhook?.active && webhook?.lastTestStatusCode === 200 && webhook?.lastTestAt
    && typeof webhook.endpoint === 'string' && webhook.endpoint.endsWith(`/api/line-oa/accounts/${account?.id}/webhook`))
  const paired = credentials.filter(item => item.status === 'ACTIVE' && item.businessId === account?.businessId)
  const localSelected = account?.executionMode === 'EDGE' && account?.modelAccess === 'LOCAL_ONLY'
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
    { id: 'runtime', title: 'เลือก Edge และโมเดล', status: 'NOT_RUN',
      detail: `${localSelected ? 'เลือก Edge / Local only แล้ว' : 'เลือก Edge / Local only เพื่อใช้โมเดลในเครื่อง'} · อุปกรณ์ที่มี credential ใช้งานได้ ${paired.length} เครื่อง · ยังไม่มีผลรับรองความเร็ว ${LINE_LOCAL_MODEL} (${LINE_LOCAL_QUANTIZATION}) สำหรับ OA นี้` },
    { id: 'knowledge', title: 'เลือกความรู้และเครื่องมือ', status: gksSelected ? 'CONFIGURED' : 'ACTION_REQUIRED',
      detail: `${gksSelected ? 'เลือกคลัง GKS แล้ว' : 'เลือกคลัง GKS ที่เผยแพร่แล้ว'} · ต้องตรวจ published corpus, Graph/Vector, MSP MemoryOS และ CIN จาก trace จริง · การแก้ไขงานต้องให้ผู้ใช้ยืนยัน` },
    { id: 'test', title: 'ทดสอบจาก LINE จริง', status: 'NOT_RUN',
      detail: 'เจ้าของส่งคำถามสินค้าและสถานะงานจาก LINE แล้วตรวจ trace เดียวกัน: รับข้อความ → Edge/โมเดล → แหล่งอ้างอิง → LINE รับ Reply ยังไม่มีผลทดสอบครบเส้นทางที่ผูกกับ OA นี้' },
    { id: 'activate', title: 'เปิดใช้และตรวจสุขภาพ', status: live ? 'ACTIVE_UNQUALIFIED' : 'ACTION_REQUIRED',
      detail: live ? 'Server transport เปิดอยู่ แต่ยังไม่ได้รับรอง Local LLM/GKS/MSP ครบเส้นทาง ตรวจขั้นที่ยังไม่ผ่านก่อนประกาศพร้อมใช้งาน' : 'ตรวจสิทธิ์ แหล่งข้อมูล เครื่อง Edge และผลทดสอบก่อนเปิด Server transport ที่ส่วนตั้งค่าบัญชีด้านล่าง' },
  ]
  return { steps, completed: steps.filter(step => step.status === 'COMPLETE').length, qualified: false,
    localSelected, gksSelected, pairedCount: paired.length, live }
}
