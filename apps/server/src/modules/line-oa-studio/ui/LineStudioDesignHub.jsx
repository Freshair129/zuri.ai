// @req FR-146, FR-151, FR-152, FR-153 — LINE Studio Enterprise Design Hub
// @spec SDD-060, SDD-061 — Sub-studio Workspace Container
"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import LineStudioFlowDesigner from "./LineStudioFlowDesigner";
import LineStudioFlexEditor from "./LineStudioFlexEditor";
import { RichMenusWorkspace } from "@/app/(pm)/line-oa/rich-menus/page";
import LineStudioLiffApp from "./LineStudioLiffApp";
import { ArrowLeft } from "lucide-react";

export default function LineStudioDesignHub({ project, onAccountChange, onBackToProjects }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toolParam = searchParams.get("tool");
  const requestedTool = toolParam === "rich-menu" ? "richmenu" : ["flow", "flex", "liff"].includes(toolParam) ? toolParam : "flow";
  const [activeSubTab, setActiveSubTab] = useState(requestedTool); // 'flow' | 'flex' | 'richmenu' | 'liff'

  useEffect(() => {
    setActiveSubTab(requestedTool);
  }, [requestedTool]);

  const selectSubTab = (tabId) => {
    setActiveSubTab(tabId);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tool", tabId === "richmenu" ? "rich-menu" : tabId);
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`);
  };

  const subTabs = [
    { id: "flow", label: "⚡ Flow Designer" },
    { id: "flex", label: "🎴 Flex Message" },
    { id: "richmenu", label: "📱 Rich Menu" },
    { id: "liff", label: "🌐 LIFF App" }
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
            <span>← {project?.displayName || project?.name || project?.code || "รวมบัญชี & กลุ่ม"}</span>
          </button>
          <span className="text-slate-400">/</span>
          <span className="font-bold text-slate-900 dark:text-white">Design Studio</span>
        </div>

        {/* Sub-Studio Switcher Tabs */}
        <div className="flex items-center p-1 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm text-xs">
          {subTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => selectSubTab(tab.id)}
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
        {activeSubTab === "richmenu" && <RichMenusWorkspace initialAccountId={project?.id} onAccountChange={onAccountChange} />}
        {activeSubTab === "liff" && <LineStudioLiffApp project={project} />}
      </div>
    </div>
  );
}
