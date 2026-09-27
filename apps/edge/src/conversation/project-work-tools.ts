import type { ToolSpec } from '../answer/model-port.js';
import type { ConversationClient } from './client.js';
import type { ConversationJob } from './contract.js';

// Work access belonged to the retired Edge Device executor. Canonical Work operations now run
// through their owning service and are not exposed as tools by this retained local RAG executor.
export function projectWorkTools(_job: ConversationJob, _client?: ConversationClient): ToolSpec[] {
  return [];
}
