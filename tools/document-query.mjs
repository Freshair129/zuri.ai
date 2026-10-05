import { readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseQualifiedIdentity } from './document-identity.mjs'
import { parseCanonicalIndex } from '../apps/server/scripts/document-registry-format.mjs'

import { readCanonicalRegistry } from './document-registry.mjs'

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EVIDENCE_TYPES = new Set(['implements', 'verifies', 'tests'])
const EVIDENCE_SOURCES = new Map([
  ['implements', new Set(['annotation', 'qualified-annotation', 'trace-annotation'])],
  ['verifies', new Set(['test-reference', 'trace-annotation', 'transitive'])],
  ['tests', new Set(['annotation'])],
])
const DEPENDENCY_TYPES = new Set(['depends_on'])
const QUERY_FAMILIES = new Set(['FEAT', 'FR', 'NFR', 'BR', 'SEC', 'SDD'])

export class DocumentQueryError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DocumentQueryError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details) {
  throw new DocumentQueryError(code, message, details)
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail('INPUT_READ_ERROR', `Could not read ${label} at ${file}: ${error.message}`, { file })
  }
}

function indexCanonicalRecords(root) {
  const indexPath = path.join(root, 'registry', 'document-registry', 'index.json')
  let index
  try {
    index = parseCanonicalIndex(readFileSync(indexPath, 'utf8'))
  } catch (error) {
    fail('INVALID_CANONICAL_INDEX', `Could not load the canonical document index: ${error.message}`, { file: indexPath })
  }

  let validated
  try {
    validated = readCanonicalRegistry(root)
  } catch (error) {
    fail('INVALID_CANONICAL_RECORD', `Could not validate canonical records: ${error.message}`)
  }
  const records = new Map(validated.map(record => [`${record.namespace}:${record.id}`, record]))
  return { index, records }
}

function loadGraph(file) {
  const graph = readJson(file, 'document graph')
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    fail('INVALID_DOCUMENT_GRAPH', `Document graph ${file} must contain nodes and edges arrays.`, { file })
  }
  const nodes = new Map()
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || typeof node.type !== 'string' || !node.type) {
      fail('INVALID_DOCUMENT_GRAPH', `Document graph ${file} has a node without an id or type.`, { file })
    }
    if (nodes.has(node.id)) fail('INVALID_DOCUMENT_GRAPH', `Document graph ${file} repeats node ${node.id}.`, { file, id: node.id })
    nodes.set(node.id, node)
  }
  for (const edge of graph.edges) {
    if (!edge || typeof edge.from !== 'string' || typeof edge.to !== 'string' || typeof edge.type !== 'string') {
      fail('INVALID_DOCUMENT_GRAPH', `Document graph ${file} has an edge without from, to, and type.`, { file })
    }
  }
  return { graph, nodes }
}

export function loadDocumentQueryContext({ root = TOOL_ROOT, graph: graphOption } = {}) {
  const repositoryRoot = path.resolve(root)
  const graphPath = graphOption
    ? path.resolve(repositoryRoot, graphOption)
    : path.join(repositoryRoot, 'docs', '.doc-graph.json')
  const { index, records } = indexCanonicalRecords(repositoryRoot)
  const { graph, nodes } = loadGraph(graphPath)
  return { root: repositoryRoot, graphPath, index, records, graph, nodes }
}

export function resolveQueryTarget(reference, context) {
  let parsed
  try {
    parsed = parseQualifiedIdentity(reference)
  } catch (error) {
    fail(error.code || 'INVALID_IDENTITY_REFERENCE', error.message, error.details)
  }

  if (parsed?.namespace === 'ZNEXT' || parsed?.namespace === 'edge') {
    return {
      reference,
      namespace: parsed.namespace,
      id: parsed.id,
      namespaceDisposition: parsed.namespace === 'ZNEXT' ? 'provenance-only' : 'edge-separate',
      currentEvidence: false,
      declarationVerified: false,
    }
  }

  const id = parsed?.id ?? reference.trim()
  const matches = [...context.records.values()].filter(record => record.id === id && (!parsed || record.namespace === parsed.namespace))
  if (matches.length > 1) fail('AMBIGUOUS_IDENTITY', `More than one canonical declaration matches ${reference}.`, { reference })
  const record = matches[0]
  if (!record || !QUERY_FAMILIES.has(record.family)) {
    fail('IDENTITY_NOT_FOUND', `No current ZAI canonical declaration matches ${reference}.`, { reference })
  }
  if (parsed && parsed.namespace !== record.namespace) {
    fail('IDENTITY_NOT_FOUND', `No ${parsed.namespace} canonical declaration matches ${reference}.`, { reference })
  }
  const nodeId = record.family === 'FEAT' ? `feat:${record.id}` : `req:${record.id}`
  const node = context.nodes.get(nodeId) || null
  const expectedType = record.family === 'FEAT' ? 'feature' : 'requirement'
  if (node && (node.namespace !== record.namespace || node.type !== expectedType)) {
    fail('GRAPH_DECLARATION_MISMATCH', `Graph node ${nodeId} does not match the ZAI ${expectedType} declaration.`, {
      reference,
      graphNamespace: node.namespace,
      graphType: node.type,
    })
  }
  return {
    reference,
    namespace: record.namespace,
    id: record.id,
    family: record.family,
    path: record.path,
    statement: record.statement,
    recordStatus: record.status,
    sourceRevision: record.recordVersion === 1 ? record.sourceRevision : record.authoredBaseRevision,
    ...(record.recordVersion === 2 ? { provenance: 'authored', approvalRevision: record.approvalRevision, migrationId: record.migrationId } : {}),
    graphNodeId: nodeId,
    graphNode: node,
    currentEvidence: node?.status === 'current',
    declarationVerified: true,
  }
}

function requirementsFor(target, context) {
  if (target.namespace !== 'ZAI' || !target.declarationVerified) return []
  if (target.family !== 'FEAT') return [target.id]
  const feature = context.records.get(`${target.namespace}:${target.id}`)
  const members = feature?.requirementKeys || []
  for (const id of members) {
    const requirement = context.records.get(`ZAI:${id}`)
    if (!requirement || requirement.family !== 'FR') {
      fail('INVALID_FEATURE_MEMBERSHIP', `${target.id} explicitly lists ${id}, which is not a canonical FR.`, { feature: target.id, requirement: id })
    }
    const graphNode = context.nodes.get(`req:${id}`)
    if (graphNode && (graphNode.namespace !== 'ZAI' || graphNode.type !== 'requirement')) {
      fail('GRAPH_DECLARATION_MISMATCH', `Graph node req:${id} does not match the ZAI requirement declaration.`, { feature: target.id, requirement: id })
    }
  }
  return [...members]
}

function nodePath(node) {
  return typeof node?.path === 'string' ? node.path : null
}

function safeFilePath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.posix.isAbsolute(relativePath) || relativePath.includes('\\')) return null
  const segments = relativePath.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null
  const absolute = path.resolve(root, ...segments)
  const rel = path.relative(root, absolute)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  try {
    const realRelative = path.relative(realpathSync(root), realpathSync(absolute))
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return null
    return statSync(absolute).isFile() ? absolute : null
  } catch {
    return null
  }
}

function appForPath(file) {
  const match = /^(apps\/server|apps\/edge|services\/(?:conversation-runtime|market-intelligence))\//.exec(file)
  return match?.[1] || null
}

function powershellArg(value) {
  return `'${value.replace(/'/g, "''")}'`
}

function runnerFor(app, files) {
  if (app === 'apps/server') return files.some(file => file.startsWith('apps/server/tests/e2e/')) ? 'playwright' : 'vitest'
  return app === 'apps/edge' ? 'node-test-tsx' : 'node-test'
}

function commandForFiles(app, files, root) {
  const testPaths = files.map(file => file.slice(`${app}/`.length))
  const runner = runnerFor(app, files)
  let argv
  if (runner === 'playwright') argv = ['npm', '--prefix', app, 'run', 'test:e2e', '--', ...testPaths]
  else if (app === 'apps/server') argv = ['npm', '--prefix', app, 'test', '--', ...testPaths]
  else if (app === 'apps/edge') argv = ['node', '--import', 'tsx', '--test', ...testPaths]
  else argv = ['node', '--test', ...testPaths]
  const cwd = app === 'apps/server' ? root : path.join(root, app)
  const invocation = `${argv[0]} ${argv.slice(1).map(powershellArg).join(' ')}`
  return { runner, argv, cwd, command: `Push-Location -LiteralPath ${powershellArg(cwd)}; try { ${invocation} } finally { Pop-Location }` }
}

function normalizeGraphPath(file) {
  if (/^(?:apps|services)\//.test(file)) return file
  return `apps/server/${file}`
}

function graphBindings(context, requirementId, edgeType, sourceType) {
  const reqNodeId = `req:${requirementId}`
  const reqNode = context.nodes.get(reqNodeId)
  if (!reqNode || reqNode.namespace !== 'ZAI' || reqNode.type !== 'requirement' || reqNode.status !== 'current') return []
  return context.graph.edges
    .filter(edge => edge.type === edgeType && edge.to === reqNodeId && isCurrentEvidence(edge, context))
    .map(edge => ({ edge, node: context.nodes.get(edge.from) }))
    .filter(({ node }) => node?.type === sourceType && node.status === 'current')
}

function isCurrentEvidence(edge, context) {
  if (edge.status !== 'current' || !EVIDENCE_SOURCES.get(edge.type)?.has(edge.source)) return false
  return [edge.from, edge.to].every(id => {
    const node = context.nodes.get(id)
    if (!node) return false
    const namespace = node.namespace
    return !namespace || namespace === 'ZAI'
  })
}

function bindingPath(context, node) {
  const declaredPath = nodePath(node)
  const legacyIdPath = !declaredPath && typeof node.id === 'string' ? node.id.slice(node.id.indexOf(':') + 1) : null
  const file = declaredPath || (legacyIdPath ? normalizeGraphPath(legacyIdPath) : null)
  const absolute = safeFilePath(context.root, file)
  return { file, exists: Boolean(absolute), app: file ? appForPath(file) : null, absolute }
}

export function queryTestsFor(reference, context) {
  const target = resolveQueryTarget(reference, context)
  if (!target.declarationVerified) {
    return {
      target,
      requirements: [],
      bindings: [],
      files: [],
      missingFiles: [],
      commands: [],
      note: 'This namespace is not queried as current ZAI verification evidence.',
    }
  }
  const requirements = requirementsFor(target, context)
  const bindings = []
  for (const requirement of requirements) {
    for (const { edge, node } of graphBindings(context, requirement, 'verifies', 'test')) {
      const location = bindingPath(context, node)
      const invocation = location.exists && location.app ? commandForFiles(location.app, [location.file], context.root) : null
      bindings.push({
        requirement: `ZAI:${requirement}`,
        testNode: node.id,
        path: location.file,
        exists: location.exists,
        app: location.app,
        edgeStatus: edge.status,
        source: edge.source || null,
        ...(invocation ? { runner: invocation.runner, command: invocation.command, argv: invocation.argv, cwd: invocation.cwd } : {}),
      })
    }
  }
  const uniqueBindings = [...new Map(bindings.map(binding => [`${binding.requirement}\u0000${binding.testNode}`, binding])).values()]
  const files = [...new Set(uniqueBindings.filter(binding => binding.exists).map(binding => binding.path))].sort()
  const missingFiles = [...new Set(uniqueBindings.filter(binding => !binding.exists).map(binding => binding.path).filter(Boolean))].sort()
  const commandGroups = new Map()
  for (const binding of uniqueBindings) {
    if (!binding.exists || !binding.app || !binding.command) continue
    const key = `${binding.app}\u0000${binding.runner}`
    if (!commandGroups.has(key)) commandGroups.set(key, { app: binding.app, runner: binding.runner, files: new Set() })
    commandGroups.get(key).files.add(binding.path)
  }
  const commands = [...commandGroups.values()].sort((a, b) => `${a.app}:${a.runner}`.localeCompare(`${b.app}:${b.runner}`)).map(group => {
    const files = [...group.files].sort()
    return { app: group.app, runner: group.runner, files, ...commandForFiles(group.app, files, context.root) }
  })
  return {
    target,
    requirements: requirements.map(id => `ZAI:${id}`),
    bindings: uniqueBindings,
    files,
    missingFiles,
    commands,
    note: 'Graph bindings are not evidence that tests were executed or passed.',
  }
}

function nodeSummary(node) {
  return {
    id: node.id,
    type: node.type,
    path: node.path || node.canonical_path || null,
    status: node.status || null,
  }
}

export function queryImpact(reference, context) {
  const target = resolveQueryTarget(reference, context)
  if (!target.declarationVerified) {
      return {
        target,
        evidence: [],
        unverifiedEvidence: [],
        dependencies: [],
      typedRelations: [],
      navigationOnly: [],
      weakReferences: [],
      reviewSet: [],
      note: 'This namespace is not queried as current ZAI graph evidence.',
    }
  }
  if (!target.currentEvidence) {
    return {
      target,
      evidence: [],
      unverifiedEvidence: [],
      dependencies: [],
      typedRelations: [],
      navigationOnly: [],
      weakReferences: [],
      reviewSet: [],
      note: 'No current namespace-matched graph node is available; no current graph relations were queried.',
    }
  }
  const nodeId = target.graphNodeId
  const queryNodes = new Map([[nodeId, null]])
  if (target.family === 'FEAT') {
    for (const id of requirementsFor(target, context)) {
      const memberNodeId = `req:${id}`
      const member = context.nodes.get(memberNodeId)
      if (member?.namespace === 'ZAI' && member.status === 'current') queryNodes.set(memberNodeId, id)
    }
  }
  const incident = context.graph.edges.filter(edge => queryNodes.has(edge.from) || queryNodes.has(edge.to))
  const decorate = edge => {
    const anchor = edge.from === nodeId || edge.to === nodeId
      ? nodeId
      : queryNodes.has(edge.to) ? edge.to : edge.from
    return {
      direction: edge.from === anchor ? 'outbound' : 'inbound',
      via: queryNodes.get(anchor) ? `ZAI:${queryNodes.get(anchor)}` : null,
      type: edge.type,
      status: edge.status || null,
      source: edge.source || null,
      from: nodeSummary(context.nodes.get(edge.from) || { id: edge.from, type: 'unknown' }),
      to: nodeSummary(context.nodes.get(edge.to) || { id: edge.to, type: 'unknown' }),
    }
  }
  const evidence = incident.filter(edge => EVIDENCE_TYPES.has(edge.type) && isCurrentEvidence(edge, context)).map(decorate)
  const unverifiedEvidence = incident.filter(edge => EVIDENCE_TYPES.has(edge.type) && !isCurrentEvidence(edge, context)).map(decorate)
  const dependencies = incident.filter(edge => DEPENDENCY_TYPES.has(edge.type)).map(decorate)
  const navigationOnly = incident.filter(edge => edge.type === 'relates').map(decorate)
  const weakReferences = incident.filter(edge => edge.type === 'references').map(decorate)
  const typedRelations = incident.filter(edge => !EVIDENCE_TYPES.has(edge.type) && !DEPENDENCY_TYPES.has(edge.type) && edge.type !== 'relates' && edge.type !== 'references').map(decorate)
  const reviewEdges = [...evidence, ...dependencies, ...typedRelations]
    .filter(edge => target.currentEvidence && edge.status === 'current')
  const reviewSet = [...new Map(reviewEdges.flatMap(edge => {
    const other = edge.direction === 'outbound' ? edge.to : edge.from
    return [[other.id, other]]
  })).values()].sort((a, b) => a.id.localeCompare(b.id))
  return {
    target,
    evidence,
    unverifiedEvidence,
    dependencies,
    typedRelations,
    navigationOnly,
    weakReferences,
    reviewSet,
    note: 'Evidence requires a current edge with a recognized source. Only current typed relations enter reviewSet; relates and references remain separate navigation or weak-reference data.',
  }
}

export function queryReadiness(reference, context) {
  const target = resolveQueryTarget(reference, context)
  if (!target.declarationVerified) {
    return {
      target,
      requirements: [],
      completeness: { declaration: 'not-assessed', graphNode: 'not-assessed', codeBindings: 'not-assessed', testBindings: 'not-assessed' },
      note: 'This namespace is not assessed as current ZAI readiness evidence.',
    }
  }
  const requirementIds = requirementsFor(target, context)
  const requirementReports = requirementIds.map(id => {
    const nodeId = `req:${id}`
    const node = context.nodes.get(nodeId) || null
    const code = graphBindings(context, id, 'implements', 'code_file').map(({ edge, node: codeNode }) => {
      const location = bindingPath(context, codeNode)
      return { path: location.file, exists: Boolean(location.absolute), status: edge.status }
    })
    const tests = graphBindings(context, id, 'verifies', 'test').map(({ edge, node: testNode }) => {
      const location = bindingPath(context, testNode)
      return { path: location.file, exists: Boolean(location.absolute), status: edge.status }
    })
    return {
      id: `ZAI:${id}`,
      graphNode: Boolean(node?.namespace === 'ZAI' && node.type === 'requirement'),
      graphStatus: node?.status || null,
      codeBindings: code,
      testBindings: tests,
      codeBindingComplete: code.length > 0 && code.every(binding => binding.exists),
      testBindingComplete: tests.length > 0 && tests.every(binding => binding.exists),
    }
  })
  const hasMembers = requirementIds.length > 0
  const graphNode = Boolean(target.graphNode)
  return {
    target,
    requirements: requirementReports,
    completeness: {
      declaration: true,
      graphNode,
      codeBindings: hasMembers && requirementReports.every(requirement => requirement.codeBindingComplete),
      testBindings: hasMembers && requirementReports.every(requirement => requirement.testBindingComplete),
    },
    note: 'Completeness covers declarations and graph bindings only; it does not state approval, delivery, test execution, runtime activation, or production readiness.',
  }
}

export function parseQueryArguments(args, usage) {
  const result = { targets: [], json: false, root: undefined, graph: undefined }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--json') {
      result.json = true
      continue
    }
    if (arg === '--root' || arg === '--graph') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) fail('USAGE', `Expected a path after ${arg}. Usage: ${usage}`)
      if (result[arg.slice(2)] !== undefined) fail('USAGE', `${arg} may be specified once. Usage: ${usage}`)
      result[arg.slice(2)] = value
      index += 1
      continue
    }
    if (arg.startsWith('--')) fail('USAGE', `Unknown option ${arg}. Usage: ${usage}`)
    result.targets.push(arg)
  }
  if (!result.targets.length) fail('USAGE', `No identity supplied. Usage: ${usage}`)
  return result
}

export function runDocumentQuery({ args = process.argv.slice(2), toolPath, usage, query, formatText }) {
  let options
  try {
    options = parseQueryArguments(args, usage)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }
  const defaultRoot = path.resolve(path.dirname(fileURLToPath(toolPath)), '..')
  try {
    const context = loadDocumentQueryContext({ root: options.root || defaultRoot, graph: options.graph })
    const reports = options.targets.map(target => query(target, context))
    if (options.json) process.stdout.write(`${JSON.stringify({ reports }, null, 2)}\n`)
    else process.stdout.write(`${formatText(reports)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`)
    return 1
  }
}
