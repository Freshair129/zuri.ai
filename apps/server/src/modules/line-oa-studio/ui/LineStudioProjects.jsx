// @req FR-146, FR-151, FR-003 — LINE Studio Enterprise Projects Directory
// @spec SDD-060, SDD-061 — Live LINE OA & Project Directory with API Create
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useScope } from "@/context/ScopeContext";
import {
  Plus,
  Search,
  Filter,
  Layers,
  ArrowRight,
  Bot,
  ExternalLink,
  ChevronRight,
  SlidersHorizontal,
  X,
  Sparkles,
  CheckCircle,
  Radio,
  RefreshCw
} from "lucide-react";

export default function LineStudioProjects({ onSelectProject }) {
  const router = useRouter();
  const scope = useScope();
  const business = scope?.shell?.activeBusiness;

  const [projects, setProjects] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTabType, setActiveTabType] = useState("all"); // 'all' | 'line-oa' | 'projects'
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New project form state
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectCode, setNewProjectCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const fetchData = async () => {
    if (!business?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [projRes, accRes] = await Promise.all([
        fetch(`/api/projects?businessId=${encodeURIComponent(business.id)}`).then(r => r.json()).catch(() => ({ projects: [] })),
        fetch(`/api/line-oa/accounts?businessId=${encodeURIComponent(business.id)}`).then(r => r.json()).catch(() => ({ accounts: [] }))
      ]);

      setProjects(projRes.projects || []);
      setAccounts(accRes.accounts || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [business?.id]);

  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!newProjectName.trim() || !business?.id) return;

    setCreating(true);
    setCreateError("");
    try {
      const payload = {
        name: newProjectName,
        code: newProjectCode || newProjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        businessId: business.id
      };
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.issues?.join(" · ") || "Failed to create project");

      setShowCreateModal(false);
      setNewProjectName("");
    } finally {
      setCreating(false);
    }
  };

  const [activatingId, setActivatingId] = useState(null);

  const handleActivateServer = async (item, e) => {
    e?.stopPropagation?.();
    setActivatingId(item.id);
    try {
      const res = await fetch(`/api/line-oa/accounts/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ENABLE_SERVER",
          legacyQuiesced: true,
          version: item.raw?.version || 1
        })
      });
      if (res.ok) await fetchData();
    } catch (err) {
      console.error(err);
    } finally {
      setActivatingId(null);
    }
  };

  const combinedItems = [
    ...accounts.map(acc => ({
      id: acc.id,
      name: acc.displayName || acc.code,
      code: acc.basicId || acc.code,
      type: "line-oa",
      typeLabel: "LINE OA Account",
      serverEnabled: acc.serverEnabled,
      status: (acc.serverEnabled || acc.status === "CONNECTED") ? "LIVE" : "DRAFT",
      transport: acc.serverEnabled ? "Zuri Server" : "Edge Worker",
      updatedAt: acc.updatedAt || acc.createdAt,
      raw: acc
    })),
    ...projects.map(proj => ({
      id: proj.id,
      name: proj.name,
      code: proj.code,
      type: "project",
      typeLabel: "Business Project",
      status: proj.status || "ACTIVE",
      transport: "Universal Core",
      updatedAt: proj.updatedAt || proj.createdAt,
      raw: proj
    }))
  ];

  const filteredItems = combinedItems.filter(item => {
    const matchQuery = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                       item.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchType = activeTabType === "all" || item.type === activeTabType;
    return matchQuery && matchType;
  });

  return (
    <div className="space-y-6 pb-12 font-thai">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <span>สารบัญบัญชี LINE OA และโปรเจค</span>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-amber/15 text-brand-dark dark:text-brand-amber text-xs font-semibold">
              {combinedItems.length} รายการ
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            เลือกโปรเจคเพื่อเข้าสู่ Design Studio (Flow Designer, Flex Message, Rich Menu, LIFF App)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={fetchData}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 text-slate-600 transition-colors"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => router.push("/line-oa/edge-connection")}
            className="px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-95 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center gap-1.5"
          >
            <span>💬 + เชื่อมต่อ LINE OA</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-amber to-brand-hover hover:opacity-90 text-white text-xs font-semibold transition-all shadow-md shadow-brand-amber/20 flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>สร้างโปรเจคใหม่</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
        {/* Type Filter Tabs */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTabType("all")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTabType === "all"
                ? "bg-slate-900 text-white dark:bg-slate-700"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            ทั้งหมด ({combinedItems.length})
          </button>
          <button
            onClick={() => setActiveTabType("line-oa")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTabType === "line-oa"
                ? "bg-brand-amber text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>LINE OA ({accounts.length})</span>
          </button>
          <button
            onClick={() => setActiveTabType("projects")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTabType === "projects"
                ? "bg-purple-600 text-white"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>โปรเจค ({projects.length})</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาตามชื่อหรือรหัส..."
            className="w-full sm:w-64 pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/30"
          />
        </div>
      </div>

      {/* Items Grid */}
      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
          กำลังโหลดข้อมูล...
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
          <Layers className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">ไม่พบรายการที่ตรงกับการค้นหา</h3>
          <p className="text-xs text-slate-500">
            ลองปรับเปลี่ยนคำค้นหา หรือสร้างโปรเจคใหม่
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              onClick={() => onSelectProject?.(item)}
              className="group cursor-pointer rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-brand-amber/50 dark:hover:border-brand-amber/50 p-5 shadow-sm hover:shadow-md transition-all space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-base ${
                      item.type === "line-oa" ? "bg-emerald-500/15 text-emerald-600" : "bg-purple-500/15 text-purple-600"
                    }`}>
                      {item.type === "line-oa" ? "💬" : "📁"}
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-brand-dark dark:group-hover:text-brand-amber transition-colors">
                        {item.name}
                      </h3>
                      <span className="text-[11px] font-mono text-slate-400">{item.code}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {item.type === "line-oa" && !item.serverEnabled && (
                      <button
                        onClick={(e) => handleActivateServer(item, e)}
                        disabled={activatingId === item.id}
                        className="px-2.5 py-1 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-95 text-white text-[10px] font-bold shadow-sm shadow-emerald-600/20 flex items-center gap-1 transition-all"
                      >
                        <span>{activatingId === item.id ? "กำลังเปิด..." : "⚡ เปิด Server"}</span>
                      </button>
                    )}
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      {item.typeLabel}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-slate-500 space-y-1">
                  <div className="flex justify-between items-center">
                    <span>สถานะ:</span>
                    <span className={`font-semibold text-[11px] px-1.5 py-0.5 rounded ${
                      item.status === "LIVE" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold" : "text-amber-600 dark:text-amber-400 font-bold"
                    }`}>{item.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Engine / Transport:</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{item.transport}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span>อัปเดต: {new Date(item.updatedAt).toLocaleDateString("th-TH")}</span>
                <span className="text-brand-dark dark:text-brand-amber font-semibold group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
                  <span>เปิด Design Studio</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-brand-amber" />
                <span>สร้างโปรเจคใหม่ใน Business</span>
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createError && (
              <div className="p-3 rounded-xl bg-rose-50 text-rose-700 text-xs border border-rose-200">
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateProject} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">ชื่อโปรเจค</label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="เช่น ระบบตอบรับและจองคิวอัตโนมัติ"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs focus:ring-2 focus:ring-brand-amber/30 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">รหัสโปรเจค (Code)</label>
                <input
                  type="text"
                  value={newProjectCode}
                  onChange={(e) => setNewProjectCode(e.target.value)}
                  placeholder="เช่น queue-booking-bot"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs focus:ring-2 focus:ring-brand-amber/30 focus:outline-none font-mono"
                />
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
                  {creating ? "กำลังสร้าง..." : "สร้างโปรเจค"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
