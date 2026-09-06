// Entrypoint for the v4 RAG service: `npm run rag:serve`.
//
// Serves the GenesisBlock run that CURRENT names. Restart it after every ingest — the store is
// opened once at startup, which is exactly why ingest warns when /health reports a stale run.
import { startRagServer } from '../src/rag/v4/serve.js';

async function main(): Promise<void> {
  const server = await startRagServer();
  const health = await server.health();
  console.log(`[rag-serve] ${JSON.stringify(health)}`);
  if (!health.embedReady) {
    console.warn('[rag-serve] WARNING: embed sidecar unreachable; /api/rag/search will fail until it is up.');
  }

  const shutdown = (signal: string) => {
    console.log(`[rag-serve] ${signal} — closing.`);
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[rag-serve] failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
