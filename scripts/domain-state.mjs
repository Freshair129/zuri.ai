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

/**
 * @req FR-124 — the one place the readiness weighting is decided.
 *
 * OPEN QUESTION FOR THE OWNER — these three numbers are a policy choice, not a
 * derived fact. Nothing measures that a declared requirement is worth a fifth of
 * a delivered one, or that code and tests weigh the same; somebody picked 20/40/40
 * because it reads sensibly, and every percentage the Product Readiness dashboard
 * prints inherits that pick. It is stated here, once, and printed beside the
 * numbers in the UI and in the machine-readable snapshot, precisely so it stays a
 * decision an owner can overrule rather than a fact the product quietly asserts.
 * Changing a weight here changes every number on the dashboard and nothing else.
 *
 * The weights must total 100: `progressPercent` is published to a schema that
 * bounds it at 100, and the UI renders it as a progress bar.
 */
export const PROGRESS_METHODOLOGY = {
  version: '1.0',
  declarationWeight: 20,
  codeWeight: 40,
  testWeight: 40,
  featureRollup: 'Mean of the progress percentages of the feature requirements',
  domainRollup: 'Mean of unique requirement progress percentages in primary-domain features',
  readinessRule: 'Ready requires every underlying requirement to be verified and an explicit FEAT bundle to be live',
}

const WEIGHT_TOTAL = PROGRESS_METHODOLOGY.declarationWeight
  + PROGRESS_METHODOLOGY.codeWeight
  + PROGRESS_METHODOLOGY.testWeight
if (WEIGHT_TOTAL !== 100) {
  throw new Error(`PROGRESS_METHODOLOGY weights must total 100, got ${WEIGHT_TOTAL}`)
}

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']
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

function roundPercent(value) {
  return Math.round(value * 10) / 10
}

// @req FR-124 — one requirement's score, under the weighting declared above.
// `declared === 'planned'` forfeits the declaration share even when code exists,
// because a requirement nobody has admitted is in progress is not progress.
function requirementProgress(requirement) {
  return (requirement.declared === 'planned' ? 0 : PROGRESS_METHODOLOGY.declarationWeight)
    + (requirement.code.length ? PROGRESS_METHODOLOGY.codeWeight : 0)
    + (requirement.tests.length ? PROGRESS_METHODOLOGY.testWeight : 0)
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

/**
 * Every declared FR with its evidence, counted across the whole repository.
 *
 * @req FR-124 — deliberately a different denominator from `requirementEvidence`
 * above, which counts only the code a domain's charter owns. A feature is a
 * product statement, so its progress must count every file that implements it,
 * including files in another domain's lane. The two numbers can therefore differ
 * for the same FR — the global one is never smaller — and that is the intent, not
 * drift. `requirementEvidence` is untouched, so the per-domain checks this file
 * already published keep reporting exactly what they always did.
 */
function globalRequirementEvidence(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  return nodes
    .filter((node) => node.type === 'requirement' && node.family === 'FR')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((requirement) => {
      const code = unique(
        edges
          .filter((edge) => edge.to === requirement.id && edge.type === 'implements')
          .map((edge) => nodeById.get(edge.from)?.path),
      )
      const tests = unique(
        edges
          .filter((edge) => edge.to === requirement.id && edge.type === 'verifies')
          .map((edge) => nodeById.get(edge.from)?.path),
      )
      const observation = {
        id: requirement.id.slice(4),
        title: requirement.label,
        declared: requirement.declared,
        code,
        tests,
      }
      return {
        ...observation,
        status: requirementStatus(requirement, code, tests),
        progressPercent: requirementProgress(observation),
      }
    })
}

const READINESS_METADATA_BLOCK = /<!-- readiness-metadata:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- readiness-metadata:end -->/

/**
 * @req FR-124 — read the hand-maintained presentation contract out of the FEAT
 * registry. Throwing here rather than returning `[]` is the point: the block
 * carries the one thing no generator can derive — what a Human can use the
 * feature for — so its absence is a missing answer, not an empty one.
 */
export function parseFeaturePresentation(root) {
  const source = readText(root, 'docs/FEATURES.md')
  const match = READINESS_METADATA_BLOCK.exec(source)
  if (!match) {
    throw new Error(
      'docs/FEATURES.md is missing the readiness presentation metadata block '
      + '(a ```json fence between <!-- readiness-metadata:start --> and <!-- readiness-metadata:end -->)',
    )
  }
  let rows
  try {
    rows = JSON.parse(match[1])
  } catch (error) {
    throw new Error(`docs/FEATURES.md readiness metadata is invalid JSON: ${error.message}`)
  }
  if (!Array.isArray(rows)) throw new Error('docs/FEATURES.md readiness metadata must be a JSON array')
  return rows
}

/**
 * Project every complete feature once: each explicit FEAT bundle, plus each FR
 * that no bundle claims (ADR-025 rev 2 — an unbundled FR is a feature of one).
 *
 * @req FR-124 — a partial list is a wrong answer, so this never silently drops an
 * item or infers a domain. Missing, duplicated, unknown or use-case-less metadata
 * aborts generation and names the ids at fault.
 *
 * `presentation === null` means "this caller is not projecting features at all"
 * and is reachable only from a direct `buildDomainState` call that omits the
 * argument — the focused unit fixtures for the domain half. An actual array,
 * INCLUDING an empty one, is always validated in full. An earlier draft of this
 * function returned `[]` for an empty array, which meant a `readiness-metadata`
 * block containing `[]` disabled the whole guard and reported success: the check
 * was correct but its input could not express the failure it was checking for.
 */
function buildFeatureProjection({ nodes, edges, domains, presentation, requirements }) {
  if (presentation === null) return []

  const requirementById = new Map(requirements.map((requirement) => [requirement.id, requirement]))
  const bundleNodes = nodes.filter((node) => node.type === 'feature').sort((a, b) => a.id.localeCompare(b.id))
  const bundledRequirementIds = new Set()
  const candidates = bundleNodes.map((feature) => {
    const requirementIds = unique(
      edges
        .filter((edge) => edge.from === feature.id && edge.type === 'bundles')
        .map((edge) => edge.to.replace(/^req:/, '')),
    )
    for (const id of requirementIds) bundledRequirementIds.add(id)
    return {
      id: feature.id.replace(/^feat:/, ''),
      title: feature.label,
      kind: 'bundle',
      registryStatus: feature.declared,
      requirementIds,
    }
  })

  for (const requirement of requirements) {
    if (bundledRequirementIds.has(requirement.id)) continue
    candidates.push({
      id: requirement.id,
      title: requirement.title,
      kind: 'requirement',
      registryStatus: requirement.declared === 'planned' ? 'planned' : 'live',
      requirementIds: [requirement.id],
    })
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id))

  const presentationById = new Map()
  for (const row of presentation) {
    if (!row || typeof row !== 'object') throw new Error('Every readiness metadata entry must be an object')
    if (!/^(FEAT|FR)-\d{3}$/.test(row.id || '')) throw new Error(`Invalid readiness metadata id: ${row.id || '(missing)'}`)
    if (presentationById.has(row.id)) throw new Error(`Duplicate readiness metadata for ${row.id}`)
    if (!domains[row.primaryDomain]) throw new Error(`${row.id} names unknown primary domain ${row.primaryDomain || '(missing)'}`)
    if (typeof row.useCase !== 'string' || !row.useCase.trim()) throw new Error(`${row.id} has no example use case`)
    presentationById.set(row.id, { primaryDomain: row.primaryDomain, useCase: row.useCase.trim() })
  }

  const expectedIds = new Set(candidates.map((candidate) => candidate.id))
  const missing = [...expectedIds].filter((id) => !presentationById.has(id))
  const extra = [...presentationById.keys()].filter((id) => !expectedIds.has(id))
  if (missing.length) {
    throw new Error(
      `Readiness metadata is missing projected features: ${missing.join(', ')}`
      + ' — add one { id, primaryDomain, useCase } row per id to the readiness-metadata block in docs/FEATURES.md',
    )
  }
  if (extra.length) {
    throw new Error(
      `Readiness metadata names non-projected features: ${extra.join(', ')}`
      + ' — an id is projected only as a FEAT row or as an FR that no FEAT row bundles',
    )
  }

  return candidates.map((candidate) => {
    const metadata = presentationById.get(candidate.id)
    const featureRequirements = candidate.requirementIds.map((id) => requirementById.get(id)).filter(Boolean)
    if (featureRequirements.length !== candidate.requirementIds.length) {
      const unknown = candidate.requirementIds.filter((id) => !requirementById.has(id))
      throw new Error(`${candidate.id} bundles unknown requirements: ${unknown.join(', ')}`)
    }
    const progressPercent = roundPercent(
      featureRequirements.reduce((sum, requirement) => sum + requirement.progressPercent, 0) / featureRequirements.length,
    )
    const blockers = featureRequirements
      .filter((requirement) => requirement.status !== 'verified')
      .map((requirement) => `${requirement.id} is ${requirement.status}`)
    if (candidate.kind === 'bundle' && candidate.registryStatus !== 'live') {
      blockers.unshift(`${candidate.id} registry status is ${candidate.registryStatus}`)
    }
    const ready = blockers.length === 0
    const contributorDomains = Object.entries(domains)
      .filter(([, domain]) => domain.requirements.some((requirement) => candidate.requirementIds.includes(requirement.id)))
      .map(([name]) => name)
      .sort()
    return {
      ...candidate,
      primaryDomain: metadata.primaryDomain,
      contributorDomains,
      useCase: metadata.useCase,
      progressPercent,
      ready,
      readiness: ready ? 'ready' : 'not_ready',
      blockers,
      requirements: featureRequirements.map((requirement) => ({
        id: requirement.id,
        status: requirement.status,
        progressPercent: requirement.progressPercent,
        codeCount: requirement.code.length,
        testCount: requirement.tests.length,
      })),
      evidence: unique(featureRequirements.flatMap((requirement) => [...requirement.code, ...requirement.tests])),
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

function apiCheck(root, routes) {
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
  const openapi = readText(root, 'src/modules/project-manager/api-docs/openapi.js')
  const openApiPaths = unique([
    ...[...openapi.matchAll(/path:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
    ...[...openapi.matchAll(/\[\s*['"](\/api\/[^'"]+)['"]/g)].map((match) => match[1]),
  ].map((value) => value.replace(/\{([^}]+)\}/g, '[$1]')))
  const missingFromOpenApi = apis.filter((route) => !openApiPaths.includes(route.route))
  const gaps = []
  if (missingFromInventory.length) gaps.push(gap('API-INVENTORY-001', 'high', 'API route is not present in Appendix A', missingFromInventory.map((route) => route.route)))
  if (missingFromOpenApi.length) gaps.push(gap('API-OPENAPI-001', 'high', 'API route is not represented in the machine-readable OpenAPI generator', missingFromOpenApi.map((route) => route.route)))
  const status = missingFromInventory.length || missingFromOpenApi.length ? 'partial' : 'verified'
  return check(status, ['docs/appendices/A-api-spec.md', 'src/modules/project-manager/api-docs/openapi.js'], gaps, {
    routes: apis.length,
    inventoried: apis.length - missingFromInventory.length,
    openApiPaths: openApiPaths.length,
    missingFromOpenApi: missingFromOpenApi.length,
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

function authorizationCheck(root, routes) {
  const apis = routes.filter((route) => route.kind === 'api')
  if (!apis.length) return check('not_applicable')

  let mutations = 0
  let guardedMutations = 0
  let reads = 0
  let unguardedReads = 0
  for (const route of apis) {
    const body = readText(root, route.path)
    const methods = [...body.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1])
    // @req FR-123 / ADR-052 — the plugin auth lifecycle routes authenticate
    // with a durable one-time code or opaque bearer rather than a browser
    // viewer, and capability discovery delegates to the service that then calls
    // resolveViewer itself. They are still server-owned authorization seams, so
    // counting them as viewer-less would understate the coverage this reports.
    const hasViewer = /resolveRequestViewer|requireTrusted|requireViewer|resolveViewer|getPluginCapabilities|exchangePluginAuthorizationCode|revokePluginToken/.test(body)
    for (const method of methods) {
      if (MUTATING_METHODS.includes(method)) {
        mutations += 1
        if (hasViewer) guardedMutations += 1
      }
      if (method === 'GET') {
        reads += 1
        if (!hasViewer) unguardedReads += 1
      }
    }
  }

  const evidence = ['docs/appendices/A-api-spec.md']
  const gaps = []
  if (guardedMutations < mutations) gaps.push(gap('AUTH-001', 'high', 'At least one mutating route lacks a recognizable request viewer seam'))
  if (unguardedReads) gaps.push(gap('AUTH-002', 'medium', 'At least one read route lacks a recognizable request viewer seam'))
  const status = guardedMutations < mutations || unguardedReads ? 'partial' : mutations ? 'verified' : 'unknown'
  return check(status, evidence, gaps, { mutations, guardedMutations, reads, unguardedReads })
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

export function buildDomainState({ nodes, edges, featureRequirements = new Map(), observations = {}, featurePresentation = null, generatedAt }) {
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

  // @req FR-124 — computed once and shared by the feature projection, the domain
  // roll-up and the overall block, so the three can never disagree about an FR.
  const globalRequirements = globalRequirementEvidence(nodes, edges)
  const features = buildFeatureProjection({
    nodes,
    edges,
    domains,
    presentation: featurePresentation,
    requirements: globalRequirements,
  })

  for (const [name, domain] of Object.entries(domains)) {
    const domainFeatures = features.filter((feature) => feature.primaryDomain === name)
    const requirementsById = new Map(
      domainFeatures.flatMap((feature) => feature.requirements).map((requirement) => [requirement.id, requirement]),
    )
    const domainRequirements = [...requirementsById.values()]
    domain.featureIds = domainFeatures.map((feature) => feature.id)
    domain.featureCount = domainFeatures.length
    domain.readyFeatureCount = domainFeatures.filter((feature) => feature.ready).length
    // `null`, not 0: a domain that owns no projected feature has no progress to
    // report, and printing 0% would read as "built nothing" rather than "nothing
    // is claimed here". The schema allows null for exactly this case.
    domain.progressPercent = domainRequirements.length
      ? roundPercent(domainRequirements.reduce((sum, requirement) => sum + requirement.progressPercent, 0) / domainRequirements.length)
      : null
  }

  const verifiedRequirementCount = globalRequirements.filter((requirement) => requirement.status === 'verified').length
  const progressPercent = globalRequirements.length
    ? roundPercent(globalRequirements.reduce((sum, requirement) => sum + requirement.progressPercent, 0) / globalRequirements.length)
    : 0

  return {
    schemaVersion: '1.1',
    generatedBy: 'scripts/domain-state.mjs',
    generatedAt: generatedAt || new Date().toISOString(),
    generatedFrom: SOURCE_FILES,
    statusVocabulary: STATUS_VALUES,
    progressMethodology: PROGRESS_METHODOLOGY,
    overall: {
      status: aggregateStatus(allStatuses, allStatuses.length > 0),
      domainCount: Object.keys(domains).length,
      featureCount: features.length,
      readyFeatureCount: features.filter((feature) => feature.ready).length,
      requirementCount: globalRequirements.length,
      verifiedRequirementCount,
      progressPercent,
      gapCount: allGaps.length,
      gaps: allGaps,
    },
    domains,
    features,
  }
}

export function generateDomainState({ root, nodes, edges, generatedAt }) {
  const featureRequirements = discoverFeatureRequirements(root)
  const observations = collectDomainObservations({ root, nodes, edges, featureRequirements })
  // Always an array here — `parseFeaturePresentation` throws rather than
  // returning nothing — so the real generation path never takes the `null`
  // "not projecting features" branch that the unit fixtures use.
  const featurePresentation = parseFeaturePresentation(root)
  return buildDomainState({ nodes, edges, featureRequirements, observations, featurePresentation, generatedAt })
}
