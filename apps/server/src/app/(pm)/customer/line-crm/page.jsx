'use client'

import React, { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import LineCrmShell from '@/modules/line-crm/LineCrmShell'

// @req FR-091 — Customer LINE CRM entry to available conversation surfaces
// @spec SDD-050, ADR-060, ADR-061

function LineCrmPageContent() {
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab') || 'hub'

  return <LineCrmShell key={initialTab} initialTab={initialTab} />
}

export default function CustomerLineCrmPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">กำลังโหลด LINE CRM...</div>}>
      <LineCrmPageContent />
    </Suspense>
  )
}
