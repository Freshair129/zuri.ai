// ADR-075 Phase 3, prerequisite P-5 — the read-only relay smoke for the operator.
//
// HOW TO RUN IT. Inside the web container, as step 4 of the deploy procedure
// (docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md §10), and again after every web
// recreate — web's network namespace is the worker's namespace, so recreating web
// can leave the worker listening in a dead one (risk R-2):
//
//   docker compose exec web node scripts/ki17-smoke.mjs
//
// Nothing runs this automatically. It is not in CI, not a compose `command`, not a
// healthcheck. The healthcheck answers "is the worker listening"; this answers "do
// both relay hops work", which is a different question and an operator's to ask.
//
// It prints one harmless Node warning first — MODULE_TYPELESS_PACKAGE_JSON, because
// it imports the real transport, a `.js` ESM file, and the standalone /app/package.json
// declares no type. It is noted here so nobody reads it as a fault. It imports the
// real transport on purpose: a copy of the transport would prove that the copy works.
// `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ki17-smoke.mjs` silences it.
//
// WHAT IT PROVES, AND WHAT IT REFUSES TO DO.
//
//   1. msp_pipeline_evidence for a run id that cannot exist, as the source role.
//      An empty page proves zuri-ai -> MSP -> GKS: MSP started, read its store,
//      spawned GKS, and GKS answered. A run id nobody has is the point — the check
//      must not depend on, or disturb, any real run.
//   2. msp_pipeline_query. Either a published-generation result or a typed
//      pipeline_worker_* / no-published-generation answer proves
//      zuri-ai -> MSP -> worker over loopback. Both are a PASS: before the first
//      run there is nothing published, and "the worker answered that it has nothing"
//      is exactly as much proof of the hop as a hit would be.
//
// It is READ-ONLY. It submits no batch, claims no decision, writes no receipt and
// publishes nothing.
//
// It prints OUTCOME CODES ONLY — never a credential, never a scope's ids, never a
// query result's text, never an MSP error's body. An operator pastes this output
// into a deploy record, so anything printed here is effectively published (§10 step 7:
// "Never record credentials or payloads").
//
// Exit code 0 = both hops proved; 1 = at least one did not.

import { createMspTransportFromEnvironment } from '../src/modules/agent/msp-stdio-transport.js'

const SCHEMA_VERSION = 'genesisrag17.v1'
const SCOPE_KEYS = ['portfolioId', 'tenantId', 'businessId', 'workspaceId', 'agentId', 'visibility']

/** Never printed: only its shape is ever reported. */
function readSourcePrincipal(env) {
  if (!env.MSP_PIPELINE_PRINCIPALS) throw new Error('MSP_PIPELINE_PRINCIPALS is unset')
  let principals
  try {
    principals = JSON.parse(env.MSP_PIPELINE_PRINCIPALS)
  } catch {
    throw new Error('MSP_PIPELINE_PRINCIPALS is not valid JSON')
  }
  if (!Array.isArray(principals)) throw new Error('MSP_PIPELINE_PRINCIPALS is not an array')
  // C3/C13: exactly one source grant. The scope comes from the grant rather than from
  // ZURI_KNOWLEDGE_BINDINGS on purpose — step 4 runs while knowledge is still off.
  const sources = principals.filter((entry) => entry?.role === 'source' && entry?.credential && entry?.scope)
  if (sources.length !== 1) throw new Error(`MSP_PIPELINE_PRINCIPALS holds ${sources.length} source grants, expected exactly 1`)
  const [source] = sources
  const missing = SCOPE_KEYS.filter((key) => typeof source.scope[key] !== 'string')
  if (missing.length) throw new Error(`the source grant's scope is missing ${missing.length} of the six required fields`)
  return source
}

function outcome(step, verdict, code, detail) {
  const line = `${verdict === 'PASS' ? 'PASS' : 'FAIL'}  ${step.padEnd(24)} ${code}${detail ? `  (${detail})` : ''}`
  process.stdout.write(`${line}\n`)
  return verdict === 'PASS'
}

/**
 * MSP surfaces a tool error as text (msp-stdio-transport turns `isError` into a
 * thrown error carrying the tool's own message). Reduce it to the leading typed
 * token — `pipeline_worker_unavailable`, `gks_provider_unconfigured` — and drop
 * everything after it, so a message that quotes a payload cannot leak through.
 */
function typedCode(error) {
  const text = String(error?.message ?? '')
  const token = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+){1,6})\b/.exec(text)
  if (token) return token[1]
  if (error?.code) return String(error.code)
  return 'untyped_error'
}

async function checkEvidenceHop(transport, source) {
  // A run id no run can have: the pull is scoped and the id is random, so MSP/GKS
  // must answer with an empty page for it and cannot touch anything real.
  const runId = `ki17-smoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  try {
    const page = await transport('msp_pipeline_evidence', {
      schemaVersion: SCHEMA_VERSION,
      scope: source.scope,
      credential: source.credential,
      runId,
      afterCursor: 0,
      limit: 1,
    })
    if (page?.schemaVersion !== SCHEMA_VERSION) return outcome('msp_pipeline_evidence', 'FAIL', 'schema_version_mismatch')
    const rows = Array.isArray(page.rows) ? page.rows.length : null
    if (rows === null) return outcome('msp_pipeline_evidence', 'FAIL', 'rows_absent')
    if (rows !== 0) return outcome('msp_pipeline_evidence', 'FAIL', 'unexpected_rows', `${rows} rows for an id no run has`)
    return outcome('msp_pipeline_evidence', 'PASS', 'empty_page', 'MSP -> GKS answered')
  } catch (error) {
    return outcome('msp_pipeline_evidence', 'FAIL', typedCode(error), 'MSP -> GKS did not answer')
  }
}

async function checkWorkerHop(transport, source) {
  try {
    const result = await transport('msp_pipeline_query', {
      schemaVersion: SCHEMA_VERSION,
      scope: source.scope,
      credential: source.credential,
      query: 'ki17 loopback readiness probe',
      topK: 1,
    })
    if (result?.schemaVersion !== SCHEMA_VERSION) return outcome('msp_pipeline_query', 'FAIL', 'schema_version_mismatch')
    // Result COUNT only. The texts and citations are the customer's data.
    const count = Array.isArray(result.results) ? result.results.length : 0
    return outcome('msp_pipeline_query', 'PASS', 'published_generation', `${count} result(s), worker reached over loopback`)
  } catch (error) {
    const code = typedCode(error)
    // Before the first run nothing is published, and the worker saying so is the hop
    // working. A transport/plumbing failure is not, and reads differently.
    const provesTheHop = /^pipeline_worker_/.test(code) && code !== 'pipeline_worker_unavailable'
      || /no_published_generation|generation_not_published|no_published/.test(code)
    if (provesTheHop) return outcome('msp_pipeline_query', 'PASS', code, 'typed worker answer, loopback reached')
    return outcome('msp_pipeline_query', 'FAIL', code, 'MSP -> worker over loopback did not answer')
  }
}

async function main() {
  process.stdout.write('ki17 relay smoke (read-only; outcome codes only, no payloads or credentials)\n')

  const transport = createMspTransportFromEnvironment(process.env)
  if (!transport) {
    process.stdout.write('FAIL  configuration             msp_transport_unconfigured  (ZURI_MSP_COMMAND is unset)\n')
    return 1
  }

  let source
  try {
    source = readSourcePrincipal(process.env)
  } catch (error) {
    process.stdout.write(`FAIL  configuration             principals_invalid  (${error.message})\n`)
    return 1
  }
  if (!process.env.MSP_PIPELINE_WORKER_URL) {
    process.stdout.write('FAIL  configuration             worker_url_unset  (MSP_PIPELINE_WORKER_URL)\n')
    return 1
  }

  const evidenceOk = await checkEvidenceHop(transport, source)
  const workerOk = await checkWorkerHop(transport, source)

  process.stdout.write(evidenceOk && workerOk
    ? '\nOK  both relay hops proved. This says nothing about whether a run can publish (§10 step 6).\n'
    : '\nNOT READY  at least one relay hop did not answer. Read `docker logs` for both containers (§10 health checks).\n')
  return evidenceOk && workerOk ? 0 : 1
}

main().then((code) => { process.exitCode = code }, (error) => {
  process.stdout.write(`FAIL  smoke                    unhandled  (${typedCode(error)})\n`)
  process.exitCode = 1
})
