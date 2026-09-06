// @req FR-146, FR-151 — LINE Studio Enterprise Dashboard
// @spec SDD-060, SDD-061 — Multi-account analytics & project directory
"use client";

import React, { useState } from "react";
import {
  MOCK_GLOBAL_METRICS,
  MOCK_STUDIO_PROJECTS
} from "./mockStudioData";
import {
  Layers,
  Users,
  MessageSquare,
  Radio,
  Search,
  ArrowRight,
  Sparkles,
  TrendingUp,
  Activity,
  Bot,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  CheckCircle2
} from "lucide-react";

export default function LineStudioDashboard({ onSelectProject, onNavigate }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const filteredProjects = MOCK_STUDIO_PROJECTS.filter(p => {
    const matchQuery = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                       p.thaiName.includes(searchQuery) ||
                       p.slug.toLowerCase().includes(searchQuery.toLowerCase());
    const matchCategory = categoryFilter === "all" || p.category === categoryFilter;
    return matchQuery && matchCategory;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* Top Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500/10 via-brand-surface/40 to-emerald-500/10 border border-brand-amber/20 p-6 backdrop-blur-md">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-brand-amber/15 text-brand-dark dark:text-brand-amber text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>LINE Studio Enterprise v1.0.0</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 dark:text-white font-thai">
              ศูนย์บัญชาการ LINE OA และสตูดิโอออกแบบ
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 font-thai max-w-2xl">
              จัดการทุกบอท เชื่อมต่อระบบสนทนาอัตโนมัติ (Flow Designer), ออกแบบ Flex Messages, Rich Menus และ LIFF Apps ในที่เดียว
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate("templates")}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium transition-all shadow-sm flex items-center gap-2 font-thai"
            >
              <span>เทมเพลตเริ่มต้น</span>
            </button>
            <button
              onClick={() => onNavigate("projects")}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-amber to-brand-hover hover:opacity-90 text-white text-sm font-semibold transition-all shadow-md shadow-brand-amber/20 flex items-center gap-2 font-thai"
            >
              <span>จัดการโปรเจคทั้งหมด</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* KPI 4 Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Total Projects */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 font-thai">โปรเจคทั้งหมด</span>
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Layers className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              {MOCK_GLOBAL_METRICS.totalProjects}
            </span>
            <span className="text-xs text-slate-500 font-thai">บัญชี LINE OA</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-thai">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>พร้อมใช้งาน 100%</span>
          </div>
        </div>

        {/* Metric 2: Total Users / Followers */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 font-thai">ผู้ใช้งานทั้งหมด</span>
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              {MOCK_GLOBAL_METRICS.totalUsers}
            </span>
            <span className="text-xs text-slate-500 font-thai">ผู้ติดตามสะสม</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-thai">
            <Activity className="w-3.5 h-3.5" />
            <span>เชื่อมต่อกับ Zuri Edge / Cloud</span>
          </div>
        </div>

        {/* Metric 3: Messages Sent */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 font-thai">ข้อความที่ส่ง</span>
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <MessageSquare className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              {MOCK_GLOBAL_METRICS.totalMessages}
            </span>
            <span className="text-xs text-slate-500 font-thai">ข้อความรอบบิลนี้</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400 font-thai">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>อยู่ในโควต้าฟรี 500/ด.</span>
          </div>
        </div>

        {/* Metric 4: Broadcasts */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 font-thai">บรอดแคสต์</span>
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Radio className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              {MOCK_GLOBAL_METRICS.totalBroadcasts}
            </span>
            <span className="text-xs text-slate-500 font-thai">แคมเปญ</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-thai">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>ระบบพร้อมส่งออกทันที</span>
          </div>
        </div>
      </div>

      {/* Popular Projects Section */}
      <div className="bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white font-thai flex items-center gap-2">
              <Bot className="w-5 h-5 text-brand-amber" />
              <span>โปรเจคยอดนิยม (Top 10 Popular Projects)</span>
            </h2>
            <p className="text-xs text-slate-500 font-thai mt-0.5">
              แสดงสถานะการใช้งานและจำนวนผู้ติดตามของแต่ละบัญชี LINE Official Account
            </p>
          </div>

          {/* Search bar */}
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อโปรเจค หรือ slug..."
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/30 focus:border-brand-amber font-thai"
            />
          </div>
        </div>

        {/* Table of Projects */}
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200/70 dark:border-slate-800 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold font-thai">
                <th className="py-3 px-4">ชื่อโปรเจค</th>
                <th className="py-3 px-4">ผู้ติดตาม</th>
                <th className="py-3 px-4">Flows</th>
                <th className="py-3 px-4">ข้อความ</th>
                <th className="py-3 px-4">สถานะ</th>
                <th className="py-3 px-4">อัปเดตล่าสุด</th>
                <th className="py-3 px-4 text-right">การกระทำ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-thai">
              {filteredProjects.slice(0, 10).map((project) => (
                <tr
                  key={project.id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors group cursor-pointer"
                  onClick={() => onSelectProject(project)}
                >
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-lg shadow-inner">
                        {project.icon}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-brand-dark dark:group-hover:text-brand-amber transition-colors flex items-center gap-1.5">
                          <span>{project.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono">({project.slug})</span>
                        </div>
                        <div className="text-[11px] text-slate-500">{project.thaiName}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 font-mono font-medium text-slate-700 dark:text-slate-300">
                    {project.followers.toLocaleString()}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono font-semibold text-[11px]">
                      {project.flows} flow
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-400">
                    {project.messages.toLocaleString()}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-medium border border-slate-200 dark:border-slate-700">
                      {project.statusLabel}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                    {project.updatedAgo}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectProject(project);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-amber/10 hover:bg-brand-amber text-brand-dark dark:text-brand-amber hover:text-white text-xs font-medium transition-all"
                    >
                      <span>เข้าสู่ Studio</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
