'use client'

// @req FR-094 — six contextual KPIs, domain drilldown, complete feature list,
// explicit use cases, separate readiness and visible progress methodology.
// @spec docs/domains/project-manager/features/FR-094-domain-feature-readiness-dashboard.md, NFR-008, ADR-010
// @tested tests/unit/product-readiness-ui.test.js, tests/e2e/product-readiness.spec.js
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Search } from 'lucide-react'
import { Card, EmptyState, Kpi, PageHeader, ProgressBar, SectionTitle } from '@/components/ui'

const DOMAIN_LABELS = {
  agent: 'Agent',
  crm: 'CRM',
  identity: 'Identity',
  integration: 'Integration',
  knowledge: 'Knowledge',
  'market-intelligence': 'Market Intelligence',
  'project-manager': 'Project Manager',
}

const percent = (value) => `${Number(value || 0).toFixed(1)}%`
const domainLabel = (key) => DOMAIN_LABELS[key] || key.replace(/-/g, ' ')

function ReadinessBadge({ ready }) {
  return ready ? (
    <span className="pill pill-active inline-flex items-center gap-1"><CheckCircle2 size={11} aria-hidden /> พร้อมใช้งาน</span>
  ) : (
    <span className="pill pill-review inline-flex items-center gap-1"><CircleAlert size={11} aria-hidden /> ไม่พร้อมใช้งาน</span>
  )
}

function Methodology({ snapshot }) {
  const method = snapshot.progressMethodology
  return (
    <details className="card mb-4 p-4">
      <summary className="cursor-pointer text-xs font-bold">วิธีคำนวณและขอบเขตของตัวเลข</summary>
      <div className="mt-3 grid gap-3 text-[11px] leading-5 text-muted md:grid-cols-3">
        <p><strong className="text-[var(--text)]">ประกาศสถานะ {method.declarationWeight}%</strong><br />FR ที่ยัง planned ไม่ได้คะแนนส่วนนี้ แม้มี code อยู่แล้ว</p>
        <p><strong className="text-[var(--text)]">Code {method.codeWeight}% + Tests {method.testWeight}%</strong><br />นับจาก `@req` และ `@tested` edges ใน graph ไม่ใช่จำนวนไฟล์โดยประมาณ</p>
        <p><strong className="text-[var(--text)]">Readiness แยกจาก Progress</strong><br />{method.readinessRule}</p>
      </div>
      <p className="mt-3 text-[10px] text-muted">Snapshot สร้างเมื่อ {new Date(snapshot.generatedAt).toLocaleString()} · ไม่มี live telemetry หรือ external activation proof</p>
    </details>
  )
}

function DomainCard({ name, domain }) {
  return (
    <Link href={`/platform/product-readiness/${name}`} className="card block p-4 transition hover:-translate-y-0.5 hover:border-[var(--brand)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">{domainLabel(name)}</p>
          <p className="mt-0.5 text-[10px] text-muted">{domain.readyFeatureCount}/{domain.featureCount} features ready</p>
        </div>
        <ArrowRight size={15} aria-hidden className="text-muted" />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1"><ProgressBar percent={domain.progressPercent || 0} label={`${domainLabel(name)} development progress`} /></div>
        <span className="w-12 text-right text-xs font-bold tabular-nums">{percent(domain.progressPercent)}</span>
      </div>
      <p className="mt-2 text-[10px] text-muted">{domain.gaps.length} open governance gap(s)</p>
    </Link>
  )
}

function FeatureCard({ feature }) {
  return (
    <Card className="p-0">
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold text-[var(--brand-dark)]">{feature.id}</span>
              <span className="pill pill-planned">{feature.kind === 'bundle' ? 'FEAT bundle' : 'single FR'}</span>
              <ReadinessBadge ready={feature.ready} />
            </div>
            <h3 className="mt-2 text-sm font-bold leading-5">{feature.title}</h3>
          </div>
          <div className="w-36 shrink-0 max-sm:w-full">
            <div className="flex items-center justify-between text-[10px] text-muted"><span>Development</span><strong className="text-[var(--text)]">{percent(feature.progressPercent)}</strong></div>
            <div className="mt-1"><ProgressBar percent={feature.progressPercent} label={`${feature.id} development progress`} tone={feature.ready ? 'green' : undefined} /></div>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-[var(--surface-mid)] p-3">
          <p className="text-[10px] font-bold text-muted">ตัวอย่าง use case</p>
          <p className="mt-1 text-xs leading-5">{feature.useCase}</p>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
          <span className="pill pill-planned">Primary: {domainLabel(feature.primaryDomain)}</span>
          {feature.contributorDomains.filter((domain) => domain !== feature.primaryDomain).map((domain) => (
            <span key={domain} className="pill pill-done">Contributes: {domainLabel(domain)}</span>
          ))}
          <span className="pill pill-done">Registry: {feature.registryStatus}</span>
        </div>
      </div>

      <details className="border-t border-[var(--border)] px-4 py-3">
        <summary className="cursor-pointer text-[11px] font-bold">ดู requirements, blockers และ evidence</summary>
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-[10px] font-bold text-muted">Requirements</p>
            <div className="mt-1 grid gap-1 md:grid-cols-2">
              {feature.requirements.map((requirement) => (
                <div key={requirement.id} className="rounded-lg border border-[var(--border)] px-2.5 py-2 text-[10px]">
                  <div className="flex items-center justify-between gap-2"><strong>{requirement.id}</strong><span>{percent(requirement.progressPercent)}</span></div>
                  <p className="mt-1 text-muted">{requirement.status} · {requirement.codeCount} code · {requirement.testCount} tests</p>
                </div>
              ))}
            </div>
          </div>
          {feature.blockers.length > 0 && (
            <div role="status">
              <p className="text-[10px] font-bold text-[var(--warning)]">Blockers</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-[10px] text-muted">{feature.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            </div>
          )}
          <div>
            <p className="text-[10px] font-bold text-muted">Evidence ({feature.evidence.length})</p>
            <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-[var(--surface-mid)] p-2.5">
              {feature.evidence.length
                ? feature.evidence.map((item) => <code key={item} className="block break-all text-[9px]">{item}</code>)
                : <p className="text-[10px] text-muted">ยังไม่มี code/test evidence</p>}
            </div>
          </div>
        </div>
      </details>
    </Card>
  )
}

export default function ProductReadinessDashboard({ snapshot, initialDomain = null }) {
  const [query, setQuery] = useState('')
  const [readiness, setReadiness] = useState('all')
  const [selectedDomain, setSelectedDomain] = useState(initialDomain || 'all')
  const activeDomain = initialDomain || (selectedDomain === 'all' ? null : selectedDomain)
  const domain = activeDomain ? snapshot.domains[activeDomain] : null
  const scopeFeatures = activeDomain
    ? snapshot.features.filter((feature) => feature.primaryDomain === activeDomain)
    : snapshot.features

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return scopeFeatures.filter((feature) => {
      if (readiness === 'ready' && !feature.ready) return false
      if (readiness === 'not_ready' && feature.ready) return false
      if (!needle) return true
      return [feature.id, feature.title, feature.useCase, feature.primaryDomain, ...feature.requirementIds]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [query, readiness, scopeFeatures])

  const requirementRows = scopeFeatures.flatMap((feature) => feature.requirements)
  const uniqueRequirements = [...new Map(requirementRows.map((requirement) => [requirement.id, requirement])).values()]
  const contextual = domain ? {
    domainCount: 1,
    featureCount: domain.featureCount,
    readyFeatureCount: domain.readyFeatureCount,
    progressPercent: domain.progressPercent,
    requirementCount: uniqueRequirements.length,
    verifiedRequirementCount: uniqueRequirements.filter((requirement) => requirement.status === 'verified').length,
    gapCount: domain.gaps.length,
  } : snapshot.overall
  const gaps = domain ? domain.gaps : snapshot.overall.gaps

  return (
    <div>
      <PageHeader
        eyebrow="Platform"
        title={domain ? `${domainLabel(activeDomain)} readiness` : 'Product readiness'}
        subtitle="Evidence-backed development progress, readiness and example use cases across every implementation domain."
        actions={domain && <Link href="/platform/product-readiness" className="btn flex items-center gap-1"><ArrowLeft size={13} aria-hidden /> All domains</Link>}
      />

      <div className="mb-4 grid grid-cols-6 gap-3 max-xl:grid-cols-3 max-md:grid-cols-2 max-sm:grid-cols-1">
        <Kpi label="Domains" value={contextual.domainCount} meta={domain ? 'Selected implementation lane' : 'ADR-025 implementation lanes'} />
        <Kpi label="Features" value={contextual.featureCount} meta="FEAT bundles + unbundled FRs" />
        <Kpi label="Ready" value={contextual.readyFeatureCount} meta={`${contextual.featureCount - contextual.readyFeatureCount} not ready`} tone={contextual.readyFeatureCount === contextual.featureCount ? 'good' : 'warn'} />
        <Kpi label="Progress" value={percent(contextual.progressPercent)} meta="20% declaration · 40% code · 40% tests" />
        <Kpi label="Verified FRs" value={`${contextual.verifiedRequirementCount}/${contextual.requirementCount}`} meta="Code and test evidence complete" />
        <Kpi label="Open gaps" value={contextual.gapCount} meta="Governance and requirement gaps" tone={contextual.gapCount ? 'warn' : 'good'} />
      </div>

      <Methodology snapshot={snapshot} />

      {!domain && (
        <section className="mb-5" aria-label="Domain readiness">
          <SectionTitle caption="Open a lane to see all of its primary features and blockers.">Domain readiness</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Object.entries(snapshot.domains).map(([name, value]) => <DomainCard key={name} name={name} domain={value} />)}
          </div>
        </section>
      )}

      {gaps.length > 0 && (
        <section className="mb-5">
          <SectionTitle caption="The first five actionable gaps in this scope; feature disclosures name their direct blockers.">Attention</SectionTitle>
          <Card warm>
            <ul className="space-y-2 text-[11px]">
              {gaps.slice(0, 5).map((gap) => (
                <li key={`${gap.domain || activeDomain}-${gap.id}`} className="flex gap-2">
                  <CircleAlert size={13} aria-hidden className="mt-0.5 shrink-0 text-[var(--warning)]" />
                  <span><strong>{gap.domain ? `${domainLabel(gap.domain)} · ` : ''}{gap.id}</strong> — {gap.summary}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <section aria-label="Feature list">
        <SectionTitle caption={`${filtered.length} of ${scopeFeatures.length} features shown. Filters never change the KPI denominator.`}>Feature list</SectionTitle>
        <div className="mb-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_190px]">
          <label className="relative block">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-2.5 text-muted" />
            <input className="input w-full pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search id, feature or use case…" aria-label="Search product readiness features" />
          </label>
          {!initialDomain && (
            <select className="input" value={selectedDomain} onChange={(event) => setSelectedDomain(event.target.value)} aria-label="Filter by implementation domain">
              <option value="all">All domains</option>
              {Object.keys(snapshot.domains).map((name) => <option key={name} value={name}>{domainLabel(name)}</option>)}
            </select>
          )}
          <select className="input" value={readiness} onChange={(event) => setReadiness(event.target.value)} aria-label="Filter by readiness">
            <option value="all">All readiness</option>
            <option value="ready">พร้อมใช้งาน</option>
            <option value="not_ready">ไม่พร้อมใช้งาน</option>
          </select>
        </div>
        <div className="space-y-3">
          {filtered.map((feature) => <FeatureCard key={feature.id} feature={feature} />)}
          {filtered.length === 0 && <EmptyState title="ไม่พบ feature ที่ตรงกับตัวกรอง" hint="ล้างคำค้นหรือเปลี่ยน readiness filter โดย KPI ด้านบนยังคง denominator เดิม" />}
        </div>
      </section>
    </div>
  )
}
