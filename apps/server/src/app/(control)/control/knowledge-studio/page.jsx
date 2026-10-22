import KnowledgeStudioBridge from '@/modules/platform-control/knowledge-studio/components/KnowledgeStudioBridge'

// @req FR-289 — serve the operator-only document graph browser.
// @spec ADR-048 D1-D3
// @tested tests/e2e/knowledge-studio/knowledge-studio.spec.js

export const metadata = { title: 'Knowledge Studio — Zuri Control' }
export const dynamic = 'force-dynamic'

export default function KnowledgeStudioPage() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Documentation · read only</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">Knowledge Studio</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">Explore indexed Zuri documents and their recorded relations. The graph uses the local original renderer; Markdown opens from the exact indexed source file.</p>
      </div>
      <KnowledgeStudioBridge />
    </div>
  )
}
