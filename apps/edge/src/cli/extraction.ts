/**
 * `zuri-agent extraction serve` and `zuri-agent extraction once`.
 *
 * The wiring layer only: it reads config, builds the client, the port and the extractor,
 * and turns worker events into diagnostics. Every decision worth arguing about lives in
 * `src/evidence/extraction-*.ts`, which is where the tests point.
 *
 * `once` exists because `serve` is unfalsifiable at a glance — a quiet loop looks the same
 * whether it is polling correctly or silently failing to authenticate. `once` claims at
 * most one job, reports the outcome as JSON, and exits, so an operator installing a
 * credential can prove the round trip in one command.
 */

import { loadConfig } from '../config/index.js';
import { logDiagnostic } from '../safety/redact.js';
import { printJsonError, printJsonSuccess } from './output.js';
import { createModelPort } from '../answer/providers/index.js';
import { createExtractionClient } from '../evidence/extraction-client.js';
import { ExtractionAuthError } from '../evidence/extraction-client.js';
import { createLocalEvidenceExtractor } from '../evidence/extraction-extractor.js';
import {
  ExtractionEvent,
  ExtractionWorkerDeps,
  runExtractionLoop,
  runExtractionOnce,
} from '../evidence/extraction-worker.js';

export const EXTRACTION_USAGE = {
  usage: 'zuri-agent extraction serve | zuri-agent extraction once',
  required: ['ZURI_CLOUD_BASE_URL', 'ZURI_EDGE_DEVICE_KEY'],
  optional: ['ZURI_EXTRACTION_VISION_MODEL', 'ZURI_LLM_BASE_URL', 'ZURI_EDGE_POLL_MS', 'ZURI_EXTRACTION_TIMEOUT_MS'],
};

/**
 * What `serve`/`once` were built from, minus the parts that talk to the world.
 *
 * Returned as data rather than acted on, so the CLI can refuse a half-configured device
 * with a specific message instead of a stack trace, and so a test can assert what would
 * have been built without building it.
 */
interface Prepared {
  deps: ExtractionWorkerDeps;
  cloudBaseUrl: string;
  visionModel: string;
  visionAvailable: boolean;
}

function prepare(): Prepared | { error: string; details: Record<string, unknown> } {
  const config = loadConfig();
  const cloudBaseUrl = config.cloudBaseUrl || '';
  const deviceKey = config.edgeDeviceKey || '';

  if (!cloudBaseUrl || !deviceKey) {
    return {
      error:
        'Set both ZURI_CLOUD_BASE_URL and ZURI_EDGE_DEVICE_KEY before running the extraction worker.',
      // Booleans, never values: whether a key is present is diagnosable, the key is not.
      details: { cloudBaseUrlConfigured: Boolean(cloudBaseUrl), deviceKeyConfigured: Boolean(deviceKey) },
    };
  }

  /*
   * The vision port, or null.
   *
   * `openai-compatible` only, and deliberately so: the point of this whole lane is that a
   * business's evidence never leaves its own hardware, so a hosted provider is not a
   * fallback here, it is the thing being avoided. A device without a local daemon or
   * without a named vision model gets null, the worker still runs, and every job is failed
   * with a reason the console can show — see `extraction-extractor.ts`.
   */
  const visionModel = config.edgeExtractionVisionModel || '';
  const daemonBaseUrl = config.llmBaseUrl || '';
  const port =
    visionModel && daemonBaseUrl
      ? createModelPort({
          provider: 'openai-compatible',
          model: visionModel,
          effort: 'low',
          baseUrl: daemonBaseUrl,
          numCtx: config.llmNumCtx,
        })
      : null;

  const unavailableReason = visionModel
    ? 'อุปกรณ์นี้ยังไม่ได้ตั้งค่าที่อยู่ของโมเดลในเครื่อง จึงยังอ่านเอกสารไม่ได้ ' +
      '(ZURI_EXTRACTION_VISION_MODEL is set but ZURI_LLM_BASE_URL is not, so there is no local daemon to call)'
    : 'อุปกรณ์นี้ยังไม่ได้ตั้งค่าโมเดลอ่านภาพ จึงยังอ่านเอกสารไม่ได้ ' +
      '(this Zuri Edge Device has no vision-capable local model configured; set ZURI_EXTRACTION_VISION_MODEL)';

  const client = createExtractionClient({ baseUrl: cloudBaseUrl, deviceKey });
  const extract = createLocalEvidenceExtractor({
    port,
    timeoutMs: config.edgeExtractionTimeoutMs || 120000,
    unavailableReason,
  });

  return {
    deps: {
      client,
      extract,
      pollMs: config.edgeExtractionPollMs || 5000,
      onEvent: reportEvent,
    },
    cloudBaseUrl,
    visionModel,
    visionAvailable: Boolean(port),
  };
}

/** Worker events as stderr diagnostics. Job ids and statuses only — never bytes, never a key. */
function reportEvent(event: ExtractionEvent): void {
  switch (event.type) {
    case 'idle':
      return; // Silence between polls; an idle cloud is not news.
    case 'claimed':
      logDiagnostic(`extraction claimed job ${event.jobId}`, { evidenceId: event.evidenceId, mime: event.mime });
      return;
    case 'completed':
      logDiagnostic(`extraction completed job ${event.jobId}`, { model: event.model, fields: event.fieldCount });
      return;
    case 'failed':
      logDiagnostic(`extraction failed job ${event.jobId}`, { reason: event.reason });
      return;
    case 'unreported':
      logDiagnostic(`extraction could not report the verdict for job ${event.jobId}; its lease will expire and the cloud will requeue it`, {
        reason: event.reason,
      });
      return;
    case 'retrying':
      logDiagnostic(`extraction backing off ${event.delayMs}ms after failure ${event.attempt}`, { reason: event.reason });
      return;
    case 'stopping':
      logDiagnostic(`extraction stopping (${event.reason})`);
      return;
  }
}

/** The message an operator needs when a 401 comes back. There is nothing to retry. */
const CREDENTIAL_MESSAGE =
  'The cloud rejected this device credential. A 401 covers missing, malformed, unknown and ' +
  'revoked keys alike, so there is nothing to diagnose from here: mint a new credential in ' +
  'the console (/platform/integrations → Edge) and reinstall ZURI_EDGE_DEVICE_KEY.';

export async function runExtractionServeCommand(): Promise<void> {
  const prepared = prepare();
  if ('error' in prepared) {
    printJsonError('EXTRACTION_NOT_CONFIGURED', prepared.error, { ...prepared.details, ...EXTRACTION_USAGE }, 1);
    return;
  }

  /*
   * Stop between jobs, not during one.
   *
   * The flag is only read at the top of each pass, so a job already claimed is completed or
   * failed before the loop returns. Abandoning it would leave the cloud showing "Edge Device
   * กำลังประมวลผล" for ten minutes on a device that has exited.
   *
   * A second signal is not special-cased: if an operator has to kill a stuck read, the OS
   * still has SIGKILL, and the lease expiry is the cloud's answer to a device that dies.
   */
  let stopping = false;
  const stop = (signal: string) => () => {
    if (stopping) return;
    stopping = true;
    logDiagnostic(`extraction received ${signal}; finishing the job in hand before exiting`);
  };
  process.on('SIGINT', stop('SIGINT'));
  process.on('SIGTERM', stop('SIGTERM'));

  logDiagnostic('extraction serve started', {
    cloud: prepared.cloudBaseUrl,
    pollMs: prepared.deps.pollMs,
    concurrency: 1,
    visionModel: prepared.visionModel || '(none)',
  });

  const summary = await runExtractionLoop({ ...prepared.deps, shouldStop: () => stopping });

  if (summary.stoppedBy === 'credential') {
    printJsonError('EXTRACTION_CREDENTIAL_REJECTED', CREDENTIAL_MESSAGE, summary, 1);
    return;
  }
  printJsonSuccess({ ...summary, visionAvailable: prepared.visionAvailable });
}

export async function runExtractionOnceCommand(): Promise<void> {
  const prepared = prepare();
  if ('error' in prepared) {
    printJsonError('EXTRACTION_NOT_CONFIGURED', prepared.error, { ...prepared.details, ...EXTRACTION_USAGE }, 1);
    return;
  }

  try {
    const result = await runExtractionOnce(prepared.deps);
    printJsonSuccess({
      ...result,
      visionAvailable: prepared.visionAvailable,
      note:
        result.outcome === 'idle'
          ? 'The cloud has no queued extraction job for this Business right now (204).'
          : undefined,
    });
  } catch (error) {
    if (error instanceof ExtractionAuthError) {
      printJsonError('EXTRACTION_CREDENTIAL_REJECTED', CREDENTIAL_MESSAGE, undefined, 1);
      return;
    }
    printJsonError(
      'EXTRACTION_FAILED',
      error instanceof Error ? error.message : String(error),
      undefined,
      1
    );
  }
}
