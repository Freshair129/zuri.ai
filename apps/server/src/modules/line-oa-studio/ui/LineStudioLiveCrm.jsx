// @req FR-091, FR-093, FR-146, FR-151 — LINE Studio Unified Live CRM & Customer Suite
// @spec SDD-050, SDD-060, ADR-060, ADR-061
"use client";

import React, { useState } from "react";
import LineCrmLiveChat from "@/modules/line-crm/LineCrmLiveChat";
import LineCrmMembers from "@/modules/line-crm/LineCrmMembers";
import LineCrmLoyalty from "@/modules/line-crm/LineCrmLoyalty";
import LineCrmCampaigns from "@/modules/line-crm/LineCrmCampaigns";
import { MessageSquare, Users, Star, Send } from "lucide-react";

export default function LineStudioLiveCrm() {
  const [activeSubTab, setActiveSubTab] = useState("chat"); // 'chat' | 'members' | 'loyalty' | 'campaigns'

  const subTabs = [
    { id: "chat", label: "แชทสด & Live Inbox", icon: MessageSquare, badge: "12" },
    { id: "members", label: "สมาชิก 360°", icon: Users },
    { id: "loyalty", label: "แต้มสะสม & Tier", icon: Star },
    { id: "campaigns", label: "บรอดแคสต์ & แคมเปญ", icon: Send }
  ];

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
                {tab.badge && (
                  <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono ${
                    isActive ? "bg-white/20 text-white" : "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="text-xs text-slate-500 hidden sm:block">
          LineCRM-MCP Hub · Omni-Channel Customer Operations
        </div>
      </div>

      {/* Render Active View */}
      <div>
        {activeSubTab === "chat" && <LineCrmLiveChat />}
        {activeSubTab === "members" && <LineCrmMembers />}
        {activeSubTab === "loyalty" && <LineCrmLoyalty />}
        {activeSubTab === "campaigns" && <LineCrmCampaigns />}
      </div>
    </div>
  );
}
