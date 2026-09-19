'use client'

// @req FR-211 — Domain map & inventory: every domain as a tile, and for the one
// selected, its features, functional and non-functional requirements with the
// readiness the generated snapshot records.
// @spec ADR-048 D3, SDD-055, NFR-008, FR-124
// @tested tests/unit/platform-control-domain-map.test.js
//
// Read-only. Status text always sits beside its colour (NFR-008), and nothing
// here computes readiness: `projectDomainMap` passes the snapshot's words through.

import { useMemo, useState } from 'react'
import { AlertTriangle, Boxes, ChevronDown, Gauge, ListChecks, Search, ShieldCheck } from 'lucide-react'
import { Card, Kpi } from '@/components/ui'
import TiltCard from './TiltCard'
import styles from './domain-map-view.module.css'

const PILL = {
  verified: 'pill-active',
  ready: 'pill-active',
  live: 'pill-active',
  partial: 'pill-review',
  not_ready: 'pill-review',
  building: 'pill-review',
  planned: 'pill-planned',
  unknown: 'pill-planned',
  blocked: 'pill-blocked',
  not_implemented: 'pill-blocked',
  not_applicable: 'pill-done',
}

const LABEL = {
  not_ready: 'not ready',
  not_implemented: 'not implemented',
  not_applicable: 'n/a',
}

const CHECK_LABEL = {
  ui: 'UI',
  httpApi: 'HTTP API',
  mcp: 'MCP',
  runtimeContract: 'Runtime contract',
  jsonSchema: 'JSON schema',
  database: 'Database',
  authorization: 'Authorization',
  tests: 'Tests',
}

// For an NFR, "not implemented" overstates it: the snapshot only knows that no
// annotated code follows it, which is an evidence gap, not a verdict on the build.
function ReadinessPill({ status, nfr = false }) {
  const text = nfr && status === 'not_implemented' ? 'no evidence' : LABEL[status] ?? status
  return <span className={`pill ${PILL[status] ?? 'pill-planned'} ${styles.pill}`} data-readiness={status}>{text}</span>
}

const matches = (query, ...values) => !query || values.some((value) => String(value ?? '').toLowerCase().includes(query))

function RequirementTable({ caption, rows, nfr = false, showFeatures = false }) {
  if (!rows.length) return <p className={styles.empty}>{nfr ? 'No NFR is followed by this domain’s code.' : 'Nothing matches.'}</p>
  return (
    <div className={styles.tableFrame}>
      <table className={styles.table}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Requirement</th>
            <th scope="col">Readiness</th>
            <th scope="col" className={styles.num}>Code</th>
            <th scope="col" className={styles.num}>Tests</th>
            {showFeatures && <th scope="col">Feature</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-readiness={row.status}>
              <td><code className={styles.code}>{row.id}</code></td>
              <td className={styles.titleCell}>{row.title}</td>
              <td><ReadinessPill status={row.status} nfr={nfr} /></td>
              <td className={styles.num}>{row.codeCount}</td>
              <td className={styles.num}>{row.testCount}</td>
              {showFeatures && <td className={styles.featureRefs}>{row.featureIds.join(', ')}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FeatureRow({ feature, frById, open, onToggle }) {
  return (
    <li className={styles.feature} data-readiness={feature.readiness}>
      <button type="button" className={styles.featureHead} onClick={onToggle} aria-expanded={open} aria-controls={`feature-detail-${feature.id}`}>
        <span className={styles.featureDot} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <code className={styles.code}>{feature.id}</code>
            <ReadinessPill status={feature.readiness} />
            {feature.kind === 'bundle' && <span className="text-[11px] text-muted">registry {feature.registryStatus}</span>}
            <span className="ml-auto text-[11px] text-muted">{feature.requirementIds.length} FR · {feature.progressPercent}%</span>
            <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </span>
          <span className="mt-1 block text-sm font-semibold">{feature.title}</span>
        </span>
      </button>
      {open && (
        <div id={`feature-detail-${feature.id}`} className={styles.featureBody}>
          <p className={styles.useCase}><span className={styles.k}>Use case</span>{feature.useCase}</p>
          {feature.blockers.length > 0 && (
            <div>
              <span className={styles.k}>Blockers</span>
              <ul className={styles.blockers}>{feature.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            </div>
          )}
          <div className={styles.frChips}>
            {feature.requirementIds.map((id) => {
              const fr = frById.get(id)
              return (
                <span key={id} className={styles.frChip} data-readiness={fr?.status ?? 'unknown'} title={fr ? `${fr.title} — ${fr.status}` : id}>
                  <code>{id}</code> {fr?.status === 'verified' ? '✓' : fr ? LABEL[fr.status] ?? fr.status : ''}
                </span>
              )
            })}
          </div>
          {feature.contributorDomains.length > 0 && <p className="text-[11px] text-muted">Also built in: {feature.contributorDomains.join(', ')}</p>}
        </div>
      )}
    </li>
  )
}

export default function DomainMapView({ domainMap }) {
  const { overall, domains, methodology, unanchoredNonFunctional } = domainMap
  const [selected, setSelected] = useState(domains[0]?.name ?? null)
  const [query, setQuery] = useState('')
  const [readiness, setReadiness] = useState('all')
  const [openFeatures, setOpenFeatures] = useState(() => new Set())
  const q = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    const keep = (isReady) => readiness === 'all' || (readiness === 'ready') === isReady
    return new Map(
      domains.map((domain) => [
        domain.name,
        {
          features: domain.features.filter((f) => keep(f.readiness === 'ready') && matches(q, f.id, f.title, f.useCase, ...f.requirementIds)),
          functional: domain.functional.filter((r) => keep(r.status === 'verified') && matches(q, r.id, r.title)),
          nonFunctional: domain.nonFunctional.filter((r) => keep(r.status === 'verified') && matches(q, r.id, r.title)),
        },
      ]),
    )
  }, [domains, q, readiness])
  const current = domains.find((domain) => domain.name === selected) ?? null
  const view = current ? filtered.get(current.name) : null
  const frById = useMemo(() => new Map((current?.functional ?? []).map((row) => [row.id, row])), [current])
  const filtering = q !== '' || readiness !== 'all'

  const toggleFeature = (id) =>
    setOpenFeatures((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className={`${styles.view} space-y-6`} data-testid="domain-map-view">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Domain readiness summary">
        <Kpi label="Domains" value={overall.domainCount} meta="chartered lanes" />
        <Kpi label="Features ready" value={`${overall.readyFeatureCount} / ${overall.featureCount}`} meta="FEAT bundles + unbundled FRs" tone={overall.readyFeatureCount === overall.featureCount ? 'good' : 'warn'} />
        <Kpi label="FR verified" value={`${overall.verifiedRequirementCount} / ${overall.requirementCount}`} meta={`requirement progress ${overall.progressPercent}%`} tone={overall.verifiedRequirementCount === overall.requirementCount ? 'good' : 'warn'} />
        <Kpi label="NFR with evidence" value={`${overall.verifiedNonFunctionalCount} / ${overall.nonFunctionalCount}`} meta="followed in code and verified by a test" tone={overall.verifiedNonFunctionalCount === overall.nonFunctionalCount ? 'good' : 'warn'} />
        <Kpi label="Open gaps" value={overall.gapCount} meta="across all domain checks" tone={overall.gapCount ? 'warn' : 'good'} />
      </section>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Boxes size={17} aria-hidden />
          <h2 className="text-base font-bold">Domain map</h2>
          <span className="text-xs text-muted">select a domain to open its inventory</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className={styles.search}>
              <Search size={14} aria-hidden />
              <span className="sr-only">Search features and requirements</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="FEAT / FR / NFR id or text" />
            </label>
            <label className="text-xs text-muted">
              <span className="sr-only">Readiness filter</span>
              <select className={styles.select} value={readiness} onChange={(event) => setReadiness(event.target.value)}>
                <option value="all">All readiness</option>
                <option value="not_ready">Not ready only</option>
                <option value="ready">Ready / verified only</option>
              </select>
            </label>
          </div>
        </div>
        <ul className={styles.grid} aria-label="Domains">
          {domains.map((domain) => {
            const hits = filtered.get(domain.name)
            const hitCount = hits.features.length + hits.functional.length + hits.nonFunctional.length
            const active = domain.name === selected
            return (
              <TiltCard as="li" key={domain.name} className={`${styles.tile} ${active ? styles.tileActive : ''}`} data-status={domain.status}>
                <button type="button" className={styles.tileButton} onClick={() => setSelected(domain.name)} aria-pressed={active} data-testid={`domain-tile-${domain.name}`}>
                  <span className="flex items-center gap-2">
                    <strong className="text-sm">{domain.label}</strong>
                    <span className="ml-auto"><ReadinessPill status={domain.status} /></span>
                  </span>
                  <code className="text-[11px] text-muted">{domain.name}</code>
                  <span
                    className={styles.bar}
                    role="progressbar"
                    aria-valuenow={Math.round(domain.progressPercent ?? 0)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${domain.label} requirement progress`}
                  >
                    <span className={styles.barFill} style={{ width: `${domain.progressPercent ?? 0}%` }} />
                  </span>
                  <span className={styles.tileStats}>
                    <span><b>{domain.readyFeatureCount}/{domain.featureCount}</b> features ready</span>
                    <span><b>{domain.verifiedFunctionalCount}/{domain.functional.length}</b> FR</span>
                    <span><b>{domain.nonFunctional.length}</b> NFR</span>
                    <span className={domain.gaps.length ? styles.gapWarn : ''}><b>{domain.gaps.length}</b> gaps</span>
                  </span>
                  <span className="text-[11px] text-muted">{domain.progressPercent === null ? 'no feature claimed' : `${domain.progressPercent}% progress`}{filtering ? ` · ${hitCount} match${hitCount === 1 ? '' : 'es'}` : ''}</span>
                </button>
              </TiltCard>
            )
          })}
        </ul>
      </Card>

      {current && view && (
        <section className="space-y-4" aria-label={`${current.label} inventory`} data-testid={`domain-inventory-${current.name}`}>
          <Card className={styles.inventoryHead}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold">{current.label}</h2>
              <ReadinessPill status={current.status} />
              <span className="text-xs text-muted">{current.featureCount} features · {current.functional.length} FR · {current.nonFunctional.length} NFR · {current.gaps.length} gaps</span>
            </div>
            <ul className={styles.checks} aria-label={`${current.label} readiness checks`}>
              {current.checks.map(({ check, status }) => (
                <li key={check} className={styles.check} data-readiness={status}>
                  <span>{CHECK_LABEL[check] ?? check}</span>
                  <ReadinessPill status={status} />
                </li>
              ))}
            </ul>
          </Card>

          <div className="grid gap-4 2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Card>
              <div className="mb-3 flex items-center gap-2"><Gauge size={16} aria-hidden /><h3 className="font-bold">Features</h3><span className="text-xs text-muted">{view.features.length} of {current.features.length}</span></div>
              {view.features.length === 0 ? (
                <p className={styles.empty}>Nothing matches.</p>
              ) : (
                <ul className="space-y-2">
                  {view.features.map((feature) => (
                    <FeatureRow key={feature.id} feature={feature} frById={frById} open={openFeatures.has(feature.id)} onToggle={() => toggleFeature(feature.id)} />
                  ))}
                </ul>
              )}
            </Card>

            <div className="space-y-4">
              <Card>
                <div className="mb-3 flex items-center gap-2"><ListChecks size={16} aria-hidden /><h3 className="font-bold">Functional requirements</h3><span className="text-xs text-muted">{view.functional.length} of {current.functional.length}</span></div>
                <RequirementTable caption={`${current.label} functional requirements`} rows={view.functional} showFeatures />
              </Card>
              <Card>
                <div className="mb-3 flex items-center gap-2"><ShieldCheck size={16} aria-hidden /><h3 className="font-bold">Non-functional requirements</h3><span className="text-xs text-muted">{view.nonFunctional.length} of {current.nonFunctional.length}</span></div>
                <RequirementTable caption={`${current.label} non-functional requirements`} rows={view.nonFunctional} nfr />
              </Card>
              {current.gaps.length > 0 && (
                <Card>
                  <div className="mb-3 flex items-center gap-2"><AlertTriangle size={16} aria-hidden /><h3 className="font-bold">Gaps</h3></div>
                  <ul className="space-y-2">
                    {current.gaps.map((gap) => (
                      <li key={`${gap.check}-${gap.id}`} className={styles.gap} data-severity={gap.severity}>
                        <span className="flex flex-wrap items-center gap-2"><code className={styles.code}>{gap.id}</code><span className="text-[11px] font-semibold uppercase">{gap.severity}</span><span className="text-[11px] text-muted">{CHECK_LABEL[gap.check] ?? gap.check}</span></span>
                        <span className="mt-1 block text-xs">{gap.summary}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          </div>
        </section>
      )}

      <Card>
        <div className="mb-3 flex items-center gap-2"><ShieldCheck size={16} aria-hidden /><h3 className="font-bold">NFRs no domain code follows</h3><span className="text-xs text-muted">{unanchoredNonFunctional.length} cross-cutting</span></div>
        <p className="mb-3 text-xs text-muted">These NFRs are declared in the PRD but no chartered domain’s annotated code names them, so the snapshot cannot place them on a tile. Most are enforced by the toolchain or CI rather than by a module.</p>
        <RequirementTable caption="Non-functional requirements with no domain anchor" rows={unanchoredNonFunctional} nfr />
      </Card>

      <Card warm>
        <p className="text-xs text-muted">
          Generated snapshot, not a live measurement: <code>apps/server/runtime/domain-state.json</code>, rebuilt by <code>npm run govern</code>. Requirement progress = {methodology.declarationWeight}% declared + {methodology.codeWeight}% code + {methodology.testWeight}% tests. {methodology.readinessRule}. An NFR counts for a domain when that domain’s code carries it in <code>@spec</code> or <code>@req</code>.
        </p>
      </Card>
    </div>
  )
}
