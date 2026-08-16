// @req FR-060 — Business Home Dashboard: cross-domain briefing, KPI tiles,
// per-domain health and an attention queue for the selected Business.
// @spec SDD-033 — a non-owning projection (architecture invariant 8). This file
// is a PURE calculator: it performs no I/O at all, so it cannot query another
// domain's tables even by accident. Callers hand it read models the owning
// domains already produced (FR-041 strategy, the FR-040 project payload) and it
// derives the view. Nothing here is persisted; every figure is recomputed.
// @spec BR-004 — progress-style figures are recomputed, never cached, so this
// surface can never disagree with the page that owns the number.
// @tested tests/unit/fr060-business-home-read-model.test.js

/**
 * Domain states. `RESERVED` and `NO_SIGNAL` are deliberately distinct: a
 * reserved slot has no module at all, while a live domain may simply have
 * nothing worth scoring yet. Collapsing them would either invent health for a
 * domain that does not exist, or hide that one does.
 */
export const DOMAIN_STATE = {
  SCORED: 'SCORED',
  NO_SIGNAL: 'NO_SIGNAL',
  RESERVED: 'RESERVED',
}

export const SEVERITY = { HIGH: 'HIGH', MED: 'MED', INFO: 'INFO' }

// Business Home is the surface doing the reporting, so it is never one of the
// rows it reports on — a slot scoring itself is noise, and it would also inflate
// the coverage denominator with a domain that owns nothing.
const SELF_KEY = 'business-home'
const SEVERITY_RANK = { HIGH: 0, MED: 1, INFO: 2 }

const isOpenGate = (gate) => !['PASSED', 'WAIVED'].includes(gate?.status)
const isDoneMilestone = (milestone) => milestone?.status === 'DONE'
const asTime = (value) => {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}
const overdue = (value, now) => {
  const t = asTime(value)
  return t !== null && t < now
}

/** Stable ordering: severity first, then a deterministic key so equal rows never swap. */
const compareAttention = (a, b) =>
  (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || a.id.localeCompare(b.id)

/**
 * Development health, derived only from signals the Development domain owns.
 * Deliberately simple and explainable — a score nobody can reconstruct from the
 * page beneath it is worse than no score.
 */
function developmentHealth(projects, now) {
  const all = projects || []
  if (!all.length) return null

  const gates = all.flatMap((p) => p.gates || []).filter((g) => g.required)
  const openGates = gates.filter(isOpenGate)
  const overdueGates = openGates.filter((g) => overdue(g.targetAt, now))
  const milestones = all.flatMap((p) => p.milestones || [])
  const overdueMilestones = milestones.filter((m) => !isDoneMilestone(m) && overdue(m.targetAt, now))

  // Start at 100 and subtract for things a delivery lead would actually act on.
  const penalty = overdueGates.length * 12 + overdueMilestones.length * 8 + (openGates.length - overdueGates.length) * 3
  const score = Math.max(0, Math.min(100, 100 - penalty))

  const signal = overdueGates.length
    ? `${overdueGates.length} required gate${overdueGates.length > 1 ? 's' : ''} overdue`
    : openGates.length
      ? `${openGates.length} required gate${openGates.length > 1 ? 's' : ''} open`
      : `${all.length} project${all.length > 1 ? 's' : ''} on track`

  return { score, signal }
}

/**
 * One row per Tier-2 domain, in registry order. A domain the product has not
 * built yet is RESERVED and carries no number — never a zero, which would read
 * as "measured and bad" rather than "not built" (FR-060).
 */
function domainHealthRows({ domains, projects, peopleCount, now }) {
  return (domains || []).filter((domain) => domain.key !== SELF_KEY).map((domain) => {
    const base = { key: domain.key, label: domain.label }
    if (domain.soon) return { ...base, state: DOMAIN_STATE.RESERVED, score: null, signal: 'Reserved — no module yet' }

    if (domain.key === 'projects') {
      const health = developmentHealth(projects, now)
      return health
        ? { ...base, state: DOMAIN_STATE.SCORED, score: health.score, signal: health.signal }
        : { ...base, state: DOMAIN_STATE.NO_SIGNAL, score: null, signal: 'No Projects in this Business yet' }
    }

    if (domain.key === 'people') {
      // A headcount is a fact, not a health score — so it is reported as a
      // signal and contributes nothing to the composite.
      return {
        ...base,
        state: DOMAIN_STATE.NO_SIGNAL,
        score: null,
        signal: typeof peopleCount === 'number'
          ? `${peopleCount} ${peopleCount === 1 ? 'person' : 'people'} in scope`
          : 'No health signal yet',
      }
    }

    return { ...base, state: DOMAIN_STATE.NO_SIGNAL, score: null, signal: 'No health signal yet' }
  })
}

/** Cross-domain exceptions, from real rows only. Empty is a valid, honest answer. */
function attentionQueue({ projects, strategy, now }) {
  const items = []

  for (const project of projects || []) {
    for (const gate of project.gates || []) {
      if (!gate.required || !isOpenGate(gate)) continue
      const late = overdue(gate.targetAt, now)
      items.push({
        id: `gate:${gate.id}`,
        severity: late ? SEVERITY.HIGH : SEVERITY.MED,
        title: late ? `Required gate overdue — ${gate.title}` : `Required gate open — ${gate.title}`,
        detail: `Development · ${project.code}`,
        domainKey: 'projects',
        href: `/projects/${project.id}`,
      })
    }
    for (const milestone of project.milestones || []) {
      if (isDoneMilestone(milestone) || !overdue(milestone.targetAt, now)) continue
      items.push({
        id: `milestone:${milestone.id}`,
        severity: SEVERITY.HIGH,
        title: `Milestone past target — ${milestone.title}`,
        detail: `Development · ${project.code}`,
        domainKey: 'projects',
        href: `/projects/${project.id}`,
      })
    }
  }

  for (const goal of strategy?.goals || []) {
    if (goal.status === 'DONE') continue
    if (overdue(goal.targetAt, now)) {
      items.push({
        id: `goal:${goal.id}`,
        severity: SEVERITY.HIGH,
        title: `Goal past target — ${goal.title}`,
        detail: `Strategy · ${goal.code}`,
        domainKey: 'projects',
        href: '/overview',
      })
    } else if (!(goal.projects || []).length) {
      items.push({
        id: `goal-unlinked:${goal.id}`,
        severity: SEVERITY.INFO,
        title: `Goal has no linked Project — ${goal.title}`,
        detail: 'Strategy · not connected to execution',
        domainKey: 'projects',
        href: '/overview',
      })
    }
  }

  return items.sort(compareAttention)
}

/**
 * A composed briefing line, not a generated one. FR-060 puts a genuinely
 * generated briefing out of scope precisely so this cannot quietly become a
 * place where a model asserts things the page cannot show.
 */
function briefingLine({ health, attention, projects }) {
  const scored = health.domains.filter((d) => d.state === DOMAIN_STATE.SCORED)
  const high = attention.filter((a) => a.severity === SEVERITY.HIGH).length
  const parts = []

  parts.push(
    scored.length
      ? `Health ${health.score}/100 across ${scored.length} of ${health.domains.length} domains.`
      : `No domain reports a health signal yet (${health.domains.length} slots).`,
  )
  if (high) parts.push(high > 1 ? `${high} items need attention now.` : '1 item needs attention now.')
  else if (attention.length) parts.push(`${attention.length} item${attention.length > 1 ? 's' : ''} to review, none urgent.`)
  else parts.push('Nothing is overdue.')

  const reserved = health.domains.filter((d) => d.state === DOMAIN_STATE.RESERVED).length
  if (reserved) parts.push(`${reserved} domains are reserved and report nothing.`)

  return { line: parts.join(' '), projectCount: (projects || []).length }
}

/**
 * Build the Business Home Dashboard view.
 *
 * @param {object} input
 * @param {object[]} input.projects   FR-040 project payload for the Business
 * @param {object}   input.strategy   FR-041 strategy read model (may be null)
 * @param {object[]} input.domains    the Tier-2 registry (src/config/domains)
 * @param {number}  [input.peopleCount]
 * @param {number}  [input.now]       injected for deterministic tests
 */
export function buildBusinessHomeReadModel({ projects, strategy, domains, peopleCount, now = Date.now() }) {
  const rows = domainHealthRows({ domains, projects, peopleCount, now })
  const scored = rows.filter((d) => d.state === DOMAIN_STATE.SCORED)
  const composite = scored.length
    ? Math.round(scored.reduce((sum, d) => sum + d.score, 0) / scored.length)
    : null

  const health = {
    score: composite,
    // The coverage statement is part of the contract, not decoration: a single
    // number over 7 slots when only 1 is measurable would be a lie by omission.
    covers: scored.map((d) => d.key),
    coverageLabel: `${scored.length} of ${rows.length} domains`,
    domains: rows,
  }

  const attention = attentionQueue({ projects, strategy, now })
  return { health, attention, briefing: briefingLine({ health, attention, projects }) }
}
