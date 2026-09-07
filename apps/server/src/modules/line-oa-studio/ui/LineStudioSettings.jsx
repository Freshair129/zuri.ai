// @req FR-146, FR-151, FR-080 — LINE Studio Account & AI Bot Settings
// @spec SDD-060, SDD-061, ADR-041 — Channel Credentials, AI Persona & Quota Management
"use client";

import React, { useState, useEffect } from "react";
import { useScope } from "@/context/ScopeContext";
import {
  Settings,
  Key,
  ShieldCheck,
  Bot,
  MessageSquare,
  Sparkles,
  Save,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
  Cpu,
  RefreshCw,
  BarChart3
} from "lucide-react";

export default function LineStudioSettings() {
  const scope = useScope();
  const businessId = scope?.businessId;
  const business = scope?.shell?.activeBusiness;

  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copiedKey, setCopiedKey] = useState(null);

  // Form State
  const [channelId, setChannelId] = useState("1657829104");
  const [channelSecret, setChannelSecret] = useState("secret:vault:line_channel_secret_smartgift");
  const [channelAccessToken, setChannelAccessToken] = useState("");
  const [botName, setBotName] = useState("Zuri AI Assistant");
  const [aiTone, setAiTone] = useState("friendly"); // 'formal' | 'friendly' | 'expert'
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("คุณคือผู้ช่วย AI สุภาพ เป็นกันเอง ตอบคำถามเกี่ยวกับสินค้าและการสั่งซื้อของ SmartGift อย่างถูกต้องแม่นยำ");
  
  // Quota & Connection Test
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState(null);

  const publicOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://zuri.ai';
  const webhookUrl = `${publicOrigin}/api/agent/line-webhook`;

  const copyToClipboard = (text, key) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleTestWebhook = async () => {
    setTestingWebhook(true);
    setWebhookStatus(null);
    try {
      const res = await fetch("/api/agent/line-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [],
          destination: channelId || "U_TEST"
        })
      });
      if (res.ok) {
        setWebhookStatus({ success: true, text: "✅ Webhook Endpoint ตอบรับสถานะ 200 OK" });
      } else {
        setWebhookStatus({ success: false, text: "⚠️ Webhook ตอบกลับด้วยรหัสข้อผิดพลาด" });
      }
    } catch (e) {
      setWebhookStatus({ success: false, text: `❌ ไม่สามารถทดสอบ Webhook ได้: ${e.message}` });
    } finally {
      setTestingWebhook(false);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg("");
    setErrorMsg("");

    try {
      // Simulate saving settings to local state or API
      await new Promise(r => setTimeout(r, 600));
      setSuccessMsg("✅ บันทึกการตั้งค่า LINE Studio และ AI Bot เรียบร้อยแล้ว");
    } catch (err) {
      setErrorMsg(err.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูล");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6 pb-12 font-thai animate-in fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
          <Settings className="w-6 h-6 text-brand-amber" />
          <span>การตั้งค่า LINE Studio & Messaging API</span>
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          จัดการกุญแจความปลอดภัย Messaging API, กำหนดบุคลิก AI Bot (Persona), และติดตามโควต้าข้อความ
        </p>
      </div>

      {/* Success / Error Alerts */}
      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg("")} className="text-xs font-bold text-emerald-700">✕</button>
        </div>
      )}
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 text-rose-800 border border-rose-200 text-xs font-semibold flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg("")} className="text-xs font-bold text-rose-700">✕</button>
        </div>
      )}

      {/* Quota & Edge Summary Banner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Banner 1: Broadcast Quota */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-purple-600" />
              <span>โควต้าข้อความรายเดือน (Push Quota)</span>
            </span>
            <span className="text-[11px] font-mono font-semibold text-purple-600 bg-purple-50 dark:bg-purple-950 px-2 py-0.5 rounded">
              Basic Plan
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 font-mono">
              <span>ใช้งานแล้ว: 450 / 1,000 ข้อความ</span>
              <span className="font-bold">45%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div className="h-full bg-purple-600 rounded-full" style={{ width: "45%" }} />
            </div>
          </div>
          <p className="text-[10px] text-slate-400">โควต้าจะถูกรีเซ็ตในวันที่ 1 ของเดือนถัดไป</p>
        </div>

        {/* Banner 2: Edge Runtime Status */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-emerald-600" />
              <span>สถานะ Edge Runtime</span>
            </span>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> PAIRED / READY
            </span>
          </div>
          <div className="text-xs text-slate-600 dark:text-slate-300 font-mono">
            Device ID: <span className="font-bold text-slate-900 dark:text-white">DEV-SMARTGIFT-01</span>
          </div>
          <p className="text-[10px] text-slate-400">เชื่อมต่อกับ Zuri Cloud Telemetry ล่าสุดเมื่อ 12 วินาทีที่แล้ว</p>
        </div>
      </div>

      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* Section 1: LINE Messaging API Credentials */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <Key className="w-5 h-5 text-amber-500" />
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                LINE Messaging API Credentials
              </h2>
              <p className="text-[11px] text-slate-500">
                ข้อมูลรหัสผ่านและการเชื่อมต่อจาก LINE Developers Console
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Channel ID
              </label>
              <input
                type="text"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                placeholder="1657829104"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs font-mono focus:ring-2 focus:ring-amber-500/30 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Channel Secret (หรือ Supabase Vault Ref)
              </label>
              <input
                type="text"
                value={channelSecret}
                onChange={(e) => setChannelSecret(e.target.value)}
                placeholder="secret:vault:line_channel_secret"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs font-mono focus:ring-2 focus:ring-amber-500/30 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              Channel Access Token (Long-Lived)
            </label>
            <textarea
              rows={2}
              value={channelAccessToken}
              onChange={(e) => setChannelAccessToken(e.target.value)}
              placeholder="วาง Channel Access Token ที่ออกอายุนานจาก LINE Developers Console..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs font-mono focus:ring-2 focus:ring-amber-500/30 focus:outline-none"
            />
          </div>

          {/* Webhook Test Card */}
          <div className="mt-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">Webhook URL สำหรับนำไปใส่ใน LINE Developers:</span>
                <code className="text-[11px] font-mono text-purple-600 dark:text-purple-400 select-all">{webhookUrl}</code>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => copyToClipboard(webhookUrl, "webhook")}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 flex items-center gap-1"
                >
                  {copiedKey === "webhook" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>คัดลอก URL</span>
                </button>
                <button
                  type="button"
                  onClick={handleTestWebhook}
                  disabled={testingWebhook}
                  className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-semibold shadow-xs flex items-center gap-1"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testingWebhook ? "animate-spin" : ""}`} />
                  <span>ทดสอบ Webhook</span>
                </button>
              </div>
            </div>
            {webhookStatus && (
              <p className={`text-xs font-semibold mt-1 ${webhookStatus.success ? "text-emerald-600" : "text-rose-600"}`}>
                {webhookStatus.text}
              </p>
            )}
          </div>
        </div>

        {/* Section 2: AI Bot Persona & Auto-Reply Policy */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-purple-600" />
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  บุคลิก AI Bot & Auto-Reply Policy
                </h2>
                <p className="text-[11px] text-slate-500">
                  ตั้งค่าชื่อ ท่วงทำนองการตอบกลับ (Tone of Voice) และเปิด-ปิดระบบตอบอัตโนมัติ
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">ตอบอัตโนมัติ (Auto-Reply):</span>
              <button
                type="button"
                onClick={() => setAutoReplyEnabled(!autoReplyEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  autoReplyEnabled ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    autoReplyEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                ชื่อแสดงของบอท (Bot Display Name)
              </label>
              <input
                type="text"
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                placeholder="เช่น Zuri AI Assistant"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs focus:ring-2 focus:ring-purple-500/30 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                ท่วงทำนองในการสื่อสาร (Tone of Voice)
              </label>
              <select
                value={aiTone}
                onChange={(e) => setAiTone(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs focus:ring-2 focus:ring-purple-500/30 focus:outline-none"
              >
                <option value="friendly">😊 สุภาพและเป็นกันเอง (แนะนำสำหรับบริการ)</option>
                <option value="formal">👔 ทางการ เป็นทางการ (สำหรับองค์กรใหญ่)</option>
                <option value="expert">🎓 ผู้เชี่ยวชาญเฉพาะทาง (สำหรับที่ปรึกษา)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              คำสั่งระบบตั้งต้น (System Prompt / Context Instructions)
            </label>
            <textarea
              rows={3}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="ระบุคำสั่งและข้อมูลบริบทเพื่อให้ AI นำไปใช้อ้างอิงขณะตอบคำถาม..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-3 text-xs focus:ring-2 focus:ring-purple-500/30 focus:outline-none"
            />
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-xs font-bold shadow-md shadow-amber-500/20 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? "กำลังบันทึก..." : "บันทึกการตั้งค่าทั้งหมด"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
