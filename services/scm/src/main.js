import { pathToFileURL } from 'node:url'
import { loadConfig } from './config.js'
import { openStore } from './infrastructure/store.js'
import { createDelegationVerifier } from './infrastructure/delegation.js'
import { createCommandBus } from './application/commands.js'
import { createScmHttpServer } from './http/server.js'
import { readFileSync } from 'node:fs'
import { createFixtureReferenceAuthority, createUnavailableReferenceAuthority } from './infrastructure/reference-authority.js'
import { createScmCoreClient } from './infrastructure/core-client.js'
import { createCoreReferenceAuthority, createCoreScopeResolver } from './infrastructure/core-reference-authority.js'
import { coreAuthenticator, delegationAuthenticator } from './http/authenticate.js'

// Composition root of the SCM process (ADR draft: SCM service extraction). The
// only file that reads process.env and the only place adapters are chosen.
// SIGTERM/SIGINT: readiness flips to draining, in-flight units of work finish
// (the store queue is awaited), then the connection closes.

function log(level, message, fields = {}) {
  process.stdout.write(`${JSON.stringify({ level, message, service: 'scm', ...fields })}\n`)
}

export async function start(env = process.env) {
  const config = loadConfig(env)
  // Inbound auth (SCM_AUTH_MODE). core: the BFF's static bearer + the user's
  // subject, resolved into scope by core (scm-core.v1); Branch/Customer/Conversation
  // facts come from the same façade. delegation (tests / non-production): the
  // HMAC-signed scope, and no reference owner. Either way the Files façade (gate
  // SCM-FILES) does not exist yet, so slip references refuse (503) rather than
  // assume validity. SCM_TEST_REFERENCE_FIXTURE (SCM_ENV=test only) overrides the
  // reference owner in both modes.
  const core = config.authMode === 'core'
    ? createScmCoreClient({ baseUrl: config.coreUrl, token: config.coreToken, timeoutMs: config.coreTimeoutMs })
    : null
  const authenticate = core
    ? coreAuthenticator({ apiToken: config.apiToken, resolveScope: createCoreScopeResolver(core) })
    : delegationAuthenticator(createDelegationVerifier({ key: config.delegationKey, issuer: config.delegationIssuer, maxLifetimeSeconds: config.delegationMaxLifetimeSeconds }))
  const references = config.testReferenceFixture
    ? createFixtureReferenceAuthority(JSON.parse(readFileSync(config.testReferenceFixture, 'utf8')))
    : core ? createCoreReferenceAuthority(core) : createUnavailableReferenceAuthority()
  const store = openStore({ store: config.store, sqlitePath: config.sqlitePath, pgUrl: config.pgUrl, ensureSchema: config.ensureSchema })
  const bus = createCommandBus({ store, references })
  const http = createScmHttpServer({ config, store, bus, authenticate, log })
  const address = await http.listen()
  // Mode names only: never a token, key, URL credential or subject.
  log('info', 'listening', { port: address.port, store: store.kind, env: config.env, auth: config.authMode, references: references.kind })

  let stopping
  const stop = (signal) => {
    stopping ??= (async () => {
      log('info', 'draining', { signal })
      await http.close()
      await store.close()
      log('info', 'stopped')
    })()
    return stopping
  }
  return { config, address, stop }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().then((running) => {
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => running.stop(signal).then(() => process.exit(0), () => process.exit(1)))
  }).catch((error) => {
    log('error', 'failed to start', { code: error.code ?? 'SCM_START_FAILED', error: error.message })
    process.exit(1)
  })
}
