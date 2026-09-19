import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { buildOpenApiDocument } from '@/modules/project-manager/api-docs/openapi'
import { zFeatureCreateInput, zFeaturePatchInput, zMutationReceipt } from '@/modules/project-manager/application/project-feature-service'
import { zSourceManifestEntry } from '@/modules/project-manager/application/governance-source-verifier'
import { zFeatureRecord } from '@/modules/project-manager/application/project-feature-read-model'
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
      // FR-203/FR-204/FR-206/FR-207 (ADR-083 SKU governance) add five paths and
      // nine operations: GET /api/inventory/products/resolve, the identifier and
      // unit-conversion collections of a SKU (GET, POST, PATCH each — RETIRE is a
      // versioned action, never a DELETE), GET /api/inventory/catalog-hygiene and
      // GET /api/inventory/replenishment. 252 + 5 = 257; 342 + 9 = 351.
      // FR-208/FR-209 (ADR-084 catalogue intake) add six paths and seven
      // operations: the list (GET), preview and commit (POST each), one intake
      // (GET, PATCH — cancel is an action, never a DELETE), the workbook
      // template (GET) and the workbook upload (POST). 257 + 6 = 263; 351 + 7 = 358.
      // FR-218 (ADR-086 D5) adds one path and one operation: the bearer-authenticated
      // programme usage report (POST). 263 + 1 = 264; 358 + 1 = 359.
      // FR-220/FR-221 (ADR-087) add six paths and six operations: harness pairing
      // start, approve and poll (POST each), the operator device list (GET) and item
      // (PATCH), and the harness credential's whoami read (GET). 264 + 6 = 270; 359 + 6 = 365.
      // FR-223/FR-224 (ADR-089) add three paths and three operations: credential
      // rotate, revoke and validate under /api/line-oa/connections/{id} (POST each).
      // 270 + 3 = 273; 365 + 3 = 368.
      // FR-236 (ADR-090 D6) adds three paths and five operations: the candidate
      // list/draft collection (GET, POST), one candidate (GET, PATCH) and the
      // audited APPROVE/REJECT decision (POST). 273 + 3 = 276; 368 + 5 = 373.
      // FR-233 (ADR-091 D5) adds two paths and two operations: conversation
      // search (GET) and per-account follow/unfollow event counts (GET).
      // 276 + 2 = 278; 373 + 2 = 375.
      // FR-237 (ADR-090 D7) adds one path and one operation: the gap report
      // (GET). 278 + 1 = 279; 375 + 1 = 376.
      // FR-236's per-Business toggle (ADR-090 D6, TASK-ZAI-099) adds one path
      // and one operation: the knowledge-candidates-toggle route (PATCH
      // only). 279 + 1 = 280; 376 + 1 = 377.
      // FR-230 (ADR-091 D1, D2) adds one more path and one more operation: the
      // retention sweep's scheduled entry point (POST). 280 + 1 = 281; 377 + 1 = 378.
      // FR-245 (ADR-093 D7, TASK-ZAI-112) adds one more path and one more
      // operation: the chat evidence archive's one retrieval path (POST).
      // 283 + 1 = 284; 380 + 1 = 381.
      // FR-247 (ADR-095 D1) adds two paths and two operations: the error
      // event list (GET) and the resolve action (PATCH). 284 + 2 = 286;
      // 381 + 2 = 383.
      // FR-248, FR-249 (ADR-095 D2, D3) add two paths and three operations:
      // the usage breakdown (GET) and recording one's own usage (POST) share
      // a path, plus the deployment-authenticated rollup (POST) on its own
      // path. 286 + 2 = 288; 383 + 3 = 386.
      // SEC-034 (ADR-093 D6, TASK-ZAI-113) adds one more path and one more
      // operation: the legal-hold recording path (POST). 288 + 1 = 289;
      // 386 + 1 = 387.
      // FR-251 adds one read-only Project Domain-view path and GET operation.
      // FR-252 adds the Identity API-write CSRF issuer (GET only).
      // Negotiated Edge v2 adds two scoped context/tool paths and operations.
      // Pricing adds six paths/seven operations; retain the live CRM legal-hold route.
      // FR-215 (ADR-085 D5) adds the Business-scoped pipeline health read
      // model: one path and one GET operation over the owning-domain ports.
      // Current composed inventory is 316 paths and 420 operations.
      // FR-254 adds six Console paths and seven operations, including GET on
      // the existing source path.
      // The branch's FR-215 pipeline-health route remains in the composition.
      // FR-094/FR-095 adds WebAuthn Passkeys: six paths, seven operations.
      pathCount: 322,
      operationCount: 427,
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

  it('publishes all nine owner mutation operations with exact CSRF, CAS, replay and refusal transport', () => {
    const candidate = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../docs/architecture/project-manager-system/contracts/phase-b/openapi.candidate.json'), 'utf8'))
    const writes = Object.entries(candidate.paths).flatMap(([routePath, item]) => Object.entries(item)
      .filter(([method]) => ['post', 'patch', 'put', 'delete'].includes(method))
      .map(([method, operation]) => ({ path: routePath.replace('{projectId}', '{id}'), method, operation })))
    expect(writes).toHaveLength(9)
    for (const expected of writes) {
      const operation = doc.paths[expected.path][expected.method]
      expect(operation.operationId).toBe(expected.operation.operationId)
      expect(operation.security).toEqual([{ SessionAuth: [] }])
      expect(operation['x-zuri-contract']).toBeUndefined()
      const headers = operation.parameters.filter((entry) => entry.in === 'header')
      for (const name of ['Origin', 'X-CSRF-Token', 'Idempotency-Key']) {
        expect(headers.find((entry) => entry.name === name)?.required, name).toBe(true)
      }
      const append = expected.operation.operationId === 'createProjectFeature' || expected.operation.operationId === 'captureProjectGovernanceSnapshot'
      expect(headers.some((entry) => entry.name === 'If-Match')).toBe(!append)
      expect(operation.responses[200]).toBeTruthy()
      expect(Boolean(operation.responses[201])).toBe(append)
      for (const status of ['400', '401', '403', '404', '409', '422', '503', ...(!append ? ['412', '428'] : [])]) {
        expect(operation.responses[status].content['application/json'].schema.$ref).toBe('#/components/schemas/MutationError')
        expect(operation.responses[status].headers['X-Request-ID'].schema.format).toBe('uuid')
      }
      const successSchema = expected.operation.operationId === 'captureProjectGovernanceSnapshot' ? 'SnapshotCaptureResult' : 'MutationReceipt'
      expect(operation.responses[200].content['application/json'].schema.$ref).toBe('#/components/schemas/' + successSchema)
      expect(operation.responses[200].headers['Cache-Control'].schema.enum).toEqual(['no-store'])
      expect(operation.responses[200].headers.ETag).toBeTruthy()
    }
    expect(doc.paths['/api/projects/{id}/feature-view'].get.responses[200].headers.ETag.description).toContain('Owner-only')
    expect(doc.paths['/api/projects/{id}/features/{featureId}'].get.responses[200].headers.ETag).toBeTruthy()
  })

  it('preserves runtime provenance-pair, receipt-discriminator, patch and path refinements in generated JSON schemas', () => {
    const ajv = new Ajv({ strict: false, allErrors: true })
    addFormats(ajv)
    // OpenAPI 3.0 uses boolean exclusivity; Ajv's draft-07 dialect uses the
    // numeric bound itself. Preserve the exact constraint when adapting it.
    function draft7(value) {
      if (Array.isArray(value)) return value.map(draft7)
      if (!value || typeof value !== 'object') return value
      const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, draft7(child)]))
      for (const [exclusive, bound] of [['exclusiveMinimum', 'minimum'], ['exclusiveMaximum', 'maximum']]) {
        if (typeof result[exclusive] !== 'boolean') continue
        if (result[exclusive]) {
          expect(typeof result[bound]).toBe('number')
          result[exclusive] = result[bound]
          delete result[bound]
        } else delete result[exclusive]
      }
      return result
    }
    const components = draft7(doc.components)
    const compile = (name) => ajv.compile({ components, $ref: '#/components/schemas/' + name })
    const create = compile('FeatureCreateInput')
    const base = { code: 'FE-1', title: 'Feature', problem: 'Problem', outcome: 'Outcome', primaryDomainId: 'DOM-CRM' }
    const uuid = '11111111-1111-4111-8111-111111111111'
    for (const pair of [
      {}, { canonicalFeatureKey: null, governanceSnapshotId: null },
      { canonicalFeatureKey: 'FEAT-001', governanceSnapshotId: uuid },
      { canonicalFeatureKey: 'FEAT-001' }, { governanceSnapshotId: uuid },
      { canonicalFeatureKey: null, governanceSnapshotId: uuid },
      { canonicalFeatureKey: 'FEAT-001', governanceSnapshotId: null },
    ]) expect(create({ ...base, ...pair })).toBe(zFeatureCreateInput.safeParse({ ...base, ...pair }).success)
    const patch = compile('FeaturePatchInput')
    for (const value of [{}, { title: 'Changed' }, { code: 'immutable' }, { lifecycle: 'ACTIVE' }]) {
      expect(patch(value)).toBe(zFeaturePatchInput.safeParse(value).success)
    }
    const record = compile('FeatureRecord')
    const recordBase = {
      ...base, id: uuid, version: 1, projectId: uuid,
      primaryDomain: { domainId: 'DOM-CRM', label: 'Customer', mappingState: 'MAPPED' },
      contributions: [], workLinks: [], requirementBindings: [], lifecycle: 'DRAFT',
      uniqueWorkCount: 0, evidence: [], evidenceState: 'UNAVAILABLE',
    }
    delete recordBase.primaryDomainId
    for (const canonicalFeatureKey of [null, '', 'FEAT-001']) for (const governanceSnapshotId of [null, uuid]) {
      const value = { ...recordBase, canonicalFeatureKey, governanceSnapshotId }
      expect(record(value), JSON.stringify({ canonicalFeatureKey, governanceSnapshotId })).toBe(zFeatureRecord.safeParse(value).success)
    }
    const receipt = compile('MutationReceipt')
    const receiptBase = { receiptId: uuid, targetId: uuid, resourceId: uuid, status: 'COMMITTED', etag: '"token"', recordedAt: '2026-09-17T00:00:00.000Z', auditRef: uuid, requestId: uuid }
    for (const operation of doc.components.schemas.MutationReceipt.properties.operation.enum) {
      for (const targetType of ['PROJECT', 'FEATURE']) for (const httpMethod of ['POST', 'PATCH', 'PUT', 'DELETE']) {
        for (const resourceType of ['PROJECT_FEATURE', 'PROJECT_FEATURE_GRAPH', 'GOVERNANCE_SNAPSHOT']) for (const version of [null, 1]) {
          const value = { ...receiptBase, operation, targetType, httpMethod, resourceType, version }
          expect(receipt(value), JSON.stringify({ operation, targetType, httpMethod, resourceType, version })).toBe(zMutationReceipt.safeParse(value).success)
        }
      }
    }
    const entry = compile('SourceManifestEntry')
    for (const name of ['docs/FEATURES.md', 'docs/a[1]*.md', 'é/file.md', 'one', '/absolute', 'C:/drive', 'C:drive', '../escape', 'a/../escape', './dot', 'a/./dot', 'a//empty', 'trailing/', 'back\\slash', 'nul\u0000file', 'newline\nfile']) {
      const value = { path: name, sha256: 'a'.repeat(64) }
      expect(entry(value), name).toBe(zSourceManifestEntry.safeParse(value).success)
    }
    expect(doc.components.schemas.SourceManifest.properties.schemaVersion.enum).toEqual(['1.0.0'])
    expect(doc.components.schemas.SourceManifest['x-maxBytes']).toBe(1048576)
  })

  it('carries the real execution-mode enum, not a hand-written copy', () => {
    const modes = doc.components.schemas.PlanEnvelope.properties.workstreams.items.properties.executionMode
    expect(modes.enum).toEqual(EXECUTION_MODES)
  })

  // @req FR-252 — the live issuer and Swagger share their strict DTO schemas.
  it('documents the authenticated no-store CSRF issuer and typed refusals', () => {
    const operation = doc.paths['/api/auth/csrf'].get
    expect(operation.operationId).toBe('getApiWriteCsrfToken')
    expect(operation.security).toEqual([{ SessionAuth: [] }])
    expect(operation['x-zuri-contract']).toBeUndefined()
    expect(Object.keys(operation.responses).sort()).toEqual(['200', '401', '403', '503'])
    for (const [status, response] of Object.entries(operation.responses)) {
      expect(response.headers['Cache-Control'].schema.enum).toEqual(['no-store'])
      expect(response.headers).not.toHaveProperty('Access-Control-Allow-Origin')
      if (status !== '200') {
        expect(response.headers['X-Request-ID'].schema.format).toBe('uuid')
        expect(response.content['application/json'].schema.$ref).toBe('#/components/schemas/ApiWriteCsrfError')
      }
    }
    expect(doc.components.schemas.CsrfToken).toMatchObject({
      type: 'object', additionalProperties: false,
      required: ['token', 'expiresAt'],
      properties: { expiresAt: { type: 'string', format: 'date-time' } },
    })
    expect(doc.components.schemas.ApiWriteCsrfError.required).toEqual(['code', 'message', 'requestId', 'retryable'])
    expect(doc.components.schemas.ApiWriteCsrfError.additionalProperties).toBe(false)
  })

  it('publishes bounded Feature reads with runtime schemas and session-only authority', () => {
    const routes = [
      ['/api/projects/{id}/feature-view', 'FeatureView'],
      ['/api/projects/{id}/features', 'FeatureRecordPage'],
      ['/api/projects/{id}/features/{featureId}', 'FeatureRecord'],
      ['/api/projects/{id}/governance-snapshots', 'GovernanceSnapshotPage'],
    ]
    for (const [route, schema] of routes) {
      const operation = doc.paths[route].get
      expect(operation.security).toEqual([{ SessionAuth: [] }])
      expect(operation.responses[200].content['application/json'].schema.$ref).toBe('#/components/schemas/' + schema)
      expect(operation.responses[200].headers['Cache-Control'].schema.enum).toEqual(['no-store'])
      for (const status of [401, 404, 503]) {
        expect(operation.responses[status].content['application/json'].schema.$ref).toBe('#/components/schemas/FeatureReadError')
        expect(operation.responses[status].headers['X-Request-ID'].schema.format).toBe('uuid')
      }
      if (route === '/api/projects/{id}/features') {
        expect(doc.paths[route].post.operationId).toBe('createProjectFeature')
      } else if (route === '/api/projects/{id}/governance-snapshots') {
        expect(doc.paths[route].post.operationId).toBe('captureProjectGovernanceSnapshot')
      } else expect(doc.paths[route].post).toBeUndefined()
    }
    expect(doc.components.schemas.FeatureView.additionalProperties).toBe(false)
    expect(doc.components.schemas.FeatureView.properties.features.maxItems).toBe(200)
    expect(doc.components.schemas.FeatureRecordPage.properties.items.maxItems).toBe(50)
    expect(doc.components.schemas.GovernanceSnapshotMetadata.properties).not.toHaveProperty('sourceManifest')
    expect(doc.components.schemas.GovernanceSnapshotMetadata.properties).not.toHaveProperty('verificationProof')
    expect(doc.paths['/api/projects/{id}/governance-snapshots'].get.responses).toHaveProperty('403')
    expect(doc.paths['/api/projects/{id}/governance-snapshots'].get.responses).toHaveProperty('400')
    expect(doc.paths['/api/projects/{id}/feature-view'].get.responses).toHaveProperty('413')
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
