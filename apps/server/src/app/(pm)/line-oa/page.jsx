'use client'

import React, { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { LineStudioShell } from '@/modules/line-oa-studio/ui'

// @req FR-146, FR-149, FR-151, FR-152, FR-153 — LINE OA Unified Studio & Transport Hub
// @spec ADR-041, ADR-043, ADR-061, SEC-001, SDD-060
// @tested tests/e2e/fr149-line-server-console.spec.js

function LineOaContent() {
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab') || 'dashboard'

  return <LineStudioShell initialTab={initialTab} />
}

export default function LineOaPage() {
  return (
    <div className="w-full">
      <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">กำลังโหลด LINE Studio...</div>}>
        <LineOaContent />
      </Suspense>
    </div>
  )
}
