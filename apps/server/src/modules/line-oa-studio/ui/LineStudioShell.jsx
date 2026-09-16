// @req FR-146, FR-151, FR-152, FR-153 — LINE Studio Enterprise Shell
// @spec SDD-060, SDD-061 — Unified Tab Navigation & Multi-View Workspace
"use client";

import React, { useState, useEffect, useRef } from "react";
import LineStudioDashboard from "./LineStudioDashboard";
import LineStudioProjects from "./LineStudioProjects";
import LineStudioDesignHub from "./LineStudioDesignHub";
import LineStudioLiveCrm from "./LineStudioLiveCrm";
import LineStudioEdgeConnection from "./LineStudioEdgeConnection";
import LineStudioJobFailures from "./LineStudioJobFailures";
import LineStudioTemplates from "./LineStudioTemplates";
import LineStudioTeam from "./LineStudioTeam";
import LineStudioSettings from "./LineStudioSettings";
import { useScope } from "@/context/ScopeContext";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Search
} from "lucide-react";

export default function LineStudioShell({ initialTab = "dashboard" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scope = useScope();
  const business = scope?.shell?.activeBusiness;
  const requestedAccountId = searchParams.get("accountId") || "";

  const [activeTab, setActiveTab] = useState(initialTab);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [accountsList, setAccountsList] = useState([]);
  const [accountLoadError, setAccountLoadError] = useState("");
  const accountRequestVersion = useRef(0);

  useEffect(() => {
    const requestId = ++accountRequestVersion.current;
    if (!business?.id) {
      setAccountsList([]);
      setSelectedAccount(null);
      setAccountLoadError("");
      return;
    }
    setSelectedAccount(null);
    setAccountLoadError("");
    fetch(`/api/line-oa/accounts?businessId=${encodeURIComponent(business.id)}`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "โหลดบัญชี LINE OA ไม่สำเร็จ");
        return data;
      })
      .then(data => {
        if (requestId !== accountRequestVersion.current) return;
        const accounts = data.accounts || [];
        setAccountsList(accounts);
        setSelectedAccount(previous => accounts.find(account => account.id === requestedAccountId)
          || accounts.find(account => account.id === previous?.id)
          || accounts[0]
          || null);
      })
      .catch((error) => {
        if (requestId !== accountRequestVersion.current) return;
        setAccountsList([]);
        setSelectedAccount(null);
        setAccountLoadError(error.message || "โหลดบัญชี LINE OA ไม่สำเร็จ");
      });
  }, [business?.id, requestedAccountId]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const updateAccountInUrl = (accountId) => {
    const params = new URLSearchParams(searchParams.toString());
    if (accountId) params.set("accountId", accountId);
    else params.delete("accountId");
    router.replace(`${pathname}${params.toString() ? `?${params}` : ""}`);
  };

  const handleAccountChange = (account) => {
    setSelectedAccount(account);
    updateAccountInUrl(account?.id);
  };

  const handleNavigate = (tabId, accountId = selectedAccount?.id) => {
    setActiveTab(tabId);
    const params = new URLSearchParams(searchParams.toString());
    if (accountId) params.set("accountId", accountId);
    else params.delete("accountId");
    if (tabId === "dashboard") {
      router.push(`/line-oa${params.toString() ? `?${params}` : ""}`);
    } else {
      router.push(`/line-oa/${tabId}${params.toString() ? `?${params}` : ""}`);
    }
  };

  const handleSelectProject = (account) => {
    setSelectedAccount(account);
    handleNavigate("design-studio", account.id);
  };

  return (
    <div className="flex flex-col w-full min-h-[calc(100vh-120px)] bg-transparent text-slate-900 dark:text-slate-100 font-thai">
      {/* Studio Header: Identity, Context & Search (Sidebar holds the primary navigation) */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-200/80 dark:border-slate-800">
        {/* Left: Studio Identity & Project Context */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#06C755] to-emerald-600 flex items-center justify-center text-white shadow-sm shadow-[#06C755]/30">
            <span className="font-black text-lg">💬</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base text-slate-900 dark:text-white leading-none">
                LINE Studio
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                Enterprise
              </span>
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
              <span>ธุรกิจ / บัญชีปัจจุบัน:</span>
              {accountsList.length > 0 ? (
                <select
                  value={selectedAccount?.id || ""}
                  onChange={(e) => {
                    const found = accountsList.find(account => account.id === e.target.value);
                    if (found) handleAccountChange(found);
                  }}
                  className="font-bold text-brand-dark dark:text-brand-amber bg-transparent border-0 p-0 text-xs focus:ring-0 cursor-pointer underline decoration-dotted"
                >
                  {accountsList.map(account => (
                    <option key={account.id} value={account.id} className="text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900">
                      {account.displayName || account.name || account.code}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-bold text-brand-dark dark:text-brand-amber">
                  {selectedAccount?.displayName || selectedAccount?.name || business?.name || "ยังไม่ได้เลือกบัญชี"}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Connect Button & Search */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => handleNavigate("edge-connection")}
            className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-95 active:scale-95 text-white text-xs font-bold transition-all shadow-sm shadow-emerald-600/20 flex items-center gap-1.5 whitespace-nowrap"
          >
            <span>💬 + เชื่อมต่อ LINE OA</span>
          </button>
          <div className="relative hidden sm:block">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาใน LINE Studio... ⌘K"
              className="w-48 pl-8 pr-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/30 shadow-sm"
            />
          </div>
        </div>
      </div>

      {accountLoadError && (
        <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {accountLoadError}
        </div>
      )}

      {/* Main Studio Viewport */}
      <div className="flex-1 w-full">
        {activeTab === "dashboard" && (
          <LineStudioDashboard
            onSelectProject={handleSelectProject}
            onNavigate={(tab) => handleNavigate(tab)}
          />
        )}

        {activeTab === "projects" && (
          <LineStudioProjects
            onSelectProject={handleSelectProject}
          />
        )}

        {activeTab === "design-studio" && (
          <LineStudioDesignHub
            project={selectedAccount}
            onAccountChange={(accountId) => handleAccountChange(accountsList.find(account => account.id === accountId) || null)}
            onBackToProjects={() => handleNavigate("projects")}
          />
        )}

        {activeTab === "live-crm" && (
          <LineStudioLiveCrm />
        )}

        {activeTab === "edge-connection" && (
          <div className="space-y-6">
            <LineStudioJobFailures />
            <LineStudioEdgeConnection />
          </div>
        )}

        {activeTab === "templates" && (
          <LineStudioTemplates
            onSelectTemplate={(tpl) => {
              handleNavigate("design-studio");
            }}
          />
        )}

        {activeTab === "team" && (
          <LineStudioTeam />
        )}

        {activeTab === "settings" && (
          <LineStudioSettings />
        )}
      </div>
    </div>
  );
}
