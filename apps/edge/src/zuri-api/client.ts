import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  CommandEnvelope,
  CommandJob,
  Lease,
  EvidencePacket,
  HeartbeatPayload,
  ReleasePayload,
} from './types.js';
import { logDiagnostic } from '../safety/redact.js';

// @req SDD-002 — the Zuri API client: typed request and response models for the canonical contract.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Comfortably inside the 40s heartbeat interval, which is itself clamped to at most 60s. */
const HEARTBEAT_TIMEOUT_MS = 15_000;

export interface IZuriApiClient {
  admitCommand(envelope: CommandEnvelope): Promise<CommandJob>;
  claimJob(deviceId: string): Promise<{ job: CommandJob; lease: Lease } | null>;
  submitEvidence(leaseId: string, evidence: EvidencePacket): Promise<{ success: boolean; commandId: string }>;
  releaseJob(payload: ReleasePayload): Promise<{ success: boolean }>;
  sendHeartbeat(payload: HeartbeatPayload): Promise<{ acknowledged: boolean }>;
  getCommandStatus(commandId: string): Promise<CommandJob | null>;
}

/**
 * Network implementation of the canonical Zuri command contract. It owns no
 * tenant or delivery authority: it only transmits a versioned envelope using a
 * registered bridge credential. The target endpoint remains fail-closed until
 * Zuri implements the candidate contract.
 */
export class HttpZuriApiClient implements IZuriApiClient {
  constructor(
    private readonly options: {
      baseUrl: string;
      deviceId: string;
      deviceToken: string;
      /**
       * The `edgk_`-prefixed credential minted per device in the console (ZURI_EDGE_DEVICE_KEY).
       *
       * Separate from `deviceToken` because zuri-ai accepts exactly one machine credential and it
       * is this one: `resolveRequestViewer` reads a session cookie and nothing else, so a bearer
       * that is not an `edgk_` key cannot authenticate as a viewer either — it falls through and
       * gets 401 AUTH_REQUIRED regardless of its value. Optional, and falls back to `deviceToken`,
       * so a deployment that already put the minted key there keeps working.
       */
      deviceKey?: string;
      /**
       * Origin for device-authenticated calls (ZURI_CLOUD_BASE_URL), the partner of `deviceKey`.
       *
       * Kept apart from `baseUrl` so the two contracts stop borrowing each other's settings:
       * cloudBaseUrl + deviceKey is the device talking to the cloud as itself, which is what the
       * heartbeat and the extraction worker both do, while baseUrl + deviceToken belongs to the
       * command endpoints, which are unbuilt upstream. Config already refuses cloudBaseUrl and
       * deviceKey unless both are set, so in practice they arrive together or not at all.
       *
       * Falls back to `baseUrl` when unset, so a deployment that never configured the pair keeps
       * reaching the same origin it always did.
       */
      cloudBaseUrl?: string;
      fetchFn?: FetchLike;
    }
  ) {}

  /** The credential zuri-ai will actually accept from a machine, preferring the minted key. */
  private deviceCredential(): string {
    return this.options.deviceKey?.trim() || this.options.deviceToken;
  }

  /** Where device-authenticated calls go, preferring the cloud origin that pairs with the key. */
  private deviceOrigin(): string {
    return this.options.cloudBaseUrl?.trim() || this.options.baseUrl;
  }

  // Still unimplemented upstream. `/api/agent-commands` is not a route zuri-ai has ever
  // served — as of 5393f99 (PR #221) there is no reference to it anywhere in that repo — so this
  // and `getCommandStatus` below fail closed with a 404 from the Next.js catch-all. That is the
  // documented state of the candidate contract, not a regression to chase: the command-queue side
  // of ADR-041 has not been built. `preview`/`send`/`status` therefore only work end to end under
  // ZURI_COMMAND_TRANSPORT=mock until it is.
  async admitCommand(envelope: CommandEnvelope): Promise<CommandJob> {
    return this.request<CommandJob>('/api/agent-commands', {
      method: 'POST',
      body: JSON.stringify(envelope),
      headers: { 'Idempotency-Key': envelope.idempotencyKey },
    });
  }

  // The upstream candidate contract requires a concrete command id for claim,
  // while the legacy bridge interface only offers a poll-style method. Refuse
  // rather than invent an endpoint that could claim another tenant's work.
  async claimJob(_deviceId: string): Promise<{ job: CommandJob; lease: Lease } | null> {
    throw new Error('Claim is unavailable until the Zuri API exposes a commandId-scoped worker lease endpoint.');
  }

  async submitEvidence(_leaseId: string, _evidence: EvidencePacket): Promise<{ success: boolean; commandId: string }> {
    throw new Error('Evidence submission is unavailable until the Zuri API exposes a commandId-scoped lease endpoint.');
  }

  async releaseJob(_payload: ReleasePayload): Promise<{ success: boolean }> {
    throw new Error('Lease release is unavailable until the Zuri API exposes a commandId-scoped lease endpoint.');
  }

  // zuri-ai serves this at /api/agent/heartbeat (src/app/api/agent/heartbeat/route.ts, FR-141 and
  // FR-144). The old `/api/agent-bridges/heartbeat` returned a Next.js 404 — silently, because the
  // launcher fired it and never read the result, and `zuri-agent health` only validates config.
  //
  // Deliberately no businessId in the payload: the route resolves the device credential first and
  // injects the Business from it, and refuses (403) a body that names a different one. Sending one
  // could only ever hurt. The credential must be an `edgk_`-prefixed key minted per device via
  // /api/platform/edge-devices/credentials — a Bearer token of any other shape falls through to
  // human-session auth and gets a 401.
  async sendHeartbeat(payload: HeartbeatPayload): Promise<{ acknowledged: boolean }> {
    return this.request<{ acknowledged: boolean }>(
      '/api/agent/heartbeat',
      {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { Authorization: `Bearer ${this.deviceCredential()}` },
        // Bounded well inside the beat interval. Without it, a cloud that accepts the connection
        // and never answers holds the request for undici's default header timeout — around five
        // minutes — during which the device reports nothing at all, having already been marked
        // offline at two. A liveness signal that can hang for longer than the liveness window is
        // not a liveness signal.
        signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
      },
      this.deviceOrigin(),
    );
  }

  async getCommandStatus(commandId: string): Promise<CommandJob | null> {
    try {
      return await this.request<CommandJob>(`/api/agent-commands/${encodeURIComponent(commandId)}`, {
        method: 'GET',
      });
    } catch (error) {
      if (error instanceof ZuriApiError && error.status === 404) return null;
      throw error;
    }
  }

  private async request<T>(pathName: string, init: RequestInit, origin?: string): Promise<T> {
    const fetchFn = this.options.fetchFn || fetch;
    const url = new URL(pathName, origin || this.options.baseUrl).toString();
    let response: Response;
    try {
      response = await fetchFn(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.options.deviceToken}`,
          'Content-Type': 'application/json',
          'X-Zuri-Contract-Version': '0.1.0b',
          'X-Zuri-Device-Id': this.options.deviceId,
          ...(init.headers || {}),
        },
      });
    } catch (error) {
      throw new Error(`Zuri API network request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const body = await response.text();
    if (!response.ok) {
      throw new ZuriApiError(response.status, `Zuri API request failed (${response.status}): ${describeErrorBody(body, response)}`);
    }

    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error('Zuri API returned a non-JSON response.');
    }
  }
}

/**
 * What to put in the thrown message for a failed response.
 *
 * zuri-ai's error bodies are `{ "error": "..." }`, which is worth quoting in full. A wrong route,
 * though, gets Next.js's 404 *page* — ~4KB of HTML with script tags and marketing copy, which is
 * what a 404 actually looked like at the CLI and buried the one fact that mattered. Non-JSON
 * bodies are reported by shape instead, so the status code stays legible.
 */
function describeErrorBody(body: string, response: Response): string {
  if (!body) return response.statusText || 'no response body';
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') {
      return (parsed as { error: string }).error;
    }
    return body.length <= 500 ? body : `${body.slice(0, 500)}… (${body.length} bytes)`;
  } catch {
    const contentType = response.headers.get('content-type')?.split(';')[0] || 'unknown content type';
    return `non-JSON ${contentType} response, ${body.length} bytes (${response.statusText || 'no status text'})`;
  }
}

export class ZuriApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ZuriApiError';
  }
}

interface PersistedMockState {
  jobs: Array<[string, CommandJob]>;
  leases: Array<[string, Lease]>;
  evidence: Array<[string, EvidencePacket]>;
  idempotency: Array<[string, string]>;
}

/**
 * Default local cache location for `MockZuriApiClient` state. This lets separate `zuri-agent`
 * CLI invocations (e.g. `preview` then `status`) see the same in-flight command during local
 * development, ahead of a real HTTP Zuri API client implementation. Per AGENTS.md
 * "Stateful-runtime rules", this is a bounded, deletable, non-authoritative transient work
 * cache only — it is never the source of truth and carries no secrets or business data.
 */
export function defaultMockStatePath(): string {
  return path.join(os.tmpdir(), 'zuri-agent', 'mock-client-state.json');
}

export class MockZuriApiClient implements IZuriApiClient {
  private jobs: Map<string, CommandJob> = new Map();
  private leases: Map<string, Lease> = new Map();
  private evidenceMap: Map<string, EvidencePacket> = new Map();
  private idempotencyStore: Map<string, string> = new Map();
  private readonly persistPath?: string;

  /**
   * @param persistPath When supplied, state is hydrated from this file on construction and
   * written back after every mutating call, so a fresh `MockZuriApiClient` pointed at the same
   * path (e.g. in the next CLI process) sees prior commands. Omit for pure in-memory/test use.
   */
  constructor(persistPath?: string) {
    this.persistPath = persistPath;
    if (this.persistPath) {
      this.hydrate();
    }
  }

  private hydrate(): void {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;
    try {
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const state = JSON.parse(raw) as Partial<PersistedMockState>;
      this.jobs = new Map(state.jobs || []);
      this.leases = new Map(state.leases || []);
      this.evidenceMap = new Map(state.evidence || []);
      this.idempotencyStore = new Map(state.idempotency || []);
    } catch (err) {
      logDiagnostic('MockZuriApiClient: failed to hydrate persisted state, starting empty', {
        path: this.persistPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private save(): void {
    if (!this.persistPath) return;
    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      const state: PersistedMockState = {
        jobs: Array.from(this.jobs.entries()),
        leases: Array.from(this.leases.entries()),
        evidence: Array.from(this.evidenceMap.entries()),
        idempotency: Array.from(this.idempotencyStore.entries()),
      };
      fs.writeFileSync(this.persistPath, JSON.stringify(state, null, 2));
    } catch (err) {
      logDiagnostic('MockZuriApiClient: failed to persist state (continuing in-memory only)', {
        path: this.persistPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async admitCommand(envelope: CommandEnvelope): Promise<CommandJob> {
    if (envelope.contractVersion !== '0.1.0b') {
      throw new Error(`Incompatible contractVersion: ${envelope.contractVersion}`);
    }

    if (this.idempotencyStore.has(envelope.idempotencyKey)) {
      const existingId = this.idempotencyStore.get(envelope.idempotencyKey)!;
      return this.jobs.get(existingId)!;
    }

    const commandId = `cmd_${Math.random().toString(36).substring(2, 10)}`;
    const now = new Date().toISOString();

    const job: CommandJob = {
      commandId,
      tenantId: envelope.tenantRef || 'tenant_default',
      policySnapshotId: 'pol_snap_v1',
      contractVersion: envelope.contractVersion,
      source: envelope.source,
      command: envelope.command,
      arguments: envelope.arguments,
      deliveryIntent: envelope.delivery,
      lifecycle: 'ADMITTED',
      idempotencyKey: envelope.idempotencyKey,
      traceId: `trace_${Math.random().toString(36).substring(2, 10)}`,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(commandId, job);
    this.idempotencyStore.set(envelope.idempotencyKey, commandId);
    this.save();
    return job;
  }

  async claimJob(deviceId: string): Promise<{ job: CommandJob; lease: Lease } | null> {
    const admittedJob = Array.from(this.jobs.values()).find(
      (j) => j.lifecycle === 'ADMITTED' || j.lifecycle === 'QUEUED'
    );

    if (!admittedJob) {
      return null;
    }

    const leaseId = `lease_${Math.random().toString(36).substring(2, 10)}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const queryMap: Record<string, { queryId: string; queryVersion: string }> = {
      executive_summary: { queryId: 'executive_summary.v1', queryVersion: '1.0.0' },
      channel_performance: { queryId: 'channel_performance.v1', queryVersion: '1.0.0' },
      campaign_breakdown: { queryId: 'campaign_breakdown.v1', queryVersion: '1.0.0' },
      approval_queue: { queryId: 'approval_queue.v1', queryVersion: '1.0.0' },
    };

    const queryInfo = queryMap[admittedJob.command] || {
      queryId: `${admittedJob.command}.v1`,
      queryVersion: '1.0.0',
    };

    const lease: Lease = {
      leaseId,
      commandId: admittedJob.commandId,
      tenantId: admittedJob.tenantId,
      deviceId,
      expiresAt,
      queryId: queryInfo.queryId,
      queryVersion: queryInfo.queryVersion,
    };

    admittedJob.lifecycle = 'CLAIMED';
    admittedJob.updatedAt = new Date().toISOString();

    this.leases.set(leaseId, lease);
    this.jobs.set(admittedJob.commandId, admittedJob);
    this.save();

    return { job: admittedJob, lease };
  }

  async submitEvidence(leaseId: string, evidence: EvidencePacket): Promise<{ success: boolean; commandId: string }> {
    const lease = this.leases.get(leaseId);
    if (!lease) {
      throw new Error(`Invalid or expired lease: ${leaseId}`);
    }

    const job = this.jobs.get(lease.commandId);
    if (!job) {
      throw new Error(`Command not found for lease: ${leaseId}`);
    }

    if (new Date(lease.expiresAt) < new Date()) {
      job.lifecycle = 'EXPIRED';
      throw new Error(`Lease expired for command: ${lease.commandId}`);
    }

    this.evidenceMap.set(job.commandId, evidence);
    job.lifecycle = job.deliveryIntent === 'preview' ? 'REVIEW_REQUIRED' : 'EVIDENCE_READY';
    job.updatedAt = new Date().toISOString();
    this.save();

    return { success: true, commandId: job.commandId };
  }

  async releaseJob(payload: ReleasePayload): Promise<{ success: boolean }> {
    const lease = this.leases.get(payload.leaseId);
    if (lease) {
      const job = this.jobs.get(lease.commandId);
      if (job) {
        job.lifecycle = 'FAILED';
        job.updatedAt = new Date().toISOString();
      }
      this.leases.delete(payload.leaseId);
    }
    this.save();
    return { success: true };
  }

  async sendHeartbeat(_payload: HeartbeatPayload): Promise<{ acknowledged: boolean }> {
    return { acknowledged: true };
  }

  async getCommandStatus(commandId: string): Promise<CommandJob | null> {
    return this.jobs.get(commandId) || null;
  }
}
