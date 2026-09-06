'use client'

import React, { Suspense } from 'react'
import { LineStudioShell } from '@/modules/line-oa-studio/ui'

// @req FR-146, FR-149 — LINE OA Studio Settings View
// @spec ADR-041, SDD-060
// @tested tests/e2e/fr149-line-server-console.spec.js

export default function LineOaSettingsPage() {
  return (
    <div className="w-full">
      <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">กำลังโหลด Settings...</div>}>
        <LineStudioShell initialTab="settings" />
      </Suspense>
    </div>
  )
}
