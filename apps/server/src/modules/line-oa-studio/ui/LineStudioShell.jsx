// @req FR-146, FR-151, FR-152, FR-153 — LINE Studio Enterprise Shell
// @spec SDD-060, SDD-061 — Unified Tab Navigation & Multi-View Workspace
"use client";

import React, { useState, useEffect } from "react";
import LineStudioDashboard from "./LineStudioDashboard";
import LineStudioProjects from "./LineStudioProjects";
import LineStudioDesignHub from "./LineStudioDesignHub";
import LineStudioLiveCrm from "./LineStudioLiveCrm";
import LineStudioEdgeConnection from "./LineStudioEdgeConnection";
import LineStudioTemplates from "./LineStudioTemplates";
import LineStudioTeam from "./LineStudioTeam";
import { useScope } from "@/context/ScopeContext";
import { useRouter, usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Layers,
  Bookmark,
  BarChart3,
  Users,
  Settings,
  Search,
  Bell,
  Sparkles,
  Bot,
  ChevronRight,
  SlidersHorizontal,
  MessageSquare,
  Cpu,
  Server
} from "lucide-react";

export default function LineStudioShell({ initialTab = "dashboard" }) {
  const router = useRouter();
  const pathname = usePathname();
  const scope = useScope();
  const business = scope?.shell?.activeBusiness;

  const [activeTab, setActiveTab] = useState(initialTab);
  const [selectedProject, setSelectedProject] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const handleNavigate = (tabId) => {
    setActiveTab(tabId);
    if (tabId === "dashboard") {
      router.push("/line-oa");
    } else {
      router.push(`/line-oa/${tabId}`);
    }
  };

  const handleSelectProject = (proj) => {
    setSelectedProject(proj);
    handleNavigate("design-studio");
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
              <span>โปรเจคปัจจุบัน:</span>
              <span className="font-bold text-brand-dark dark:text-brand-amber">
                {selectedProject?.name || "Whocalled"}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Search & Action */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาใน LINE Studio... ⌘K"
              className="w-56 pl-8 pr-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/30 shadow-sm"
            />
          </div>
        </div>
      </div>

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
            project={selectedProject}
            onBackToProjects={() => handleNavigate("projects")}
          />
        )}

        {activeTab === "live-crm" && (
          <LineStudioLiveCrm />
        )}

        {activeTab === "edge-connection" && (
          <LineStudioEdgeConnection />
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
          <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <Sparkles className="w-8 h-8 text-brand-amber mx-auto mb-3" />
            <h3 className="font-bold text-slate-900 dark:text-white text-base">
              LINE Studio Settings
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              เชื่อมต่อกับ Zuri AI Cloud & Edge Runtime สำหรับการจัดเก็บไฟล์และกุญแจความปลอดภัย Messaging API
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
