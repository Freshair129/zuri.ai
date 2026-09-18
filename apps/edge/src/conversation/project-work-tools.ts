import type { ToolSpec } from '../answer/model-port.js';
import type { ConversationClient } from './client.js';
import type { ConversationJob } from './contract.js';
import { z } from 'zod';
const id = z.string().uuid();
const title = z.string().max(1000);
const version = z.number().int().positive();
const searchResult = z.object({ items: z.array(z.object({
  id, sourceRef: id, code: z.string().max(120), name: title.optional(), title: title.optional(),
  status: z.string().max(80), version, workstreamId: id.optional(),
  workstreams: z.array(z.object({ id, name: title }).strict()).max(5).optional(),
}).strict()).max(10), truncated: z.boolean(), limit: z.literal(10),
  source: z.literal('PROJECT_MANAGER'), observedAt: z.string().datetime({ offset: true }) }).strict();
const proposalResult = z.object({ proposalId: id, action: z.enum(['create_work', 'update_work']),
  targetId: id, targetTitle: title, targetVersion: version,
  args: z.object({ title: z.string().max(240).optional(), status: z.string().max(80).optional() }).strict(),
  argsHash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.string().datetime({ offset: true }),
  confirmationCommand: z.string().max(80), status: z.literal('AWAITING_CONFIRMATION'),
}).strict().refine(value => value.confirmationCommand === `ยืนยันงาน ${value.proposalId}`);

export function parseProjectWorkResult(toolName: string, value: unknown): unknown {
  const envelope = z.object({ toolName: z.literal(toolName), result: z.unknown() }).strict().parse(value);
  return (toolName === 'propose_work_change' ? proposalResult : searchResult).parse(envelope.result);
}
// @spec ZAI:FR-150, ZAI:FR-072 — Server resolves identity and authority at every invocation.
// Confirmation is deliberately absent: only a new signed human inbound can commit.
export function projectWorkTools(job: ConversationJob, client?: ConversationClient): ToolSpec[] {
  if (!('executionId' in job) || !client?.callTool) return [];
  return [
    { name: 'search_project_work', description: 'Search authorized projects or work items and read their live status.',
      inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['projects', 'work'] },
        query: { type: 'string', maxLength: 120 } }, additionalProperties: false },
      run: input => client.callTool!(job, 'search_project_work', input) },
    { name: 'propose_work_change', description: 'Prepare a Work task creation or title/status update. This only previews a change. Show the exact returned preview and confirmationCommand to the human; never say it is already saved.',
      inputSchema: { type: 'object', properties: {
        action: { type: 'string', enum: ['create_work', 'update_work'] }, targetId: { type: 'string' },
        args: { type: 'object', properties: { title: { type: 'string', maxLength: 240 }, status: { type: 'string' } },
          additionalProperties: false },
      }, required: ['action', 'targetId', 'args'], additionalProperties: false },
      run: input => client.callTool!(job, 'propose_work_change', input) },
  ];
}
