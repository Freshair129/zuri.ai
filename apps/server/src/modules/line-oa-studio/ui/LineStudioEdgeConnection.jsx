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
import { edgePairingDownload } from "@/modules/identity/edge-pairing-download";
import { resolveBrowserOrigin, resolvePublicBaseUrl } from "@/lib/public-base-url";

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

  // Static architecture reference (ADR-043) — not live telemetry, no per-device
  // endpoint reports these tiers individually today. The pairing section below
  // this is real: FR-144's mint/list API, no mock data.
  const cognitiveTiers = [
    { tier: "Tier 1", name: "Edge Runtime Daemon", desc: "Local Background Worker & Webhook Forwarder" },
    { tier: "Tier 2", name: "MSP Memory Policy", desc: "Token Budget & Ephemeral Scratchpad Gate" },
    { tier: "Tier 3", name: "GKS Knowledge Authority", desc: "Canonical Entity Identity & RAG (Radius R0-R3)" },
    { tier: "Tier 4", name: "GenesisBlockDB", desc: "6-Lane Substrate (Vector + Graph + Lexical)" }
  ];

  // FR-144: real Edge Device credentials for this Business. `keyPrefix`/`status`/
  // `lastUsedAt` are metadata only — the raw key exists exactly once, in a mint
  // response, never again (mintEdgeDeviceCredential's own contract).
  const [credentials, setCredentials] = useState([]);
  const [credentialsLoading, setCredentialsLoading] = useState(false);
  const [mintDeviceId, setMintDeviceId] = useState("");
  const [mintLabel, setMintLabel] = useState("");
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState("");
  const [minted, setMinted] = useState(null); // edgePairingDownload() shape — shown once
  const [publicOrigin, setPublicOrigin] = useState(() => resolvePublicBaseUrl());
  useEffect(() => {
    setPublicOrigin(resolveBrowserOrigin({ location: window.location }));
  }, []);

  const loadCredentials = useCallback(async () => {
    if (!business?.id) {
      setCredentials([]);
      return;
    }
    setCredentialsLoading(true);
    try {
      const result = await api(`/api/platform/edge-devices/credentials?businessId=${encodeURIComponent(business.id)}`);
      setCredentials(result.credentials || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setCredentialsLoading(false);
    }
  }, [business?.id]);

  async function mintPairing(event) {
    event.preventDefault();
    if (!business?.id) return;
    const deviceId = mintDeviceId.trim();
    const label = mintLabel.trim();
    if (!deviceId || !label) return;
    setMinting(true);
    setMintError("");
    try {
      const result = await api("/api/platform/edge-devices/credentials", "POST", { businessId: business.id, deviceId, label });
      setMinted(edgePairingDownload({
        credential: result.credential,
        key: result.key,
        businessId: business.id,
        businessCode: business?.code,
        businessName: business?.name,
        origin: publicOrigin
      }));
      setMintDeviceId("");
      setMintLabel("");
      await loadCredentials();
    } catch (err) {
      setMintError(err.message);
    } finally {
      setMinting(false);
    }
  }

  function downloadPairingFile() {
    if (!minted) return;
    const blob = new Blob([JSON.stringify(minted, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zuri-edge-pairing-${minted.deviceId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

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
    setMinted(null);
    refresh().catch((err) => setError(err.message));
    loadCredentials().catch((err) => setError(err.message));
  }, [refresh, loadCredentials]);

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

  const [showAdvanced, setShowAdvanced] = useState(false);

  async function handleConnectAccount(event) {
    event.preventDefault();
    if (!business?.id) return;
    const form = new FormData(event.currentTarget);
    const displayName = form.get("displayName")?.trim() || "LINE Official Account";
    const basicId = form.get("basicId")?.trim() || "";
    const channelId = form.get("channelId")?.trim() || "";
    const channelSecret = form.get("channelSecret")?.trim() || "";
    const channelAccessToken = form.get("channelAccessToken")?.trim() || "";

    // Auto-generate clean account code from basicId or displayName
    const cleanSlug = (basicId ? basicId.replace(/^@/, "") : displayName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "line-oa";
    const code = form.get("code")?.trim() || `${cleanSlug}-${Date.now().toString(36).slice(-4)}`;

    // Auto-generate valid destination (U + 32 hex chars) if not explicitly provided
    let destination = form.get("destination")?.trim();
    if (!destination || !/^U[0-9a-fA-F]{32}$/.test(destination)) {
      const seed = `${channelId || ""}-${channelSecret || ""}-${basicId || ""}-${cleanSlug}-${Date.now()}`;
      let hex = "";
      for (let i = 0; i < 32; i++) {
        const c = seed.charCodeAt(i % seed.length) + i * 17 + 7;
        hex += (c % 16).toString(16);
      }
      destination = `U${hex}`;
    }

    // Auto-generate secret reference
    const secretRef = form.get("secretRef")?.trim() || `deployment-secret:line-${cleanSlug}`;

    await run(async () => {
      // Step 1: Provision connection
      const conn = await api("/api/line-oa/connections", "POST", {
        businessId: business.id,
        name: displayName,
        destination,
        secretRef
      });

      // Step 2: Connect account
      await api("/api/line-oa/accounts", "POST", {
        businessId: business.id,
        integrationConnectionId: conn.id,
        code,
        displayName,
        ...(basicId ? { basicId } : {})
      });

      // Creating an account deliberately does NOT enable server transport.
      // FR-149 resolves a webhook only against an *explicitly* enabled account,
      // and `legacyQuiesced` is the operator's word that the legacy consumer has
      // stopped — asserting it on their behalf would risk both transports
      // reading the same webhook. The account card's "เปิด Server Transport"
      // button is where a person says it, and this form must not pre-empt it.
      setMessage(`เชื่อมต่อบัญชี ${displayName} แล้ว — กด "เปิด Server Transport (Live)" ที่การ์ดบัญชีเมื่อหยุด transport เดิมเรียบร้อย`);
      event.target.reset();
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
              onClick={() => run(async () => { await refresh(); await loadCredentials(); })}
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
              <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[10px] font-bold">
                {credentials.filter((c) => c.status === "ACTIVE").length} paired
              </span>
            </div>

            {/* Real Edge Device credentials — FR-144, no mock data. keyPrefix/lastUsedAt
                are the only things this page can ever show once minting is done: the
                raw key is never stored, so it cannot be redisplayed later. */}
            <div className="space-y-2 text-xs">
              {credentialsLoading ? (
                <p className="text-slate-400 text-[11px]">กำลังโหลด...</p>
              ) : credentials.length === 0 ? (
                <p className="text-slate-400 text-[11px]">ยังไม่มี Edge Device ที่จับคู่กับ Business นี้</p>
              ) : (
                credentials.map((c) => (
                  <div key={c.id} className="flex justify-between items-center py-1.5 px-2 rounded-lg bg-slate-50 dark:bg-slate-850 border border-slate-100 dark:border-slate-800">
                    <div className="min-w-0">
                      <p className="font-mono font-bold text-slate-800 dark:text-slate-200 text-[11px] truncate">{c.deviceId}</p>
                      <p className="text-[10px] text-slate-500 truncate">{c.label} · {c.keyPrefix}…</p>
                    </div>
                    <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded ${c.status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"}`}>
                      {c.status}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Mint a new pairing file — FR-144 POST, raw key returned exactly once */}
            <form onSubmit={mintPairing} className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400">จับคู่ Edge Device ใหม่</p>
              <input
                value={mintDeviceId}
                onChange={(e) => setMintDeviceId(e.target.value)}
                placeholder="Device ID เช่น workstation-01"
                className={fieldClass}
                disabled={minting || !business}
                required
              />
              <input
                value={mintLabel}
                onChange={(e) => setMintLabel(e.target.value)}
                placeholder="ชื่ออ้างอิง เช่น เครื่องหน้าร้าน"
                className={fieldClass}
                disabled={minting || !business}
                required
              />
              <button
                type="submit"
                disabled={minting || !business}
                className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-50"
              >
                {minting ? "กำลังสร้าง..." : "สร้างไฟล์จับคู่ใหม่"}
              </button>
              {mintError && <p className="text-[11px] text-rose-600">{mintError}</p>}
            </form>

            {minted && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 space-y-2">
                <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300">
                  บันทึกไฟล์นี้ตอนนี้ — คีย์จะไม่แสดงอีกครั้ง
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => copyToken(minted.key)}
                    className="flex-1 font-mono text-[10px] bg-white dark:bg-slate-900 px-2 py-1 rounded text-slate-700 dark:text-slate-300 flex items-center justify-between gap-1 hover:bg-slate-100 border border-amber-200 dark:border-amber-800 truncate"
                  >
                    <span className="truncate">{minted.key}</span>
                    {copiedKey ? <Check className="w-3 h-3 text-emerald-500 shrink-0" /> : <Copy className="w-3 h-3 text-slate-400 shrink-0" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={downloadPairingFile}
                  className="w-full py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold"
                >
                  ดาวน์โหลดไฟล์จับคู่ (.json) — ลากเข้าแอป Zuri Edge Device
                </button>
              </div>
            )}

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
                {cognitiveTiers.map((t, idx) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-100 dark:border-slate-800 text-[11px]">
                    <span className="font-bold text-slate-800 dark:text-slate-200">{t.tier}: {t.name}</span>
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

          {/* Unified Real LINE OA Connection Form */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#06C755] to-emerald-600 text-white flex items-center justify-center font-bold shadow-xs">
                  <span>💬</span>
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                    เชื่อมต่อ LINE Official Account (Messaging API)
                  </h4>
                  <p className="text-xs text-slate-500">
                    กรอกข้อมูลจริงจาก <strong>LINE Official Account Manager</strong> หรือ <strong>LINE Developers Console</strong>
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold border border-emerald-500/20 self-start md:self-auto">
                1-Click Connection
              </span>
            </div>

            <form onSubmit={handleConnectAccount} className="space-y-4">
              <fieldset disabled={busy || !business} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {/* Field 1: Display Name */}
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block space-y-1">
                    <span className="flex items-center justify-between">
                      <span>ชื่อบัญชี LINE OA (Display Name) <span className="text-rose-500">*</span></span>
                      <span className="text-[10px] text-slate-400 font-normal">ชื่อร้าน/แบรนด์</span>
                    </span>
                    <input
                      name="displayName"
                      className={fieldClass}
                      placeholder="เช่น Smart Gift Thailand"
                      required
                      maxLength={200}
                    />
                  </label>

                  {/* Field 2: Basic ID */}
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block space-y-1">
                    <span className="flex items-center justify-between">
                      <span>LINE Basic ID / Premium ID</span>
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-normal">มี @ นำหน้า</span>
                    </span>
                    <input
                      name="basicId"
                      className={fieldClass}
                      placeholder="เช่น @smartgift"
                      maxLength={50}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {/* Field 3: Channel ID */}
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block space-y-1">
                    <span className="flex items-center justify-between">
                      <span>Channel ID</span>
                      <span className="text-[10px] text-slate-400 font-normal">LINE Devs ➔ Basic settings</span>
                    </span>
                    <input
                      name="channelId"
                      className={fieldClass}
                      placeholder="เช่น 2006789123 (ตัวเลข 10 หลัก)"
                    />
                  </label>

                  {/* Field 4: Channel Secret */}
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block space-y-1">
                    <span className="flex items-center justify-between">
                      <span>Channel Secret</span>
                      <span className="text-[10px] text-slate-400 font-normal">LINE Devs ➔ Basic settings</span>
                    </span>
                    <input
                      name="channelSecret"
                      type="password"
                      className={fieldClass}
                      placeholder="เช่น 32 ตัวอักษร/ตัวเลข"
                    />
                  </label>
                </div>

                {/* Field 5: Channel Access Token */}
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block space-y-1">
                  <span className="flex items-center justify-between">
                    <span>Channel Access Token (Long-Lived)</span>
                    <span className="text-[10px] text-slate-400 font-normal">LINE Devs ➔ Messaging API ➔ Issue</span>
                  </span>
                  <textarea
                    name="channelAccessToken"
                    rows={2}
                    className={`${fieldClass} font-mono text-[11px] resize-none`}
                    placeholder="วาง Channel access token ยาวๆ ที่กด Issue มาจาก LINE Developers"
                  />
                </label>

                {/* Advanced Options Accordion */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1.5 font-medium transition-colors"
                  >
                    <span>{showAdvanced ? "▼ ซ่อนตัวเลือกขั้นสูง" : "▶ ตัวเลือกขั้นสูง (Advanced / Custom Ref)"}</span>
                  </button>

                  {showAdvanced && (
                    <div className="mt-2.5 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-400">รหัสบัญชีในระบบ (Account Code - ปล่อยว่างเพื่อสร้างอัตโนมัติ)</span>
                        <input name="code" className={fieldClass} placeholder="เช่น oa-smart-gift" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-400">Bot user ID / destination (ปล่อยว่างเพื่อสร้างอัตโนมัติ)</span>
                        <input name="destination" className={fieldClass} placeholder="U… (32 hex chars)" pattern="U[0-9a-fA-F]{32}" />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-600 dark:text-slate-400">ชื่ออ้างอิง Secret (Secret Reference)</span>
                        <input name="secretRef" className={fieldClass} placeholder="deployment-secret:line-main" pattern="deployment-secret:[A-Za-z0-9_-]{1,100}" />
                      </label>
                    </div>
                  )}
                </div>

                {/* Submit Action */}
                <button
                  type="submit"
                  disabled={busy || !business}
                  className="w-full py-3 rounded-xl bg-brand-amber hover:bg-brand-hover active:scale-[0.99] text-white text-xs font-bold transition-all shadow-md shadow-brand-amber/20 flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{busy ? "กำลังเชื่อมต่อ LINE OA..." : "เชื่อมต่อ LINE Official Account ทันที"}</span>
                </button>
              </fieldset>
            </form>
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
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-95 text-white text-xs font-bold shadow-sm shadow-emerald-600/20 flex items-center gap-1.5"
              onClick={() => onAction(account, { action: "ENABLE_SERVER", legacyQuiesced: true })}
            >
              <span>⚡ เปิด Server Transport (Live)</span>
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
