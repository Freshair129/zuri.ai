"use client";
import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { lineOaReadinessJourney } from '../domain/line-oa-readiness-journey';

// @req FR-225, FR-227, FR-228, FR-235 — eight-step evidence-based onboarding.
// @req FR-265, FR-266 — step 5 is the model API key, not an Edge/local-model choice.
// @spec ADR-089, ADR-090, ADR-061, ADR-100
// @tested tests/unit/line-oa-readiness-journey.test.js
const labels = { COMPLETE: 'มีหลักฐานแล้ว', ACTION_REQUIRED: 'รอดำเนินการ', NOT_RUN: 'ยังไม่ทดสอบ (NOT_RUN)', CONFIGURED: 'ตั้งค่าแล้ว รอตรวจจริง', ACTIVE_UNQUALIFIED: 'เปิดอยู่ รอรับรองครบเส้นทาง' };
const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700';

export default function LineOaReadinessJourney({ account, modelCredential = null, onAction, onLoadJobs, busy = false }) {
  const journey = lineOaReadinessJourney({ account, modelCredential });
  const [selected, setSelected] = useState(() => Math.max(0, journey.steps.findIndex(step => step.status !== 'COMPLETE')));
  const [webhookAcknowledged, setWebhookAcknowledged] = useState(false);
  const current = journey.steps[selected];
  const panelId = `oa-journey-${account.id}`;
  return <section aria-label="ขั้นตอนเตรียม LINE OA" className="space-y-3 rounded-xl border border-amber-200 bg-[#FFF8F0] p-3 text-slate-800 dark:border-amber-900 dark:bg-slate-900 dark:text-slate-200">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold">เตรียม LINE OA ให้พร้อมใช้งาน</h3>
      <span className="text-xs">มีหลักฐานแล้ว {journey.completed}/8 ขั้นตอน</span>
    </div>
    <ol className="grid grid-cols-2 gap-1 sm:grid-cols-4">
      {journey.steps.map((step, index) => <li key={step.id}>
        <button type="button" aria-current={selected === index ? 'step' : undefined} aria-controls={panelId}
          className={`flex w-full items-start gap-1 rounded-lg p-2 text-left text-xs ${selected === index ? 'bg-[#FDE8D0] text-[#B86A08]' : 'bg-white/60 dark:bg-slate-800'}`}
          onClick={() => setSelected(index)}>
          {step.status === 'COMPLETE' ? <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : <Circle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
          <span>{index + 1}. {step.title}<small className="mt-1 block">{labels[step.status]}</small></span>
        </button>
      </li>)}
    </ol>
    <div id={panelId} className="space-y-2 rounded-lg bg-white p-3 dark:bg-slate-950">
      <h4 className="text-sm font-semibold">{selected + 1}. {current.title}</h4>
      <p className="text-xs leading-relaxed">{current.detail}</p>
      {current.id === 'prepare' && <div className="flex flex-wrap gap-3 text-xs">
        <a className="underline" href="https://manager.line.biz/" target="_blank" rel="noreferrer">LINE Official Account Manager <ExternalLink className="inline h-3 w-3" /></a>
        <a className="underline" href="https://developers.line.biz/console/" target="_blank" rel="noreferrer">LINE Developers Console <ExternalLink className="inline h-3 w-3" /></a>
      </div>}
      {current.id === 'credentials' && <a className="inline-block text-xs underline" href="#line-oa-connect">ไปฟอร์มเชื่อม Channel / ยืนยันตัวตน</a>}
      {current.id === 'webhook' && <div className="space-y-2">
        <p className="break-all font-mono text-xs">/api/line-oa/accounts/{account.id}/webhook</p>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={webhookAcknowledged} onChange={event => setWebhookAcknowledged(event.target.checked)} />
          <span>รับทราบว่าการลงทะเบียนจะเปลี่ยน Webhook ของ OA นี้ และตรวจสอบระบบที่ใช้อยู่เดิมแล้ว</span></label>
        <button type="button" className={buttonClass} disabled={busy || !onAction || !webhookAcknowledged || account.status === 'ARCHIVED'}
          onClick={() => onAction(account, { action: 'REGISTER_WEBHOOK' })}>ลงทะเบียนและทดสอบกับ LINE</button>
        <p className="text-xs text-slate-500">หากไม่ผ่าน ให้เปิด LINE Developers ตรวจ endpoint และเปิด Use webhook แล้วลองอีกครั้ง ผลทดสอบนี้ยังไม่ยืนยันว่าโมเดลตอบทันเวลา</p>
      </div>}
      {current.id === 'model-key' && <div className="space-y-2">
        <a className="inline-block text-xs underline" href="#line-oa-model-key">ไปฟอร์มใส่ API key ของโมเดล</a>
        <p className="text-xs text-slate-500">ขั้นนี้ผ่านเมื่อมีคีย์ที่ตรวจกับผู้ให้บริการแล้วและยังไม่ถูกเพิกถอน การบันทึกคีย์อย่างเดียวยังไม่ยืนยันว่าโมเดลตอบทันเวลา ให้วัดจาก trace จริงในขั้นทดสอบ</p>
      </div>}
      {current.id === 'knowledge' && <div className="space-y-2">
        <button type="button" className={buttonClass} disabled={busy || !onAction || account.knowledgeGrounding === 'GKS_CORPUS' || account.status === 'ARCHIVED'}
          onClick={() => onAction(account, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING', knowledgeGrounding: 'GKS_CORPUS' })}>เลือกคลัง GKS ที่เผยแพร่แล้ว</button>
        <p className="text-xs text-slate-500">หากยังไม่มี corpus หรือ MSP runtime พร้อมใช้ ให้ตั้งค่าที่ Knowledge/Memory ก่อน ขั้นนี้ยังไม่แสดงว่าพร้อมเพียงเพราะบันทึกตัวเลือกแล้ว</p>
      </div>}
      {current.id === 'test' && <div className="space-y-2">
        <p className="text-xs">ส่งคำถามจากบัญชี LINE ของเจ้าของเอง เช่น ราคาสินค้าที่มีอยู่จริง แล้วลอง /projects และ /work การสร้างหรือแก้ไขงานต้องตรวจ preview และพิมพ์คำยืนยันจาก LINE</p>
        <button type="button" className={buttonClass} disabled={busy || !onLoadJobs} onClick={onLoadJobs}>ดูข้อความและ Trace เพื่อทดสอบ</button>
      </div>}
      {current.id === 'activate' && <div className="space-y-2">
        <p className="text-xs">ใช้ปุ่มเปิด Server Transport ในการ์ดบัญชีเมื่อพร้อมรับข้อความ ตรวจสถานะคิวและผลส่ง หากเกิดปัญหาให้ปิด transport ก่อนเปลี่ยนการตั้งค่า</p>
        {journey.live && <button type="button" className={buttonClass} disabled={busy || !onAction}
          onClick={() => onAction(account, { action: 'DISABLE_SERVER' })}>ปิด Server transport</button>}
      </div>}
    </div>
    <div className="flex justify-between gap-2">
      <button type="button" className={buttonClass} disabled={selected === 0} onClick={() => setSelected(index => index - 1)}><ArrowLeft aria-hidden="true" className="mr-1 inline h-3 w-3" />ย้อนกลับ</button>
      <button type="button" className={buttonClass} disabled={selected === 7} onClick={() => setSelected(index => index + 1)}>ขั้นตอนถัดไป<ArrowRight aria-hidden="true" className="ml-1 inline h-3 w-3" /></button>
    </div>
    <p className="text-xs text-slate-500">ความคืบหน้าอ่านจากบัญชีที่บันทึกไว้ กลับมาทำต่อได้ การกดขั้นตอนถัดไปไม่ทำเครื่องหมายว่าทดสอบผ่าน</p>
  </section>;
}
