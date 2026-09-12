import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import { buildOpenApiDocument } from '@/modules/project-manager/api-docs/openapi'
import { EXECUTION_MODES } from '@/lib/validation/enums'

// @req FR-019 — the published contract is generated from the schemas that
// actually validate requests, so drift is impossible by construction.

const doc = buildOpenApiDocument({ serverUrl: 'http://localhost:3100' })

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(absolute) : [absolute]
  })
}

function currentRouteInventory() {
  const root = path.resolve(__dirname, '../../src/app/api')
  return listFiles(root)
    .filter((file) => path.basename(file) === 'route.js')
    .map((file) => {
      const relative = path.relative(root, path.dirname(file)).split(path.sep).join('/')
      const source = readFileSync(file, 'utf8')
      const methods = [...source.matchAll(/export\s+(?:(?:async\s+)?function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/g)].map(
        (match) => match[1]
      )
      return {
        path: `/api/${relative}`.replace(/\[([^\]]+)\]/g, '{$1}'),
        methods,
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}

const routeInventory = currentRouteInventory()

describe('OpenAPI document', () => {
  it('is a valid OpenAPI 3 document describing the intake surface', () => {
    expect(doc.openapi).toMatch(/^3\./)
    expect(doc.info.title).toContain('Enterprise Intake API')
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/api/import/dry-run', '/api/import/commit', '/api/resolve'])
    )
    expect(doc.servers[0].url).toBe('http://localhost:3100')
  })

  it('covers every current API route handler in the repository', () => {
    const expectedPaths = routeInventory.map((route) => route.path).sort((left, right) => left.localeCompare(right))
    expect(Object.keys(doc.paths).sort((left, right) => left.localeCompare(right))).toEqual(expectedPaths)

    for (const route of routeInventory) {
      const pathItem = doc.paths[route.path]
      for (const method of route.methods) {
        const operation = pathItem[method.toLowerCase()]
        expect(operation, `${method} ${route.path} is missing from OpenAPI`).toBeTruthy()
        expect(operation.responses, `${method} ${route.path} has no responses`).toBeTruthy()
      }
    }
  })

  it('labels generic inventory coverage without overwriting detailed intake contracts', () => {
    expect(doc['x-zuri-route-inventory']).toMatchObject({
      source: 'src/app/api/**/route.js',
      // FR-066/067's seven onboarding/invite routes — eight operations over
      // those seven paths since the owner roster GET joined the removal DELETE
      // on /api/workspace-memberships — plus FR-106's two
      // (the Enterprise API key mint and revoke) plus FR-108's two
      // (the ExecutionPlanBundle dry-run and commit) plus FR-120's one
      // (self-serve signup — the first public route that creates an identity
      // rather than consuming one) plus FR-123's five over four paths (the
      // plugin token/capabilities/revoke boundary, and authorize twice: GET
      // renders the consent screen, POST is the consent form's own submission
      // and the only operation in the family that mints — ADR-052 D4), plus
      // FR-137..140's nine evidence/intake/import/export/LINE paths, plus
      // FR-092's two (the Market Intelligence observation reader, GET only, and
      // the production translation trigger, POST only — the sole writer of
      // MarketObservation rows, owner-gated). FR-067's owner roster adds a GET to
      // the existing /api/workspace-memberships path (one more operation, no new
      // path). FR-022's one (the PDPA erasure trigger — POST only; the erasure has
      // no preview and leaves a redacted Customer behind). FR-038's Membership
      // attach adds one path and one operation (POST /api/platform/users/memberships);
      // FR-106's key listing adds a GET to the existing /api/platform/api-access-keys
      // path — one more operation, no new path. FR-142's liveness probe adds one
      // path and one operation (GET /api/health — unauthenticated, ADR-058) —
      // bringing the totals to:
      // FR-143/FR-144 add seven paths and eight operations: the credential
      // family (GET+POST on one path, DELETE on another), the four device job
      // operations, and the review surface read.
      // FR-146 adds two paths and four operations: the LINE OA Studio account
      // collection (GET list, POST connect) and item (GET read, PATCH versioned
      // action — archive is an action, never a DELETE). FR-151 adds the rich
      // menu collection and item the same way: two paths, four operations.
      // FR-152 adds the rich menu jobs path (GET, POST, PATCH) and the
      // rich-menu worker tick (POST): two paths, four operations.
      // FR-133/FR-135/FR-136 add eleven paths and fourteen operations: /api/assets/lookup (GET),
      // /api/assets/register (GET, POST), /api/assets/register/{id} (GET), the four
      // lifecycle POST routes (responsibility, relocate, allocate, return),
      // /api/assets/register/{id}/verify (POST),
      // /api/assets/register/{id}/depreciation (GET),
      // /api/assets/register/{id}/maintenance (GET, POST), and
      // /api/assets/register/{id}/dispose (GET, POST).
      // FR-153 adds the LIFF app registry collection and item: two paths, four
      // operations.
      // Marketing FR-159 Strategy and FR-158 PM handoff add three paths and five
      // operations.
      // Campaign FR-160 adds two paths and four operations.
      // FR-157 adds four Content paths and six scoped operations.
      // FR-154/FR-155 add the Inventory domain: eleven paths and twenty
      // operations — six catalogue collections (GET, POST each), the product
      // item (GET, PATCH), lots (GET, POST), the read-only serial-unit list
      // (GET), the ledger (GET, POST) and the stock summary (GET).
      // FR-156 adds recipes: the collection (GET, POST), the item (GET, PATCH)
      // and the atomic build (POST) — three paths, five operations. FR-161
      // adds Operations collection, Intake detail and Handoff detail — three
      // paths and five operations.
      // and the atomic build (POST) — three paths, five operations.
      // FR-161 adds sales tasks: the collection (GET, POST) and the item
      // (GET, PATCH) — two paths, four operations.
      // main carries FR-162 Operations (collection, intake detail, handoff
      // detail) at 184 paths / 252 operations. FR-166/FR-163 add commerce on
      // top: orders (GET, POST), the order item (GET, PATCH), its payments
      // (GET, POST), the payment item (GET, PATCH) and the revenue summary
      // (GET) — five paths, nine operations. FR-164/FR-165 add procurement on
      // top: suppliers (GET, POST), the supplier item (GET, PATCH), purchase
      // orders (GET, POST), the order item (GET, PATCH) and its receipts
      // (GET, POST) — five more paths and ten more operations (194 / 271).
      // FR-110 (ADR-067) adds the knowledge ingestion reporter surface: the
      // job read (GET) and the stage, gate and finish verbs (POST each) —
      // four paths, four operations. FR-110 (ADR-068) adds the pull tick
      // (POST /api/pipelines/knowledge/evidence/pull): one path, one operation.
      // FR-171 adds the owner-only read-only execution trace GET.
      // FR-169 adds the Business capability toggle (PATCH
      // /api/businesses/{id}/capabilities): one path, one operation.
      // FR-173 adds five knowledge admission/corpus paths and six operations.
      // FR-144 browser/Desktop pairing adds three POST paths.
      // FR-149 adds the Business-scoped terminal-failure read model
      // (GET /api/line-oa/jobs/failures): one path, one operation. It is a read
      // model behind the Studio's red failure count, never a retry verb — which
      // is why it adds a GET and nothing else.
      // FR-165 adds two receipt GETs.
      // FR-182 adds the SCM operations console: thirteen paths and
      // twenty-one operations — locations (GET, POST) and the location item
      // (GET, PATCH), the located-stock read (GET), the transfer (POST), both
      // work-order collections (GET, POST each) and items (GET, PATCH each),
      // reservations (GET, POST) and the reservation action (PATCH only — a
      // hold is never deleted and never read one row at a time), ATP (GET),
      // the shelf-life audit and its maintenance write (GET, POST) and
      // de-kitting (POST).
      // FR-184 adds three stocktake paths and three operations. FR-185 adds
      // four Marketing planning/projection paths and six operations. FR-186/183
      // add six paths and seven operations.
      // FR-190 adds the LINE transport reachability read: one path, one
      // operation (GET /api/line-oa/accounts/{id}/transport-health).
      // FR-097 adds identity link tokens and channel identity queries: three paths,
      // three operations (POST /api/identity/link-tokens, POST /api/identity/link-tokens/redeem, GET /api/identity/channel-identities).
      // FR-094/FR-095/FR-096 adds MFA and step-up authentication: four paths, five operations.
      // FR-191 adds the grant-withdrawal surface that had no route at all: two
      // paths, two operations (POST /api/platform/users/memberships/{id}/lifecycle,
      // which carries suspend, reinstate and revoke as one action parameter
      // because the three share every guard, and POST /api/platform/users/offboard).
      // FR-199 adds the access-review reads that had no route at all: two paths,
      // two operations (GET /api/platform/access-history, scoped by exactly one
      // of businessId/tenantId/personId, and GET
      // /api/platform/businesses/{businessId}/grants, the current-state roster).
      // 242 + 4 (MFA) + 2 (FR-191) + 2 (FR-199) + 2 (FR-193 write path) = 252;
      // 331 + 5 + 2 + 2 + 2 = 342. The FR-193 pair is POST
      // /api/people/employment and PATCH /api/people/employment/{employmentId}
      // — one operation each, because the three lifecycle transitions travel as
      // a named `action` on the PATCH rather than as three separate verbs.
      pathCount: 252,
      operationCount: 342,
    })
    expect(doc.paths['/api/projects'].get['x-zuri-contract']).toBe('route-inventory')
    expect(doc.paths['/api/import/dry-run'].post.requestBody).toBeTruthy()
    expect(doc.paths['/api/import/dry-run'].post['x-zuri-contract']).toBeUndefined()
    expect(doc.paths['/api/assets/intakes/validate'].post.requestBody).toBeTruthy()
    expect(doc.paths['/api/assets/intakes/validate'].post['x-zuri-contract']).toBeUndefined()
  })

  it('keeps every operation structurally valid and declares path parameters', () => {
    for (const [routePath, pathItem] of Object.entries(doc.paths)) {
      const pathParameters = [...routePath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!HTTP_METHODS.has(method.toUpperCase())) continue
        expect(operation.summary, `${method.toUpperCase()} ${routePath} has no summary`).toBeTruthy()
        expect(operation.description, `${method.toUpperCase()} ${routePath} has no limitation/contract description`).toBeTruthy()
        expect(operation.responses, `${method.toUpperCase()} ${routePath} has no responses`).toBeTruthy()
        for (const [status, response] of Object.entries(operation.responses)) {
          expect(status === 'default' || /^\d{3}$/.test(status)).toBe(true)
          expect(response.description, `${method.toUpperCase()} ${routePath} response ${status} has no description`).toBeTruthy()
        }
        const declaredParameters = (pathItem.parameters || []).concat(operation.parameters || [])
        for (const parameter of pathParameters) {
          expect(
            declaredParameters.some((entry) => entry.name === parameter && entry.in === 'path' && entry.required === true),
            `${method.toUpperCase()} ${routePath} does not declare required path parameter ${parameter}`
          ).toBe(true)
        }
      }
    }
  })

  it('carries the real execution-mode enum, not a hand-written copy', () => {
    const modes = doc.components.schemas.PlanEnvelope.properties.workstreams.items.properties.executionMode
    expect(modes.enum).toEqual(EXECUTION_MODES)
  })

  it('documents externalRefs on every entity a customer can key', () => {
    const envelope = doc.components.schemas.PlanEnvelope.properties
    const workstream = envelope.workstreams.items.properties
    expect(envelope.project.properties.externalRefs).toBeTruthy()
    expect(workstream.externalRefs).toBeTruthy()
    expect(workstream.items.items.properties.externalRefs).toBeTruthy()
    expect(workstream.milestones.items.properties.externalRefs).toBeTruthy()
    expect(workstream.gates.items.properties.externalRefs).toBeTruthy()
    expect(workstream.containers.items.properties.externalRefs).toBeTruthy()
  })

  it('keeps strict() visible to integrators as additionalProperties:false', () => {
    expect(doc.components.schemas.PlanEnvelope.additionalProperties).toBe(false)
    expect(doc.components.schemas.AssetIntakeEnvelope.additionalProperties).toBe(false)
    expect(doc.components.schemas.ExternalRef.required).toEqual(expect.arrayContaining(['system', 'id']))
  })

  it('accepts legacy envelope versions and the stable identity version', () => {
    expect(doc.components.schemas.PlanEnvelope.properties.schemaVersion.enum).toEqual(['1.0', '1.1', '1.2'])
  })

  it('is deterministic — same input, byte-identical document', () => {
    expect(JSON.stringify(buildOpenApiDocument({ serverUrl: 'http://localhost:3100' }))).toBe(JSON.stringify(doc))
  })
})

// The published JSON Schema contract is hand-maintained for consumers that
// cannot read OpenAPI. This guard fails the build the moment it drifts from the
// Zod schema that actually runs.
describe('contracts/plan-envelope.schema.json mirrors the Zod schema', () => {
  const contract = JSON.parse(
    readFileSync(path.resolve(__dirname, '../../contracts/plan-envelope.schema.json'), 'utf8')
  )
  const generated = doc.components.schemas.PlanEnvelope
  const defs = contract.$defs

  const propertyNames = (schema) => Object.keys(schema.properties || {}).sort()

  it('exposes the same top-level fields', () => {
    expect(propertyNames(contract)).toEqual(propertyNames(generated))
    expect(contract.properties.schemaVersion.enum).toEqual(generated.properties.schemaVersion.enum)
  })

  it('exposes the same entity fields', () => {
    const gws = generated.properties.workstreams.items
    expect(propertyNames(contract.properties.workstreams.items)).toEqual(propertyNames(gws))
    expect(propertyNames(contract.properties.project)).toEqual(propertyNames(generated.properties.project))
    expect(propertyNames(defs.item)).toEqual(propertyNames(gws.properties.items.items))
    expect(propertyNames(defs.container)).toEqual(propertyNames(gws.properties.containers.items))
    expect(propertyNames(defs.milestone)).toEqual(propertyNames(gws.properties.milestones.items))
    expect(propertyNames(defs.gate)).toEqual(propertyNames(gws.properties.gates.items))
    expect(propertyNames(defs.externalRef)).toEqual(propertyNames(doc.components.schemas.ExternalRef))
  })

  it('keeps the execution enums identical', () => {
    const gws = generated.properties.workstreams.items
    expect(contract.properties.workstreams.items.properties.executionMode.enum).toEqual(
      gws.properties.executionMode.enum
    )
    expect(contract.properties.workstreams.items.properties.progressStrategy.enum).toEqual(
      gws.properties.progressStrategy.enum
    )
  })
})
