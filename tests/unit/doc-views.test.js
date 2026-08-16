import { describe, it, expect } from 'vitest'
import { domainMap, traceView } from '../../scripts/doc-views.mjs'

// The generated human views over the doc graph. Their blindness guards live in
// doc-preflight; these tests pin the rendering contract itself so a refactor
// cannot silently drop a column or a section.

const nodes = [
  { id: 'domain:crm', type: 'domain', path: 'docs/domains/crm/CHARTER.md', modules: ['crm'], owns_models: ['Person'], owns_routes: [] },
  { id: 'domain:agent', type: 'domain', path: 'docs/domains/agent/CHARTER.md', modules: ['agent'], owns_models: [], owns_routes: ['src/app/api/agent/**'] },
  { id: 'req:FR-023', type: 'requirement', family: 'FR', label: 'LINE ingest', declared: 'done' },
  { id: 'req:FR-028', type: 'requirement', family: 'FR', label: 'Webhook seam', declared: 'done' },
  { id: 'code:src/modules/crm/line-ingest-service.js', type: 'code_file', path: 'src/modules/crm/line-ingest-service.js', annotations: { '@spec': ['BR-002'] } },
  { id: 'code:src/app/api/agent/line-webhook/route.js', type: 'code_file', path: 'src/app/api/agent/line-webhook/route.js', annotations: {} },
  { id: 'route:api:/api/agent/line-webhook', type: 'route', kind: 'api', route: '/api/agent/line-webhook', path: 'src/app/api/agent/line-webhook/route.js' },
  { id: 'test:tests/integration/line-ingest.test.js', type: 'test', path: 'tests/integration/line-ingest.test.js' },
  { id: 'feat:FEAT-001', type: 'feature', label: 'File Manager', declared: 'live' },
]
const edges = [
  { from: 'code:src/modules/crm/line-ingest-service.js', to: 'req:FR-023', type: 'implements' },
  { from: 'code:src/app/api/agent/line-webhook/route.js', to: 'req:FR-028', type: 'implements' },
  { from: 'route:api:/api/agent/line-webhook', to: 'domain:agent', type: 'owned_by' },
  { from: 'test:tests/integration/line-ingest.test.js', to: 'req:FR-023', type: 'verifies' },
  { from: 'feat:FEAT-001', to: 'req:FR-028', type: 'bundles' },
]

describe('domainMap', () => {
  const out = domainMap(nodes, edges)

  it('renders a section per domain — the blindness guard keys off these headers', () => {
    expect(out).toContain('## crm')
    expect(out).toContain('## agent')
  })

  it('shows ownership: models for crm, deliberate absence for agent, routes counted', () => {
    expect(out).toMatch(/## crm[\s\S]*Models owned \| Person/)
    expect(out).toMatch(/## agent[\s\S]*outside the shared schema by design/)
    expect(out).toMatch(/## agent[\s\S]*Routes owned \| 1 \(1 api · 0 pages\)/)
  })

  it('derives FRs-in-lane from code paths, not from hand lists', () => {
    expect(out).toMatch(/## crm[\s\S]*FRs implemented in lane \| FR-023/)
  })

  it('declares itself generated', () => {
    expect(out).toContain('Auto-generated')
    expect(out).toContain('Never hand-edit')
  })
})

describe('traceView', () => {
  const out = traceView(nodes, edges)

  it('renders one block per FR — the blindness guard keys off these headers', () => {
    expect(out).toContain('### FR-023 ')
    expect(out).toContain('### FR-028 ')
  })

  it('joins the chain: surface from route nodes, rules from @spec, tests from verifies', () => {
    expect(out).toMatch(/### FR-028[\s\S]*\*\*Surface:\*\* `\/api\/agent\/line-webhook` \(api\)/)
    expect(out).toMatch(/### FR-023[\s\S]*\*\*Follows:\*\* BR-002/)
    expect(out).toMatch(/### FR-023[\s\S]*\*\*Tests:\*\* `tests\/integration\/line-ingest\.test\.js`/)
  })

  it('shows the FEAT bundle on bundled FRs and none on unbundled ones', () => {
    expect(out).toMatch(/### FR-028[\s\S]{0,200}\*\*Feature:\*\* FEAT-001 — File Manager/)
    const fr023 = out.slice(out.indexOf('### FR-023'), out.indexOf('### FR-028'))
    expect(fr023).not.toContain('**Feature:**')
  })
})
