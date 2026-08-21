import { z } from 'zod'
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { zPlanEnvelope, zExternalRef } from '../import/plan-schema'
import { EXECUTION_MODES, PROGRESS_STRATEGIES } from '@/lib/validation/enums'

// @req FR-019 — OpenAPI 3 generated FROM the Zod schemas that actually run at
// request time, so the integration docs cannot drift from validation.
// @spec docs/features/FR-019-enterprise-api.md
// @tested tests/integration/openapi-docs.test.js

extendZodWithOpenApi(z)

// This is the machine-readable mirror of the current Next route tree. The
// integration test enumerates src/app/api/**/route.js and fails when this
// inventory or the generated document falls behind a route change.
export const CURRENT_API_ROUTE_INVENTORY = [
  ['/api/agent/line-delivery', ['POST']], ['/api/agent/line-webhook', ['POST']], ['/api/audit', ['GET']], ['/api/backup/export', ['GET']], ['/api/backup/import', ['POST']],
  ['/api/business/files', ['GET']], ['/api/business/goals', ['POST']], ['/api/business/goals/{id}', ['PATCH']], ['/api/business/goals/{id}/projects', ['POST']], ['/api/business/goals/{id}/projects/{projectId}', ['DELETE']],
  ['/api/business/roadmaps', ['POST']], ['/api/business/roadmaps/{id}', ['PATCH']], ['/api/business/strategy', ['GET']], ['/api/containers', ['POST']], ['/api/containers/{id}', ['PATCH']],
  ['/api/crm/conversations', ['GET']], ['/api/crm/conversations/{id}', ['GET']],
  ['/api/dependencies', ['GET', 'POST']], ['/api/dependencies/{id}', ['DELETE']], ['/api/docs', ['GET']], ['/api/entry', ['GET']], ['/api/files', ['GET', 'POST']], ['/api/files/{id}', ['DELETE']],
  ['/api/files/{id}/content', ['GET']], ['/api/files/{id}/relink', ['POST']], ['/api/files/{id}/reveal', ['POST']], ['/api/files/cache/rebuild', ['POST']], ['/api/files/migrate', ['POST']], ['/api/files/mounts', ['GET', 'POST']], ['/api/files/reconcile', ['POST']],
  ['/api/gates', ['POST']], ['/api/gates/{id}', ['PATCH']], ['/api/import/commit', ['POST']], ['/api/import/dry-run', ['POST']], ['/api/import/template', ['GET']], ['/api/import/xlsx', ['POST']], ['/api/ingest/documents', ['GET', 'POST']], ['/api/mcp', ['POST']],
  ['/api/milestones', ['GET', 'POST']], ['/api/milestones/{id}', ['PATCH']], ['/api/people', ['GET']], ['/api/pipelines/runs', ['GET', 'POST']], ['/api/pipelines/runs/{executionRunId}', ['GET']], ['/api/pipelines/runs/{executionRunId}/events', ['POST']], ['/api/pipelines/runs/{executionRunId}/replay', ['POST']], ['/api/platform/customer-import-reviews', ['GET']], ['/api/platform/customer-import-reviews/{caseId}/decisions', ['POST']], ['/api/platform/customer-import-reviews/targets', ['GET']],
  ['/api/platform/integrations', ['GET', 'POST']], ['/api/platform/integrations/line-registry', ['GET', 'POST']], ['/api/platform/users', ['GET', 'PATCH']], ['/api/profile', ['GET']], ['/api/progress/portfolio', ['GET']], ['/api/progress/project/{id}', ['GET']], ['/api/progress/workstream/{id}', ['GET']],
  ['/api/projects', ['GET', 'POST']], ['/api/projects/{id}', ['GET', 'PATCH', 'DELETE']], ['/api/projects/{id}/dependencies', ['GET']], ['/api/projects/{id}/files', ['GET', 'POST']], ['/api/projects/{id}/files/{fileId}', ['DELETE']], ['/api/projects/{id}/inventory', ['GET']], ['/api/projects/{id}/roadmap', ['GET']], ['/api/projects/{id}/team', ['GET', 'POST', 'PATCH', 'DELETE']], ['/api/projects/{id}/teams', ['GET', 'POST', 'DELETE']], ['/api/projects/{id}/tree', ['GET']], ['/api/projects/overview', ['GET']],
  ['/api/repositories', ['GET', 'POST']], ['/api/repositories/{id}', ['PATCH']], ['/api/repositories/link', ['POST']], ['/api/repositories/link/{id}', ['DELETE']], ['/api/resolve', ['GET']], ['/api/scope', ['GET', 'POST']], ['/api/session/demo', ['POST']], ['/api/teams', ['GET', 'POST']], ['/api/teams/{id}', ['GET', 'PATCH', 'DELETE']], ['/api/teams/{id}/members', ['POST', 'DELETE']], ['/api/viewer', ['GET']],
  ['/api/work', ['GET', 'POST']], ['/api/work/{id}', ['PATCH', 'DELETE']], ['/api/workspaces/{id}', ['PATCH', 'DELETE']], ['/api/workstreams', ['GET', 'POST']], ['/api/workstreams/{id}', ['PATCH', 'DELETE']],
]

const zRouteInventoryRequest = z.record(z.string(), z.unknown()).openapi({
  description: 'Handler-specific request fields are intentionally not inferred here. See Appendix A and live handler validation for the route-specific contract.',
})

const zRouteInventoryResponse = z.any().openapi({
  description: 'Handler-specific response fields are intentionally not inferred here. This operation proves route coverage only; the route and Appendix A remain the detailed contract authority.',
})

const zBinaryResponse = z.string().openapi({ format: 'binary' })

function pathParameters(path) {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({ name: match[1], in: 'path', required: true, schema: z.string() }))
}

function genericRequest(path, method) {
  if (!['post', 'put', 'patch'].includes(method)) return undefined
  if (path === '/api/import/xlsx') {
    return { body: { content: { 'multipart/form-data': { schema: z.object({ file: z.string().openapi({ format: 'binary' }), workspaceId: z.string().optional(), projectId: z.string().optional() }) } } } }
  }
  if (path === '/api/session/demo' || path === '/api/files/{id}/reveal') return undefined
  return { body: { content: { 'application/json': { schema: zRouteInventoryRequest } } } }
}

function genericResponses(path) {
  if (path === '/api/files/{id}/content') return { 200: { description: 'Authorized file content stream', content: { 'application/octet-stream': { schema: zBinaryResponse } } } }
  if (path === '/api/session/demo') return { 303: { description: 'Redirect to the business entry surface' }, 404: json(zError, 'Local demo session is disabled') }
  return {
    200: json(zRouteInventoryResponse, 'Route-specific success response; fields are intentionally not generalized here'),
    400: json(zError, 'Route-specific validation or malformed request error'),
    401: json(zError, 'Authentication required'),
    403: json(zError, 'Viewer is not authorized for the requested scope'),
    404: json(zError, 'Resource or route-specific target was not found'),
  }
}

function registerInventoryOperations(registry) {
  const detailedOperations = new Set(['post /api/import/dry-run', 'post /api/import/commit', 'get /api/resolve', 'get /api/import/template'])
  for (const [path, methods] of CURRENT_API_ROUTE_INVENTORY) {
    for (const method of methods) {
      const methodName = method.toLowerCase()
      if (detailedOperations.has(`${methodName} ${path}`)) continue
      registry.registerPath({
        method: methodName,
        path,
        summary: `Route inventory: ${method} ${path}`,
        description: `Current handler inventory coverage for ${method} ${path}. This generic operation is deliberately transparent: handler-specific request and response fields are not claimed here; use Appendix A and live route validation for the detailed contract.`,
        tags: ['Route inventory'],
        parameters: pathParameters(path),
        request: genericRequest(path, methodName),
        responses: genericResponses(path),
        'x-zuri-contract': 'route-inventory',
      })
    }
  }
}

const zImportRequest = z
  .object({
    plan: zPlanEnvelope,
    workspaceId: z.string().optional(),
    projectId: z.string().optional(),
  })
  .strict()

const zPreviewRow = z.object({
  kind: z.string(),
  code: z.string(),
  title: z.string().optional(),
  reason: z.string().optional(),
  matchedBy: z.enum(['externalRef', 'newMapping']).optional(),
  planCode: z.string().optional(),
})

const zDryRunResponse = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  workspace: z.object({ id: z.string(), code: z.string(), name: z.string() }).nullable().optional(),
  preview: z
    .object({
      inserts: z.array(zPreviewRow),
      updates: z.array(zPreviewRow),
      conflicts: z.array(zPreviewRow),
      dependencyCount: z.number(),
      externalRefCount: z.number(),
      matchedByExternalId: z.number(),
      summary: z.object({ insertCount: z.number(), updateCount: z.number(), conflictCount: z.number() }),
    })
    .nullable(),
})

const zCommitResponse = z.object({
  committed: z.boolean(),
  projectId: z.string().optional(),
  projectCode: z.string().optional(),
  errors: z.array(z.string()).optional(),
})

const zResolveResponse = z.object({
  id: z.string(),
  code: z.string(),
  type: z.string(),
  externalRef: zExternalRef.partial().optional(),
  externalRefs: z
    .array(z.object({ system: z.string(), value: z.string(), labelAs: z.boolean(), verifiedAt: z.string().nullable() }))
    .optional(),
})

const zError = z.object({ error: z.string(), issues: z.array(z.string()).optional() })

const json = (schema, description) => ({ description, content: { 'application/json': { schema } } })

export function buildOpenApiDocument({ serverUrl = '/' } = {}) {
  const registry = new OpenAPIRegistry()
  registry.register('PlanEnvelope', zPlanEnvelope)
  registry.register('ExternalRef', zExternalRef)
  registry.register('ImportRequest', zImportRequest)
  registry.register('DryRunResponse', zDryRunResponse)
  registry.register('CommitResponse', zCommitResponse)
  registry.register('ResolveResponse', zResolveResponse)
  registry.register('Error', zError)

  registry.registerPath({
    method: 'post',
    path: '/api/import/dry-run',
    summary: 'Validate a plan envelope and preview the changes — writes nothing',
    description:
      'Identity is resolved externalRef → code → new. Conflicts (an external id pointing at a different record, ' +
      'a type mismatch, or the same id claimed twice in one batch) are reported, never guessed.',
    tags: ['Intake'],
    request: { body: { content: { 'application/json': { schema: zImportRequest } } } },
    responses: {
      200: json(zDryRunResponse, 'Validation result plus the insert/update/conflict preview'),
      400: json(zError, 'Malformed request'),
    },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/import/commit',
    summary: 'Commit a plan envelope in a single transaction',
    description:
      'Re-runs the dry run and refuses on any conflict. Entities matched by external id are updated in place — ' +
      'their existing code is never overwritten. Every commit appends a PLAN_IMPORTED audit event.',
    tags: ['Intake'],
    request: { body: { content: { 'application/json': { schema: zImportRequest } } } },
    responses: {
      200: json(zCommitResponse, 'Commit result'),
      400: json(zError, 'Malformed request'),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/resolve',
    summary: 'Resolve a record by our code or by the customer’s own core id',
    description: 'Resolve by internal type/code or external system/value. The response preserves the internal id and returns mapped external references without changing primary-key ownership.',
    tags: ['Identity'],
    request: {
      query: z.object({
        type: z.string().optional().openapi({ example: 'PROJECT' }),
        code: z.string().optional().openapi({ example: 'PRJ-B01-TRANSFORM' }),
        system: z.string().optional().openapi({ example: 'SAP' }),
        value: z.string().optional().openapi({ example: 'CUST-88421' }),
      }),
    },
    responses: {
      200: json(zResolveResponse, 'Internal id plus any external ids mapped to it'),
      404: json(zError, 'Nothing matched'),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/import/template',
    summary: 'Download the Excel intake template generated from this schema',
    description: 'Returns the XLSX intake template generated from the same PlanEnvelope contract used by the JSON intake endpoints.',
    tags: ['Intake'],
    responses: { 200: { description: 'XLSX workbook' } },
  })

  registerInventoryOperations(registry)

  const generator = new OpenApiGeneratorV3(registry.definitions)
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Zuri v2 Project Manager — Enterprise Intake API',
      version: '1.1.0',
      description: [
        'Backend-first integration surface. Every intake surface (UI wizard, Excel, agent JSON, this API)',
        'ends at the same pipeline: validate → dry run → preview → transactional commit → audit.',
        '',
        'Identity rules:',
        '- Your core id stays yours: it is mapped onto our internal UUID and never becomes a primary key.',
        '- Our `code` is our namespace; an external id never overwrites it.',
        '- Upsert order is externalRef → code → create.',
        '',
        `Execution modes: ${EXECUTION_MODES.join(', ')}.`,
        `Progress strategies: ${PROGRESS_STRATEGIES.join(', ')}.`,
        '',
        'The document contains complete current route coverage. Operations tagged x-zuri-contract=route-inventory are explicit inventory entries whose handler-specific fields are intentionally not generalized; Appendix A and runtime validation remain authoritative for those details.',
      ].join('\n'),
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: 'Intake', description: 'Plan envelope in, work graph out' },
      { name: 'Identity', description: 'Map customer core ids onto internal records' },
      { name: 'Route inventory', description: 'Complete current route/method coverage with transparent generic boundaries' },
    ],
    'x-zuri-route-inventory': {
      source: 'src/app/api/**/route.js',
      pathCount: CURRENT_API_ROUTE_INVENTORY.length,
      operationCount: CURRENT_API_ROUTE_INVENTORY.reduce((count, [, methods]) => count + methods.length, 0),
    },
  })
}
