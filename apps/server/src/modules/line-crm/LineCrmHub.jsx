'use client'

import React from 'react'
import { AVAILABLE_LINE_CRM_MODULES, normalizeLineCrmTab } from './lineCrmModules'

// @req FR-091 — launchpad for currently available LINE CRM modules.
// @spec SDD-050, ADR-061
// @tested tests/unit/line-crm-module-availability.test.js
export default function LineCrmHub({ onSelectModule }) {
  const handleSelectModule = (moduleId) => {
    onSelectModule?.(normalizeLineCrmTab(moduleId))
  }

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-purple-950 to-indigo-950 p-8 text-white shadow-xl">
        <div className="relative z-10 max-w-3xl space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur-md">
            <span>LINE CRM</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            จัดการ LINE OA และลูกค้า
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            เลือกเมนูที่เปิดให้ใช้งานเพื่อดูแชทสด สมาชิก CRM บัญชี LINE OA หรือ Rich Menu
          </p>
        </div>
        <div className="absolute right-0 top-0 -mt-10 -mr-10 h-64 w-64 rounded-full bg-purple-500/20 blur-3xl pointer-events-none" />
        <div className="absolute right-32 bottom-0 h-40 w-40 rounded-full bg-amber-500/20 blur-2xl pointer-events-none" />
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AVAILABLE_LINE_CRM_MODULES.map((module) => {
          const Icon = module.icon
          return (
            <button
              key={module.id}
              type="button"
              aria-label={`เปิดหน้า ${module.title}`}
              onClick={() => handleSelectModule(module.id)}
              className="group relative flex flex-col justify-between rounded-2xl border border-white/60 bg-white/80 p-5 text-left shadow-sm backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-purple-300 hover:bg-white hover:shadow-md dark:border-slate-800 dark:bg-slate-900/80 dark:hover:bg-slate-900"
            >
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl border ${module.color}`}>
                <Icon className="h-6 w-6" />
              </div>
              <div className="mt-4 space-y-1">
                <h2 className="text-base font-bold text-slate-900 group-hover:text-purple-600 dark:text-white dark:group-hover:text-purple-400">
                  {module.title}
                </h2>
                <p className="text-xs text-slate-500 line-clamp-2 dark:text-slate-400">
                  {module.subtitle}
                </p>
              </div>
              <div className="mt-4 flex items-center text-xs font-semibold text-purple-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-purple-400">
                <span>เปิดหน้า</span>
                <span className="ml-1" aria-hidden="true">→</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
