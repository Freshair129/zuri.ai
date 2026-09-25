import type { InvocationReceipt } from '../answer/context-injection.js';
import type { ConversationJob } from './contract.js';

/** Local executor callbacks for validating and recording authorized context receipts. */
export interface ConversationClient {
  validateContext?(job: ConversationJob): Promise<void>;
  recordInjection?(job: ConversationJob, receipt: InvocationReceipt,
    state: 'RESOLVED' | 'SUBMITTED' | 'COMPLETED' | 'FAILED', modelRef: string): Promise<void>;
}
