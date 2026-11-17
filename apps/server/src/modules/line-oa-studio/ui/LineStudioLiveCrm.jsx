// @req FR-091, FR-093, FR-146, FR-151 — LINE Studio Live CRM surfaces
// @spec SDD-050, SDD-060, ADR-060, ADR-061
// @tested tests/unit/line-studio-design-preview-render.test.js, tests/unit/line-crm-module-availability.test.js
"use client";

import React, { useState } from "react";
import LineCrmLiveChat from "@/modules/line-crm/LineCrmLiveChat";
import LineCrmMembers from "@/modules/line-crm/LineCrmMembers";
import { LINE_CRM_MODULES } from "@/modules/line-crm/lineCrmModules";

const studioTabLabels = {
  chat: "แชทสด & Live Inbox",
  members: "สมาชิก 360°",
};

export default function LineStudioLiveCrm() {
  const [activeSubTab, setActiveSubTab] = useState("chat");

  const subTabs = LINE_CRM_MODULES
    .filter((module) => module.available && studioTabLabels[module.id])
    .map((module) => ({ id: module.id, label: studioTabLabels[module.id], icon: module.icon }));

  return (
    <div className="space-y-4 font-thai">
      {/* Sub-tab Switcher */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b border-slate-200/80 dark:border-slate-800">
        <div className="flex items-center p-1 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm text-xs">
          {subTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-semibold transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-purple-600 text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="text-xs text-slate-500 hidden sm:block">
          ศูนย์ดูแลการสนทนาและสมาชิก
        </div>
      </div>

      {/* Render Active View */}
      <div>
        {activeSubTab === "chat" && <LineCrmLiveChat />}
        {activeSubTab === "members" && <LineCrmMembers />}
      </div>
    </div>
  );
}
