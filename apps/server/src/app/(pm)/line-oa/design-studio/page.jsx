'use client'

import React, { Suspense } from 'react'
import { LineStudioShell } from '@/modules/line-oa-studio/ui'

// @req FR-146, FR-151 — LINE OA Design Studio View
// @spec ADR-060, SDD-060
// @tested tests/e2e/fr149-line-server-console.spec.js

export default function LineOaDesignStudioPage() {
  return (
    <div className="w-full">
      <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">กำลังโหลด Design Studio...</div>}>
        <LineStudioShell initialTab="design-studio" />
      </Suspense>
    </div>
  )
}
