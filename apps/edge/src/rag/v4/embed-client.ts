import { fetchJson, RagUnavailableError } from './http-client.js';

export interface EmbedClient {
  embed(texts: string[], kind: 'query' | 'passage'): Promise<number[][]>;
  health(): Promise<{ ok: boolean; model?: string; revision?: string }>;
}

export function createEmbedClient(
  baseUrl: string,
  opts?: { timeoutMs?: number; fetchImpl?: typeof fetch },
): EmbedClient {
  const base = baseUrl.replace(/\/$/, '');
  return {
    async embed(texts: string[], kind: 'query' | 'passage'): Promise<number[][]> {
      const r = await fetchJson<{ vectors: number[][]; model: string; revision: string }>(
        `${base}/embed`,
        {
          method: 'POST',
          body: { texts, kind },
          timeoutMs: opts?.timeoutMs ?? 30000,
          fetchImpl: opts?.fetchImpl,
        },
      );
      return r.vectors;
    },
    async health() {
      try {
        const r = await fetchJson<{ model: string; revision: string }>(`${base}/health`, {
          timeoutMs: 2000,
          fetchImpl: opts?.fetchImpl,
        });
        return { ok: true, ...r };
      } catch {
        return { ok: false };
      }
    },
  };
}
