'use client'

import React, { Suspense } from 'react'
import { LineStudioShell } from '@/modules/line-oa-studio/ui'

// @req FR-146, FR-149, FR-153, FR-266 — LINE OA connections: the account and its
//   webhook, the paired devices that still do ADR-059 extraction, and the
//   Business's own model provider API key.
// @spec ADR-041, ADR-043, ADR-100, SDD-060
// @tested tests/e2e/fr149-line-server-console.spec.js

export default function LineOaConnectionsPage() {
  return (
    <div className="w-full">
      <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">กำลังโหลดการเชื่อมต่อ...</div>}>
        <LineStudioShell initialTab="connections" />
      </Suspense>
    </div>
  )
}
