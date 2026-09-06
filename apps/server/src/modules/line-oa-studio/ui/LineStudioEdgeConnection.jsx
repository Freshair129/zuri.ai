// @req FR-146, FR-149, FR-151, FR-152, FR-153 — LINE Studio Edge & Transport Console
// @spec ADR-041, ADR-043, ADR-061, SEC-001, SDD-060
"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Server,
  Cpu,
  ShieldCheck,
  Radio,
  RefreshCw,
  Sliders,
  Terminal,
  Activity,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Layers,
  Database,
  Lock,
  Zap,
  HelpCircle,
  Copy,
  Check,
  Sparkles,
  ArrowRight
} from "lucide-react";
import { Card, SectionTitle, StatusPill } from "@/components/ui";
import { useScope } from "@/context/ScopeContext";

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

export default function LineStudioEdgeConnection() {
  const scope = useScope();
  const business = scope?.shell?.activeBusiness;

  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);

  // Mock Edge Device Telemetry (ADR-041 / ADR-043)
  const edgeDeviceTelemetry = {
    id: "edg-node-01",
    name: "Zuri Edge Device (Workstation Node)",
    host: "localhost:8787",
    status: "ONLINE",
    latency: "4 ms",
    pairingToken: "edgk_live_8921a7f0e812d4",
    uptime: "99.98%",
    tiers: [
      { tier: "Tier 1", name: "Edge Runtime Daemon", desc: "Local Background Worker & Webhook Forwarder", status: "ACTIVE" },
      { tier: "Tier 2", name: "MSP Memory Policy", desc: "Token Budget & Ephemeral Scratchpad Gate", status: "ACTIVE" },
      { tier: "Tier 3", name: "GKS Knowledge Authority", desc: "Canonical Entity Identity & RAG (Radius R0-R3)", status: "ACTIVE" },
      { tier: "Tier 4", name: "GenesisBlockDB", desc: "6-Lane Substrate (Vector + Graph + Lexical)", status: "HEALTHY" }
    ]
  };

  const refresh = useCallback(async () => {
    if (!business?.id) {
      setAccounts([]);
      return;
    }
    try {
      const result = await api(`/api/line-oa/accounts?businessId=${encodeURIComponent(business.id)}`);
      setAccounts(result.accounts || []);
    } catch (err) {
      setError(err.message);
    }
  }, [business?.id]);

  useEffect(() => {
    setAccounts([]);
    setConnectionId("");
    setMessage("");
    setError("");
    refresh().catch((err) => setError(err.message));
  }, [refresh]);

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

  async function provision(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const result = await api("/api/line-oa/connections", "POST", {
        businessId: business.id,
        name: form.get("name"),
        destination: form.get("destination"),
        secretRef: form.get("secretRef")
      });
      setConnectionId(result.id);
      setMessage("สร้าง Connection แล้ว เชื่อมบัญชีในขั้นตอนถัดไป");
    });
  }

  async function connect(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await api("/api/line-oa/accounts", "POST", {
        businessId: business.id,
        integrationConnectionId: connectionId,
        code: form.get("code"),
        displayName: form.get("displayName"),
        ...(form.get("basicId") ? { basicId: form.get("basicId") } : {})
      });
      setMessage("เชื่อมบัญชีแล้ว เตรียม credentials และเปิด Server transport เมื่อพร้อม");
    });
  }

  const copyToken = (text) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="space-y-6 font-thai">
      {/* Top Banner: Hybrid Cloud Server & Edge Topology Overview */}
      <div className="rounded-2xl p-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-md relative overflow-hidden border border-slate-800">
        <div className="absolute right-0 top-0 w-96 h-96 bg-brand-amber/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/30 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                ADR-041 & ADR-061 HYBRID RUNTIME
              </span>
              <span className="text-xs text-slate-400">Zero Secret Exposure Architecture</span>
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Server Transport & Zuri Edge Device Topology
            </h2>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              สถาปัตยกรรม 2 ขา: <strong>Zuri Cloud Server</strong> รับ Ingress Webhook ตลอด 24/7 และสลับประมวลผลคำตอบได้ทั้งบน Cloud หรือส่งคำสั่งไปยัง <strong>Zuri Edge Device</strong> ในองค์กรแบบ Zero-Trust
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => run(refresh)}
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

      {/* Grid: Left = Edge Device Node & Cognitive Stack, Right = Server-Owned Accounts & Webhook */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Zuri Edge Device Status & 4-Tier Cognitive Stack */}
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-2xl p-5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-xs text-slate-900 dark:text-white">Zuri Edge Device</h3>
                  <p className="text-[10px] text-slate-500">On-Premise Hardware Node</p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                {edgeDeviceTelemetry.status}
              </span>
            </div>

            {/* Telemetry info */}
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-slate-800/60">
                <span className="text-slate-500">Host Endpoint</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{edgeDeviceTelemetry.host}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-slate-800/60">
                <span className="text-slate-500">Heartbeat Latency</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{edgeDeviceTelemetry.latency}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-slate-800/60">
                <span className="text-slate-500">Pairing Key Ref</span>
                <button
                  onClick={() => copyToken(edgeDeviceTelemetry.pairingToken)}
                  className="font-mono text-[10px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-700 dark:text-slate-300 flex items-center gap-1 hover:bg-slate-200"
                >
                  <span>{edgeDeviceTelemetry.pairingToken.slice(0, 10)}...</span>
                  {copiedKey ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-slate-400" />}
                </button>
              </div>
            </div>

            {/* Deep Links to Local Edge Web GUI */}
            <div className="pt-2 flex flex-col gap-2">
              <a
                href="http://localhost:8787/gui"
                target="_blank"
                rel="noreferrer"
                className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center justify-between transition-colors shadow-xs"
              >
                <div className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-brand-amber" />
                  <span>เปิด Edge Web GUI (:8787/gui)</span>
                </div>
                <ExternalLink className="w-3 h-3 text-slate-400" />
              </a>

              <a
                href="http://localhost:8787/graph"
                target="_blank"
                rel="noreferrer"
                className="w-full py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-between transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Database className="w-3.5 h-3.5 text-blue-500" />
                  <span>เปิด Knowledge Graph (:8787/graph)</span>
                </div>
                <ExternalLink className="w-3 h-3 text-slate-400" />
              </a>
            </div>

            {/* 4-Tier Cognitive Stack Architecture Mini Matrix */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-brand-amber" />
                <span>4-Tier Cognitive Architecture (ADR-043)</span>
              </h4>
              <div className="space-y-2">
                {edgeDeviceTelemetry.tiers.map((t, idx) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-100 dark:border-slate-800 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-slate-200">{t.tier}: {t.name}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600">{t.status}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-0.5">{t.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Center & Right Column: LINE OA Accounts, Server Transport & Provisioning */}
        <div className="lg:col-span-2 space-y-6">
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
                    onAction={action}
                    busy={busy}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Provisioning Forms (2-Step) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Step 1: Provision Connection */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-brand-amber text-white text-[10px] font-bold flex items-center justify-center">1</span>
                <h4 className="font-bold text-xs text-slate-900 dark:text-white">เตรียม Connection (เจ้าของ Business)</h4>
              </div>
              <p className="text-[11px] text-slate-500">
                ผู้ดูแลระบบเก็บ secret ใน secret mount แล้วระบุ secretRef
              </p>
              <form onSubmit={provision} className="space-y-2.5">
                <fieldset disabled={busy || !business} className="space-y-2.5">
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block">
                    ชื่อ Connection
                    <input name="name" className={fieldClass} placeholder="เช่น Main Official Line" required maxLength={200} />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block">
                    Bot user ID / destination
                    <input name="destination" className={fieldClass} placeholder="U… (32 hex chars)" required pattern="U[0-9a-fA-F]{32}" />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block">
                    ชื่ออ้างอิง Secret
                    <input name="secretRef" className={fieldClass} placeholder="deployment-secret:line-main" required pattern="deployment-secret:[A-Za-z0-9_-]{1,100}" />
                  </label>
                  <button type="submit" className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-all">
                    สร้าง Connection
                  </button>
                </fieldset>
              </form>
            </div>

            {/* Step 2: Connect LINE OA */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center">2</span>
                <h4 className="font-bold text-xs text-slate-900 dark:text-white">เชื่อมบัญชี LINE OA</h4>
              </div>
              <p className="text-[11px] text-slate-500">
                ผูกรหัสบัญชีและชื่อแสดง เพื่อเริ่มเปิดใช้งาน Server Transport
              </p>
              <form onSubmit={connect} className="space-y-2.5">
                <fieldset disabled={busy || !business} className="space-y-2.5">
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block">
                    Connection ID
                    <input
                      name="connectionId"
                      value={connectionId}
                      onChange={(e) => setConnectionId(e.target.value)}
                      className={fieldClass}
                      placeholder="ใส่ ID จากขั้นตอนที่ 1"
                      required
                    />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block">
                    รหัสบัญชี
                    <input name="code" className={fieldClass} placeholder="เช่น oa-main" required minLength={3} pattern="[a-z0-9]+(-[a-z0-9]+)*" />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block">
                    ชื่อแสดง
                    <input name="displayName" className={fieldClass} placeholder="เช่น Zuri Official Support" required />
                  </label>
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block">
                    LINE basic ID (ถ้ามี)
                    <input name="basicId" className={fieldClass} placeholder="@yourshop" />
                  </label>
                  <button type="submit" className="w-full py-2 rounded-xl bg-brand-amber hover:bg-brand-hover text-white text-xs font-semibold transition-all">
                    เชื่อมบัญชี
                  </button>
                </fieldset>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountCard({ account, onAction, busy }) {
  const [mode, setMode] = useState(account.executionMode);
  const [access, setAccess] = useState(account.modelAccess);
  const [push, setPush] = useState(account.allowDelayedPush);
  const [quiesced, setQuiesced] = useState(false);
  const [jobs, setJobs] = useState(null);
  const [acknowledged, setAcknowledged] = useState({});
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMode(account.executionMode);
    setAccess(account.modelAccess);
    setPush(account.allowDelayedPush);
  }, [account]);

  async function loadJobs() {
    try {
      setError("");
      const result = await api(`/api/line-oa/accounts/${account.id}/jobs`);
      setJobs(result.jobs ?? result);
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
            LINE Transport: <strong className="text-slate-800 dark:text-slate-200">{account.serverEnabled ? "Zuri Server" : account.transportMode === "EDGE" ? "Legacy Edge" : "Server ยังไม่เปิด"}</strong> · Connection: <span className="text-emerald-600">{account.health?.connection?.status || "พร้อม"}</span>
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

      <fieldset disabled={busy || account.status === "ARCHIVED"} className="grid gap-3 pt-1">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <div>
            <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              ประมวลผลคำตอบ
            </label>
            <select
              aria-label="ประมวลผลคำตอบ"
              className={fieldClass}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="SERVER">Server</option>
              <option value="EDGE">Edge worker</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              การใช้โมเดล
            </label>
            <select
              aria-label="การใช้โมเดล"
              className={fieldClass}
              value={access}
              onChange={(e) => setAccess(e.target.value)}
            >
              <option value="LOCAL_ONLY">Local only</option>
              <option value="EXTERNAL_MODEL_ALLOWED">อนุญาต Cloud API</option>
            </select>
          </div>
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

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
            onClick={() => onAction(account, { action: "CONFIGURE_EXECUTION", executionMode: mode, modelAccess: access, allowDelayedPush: push })}
          >
            บันทึกการประมวลผล
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
            <button
              type="button"
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              disabled={!quiesced}
              onClick={() => onAction(account, { action: "ENABLE_SERVER", legacyQuiesced: true })}
            >
              เปิด Server transport
            </button>
          ) : (
            <button
              type="button"
              className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold"
              onClick={() => onAction(account, { action: "SWITCH_TRANSPORT_MODE", transportMode: "CLOUD" })}
            >
              เตรียมย้ายไป Server
            </button>
          )}

          <button
            type="button"
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-white"
            onClick={loadJobs}
          >
            ดูสถานะข้อความ
          </button>
        </div>
      </fieldset>

      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}

      {jobs && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <h5 className="font-bold text-xs text-slate-800 dark:text-slate-200 mb-2">คิวข้อความล่าสุด (Delivery Jobs)</h5>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500">
                <th className="p-1.5">เวลา</th>
                <th className="p-1.5">งาน</th>
                <th className="p-1.5">สถานะ</th>
                <th className="p-1.5">รายละเอียด</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(jobs) && jobs.map((job) => (
                <tr key={job.id} className="border-b border-slate-100 dark:border-slate-800 font-mono text-[11px]">
                  <td className="p-1.5">{new Date(job.createdAt).toLocaleTimeString()}</td>
                  <td className="p-1.5">{job.id.slice(0, 8)}</td>
                  <td className="p-1.5 font-bold">{job.status}</td>
                  <td className="p-1.5">{job.errorCode || job.executionMode}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {Array.isArray(jobs) && jobs.length === 0 && (
            <p className="p-2 text-center text-slate-400 text-xs">ยังไม่มีข้อความในคิว</p>
          )}
        </div>
      )}
    </div>
  );
}
