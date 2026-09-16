'use client'

import React from 'react'
import { ExternalLink, Grid } from 'lucide-react'
import { useRouter } from 'next/navigation'

// @req FR-151, FR-152, FR-153 — CRM keeps a contextual entry point only.
// @spec SDD-050, ADR-060, ADR-061 — the LINE OA Studio workspace owns menu
//   drafts, versions, jobs and provider outcomes; CRM must not invent a second
//   editor or claim that a publish completed.

export default function LineCrmRichMenu() {
  const router = useRouter()

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white">
            <Grid className="h-5 w-5 text-brand-amber" />
            Rich Menu
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            การออกแบบฉบับร่างและการเผยแพร่ถูกดูแลใน LINE OA Studio workspace เดียว
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/line-oa/design-studio?tool=rich-menu')}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-amber px-3 py-2 text-xs font-semibold text-white hover:bg-brand-hover"
        >
          เปิด Rich Menu workspace
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        เลือกบัญชี LINE OA และแก้ไขเมนูจาก workspace กลางเพื่อให้ version, freeze และ job status ตรงกันทุกช่องทาง
      </div>
    </div>
  )
}
