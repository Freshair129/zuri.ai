'use client'

import React, { useState } from 'react'
import {
  Bot,
  Plus,
  Sparkles,
  Zap,
  CheckCircle2,
  Clock,
  Settings,
  Edit3,
  Cpu,
  ShieldCheck,
  Tag,
  Star,
  MessageSquare,
  ShoppingBag
} from 'lucide-react'
import { MCP_TOOLS, AI_TASK_QUEUE } from './mockData'

// @req FR-091, ADR-041, ADR-042 — AI MCP Control Plane
// @spec SDD-050, ADR-060

export default function LineCrmAiMcp() {
  const [tools, setTools] = useState(MCP_TOOLS)
  const [tasks, setTasks] = useState(AI_TASK_QUEUE)
  const [promptText, setPromptText] = useState(
    'คุณคือผู้ช่วยร้าน LineCRM-MCP พูดสุภาพเป็นกันเอง ใช้ภาษาไทย ตอบกระชับ ตรวจสอบข้อมูลสมาชิกและแต้มจาก CRM ก่อนตอบเสมอ ห้ามสัญญาการให้ส่วนลดที่ไม่มีในระบบ...'
  )
  const [isEditingPrompt, setIsEditingPrompt] = useState(false)
  const [promptSaved, setPromptSaved] = useState(false)

  const toggleTool = (id) => {
    setTools((prev) =>
      prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t))
    )
  }

  const handleSavePrompt = () => {
    setIsEditingPrompt(false)
    setPromptSaved(true)
    setTimeout(() => setPromptSaved(false), 2500)
  }

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-700 via-indigo-700 to-purple-900 p-6 text-white shadow-lg">
        <div className="relative z-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-0.5 text-xs font-semibold backdrop-blur-md">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span>AI MCP Control Plane</span>
              <span className="rounded-full bg-amber-400/20 px-2 py-0.2 text-[10px] text-amber-300">Beta</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              ศูนย์ควบคุม AI & MCP Tools
            </h1>
            <p className="text-xs text-purple-200">
              เชื่อมโยงความสามารถ Model Context Protocol เข้ากับ CRM, LINE OA และ Automation แบบเรียลไทม์
            </p>
          </div>
          <button className="inline-flex items-center gap-1.5 rounded-xl bg-white/20 px-4 py-2 text-xs font-bold text-white backdrop-blur-md hover:bg-white/30 transition-colors">
            <Plus className="h-4 w-4" />
            <span>เชื่อม MCP Server</span>
          </button>
        </div>
      </div>

      {promptSaved && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300 animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>บันทึก System Prompt (บุคลิก AI) เรียบร้อยแล้ว</span>
        </div>
      )}

      {/* Row 1: 4 Stat Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Stat 1 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Cpu className="h-4 w-4 text-purple-600" />
            <span>MCP Tools</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            18
          </div>
          <div className="mt-1 text-[11px] text-slate-400">เปิดใช้ 15</div>
        </div>

        {/* Stat 2 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Bot className="h-4 w-4 text-blue-500" />
            <span>AI Tasks วันนี้</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            32
          </div>
          <div className="mt-1 text-[11px] text-slate-400">รอดำเนินการ 12</div>
        </div>

        {/* Stat 3 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Sparkles className="h-4 w-4 text-emerald-500" />
            <span>ความแม่นยำตอบ</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            92.4%
          </div>
          <div className="mt-1 text-[11px] text-slate-400">จากการประเมิน</div>
        </div>

        {/* Stat 4 */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Zap className="h-4 w-4 text-pink-500" />
            <span>Token ใช้เดือนนี้</span>
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
            1.24M
          </div>
          <div className="mt-1 text-[11px] text-slate-400">จาก 5M</div>
        </div>
      </div>

      {/* Row 2: Tools & Prompt (Left 8 cols) + Task Queue (Right 4 cols) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column (8 cols) */}
        <div className="space-y-6 lg:col-span-8">
          {/* MCP Tools Switchboard */}
          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/90">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-4">MCP Tools ที่เชื่อมต่อ</h3>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {tools.map((tool) => (
                <div
                  key={tool.id}
                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-300">
                      <Cpu className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white font-mono">{tool.name}</div>
                      <div className="text-[11px] text-slate-400">{tool.desc}</div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={tool.enabled}
                    onChange={() => toggleTool(tool.id)}
                    className="h-4 w-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* System Prompt Editor */}
          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/90">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">System Prompt (บุคลิก AI)</h3>
                <p className="text-xs text-slate-400">กำหนดแนวทางการตอบและข้อจำกัดของโมเดลภาษา</p>
              </div>
              <button
                onClick={() => (isEditingPrompt ? handleSavePrompt() : setIsEditingPrompt(true))}
                className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-bold text-purple-700 hover:bg-purple-100 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-300"
              >
                <Edit3 className="h-3.5 w-3.5" />
                <span>{isEditingPrompt ? 'บันทึก Prompt' : 'แก้ไข Prompt'}</span>
              </button>
            </div>

            {isEditingPrompt ? (
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                rows={4}
                className="w-full rounded-xl border border-purple-300 bg-white p-3 text-xs leading-relaxed text-slate-800 focus:outline-none dark:border-purple-700 dark:bg-slate-800 dark:text-white"
              />
            ) : (
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3.5 text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
                "{promptText}"
              </div>
            )}
          </div>
        </div>

        {/* Right Column: AI Task Queue (4 cols) */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm lg:col-span-4 dark:border-slate-800 dark:bg-slate-900/90">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">คิวงาน AI (Task Queue)</h3>
            <span className="text-[10px] text-slate-400">Real-time</span>
          </div>

          <div className="space-y-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex flex-col justify-between rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white">{task.name}</h4>
                  <span
                    className={`rounded px-2 py-0.5 text-[9px] font-bold ${
                      task.status === 'running'
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 animate-pulse'
                        : task.status === 'queued'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    }`}
                  >
                    {task.statusText}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{task.target}</p>
              </div>
            ))}
          </div>

          <button className="mt-4 w-full text-center text-xs font-bold text-purple-600 hover:text-purple-700 dark:text-purple-400">
            ดูงานทั้งหมด →
          </button>
        </div>
      </div>
    </div>
  )
}
