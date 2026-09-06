// @req FR-146, FR-153 — LINE Studio Enterprise LIFF App Manager
// @spec SDD-060, SDD-061 — Live LIFF App Registry & Creation Hub
"use client";

import React, { useState, useEffect } from "react";
import {
  Globe,
  Plus,
  QrCode,
  ExternalLink,
  ShieldCheck,
  Check,
  X,
  Smartphone,
  Copy,
  RefreshCw,
  AlertTriangle
} from "lucide-react";

export default function LineStudioLiffApp({ project }) {
  const accountId = project?.id;

  const [liffApps, setLiffApps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedQrApp, setSelectedQrApp] = useState(null);

  // Form state
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newViewType, setNewViewType] = useState("FULL");
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const fetchLiffApps = async () => {
    if (!accountId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/line-oa/liff-apps?accountId=${encodeURIComponent(accountId)}`);
      const data = await res.json();
      if (res.ok && data.liffApps) {
        setLiffApps(data.liffApps);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLiffApps();
  }, [accountId]);

  const handleCreateLiff = async (e) => {
    e.preventDefault();
    if (!newName.trim() || !newUrl.trim() || !accountId) return;

    setCreating(true);
    setError("");
    try {
      const payload = {
        lineOaAccountId: accountId,
        code: newCode || `liff-${Date.now()}`,
        name: newName,
        endpointUrl: newUrl,
        viewSize: newViewType,
        scopesJson: JSON.stringify(["profile", "openid"])
      };
      const res = await fetch("/api/line-oa/liff-apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.issues?.join(" · ") || data.error || "Failed to create LIFF app");

      setShowCreateModal(false);
      setNewName("");
      setNewCode("");
      setNewUrl("");
      await fetchLiffApps();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = (text, id) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6 pb-12 font-thai">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Globe className="w-6 h-6 text-brand-amber" />
            <span>LIFF Applications ({liffApps.length})</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            จัดการเว็บแอปพลิเคชันที่เปิดใช้งานภายใน LINE Chat สำหรับบัญชี {project?.name || "LINE Studio"}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchLiffApps}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 text-slate-600 transition-colors"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-amber to-brand-hover hover:opacity-90 text-white text-xs font-semibold transition-all shadow-md shadow-brand-amber/20 flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>ลงทะเบียน LIFF App ใหม่</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 text-rose-700 text-xs border border-rose-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Grid of LIFF Apps */}
      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
          กำลังโหลด LIFF Apps...
        </div>
      ) : liffApps.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
          <Globe className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">ยังไม่มี LIFF App ที่ลงทะเบียนสำหรับบัญชีนี้</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            สร้าง LIFF App เพื่อเปิดหน้าเว็บแบบ Seamless In-App Webview เช่น หน้าจองคิว, สะสมแต้ม หรือแคตตาล็อกสินค้า
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-xl bg-brand-amber text-white text-xs font-semibold hover:bg-brand-hover transition-all"
          >
            ลงทะเบียน LIFF App แรก
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {liffApps.map((app) => (
            <div
              key={app.id}
              className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 shadow-sm space-y-4 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-cyan-500/15 text-cyan-600 flex items-center justify-center font-bold">
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white">{app.name}</h3>
                      <span className="text-[10px] font-mono text-slate-400">{app.code}</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    {app.status || "ACTIVE"}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-100 dark:border-slate-800 space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">View Size:</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300 font-mono">{app.viewSize || "FULL"}</span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-slate-500 block text-[11px]">Endpoint URL:</span>
                    <a
                      href={app.endpointUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-dark dark:text-brand-amber font-mono text-[11px] truncate block hover:underline"
                    >
                      {app.endpointUrl}
                    </a>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between border-t border-slate-100 dark:border-slate-800">
                <span className="text-[10px] text-slate-400">
                  {new Date(app.createdAt).toLocaleDateString("th-TH")}
                </span>
                <a
                  href={app.endpointUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-brand-dark flex items-center gap-1"
                >
                  <span>เปิดเว็บ</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Register LIFF Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-brand-amber" />
                <span>ลงทะเบียน LIFF App ใหม่</span>
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateLiff} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">ชื่อ LIFF App</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="เช่น หน้าเช็คแต้มสะสม Member"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs focus:ring-2 focus:ring-brand-amber/30 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">รหัสอ้างอิง (Code)</label>
                <input
                  type="text"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="เช่น member-points-portal"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs focus:ring-2 focus:ring-brand-amber/30 focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Endpoint URL (HTTPS)</label>
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://yourdomain.com/liff-app"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs focus:ring-2 focus:ring-brand-amber/30 focus:outline-none font-mono"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">ขนาดหน้าต่าง (View Size)</label>
                <select
                  value={newViewType}
                  onChange={(e) => setNewViewType(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs"
                >
                  <option value="FULL">FULL (เต็มจอ 100%)</option>
                  <option value="TALL">TALL (สูง 75%)</option>
                  <option value="COMPACT">COMPACT (กึ่งกลาง 50%)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 rounded-xl bg-brand-amber hover:bg-brand-hover text-white text-xs font-semibold shadow-sm"
                >
                  {creating ? "กำลังลงทะเบียน..." : "ลงทะเบียน LIFF"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
