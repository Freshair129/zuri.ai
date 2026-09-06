// @req FR-146, FR-151, FR-152, FR-153 — LINE Studio Enterprise Design Hub
// @spec SDD-060, SDD-061 — Sub-studio Workspace Container
"use client";

import React, { useState } from "react";
import LineStudioFlowDesigner from "./LineStudioFlowDesigner";
import LineStudioFlexEditor from "./LineStudioFlexEditor";
import LineStudioRichMenu from "./LineStudioRichMenu";
import LineStudioLiffApp from "./LineStudioLiffApp";
import {
  ArrowLeft,
  Zap,
  LayoutTemplate,
  Smartphone,
  Globe,
  Save,
  Check,
  Sparkles
} from "lucide-react";

export default function LineStudioDesignHub({ project, onBackToProjects }) {
  const [activeSubTab, setActiveSubTab] = useState("flow"); // 'flow' | 'flex' | 'richmenu' | 'liff'

  const subTabs = [
    { id: "flow", label: "⚡ Flow Designer", icon: Zap, color: "text-amber-500" },
    { id: "flex", label: "🎴 Flex Message", icon: LayoutTemplate, color: "text-blue-500" },
    { id: "richmenu", label: "📱 Rich Menu", icon: Smartphone, color: "text-orange-500" },
    { id: "liff", label: "🌐 LIFF App", icon: Globe, color: "text-cyan-500" }
  ];

  return (
    <div className="space-y-4 font-thai">
      {/* Top Header with Breadcrumb & Sub-Studio Tabs (matching screenshot 783507792...) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={onBackToProjects}
            className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 hover:text-brand-dark transition-colors flex items-center gap-1.5 font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>← {project?.name || "รวมโปรเจค"}</span>
          </button>
          <span className="text-slate-400">/</span>
          <span className="font-bold text-slate-900 dark:text-white">Design Studio</span>
        </div>

        {/* Sub-Studio Switcher Tabs */}
        <div className="flex items-center p-1 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm text-xs">
          {subTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all whitespace-nowrap ${
                activeSubTab === tab.id
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Render Selected Sub-Studio */}
      <div>
        {activeSubTab === "flow" && <LineStudioFlowDesigner project={project} />}
        {activeSubTab === "flex" && <LineStudioFlexEditor project={project} />}
        {activeSubTab === "richmenu" && <LineStudioRichMenu project={project} />}
        {activeSubTab === "liff" && <LineStudioLiffApp project={project} />}
      </div>
    </div>
  );
}
