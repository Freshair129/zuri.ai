// @req FR-146, FR-149, FR-151, FR-152, FR-153 — LINE OA account and runtime console
// @req FR-225 — the connect form below is the Thai self-serve wizard
//   (`LineOaConnectWizard`); it no longer asks for a `deployment-secret:`
//   reference (that field is FR-149's operator-only path, still reachable from
//   the API but not from this page). `AccountCard`'s "ย้ายข้อมูลรับรองเข้า
//   Vault" affordance is the mount-to-vault migration for an account connected
//   before this wizard existed. `refresh` is guarded against an out-of-order
//   response (found chasing an e2e flake on this exact save-then-reload path:
//   an older in-flight GET landing after a newer one could silently repaint
//   the account list with stale data) the same way `LineStudioShell.jsx`
//   already guards its own account fetch.
// @req FR-235 — the publisher's knowledgeGrounding control (ADR-090 D1):
//   BUSINESS_KNOWLEDGE (default) | GKS_CORPUS | GKS_THEN_BUSINESS_KNOWLEDGE,
//   applied through the existing versioned CONFIGURE_KNOWLEDGE_GROUNDING
//   account action, audited the same way as every other account write.
// @req FR-243 — the account's conversation session idle timeout (10 to 120 minutes)
//   through the versioned CONFIGURE_SESSION_TIMEOUT action, and the delivery job list
//   filtered by session code with each job's trace events (ADR-094 D3, D4).
// @spec ADR-041, ADR-043, ADR-061, ADR-089 D2, D7, §4.9; SEC-001, SDD-060, ADR-090 D1, ADR-094
// @tested tests/unit/conversation-session-ui.test.js,
//   tests/unit/line-oa-connect-wizard-render.test.js,
//   tests/e2e/fr149-line-server-console.spec.js,
//   tests/e2e/fr225-line-oa-self-serve-wizard.spec.js,
//   tests/unit/line-studio-account-console-render.test.js
"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Server,
  ShieldCheck,
  Radio,
  RefreshCw,
  Sliders,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Zap,
  HelpCircle,
  ArrowRight
} from "lucide-react";
import { Card, SectionTitle, StatusPill } from "@/components/ui";
import { useScope } from "@/context/ScopeContext";
import LineOaConnectWizard from "./LineOaConnectWizard";
import LineOaCredentialMigrationCard from "./LineOaCredentialMigrationCard";
import { lineTraceSummary } from "../domain/line-trace-summary";
import LineOaReadinessJourney from "./LineOaReadinessJourney";
import LineOaModelKeyCard from "./LineOaModelKeyCard";

async function api(url, method = "GET", body) {
  const response = await fetch(url, {
    method,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.issues?.join(" · ") || result.error || "Request failed");
  return result;
}

const fieldClass = "w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 text-xs focus:ring-2 focus:ring-brand-amber/30 focus:outline-none";

export default function LineStudioAccountConsole() {
  const scope = useScope();
  const business = scope?.shell?.activeBusiness;

  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // @req FR-266 — the Business's model provider key status (ADR-100 D4). Status
  // only: provider, model id and validation time, never material.
  const [modelStatus, setModelStatus] = useState(null);

  const loadModelStatus = useCallback(async () => {
    if (!business?.id) {
      setModelStatus(null);
      return;
    }
    try {
      setModelStatus(await api(`/api/integration/model-providers?businessId=${encodeURIComponent(business.id)}`));
    } catch {
      // A model-status read that fails must not blank the account console: the
      // card renders its own "not entered" state, which is also the truthful
      // answer when we could not find out.
      setModelStatus(null);
    }
  }, [business?.id]);

  // `refresh` runs both on mount and after every account action; the mount
  // call and an action's call can be in flight together (e.g. React 18's dev
  // double-invoke, or a slow first call overlapping a fast one right after a
  // save), and whichever response lands last used to win regardless of which
  // request was actually newest — an older read could silently overwrite a
  // just-saved value on screen. `refreshRequestId` is the same stale-response
  // guard `LineStudioShell.jsx` already uses for its own account list.
  const refreshRequestId = useRef(0);
  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestId.current;
    if (!business?.id) {
      if (requestId === refreshRequestId.current) setAccounts([]);
      return;
    }
    try {
      const result = await api(`/api/line-oa/accounts?businessId=${encodeURIComponent(business.id)}`);
      if (requestId !== refreshRequestId.current) return;
      setAccounts(result.accounts || []);
    } catch (err) {
      if (requestId === refreshRequestId.current) setError(err.message);
    }
  }, [business?.id]);

  useEffect(() => {
    setAccounts([]);
    setMessage("");
    setError("");
    refresh().catch((err) => setError(err.message));
    // @req FR-266 — the model key status is swallowed rather than surfaced as a
    // page error: `loadModelStatus` already leaves `modelStatus` null on failure,
    // and the card reads that as "no key yet", which is the honest rendering.
    loadModelStatus();
  }, [refresh, loadModelStatus]);

  async function run(task) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function action(account, data) {
    await run(() => api(`/api/line-oa/accounts/${account.id}`, "PATCH", { ...data, version: account.version }));
  }

  // FR-225: the wizard below (`LineOaConnectWizard`) creates the connection and
  // the DRAFT account itself; this page refreshes the list after the wizard.
  async function handleWizardConnected(account) {
    setMessage(`เชื่อมต่อบัญชี ${account?.displayName ?? ""} แล้ว — ตรวจสอบสถานะบัญชีและการตั้งค่าการตอบข้อความ`);
    await refresh();
  }

  return (
    <div className="space-y-6 font-thai">
      {/* Server-owned LINE execution */}
      <div className="rounded-2xl p-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-md relative overflow-hidden border border-slate-800">
        <div className="absolute right-0 top-0 w-96 h-96 bg-brand-amber/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/30 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                SERVER-OWNED LINE RUNTIME
              </span>
              <span className="text-xs text-slate-400">Zero Secret Exposure Architecture</span>
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              LINE OA และ Conversation Runtime
            </h2>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Zuri รับ LINE webhook และประมวลผลบทสนทนาผ่าน runtime ของเซิร์ฟเวอร์ ใช้ model provider key ของ Business ที่ตั้งค่าไว้ด้านล่าง
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => run(async () => { await refresh(); await loadModelStatus(); })}
              disabled={busy || !business}
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5 transition-all border border-white/10"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
              <span>รีเฟรชสถานะ</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {message && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        <div className="space-y-6">
          {/* Active LINE Accounts List */}
          <div className="rounded-2xl p-6 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h1 className="font-bold text-sm text-slate-900 dark:text-white">
                  บัญชี LINE และการตอบข้อความ
                </h1>
                <p className="text-xs text-slate-500">
                  {business ? `Business: ${business.name}` : "กรุณาเลือก Business ก่อนจัดการ"}
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold font-mono">
                {accounts.length} บัญชี
              </span>
            </div>

            {accounts.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-slate-50 dark:bg-slate-850 border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                ยังไม่มีบัญชี LINE OA ที่ผูกกับ Business นี้ — ใช้ฟอร์มด้านล่างเพื่อสร้างการเชื่อมต่อ
              </div>
            ) : (
              <div className="space-y-4">
                {accounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    modelCredential={modelStatus?.modelCredential ?? null}
                    onAction={action}
                    onRefresh={refresh}
                    busy={busy}
                  />
                ))}
              </div>
            )}
          </div>

          {/* FR-266: the model provider API key every server answer calls a
              model with (ADR-100 D4). One per Business, so it sits beside the
              account list rather than inside each account card. */}
          <div id="line-oa-model-key">
            <LineOaModelKeyCard businessId={business?.id} status={modelStatus} api={api}
              busy={busy} onSaved={loadModelStatus} />
          </div>

          {/* FR-225: the Thai self-serve connect wizard replaces the old
              deployment-secret-only form. */}
          <div id="line-oa-connect"><LineOaConnectWizard businessId={business?.id} onConnected={handleWizardConnected} /></div>
        </div>
      </div>
    </div>
  );
}

function AccountCard({ account, modelCredential, onAction, onRefresh, busy }) {
  const [push, setPush] = useState(account.allowDelayedPush);
  const [runtimeOwner, setRuntimeOwner] = useState(account.runtimeOwner ?? "SERVER");
  const [grounding, setGrounding] = useState(account.knowledgeGrounding);
  const [sessionTimeout, setSessionTimeout] = useState(String(account.sessionIdleTimeoutMinutes ?? 30));
  const [quiesced, setQuiesced] = useState(false);
  const [jobs, setJobs] = useState(null);
  const [sessionFilter, setSessionFilter] = useState("");
  const [filteredSession, setFilteredSession] = useState(null);
  const [traces, setTraces] = useState({});
  const [acknowledged, setAcknowledged] = useState({});
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPush(account.allowDelayedPush);
    setRuntimeOwner(account.runtimeOwner ?? "SERVER");
    setGrounding(account.knowledgeGrounding);
    setSessionTimeout(String(account.sessionIdleTimeoutMinutes ?? 30));
  }, [account]);

  const timeoutMinutes = Number(sessionTimeout);
  const timeoutValid = Number.isInteger(timeoutMinutes) && timeoutMinutes >= 10 && timeoutMinutes <= 120;

  async function loadJobs(code = "") {
    try {
      setError("");
      setTraces({});
      const query = code ? `?session=${encodeURIComponent(code.trim().toUpperCase())}` : "";
      const result = await api(`/api/line-oa/accounts/${account.id}/jobs${query}`);
      setJobs(result.jobs ?? result);
      setFilteredSession(code ? result.session ?? { code: code.trim().toUpperCase(), missing: true } : null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleTrace(job) {
    if (traces[job.id]) {
      setTraces((current) => { const next = { ...current }; delete next[job.id]; return next; });
      return;
    }
    try {
      setError("");
      const result = await api(`/api/line-oa/jobs/${job.id}/trace`);
      setTraces((current) => ({ ...current, [job.id]: result.events ?? [] }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function acknowledgeUnknown(job) {
    if (!acknowledged[job.id] || resolving) return;
    setResolving(true);
    try {
      setError("");
      await api(`/api/line-oa/jobs/${job.id}/acknowledge-unknown`, "POST", {
        version: job.version,
        acknowledgePossibleDelivery: true
      });
      await loadJobs();
    } catch (err) {
      setError(err.message);
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <span>{account.displayName}</span>
            <span className="text-xs text-slate-500 font-mono">({account.basicId || account.code})</span>
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            LINE Transport: <strong className="text-slate-800 dark:text-slate-200">{account.serverEnabled ? "Zuri Server" : "Server ยังไม่เปิด"}</strong> · Connection: <span className="text-emerald-600">{account.health?.connection?.status || "UNKNOWN"}</span>
          </p>
        </div>
        <StatusPill status={account.effectiveStatus} />
      </div>

      <details className="text-[11px] text-slate-500 bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200/60 dark:border-slate-800">
        <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-300">ข้อมูล Endpoint สำหรับ Webhook</summary>
        <div className="mt-2 grid gap-1 font-mono text-[10px] break-all">
          <p>Account ID: {account.id}</p>
          <p>Webhook URL: /api/line-oa/accounts/{account.id}/webhook</p>
          <p>Tenant ID: {account.tenantId}</p>
        </div>
      </details>

      {/* FR-225: credential status is metadata only (no material) — and the
          mount-to-vault migration card only for a DEPLOYMENT_MOUNT-backed
          connection (design §4.9 step 4). */}
      <LineOaCredentialMigrationCard account={account} onMigrated={onRefresh} />
      <LineOaReadinessJourney key={account.id} account={account} modelCredential={modelCredential}
        onAction={onAction} onLoadJobs={() => loadJobs()} busy={busy} />

      <fieldset disabled={busy || account.status === "ARCHIVED"} className="grid gap-3 pt-1">
        {/* FR-265 — executionMode remains SERVER. This separate Core-owned cohort
            sends only eligible direct conversations to the independent runtime. */}
        <div>
          <label htmlFor={`runtime-owner-${account.id}`} className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
            ตัวประมวลผลบทสนทนา
          </label>
          <select
            id={`runtime-owner-${account.id}`}
            aria-label="ตัวประมวลผลบทสนทนา"
            className={fieldClass}
            value={runtimeOwner}
            onChange={(e) => setRuntimeOwner(e.target.value)}
          >
            <option value="SERVER">Zuri Server (ค่าเริ่มต้น)</option>
            <option value="CONVERSATION_RUNTIME">Conversation Runtime</option>
          </select>
          <p className="text-[10px] text-slate-500 mt-1">
            เลือก cohort ที่ Core บันทึกลงในแต่ละงาน การเปลี่ยนต้องไม่มีงานค้างหรือกำลังทำงานอยู่
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            checked={push}
            onChange={(e) => setPush(e.target.checked)}
            className="rounded border-slate-300 text-brand-amber focus:ring-brand-amber"
          />
          <span>อนุญาต Push คำตอบภายหลัง หาก reply token หมดอายุ</span>
        </label>

        <div>
          <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
            แหล่งความรู้สำหรับตอบคำถาม
          </label>
          <select
            aria-label="แหล่งความรู้สำหรับตอบคำถาม"
            className={fieldClass}
            value={grounding}
            onChange={(e) => setGrounding(e.target.value)}
          >
            <option value="BUSINESS_KNOWLEDGE">ฐานความรู้ธุรกิจ (ค่าเริ่มต้น)</option>
            <option value="GKS_CORPUS">คลังความรู้ GKS ที่เผยแพร่แล้วเท่านั้น</option>
            <option value="GKS_THEN_BUSINESS_KNOWLEDGE">คลังความรู้ GKS ก่อน แล้วสำรองด้วยฐานความรู้ธุรกิจ</option>
          </select>
          <p className="text-[10px] text-slate-500 mt-1">
            เปลี่ยนแหล่งข้อมูลที่ Zuri ใช้ตอบคำถามลูกค้าทาง LINE — ไม่กระทบบัญชีอื่น
          </p>
        </div>

        <div>
          <label htmlFor={`session-timeout-${account.id}`} className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
            เวลาเงียบก่อนเริ่ม session ใหม่ (นาที)
          </label>
          <input
            id={`session-timeout-${account.id}`}
            type="number"
            min={10}
            max={120}
            step={1}
            inputMode="numeric"
            className={fieldClass}
            value={sessionTimeout}
            onChange={(e) => setSessionTimeout(e.target.value)}
            aria-invalid={!timeoutValid}
          />
          <p className={`text-[10px] mt-1 ${timeoutValid ? "text-slate-500" : "text-rose-600"}`}>
            {timeoutValid
              ? "ถ้าลูกค้าเงียบนานกว่านี้ ข้อความถัดไปจะเริ่ม session ใหม่ ค่าเริ่มต้น 30 นาที"
              : "ใส่ตัวเลขเต็มระหว่าง 10 ถึง 120 นาที"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
            disabled={push === account.allowDelayedPush && runtimeOwner === (account.runtimeOwner ?? "SERVER")}
            onClick={() => onAction(account, { action: "CONFIGURE_EXECUTION", allowDelayedPush: push, runtimeOwner })}
          >
            บันทึกนโยบายและ cohort
          </button>

          <button
            type="button"
            disabled={grounding === account.knowledgeGrounding}
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => onAction(account, { action: "CONFIGURE_KNOWLEDGE_GROUNDING", knowledgeGrounding: grounding })}
          >
            บันทึกแหล่งความรู้
          </button>

          <button
            type="button"
            disabled={!timeoutValid || timeoutMinutes === (account.sessionIdleTimeoutMinutes ?? 30)}
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => onAction(account, { action: "CONFIGURE_SESSION_TIMEOUT", sessionIdleTimeoutMinutes: timeoutMinutes })}
          >
            บันทึกเวลา session
          </button>

          {account.serverEnabled ? (
            <button
              type="button"
              className="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs font-semibold hover:bg-rose-50"
              onClick={() => onAction(account, { action: "DISABLE_SERVER" })}
            >
              ปิด Server transport
            </button>
          ) : account.transportMode === "CLOUD" ? (
            <div className="grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={quiesced} onChange={(event) => setQuiesced(event.target.checked)} className="mt-0.5" />
                <span>ยืนยันว่า transport เดิมหยุดรับ webhook แล้ว และยอมรับให้ Zuri Server เป็นเจ้าของการส่ง</span>
              </label>
              <button
                type="button"
                disabled={!quiesced}
                className="w-fit rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm shadow-emerald-600/20 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => onAction(account, { action: "ENABLE_SERVER", legacyQuiesced: true })}
              >
                ⚡ เปิด Server Transport (Live)
              </button>
            </div>
          ) : (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              บัญชีนี้ต้องตรวจสอบการตั้งค่าก่อนเปิด Server transport กรุณาติดต่อผู้ดูแลระบบ
            </p>
          )}

          <button
            type="button"
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-white"
            onClick={() => loadJobs()}
          >
            ดูสถานะข้อความ
          </button>
        </div>
      </fieldset>

      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}

      {jobs && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <h5 className="font-bold text-xs text-slate-800 dark:text-slate-200 mb-2">คิวข้อความล่าสุด (Delivery Jobs)</h5>
          <form
            className="mb-2 flex flex-wrap items-center gap-2"
            onSubmit={(event) => { event.preventDefault(); loadJobs(sessionFilter); }}
          >
            <label htmlFor={`session-filter-${account.id}`} className="text-[11px] text-slate-600 dark:text-slate-400">กรองตาม session</label>
            <input
              id={`session-filter-${account.id}`}
              className="w-48 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 font-mono text-[11px]"
              placeholder="S-20260916-XXXXXX"
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
            />
            <button type="submit" className="rounded-xl bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white">กรอง</button>
            {filteredSession && (
              <button type="button" className="text-[11px] text-slate-500 underline" onClick={() => { setSessionFilter(""); loadJobs(); }}>ล้างตัวกรอง</button>
            )}
          </form>
          {filteredSession && (
            <p className="mb-2 text-[11px] text-slate-600 dark:text-slate-400" data-session-filter={filteredSession.code}>
              {filteredSession.missing
                ? `ไม่พบ session ${filteredSession.code} ในบัญชีนี้`
                : `session ${filteredSession.code} · ข้อความเข้า ${filteredSession.inboundCount} · ตอบกลับ ${filteredSession.outboundCount}`}
            </p>
          )}
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500">
                <th className="p-1.5">เวลา</th>
                <th className="p-1.5">งาน</th>
                <th className="p-1.5">Session</th>
                <th className="p-1.5">สถานะ</th>
                <th className="p-1.5">รายละเอียด</th>
                <th className="p-1.5">Trace</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(jobs) && jobs.map((job) => (
                <React.Fragment key={job.id}>
                  <tr className="border-b border-slate-100 dark:border-slate-800 font-mono text-[11px]">
                    <td className="p-1.5">{new Date(job.createdAt).toLocaleTimeString()}</td>
                    <td className="p-1.5">{job.id.slice(0, 8)}</td>
                    <td className="p-1.5">{job.sessionCode || "—"}</td>
                    <td className="p-1.5 font-bold">{job.status}</td>
                    <td className="p-1.5">{job.errorCode || job.executionMode}</td>
                    <td className="p-1.5">
                      <button type="button" className="text-[11px] text-slate-700 underline dark:text-slate-300" onClick={() => toggleTrace(job)}>
                        {traces[job.id] ? "ซ่อน" : "ดู trace"}
                      </button>
                    </td>
                  </tr>
                  {traces[job.id] && (
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <td colSpan={6} className="p-1.5">
                        <ol className="grid gap-0.5 font-mono text-[10px] text-slate-600 dark:text-slate-400" aria-label={`trace ของงาน ${job.id.slice(0, 8)}`}>
                          {traces[job.id].length === 0 && <li>ยังไม่มี trace event</li>}
                          {traces[job.id].map((event, index) => (
                            <li key={event.id ?? `${job.id}-${index}`}>
                              {new Date(event.occurredAt).toLocaleTimeString()} · {event.kind}
                              {lineTraceSummary(event) && <span className="block break-all">{lineTraceSummary(event)}</span>}
                            </li>
                          ))}
                        </ol>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {Array.isArray(jobs) && jobs.length === 0 && (
            <p className="p-2 text-center text-slate-400 text-xs">{filteredSession ? "ไม่มีงานใน session นี้" : "ยังไม่มีข้อความในคิว"}</p>
          )}
        </div>
      )}
    </div>
  );
}
