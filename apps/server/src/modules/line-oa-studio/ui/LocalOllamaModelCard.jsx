"use client";

import React, { useEffect, useState } from 'react';

// @req FR-079, FR-080 — the owner chooses an installed Ollama model only for
//   the exact server-approved main-dev TEST ONLY Business/LINE OA pair.
// @spec ADR-100 D5, D9; SEC-001, SEC-030 — no client-selected endpoint or key.
// @tested tests/unit/local-ollama-model-card-render.test.js

const cardClass = 'space-y-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3 text-[var(--text-primary)]';
const fieldClass = 'w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-2.5 text-xs text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--action-primary-active)] focus:outline-none';
const buttonClass = 'rounded-xl bg-[var(--button-primary-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--button-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50';

const REFUSALS = {
  BUSINESS_MODEL_PROVIDER_KEY_PRESENT: 'ธุรกิจนี้มี API key ของผู้ให้บริการอยู่แล้ว จึงยังเลือก Ollama ในเครื่องไม่ได้',
  OLLAMA_MODEL_NOT_INSTALLED: 'ไม่พบโมเดลนี้ในรายการที่ติดตั้งแล้ว โปรดโหลดรายการใหม่แล้วเลือกอีกครั้ง',
  LOCAL_OLLAMA_PROVIDER_MISCONFIGURED: 'ตัวเลือก Ollama ในเครื่องยังตั้งค่าไม่ตรงกับโปรไฟล์ทดสอบ โปรดติดต่อผู้ดูแลระบบ',
  LOCAL_OLLAMA_SELECTION_CONFLICT: 'มีการเปลี่ยนโมเดลพร้อมกัน โปรดโหลดหน้าใหม่แล้วลองอีกครั้ง',
  LOCAL_OLLAMA_PROVIDER_CREATE_CONFLICT: 'มีการตั้งค่า Ollama พร้อมกัน โปรดโหลดหน้าใหม่แล้วลองอีกครั้ง',
};

function explain(message) {
  for (const [code, thai] of Object.entries(REFUSALS)) {
    if (String(message).includes(code)) return thai;
  }
  return 'บันทึกโมเดลไม่สำเร็จ โปรดลองอีกครั้ง';
}

/** Client visibility is presentation only; the service repeats every guard. */
export function findEligibleLocalOllamaAccount({ business, accounts = [], status } = {}) {
  if (!business?.id || status?.businessId !== business.id || !status.accountId) return null;
  return accounts.find((account) => (
    account.id === status.accountId
    && account.businessId === business.id
    && account.status === 'CONNECTED'
    && account.serverEnabled === true
    && account.executionMode === 'SERVER'
    && account.runtimeOwner === 'SERVER'
    && account.knowledgeGrounding === (status.knowledgeSource === 'GENESISRAG17_TEST_ONLY' ? 'GKS_CORPUS' : 'BUSINESS_KNOWLEDGE')
    && account.knowledgeGroundingShadow === false
    && (account.memoryPolicy ?? 'OFF') === 'OFF'
    && account.memoryProjectId == null
  )) ?? null;
}

export default function LocalOllamaModelCard({ account, status, onSaved, api, busy = false }) {
  if (!account || !status || !Array.isArray(status.models)) return null;
  return <LocalOllamaModelForm key={`${status.businessId}:${status.accountId}`} account={account} status={status} onSaved={onSaved} api={api} busy={busy} />;
}

function LocalOllamaModelForm({ account, status, onSaved, api, busy }) {
  const [modelId, setModelId] = useState(status.selectedModelId ?? '');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    setModelId(status.selectedModelId ?? '');
  }, [status.selectedModelId]);

  async function save() {
    setWorking(true);
    setError('');
    setNote('');
    try {
      await api('/api/integration/local-ollama/selection', 'POST', { modelId });
      setNote(`บันทึก ${modelId} สำหรับการทดสอบแล้ว`);
      if (onSaved) await onSaved();
    } catch (err) {
      setError(explain(err.message));
    } finally {
      setWorking(false);
    }
  }

  const installed = status.models.includes(modelId);
  const selectedModelIsMissing = Boolean(status.selectedModelId) && !status.models.includes(status.selectedModelId);
  const disabled = busy || working || !installed || modelId === status.selectedModelId;

  return <section aria-label="Ollama ในเครื่องสำหรับทดสอบ" className={cardClass}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-[var(--text-primary)]">Ollama ในเครื่อง</h3>
      <span className="rounded-full border border-[var(--status-warning)] bg-[var(--status-warning-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-primary)]">TEST ONLY · main-dev</span>
    </div>

    <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
      เลือกได้เฉพาะโมเดลที่ติดตั้งบนเซิร์ฟเวอร์ ตัวเลือกนี้ใช้กับสินค้าทดสอบและข้อมูลตัวอย่างใน main-dev เท่านั้น
      ไม่ใช้ข้อมูลราคาหรือสต็อกจริงของธุรกิจ และไม่ใช้ API key แบบคิดค่าบริการ ห้ามใช้กับข้อมูลจริงหรือการสนทนาของลูกค้าจริง
    </p>
    {status.knowledgeSource === 'GENESISRAG17_TEST_ONLY' && <p className="text-[11px] text-[var(--text-secondary)]">
      แหล่งข้อมูล: GenesisRAG17 เฉพาะสินค้าทดสอบที่อนุญาต กรองข้อมูลก่อนส่งให้โมเดล
    </p>}
    <p className="rounded-lg border border-[var(--status-info)] bg-[var(--status-info-bg)] px-2 py-1.5 text-[11px] text-[var(--text-primary)]">
      การเลือกโมเดลนี้ไม่เปลี่ยนเกณฑ์ readiness สำหรับ production และไม่เปิดการใช้งาน production
    </p>
    <p className="rounded-lg bg-[var(--bg-subtle)] px-2 py-1.5 text-[11px] text-[var(--text-primary)]">
      บัญชี LINE OA: <strong>{account.displayName ?? status.accountName}</strong>
    </p>

    {status.models.length === 0
      ? <p role="status" className="text-[11px] text-[var(--text-secondary)]">ยังไม่พบโมเดลที่ติดตั้งบนเซิร์ฟเวอร์</p>
      : <label className="block space-y-1 text-[11px] font-semibold text-[var(--text-primary)]">
          โมเดลที่ติดตั้ง
          <select className={fieldClass} value={modelId} onChange={(event) => { setModelId(event.target.value); setError(''); setNote(''); }}>
            <option value="" disabled>เลือกโมเดล</option>
            {selectedModelIsMissing && <option value={status.selectedModelId}>{status.selectedModelId} (ไม่ได้ติดตั้งแล้ว)</option>}
            {status.models.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        </label>}

    {selectedModelIsMissing && <p className="text-[11px] text-[var(--text-secondary)]">โมเดลที่บันทึกไว้ไม่ได้ติดตั้งแล้ว โปรดเลือกโมเดลอื่นเพื่อเปลี่ยน</p>}
    {error && <p role="alert" className="rounded-lg border border-[var(--status-danger)] bg-[var(--status-danger-bg)] px-2 py-1.5 text-[11px] text-[var(--text-primary)]">{error}</p>}
    {note && <p role="status" className="rounded-lg border border-[var(--status-success)] bg-[var(--status-success-bg)] px-2 py-1.5 text-[11px] text-[var(--text-primary)]">{note}</p>}

    <button className={buttonClass} type="button" disabled={disabled} onClick={save}>
      {working ? 'กำลังบันทึก…' : 'ใช้โมเดลนี้สำหรับการทดสอบ'}
    </button>
  </section>;
}
