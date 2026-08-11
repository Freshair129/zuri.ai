'use client'

import { PageHeader, Card, SectionTitle } from '@/components/ui'
import { MODE_LABELS, MODE_DEFAULT_STRATEGY } from '@/lib/validation/enums'
import { useScope } from '@/context/ScopeContext'

export default function SettingsPage() {
  const scope = useScope()
  return (
    <div>
      <PageHeader eyebrow="Settings" title="Settings" subtitle="Local demo identity, execution-mode reference, and data utilities." />
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Card>
          <SectionTitle caption="MVP runs with a local demo identity — no production login">Identity</SectionTitle>
          <p className="text-xs">Signed in as <b>Local Owner</b> (demo). Memberships are seeded for TNT-001 / BUS-001.</p>
          <p className="mt-2 text-[10px] text-muted">
            Production auth, LINE, and cloud sync are intentionally out of MVP scope.
          </p>
        </Card>
        <Card>
          <SectionTitle caption="Reset and reseed the local SQLite database from the terminal">Data utilities</SectionTitle>
          <p className="mb-2 text-[11px] text-muted">Idempotent demo seed (safe to re-run):</p>
          <code className="block rounded-lg bg-[#1F2937] p-2.5 text-[10px] text-[#D9E0E8]">npm run db:seed</code>
          <p className="mb-2 mt-3 text-[11px] text-muted">Full reset (drops all local data, then reseeds):</p>
          <code className="block rounded-lg bg-[#1F2937] p-2.5 text-[10px] text-[#D9E0E8]">npm run db:reset</code>
        </Card>
        <Card>
          <SectionTitle caption="Advanced: execution mode is normally chosen per workstream at planning time">Mode → default strategy</SectionTitle>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-muted"><th className="py-1">Mode</th><th>Default progress strategy</th></tr>
            </thead>
            <tbody>
              {Object.entries(MODE_LABELS).map(([mode, label]) => (
                <tr key={mode} className="border-t border-[var(--border)]">
                  <td className="py-1.5 font-semibold">{label}</td>
                  <td className="text-muted">{MODE_DEFAULT_STRATEGY[mode].replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-muted">
            Manual overrides live on each workstream (edit workstream → progress strategy).
          </p>
        </Card>
        <Card>
          <SectionTitle>Scope snapshot</SectionTitle>
          <ul className="space-y-1 text-[11px]">
            <li>{scope.portfolios.length} portfolio(s)</li>
            <li>{scope.tenants.length} tenant(s) — isolation boundaries</li>
            <li>{scope.businesses.length} business(es)</li>
            <li>{scope.workspaces.length} workspace(s)</li>
            <li>{scope.projects.length} active project(s)</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
