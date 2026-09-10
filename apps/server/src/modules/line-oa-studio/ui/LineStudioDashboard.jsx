// @req FR-146, FR-151 — LINE Studio Enterprise Dashboard
// @spec SDD-060, SDD-061 — Live Multi-account analytics & project directory
// @tested tests/unit/line-studio-dashboard-render.test.js
"use client";

import React, { useState, useEffect, useRef } from "react";
import { useScope } from "@/context/ScopeContext";
import {
  Users,
  Radio,
  Search,
  ArrowRight,
  Sparkles,
  Activity,
  Bot,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  Cpu
} from "lucide-react";

export default function LineStudioDashboard({ onSelectProject, onNavigate }) {
  const scope = useScope();
  const business = scope?.shell?.activeBusiness;

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const requestVersion = useRef(0);

  const fetchData = async () => {
    const requestId = ++requestVersion.current;
    if (!business?.id) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    setAccounts([]);
    setLoading(true);
    try {
      const response = await fetch(`/api/line-oa/accounts?businessId=${encodeURIComponent(business.id)}`);
      const accRes = await response.json();
      if (!response.ok) throw new Error(accRes.error || "โหลดบัญชี LINE OA ไม่สำเร็จ");
      if (requestId !== requestVersion.current) return;
      setAccounts(accRes.accounts || []);
    } catch (e) {
      if (requestId !== requestVersion.current) return;
      console.error(e);
      setAccounts([]);
    } finally {
      if (requestId === requestVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [business?.id]);

  const [activatingId, setActivatingId] = useState(null);
  const [actionError, setActionError] = useState("");

  const handleActivateServer = async (item, e) => {
    e?.stopPropagation?.();
    if (!window.confirm("ยืนยันว่า transport LINE เดิมหยุดรับ webhook แล้ว และให้ Zuri Server เป็นเจ้าของการส่ง?")) return;
    setActivatingId(item.id);
    setActionError("");
    try {
      const res = await fetch(`/api/line-oa/accounts/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ENABLE_SERVER",
          legacyQuiesced: true,
          version: item.version || 1
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.issues?.join(" · ") || "ไม่สามารถเปิด Server ได้");
      await fetchData();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActivatingId(null);
    }
  };

  // Combined Directory of Projects & LINE Accounts
  const combinedDirectory = [
    ...accounts.map(acc => ({
      id: acc.id,
      version: acc.version,
      serverEnabled: acc.serverEnabled,
      name: acc.displayName || acc.code || "LINE OA",
      slug: acc.basicId || acc.code || "—",
      status: acc.effectiveStatus || acc.status || "UNKNOWN",
      statusLabel: acc.effectiveStatus || acc.status || "สถานะไม่ทราบ",
      category: "line-oa",
      icon: "💬",
      transport: acc.serverEnabled ? "Zuri Server" : "Edge Worker",
    }))
  ];

  const filteredDirectory = combinedDirectory.filter(p => {
    const matchQuery = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                       p.slug.toLowerCase().includes(searchQuery.toLowerCase());
    return matchQuery;
  });

  return (
    <div className="space-y-6 pb-12 font-thai">
      {actionError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{actionError}</div>}

      {/* Top Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500/10 via-brand-surface/40 to-emerald-500/10 border border-brand-amber/20 p-6 backdrop-blur-md">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-brand-amber/15 text-brand-dark dark:text-brand-amber text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>LINE Studio Enterprise · Live System</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              ศูนย์บัญชาการ LINE OA & Design Studio
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 max-w-2xl">
              จัดการระบบสนทนาอัตโนมัติ (Flow Designer), ออกแบบ Flex Messages, Rich Menus, LIFF Apps และเปิดใช้งาน Server Transport
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => onNavigate("projects")}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-amber to-brand-hover hover:opacity-90 text-white text-xs font-semibold transition-all shadow-md shadow-brand-amber/20 flex items-center gap-2"
            >
              <span>จัดการบัญชี & กลุ่มทั้งหมด</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => onNavigate("edge-connection")}
              className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-900 hover:bg-slate-100 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-all flex items-center gap-2"
            >
              <span>⚙️ ตั้งค่า Server & Edge</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI 4 Cards Grid - Live Data */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Total Accounts */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">บัญชี LINE OA ทั้งหมด</span>
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Radio className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white font-mono">
              {accounts.length}
            </span>
            <span className="text-xs text-slate-500">บัญชีที่ผูก</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{accounts.filter(a => a.serverEnabled).length} บัญชีเปิด Server แล้ว</span>
          </div>
        </div>

        {/* Metric 2: Total Groups */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">กลุ่มแชท LINE ในระบบ</span>
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white font-mono">
              —
            </span>
            <span className="text-xs text-slate-500">กลุ่ม</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400">
            <Activity className="w-3.5 h-3.5" />
            <span>ยังไม่มีข้อมูลจำนวนกลุ่ม</span>
          </div>
        </div>

        {/* Metric 3: Active Studio Tools */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">เครื่องมือใน Studio</span>
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Bot className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white font-mono">
              4
            </span>
            <span className="text-xs text-slate-500">Sub-Studios</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Flow · Flex · Rich Menu · LIFF</span>
          </div>
        </div>

        {/* Metric 4: Edge Device Runtime */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">สถานะ Edge Device</span>
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Cpu className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              UNKNOWN
            </span>
            <span className="text-xs text-slate-500">ยังไม่มี telemetry จาก Edge Device</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>สถานะจะอัปเดตเมื่อมี heartbeat</span>
          </div>
        </div>
      </div>

      {/* Directory Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              สารบัญบัญชี & กลุ่ม LINE OA
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-mono font-semibold">
              {combinedDirectory.length}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาชื่อ, รหัส, หรือ Group ID..."
                className="pl-9 pr-3.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/30 w-52"
              />
            </div>
            <button
              onClick={fetchData}
              className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 text-slate-600 transition-colors"
              title="รีเฟรชข้อมูล"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-xs text-slate-400 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
            กำลังโหลดข้อมูลจากฐานข้อมูล...
          </div>
        ) : combinedDirectory.length === 0 ? (
          <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
            <Radio className="w-8 h-8 text-slate-400 mx-auto" />
            <h3 className="font-bold text-slate-900 dark:text-white text-sm">ยังไม่มีบัญชี LINE OA หรือกลุ่มแชทใน Business นี้</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              เริ่มต้นโดยการเชื่อมต่อบัญชี LINE OA ใหม่ในแท็บ Edge & การเชื่อมต่อ หรือลงทะเบียนกลุ่มแชท
            </p>
            <button
              onClick={() => onNavigate("edge-connection")}
              className="px-4 py-2 rounded-xl bg-brand-amber text-white text-xs font-semibold hover:bg-brand-hover transition-all"
            >
              เชื่อมบัญชี LINE OA
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDirectory.map((item) => (
              <div
                key={item.id}
                onClick={() => onSelectProject?.(item)}
                className="group cursor-pointer rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-brand-amber/50 dark:hover:border-brand-amber/50 p-5 shadow-sm hover:shadow-md transition-all space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-brand-amber/15 to-amber-500/20 text-brand-dark flex items-center justify-center text-lg shadow-2xs">
                      {item.icon}
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-brand-dark dark:group-hover:text-brand-amber transition-colors">
                        {item.name}
                      </h3>
                      <span className="text-[11px] font-mono text-slate-400">{item.slug}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {item.category === "line-oa" && !item.serverEnabled && (
                      <button
                        onClick={(e) => handleActivateServer(item, e)}
                        disabled={activatingId === item.id}
                        className="px-2.5 py-1 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-95 text-white text-[10px] font-bold shadow-sm shadow-emerald-600/20 flex items-center gap-1 transition-all"
                        title="เปิดใช้งาน Server Transport ทันที"
                      >
                        <span>{activatingId === item.id ? "กำลังเปิด..." : "⚡ เปิด Server ทันที"}</span>
                      </button>
                    )}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      item.status === "CONNECTED" || item.status === "LIVE" || item.status === "ACTIVE"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                    }`}>
                      {item.statusLabel}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                  <span>Transport: <strong className="text-slate-700 dark:text-slate-300">{item.transport}</strong></span>
                  <span className="text-brand-dark dark:text-brand-amber font-semibold group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
                    <span>เปิด Studio</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
