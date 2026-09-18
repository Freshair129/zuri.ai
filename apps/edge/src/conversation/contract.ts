import { z } from 'zod';
import type { InvocationReceipt } from '../answer/context-injection.js';
import { zEdgePublishedCorpusContext } from '../rag/genesisrag17/corpus-context.js';

// @spec ADR-061, FR-150 — zuri-ai's decision and requirement. This file is the edge half of
//   their wire contract: no LINE identity, credential, or delivery capability crosses it.

/** ADR-061 / FR-150 (upstream): no LINE identity, credential, or delivery capability. */
const conversationJob = z.object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    question: z.string().min(1).max(10000),
    conversationKey: z.string().min(1).max(300),
    leaseExpiresAt: z.string().datetime({ offset: true }),
    policy: z.object({
      modelAccess: z.enum(['LOCAL_ONLY', 'EXTERNAL_MODEL_ALLOWED']),
      role: z.literal('sales'),
      retainHistory: z.literal(false),
    }).strict(),
  }).strict();

const deadline = z.object({
  issuedAt: z.string().datetime({ offset: true }),
  answerDeadlineAt: z.string().datetime({ offset: true }),
  remainingBudgetMs: z.number().int().min(0).max(240000),
  deliveryMode: z.enum(['REPLY', 'DELAYED_PUSH']),
}).strict().refine(value => {
  const interval = Date.parse(value.answerDeadlineAt) - Date.parse(value.issuedAt);
  return value.remainingBudgetMs <= Math.max(0, interval)
    && (value.deliveryMode !== 'REPLY' || value.remainingBudgetMs <= 40000)
    && (interval >= 0 || value.remainingBudgetMs === 0);
}, 'INVALID_EXECUTION_BUDGET');

const memoryContext = z.object({
  schemaVersion: z.literal('line-memory-context.v1'),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  threadId: z.string().min(1).max(300), audienceKind: z.literal('DIRECT'),
  expiresAt: z.string().datetime({ offset: true }),
  slices: z.array(z.object({
    id: z.string().min(1).max(300), threadId: z.string().min(1).max(300),
    text: z.string().max(6000), sequence: z.string().max(100).optional(),
    scope: z.string().max(100).optional(), subjectKey: z.string().max(300).optional(),
  }).strict()).max(24),
}).strict().refine(value => Buffer.byteLength(JSON.stringify(value.slices), 'utf8') <= 6000
  && value.slices.every(slice => slice.threadId === value.threadId), 'INVALID_MEMORY_CONTEXT');

export const conversationEnvelope = z.discriminatedUnion('contractVersion', [
  z.object({ contractVersion: z.literal('1'), job: conversationJob }).strict(),
  z.object({ contractVersion: z.literal('2'), job: conversationJob.extend({
    executionId: z.string().uuid(), deadline, memoryContext: memoryContext.optional(),
    corpusContext: zEdgePublishedCorpusContext.optional(),
  }).strict() }).strict(),
]);

export type ConversationJob = z.infer<typeof conversationEnvelope>['job'];
export type FailureCode = 'EXECUTION_FAILED' | 'LOCAL_POLICY_UNAVAILABLE' | 'REPLY_DEADLINE_MISSED' | 'MSP_INJECTION_RECEIPT_UNKNOWN';

/**
 * What the executor hands back to the worker for one job.
 *
 * `source`/`reason` are provenance for the worker to reason about (item 3, FR-150 defect fix) —
 * a `rules` answer produced with no catalogue loaded is a holding message, not a verified one, and
 * the worker refuses to complete it (see executor.ts). They travel only as far as the worker's own
 * emitted event; ADR-061 keeps them off both the `/complete` wire body and the `claim` event, which
 * `apps/edge/src-tauri/src/supervisor.rs` whitelists to a fixed outcome-string shape.
 */
export interface ConversationAnswer {
  text: string;
  source: 'model' | 'rules';
  /** Why the rules answer was used, when it was. */
  reason?: string;
  contextReceipts?: InvocationReceipt[];
}

export class ConversationError extends Error {
  contextReceipts?: InvocationReceipt[];
  constructor(public readonly code: string, public readonly status = 0) {
    super(code);
    this.name = 'ConversationError';
  }
}

/** Default runtime owns compute only. Legacy transport must be a deliberate cutover choice. */
export function transportOwner(env: NodeJS.ProcessEnv = process.env): 'SERVER' | 'LEGACY_EDGE' {
  const owner = env.ZURI_LINE_TRANSPORT_OWNER || 'SERVER';
  if (owner !== 'SERVER' && owner !== 'LEGACY_EDGE') throw new ConversationError('INVALID_TRANSPORT_OWNER');
  if (owner === 'SERVER' && env.ZURI_STACK_REPLY_ENABLED === 'true') {
    throw new ConversationError('STACK_REPLY_REQUIRES_LEGACY_EDGE');
  }
  return owner;
}

export function requireLegacyTransport(env: NodeJS.ProcessEnv = process.env): void {
  if (transportOwner(env) !== 'LEGACY_EDGE') throw new ConversationError('LINE_TRANSPORT_OWNED_BY_SERVER');
}

export function requireComputeWorker(env: NodeJS.ProcessEnv = process.env): void {
  if (transportOwner(env) !== 'SERVER') throw new ConversationError('CONVERSATION_WORKER_REQUIRES_SERVER_TRANSPORT');
}

export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
