// @req FR-211 — /control/roadmap carries a Domain map & inventory tab: each
// domain's features, FRs and NFRs with the readiness the generated snapshot records.
// @spec ADR-048 D3, SDD-055, SEC-020, NFR-008, FR-124
// @tested tests/unit/platform-control-domain-map.test.js
import { readFileSync } from 'node:fs'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { featureSubject, projectDomainMap } from '@/modules/platform-control/program-domain-map'
import { getProductReadinessSnapshot } from '@/modules/project-manager/application/product-readiness-read-model'
import DomainMapView from '@/modules/platform-control/components/DomainMapView'
import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'
import { shortRequirementTitle } from '../../scripts/domain-state.mjs'

globalThis.React = React

const snapshot = getProductReadinessSnapshot()
const map = projectDomainMap(snapshot)

describe('FR-211 domain map projection', () => {
  it('projects every chartered domain and agrees with the snapshot counts', () => {
    expect(map.domains.map((domain) => domain.name)).toEqual(Object.keys(snapshot.domains).sort())
    expect(map.overall.domainCount).toBe(snapshot.overall.domainCount)
    expect(map.overall.featureCount).toBe(snapshot.features.length)
    // Every feature lands on exactly one tile — its primary domain.
    expect(map.domains.reduce((sum, domain) => sum + domain.features.length, 0)).toBe(snapshot.features.length)
    for (const domain of map.domains) {
      const source = snapshot.domains[domain.name]
      expect(domain.featureCount).toBe(source.featureCount)
      expect(domain.readyFeatureCount).toBe(domain.features.filter((feature) => feature.readiness === 'ready').length)
      expect(domain.status).toBe(source.status)
      expect(domain.gaps).toHaveLength(source.gaps.length)
    }
  })

  it('lists a domain’s FRs as the ones its primary features bundle, each titled', () => {
    const inventory = map.domains.find((domain) => domain.name === 'inventory')
    const expected = new Set(snapshot.features.filter((f) => f.primaryDomain === 'inventory').flatMap((f) => f.requirementIds))
    expect(inventory.functional.map((row) => row.id).sort()).toEqual([...expected].sort())
    for (const row of map.domains.flatMap((domain) => domain.functional)) {
      expect(row.title.length).toBeGreaterThan(0)
      expect(row.featureIds.length).toBeGreaterThan(0)
    }
  })

  it('places every declared NFR either on a domain whose code follows it or in the unanchored list', () => {
    const nfr = snapshot.nonFunctionalRequirements
    expect(nfr.length).toBeGreaterThanOrEqual(22)
    expect(map.overall.nonFunctionalCount).toBe(nfr.length)
    const placed = new Set([
      ...map.domains.flatMap((domain) => domain.nonFunctional.map((row) => row.id)),
      ...map.unanchoredNonFunctional.map((row) => row.id),
    ])
    expect([...placed].sort()).toEqual(nfr.map((row) => row.id).sort())
    // NFR-008 (design tokens) is followed by this very lane's code.
    expect(map.domains.find((domain) => domain.name === 'platform-control').nonFunctional.map((row) => row.id)).toContain('NFR-008')
  })

  it('sends the client no evidence path lists', () => {
    const json = JSON.stringify(map)
    expect(json).not.toContain('"evidence"')
    expect(json.length).toBeLessThan(JSON.stringify(snapshot).length / 2)
  })

  it('shortens statements to their subject', () => {
    expect(shortRequirementTitle('Platform Programme Roadmap: `/control/roadmap` is an installation-operator-only projection')).toBe('Platform Programme Roadmap')
    expect(shortRequirementTitle('Keyboard: palette เต็มรูปแบบ, aria labels')).toBe('Keyboard: palette เต็มรูปแบบ, aria labels')
    expect(shortRequirementTitle('**Inventory catalogue identity** — the Business-scoped catalogue')).toBe('Inventory catalogue identity')
    expect(shortRequirementTitle('x '.repeat(120)).endsWith('…')).toBe(true)
    expect(featureSubject('Inventory (คลังสินค้า) — counted and uncounted products')).toBe('Inventory (คลังสินค้า)')
  })
})

describe('FR-211 domain map UI', () => {
  it('renders tiles for every domain and the selected domain’s feature, FR and NFR inventory', () => {
    const html = renderToStaticMarkup(createElement(DomainMapView, { domainMap: map }))
    for (const domain of map.domains) expect(html).toContain(`data-testid="domain-tile-${domain.name}"`)
    const first = map.domains[0]
    expect(html).toContain(`data-testid="domain-inventory-${first.name}"`)
    expect(html).toContain('Functional requirements')
    expect(html).toContain('Non-functional requirements')
    for (const feature of first.features) expect(html).toContain(feature.id)
    expect(html).toContain('NFRs no domain code follows')
    // Status never travels by colour alone (NFR-008): each coloured row carries its word.
    expect(html).toMatch(/data-readiness="verified">verified</)
  })

  it('adds the tab to the roadmap board without changing the default programme view', () => {
    const programme = renderToStaticMarkup(createElement(ProgramRoadmapBoard, { domainMap: map }))
    expect(programme).toContain('role="tablist"')
    expect(programme).toContain('Domain map &amp; inventory')
    expect(programme).toContain('Phases, sprints and tasks')
    expect(programme).not.toContain('data-testid="domain-map-view"')

    const domains = renderToStaticMarkup(createElement(ProgramRoadmapBoard, { domainMap: map, initialView: 'domains' }))
    expect(domains).toContain('data-testid="domain-map-view"')
    expect(domains).not.toContain('Phases, sprints and tasks')

    // Without a projection the board is the FR-105 board, unchanged.
    expect(renderToStaticMarkup(createElement(ProgramRoadmapBoard))).not.toContain('role="tablist"')
  })

  it('projects on the server and stays read-only', () => {
    const page = readFileSync('src/app/(control)/control/roadmap/page.jsx', 'utf8')
    const view = readFileSync('src/modules/platform-control/components/DomainMapView.jsx', 'utf8')
    expect(page).not.toContain("'use client'")
    // FR-219 reads the same snapshot for task badges, so the page reads it once.
    expect(page).toContain('const snapshot = getProductReadinessSnapshot()')
    expect(page).toContain('projectDomainMap(snapshot)')
    expect(view).not.toMatch(/import .*(domain-state|product-readiness-read-model)/)
    expect(view).not.toMatch(/fetch\(|method: 'POST'/)
  })
})
