import { randomUUID } from 'node:crypto'
import {
  commitPlan as defaultCommitPlan,
  dryRunPlan as defaultDryRunPlan,
} from '@/modules/project-manager/import/plan-import-service'
import { listWorkForViewer as defaultListWorkForViewer } from '@/modules/project-manager/application/work-read-service'
import { updateItem as defaultUpdateWorkItem } from '@/modules/project-manager/application/work-service'
import { EXECUTION_MODES, WORK_STATUSES } from '@/lib/validation/enums'
import {
  createPipelineRunFromWorker as defaultCreatePipelineRunFromWorker,
  getPipelineMonitor as defaultGetPipelineMonitor,
  recordPipelineEvent as defaultRecordPipelineEvent,
  requestPipelineReplay as defaultRequestPipelineReplay,
} from '@/platform/integrations/core/pipeline-tracking-service'
import { stageDocumentIntakeForPipeline as defaultStageDocumentIntakeForPipeline } from '@/platform/integrations/core/cloud-sot-agent'

// @req FR-069 — Agent intake uses the same PlanEnvelope dry-run/commit boundary
// as the Human UI and HTTP API.
// @req FR-071 — Codex uses a separate data_pipeline MCP namespace over the
// existing server-owned staging/tracking services.
// @spec ADR-029, ADR-040, SEC-001, SEC-008
// @tested tests/unit/project-manager-mcp.test.js, tests/unit/pipeline-mcp-transport.test.js

export const MCP_PROTOCOL_VERSION = '2024-11-05'

const PROJECT_MANAGER_ARGUMENT_KEYS = new Set(['plan', 'workspaceId'])
const WORK_READ_ARGUMENT_KEYS = new Set(['projectId', 'workstreamId', 'executionMode', 'subtype', 'status', 'q'])
const WORK_STATUS_UPDATE_ARGUMENT_KEYS = new Set(['workItemId', 'status'])
const RUN_CREATE_ARGUMENT_KEYS = new Set([
  'businessCode', 'dataPipelineDefinitionId', 'executionContractId', 'sourceRef',
  'sourceSha256', 'artifactRef', 'artifactSha256', 'expectedCount', 'bootstrapBatchId',
  'correlationId', 'idempotencyKey', 'identityRefs', 'tagIds',
])
const DOCUMENT_STAGE_ARGUMENT_KEYS = new Set(['executionRunId', 'contract'])
const PIPELINE_EVENT_ARGUMENT_KEYS = new Set([
  'eventType', 'dataPipelineDefinitionId', 'executionContractId', 'executionRunId',
  'pipelineStageId', 'executionStepId', 'attemptId', 'pipelineRecordId', 'sourceRecordKey',
  'sourceRowNumber', 'sourceSha256', 'docId', 'picId', 'factId', 'sourceDocIds', 'sourcePicIds',
  'destinationRecordId', 'sequence', 'status', 'correlationId', 'idempotencyKey', 'inputHash',
  'outputHash', 'tagIds', 'identityRefs', 'failureCode', 'errorRef', 'retryable',
  'reconciliation', 'gate',
])
const MONITOR_ARGUMENT_KEYS = new Set(['executionRunId'])
const REPLAY_ARGUMENT_KEYS = new Set(['executionRunId', 'replay'])

const TOOL_DEFINITIONS = [
  {
    name: 'project_manager.plan_dry_run',
    description: 'Validate and preview a Project Manager PlanEnvelope without writing records.',
    handler: 'dryRun',
    readOnly: true,
    argumentKeys: PROJECT_MANAGER_ARGUMENT_KEYS,
    required: ['plan'],
    properties: {
      plan: { type: 'object', description: 'PlanEnvelope data validated by the Project Manager contract.' },
      workspaceId: { type: 'string', description: 'Optional server-resolved target workspace id.' },
    },
  },
  {
    name: 'project_manager.plan_commit',
    description: 'Authorize and transactionally commit a validated Project Manager PlanEnvelope.',
    handler: 'commit',
    readOnly: false,
    argumentKeys: PROJECT_MANAGER_ARGUMENT_KEYS,
    required: ['plan'],
    properties: {
      plan: { type: 'object', description: 'PlanEnvelope data validated by the Project Manager contract.' },
      workspaceId: { type: 'string', description: 'Optional server-resolved target workspace id.' },
    },
  },
  {
    name: 'project_manager.work_read',
    description: 'Read scope-filtered WorkItems for a Project or Workstream.',
    handler: 'workRead',
    readOnly: true,
    argumentKeys: WORK_READ_ARGUMENT_KEYS,
    required: [],
    properties: {
      projectId: { type: 'string', description: 'Project id; mutually exclusive with workstreamId.' },
      workstreamId: { type: 'string', description: 'Workstream id; mutually exclusive with projectId.' },
      executionMode: { type: 'string', enum: EXECUTION_MODES },
      subtype: { type: 'string' },
      status: { type: 'string', enum: WORK_STATUSES },
      q: { type: 'string', description: 'Optional title/code search text.' },
    },
  },
  {
    name: 'project_manager.work_status_update',
    description: 'Update one WorkItem status through the authorized Project Manager mutation service.',
    handler: 'workStatusUpdate',
    readOnly: false,
    argumentKeys: WORK_STATUS_UPDATE_ARGUMENT_KEYS,
    required: ['workItemId', 'status'],
    properties: {
      workItemId: { type: 'string' },
      status: { type: 'string', enum: WORK_STATUSES },
    },
  },
  {
    name: 'data_pipeline.run_create',
    description: 'Create an idempotent SmartGift full-pipeline run after server-side Business resolution.',
    handler: 'pipeline.runCreate',
    readOnly: false,
    argumentKeys: RUN_CREATE_ARGUMENT_KEYS,
    required: ['businessCode', 'dataPipelineDefinitionId', 'executionContractId', 'correlationId', 'idempotencyKey', 'identityRefs'],
    properties: { businessCode: { type: 'string' }, dataPipelineDefinitionId: { type: 'string' }, executionContractId: { type: 'string' }, sourceRef: { type: ['string', 'null'] }, sourceSha256: { type: ['string', 'null'] }, artifactRef: { type: ['string', 'null'] }, artifactSha256: { type: ['string', 'null'] }, expectedCount: { type: 'integer' }, bootstrapBatchId: { type: ['string', 'null'] }, correlationId: { type: 'string' }, idempotencyKey: { type: 'string' }, identityRefs: { type: 'object' }, tagIds: { type: 'array' } },
  },
  {
    name: 'data_pipeline.document_stage',
    description: 'Submit a restricted SmartGift document contract through the server-resolved staging connection.',
    handler: 'pipeline.documentStage',
    readOnly: false,
    argumentKeys: DOCUMENT_STAGE_ARGUMENT_KEYS,
    required: ['executionRunId', 'contract'],
    properties: { executionRunId: { type: 'string' }, contract: { type: 'object' } },
  },
  {
    name: 'data_pipeline.event_record',
    description: 'Record validated full-pipeline lifecycle evidence with exact idempotency.',
    handler: 'pipeline.eventRecord',
    readOnly: false,
    argumentKeys: PIPELINE_EVENT_ARGUMENT_KEYS,
    required: ['eventType', 'executionRunId'],
    properties: Object.fromEntries([...PIPELINE_EVENT_ARGUMENT_KEYS].map((key) => [key, { type: 'object' }])),
  },
  {
    name: 'data_pipeline.monitor_read',
    description: 'Read the scope-filtered SmartGift pipeline monitor model.',
    handler: 'pipeline.monitorRead',
    readOnly: true,
    argumentKeys: MONITOR_ARGUMENT_KEYS,
    required: ['executionRunId'],
    properties: { executionRunId: { type: 'string' } },
  },
  {
    name: 'data_pipeline.replay_request',
    description: 'Request an immutable queued replay without claiming worker execution.',
    handler: 'pipeline.replayRequest',
    readOnly: false,
    argumentKeys: REPLAY_ARGUMENT_KEYS,
    required: ['executionRunId', 'replay'],
    properties: { executionRunId: { type: 'string' }, replay: { type: 'object' } },
  },
]

const TOOL_BY_NAME = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]))
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
  const tool = TOOL_BY_NAME.get(name)
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  for (const key of Object.keys(args)) {
    if (!tool.argumentKeys.has(key)) throw new Error(`Unsupported tool argument: ${key}`)
  }
  for (const key of tool.required || []) {
    if (args[key] === undefined) throw new Error(`${name} requires arguments.${key}`)
  }
  if (name === 'project_manager.plan_dry_run' || name === 'project_manager.plan_commit') {
    if (!isRecord(args.plan)) throw new Error(`${name} requires a PlanEnvelope object in arguments.plan`)
    if (args.workspaceId !== undefined && typeof args.workspaceId !== 'string') {
      throw new Error('arguments.workspaceId must be a string when provided')
    }
  }
  if (name === 'project_manager.work_read') {
    const hasProjectId = args.projectId !== undefined
    const hasWorkstreamId = args.workstreamId !== undefined
    if (hasProjectId === hasWorkstreamId) {
      throw new Error('project_manager.work_read requires exactly one of arguments.projectId or arguments.workstreamId')
    }
    for (const key of ['projectId', 'workstreamId', 'executionMode', 'subtype', 'status', 'q']) {
      if (args[key] !== undefined && typeof args[key] !== 'string') {
        throw new Error(`arguments.${key} must be a string when provided`)
      }
    }
    if (args.status !== undefined && !WORK_STATUSES.includes(args.status)) {
      throw new Error(`Unsupported WorkItem status: ${args.status}`)
    }
    if (args.executionMode !== undefined && !EXECUTION_MODES.includes(args.executionMode)) {
      throw new Error(`Unsupported execution mode: ${args.executionMode}`)
    }
  }
  if (name === 'project_manager.work_status_update') {
    if (typeof args.workItemId !== 'string' || !args.workItemId) {
      throw new Error('project_manager.work_status_update requires arguments.workItemId')
    }
    if (typeof args.status !== 'string' || !WORK_STATUSES.includes(args.status)) {
      throw new Error('project_manager.work_status_update requires a valid WorkItem status')
    }
  }
  if (name === 'data_pipeline.run_create' && typeof args.businessCode !== 'string') {
    throw new Error('data_pipeline.run_create requires a source businessCode')
  }
  if (name === 'data_pipeline.document_stage') {
    if (typeof args.executionRunId !== 'string' || !isRecord(args.contract)) {
      throw new Error('data_pipeline.document_stage requires executionRunId and contract')
    }
  }
  if (name === 'data_pipeline.monitor_read' && typeof args.executionRunId !== 'string') {
    throw new Error('data_pipeline.monitor_read requires executionRunId')
  }
  if (name === 'data_pipeline.replay_request') {
    if (typeof args.executionRunId !== 'string' || !isRecord(args.replay)) {
      throw new Error('data_pipeline.replay_request requires executionRunId and replay')
    }
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
      idempotentHint: tool.readOnly || tool.name === 'data_pipeline.run_create' || tool.name === 'data_pipeline.event_record',
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: tool.required,
      properties: tool.properties,
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
  work = {},
  pipeline = {},
  sessionIdFactory = () => randomUUID(),
} = {}) {
  const workServices = {
    readWork: defaultListWorkForViewer,
    updateWorkStatus: async (workItemId, status, { viewer } = {}) =>
      defaultUpdateWorkItem(workItemId, { status }, { viewer }),
    ...work,
  }
  const pipelineServices = {
    createPipelineRunFromWorker: defaultCreatePipelineRunFromWorker,
    stageDocumentIntakeForPipeline: defaultStageDocumentIntakeForPipeline,
    recordPipelineEvent: defaultRecordPipelineEvent,
    getPipelineMonitor: defaultGetPipelineMonitor,
    requestPipelineReplay: defaultRequestPipelineReplay,
    ...pipeline,
  }
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
        let result
        if (tool.handler === 'dryRun') {
          result = await dryRunPlan(args.plan, { workspaceId: args.workspaceId, viewer })
        } else if (tool.handler === 'commit') {
          result = await commitPlan(args.plan, { workspaceId: args.workspaceId, viewer })
        } else if (tool.handler === 'workRead') {
          result = await workServices.readWork(args, { viewer })
        } else if (tool.handler === 'workStatusUpdate') {
          result = await workServices.updateWorkStatus(args.workItemId, args.status, { viewer })
        } else if (tool.handler === 'pipeline.runCreate') {
          result = await pipelineServices.createPipelineRunFromWorker(args, { viewer })
        } else if (tool.handler === 'pipeline.documentStage') {
          result = await pipelineServices.stageDocumentIntakeForPipeline(args, { viewer })
        } else if (tool.handler === 'pipeline.eventRecord') {
          result = await pipelineServices.recordPipelineEvent(args, { viewer })
        } else if (tool.handler === 'pipeline.monitorRead') {
          result = await pipelineServices.getPipelineMonitor(args.executionRunId, { viewer })
        } else if (tool.handler === 'pipeline.replayRequest') {
          result = await pipelineServices.requestPipelineReplay(args.executionRunId, args.replay, { viewer })
        }
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
