import { randomUUID } from 'node:crypto'
import {
  commitPlan as defaultCommitPlan,
  dryRunPlan as defaultDryRunPlan,
} from '@/modules/project-manager/import/plan-import-service'

// @req FR-069 — Agent intake uses the same PlanEnvelope dry-run/commit boundary
// as the Human UI and HTTP API.
// @spec ADR-029, SEC-001, SEC-008
// @tested tests/unit/project-manager-mcp.test.js

export const MCP_PROTOCOL_VERSION = '2024-11-05'

const TOOL_DEFINITIONS = [
  {
    name: 'project_manager.plan_dry_run',
    description: 'Validate and preview a Project Manager PlanEnvelope without writing records.',
    handler: 'dryRun',
    readOnly: true,
  },
  {
    name: 'project_manager.plan_commit',
    description: 'Authorize and transactionally commit a validated Project Manager PlanEnvelope.',
    handler: 'commit',
    readOnly: false,
  },
]

const TOOL_BY_NAME = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]))
const ARGUMENT_KEYS = new Set(['plan', 'workspaceId'])
const FORBIDDEN_KEYS = new Set([
  '__proto__', 'constructor', 'eval', 'exec', 'execute', 'function', 'import',
  'javascript', 'module', 'prototype', 'require', 'script', 'sourceCode',
])

function jsonRpcResponse(id, result) {
  return { jsonrpc: '2.0', id, result }
}

export function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }
}

function resultEnvelope(id, payload) {
  const isError = payload?.valid === false || payload?.committed === false
  return jsonRpcResponse(id, {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError,
  })
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requestId(message) {
  return Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : null
}

function validateRequest(message) {
  if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return 'A JSON-RPC 2.0 request or notification is required'
  }
  if (Object.prototype.hasOwnProperty.call(message, 'id')) {
    const id = message.id
    if (!['string', 'number'].includes(typeof id) || !Number.isFinite(id)) {
      return 'Request id must be a string or finite number'
    }
  }
  if (message.params !== undefined && !isRecord(message.params)) return 'Request params must be an object'
  return null
}

function rejectExecutablePayload(value, path = 'arguments') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectExecutablePayload(entry, `${path}[${index}]`))
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`Unsupported executable/import field: ${path}.${key}`)
    rejectExecutablePayload(child, `${path}.${key}`)
  }
}

function validateToolArguments(name, rawArguments) {
  const args = rawArguments === undefined ? {} : rawArguments
  if (!isRecord(args)) throw new Error('Tool arguments must be an object')
  for (const key of Object.keys(args)) {
    if (!ARGUMENT_KEYS.has(key)) throw new Error(`Unsupported tool argument: ${key}`)
  }
  if (!isRecord(args.plan)) throw new Error(`${name} requires a PlanEnvelope object in arguments.plan`)
  if (args.workspaceId !== undefined && typeof args.workspaceId !== 'string') {
    throw new Error('arguments.workspaceId must be a string when provided')
  }
  rejectExecutablePayload(args)
  return args
}

function validateCallParams(params) {
  if (!isRecord(params)) throw new Error('tools/call params must be an object')
  for (const key of Object.keys(params)) {
    if (!['name', 'arguments'].includes(key)) throw new Error(`Unsupported tools/call field: ${key}`)
  }
  if (typeof params.name !== 'string') throw new Error('tools/call requires a tool name')
  return params
}

function toolList() {
  return TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    annotations: {
      readOnlyHint: tool.readOnly,
      destructiveHint: !tool.readOnly,
      idempotentHint: tool.readOnly,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['plan'],
      properties: {
        plan: { type: 'object', description: 'PlanEnvelope data validated by the Project Manager contract.' },
        workspaceId: { type: 'string', description: 'Optional server-resolved target workspace id.' },
      },
    },
  }))
}

function protocolFailure(id, status, code, message) {
  return { status, body: jsonRpcError(id, code, message) }
}

/**
 * Stateful JSON-RPC transport for a process-local MCP session registry.
 * Authentication is request-scoped: a session id is only a protocol
 * continuation token, never an authorization grant.
 */
export function createProjectManagerMcpTransport({
  dryRunPlan = defaultDryRunPlan,
  commitPlan = defaultCommitPlan,
  sessionIdFactory = () => randomUUID(),
} = {}) {
  const sessions = new Map()

  return {
    async handle(message, { viewer, sessionId } = {}) {
      const id = requestId(isRecord(message) ? message : {})
      const invalid = validateRequest(message)
      if (invalid) return protocolFailure(id, 400, -32600, invalid)
      if (!viewer) return protocolFailure(id, 401, -32001, 'Authenticated viewer is required')

      if (message.method === 'initialize') {
        const requestedVersion = message.params?.protocolVersion
        if (requestedVersion && requestedVersion !== MCP_PROTOCOL_VERSION) {
          return protocolFailure(id, 400, -32602, `Unsupported protocolVersion: ${requestedVersion}`)
        }
        const nextSessionId = sessionIdFactory()
        sessions.set(nextSessionId, { initialized: false })
        return {
          status: 200,
          sessionId: nextSessionId,
          body: jsonRpcResponse(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'zuri-ai-project-manager', version: '1.0.0' },
          }),
        }
      }

      if (message.method === 'notifications/initialized') {
        const session = sessions.get(sessionId)
        if (session) session.initialized = true
        return { status: 204, body: null }
      }

      const session = sessions.get(sessionId)
      if (!session || !session.initialized) {
        return protocolFailure(id, 400, -32002, 'MCP session is not initialized')
      }

      if (message.method === 'tools/list') {
        return { status: 200, body: jsonRpcResponse(id, { tools: toolList() }) }
      }
      if (message.method !== 'tools/call') {
        return protocolFailure(id, 404, -32601, `Method not found: ${message.method}`)
      }

      try {
        const params = validateCallParams(message.params || {})
        const tool = TOOL_BY_NAME.get(params.name)
        if (!tool) return protocolFailure(id, 400, -32602, `Unknown tool: ${params.name || '(missing)'}`)
        const args = validateToolArguments(tool.name, params.arguments)
        const result = tool.handler === 'dryRun'
          ? await dryRunPlan(args.plan, { workspaceId: args.workspaceId, viewer })
          : await commitPlan(args.plan, { workspaceId: args.workspaceId, viewer })
        return { status: 200, body: resultEnvelope(id, result) }
      } catch (error) {
        if (error?.code === 'MCP_TOOL_EXECUTION') {
          return protocolFailure(id, Number(error?.status) || 500, -32003, 'Project Manager tool execution failed')
        }
        return protocolFailure(id, 400, -32602, error.message)
      }
    },
  }
}
