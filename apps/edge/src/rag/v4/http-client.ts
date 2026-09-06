export class RagUnavailableError extends Error {
  constructor(public reason: string, message?: string) {
    super(message ?? `rag_unavailable: ${reason}`);
    this.name = 'RagUnavailableError';
  }
}

export async function fetchJson<T>(
  url: string,
  init: {
    method?: 'GET' | 'POST';
    body?: unknown;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<T> {
  const f = init.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 3000);

  try {
    const resp = await f(url, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      headers: { 'Content-Type': 'application/json' },
      signal: ctl.signal,
    });

    if (!resp.ok) {
      // Best-effort: a JSON error body naming what actually went wrong (e.g. `{error, detail}`
      // from zuri-rag-service's 503 responses) is a more useful reason than the bare status code.
      let errorBodyText = '';
      try {
        errorBodyText = await resp.text();
      } catch {
        errorBodyText = '';
      }
      let detail: string | undefined;
      let errorField: string | undefined;
      if (errorBodyText) {
        try {
          const parsed = JSON.parse(errorBodyText) as { detail?: unknown; error?: unknown };
          if (typeof parsed.detail === 'string') detail = parsed.detail;
          if (typeof parsed.error === 'string') errorField = parsed.error;
        } catch {
          // body wasn't JSON; fall through to the plain http_<status> reason below
        }
      }
      const reason = detail ?? errorField;
      if (reason) {
        throw new RagUnavailableError(reason, `http_${resp.status}: ${errorBodyText}`);
      }
      throw new RagUnavailableError(`http_${resp.status}`);
    }

    const text = await resp.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new RagUnavailableError('bad_json', `Failed to parse JSON: ${text}`);
    }
  } catch (err) {
    clearTimeout(timer);

    if (err instanceof RagUnavailableError) {
      throw err;
    }

    const e = err as { name?: string; code?: string; cause?: { code?: string; errors?: Array<{ code?: string }> } } | null;
    if (e?.name === 'AbortError') {
      throw new RagUnavailableError('timeout');
    }
    // Node/undici wraps connection failures as `TypeError: fetch failed` with the
    // syscall code on `cause.code`; custom fetch impls may put it on the error itself.
    const code = (e?.code ?? e?.cause?.code ?? e?.cause?.errors?.[0]?.code ?? '').toLowerCase();
    if (code) {
      throw new RagUnavailableError(code, String(err));
    }

    throw new RagUnavailableError('network', String(err));
  } finally {
    clearTimeout(timer);
  }
}
