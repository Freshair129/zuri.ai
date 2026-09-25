/**
 * The former Edge Device worker entrypoint is retained as a clear failure for old CLI scripts.
 * Conversation execution now belongs to the Conversation Runtime; this command cannot claim jobs.
 */
export async function runConversationCommand(_subcommand: string | undefined): Promise<never> {
  throw new Error('EDGE_CONVERSATION_WORKER_REMOVED');
}
