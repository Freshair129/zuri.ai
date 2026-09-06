import { loadConfig } from '../config/index.js';
import { createConversationClient } from '../conversation/client.js';
import { createConversationExecutor } from '../conversation/executor.js';
import { requireComputeWorker } from '../conversation/contract.js';
import { runConversationLoop, runConversationOnce } from '../conversation/worker.js';
import { logDiagnostic } from '../safety/redact.js';
import { printJsonSuccess } from './output.js';
import { HttpZuriApiClient } from '../zuri-api/client.js';
import { startHeartbeat } from '../zuri-api/heartbeat.js';
import { GenesisLocalRag } from '../rag/genesis-rag.js';
import { isLoopbackUrl } from '../conversation/contract.js';

export async function runConversationCommand(subcommand: string | undefined): Promise<void> {
  requireComputeWorker();
  if (subcommand !== 'once' && subcommand !== 'serve') throw new Error('Use conversation once | conversation serve');
  const config = loadConfig();
  const client = createConversationClient({ baseUrl: config.cloudBaseUrl || '', deviceKey: config.edgeDeviceKey || '' });
  const deps = { client, answer: createConversationExecutor(config) };
  if (subcommand === 'once') { printJsonSuccess(await runConversationOnce(deps)); return; }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const stopHeartbeat = startHeartbeat({
    client: new HttpZuriApiClient({
      baseUrl: config.apiBaseUrl || '', deviceId: config.deviceId || '', deviceToken: config.deviceToken || '',
      cloudBaseUrl: config.cloudBaseUrl || '', deviceKey: config.edgeDeviceKey || '',
    }),
    deviceId: config.deviceId || '', intervalMs: config.heartbeatIntervalMs,
    status: async () => {
      const ragUrl = process.env.GENESIS_RAG_API_URL || 'http://127.0.0.1:8888';
      if (!isLoopbackUrl(ragUrl)) return 'degraded';
      const health = await new GenesisLocalRag({ apiUrl: ragUrl, fetchImpl: (input, init) => fetch(input, { ...init, redirect: 'error' }) }).health();
      return health.ok ? 'healthy' : 'degraded';
    },
    onEvent: event => logDiagnostic('conversation-heartbeat', { ok: event.ok, status: event.status }),
  });
  logDiagnostic('conversation worker started', { transportOwner: 'SERVER', concurrency: 1 });
  try {
    await runConversationLoop({
      ...deps, signal: controller.signal, pollMs: config.edgeExtractionPollMs || 5000,
      onEvent: event => { if (event.outcome !== 'idle') logDiagnostic('conversation', { ...event }); },
    });
  } finally { stopHeartbeat(); process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
