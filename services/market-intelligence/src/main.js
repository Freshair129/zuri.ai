import { pathToFileURL } from 'node:url'

import { loadConfig } from './config.js'
import { createCoreClient } from './adapters/core-client.js'
import { createPgObservationStoreFactory } from './adapters/pg-observation-store.js'
import { createMarketHttpServer } from './http/server.js'

// Composition root of the Market Intelligence process (ADR-108). The only file that
// reads process.env and the only place adapters are chosen. SIGTERM/SIGINT drain:
// readiness flips to DRAINING, in-flight requests finish, then the store closes.
// @req FR-092, NFR-018
// @spec ADR-108
// @tested services/market-intelligence/test/process-start.test.js

function log(level, message, fields = {}) {
  process.stdout.write(`${JSON.stringify({ level, message, service: 'market-intelligence', ...fields })}\n`)
}

export async function start(env = process.env) {
  const config = loadConfig(env)
  // node:sqlite is imported only for the dev/test store, so a production (postgres)
  // process never loads the experimental module.
  const storeFactory = config.store === 'postgres'
    ? createPgObservationStoreFactory({ connectionString: config.databaseUrl })
    : (await import('./adapters/sqlite-observation-store.js')).createSqliteObservationStoreFactory({ location: config.sqlitePath })
  if (config.ensureSchema && storeFactory.ensureTestSchema) await storeFactory.ensureTestSchema({ disposable: true })

  const core = createCoreClient({ baseUrl: config.coreUrl, token: config.coreToken })
  const http = createMarketHttpServer({ config, storeFactory, core, log })
  const address = await http.listen(config.port)
  log('info', 'listening', { port: address.port, store: storeFactory.kind, env: config.env })

  let stopping
  const stop = (signal) => {
    stopping ??= (async () => {
      log('info', 'draining', { signal })
      await http.close()
      await storeFactory.close()
      log('info', 'stopped')
    })()
    return stopping
  }
  return { config, address, stop }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().then((running) => {
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.once(signal, () => running.stop(signal).then(() => process.exit(0), () => process.exit(1)))
    }
  }).catch((error) => {
    log('error', 'failed to start', { error: error.message })
    process.exit(1)
  })
}
