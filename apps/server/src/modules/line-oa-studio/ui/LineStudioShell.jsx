// @req FR-146, FR-151, FR-152, FR-153 — LINE Studio Enterprise Shell
// @spec SDD-060, SDD-061 — Unified Navigation & Multi-View Layout
"use client";

import React, { useState } from "react";
import LineStudioDashboard from "./LineStudioDashboard";
import LineStudioProjects from "./LineStudioProjects";
import LineStudioDesignHub from "./LineStudioDesignHub";
import LineStudioTemplates from "./LineStudioTemplates";
import LineStudioTeam from "./LineStudioTeam";
import LineStudioFlowAccount from "./LineStudioFlowAccount";
import { MOCK_STUDIO_PROJECTS } from "./mockStudioData";
import {
  LayoutDashboard,
  Layers,
  Bookmark,
  BarChart3,
  Users,
  Image,
  Settings,
  FileSpreadsheet,
  Search,
  Moon,
  Sun,
  Bell,
  Sparkles,
  Bot,
  User,
  ChevronDown
} from "lucide-react";

export default function LineStudioShell() {
  const [activeTab, setActiveTab] = useState("dashboard"); // 'dashboard' | 'projects' | 'design-studio' | 'templates' | 'analytics' | 'team' | 'flowaccount' | 'settings'
  const [selectedProject, setSelectedProject] = useState(MOCK_STUDIO_PROJECTS[1]); // Default to Whocalled
  const [searchOpen, setSearchOpen] = useState(false);

  const sidebarNavItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "projects", label: "โปรเจค", icon: Layers, badge: "14" },
    { id: "templates", label: "Templates", icon: Bookmark, badge: "5" },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "team", label: "ทีม", icon: Users },
    { id: "flowaccount", label: "FlowAccount", icon: FileSpreadsheet },
    { id: "media", label: "Media", icon: Image },
    { id: "settings", label: "Settings", icon: Settings }
  ];

  const handleSelectProject = (proj) => {
    setSelectedProject(proj);
    setActiveTab("design-studio");
  };

  return (
    <div className="flex h-screen w-full bg-[#F7F8FA] dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-thai">
      {/* Left Main Sidebar (matching screenshot 782184716...) */}
      <aside className="w-64 flex flex-col justify-between border-r border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md shrink-0 select-none z-30">
        <div>
          {/* Brand Logo Header */}
          <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-100 dark:border-slate-800">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#06C755] to-emerald-600 flex items-center justify-center text-white shadow-sm shadow-[#06C755]/30">
              <span className="font-black text-base">💬</span>
            </div>
            <div>
              <div className="font-bold text-sm text-slate-900 dark:text-white leading-tight flex items-center gap-1.5">
                <span>LINE Studio</span>
              </div>
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
                Enterprise
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1">
            {sidebarNavItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id || (item.id === "projects" && activeTab === "design-studio");

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.id === "analytics") {
                      setActiveTab("dashboard");
                    } else {
                      setActiveTab(item.id);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? "bg-brand-surface/80 dark:bg-brand-amber/15 text-brand-dark dark:text-brand-amber border border-brand-amber/30 shadow-2xs font-bold"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-slate-800/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 ${isActive ? "text-brand-dark dark:text-brand-amber" : "text-slate-400"}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-slate-500">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Account / Version Footer */}
        <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/40">
          <div className="flex items-center gap-3 p-2 rounded-xl">
            <div className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 flex items-center justify-center font-bold text-xs">
              A
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                Admin
              </div>
              <div className="text-[10px] text-slate-400 truncate font-mono">
                admin@lineoa.io
              </div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-slate-400 text-center font-mono">
            v1.0.0 · Enterprise
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Navbar */}
        <header className="h-16 px-6 border-b border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-3">
            <h2 className="font-bold text-slate-800 dark:text-slate-100 text-sm">
              {activeTab === "dashboard" && "LINE Studio"}
              {activeTab === "projects" && "LINE Studio / Projects"}
              {activeTab === "design-studio" && `LINE Studio / ${selectedProject?.name || "Whocalled"}`}
              {activeTab === "templates" && "Templates"}
              {activeTab === "team" && "Team"}
              {activeTab === "flowaccount" && "FlowAccount Mapping"}
              {activeTab === "settings" && "Settings"}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {/* Global Search box */}
            <div className="relative">
              <input
                type="text"
                placeholder="ค้นหา... ⌘K"
                className="w-48 sm:w-60 pl-8 pr-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-brand-amber text-xs placeholder-slate-400 focus:outline-none"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            </div>

            {/* Notification Bell */}
            <button className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 relative">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-amber" />
            </button>
          </div>
        </header>

        {/* Scrollable Page Body */}
        <main className="flex-1 p-6 overflow-y-auto">
          {activeTab === "dashboard" && (
            <LineStudioDashboard
              onSelectProject={handleSelectProject}
              onNavigate={(tab) => setActiveTab(tab)}
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
              onBackToProjects={() => setActiveTab("projects")}
            />
          )}

          {activeTab === "templates" && (
            <LineStudioTemplates
              onSelectTemplate={(tpl) => {
                setActiveTab("design-studio");
              }}
            />
          )}

          {activeTab === "team" && (
            <LineStudioTeam />
          )}

          {activeTab === "flowaccount" && (
            <LineStudioFlowAccount />
          )}

          {(activeTab === "media" || activeTab === "settings") && (
            <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <Sparkles className="w-8 h-8 text-brand-amber mx-auto mb-3" />
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                {activeTab === "media" ? "Media Asset Library" : "LINE Studio Settings"}
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                เชื่อมต่อกับ Zuri AI Cloud & Edge Runtime สำหรับการจัดเก็บไฟล์และกุญแจความปลอดภัย Messaging API
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
