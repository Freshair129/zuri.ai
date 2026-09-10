// @req FR-146, FR-151, FR-080 — LINE Studio Enterprise Accounts & Groups Directory
// @spec SDD-060, SDD-061 — Live LINE OA & Group Directory
"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useScope } from "@/context/ScopeContext";
import { api } from "@/modules/project-manager/components/useApi";
import { Card, Field, SectionTitle } from "@/components/ui";
import {
  Search,
  Layers,
  ChevronRight,
  Radio,
  RefreshCw,
  Copy,
  Users,
  MessageSquare,
  Check,
  Plus
} from "lucide-react";

const DEPARTMENT_LABELS = {
  SALES_TEAM: "ฝ่ายขาย",
  EXECUTIVE: "ผู้บริหาร",
  OPERATIONS: "ปฏิบัติการ",
  SUPPORT: "สนับสนุน",
  GENERAL: "ทั่วไป",
};

export default function LineStudioProjects({ onSelectProject }) {
  const router = useRouter();
  const scope = useScope();
  const business = scope?.shell?.activeBusiness;

  const [accounts, setAccounts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTabType, setActiveTabType] = useState("all"); // 'all' | 'line-oa' | 'groups' | 'users'
  const [copiedId, setCopiedId] = useState(null);
  const [registryTab, setRegistryTab] = useState("GROUPS");
  const [registryBusy, setRegistryBusy] = useState(false);
  const [registryMessage, setRegistryMessage] = useState("");
  const [registryError, setRegistryError] = useState("");
  const [groupForm, setGroupForm] = useState({ name: "", groupId: "", groupUrl: "", departmentType: "GENERAL" });
  const [userForm, setUserForm] = useState({ displayName: "", userId: "", role: "MEMBER", department: "" });
  const requestVersion = useRef(0);

  const fetchData = async () => {
    const requestId = ++requestVersion.current;
    if (!business?.id) {
      setAccounts([]);
      setGroups([]);
      setUsers([]);
      setLoadError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const [accRes, registryRes] = await Promise.all([
        fetch(`/api/line-oa/accounts?businessId=${encodeURIComponent(business.id)}`).then(async response => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "โหลดบัญชี LINE OA ไม่สำเร็จ");
          return data;
        }),
        fetch(`/api/platform/integrations/line-registry?businessId=${encodeURIComponent(business.id)}`).then(async response => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "โหลดทะเบียนกลุ่ม LINE ไม่สำเร็จ");
          return data;
        })
      ]);

      if (requestId !== requestVersion.current) return;

      setAccounts(accRes.accounts || []);

      const registry = Array.isArray(registryRes) ? registryRes : [];
      setGroups(registry.filter(r => r.kind === "GROUP"));
      setUsers(registry.filter(r => r.kind === "USER"));
    } catch (e) {
      if (requestId !== requestVersion.current) return;
      console.error(e);
      setAccounts([]);
      setGroups([]);
      setUsers([]);
      setLoadError(e.message || "โหลดข้อมูล LINE OA ไม่สำเร็จ");
    } finally {
      if (requestId === requestVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [business?.id]);

  const submitRegistry = async (event) => {
    event.preventDefault();
    if (!business?.id) return;
    setRegistryBusy(true);
    setRegistryMessage("");
    setRegistryError("");
    const isGroup = registryTab === "GROUPS";
    const body = isGroup
      ? {
          businessId: business.id,
          name: groupForm.name.trim(),
          groupId: groupForm.groupId.trim(),
          groupUrl: groupForm.groupUrl.trim() || undefined,
          departmentType: groupForm.departmentType,
        }
      : {
          businessId: business.id,
          displayName: userForm.displayName.trim(),
          userId: userForm.userId.trim(),
          role: userForm.role.trim(),
          department: userForm.department.trim() || undefined,
        };

    try {
      await api("/api/platform/integrations/line-registry", { method: "POST", body });
      setRegistryMessage(isGroup ? "บันทึก LINE Group แล้ว" : "บันทึก LINE User แล้ว");
      if (isGroup) {
        setGroupForm({ name: "", groupId: "", groupUrl: "", departmentType: "GENERAL" });
      } else {
        setUserForm({ displayName: "", userId: "", role: "MEMBER", department: "" });
      }
      await fetchData();
    } catch (caught) {
      setRegistryError(caught?.message || "บันทึกทะเบียน LINE ไม่สำเร็จ");
    } finally {
      setRegistryBusy(false);
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const combinedItems = [
    ...accounts.map(acc => ({
      id: acc.id,
      name: acc.displayName || acc.code,
      code: acc.basicId || acc.code,
      type: "line-oa",
      typeLabel: "บัญชี LINE OA",
      serverEnabled: acc.serverEnabled,
      status: acc.effectiveStatus || acc.status || "UNKNOWN",
      transport: acc.serverEnabled ? "Zuri Server" : acc.transportMode === "EDGE" ? "Edge worker" : "Server not enabled",
      updatedAt: acc.updatedAt || acc.createdAt,
      raw: acc
    })),
    ...groups.map(grp => ({
      id: grp.id,
      name: grp.name || grp.externalAccountId || "LINE Group",
      code: grp.externalAccountId || grp.code || "—",
      type: "group",
      typeLabel: "กลุ่ม LINE Group",
      department: grp.metadata?.departmentType || "ทั่วไป",
      status: grp.status || "UNKNOWN",
      transport: grp.metadata?.transport || "Business registry",
      groupUrl: grp.metadata?.groupUrl,
      updatedAt: grp.updatedAt || null,
      raw: grp
    })),
    ...users.map(user => ({
      id: user.id,
      name: user.name || user.displayName || user.externalAccountId || "LINE User",
      code: user.externalAccountId || user.code || "—",
      type: "user",
      typeLabel: "ผู้ติดต่อ LINE",
      department: user.metadata?.department || "ทั่วไป",
      role: user.metadata?.role || "สมาชิก",
      status: user.status || "UNKNOWN",
      transport: user.metadata?.transport || "Business registry",
      updatedAt: user.updatedAt || null,
      raw: user
    }))
  ];

  const filteredItems = combinedItems.filter(item => {
    const matchQuery = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                       item.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchType = activeTabType === "all" ||
                      (activeTabType === "line-oa" && item.type === "line-oa") ||
                      (activeTabType === "groups" && item.type === "group") ||
                      (activeTabType === "users" && item.type === "user");
    return matchQuery && matchType;
  });

  return (
    <div className="space-y-6 pb-12 font-thai">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <span>สารบัญบัญชี & กลุ่ม LINE OA</span>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-amber/15 text-brand-dark dark:text-brand-amber text-xs font-semibold">
              {combinedItems.length} รายการ
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            เลือกบัญชี LINE OA หรือกลุ่มห้องแชทเพื่อจัดการข้อความ, ออกแบบ Flow, หรือเข้าสู่ Design Studio
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
            onClick={() => {
              setRegistryTab("GROUPS");
              document.getElementById("line-registry")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="px-3.5 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-xs font-semibold transition-all shadow-sm flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4 text-purple-400" />
            <span>ลงทะเบียน Group / User</span>
          </button>
          <button
            onClick={() => router.push("/line-oa/edge-connection")}
            className="px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-95 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center gap-1.5"
          >
            <span>💬 + เชื่อมต่อ LINE OA</span>
          </button>
        </div>
      </div>

      <Card id="line-registry">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionTitle caption={business ? `ข้อมูลนี้ผูกกับ Business: ${business.name || business.code || business.id}` : "เลือก Business ก่อนบันทึกทะเบียน LINE"}>
            Business LINE registry
          </SectionTitle>
          <div className="flex gap-2" role="tablist" aria-label="LINE registry type">
            <button
              type="button"
              role="tab"
              aria-selected={registryTab === "GROUPS"}
              className={`btn text-xs ${registryTab === "GROUPS" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => { setRegistryTab("GROUPS"); setRegistryMessage(""); setRegistryError(""); }}
            >
              <Users size={14} /> Groups ({groups.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={registryTab === "USERS"}
              className={`btn text-xs ${registryTab === "USERS" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => { setRegistryTab("USERS"); setRegistryMessage(""); setRegistryError(""); }}
            >
              <MessageSquare size={14} /> Users ({users.length})
            </button>
          </div>
        </div>

        <form onSubmit={submitRegistry} className="grid gap-3 md:grid-cols-2">
          {registryTab === "GROUPS" ? (
            <>
              <Field label="ชื่อกลุ่ม (Group Name)">
                <input
                  className="input"
                  value={groupForm.name}
                  onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="เช่น ทีมขายองค์กร"
                  required
                />
              </Field>
              <Field label="LINE Group ID" hint="ต้องเป็น ID จาก LINE Webhook/provider และขึ้นต้นด้วย C">
                <input
                  className="input font-mono"
                  value={groupForm.groupId}
                  onChange={(event) => setGroupForm((current) => ({ ...current, groupId: event.target.value }))}
                  placeholder="C..."
                  required
                />
              </Field>
              <Field label="ประเภทกลุ่ม / แผนก">
                <select
                  className="input"
                  value={groupForm.departmentType}
                  onChange={(event) => setGroupForm((current) => ({ ...current, departmentType: event.target.value }))}
                >
                  {Object.entries(DEPARTMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="ลิงก์กลุ่ม (ไม่บังคับ)">
                <input
                  className="input"
                  type="url"
                  value={groupForm.groupUrl}
                  onChange={(event) => setGroupForm((current) => ({ ...current, groupUrl: event.target.value }))}
                  placeholder="https://line.me/R/ti/g/..."
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="ชื่อผู้ใช้ / ผู้ติดต่อ">
                <input
                  className="input"
                  value={userForm.displayName}
                  onChange={(event) => setUserForm((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder="เช่น สมชาย ฝ่ายขาย"
                  required
                />
              </Field>
              <Field label="LINE User ID" hint="ต้องเป็น ID จาก LINE Webhook/provider และขึ้นต้นด้วย U">
                <input
                  className="input font-mono"
                  value={userForm.userId}
                  onChange={(event) => setUserForm((current) => ({ ...current, userId: event.target.value }))}
                  placeholder="U..."
                  required
                />
              </Field>
              <Field label="บทบาท">
                <input
                  className="input"
                  value={userForm.role}
                  onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}
                  placeholder="เช่น Sales Manager"
                  required
                />
              </Field>
              <Field label="แผนก (ไม่บังคับ)">
                <input
                  className="input"
                  value={userForm.department}
                  onChange={(event) => setUserForm((current) => ({ ...current, department: event.target.value }))}
                  placeholder="เช่น ฝ่ายขาย"
                />
              </Field>
            </>
          )}
          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={registryBusy || !business?.id}>
              <Plus size={14} /> {registryBusy ? "กำลังบันทึก…" : `บันทึกใน ${business?.name || "Business"}`}
            </button>
            <span className="text-[11px] text-muted">ใช้ registry API เดิมและคง Business ownership/LINE ID ที่ provider ออกให้</span>
          </div>
        </form>
        {registryMessage && <p className="mt-2 text-xs text-[var(--success)]" role="status">{registryMessage}</p>}
        {registryError && <p className="mt-2 text-xs text-[var(--danger)]" role="alert">{registryError}</p>}
      </Card>

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
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>LINE OA ({accounts.length})</span>
          </button>
          <button
            onClick={() => setActiveTabType("groups")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTabType === "groups"
                ? "bg-purple-600 text-white shadow-xs"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>กลุ่มแชท / Group ID ({groups.length})</span>
          </button>
          <button
            onClick={() => setActiveTabType("users")}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTabType === "users"
                ? "bg-sky-600 text-white shadow-xs"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>ผู้ติดต่อ ({users.length})</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาชื่อ, รหัส, หรือ Group ID (C...)..."
            className="w-full sm:w-72 pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/30"
          />
        </div>
      </div>

      {/* Items Grid */}
      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
          กำลังโหลดข้อมูล...
        </div>
      ) : loadError ? (
        <div role="alert" className="p-12 text-center rounded-2xl bg-rose-50 text-rose-700 border border-rose-200 space-y-2">
          <h3 className="font-bold text-sm">โหลดข้อมูลไม่สำเร็จ</h3>
          <p className="text-xs">{loadError}</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
          <Layers className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">ไม่พบรายการที่ตรงกับการค้นหา</h3>
          <p className="text-xs text-slate-500">
            ลองปรับเปลี่ยนคำค้นหา หรือเชื่อมต่อบัญชี/ลงทะเบียนกลุ่มใหม่
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => {
            const isGroup = item.type === "group";
            const isUser = item.type === "user";
            const isAccount = item.type === "line-oa";

            return (
              <div
                key={item.id}
                onClick={() => isAccount && onSelectProject?.(item)}
                className={`group rounded-2xl bg-white dark:bg-slate-900 border transition-all p-5 shadow-sm hover:shadow-md space-y-3.5 flex flex-col justify-between ${
                  isAccount
                    ? "border-slate-200/80 dark:border-slate-800 hover:border-brand-amber/50 cursor-pointer"
                    : isGroup
                      ? "border-purple-200/80 dark:border-purple-950/60 hover:border-purple-400"
                      : "border-sky-200/80 dark:border-sky-950/60 hover:border-sky-400"
                }`}
              >
                <div className="space-y-3">
                  {/* Top Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-lg ${
                        isGroup
                          ? "bg-purple-500/15 text-purple-600"
                          : isUser
                            ? "bg-sky-500/15 text-sky-600"
                            : "bg-emerald-500/15 text-emerald-600"
                      }`}>
                        {isGroup ? "👥" : isUser ? "👤" : "💬"}
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                          {item.name}
                        </h3>
                        <div className="flex items-center gap-1 mt-0.5">
                          <code className="text-[10px] font-mono text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded truncate max-w-[170px]" title={item.code}>
                            {item.code}
                          </code>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(item.code, item.id);
                            }}
                            className="text-slate-400 hover:text-slate-600 p-0.5"
                            title="คัดลอก ID"
                          >
                            {copiedId === item.id ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isGroup
                          ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      }`}>
                        {item.typeLabel}
                      </span>
                      {(isGroup || isUser) && item.department && (
                        <span className="text-[9px] text-slate-400 font-semibold">
                          {item.department}{isUser && item.role ? ` · ${item.role}` : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Metadata block */}
                  <div className="text-xs text-slate-500 space-y-1.5 pt-1">
                    <div className="flex justify-between items-center">
                      <span>สถานะการเชื่อมต่อ:</span>
                      <span className={`font-semibold text-[11px] px-2 py-0.5 rounded-md flex items-center gap-1 ${
                        item.status === "LIVE" || item.status === "ACTIVE" || item.status === "CONNECTED"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold"
                          : "bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold"
                      }`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        {item.status}
                      </span>
                    </div>

                    {isGroup && (
                      <div className="flex justify-between items-center text-[11px]">
                        <span>LINE Group ID:</span>
                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200 truncate max-w-[140px]">{item.code}</span>
                      </div>
                    )}

                    {isUser && (
                      <div className="flex justify-between items-center text-[11px]">
                        <span>LINE User ID:</span>
                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200 truncate max-w-[140px]">{item.code}</span>
                      </div>
                    )}

                    <div className="flex justify-between items-center text-[11px]">
                      <span>Transport Hub:</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{item.transport}</span>
                    </div>
                  </div>
                </div>

                {/* Bottom Action Footer */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                  {isGroup ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push("/line-oa/live-crm");
                        }}
                        className="p-1.5 px-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 text-slate-600 text-xs font-semibold flex items-center gap-1 transition-colors"
                        title="เปิดใน Live CRM"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
                        <span>แชทสด</span>
                      </button>

                    </div>
                  ) : isUser ? (
                    <div className="text-[11px] text-slate-500">ทะเบียนผู้ติดต่อของ Business นี้</div>
                  ) : (
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>อัปเดต: {new Date(item.updatedAt).toLocaleDateString("th-TH")}</span>
                      <span className="text-brand-dark dark:text-brand-amber font-semibold group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
                        <span>เปิด Design Studio</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
