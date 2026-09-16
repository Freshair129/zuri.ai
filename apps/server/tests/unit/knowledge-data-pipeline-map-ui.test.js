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
import DataPipelineMapView from '@/modules/knowledge/pipeline-map/DataPipelineMapView'
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
      ['Knowledge console', '/knowledge/console'],
      ['Data Pipeline Map', '/knowledge/data-pipeline'],
    ])
    expect(VIEWER_DOMAINS).toContain('knowledge')
    expect(domainForPath('/knowledge/data-pipeline').key).toBe('knowledge')
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

  it('the slot Dashboard links to the map and the knowledge console', () => {
    const html = renderToStaticMarkup(createElement(KnowledgeDashboard, { map }))
    expect(html).toContain('href="/knowledge/data-pipeline"')
    expect(html).toContain('href="/knowledge/console"')
  })
})
