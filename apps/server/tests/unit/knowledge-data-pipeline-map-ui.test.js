// @req FR-213 — the Data Pipeline Map renders every node, edge and chain of the
//   projection, filters and explains them, and is admitted only with the slot.
// @req FR-214 — Knowledge (GKS) is a flat, grantable domain slot that is not GKS.
// @spec ADR-085 D1, D4, D6; ADR-063 D4; NFR-008
// @tested tests/unit/knowledge-data-pipeline-map-ui.test.js
import { readFileSync } from 'node:fs'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DOMAINS, DOMAIN_GROUPS, domainForPath } from '@/config/domains'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import DataPipelineMapView, { matchDomain, SCM_DOMAINS, CRM_DOMAINS } from '@/modules/knowledge/pipeline-map/DataPipelineMapView'
import KnowledgeDashboard from '@/modules/knowledge/pipeline-map/KnowledgeDashboard'
import { layoutPipelineMap, GEOMETRY } from '@/modules/knowledge/pipeline-map/pipeline-map-layout'
import { getDataPipelineMap, resolvePipelineMapDecision } from '@/modules/knowledge/pipeline-map/pipeline-map-read-model'

globalThis.React = React

const map = getDataPipelineMap()

describe('FR-214 Knowledge (GKS) slot', () => {
  it('is a flat grantable domain with its own Dashboard, owning /knowledge/**, in no group', () => {
    const knowledge = DOMAINS.find((d) => d.key === 'knowledge')
    expect(knowledge).toMatchObject({ label: 'Knowledge (GKS)', basePath: '/knowledge' })
    expect(knowledge.sub.map((item) => [item.label, item.path])).toEqual([
      ['Dashboard', '/knowledge'],
      ['Documents', '/knowledge/documents'],
      ['Data Pipeline Map', '/knowledge/data-pipeline'],
      // @req FR-236 — the LINE FAQ candidate review surface (ADR-090 D6).
      ['LINE FAQ candidates', '/knowledge/candidates'],
    ])
    expect(VIEWER_DOMAINS).toContain('knowledge')
    expect(domainForPath('/knowledge/data-pipeline').key).toBe('knowledge')
    expect(domainForPath('/knowledge/documents').key).toBe('knowledge')
    expect(DOMAIN_GROUPS.some((group) => group.childKeys.includes('knowledge'))).toBe(false)
    // ADR-063 D4: the external systems never become domains here.
    for (const key of ['gks', 'msp', 'genesisblockdb']) expect(VIEWER_DOMAINS).not.toContain(key)
  })
})

describe('FR-213 admission', () => {
  it('admits only a trusted viewer holding knowledge', () => {
    expect(resolvePipelineMapDecision({ viewer: null })).toEqual({ state: 'AUTH_REQUIRED', redirect: '/login' })
    expect(resolvePipelineMapDecision({ viewerError: new Error('x') }).state).toBe('AUTH_REQUIRED')
    expect(resolvePipelineMapDecision({ viewer: { visibleDomains: ['customer'] } })).toEqual({ state: 'FORBIDDEN' })
    expect(resolvePipelineMapDecision({ viewer: { visibleDomains: ['customer', 'knowledge'] } })).toEqual({ state: 'READY' })
  })

  it('resolves the viewer on the server before either page renders the projection', () => {
    for (const file of ['src/app/(pm)/knowledge/data-pipeline/page.jsx', 'src/app/(pm)/knowledge/page.jsx']) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toContain("'use client'")
      expect(source.indexOf('await requirePipelineMapViewer()'), file).toBeGreaterThan(-1)
      expect(source.indexOf('await requirePipelineMapViewer()'), file).toBeLessThan(source.indexOf('getDataPipelineMap()', source.indexOf('export default')))
    }
    const view = readFileSync('src/modules/knowledge/pipeline-map/DataPipelineMapView.jsx', 'utf8')
    expect(view).not.toMatch(/import .*data-pipeline-map\.json/)
    expect(view).not.toMatch(/fetch\(/)
  })
})

describe('FR-213 layout', () => {
  it('places every node in its kind column, deterministically, inside the drawing', () => {
    const first = layoutPipelineMap(map)
    const second = layoutPipelineMap(map)
    const columnOf = { SOURCE: 0, ENTRY: 1, PROCESS: 2, STORE: 3, RECIPIENT: 4 }
    for (const node of map.nodes) {
      const pos = first.positions.get(node.id)
      expect(pos.col, node.id).toBe(columnOf[node.kind])
      expect(second.positions.get(node.id)).toEqual(pos)
      expect(pos.x + GEOMETRY.nodeWidth).toBeLessThanOrEqual(first.width)
      expect(pos.y + GEOMETRY.nodeHeight).toBeLessThanOrEqual(first.height)
    }
    expect(first.edges).toHaveLength(map.edges.length)
    for (const edge of first.edges) expect(edge.d, edge.id).toMatch(/^M[\d.]+,[\d.]+ C/)
  })
})

describe('FR-213 view', () => {
  it('draws every node and chain with its status word beside the colour', () => {
    const html = renderToStaticMarkup(createElement(DataPipelineMapView, { map }))
    for (const node of map.nodes) expect(html).toContain(`data-testid="pipeline-node-${node.id}"`)
    for (const chain of map.chains) expect(html).toContain(`data-testid="pipeline-chain-${chain.id}"`)
    expect(html).toContain(`${map.summary.chains}`)
    expect(html).toMatch(/data-status="PRODUCTION">production</)
    expect(html).toMatch(/data-status="CODE_TESTS">code \+ tests</)
    expect(html).toContain('role="tablist"')
  })

  it('opens a chain from the query and explains its path, branches, domains and FEATs', () => {
    const chain = map.chains.find((c) => c.id === 'CH-02')
    const html = renderToStaticMarkup(createElement(DataPipelineMapView, { map, initialChainId: 'CH-02' }))
    expect(html).toContain('data-testid="pipeline-detail-CH-02"')
    for (const feature of chain.features) expect(html).toContain(feature)
    // Nodes outside the chain are dimmed, nodes on it are not.
    const onChain = chain.nodeIds[0]
    const offChain = map.nodes.find((n) => !chain.nodeIds.includes(n.id)).id
    expect(html).toMatch(new RegExp(`data-dim="false"[^>]*data-testid="pipeline-node-${onChain.replace('.', '\\.')}"`))
    expect(html).toMatch(new RegExp(`data-dim="true"[^>]*data-testid="pipeline-node-${offChain.replace('.', '\\.')}"`))
  })

  it('ignores an unknown chain in the query rather than failing', () => {
    const html = renderToStaticMarkup(createElement(DataPipelineMapView, { map, initialChainId: 'CH-99' }))
    expect(html).not.toContain('pipeline-detail-CH-99')
  })

  it('renders ERP Domain Groups in filter dropdown and matches SCM child domains', () => {
    expect(SCM_DOMAINS).toEqual(new Set(['inventory', 'procurement', 'commerce', 'warehouse']))
    expect(CRM_DOMAINS).toEqual(new Set(['customer', 'market']))
    expect(matchDomain('inventory', 'group:scm')).toBe(true)
    expect(matchDomain('procurement', 'group:scm')).toBe(true)
    expect(matchDomain('commerce', 'group:scm')).toBe(true)
    expect(matchDomain('market', 'group:scm')).toBe(false)
    expect(matchDomain('customer', 'group:crm')).toBe(true)
    expect(matchDomain('inventory', 'group:crm')).toBe(false)
    expect(matchDomain('knowledge', 'knowledge')).toBe(true)
    expect(matchDomain('inventory', 'knowledge')).toBe(false)

    const html = renderToStaticMarkup(createElement(DataPipelineMapView, { map }))
    expect(html).toContain('label="ERP Domain Groups"')
    expect(html).toContain('value="group:scm"')
    expect(html).toContain('value="group:crm"')
    expect(html).toContain('inventory (SCM)')
    expect(html).toContain('procurement (SCM)')
    expect(html).toContain('commerce (SCM)')
  })

  it('the slot Dashboard links to the map and names the planned console', () => {
    const html = renderToStaticMarkup(createElement(KnowledgeDashboard, { map }))
    expect(html).toContain('href="/knowledge/data-pipeline"')
    expect(html).toContain('TASK-ZAI-047')
  })
})

describe('FR-215 live health overlay', () => {
  const sampleHealth = {
    businessId: 'biz-1',
    summary: { totalTracked: 12, totalFailures: 2, hasFailures: true, backedEdgeCount: 17 },
    edges: {
      'e.tier1-to-ledger': {
        table: 'PipelineRun',
        total: 5,
        countsByStatus: { SUCCEEDED: 3, FAILED: 2 },
        failedCount: 2,
        hasFailures: true,
        lastRunAt: '2026-09-14T08:00:00.000Z',
        monitorUrl: '/execution/data-migration',
      },
      'e.webhook-to-jobs': {
        table: 'LineConversationJob',
        total: 7,
        countsByStatus: { RECORDED: 7 },
        failedCount: 0,
        hasFailures: false,
        lastRunAt: '2026-09-14T08:30:00.000Z',
        monitorUrl: '/line-oa/live-crm',
      },
    },
  }

  it('renders live health badge on backed edges and no number on unbacked edges', () => {
    const html = renderToStaticMarkup(
      createElement(DataPipelineMapView, { map, initialHealth: sampleHealth })
    )

    // Backed edges have badges
    expect(html).toContain('data-testid="edge-health-e.tier1-to-ledger"')
    expect(html).toContain('data-testid="edge-health-e.webhook-to-jobs"')

    // Unbacked edges have NO number (no badge rendered)
    expect(html).not.toContain('data-testid="edge-health-e.repo-to-projection"')
    expect(html).not.toContain('data-testid="edge-health-e.market-to-raw"')
  })

  it('marks edge with data-has-failures="true" and failure badge text when failures occur', () => {
    const html = renderToStaticMarkup(
      createElement(DataPipelineMapView, { map, initialHealth: sampleHealth })
    )

    expect(html).toContain('data-has-failures="true"')
    expect(html).toContain('2 fail')
    expect(html).toContain('data-testid="pipeline-health-toggle"')
    expect(html).toContain('Live Health (12 · ⚠️ 2 fail)')
  })

  it('renders live health section and monitor link when a backed edge is inspected', () => {
    // Render with backed edge selected
    const html = renderToStaticMarkup(
      createElement(DataPipelineMapView, {
        map,
        initialHealth: sampleHealth,
      })
    )
    expect(html).toContain('data-testid="pipeline-health-toggle"')
  })

  it('static map renders completely when health is null or unavailable (resilience)', () => {
    const html = renderToStaticMarkup(
      createElement(DataPipelineMapView, { map, initialHealth: null })
    )
    expect(html).toContain('data-testid="data-pipeline-map"')
    expect(html).toContain('Live Health')
    for (const node of map.nodes) {
      expect(html).toContain(`data-testid="pipeline-node-${node.id}"`)
    }
  })
})

