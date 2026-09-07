// @req FR-146, FR-151 — LINE Studio Enterprise Template Library
// @spec SDD-060, SDD-061 — Official & Community Template Registry with Live Preview & Direct Apply
"use client";

import React, { useState } from "react";
import { MOCK_TEMPLATE_LIBRARY } from "./mockStudioData";
import {
  Sparkles,
  Search,
  Filter,
  Zap,
  LayoutTemplate,
  Smartphone,
  Globe,
  ArrowRight,
  CheckCircle2,
  Bookmark,
  X,
  Eye,
  Send,
  Copy,
  Check
} from "lucide-react";

export default function LineStudioTemplates({ onSelectTemplate }) {
  const [selectedType, setSelectedType] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const [copiedPayload, setCopiedPayload] = useState(false);

  const types = [
    { id: "all", label: "All Types" },
    { id: "flow", label: "⚡ flow", icon: "zap" },
    { id: "flex", label: "🎴 flex", icon: "layout-template" },
    { id: "richmenu", label: "📱 richmenu", icon: "smartphone" },
    { id: "liff", label: "🌐 liff", icon: "globe" }
  ];

  const categories = [
    { id: "emergency", label: "emergency (1)" },
    { id: "restaurant", label: "restaurant (1)" },
    { id: "healthcare", label: "healthcare (1)" },
    { id: "welcome", label: "welcome (1)" },
    { id: "e-commerce", label: "e-commerce (1)" }
  ];

  const filtered = MOCK_TEMPLATE_LIBRARY.filter(tpl => {
    const matchType = selectedType === "all" || tpl.type === selectedType;
    const matchCat = selectedCategory === "all" || tpl.category === selectedCategory;
    const matchSearch = tpl.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        tpl.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchType && matchCat && matchSearch;
  });

  const handleCopyPayload = (text) => {
    navigator.clipboard?.writeText(text);
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  return (
    <div className="space-y-6 pb-12 font-thai">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
          <Bookmark className="w-5 h-5 text-brand-amber" />
          <span>Template Library (คลังเทมเพลตมาตรฐาน)</span>
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          5 templates · 5 categories พร้อมนำไปใช้งานทันทีสำหรับทุกบัญชี LINE OA
        </p>
      </div>

      {/* Search & Filter Strip */}
      <div className="space-y-3">
        {/* Search & Types */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xl">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหา template..."
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-brand-amber/30"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
            {types.map(t => (
              <button
                key={t.id}
                onClick={() => setSelectedType(t.id)}
                className={`px-3 py-1.5 rounded-xl font-medium transition-all ${
                  selectedType === t.id
                    ? "bg-brand-amber text-white shadow-xs"
                    : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto text-xs pb-1">
          <button
            onClick={() => setSelectedCategory("all")}
            className={`px-3 py-1 rounded-full border text-[11px] font-medium transition-all ${
              selectedCategory === "all"
                ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900"
                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50"
            }`}
          >
            ทั้งหมด
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(selectedCategory === cat.id ? "all" : cat.id)}
              className={`px-3 py-1 rounded-full border text-[11px] font-medium transition-all ${
                selectedCategory === cat.id
                  ? "bg-brand-amber text-white border-brand-amber"
                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Templates Grid Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {filtered.map(tpl => (
          <div
            key={tpl.id}
            className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 shadow-sm hover:shadow-md hover:border-brand-amber/40 transition-all flex flex-col justify-between group"
          >
            <div>
              {/* Card Banner / Icon Area */}
              <div
                onClick={() => setPreviewTemplate(tpl)}
                className="w-full h-32 rounded-xl bg-gradient-to-br from-amber-500/5 to-orange-500/10 dark:from-slate-800 dark:to-slate-850 flex items-center justify-center text-4xl mb-4 group-hover:scale-102 transition-transform relative cursor-pointer"
              >
                {tpl.type === "flow" && <Zap className="w-12 h-12 text-amber-500 fill-amber-500/20" />}
                {tpl.type === "flex" && <LayoutTemplate className="w-12 h-12 text-blue-500" />}
                {tpl.type === "richmenu" && <Smartphone className="w-12 h-12 text-orange-500" />}
                {tpl.type === "liff" && <Globe className="w-12 h-12 text-cyan-500" />}
                <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-lg bg-black/60 text-white text-[10px] font-semibold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Eye className="w-3 h-3" /> ดูตัวอย่าง
                </span>
              </div>

              {/* Badges */}
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Official</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {tpl.category}
                </span>
              </div>

              {/* Title & Info */}
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                {tpl.name}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {tpl.description}
              </p>
            </div>

            {/* Footer usage & buttons */}
            <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400 text-[11px]">ใช้ {tpl.usageCount} ครั้ง</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewTemplate(tpl)}
                  className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 text-slate-600 text-[11px] font-semibold"
                >
                  ตัวอย่าง
                </button>
                <button
                  type="button"
                  onClick={() => onSelectTemplate && onSelectTemplate(tpl)}
                  className="px-3 py-1 rounded-lg bg-brand-amber hover:bg-brand-hover text-white font-bold text-[11px] shadow-xs flex items-center gap-1 transition-all active:scale-95"
                >
                  <span>นำไปใช้ →</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center font-bold">
                  {previewTemplate.type === "flow" ? "⚡" : previewTemplate.type === "flex" ? "🎴" : "📱"}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    ตัวอย่างเทมเพลต: {previewTemplate.name}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    ประเภท: <span className="font-semibold text-amber-600 uppercase">{previewTemplate.type}</span> · {previewTemplate.category}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPreviewTemplate(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Description */}
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {previewTemplate.description}
            </p>

            {/* JSON / Structural Payload View */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">โครงสร้าง Payload / JSON:</span>
                <button
                  type="button"
                  onClick={() => handleCopyPayload(JSON.stringify(previewTemplate.payload || { type: previewTemplate.type, name: previewTemplate.name }, null, 2))}
                  className="text-[11px] text-purple-600 hover:underline flex items-center gap-1 font-semibold"
                >
                  {copiedPayload ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>คัดลอก JSON</span>
                </button>
              </div>
              <pre className="p-3 rounded-xl bg-slate-900 text-slate-100 text-[11px] font-mono max-h-56 overflow-y-auto">
                {JSON.stringify(previewTemplate.payload || {
                  type: previewTemplate.type,
                  name: previewTemplate.name,
                  category: previewTemplate.category,
                  version: "1.0",
                  actions: ["reply", "route", "log"]
                }, null, 2)}
              </pre>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setPreviewTemplate(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                ปิดหน้าต่าง
              </button>
              <button
                type="button"
                onClick={() => {
                  const tpl = previewTemplate;
                  setPreviewTemplate(null);
                  if (onSelectTemplate) onSelectTemplate(tpl);
                }}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-brand-amber to-brand-hover text-white text-xs font-bold shadow-md shadow-brand-amber/20 flex items-center gap-1.5 transition-all active:scale-95"
              >
                <span>เปิดใน Design Studio ทันที →</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
