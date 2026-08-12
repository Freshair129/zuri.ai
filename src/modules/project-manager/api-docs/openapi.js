import { z } from 'zod'
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { zPlanEnvelope, zExternalRef } from '../import/plan-schema'
import { EXECUTION_MODES, PROGRESS_STRATEGIES } from '@/lib/validation/enums'

// @req FR-019 — OpenAPI 3 generated FROM the Zod schemas that actually run at
// request time, so the integration docs cannot drift from validation.
// @spec docs/features/FR-019-enterprise-api.md
// @tested tests/integration/openapi-docs.test.js

extendZodWithOpenApi(z)

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
    tags: ['Intake'],
    responses: { 200: { description: 'XLSX workbook' } },
  })

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
      ].join('\n'),
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: 'Intake', description: 'Plan envelope in, work graph out' },
      { name: 'Identity', description: 'Map customer core ids onto internal records' },
    ],
  })
}
