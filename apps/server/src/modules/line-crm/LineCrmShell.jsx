'use client'

import React, { useState } from 'react'
import { Layers, Moon, Sun } from 'lucide-react'

import LineCrmHub from './LineCrmHub'
import LineCrmLiveChat from './LineCrmLiveChat'
import LineCrmMembers from './LineCrmMembers'
import LineCrmMultiOa from './LineCrmMultiOa'
import LineCrmRichMenu from './LineCrmRichMenu'
import {
  AVAILABLE_LINE_CRM_MODULES,
  getAvailableLineCrmModule,
  normalizeLineCrmTab,
} from './lineCrmModules'

const MODULE_COMPONENTS = {
  chat: LineCrmLiveChat,
  members: LineCrmMembers,
  'line-oa': LineCrmMultiOa,
  'rich-menu': LineCrmRichMenu,
}

const NAV_ITEMS = AVAILABLE_LINE_CRM_MODULES

// @req FR-091, FR-146, FR-151, FR-152, FR-153 — LINE CRM shell for backed modules
// @spec SDD-050, ADR-060, ADR-061
// @tested tests/unit/line-crm-module-availability.test.js
export default function LineCrmShell({ initialTab = 'hub' }) {
  const [activeTab, setActiveTab] = useState(() => normalizeLineCrmTab(initialTab))
  const [isDarkMode, setIsDarkMode] = useState(false)
  const activeModule = getAvailableLineCrmModule(activeTab)
  const ActiveModule = activeModule ? MODULE_COMPONENTS[activeModule.id] : null

  const navigateToModule = (moduleId) => setActiveTab(normalizeLineCrmTab(moduleId))
  const toggleDarkMode = () => setIsDarkMode((previous) => !previous)

  return (
    <div className={`min-h-screen ${isDarkMode ? 'dark bg-slate-950 text-slate-100' : 'bg-[#F4F6F9] text-slate-800'}`}>
      {/* Top Bar Header */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/90 shadow-2xs">
        <button
          onClick={() => navigateToModule('hub')}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-700 via-fuchsia-600 to-pink-600 px-3 py-1.5 text-white shadow-sm hover:opacity-95 transition-opacity"
        >
          <Layers className="h-4 w-4" />
          <span className="text-xs font-black tracking-tight">LINE CRM</span>
        </button>

        {/* Dark mode is local shell state and does not depend on Settings. */}
        <button
          type="button"
          aria-label="สลับโหมดมืด"
          onClick={toggleDarkMode}
          className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
        >
          {isDarkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>

      {/* Main Body with Sidebar + Content */}
      <div className="flex">
        {/* Sidebar Navigation */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col justify-between border-r border-slate-200/80 bg-white/80 p-3 backdrop-blur-md md:flex dark:border-slate-800 dark:bg-slate-900/80 overflow-y-auto">
          <div className="space-y-4">
            {/* Workspace Header */}
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/80 p-2.5 dark:border-slate-800 dark:bg-slate-800/60">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-600 to-pink-600 text-xs font-bold text-white">
                CRM
              </div>
              <div className="min-w-0 flex-1">
                <span className="truncate text-xs font-bold text-slate-800 dark:text-white">LINE CRM</span>
                <span className="block truncate text-[10px] text-slate-400">จัดการลูกค้าและบัญชี LINE</span>
              </div>
            </div>

            {/* Menu List */}
            <nav className="space-y-1">
              <button
                onClick={() => navigateToModule('hub')}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                  activeTab === 'hub'
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Layers className="h-4 w-4" />
                  <span>ภาพรวม</span>
                </div>
              </button>

              <div className="pt-2 pb-1 text-[10px] font-bold text-slate-400 px-3 uppercase tracking-wider">
                เมนู CRM
              </div>

              {NAV_ITEMS.map((item) => {
                const Icon = item.icon
                const isActive = activeTab === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => navigateToModule(item.id)}
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
                  </button>
                )
              })}
            </nav>
          </div>

        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto overflow-y-auto">
          {/* Mobile Tabs Bar */}
          <div className="mb-4 flex gap-1 overflow-x-auto pb-2 md:hidden">
            <button
              onClick={() => navigateToModule('hub')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap ${activeTab === 'hub' ? 'bg-purple-600 text-white' : 'bg-white border'}`}
            >
              ภาพรวม
            </button>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => navigateToModule(item.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap ${activeTab === item.id ? 'bg-purple-600 text-white' : 'bg-white border'}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Module Router */}
          {activeTab === 'hub' || !ActiveModule
            ? <LineCrmHub onSelectModule={navigateToModule} />
            : <ActiveModule onNavigate={navigateToModule} />}
        </main>
      </div>
    </div>
  )
}
