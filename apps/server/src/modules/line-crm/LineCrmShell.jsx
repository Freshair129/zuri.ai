'use client'

import React, { useState } from 'react'
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Star,
  Send,
  Radio,
  Grid,
  Zap,
  Bot,
  Smartphone,
  ShieldCheck,
  Settings,
  Search,
  Bell,
  Sparkles,
  ChevronDown,
  Moon,
  Sun,
  Layers
} from 'lucide-react'

import LineCrmHub from './LineCrmHub'
import LineCrmDashboard from './LineCrmDashboard'
import LineCrmLiveChat from './LineCrmLiveChat'
import LineCrmMembers from './LineCrmMembers'
import LineCrmLoyalty from './LineCrmLoyalty'
import LineCrmCampaigns from './LineCrmCampaigns'
import LineCrmMultiOa from './LineCrmMultiOa'
import LineCrmRichMenu from './LineCrmRichMenu'
import LineCrmAutomation from './LineCrmAutomation'
import LineCrmAiMcp from './LineCrmAiMcp'
import LineCrmMemberPortal from './LineCrmMemberPortal'
import LineCrmAuditLog from './LineCrmAuditLog'
import LineCrmSettings from './LineCrmSettings'

// @req FR-091, FR-146, FR-151, FR-152, FR-153 — LineCRM-MCP Master Shell & Navigation
// @spec SDD-050, ADR-060, ADR-061

export default function LineCrmShell({ initialTab = 'hub' }) {
  const [activeTab, setActiveTab] = useState(initialTab)
  const [aiMcpActive, setAiMcpActive] = useState(true)
  const [isDarkMode, setIsDarkMode] = useState(false)
  const selectedOa = 'LINE OA Studio status'
  const selectedWorkspace = 'CRM preview'

  const toggleDarkMode = () => setIsDarkMode((prev) => !prev)

  const NAV_ITEMS = [
    { id: 'dashboard', label: 'แดชบอร์ด', icon: LayoutDashboard },
    { id: 'chat', label: 'แชทสด', icon: MessageSquare, badge: '12', badgeColor: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' },
    { id: 'members', label: 'สมาชิก CRM', icon: Users },
    { id: 'loyalty', label: 'แต้มสะสม', icon: Star },
    { id: 'campaigns', label: 'แคมเปญ', icon: Send },
    { id: 'line-oa', label: 'LINE OA', icon: Radio },
    { id: 'rich-menu', label: 'Rich Menu', icon: Grid },
    { id: 'automation', label: 'Automation', icon: Zap },
    { id: 'ai-mcp', label: 'AI MCP', icon: Bot, badge: 'Beta', badgeColor: 'bg-gradient-to-r from-pink-500 to-purple-500 text-white' },
    { id: 'member-portal', label: 'Member Portal', icon: Smartphone },
    { id: 'audit-log', label: 'Audit Log', icon: ShieldCheck },
    { id: 'settings', label: 'ตั้งค่า', icon: Settings },
  ]

  return (
    <div className={`min-h-screen ${isDarkMode ? 'dark bg-slate-950 text-slate-100' : 'bg-[#F4F6F9] text-slate-800'}`}>
      {/* Top Bar Header */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 shadow-2xs">
        {/* Brand & Breadcrumbs */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab('hub')}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-700 via-fuchsia-600 to-pink-600 px-3 py-1.5 text-white shadow-sm hover:opacity-95 transition-opacity"
          >
            <Bot className="h-4 w-4" />
            <span className="text-xs font-black tracking-tight">LineCRM-MCP</span>
          </button>

          {/* Context Dropdowns */}
          <div className="hidden items-center gap-2 text-xs md:flex">
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <span className="text-[10px] text-slate-400">Tenant:</span>
              <span>{selectedWorkspace}</span>
              <span className="rounded bg-purple-100 px-1 py-0.2 text-[9px] font-bold text-purple-700 dark:bg-purple-950 dark:text-purple-300">Pro</span>
            </div>

            <span className="text-slate-300 dark:text-slate-700">/</span>
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              <span>{selectedOa}</span>
            </div>
          </div>
        </div>

        {/* Global Search */}
        <div className="relative hidden w-72 lg:block">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="ค้นหา สมาชิก, แท็ก, แคมเปญ, ข้อความ..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-8 py-1.5 text-xs focus:border-purple-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
          <kbd className="absolute right-2.5 top-2 rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-mono text-slate-500 dark:bg-slate-700 dark:text-slate-400">
            ⌘K
          </kbd>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-3">
          {/* AI MCP Active Switch */}
          <div className="flex items-center gap-2 rounded-full border border-purple-200 bg-purple-50/80 px-2.5 py-1 text-xs font-bold text-purple-900 dark:border-purple-900/60 dark:bg-purple-950/40 dark:text-purple-200">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="hidden sm:inline text-[11px]">AI MCP Active</span>
            <input
              type="checkbox"
              checked={aiMcpActive}
              onChange={(e) => setAiMcpActive(e.target.checked)}
              className="h-3.5 w-3.5 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
            />
          </div>

          {/* Dark Mode Toggle */}
          <button
            onClick={toggleDarkMode}
            className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
          >
            {isDarkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
          </button>

          {/* Notifications */}
          <div className="relative">
            <button className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
              <Bell className="h-4 w-4" />
            </button>
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white">
              8
            </span>
          </div>

          {/* Profile Avatar */}
          <div className="flex items-center gap-2 border-l border-slate-200 pl-3 dark:border-slate-800">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-indigo-700 text-xs font-bold text-white shadow-2xs">
              AD
            </div>
            <div className="hidden text-left sm:block">
              <div className="text-xs font-bold leading-tight text-slate-800 dark:text-white">Admin Demo</div>
              <div className="text-[10px] text-slate-400 leading-tight">Owner</div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Body with Sidebar + Content */}
      <div className="flex">
        {/* Sidebar Navigation */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col justify-between border-r border-slate-200/80 bg-white/80 p-3 backdrop-blur-md md:flex dark:border-slate-800 dark:bg-slate-900/80 overflow-y-auto">
          <div className="space-y-4">
            {/* Workspace Header */}
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/80 p-2.5 dark:border-slate-800 dark:bg-slate-800/60">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-600 to-pink-600 text-xs font-bold text-white">
                DW
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="truncate text-xs font-bold text-slate-800 dark:text-white">Demo Workspace</span>
                  <span className="rounded bg-purple-100 px-1 text-[8px] font-bold text-purple-700 dark:bg-purple-950 dark:text-purple-300">Pro</span>
                </div>
                <span className="text-[10px] text-slate-400 truncate block">@demo_workspace</span>
              </div>
            </div>

            {/* Menu List */}
            <nav className="space-y-1">
              <button
                onClick={() => setActiveTab('hub')}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                  activeTab === 'hub'
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Layers className="h-4 w-4" />
                  <span>ภาพรวม Mockup (12 เมนู)</span>
                </div>
              </button>

              <div className="pt-2 pb-1 text-[10px] font-bold text-slate-400 px-3 uppercase tracking-wider">
                เมนูหลัก
              </div>

              {NAV_ITEMS.map((item) => {
                const Icon = item.icon
                const isActive = activeTab === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                      isActive
                        ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </div>
                    {item.badge && (
                      <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${item.badgeColor || 'bg-slate-100 text-slate-600'}`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </nav>
          </div>

          {/* Footer Quota Widget */}
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/60">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800 dark:text-white flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-amber-500" /> Pro Plan
              </span>
              <span className="text-[10px] text-slate-400">ถึง 31 ธ.ค. 2569</span>
            </div>
            <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 flex justify-between">
              <span>การใช้งาน API</span>
              <span className="font-bold text-purple-600">62%</span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-pink-600" style={{ width: '62%' }} />
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto overflow-y-auto">
          {/* Mobile Tabs Bar */}
          <div className="mb-4 flex gap-1 overflow-x-auto pb-2 md:hidden">
            <button
              onClick={() => setActiveTab('hub')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap ${activeTab === 'hub' ? 'bg-purple-600 text-white' : 'bg-white border'}`}
            >
              Hub
            </button>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap ${activeTab === item.id ? 'bg-purple-600 text-white' : 'bg-white border'}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Module Router */}
          {activeTab === 'hub' && <LineCrmHub onSelectModule={(mod) => setActiveTab(mod)} />}
          {activeTab === 'dashboard' && <LineCrmDashboard onNavigate={(mod) => setActiveTab(mod)} />}
          {activeTab === 'chat' && <LineCrmLiveChat />}
          {activeTab === 'members' && <LineCrmMembers />}
          {activeTab === 'loyalty' && <LineCrmLoyalty />}
          {activeTab === 'campaigns' && <LineCrmCampaigns />}
          {activeTab === 'line-oa' && <LineCrmMultiOa />}
          {activeTab === 'rich-menu' && <LineCrmRichMenu />}
          {activeTab === 'automation' && <LineCrmAutomation />}
          {activeTab === 'ai-mcp' && <LineCrmAiMcp />}
          {activeTab === 'member-portal' && <LineCrmMemberPortal />}
          {activeTab === 'audit-log' && <LineCrmAuditLog />}
          {activeTab === 'settings' && <LineCrmSettings isDark={isDarkMode} onToggleDark={toggleDarkMode} />}
        </main>
      </div>
    </div>
  )
}
