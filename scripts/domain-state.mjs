#!/usr/bin/env node
// Domain implementation-readiness projection.
// The source of truth remains the live docs, graph, routes, contracts, schema
// and tests; this module only assembles a machine-readable status snapshot.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'

export const STATUS_VALUES = [
  'verified',
  'partial',
  'planned',
  'blocked',
  'not_implemented',
  'not_applicable',
  'unknown',
]

export const CHECK_NAMES = [
  'ui',
  'httpApi',
  'mcp',
  'runtimeContract',
  'jsonSchema',
  'database',
  'authorization',
  'tests',
]

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']
const API_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const PUBLIC_MUTATION_PATTERN = /@public-mutation\s+(POST|PUT|PATCH|DELETE)\s+FR-\d{3}\b/g
const SOURCE_FILES = [
  'docs/PRD-SDD-v1.0.md',
  'docs/FEATURES.md',
  'docs/domains/*/CHARTER.md',
  'docs/domains/*/features/*.md',
  'docs/INTERFACE-INVENTORY.md',
  'docs/appendices/A-api-spec.md',
  'prisma/schema.prisma',
  'contracts/plan-envelope.schema.json',
  'src/app/**/route.js',
  'src/app/**/page.jsx',
  'src/modules/**/*.js',
  'tests/**/*.{test,spec}.js',
]

const readText = (root, relativePath) => {
  const file = path.join(root, relativePath)
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

const rel = (root, file) => path.relative(root, file).split(path.sep).join('/')

function walkFiles(dir, extensions, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', 'test-results', 'playwright-report', '.test-dbs'].includes(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walkFiles(full, extensions, out)
    else if (extensions.some((extension) => entry.endsWith(extension))) out.push(full)
  }
  return out
}

function normalizeStatus(status) {
  return STATUS_VALUES.includes(status) ? status : 'unknown'
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort()
}

function gap(id, severity, summary, evidence = []) {
  return { id, severity, summary, ...(evidence.length ? { evidence: unique(evidence) } : {}) }
}

function check(status = 'unknown', evidence = [], gaps = [], details = undefined) {
  const result = {
    status: normalizeStatus(status),
    evidence: unique(evidence),
    gaps: gaps.map((item) => ({
      id: item.id,
      severity: item.severity,
      summary: item.summary,
      ...(item.evidence?.length ? { evidence: unique(item.evidence) } : {}),
    })),
  }
  if (details && Object.keys(details).length) result.details = details
  return result
}

function requirementStatus(requirement, code, tests) {
  if (requirement.declared === 'planned') return code.length ? 'partial' : 'planned'
  if (!code.length) return 'not_implemented'
  if (!tests.length) return 'partial'
  return 'verified'
}

function aggregateStatus(statuses, hasEvidence) {
  if (!hasEvidence) return 'not_applicable'
  const relevant = statuses.filter((status) => status !== 'not_applicable')
  if (relevant.includes('blocked')) return 'blocked'
  if (relevant.length && relevant.every((status) => status === 'planned')) return 'planned'
  if (relevant.some((status) => ['partial', 'planned', 'not_implemented', 'unknown'].includes(status))) return 'partial'
  return 'verified'
}

function domainCodeIds(domain, nodes, edges) {
  const modulePrefixes = (domain.modules || []).map((module) => `src/modules/${module}/`)
  const ownedCodeGlobs = domain.owns_code || []
  const ownsCodePath = (codePath) => ownedCodeGlobs.some((glob) => {
    const prefix = glob.replace(/\*\*$/, '').replace(/\/$/, '')
    return glob.endsWith('**') ? (codePath === prefix || codePath.startsWith(`${prefix}/`)) : codePath === prefix
  })
  const ownedRoutePaths = new Set(
    nodes
      .filter((node) => node.type === 'route')
      .filter((route) => edges.some((edge) => edge.type === 'owned_by' && edge.from === route.id && edge.to === domain.id))
      .map((route) => route.path),
  )
  return new Set(
    nodes
      .filter((node) => node.type === 'code_file')
      .filter((node) => modulePrefixes.some((prefix) => node.path.startsWith(prefix)) || ownedRoutePaths.has(node.path) || ownsCodePath(node.path))
      .map((node) => node.id),
  )
}

function routeNodesForDomain(domain, nodes, edges) {
  const owned = new Set(
    edges.filter((edge) => edge.type === 'owned_by' && edge.to === domain.id).map((edge) => edge.from),
  )
  return nodes.filter((node) => node.type === 'route' && owned.has(node.id))
}

function requirementEvidence(domain, nodes, edges, featureRequirements) {
  const reqById = new Map(nodes.filter((node) => node.type === 'requirement' && node.family === 'FR').map((node) => [node.id.slice(4), node]))
  const codeIds = domainCodeIds(domain, nodes, edges)
  const reqIds = new Set(featureRequirements.get(domain.id.slice('domain:'.length)) || [])

  for (const edge of edges) {
    if (edge.type !== 'implements' || !codeIds.has(edge.from) || !edge.to.startsWith('req:')) continue
    reqIds.add(edge.to.slice(4))
  }

  return [...reqIds]
    .filter((id) => reqById.has(id))
    .sort()
    .map((id) => {
      const requirement = reqById.get(id)
      const code = unique(
        edges
          .filter((edge) => edge.to === `req:${id}` && edge.type === 'implements' && codeIds.has(edge.from))
          .map((edge) => nodes.find((node) => node.id === edge.from)?.path),
      )
      const tests = unique(
        edges
          .filter((edge) => edge.to === `req:${id}` && edge.type === 'verifies')
          .map((edge) => nodes.find((node) => node.id === edge.from)?.path),
      )
      return {
        id,
        declared: requirement.declared,
        status: requirementStatus(requirement, code, tests),
        code,
        tests,
      }
    })
}

function interfaceCheck(root, routes) {
  const pages = routes.filter((route) => route.kind === 'page')
  if (!pages.length) return check('not_applicable')

  const inventory = readText(root, 'docs/INTERFACE-INVENTORY.md')
  const missing = []
  const statuses = []
  for (const page of pages) {
    const row = inventory
      .split(/\r?\n/)
      .find((line) => line.startsWith('|') && line.split('|')[1]?.trim().replaceAll('`', '') === page.route)
    if (!row) {
      missing.push(page.route)
      continue
    }
    statuses.push(row.toLowerCase())
  }

  const evidence = ['docs/INTERFACE-INVENTORY.md']
  const gaps = []
  if (missing.length) gaps.push(gap('UI-INVENTORY-001', 'medium', 'UI route is not present in the interface inventory', missing))
  if (statuses.some((status) => /candidate|planned|deferred/.test(status))) {
    gaps.push(gap('UI-STATUS-001', 'medium', 'At least one owned UI surface is not marked implemented', pages.filter((page) => {
      const row = inventory.split(/\r?\n/).find((line) => line.startsWith('|') && line.split('|')[1]?.trim().replaceAll('`', '') === page.route)
      return row && /candidate|planned|deferred/i.test(row)
    }).map((page) => page.route)))
  }
  const status = missing.length || statuses.some((value) => /candidate|planned|deferred/.test(value))
    ? statuses.some((value) => /implemented/.test(value)) ? 'partial' : 'planned'
    : statuses.length === pages.length && statuses.every((value) => /implemented/.test(value)) ? 'verified' : 'unknown'
  return check(status, evidence, gaps, { routes: pages.length, inventoried: statuses.length, missing: missing.length })
}

const normalizeApiPath = (value) => value.replace(/\[([^\]]+)\]/g, '{$1}').replace(/\?.*$/, '')

function exportedRouteMethods(body) {
  return [...body.matchAll(/export\s+(?:(?:async\s+)?function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((match) => match[1])
}

function documentedApiOperations(inventory) {
  const operations = new Set()
  for (const line of inventory.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map((cell) => cell.trim().replaceAll('`', ''))
    const methodGroups = cells[1]?.split(',').map((group) => group.split('/').map((method) => method.trim().toUpperCase()).filter((method) => API_METHODS.includes(method))) || []
    const routes = cells[2]?.split(',').map((route) => route.trim()).filter((route) => route.startsWith('/api/')) || []
    if (!methodGroups.length || !routes.length) continue
    if (routes.length === 1) {
      for (const method of methodGroups.flat()) operations.add(`${method} ${normalizeApiPath(routes[0])}`)
      continue
    }
    for (const [index, route] of routes.entries()) {
      for (const method of (methodGroups[index] || [])) operations.add(`${method} ${normalizeApiPath(route)}`)
    }
  }
  return operations
}

function openApiInventoryOperations(openapi) {
  const operations = new Set()
  const entryPattern = /\[\s*['"](\/api\/[^'"]+)['"]\s*,\s*\[([^\]]*)\]\s*\]/g
  for (const match of openapi.matchAll(entryPattern)) {
    const route = normalizeApiPath(match[1])
    const methods = [...match[2].matchAll(/['"](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)['"]/g)].map((method) => method[1])
    for (const method of methods) operations.add(`${method} ${route}`)
  }
  return operations
}

export function apiCheck(root, routes) {
  const apis = routes.filter((route) => route.kind === 'api')
  if (!apis.length) return check('not_applicable')

  const inventory = readText(root, 'docs/appendices/A-api-spec.md')
  const inventoryPaths = new Set(
    inventory
      .split(/\r?\n/)
      .filter((line) => line.startsWith('|'))
      .flatMap((line) => (line.split('|')[2] || '').replaceAll('`', '').split(',').map((value) => value.trim().split('?')[0]))
      .filter((value) => value.startsWith('/api/')),
  )
  const missingFromInventory = apis.filter((route) => !inventoryPaths.has(route.route))
  const routeOperations = new Set(
    apis.flatMap((route) => exportedRouteMethods(readText(root, route.path)).map((method) => `${method} ${normalizeApiPath(route.route)}`)),
  )
  const appendixOperations = documentedApiOperations(inventory)
  const missingOperationsFromInventory = [...routeOperations].filter((operation) => !appendixOperations.has(operation))
  const openapi = readText(root, 'src/modules/project-manager/api-docs/openapi.js')
  const openApiPaths = unique([
    ...[...openapi.matchAll(/path:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
    ...[...openapi.matchAll(/\[\s*['"](\/api\/[^'"]+)['"]/g)].map((match) => match[1]),
  ].map((value) => value.replace(/\{([^}]+)\}/g, '[$1]')))
  const missingFromOpenApi = apis.filter((route) => !openApiPaths.includes(route.route))
  const openApiOperations = openApiInventoryOperations(openapi)
  const missingOperationsFromOpenApi = [...routeOperations].filter((operation) => !openApiOperations.has(operation))
  const gaps = []
  if (missingFromInventory.length) gaps.push(gap('API-INVENTORY-001', 'high', 'API route is not present in Appendix A', missingFromInventory.map((route) => route.route)))
  if (missingOperationsFromInventory.length) gaps.push(gap('API-INVENTORY-002', 'high', 'API route method is not present in Appendix A', missingOperationsFromInventory))
  if (missingFromOpenApi.length) gaps.push(gap('API-OPENAPI-001', 'high', 'API route is not represented in the machine-readable OpenAPI generator', missingFromOpenApi.map((route) => route.route)))
  if (missingOperationsFromOpenApi.length) gaps.push(gap('API-OPENAPI-002', 'high', 'API route method is not represented in the machine-readable OpenAPI generator', missingOperationsFromOpenApi))
  const status = missingFromInventory.length || missingOperationsFromInventory.length || missingFromOpenApi.length || missingOperationsFromOpenApi.length ? 'partial' : 'verified'
  return check(status, ['docs/appendices/A-api-spec.md', 'src/modules/project-manager/api-docs/openapi.js'], gaps, {
    routes: apis.length,
    inventoried: apis.length - missingFromInventory.length,
    openApiPaths: openApiPaths.length,
    missingFromOpenApi: missingFromOpenApi.length,
    operations: routeOperations.size,
    missingOperationsFromInventory: missingOperationsFromInventory.length,
    missingOperationsFromOpenApi: missingOperationsFromOpenApi.length,
  })
}

function mcpCheck(root, domain, featureDocs) {
  const mcpDocs = featureDocs.filter((doc) => /\bMCP\b/i.test(doc.body))
  const text = mcpDocs.map((doc) => doc.body).join('\n')
  const mentionsMcp = /\bMCP\b/i.test(text)
  const mcpFiles = walkFiles(path.join(root, 'src'), ['.js', '.jsx', '.mjs']).filter((file) => /mcp/i.test(file))
  const protocolTests = walkFiles(path.join(root, 'tests'), ['.js', '.jsx', '.mjs'])
    .filter((file) => /mcp/i.test(file))
    .filter((file) => {
      const body = readText(root, rel(root, file))
      return /initialize/.test(body) && /tools\/list/.test(body) && /tools\/call/.test(body)
    })
  if (!mentionsMcp && !mcpFiles.length) return check('not_applicable')
  if (mcpFiles.length) {
    const evidence = [...mcpFiles, ...protocolTests].map((file) => rel(root, file))
    if (protocolTests.length) return check('verified', evidence)
    return check('partial', evidence, [gap('MCP-VERIFY-001', 'medium', 'MCP implementation exists but requires an explicit protocol test')])
  }
  const outOfScope = /out of scope|not selected|deliberately out of scope/i.test(text)
  return check(outOfScope ? 'planned' : 'not_implemented', mcpDocs.map((doc) => doc.path), [gap('MCP-TRANSPORT-001', 'medium', 'MCP is referenced but no domain MCP adapter is implemented', mcpDocs.map((doc) => doc.path))])
}

function runtimeContractCheck(root, requirements) {
  const planSchema = 'src/modules/project-manager/import/plan-schema.js'
  const hasPlanRuntime = existsSync(path.join(root, planSchema))
  const testEvidence = unique(requirements.flatMap((requirement) => requirement.tests))
  if (!requirements.length) return check('not_applicable')
  if (requirements.every((requirement) => requirement.status === 'verified')) return check('verified', [planSchema, 'docs/TRACE.md'])
  if (hasPlanRuntime && testEvidence.length) return check('partial', [planSchema, 'docs/TRACE.md'], [gap('CONTRACT-001', 'medium', 'At least one requirement in this domain is not fully code-and-test verified')])
  return check('unknown', [planSchema])
}

function jsonSchemaCheck(root, featureDocs) {
  const mentionsPlanSchema = featureDocs.some((doc) => /PlanEnvelope|JSON Schema|schema\.json/i.test(doc.body))
  if (!mentionsPlanSchema) return check('not_applicable')

  const schemaPath = path.join(root, 'contracts', 'plan-envelope.schema.json')
  if (!existsSync(schemaPath)) return check('not_implemented', ['contracts/plan-envelope.schema.json'], [gap('SCHEMA-001', 'high', 'The documented JSON Schema file is missing')])

  try {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
    const ajv = new Ajv2020({ strict: true, allErrors: true })
    ajv.addSchema(schema, schema.$id || 'zuri://contracts/plan-envelope.schema.json')
    return check('verified', ['contracts/plan-envelope.schema.json'])
  } catch (error) {
    return check('blocked', ['contracts/plan-envelope.schema.json'], [gap('SCHEMA-002', 'high', 'JSON Schema does not compile under Ajv strict mode', ['contracts/plan-envelope.schema.json'])], { error: error.message })
  }
}

function databaseCheck(root, domain) {
  const models = domain.owns_models || []
  if (!models.length) return check('not_applicable')
  const schema = readText(root, 'prisma/schema.prisma')
  const missing = models.filter((model) => !new RegExp(`^model\\s+${model}\\s*\\{`, 'm').test(schema))
  if (missing.length) return check('partial', ['prisma/schema.prisma'], [gap('DB-001', 'high', 'Charter-owned model is not present in Prisma schema', missing)], { models: models.length, present: models.length - missing.length })
  return check('verified', ['prisma/schema.prisma'], [], { models: models.length, present: models.length })
}

export function authorizationCheck(root, routes) {
  const apis = routes.filter((route) => route.kind === 'api')
  if (!apis.length) return check('not_applicable')

  let mutations = 0
  let guardedMutations = 0
  let publicMutations = 0
  const unguardedMutationMethods = []
  let reads = 0
  let unguardedReads = 0
  for (const route of apis) {
    const body = readText(root, route.path)
    const methods = [...body.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1])
    const hasViewer = /resolveRequestViewer|requireTrusted|requireViewer|resolveViewer/.test(body)
    const publicMutationMethods = new Set([...body.matchAll(PUBLIC_MUTATION_PATTERN)].map((match) => match[1]))
    for (const method of methods) {
      if (MUTATING_METHODS.includes(method)) {
        mutations += 1
        if (hasViewer) guardedMutations += 1
        else if (publicMutationMethods.has(method)) publicMutations += 1
        else unguardedMutationMethods.push(`${route.path}#${method}`)
      }
      if (method === 'GET') {
        reads += 1
        if (!hasViewer) unguardedReads += 1
      }
    }
  }

  const evidence = ['docs/appendices/A-api-spec.md']
  const gaps = []
  if (unguardedMutationMethods.length) {
    gaps.push(gap('AUTH-001', 'high', 'At least one mutating route lacks a recognizable request viewer seam', unguardedMutationMethods))
  }
  if (unguardedReads) gaps.push(gap('AUTH-002', 'medium', 'At least one read route lacks a recognizable request viewer seam'))
  const status = unguardedMutationMethods.length || unguardedReads ? 'partial' : mutations ? 'verified' : 'unknown'
  return check(status, evidence, gaps, {
    mutations,
    guardedMutations,
    publicMutations,
    unguardedMutations: unguardedMutationMethods.length,
    reads,
    unguardedReads,
  })
}

function testsCheck(requirements) {
  if (!requirements.length) return check('not_applicable')
  const statuses = requirements.map((requirement) => requirement.status)
  const evidence = unique(requirements.flatMap((requirement) => requirement.tests))
  if (statuses.every((status) => status === 'verified')) return check('verified', ['docs/TRACE.md'])
  if (statuses.every((status) => status === 'planned')) return check('planned', ['docs/TRACE.md'])
  return check('partial', ['docs/TRACE.md'], [gap('TEST-001', 'medium', 'At least one requirement lacks complete code-and-test evidence')])
}

function featureDocsForDomain(root, domainName) {
  const dir = path.join(root, 'docs', 'domains', domainName, 'features')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const relativePath = `docs/domains/${domainName}/features/${file}`
      return { path: relativePath, body: readText(root, relativePath) }
    })
}

export function discoverFeatureRequirements(root) {
  const result = new Map()
  for (const domainDir of readdirSync(path.join(root, 'docs', 'domains'))) {
    const docs = featureDocsForDomain(root, domainDir)
    const ids = []
    for (const doc of docs) {
      const id = /^feature:\s*(FR-\d{3})/m.exec(doc.body)?.[1]
      if (id) ids.push(id)
    }
    result.set(domainDir, unique(ids))
  }
  return result
}

export function collectDomainObservations({ root, nodes, edges, featureRequirements = discoverFeatureRequirements(root) }) {
  const observations = {}
  for (const domain of nodes.filter((node) => node.type === 'domain')) {
    const domainName = domain.id.slice('domain:'.length)
    const routes = routeNodesForDomain(domain, nodes, edges)
    const featureDocs = featureDocsForDomain(root, domainName)
    const requirements = requirementEvidence(domain, nodes, edges, featureRequirements)
    observations[domainName] = {
      checks: {
        ui: interfaceCheck(root, routes),
        httpApi: apiCheck(root, routes),
        mcp: mcpCheck(root, domain, featureDocs),
        runtimeContract: runtimeContractCheck(root, requirements),
        jsonSchema: jsonSchemaCheck(root, featureDocs),
        database: databaseCheck(root, domain),
        authorization: authorizationCheck(root, routes),
        tests: testsCheck(requirements),
      },
      evidence: unique([
        `docs/domains/${domainName}/CHARTER.md`,
        ...featureDocs.map((doc) => doc.path),
      ]),
      details: {
        routes: routes.length,
        apiRoutes: routes.filter((route) => route.kind === 'api').length,
        pageRoutes: routes.filter((route) => route.kind === 'page').length,
        ownedModels: domain.owns_models?.length || 0,
        featureNotes: featureDocs.length,
      },
    }
  }
  return observations
}

export function buildDomainState({ nodes, edges, featureRequirements = new Map(), observations = {}, generatedAt }) {
  const domains = {}
  const allGaps = []
  const allStatuses = []

  for (const domain of nodes.filter((node) => node.type === 'domain').sort((a, b) => a.id.localeCompare(b.id))) {
    const name = domain.id.slice('domain:'.length)
    const requirements = requirementEvidence(domain, nodes, edges, featureRequirements)
    const requirementState = requirements.map(({ code, tests, ...requirement }) => ({
      ...requirement,
      codeCount: code.length,
      testCount: tests.length,
      ...(requirement.status !== 'verified' && (code.length || tests.length) ? { evidence: unique([...code, ...tests]) } : {}),
    }))
    const observed = observations[name] || {}
    const checks = {}
    for (const checkName of CHECK_NAMES) checks[checkName] = check('unknown')
    for (const [checkName, value] of Object.entries(observed.checks || {})) {
      if (CHECK_NAMES.includes(checkName)) checks[checkName] = check(value.status, value.evidence, value.gaps, value.details)
    }

    const domainGaps = []
    for (const [checkName, value] of Object.entries(checks)) {
      for (const item of value.gaps) {
        const normalized = { id: item.id, severity: item.severity, check: checkName, summary: item.summary, ...(item.evidence?.length ? { evidence: item.evidence } : {}) }
        domainGaps.push(normalized)
        allGaps.push({ domain: name, ...normalized })
      }
    }
    for (const requirement of requirements) {
      if (['planned', 'not_implemented', 'partial'].includes(requirement.status)) {
        const id = `REQ-${requirement.id}`
        const normalized = {
          id,
          severity: requirement.status === 'not_implemented' ? 'high' : 'medium',
          check: 'requirements',
          summary: `${requirement.id} is ${requirement.status}`,
          evidence: unique([...requirement.code, ...requirement.tests]),
        }
        domainGaps.push(normalized)
        allGaps.push({ domain: name, ...normalized })
      }
    }

    const status = aggregateStatus([...requirements.map((requirement) => requirement.status), ...Object.values(checks).map((value) => value.status)], Boolean(requirements.length || Object.keys(observed).length))
    const evidence = unique([...(observed.evidence || []), ...Object.values(checks).flatMap((value) => value.evidence)])
    domains[name] = {
      status,
      requirements: requirementState,
      checks,
      evidence,
      gaps: domainGaps,
      ...(observed.details ? { details: observed.details } : {}),
    }
    allStatuses.push(status)
  }

  return {
    schemaVersion: '1.0',
    generatedBy: 'scripts/domain-state.mjs',
    generatedAt: generatedAt || new Date().toISOString(),
    generatedFrom: SOURCE_FILES,
    statusVocabulary: STATUS_VALUES,
    overall: {
      status: aggregateStatus(allStatuses, allStatuses.length > 0),
      domainCount: Object.keys(domains).length,
      gapCount: allGaps.length,
      gaps: allGaps,
    },
    domains,
  }
}

export function generateDomainState({ root, nodes, edges, generatedAt }) {
  const featureRequirements = discoverFeatureRequirements(root)
  const observations = collectDomainObservations({ root, nodes, edges, featureRequirements })
  return buildDomainState({ nodes, edges, featureRequirements, observations, generatedAt })
}
