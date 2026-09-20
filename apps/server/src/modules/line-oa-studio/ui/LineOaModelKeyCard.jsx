"use client";
import React, { useState } from 'react';

// @req FR-266 — the Business owner enters the model provider API key here, and the
//   value only ever travels outwards. Nothing in this component reads a key back:
//   the status it renders comes from `GET /api/integration/model-providers` and
//   carries a provider, a model id and a validation time, never material (SEC-030).
// @spec ADR-100 D4; ADR-089 D2; SDD-101
// @tested tests/unit/line-oa-model-key-card-render.test.js
//
// The input is cleared on every outcome, success or failure. A key left sitting in
// a form field survives in the DOM, in a screenshot and in a browser's own form
// restore — three places SEC-030 says it must not be.

const fieldClass = 'w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 text-xs focus:ring-2 focus:ring-brand-amber/30 focus:outline-none';
const buttonClass = 'rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';

const REFUSALS = {
  MODEL_KEY_REJECTED: 'ผู้ให้บริการปฏิเสธคีย์นี้ ตรวจว่าคัดลอกครบและยังไม่ถูกเพิกถอน',
  MODEL_PROVIDER_UNAVAILABLE: 'ติดต่อผู้ให้บริการไม่ได้ในขณะนี้ ยังไม่มีการบันทึกคีย์ ลองใหม่อีกครั้ง',
  MODEL_PROVIDER_UNSUPPORTED: 'ยังไม่รองรับผู้ให้บริการนี้',
  MFA_FACTOR_REQUIRED: 'ต้องเปิดใช้ยืนยันตัวตนสองขั้นก่อนจึงจะใส่คีย์ได้',
  ASSURANCE_LEVEL_INSUFFICIENT: 'ต้องยืนยันตัวตนสองขั้นอีกครั้งก่อนบันทึกคีย์',
  CREDENTIAL_RATE_LIMITED: 'ใส่คีย์บ่อยเกินไป รอสักครู่แล้วลองใหม่',
  CREDENTIAL_INPUT_INVALID: 'รูปแบบคีย์หรือชื่อโมเดลไม่ถูกต้อง',
  CREDENTIAL_REENTRY_REQUIRED: 'คีย์เดิมอ่านกลับมาไม่ได้แล้ว ต้องใส่คีย์ใหม่',
  CHANNEL_SECRET_STORE_UNAVAILABLE: 'ที่เก็บความลับยังไม่พร้อมใช้งาน ติดต่อผู้ดูแลระบบ',
};

function explain(message) {
  for (const [code, thai] of Object.entries(REFUSALS)) if (String(message).includes(code)) return thai;
  return message;
}

export default function LineOaModelKeyCard({ businessId, status, onSaved, api, busy = false }) {
  const credential = status?.modelCredential ?? null;
  const providers = status?.providers ?? [];
  const suggested = status?.suggestedModels ?? {};
  const [provider, setProvider] = useState(() => credential?.provider ?? providers[0] ?? 'anthropic');
  const [model, setModel] = useState(() => credential?.model ?? suggested[credential?.provider ?? providers[0]] ?? '');
  const [apiKey, setApiKey] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const ready = credential?.status === 'ACTIVE' && credential?.lastValidatedAt;

  function pickProvider(next) {
    setProvider(next);
    // Only overwrite a model the owner has not edited away from a suggestion:
    // switching provider with a stale model id is the most likely way to save a
    // combination that validates (the key is fine) and then fails on every answer.
    if (!model || Object.values(suggested).includes(model)) setModel(suggested[next] ?? '');
  }

  async function run(work, successNote) {
    setWorking(true);
    setError('');
    setNote('');
    try {
      await work();
      setApiKey('');
      setNote(successNote);
      if (onSaved) await onSaved();
    } catch (err) {
      setApiKey('');
      setError(explain(err.message));
    } finally {
      setWorking(false);
    }
  }

  const disabled = busy || working || !businessId;

  return <section aria-label="API key ของโมเดล" className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">API key ของโมเดล</h3>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ready ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'}`}>
        {ready ? 'พร้อมใช้งาน' : credential ? 'ต้องตรวจสอบใหม่' : 'ยังไม่ได้ใส่คีย์'}
      </span>
    </div>

    <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
      ทุกคำตอบที่ LINE OA ของธุรกิจนี้ส่งให้ลูกค้าจะเรียกโมเดลด้วยคีย์นี้ และค่าใช้จ่ายการเรียกโมเดลเป็นของธุรกิจเอง
      คีย์จะถูกตรวจกับผู้ให้บริการก่อนบันทึก เก็บแบบเขียนอย่างเดียว และจะไม่แสดงกลับมาในหน้านี้อีก
    </p>

    {credential && <dl className="grid grid-cols-2 gap-1 text-[11px] text-slate-600 dark:text-slate-400">
      <dt className="font-semibold">ผู้ให้บริการ</dt><dd>{credential.provider}</dd>
      <dt className="font-semibold">โมเดล</dt><dd className="font-mono">{credential.model ?? '—'}</dd>
      <dt className="font-semibold">สถานะ</dt><dd>{credential.status}</dd>
      <dt className="font-semibold">ตรวจล่าสุด</dt><dd>{credential.lastValidatedAt ?? 'ยังไม่เคยตรวจ'}</dd>
    </dl>}

    <div className="grid gap-2 sm:grid-cols-2">
      <div>
        <label htmlFor={`model-provider-${businessId}`} className="mb-1 block text-[11px] font-semibold text-slate-700 dark:text-slate-300">ผู้ให้บริการ</label>
        <select id={`model-provider-${businessId}`} className={fieldClass} value={provider} disabled={disabled}
          onChange={(event) => pickProvider(event.target.value)}>
          {providers.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`model-id-${businessId}`} className="mb-1 block text-[11px] font-semibold text-slate-700 dark:text-slate-300">ชื่อโมเดล</label>
        <input id={`model-id-${businessId}`} className={`${fieldClass} font-mono`} value={model} disabled={disabled}
          placeholder={suggested[provider] ?? ''} onChange={(event) => setModel(event.target.value)} />
        <p className="mt-1 text-[10px] text-slate-500">ค่าที่แนะนำคือ {suggested[provider] ?? '—'} แก้ได้ตามแผนที่ธุรกิจใช้จริง</p>
      </div>
    </div>

    <div>
      <label htmlFor={`model-key-${businessId}`} className="mb-1 block text-[11px] font-semibold text-slate-700 dark:text-slate-300">API key</label>
      <input id={`model-key-${businessId}`} type="password" autoComplete="off" spellCheck={false} className={`${fieldClass} font-mono`}
        value={apiKey} disabled={disabled} placeholder="วางคีย์จากหน้าเว็บของผู้ให้บริการ"
        onChange={(event) => setApiKey(event.target.value)} />
    </div>

    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass} disabled={disabled || !apiKey || !model}
        onClick={() => run(() => api('/api/integration/model-providers', 'POST', { businessId, provider, model, apiKey }),
          credential ? 'บันทึกคีย์ใหม่แล้ว' : 'บันทึกคีย์แล้ว')}>
        {credential ? 'เปลี่ยนคีย์' : 'บันทึกคีย์'}
      </button>
      {credential && <button type="button" className={buttonClass} disabled={disabled}
        onClick={() => run(() => api(`/api/integration/model-providers/${encodeURIComponent(credential.connectionId)}/validate`, 'POST', {}),
          'ตรวจสอบกับผู้ให้บริการแล้ว')}>
        ตรวจสอบคีย์ปัจจุบัน
      </button>}
      {credential && <button type="button"
        className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800 dark:text-rose-400"
        disabled={disabled}
        onClick={() => {
          // The confirmation is typed by this button, not by the person, because
          // the route requires the literal and the person has already chosen a
          // destructive, clearly labelled action. What they are not asked to guess
          // is the consequence, which the text below states.
          if (!window.confirm('เพิกถอนคีย์นี้จะทำให้ LINE OA ตอบลูกค้าไม่ได้จนกว่าจะใส่คีย์ใหม่ ยืนยันหรือไม่')) return;
          run(() => api(`/api/integration/model-providers/${encodeURIComponent(credential.connectionId)}/revoke`, 'POST',
            { reason: 'OWNER_REVOKED_FROM_STUDIO', confirmation: 'REVOKE' }), 'เพิกถอนคีย์แล้ว');
        }}>
        เพิกถอนคีย์
      </button>}
    </div>

    {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
    {note && <p className="text-xs text-emerald-600">{note}</p>}
  </section>;
}
