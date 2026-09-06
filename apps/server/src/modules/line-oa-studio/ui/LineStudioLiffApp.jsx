// @req FR-146, FR-153 — LINE Studio Enterprise LIFF App Manager
// @spec SDD-060, SDD-061 — LIFF In-App Web Applications Hub
"use client";

import React, { useState } from "react";
import { MOCK_LIFF_APPS } from "./mockStudioData";
import {
  Globe,
  Plus,
  QrCode,
  ExternalLink,
  ShieldCheck,
  Check,
  X,
  Smartphone,
  Copy
} from "lucide-react";

export default function LineStudioLiffApp({ project }) {
  const [liffApps, setLiffApps] = useState(MOCK_LIFF_APPS);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedQrApp, setSelectedQrApp] = useState(null);

  // New LIFF state
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newViewType, setNewViewType] = useState("FULL");
  const [copiedId, setCopiedId] = useState(null);

  const handleCreateLiff = (e) => {
    e.preventDefault();
    if (!newName.trim() || !newUrl.trim()) return;

    const newApp = {
      id: `liff-${Date.now()}`,
      liffId: `1657892011-${Math.random().toString(36).substring(2, 9)}`,
      name: newName,
      url: newUrl,
      viewType: newViewType,
      scopes: ["profile", "openid"],
      qrEnabled: true,
      status: "ACTIVE",
      createdDate: "06 ก.ย. 2569"
    };

    setLiffApps([...liffApps, newApp]);
    setShowCreateModal(false);
    setNewName("");
    setNewUrl("");
  };

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6 pb-12 font-thai">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Globe className="w-5 h-5 text-cyan-500" />
            <span>LIFF Applications Hub (LINE Front-end Framework)</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            จัดการเว็บแอปพลิเคชันที่เปิดทำงานภายใน LINE สำหรับ {project?.name || "LINE Studio"}
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:opacity-90 text-white text-xs font-semibold transition-all shadow-md shadow-cyan-600/20 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>+ ลงทะเบียน LIFF App ใหม่</span>
        </button>
      </div>

      {/* Apps Table */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-slate-500 dark:text-slate-400 uppercase font-semibold">
              <th className="py-3 px-4">ชื่อ LIFF APP</th>
              <th className="py-3 px-4">LIFF ID / URL</th>
              <th className="py-3 px-4">ขนาดหน้าต่าง</th>
              <th className="py-3 px-4">สิทธิ์การเข้าถึง (SCOPES)</th>
              <th className="py-3 px-4">สถานะ</th>
              <th className="py-3 px-4 text-right">การกระทำ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {liffApps.map(app => (
              <tr key={app.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-850/60">
                <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
                      <Globe className="w-4 h-4" />
                    </div>
                    <div>
                      <div>{app.name}</div>
                      <div className="text-[10px] text-slate-400 font-normal">สร้างเมื่อ {app.createdDate}</div>
                    </div>
                  </div>
                </td>
                <td className="py-3.5 px-4 font-mono">
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-600 dark:text-cyan-400 font-semibold">{app.liffId}</span>
                    <button
                      onClick={() => handleCopy(`https://liff.line.me/${app.liffId}`, app.id)}
                      className="text-slate-400 hover:text-slate-600 p-1"
                      title="คัดลอก LIFF URL"
                    >
                      {copiedId === app.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="text-[10px] text-slate-400 line-clamp-1 max-w-xs font-sans">{app.url}</div>
                </td>
                <td className="py-3.5 px-4">
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono text-[10px]">
                    {app.viewType}
                  </span>
                </td>
                <td className="py-3.5 px-4">
                  <div className="flex flex-wrap gap-1">
                    {app.scopes.map(s => (
                      <span key={s} className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-mono">
                        {s}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-3.5 px-4">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold">
                    <ShieldCheck className="w-3 h-3" />
                    <span>{app.status}</span>
                  </span>
                </td>
                <td className="py-3.5 px-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setSelectedQrApp(app)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-colors"
                    >
                      <QrCode className="w-3.5 h-3.5 text-brand-amber" />
                      <span>QR Test</span>
                    </button>
                    <a
                      href={app.url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* QR Code Modal for Mobile Testing */}
      {selectedQrApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl text-center space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                สแกนทดสอบ LIFF App บนมือถือ
              </h3>
              <button onClick={() => setSelectedQrApp(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-white rounded-2xl border border-slate-200 inline-block shadow-inner">
              {/* Simulated QR Pattern */}
              <div className="w-44 h-44 bg-slate-950 p-2 rounded-xl flex flex-col items-center justify-center text-white text-center">
                <QrCode className="w-28 h-28 text-white mb-2" />
                <span className="text-[10px] font-mono text-slate-300">liff.line.me/{selectedQrApp.liffId}</span>
              </div>
            </div>

            <div className="text-xs text-slate-600 dark:text-slate-300">
              เปิดแอปพลิเคชัน LINE บนโทรศัพท์มือถือแล้วสแกน QR Code นี้เพื่อเปิดหน้าเว็บ <span className="font-bold">{selectedQrApp.name}</span>
            </div>

            <button
              onClick={() => setSelectedQrApp(null)}
              className="w-full py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold"
            >
              ปิด
            </button>
          </div>
        </div>
      )}

      {/* Create LIFF Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 font-thai space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                ลงทะเบียน LIFF App ใหม่
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateLiff} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  ชื่อ LIFF App
                </label>
                <input
                  type="text"
                  required
                  placeholder="เช่น ตรวจสอบสถานะสมาชิก"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Endpoint URL (เว็บเป้าหมาย)
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://yourdomain.com/liff-app"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  ขนาดหน้าต่าง (Size)
                </label>
                <select
                  value={newViewType}
                  onChange={(e) => setNewViewType(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                >
                  <option value="FULL">FULL (เต็มจอ 100%)</option>
                  <option value="TALL">TALL (สูง 75%)</option>
                  <option value="COMPACT">COMPACT (ครึ่งจอ 50%)</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-600"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold shadow-sm"
                >
                  สร้าง LIFF App
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
