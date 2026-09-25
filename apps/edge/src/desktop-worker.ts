// Retired with Edge Device enrollment. Local Knowledge/RAG remains available through its own
// runtime; this compatibility entrypoint never accepts a device credential or starts execution.
const REMOVED = 'EDGE_DESKTOP_WORKER_REMOVED';

const entrypoint = process.argv[1]?.replaceAll('\\', '/').split('/').at(-1);
if (entrypoint === 'desktop-worker.ts' || entrypoint === 'desktop-worker.js') {
  process.stderr.write(`${REMOVED}\n`);
  process.exitCode = 78;
}
