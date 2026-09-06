// @req FR-146, FR-151 — LINE Studio Enterprise Projects Directory
// @spec SDD-060, SDD-061 — LINE OA Project Management Grid
"use client";

import React, { useState } from "react";
import { MOCK_STUDIO_PROJECTS } from "./mockStudioData";
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
  CheckCircle
} from "lucide-react";

export default function LineStudioProjects({ onSelectProject }) {
  const [projects, setProjects] = useState(MOCK_STUDIO_PROJECTS);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New project form state
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectSlug, setNewProjectSlug] = useState("");
  const [newProjectThai, setNewProjectThai] = useState("");
  const [newProjectIcon, setNewProjectIcon] = useState("🤖");
  const [newProjectCategory, setNewProjectCategory] = useState("general");

  const categories = [
    { id: "all", label: "ทั้งหมด" },
    { id: "sports", label: "กีฬา / ฟิตเนส" },
    { id: "f&b", label: "อาหารและเครื่องดื่ม" },
    { id: "healthcare", label: "การแพทย์ / คลินิก" },
    { id: "real-estate", label: "อสังหาฯ / คอนโด" },
    { id: "finance", label: "การเงิน / บัญชี" },
    { id: "emergency", label: "ช่วยเหลือ / ฉุกเฉิน" }
  ];

  const filteredProjects = projects.filter(p => {
    const matchQuery = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                       p.thaiName.includes(searchQuery) ||
                       p.slug.toLowerCase().includes(searchQuery.toLowerCase());
    const matchCat = activeCategory === "all" || p.category === activeCategory;
    return matchQuery && matchCat;
  });

  const handleCreateProject = (e) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    const newProj = {
      id: `p0${projects.length + 10}`,
      slug: newProjectSlug || `p0${projects.length + 10}-${newProjectName.toLowerCase().replace(/\s+/g, '-')}`,
      name: newProjectName,
      thaiName: newProjectThai || newProjectName,
      status: "draft",
      statusLabel: "ร่าง",
      category: newProjectCategory,
      icon: newProjectIcon || "🤖",
      followers: 0,
      flows: 1,
      messages: 0,
      updatedAgo: "เพิ่งสร้างเมื่อสักครู่",
      updatedDate: "2026-09-06",
      color: "from-brand-amber/20 to-brand-hover/20"
    };

    setProjects([newProj, ...projects]);
    setShowCreateModal(false);
    setNewProjectName("");
    setNewProjectSlug("");
    setNewProjectThai("");
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white font-thai flex items-center gap-2.5">
            <span>โปรเจค LINE Official Account ทั้งหมด</span>
            <span className="px-2.5 py-0.5 rounded-full bg-brand-amber/15 text-brand-dark dark:text-brand-amber text-xs font-semibold">
              {projects.length} โปรเจค
            </span>
          </h1>
          <p className="text-xs text-slate-500 font-thai mt-0.5">
            เลือกโปรเจคเพื่อเข้าสู่ Design Studio (Flow Designer, Flex Message, Rich Menu, LIFF App)
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-amber to-brand-hover hover:opacity-90 text-white text-sm font-semibold transition-all shadow-md shadow-brand-amber/20 flex items-center justify-center gap-2 font-thai self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>+ สร้างโปรเจคใหม่</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-3 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-sm">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none font-thai text-xs">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-3 py-1.5 rounded-xl font-medium transition-all whitespace-nowrap ${
                activeCategory === cat.id
                  ? "bg-brand-amber text-white shadow-sm shadow-brand-amber/25"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ค้นหาโปรเจค..."
            className="w-full pl-9 pr-4 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/30 focus:border-brand-amber font-thai"
          />
        </div>
      </div>

      {/* Projects Grid (matching screenshot 784215115...) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredProjects.map((project) => (
          <div
            key={project.id}
            onClick={() => onSelectProject(project)}
            className="group relative rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 p-5 shadow-sm hover:shadow-lg hover:border-brand-amber/40 transition-all cursor-pointer flex flex-col justify-between"
          >
            <div>
              {/* Header inside card */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-750 flex items-center justify-center text-2xl shadow-inner group-hover:scale-105 transition-transform">
                    {project.icon}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-sm group-hover:text-brand-dark dark:group-hover:text-brand-amber transition-colors line-clamp-1">
                      {project.name}
                    </h3>
                    <span className="text-[11px] font-mono text-slate-400 block">
                      {project.slug}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-thai line-clamp-1 mt-0.5">
                      {project.thaiName}
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-medium border border-slate-200 dark:border-slate-700 font-thai shrink-0">
                  {project.statusLabel}
                </span>
              </div>

              {/* Metric 3-box strip inside card (Followers, Flows, Messages) */}
              <div className="grid grid-cols-3 gap-2 mt-5 p-2.5 rounded-xl bg-slate-50/80 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-center font-thai">
                <div>
                  <div className="text-base font-bold text-slate-900 dark:text-white font-mono">
                    {project.followers}
                  </div>
                  <div className="text-[10px] text-slate-500">Followers</div>
                </div>
                <div className="border-x border-slate-200/60 dark:border-slate-700/60">
                  <div className="text-base font-bold text-brand-dark dark:text-brand-amber font-mono">
                    {project.flows}
                  </div>
                  <div className="text-[10px] text-slate-500">Flows</div>
                </div>
                <div>
                  <div className="text-base font-bold text-slate-900 dark:text-white font-mono">
                    {project.messages}
                  </div>
                  <div className="text-[10px] text-slate-500">Messages</div>
                </div>
              </div>
            </div>

            {/* Footer timestamp & button */}
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/70 flex items-center justify-between text-[11px] font-thai">
              <span className="text-slate-400">{project.updatedAgo}</span>
              <div className="flex items-center gap-1 text-brand-dark dark:text-brand-amber font-semibold group-hover:translate-x-0.5 transition-transform">
                <span>เปิด Studio</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200 font-thai">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-brand-amber/15 text-brand-amber">
                  <Bot className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  สร้างโปรเจค LINE OA ใหม่
                </h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  ชื่อโปรเจค (ภาษาอังกฤษ) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="เช่น LINE OA Clinic Booking"
                  value={newProjectName}
                  onChange={(e) => {
                    setNewProjectName(e.target.value);
                    if (!newProjectSlug) {
                      setNewProjectSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
                    }
                  }}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-amber/40 focus:border-brand-amber font-sans"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  ชื่อภาษาไทยสำหรับระบุการใช้งาน
                </label>
                <input
                  type="text"
                  placeholder="เช่น ระบบจองคิวตรวจรักษาคลินิก"
                  value={newProjectThai}
                  onChange={(e) => setNewProjectThai(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-amber/40 focus:border-brand-amber"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    หมวดหมู่ธุรกิจ
                  </label>
                  <select
                    value={newProjectCategory}
                    onChange={(e) => setNewProjectCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-amber/40"
                  >
                    <option value="general">ทั่วไป</option>
                    <option value="healthcare">คลินิก / สุขภาพ</option>
                    <option value="f&b">อาหารและเครื่องดื่ม</option>
                    <option value="sports">กีฬา / ฟิตเนส</option>
                    <option value="real-estate">อสังหาฯ</option>
                    <option value="finance">การเงิน</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    ไอคอนแสดงผล
                  </label>
                  <input
                    type="text"
                    value={newProjectIcon}
                    onChange={(e) => setNewProjectIcon(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center text-base focus:outline-none focus:ring-2 focus:ring-brand-amber/40"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-brand-amber hover:bg-brand-hover text-white text-xs font-semibold shadow-md shadow-brand-amber/20 transition-all"
                >
                  ยืนยันสร้างโปรเจค
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
