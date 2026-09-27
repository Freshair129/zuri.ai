import type { InvocationReceipt } from '../answer/context-injection.js';
import type { EdgePublishedCorpusContext } from '../rag/genesisrag17/corpus-context.js';

// Retained local executor inputs. The retired Edge cloud-job envelope, device authentication,
// claim/settlement transport and delivery contract are intentionally absent.
interface ConversationJobBase {
  id: string;
  version: number;
  question: string;
  conversationKey: string;
  leaseExpiresAt: string;
  policy: {
    modelAccess: 'LOCAL_ONLY' | 'EXTERNAL_MODEL_ALLOWED';
    role: 'sales';
    retainHistory: false;
  };
}

interface MemoryContext {
  schemaVersion: 'line-memory-context.v1';
  contextHash: string;
  threadId: string;
  audienceKind: 'DIRECT';
  expiresAt: string;
  slices: Array<{
    id: string;
    threadId: string;
    text: string;
    sequence?: string;
    scope?: string;
    subjectKey?: string;
  }>;
}

interface Deadline {
    issuedAt: string;
    answerDeadlineAt: string;
    remainingBudgetMs: number;
    deliveryMode: 'REPLY' | 'DELAYED_PUSH';
}

export type ConversationJob = ConversationJobBase | (ConversationJobBase & {
  executionId: string;
  deadline: Deadline;
  memoryContext?: MemoryContext;
  corpusContext?: EdgePublishedCorpusContext;
});

/** Result of local answer composition; this type grants no queue or delivery authority. */
export interface ConversationAnswer {
  text: string;
  source: 'model' | 'rules';
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

export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
