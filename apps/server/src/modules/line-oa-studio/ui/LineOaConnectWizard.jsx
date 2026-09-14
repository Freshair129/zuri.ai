// @req FR-225 — the Thai self-serve LINE OA connection wizard: step-up (with
//   inline TOTP enrolment when the Person has no factor), Channel ID / Channel
//   secret / optional access-token override, live validation with LINE, and the
//   success card that confirms the DRAFT LineOaAccount. Every documented error
//   code (design §5.4) maps through the pure `describeLineOaConnectError`.
// @req FR-226, FR-223, FR-224 — this is the browser side of those; the server
//   contracts are unchanged by this file.
// @spec ADR-089 D2, D4, D7; design §5.1-§5.4
// @tested tests/unit/line-oa-connect-wizard-render.test.js,
//   tests/e2e/fr225-line-oa-self-serve-wizard.spec.js
"use client";

import React, { useState } from "react";
import { Loader2, ShieldAlert, Sparkles, KeyRound, CheckCircle2 } from "lucide-react";
import { describeLineOaConnectError } from "@/modules/line-oa-studio/domain/line-oa-connect-wizard-copy";
import { suggestLineOaAccountCode } from "@/modules/line-oa-studio/domain/line-oa-account";

const fieldClass = "w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 text-xs focus:ring-2 focus:ring-brand-amber/30 focus:outline-none";
const CHANNEL_ID_PATTERN = "[0-9]{6,20}";
const CHANNEL_SECRET_PATTERN = "[0-9a-f]{32}";

async function api(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json };
}

/**
 * Self-serve LINE OA connection wizard (FR-225).
 *
 * `phase` drives the steps of design §5.1-§5.2, kept client-only — nothing here
 * is a new persisted state, exactly as the design's overlay-states note says:
 *
 *   form            — Channel ID / secret / optional token
 *   mfaEnroll       — inline TOTP enrolment (only reached from MFA_FACTOR_REQUIRED)
 *   stepUp          — TOTP challenge (only reached from ASSURANCE_LEVEL_INSUFFICIENT)
 *   accountConfirm  — success card: bot identity, masked Channel ID, editable
 *                     auto-generated account code — the second, separate call
 *                     that creates the DRAFT LineOaAccount
 *   done            — account created; parent is notified via onConnected
 */
export default function LineOaConnectWizard({ businessId, onConnected }) {
  const [phase, setPhase] = useState("form");
  const [name, setName] = useState("");
  const [channelId, setChannelId] = useState("");
  const [channelSecret, setChannelSecret] = useState("");
  const [channelAccessToken, setChannelAccessToken] = useState("");
  const [showTokenField, setShowTokenField] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // { message, nextStep, retryAfterSeconds }
  const [notice, setNotice] = useState(""); // green banner (e.g. after step-up)

  const [connected, setConnected] = useState(null); // { connection, credential, bot }
  const [accountCode, setAccountCode] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState("");

  const [enroll, setEnroll] = useState(null); // { factorId, secret, uri, qrDataUrl }
  const [enrollCode, setEnrollCode] = useState("");
  const [stepUpCode, setStepUpCode] = useState("");

  function clearSecretFields() {
    // FR-225 exit criterion: no secret remains in page state after submit.
    setChannelSecret("");
    setChannelAccessToken("");
  }

  async function startMfaEnrolment() {
    setError(null);
    setBusy(true);
    try {
      const { ok, json } = await api("/api/auth/mfa/totp/enroll", "POST", {});
      if (!ok) throw new Error(json.error || "ไม่สามารถเริ่มการตั้งค่าได้");
      let qrDataUrl = null;
      try {
        const QRCode = (await import("qrcode")).default;
        qrDataUrl = await QRCode.toDataURL(json.uri, { errorCorrectionLevel: "M", margin: 2, width: 200 });
      } catch {
        qrDataUrl = null; // the secret text below still lets the owner enrol manually
      }
      setEnroll({ factorId: json.factorId, secret: json.secret, uri: json.uri, qrDataUrl });
      setPhase("mfaEnroll");
    } catch (err) {
      setError({ message: err.message, nextStep: "RETRY", retryable: true });
    } finally {
      setBusy(false);
    }
  }

  async function submitEnrolment(event) {
    event.preventDefault();
    if (!enroll || accountBusy || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { ok, json } = await api("/api/auth/mfa/totp/verify", "POST", { factorId: enroll.factorId, code: enrollCode.trim() });
      if (!ok) throw new Error(json.error || "รหัสยืนยันไม่ถูกต้อง");
      setEnroll(null);
      setEnrollCode("");
      setNotice('ยืนยันตัวตนสำเร็จ — กด "ตรวจสอบกับ LINE และบันทึก" อีกครั้งเพื่อดำเนินการต่อ');
      setPhase("form");
    } catch (err) {
      setError({ message: err.message, nextStep: "RETRY", retryable: true });
    } finally {
      setBusy(false);
    }
  }

  async function submitStepUp(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { ok, json } = await api("/api/auth/step-up", "POST", { code: stepUpCode.trim() });
      if (!ok) throw new Error(json.error || "รหัสไม่ถูกต้อง");
      setStepUpCode("");
      setNotice('ยืนยันตัวตนสำเร็จ — กด "ตรวจสอบกับ LINE และบันทึก" อีกครั้งเพื่อดำเนินการต่อ');
      setPhase("form");
    } catch (err) {
      setError({ message: err.message, nextStep: "RETRY", retryable: true });
    } finally {
      setBusy(false);
    }
  }

  async function submitConnect(event) {
    event.preventDefault();
    if (!businessId || busy) return;
    setError(null);
    setNotice("");
    const body = {
      businessId,
      name: name.trim(),
      channelId: channelId.trim(),
      channelSecret: channelSecret.trim(),
      ...(showTokenField && channelAccessToken.trim() ? { channelAccessToken: channelAccessToken.trim() } : {}),
    };
    // Cleared immediately after the request body is built — never held past
    // the fetch that carries it (FR-225 exit criterion).
    clearSecretFields();
    setBusy(true);
    try {
      const { ok, status, json } = await api("/api/line-oa/connections", "POST", body);
      if (!ok) {
        if (json.error === "MFA_FACTOR_REQUIRED") {
          await startMfaEnrolment();
          return;
        }
        if (json.error === "ASSURANCE_LEVEL_INSUFFICIENT") {
          setPhase("stepUp");
          return;
        }
        // FR-225 resume path: the connect call and the account-create call are
        // not atomic. If a previous attempt got this far — the bot claimed, the
        // credential stored — but the account was never created (a dropped
        // network, a closed tab), retrying the same Channel ID/secret answers
        // this same 409 for this same Business. `accountId: null` on the
        // server's own sibling is the dead end this closes: finish the account
        // step right here instead of sending the owner to an operator.
        const sibling = json.details?.[0];
        if (json.error === "LINE_CHANNEL_ALREADY_CONNECTED" && sibling?.businessId === businessId && sibling?.connectionId && !sibling?.accountId) {
          setNotice("พบการเชื่อมต่อที่ทำไว้ก่อนหน้าแต่ยังไม่ได้สร้างบัญชี — ดำเนินการต่อจากขั้นตอนนี้");
          setConnected({
            connection: { id: sibling.connectionId, businessId: sibling.businessId },
            credential: { secretStore: sibling.secretStore ?? null, displayHint: sibling.displayHint ?? null },
            bot: { basicId: sibling.basicId ?? null, displayName: sibling.displayName ?? null },
          });
          setAccountCode(suggestLineOaAccountCode({ basicId: sibling.basicId, displayName: sibling.displayName }));
          setPhase("accountConfirm");
          return;
        }
        setError(describeLineOaConnectError(json.error, { details: json.details, retryAfterSeconds: json.retryAfterSeconds }));
        return;
      }
      setConnected(json);
      setAccountCode(suggestLineOaAccountCode(json.bot));
      setPhase("accountConfirm");
    } catch {
      setError(describeLineOaConnectError("LINE_UNAVAILABLE"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmAccount(event) {
    event.preventDefault();
    if (!connected || accountBusy) return;
    setAccountError("");
    setAccountBusy(true);
    let code = accountCode.trim();
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const { ok, json } = await api("/api/line-oa/accounts", "POST", {
          businessId,
          integrationConnectionId: connected.connection.id,
          code,
          displayName: connected.bot.displayName || name.trim() || "LINE Official Account",
          ...(connected.bot.basicId ? { basicId: connected.bot.basicId } : {}),
        });
        if (ok) {
          setPhase("done");
          onConnected?.(json);
          return;
        }
        if (json.error === "LINE_OA_ACCOUNT_CODE_TAKEN" && attempt < 3) {
          code = `${accountCode.trim()}-${Math.random().toString(36).slice(2, 5)}`;
          continue;
        }
        setAccountError(json.error === "LINE_OA_ACCOUNT_CODE_TAKEN"
          ? "รหัสบัญชีนี้ถูกใช้แล้ว กรุณาแก้ไข"
          : "สร้างบัญชีไม่สำเร็จ — เชื่อมต่อ LINE ไว้แล้ว ลองอีกครั้งด้วยรหัสอื่น");
        return;
      }
    } finally {
      setAccountBusy(false);
    }
  }

  function reset() {
    setPhase("form");
    setName("");
    setChannelId("");
    clearSecretFields();
    setShowTokenField(false);
    setError(null);
    setNotice("");
    setConnected(null);
    setAccountCode("");
    setAccountError("");
  }

  return (
    <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4 font-thai">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#06C755] to-emerald-600 text-white flex items-center justify-center font-bold shadow-xs">
            <span>💬</span>
          </div>
          <div>
            <h4 className="font-bold text-sm text-slate-900 dark:text-white">เชื่อมต่อ LINE Official Account</h4>
            <p className="text-xs text-slate-500">
              ใช้ข้อมูลจาก LINE Developers Console → Messaging API ของช่องที่ต้องการเชื่อมต่อ ระบบจะไม่แสดงค่าลับซ้ำอีกหลังบันทึก
            </p>
          </div>
        </div>
      </div>

      {notice && (phase === "form" || phase === "accountConfirm") && (
        <p className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> <span>{notice}</span>
        </p>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 space-y-1">
          <p className="flex items-center gap-2 font-semibold"><ShieldAlert className="w-4 h-4 shrink-0" /> {error.message}</p>
        </div>
      )}

      {phase === "form" && (
        <form onSubmit={submitConnect} className="space-y-3.5">
          <fieldset disabled={busy || !businessId} className="space-y-3.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block space-y-1">
              <span>ชื่อการเชื่อมต่อ (ใช้ภายในระบบ) <span className="text-rose-500">*</span></span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} placeholder="เช่น LINE OA หลัก" required maxLength={200} />
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block space-y-1">
                <span>Channel ID (ตัวเลข ดูได้ที่แท็บ Basic settings) <span className="text-rose-500">*</span></span>
                <input value={channelId} onChange={(e) => setChannelId(e.target.value)} className={fieldClass} placeholder="1234567890" pattern={CHANNEL_ID_PATTERN} required inputMode="numeric" />
              </label>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block space-y-1">
                <span>Channel secret (แท็บ Basic settings) — เก็บแบบเข้ารหัส ไม่แสดงซ้ำ <span className="text-rose-500">*</span></span>
                <input type="password" autoComplete="off" value={channelSecret} onChange={(e) => setChannelSecret(e.target.value)} className={fieldClass} placeholder="••••••••••••••••••••••••••••••••" pattern={CHANNEL_SECRET_PATTERN} required />
              </label>
            </div>
            <div>
              <button type="button" onClick={() => setShowTokenField((v) => !v)} className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1">
                <KeyRound className="w-3 h-3" />
                {showTokenField ? "ซ่อน Channel access token" : "Channel access token (ไม่จำเป็น) — โดยปกติระบบจะขอ token ชั่วคราวเองจาก Channel ID และ secret"}
              </button>
              {showTokenField && (
                <input type="password" autoComplete="off" value={channelAccessToken} onChange={(e) => setChannelAccessToken(e.target.value)} className={`${fieldClass} mt-1.5`} placeholder="Channel access token (long-lived, override)" />
              )}
            </div>
            <button type="submit" disabled={busy || !businessId} className="w-full py-3 rounded-xl bg-brand-amber hover:bg-brand-hover active:scale-[0.99] text-white text-xs font-bold transition-all shadow-md shadow-brand-amber/20 flex items-center justify-center gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>{busy ? "กำลังตรวจสอบกับ LINE…" : "ตรวจสอบกับ LINE และบันทึก"}</span>
            </button>
          </fieldset>
        </form>
      )}

      {phase === "mfaEnroll" && enroll && (
        <form onSubmit={submitEnrolment} className="space-y-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            ยังไม่ได้ตั้งค่าการยืนยันตัวตนสองขั้นตอน — ตั้งค่าก่อนจึงจะเชื่อมต่อบัญชี LINE ได้
          </p>
          {enroll.qrDataUrl && <img src={enroll.qrDataUrl} alt="QR สำหรับตั้งค่าแอปยืนยันตัวตน" className="w-40 h-40 rounded-lg border border-amber-200 bg-white" />}
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            สแกน QR ด้วยแอปยืนยันตัวตน (Authenticator) หรือกรอกรหัสด้วยตนเอง:
            <code className="block mt-1 font-mono text-[11px] break-all bg-white dark:bg-slate-900 p-1.5 rounded border border-amber-200">{enroll.secret}</code>
          </p>
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block space-y-1">
            <span>รหัส 6 หลักจากแอปยืนยันตัวตน</span>
            <input value={enrollCode} onChange={(e) => setEnrollCode(e.target.value)} className={fieldClass} placeholder="000000" inputMode="numeric" maxLength={6} required />
          </label>
          <button type="submit" disabled={busy} className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold disabled:opacity-50">
            {busy ? "กำลังยืนยัน…" : "ยืนยันและเปิดใช้งาน"}
          </button>
        </form>
      )}

      {phase === "stepUp" && (
        <form onSubmit={submitStepUp} className="space-y-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            ยืนยันตัวตนอีกครั้งด้วยรหัสจากแอปยืนยันตัวตน (TOTP) ก่อนบันทึกข้อมูลรับรอง
          </p>
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block space-y-1">
            <span>รหัส 6 หลัก</span>
            <input value={stepUpCode} onChange={(e) => setStepUpCode(e.target.value)} className={fieldClass} placeholder="000000" inputMode="numeric" maxLength={6} required />
          </label>
          <button type="submit" disabled={busy} className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold disabled:opacity-50">
            {busy ? "กำลังยืนยัน…" : "ยืนยันตัวตน"}
          </button>
        </form>
      )}

      {phase === "accountConfirm" && connected && (
        <form onSubmit={confirmAccount} className="space-y-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60">
          <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
            เชื่อมต่อสำเร็จ: {connected.bot.displayName} ({connected.bot.basicId || "—"}) · Channel ID ••••{connected.credential.displayHint} · เก็บใน {connected.credential.secretStore === "SUPABASE_VAULT" ? "Vault" : "ที่เก็บเข้ารหัสของเซิร์ฟเวอร์"}
          </p>
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block space-y-1">
            <span>รหัสบัญชีในระบบ (สร้างให้จาก Basic ID; แก้ไขได้)</span>
            <input value={accountCode} onChange={(e) => setAccountCode(e.target.value)} className={fieldClass} pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={64} required />
          </label>
          {accountError && <p className="text-[11px] text-rose-600">{accountError}</p>}
          <button type="submit" disabled={accountBusy} className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50">
            {accountBusy ? "กำลังสร้างบัญชี…" : "สร้างบัญชี LINE OA"}
          </button>
        </form>
      )}

      {phase === "done" && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-2">
          <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> สร้างบัญชี LINE OA แล้ว (สถานะ DRAFT)
          </p>
          <button type="button" onClick={reset} className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 underline">
            เชื่อมต่ออีกบัญชีหนึ่ง
          </button>
        </div>
      )}
    </div>
  );
}
