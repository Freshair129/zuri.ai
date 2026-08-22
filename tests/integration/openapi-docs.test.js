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
      pathCount: 84,
      operationCount: 115,
    })
    expect(doc.paths['/api/projects'].get['x-zuri-contract']).toBe('route-inventory')
    expect(doc.paths['/api/import/dry-run'].post.requestBody).toBeTruthy()
    expect(doc.paths['/api/import/dry-run'].post['x-zuri-contract']).toBeUndefined()
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
