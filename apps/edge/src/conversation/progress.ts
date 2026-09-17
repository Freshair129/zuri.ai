import type { ConversationJob } from './contract.js';
import { remainingConversationBudget } from './deadline.js';

// @req ZAI:FR-150, ZAI:FR-171 — per-turn content-free local execution timeline.
// @spec ZAI:ADR-090, SEC-025
export const PROGRESS_TOOLS = ['quote_price', 'find_within_budget', 'search_products', 'lead_time', 'explain_policy', 'search_project_work', 'propose_work_change'] as const;
export type ProgressDetail = { phase: 'CONTEXT' | 'MODEL' | 'TOOL'; state: 'STARTED' | 'COMPLETED' | 'FAILED'; toolName?: string };
export type ExecutionProgress = ProgressDetail & { jobId: string; executionId?: string; modelRef?: string; elapsedMs: number; durationMs: number; remainingBudgetMs?: number };

export function createProgressReporter(job: ConversationJob, model: string | undefined,
  callback?: (event: ExecutionProgress) => void | Promise<void>, now = () => performance.now()): (detail: ProgressDetail) => void {
  const started = now();
  const spans = new Map<string, number>();
  const modelRef = model && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,95}$/.test(model) && !model.includes('://') ? model : undefined;
  return detail => {
    if (!callback || !['CONTEXT', 'MODEL', 'TOOL'].includes(detail.phase) || !['STARTED', 'COMPLETED', 'FAILED'].includes(detail.state)) return;
    if (detail.phase === 'TOOL' && !PROGRESS_TOOLS.includes(detail.toolName as typeof PROGRESS_TOOLS[number])) return;
    const at = now(), key = `${detail.phase}:${detail.toolName ?? ''}`;
    if (detail.state === 'STARTED') spans.set(key, at);
    const durationMs = Math.max(0, Math.min(240000, Math.floor(at - (spans.get(key) ?? at))));
    if (detail.state !== 'STARTED') spans.delete(key);
    const remaining = remainingConversationBudget(job);
    const event: ExecutionProgress = { phase: detail.phase, state: detail.state, jobId: job.id,
      ...('executionId' in job ? { executionId: job.executionId } : {}),
      ...(detail.phase === 'TOOL' ? { toolName: detail.toolName } : {}), ...(modelRef ? { modelRef } : {}),
      elapsedMs: Math.max(0, Math.min(240000, Math.floor(at - started))), durationMs,
      ...(remaining === null ? {} : { remainingBudgetMs: Math.max(0, Math.min(240000, Math.floor(remaining))) }) };
    queueMicrotask(() => { try { void Promise.resolve(callback(event)).catch(() => {}); } catch { /* diagnostics cannot change an answer */ } });
  };
}
