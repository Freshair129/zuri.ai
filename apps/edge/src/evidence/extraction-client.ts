/**
 * The four device-facing calls of the cloud's edge extraction lane (its FR-143/FR-144),
 * and nothing else: no loop, no model, no logging.
 *
 * Every call carries `Authorization: Bearer <device key>`. The key is held in a closure
 * here and is never interpolated into a URL, an error message or a returned value — the
 * only place it appears is the header object handed to `fetch`. That is the point of
 * routing all four calls through one module: there is exactly one line to audit.
 */

import {
  ExtractionCandidate,
  ExtractionJob,
  buildClaimPayload,
  buildCompletePayload,
  buildFailPayload,
  scrubSecrets,
} from './extraction-contract.js';

/**
 * A cloud call that did not succeed.
 *
 * `retryable` is the decision the worker acts on, made once here where the status code is
 * in hand rather than re-derived from a message later.
 */
export class ExtractionHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable: boolean) {
    super(scrubSecrets(message));
    this.name = 'ExtractionHttpError';
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * 401 from any of the four calls.
 *
 * The cloud makes missing, malformed, unknown and revoked credentials indistinguishable
 * on purpose, so there is nothing to diagnose and nothing to retry — a device that keeps
 * trying a dead key just hammers a stranger's endpoint. This is a stop-and-tell-the-operator
 * condition, and it is a distinct class so the worker cannot accidentally treat it as
 * transient.
 */
export class ExtractionAuthError extends ExtractionHttpError {
  constructor(message = 'The cloud rejected this device credential (401)') {
    super(message, 401, false);
    this.name = 'ExtractionAuthError';
  }
}

/** A transport-level failure: DNS, refused connection, TLS, timeout. Always retryable. */
export class ExtractionNetworkError extends Error {
  readonly retryable = true as const;

  constructor(message: string) {
    super(scrubSecrets(message));
    this.name = 'ExtractionNetworkError';
  }
}

export interface EvidenceBytes {
  bytes: Buffer;
  /** The `Content-Type` the cloud actually served, not the one the job announced. */
  mime: string;
}

export interface ExtractionClient {
  /** `null` means the queue is empty (204), which is an ordinary state, not a failure. */
  claim(signal?: AbortSignal): Promise<ExtractionJob | null>;
  downloadEvidence(jobId: string, signal?: AbortSignal): Promise<EvidenceBytes>;
  complete(jobId: string, candidate: ExtractionCandidate, model: string, signal?: AbortSignal): Promise<ExtractionJob | null>;
  fail(jobId: string, reason: string, signal?: AbortSignal): Promise<ExtractionJob | null>;
}

export interface ExtractionClientOptions {
  /** e.g. `https://myshop.example.ngrok.app`. The device always initiates; the cloud never calls in. */
  baseUrl: string;
  /** The raw `edgk_…` credential. Held here and nowhere else. */
  deviceKey: string;
  fetchFn?: typeof fetch;
}

export function createExtractionClient(options: ExtractionClientOptions): ExtractionClient {
  const baseUrl = String(options.baseUrl ?? '').trim();
  if (!baseUrl) throw new Error('ZURI_CLOUD_BASE_URL_REQUIRED');
  if (!String(options.deviceKey ?? '').trim()) throw new Error('ZURI_EDGE_DEVICE_KEY_REQUIRED');

  const deviceKey = options.deviceKey;
  const fetchFn = options.fetchFn ?? fetch;

  /** The one place the credential is read. Never logged, never returned, never stringified. */
  const authHeaders = (): Record<string, string> => ({ Authorization: `Bearer ${deviceKey}` });

  const url = (path: string): string => new URL(path, endWithSlash(baseUrl)).toString();

  const send = async (path: string, init: RequestInit, what: string): Promise<Response> => {
    try {
      return await fetchFn(url(path), init);
    } catch (error) {
      // The cause may carry the request object, and the request carries the header. Only
      // a short description of what failed crosses this boundary.
      throw new ExtractionNetworkError(`${what} could not reach the cloud: ${describe(error)}`);
    }
  };

  const jobFromBody = async (response: Response): Promise<ExtractionJob | null> => {
    const body = (await response.json().catch(() => null)) as { job?: ExtractionJob } | null;
    return body?.job ?? null;
  };

  return {
    async claim(signal?: AbortSignal): Promise<ExtractionJob | null> {
      const response = await send(
        'api/edge/extraction-jobs/claim',
        {
          method: 'POST',
          headers: { ...authHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify(buildClaimPayload()),
          signal,
        },
        'claim'
      );
      // 204 is the empty queue and carries no body — reading one would throw.
      if (response.status === 204) return null;
      assertOk(response, 'claim');
      return jobFromBody(response);
    },

    async downloadEvidence(jobId: string, signal?: AbortSignal): Promise<EvidenceBytes> {
      const response = await send(
        `api/edge/extraction-jobs/${encodeURIComponent(jobId)}/evidence`,
        { method: 'GET', headers: authHeaders(), signal },
        'evidence download'
      );
      assertOk(response, 'evidence download');
      const mime = response.headers.get('content-type') || 'application/octet-stream';
      const buffer = await response.arrayBuffer();
      // The cloud serves the bytes itself: there is no bucket URL, signed link or storage
      // credential in this exchange, which is exactly what keeps the evidence on-device.
      return { bytes: Buffer.from(buffer), mime: mime.split(';')[0].trim() };
    },

    async complete(jobId, candidate, model, signal): Promise<ExtractionJob | null> {
      const response = await send(
        `api/edge/extraction-jobs/${encodeURIComponent(jobId)}/complete`,
        {
          method: 'POST',
          headers: { ...authHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify(buildCompletePayload(candidate, model)),
          signal,
        },
        'complete'
      );
      // A candidate the cloud's schema rejects is a 400 that also fails the job there, so
      // this must not be retried as if it were transient — `assertOk` marks only 5xx and
      // 429 retryable, which is what stops a bad candidate being posted in a loop.
      assertOk(response, 'complete');
      return jobFromBody(response);
    },

    async fail(jobId, reason, signal): Promise<ExtractionJob | null> {
      const response = await send(
        `api/edge/extraction-jobs/${encodeURIComponent(jobId)}/fail`,
        {
          method: 'POST',
          headers: { ...authHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify(buildFailPayload(reason)),
          signal,
        },
        'fail'
      );
      assertOk(response, 'fail');
      return jobFromBody(response);
    },
  };
}

function endWithSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * Turn a non-2xx into the right error class.
 *
 * The response body is deliberately not read into the message. It is the cloud's prose,
 * it can be long, and on a misconfigured `ZURI_CLOUD_BASE_URL` it is some unrelated
 * server's HTML — none of which belongs in a device log. The status is enough to decide
 * what to do, and the console shows the cloud's own reason on the job.
 */
function assertOk(response: Response, what: string): void {
  if (response.ok) return;
  if (response.status === 401) throw new ExtractionAuthError();
  const retryable = response.status >= 500 || response.status === 429;
  throw new ExtractionHttpError(`${what} failed with status ${response.status}`, response.status, retryable);
}

function describe(error: unknown): string {
  if (error instanceof Error) return scrubSecrets(error.message);
  return 'unknown transport error';
}
