// Edge Device no longer claims or settles cloud conversation jobs. Local Knowledge/RAG is
// served through its independent runtime and never enters this retired worker boundary.
export const EDGE_CONVERSATION_WORKER_REMOVED = 'EDGE_CONVERSATION_WORKER_REMOVED';

export async function runConversationOnce(): Promise<never> {
  throw new Error(EDGE_CONVERSATION_WORKER_REMOVED);
}

export async function runConversationLoop(): Promise<never> {
  throw new Error(EDGE_CONVERSATION_WORKER_REMOVED);
}
