// @spec ADR-115 — fixture-private binding to HTTP-created TEST Business identities.
// @tested tests/node/compact-journey.test.mjs, tests/integration/compact-knowledge-journey.test.js
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { compactProcessEnvironment } from '../../scripts/lib/compact/docker.mjs'
export function readCompactJourneyCorpus({ sourceRevision, read = args => execFileSync('git', args, { env: compactProcessEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) }) {
  if (!/^[a-f0-9]{40}$/.test(sourceRevision || '')) throw new Error('COMPACT_JOURNEY_CORPUS_REVISION_REQUIRED')
  const bytes = read(['show', `${sourceRevision}:apps/server/tests/fixtures/genesisrag17-corpus-v1.json`])
  const fixture = JSON.parse(bytes.toString('utf8'))
  if (fixture.fixtureVersion !== 'ki17-corpus-v1' || typeof fixture.text !== 'string' || !fixture.text || !Array.isArray(fixture.queries) || !fixture.queries.length) throw new Error('COMPACT_JOURNEY_CORPUS_INVALID')
  return { fixture, sha256: createHash('sha256').update(bytes).digest('hex') }
}
function parse(text) {
  const result = Object.create(null)
  for (const line of text.trim().split('\n')) {
    const at = line.indexOf('='), key = line.slice(0, at)
    if (at < 1 || !/^[A-Z][A-Z0-9_]*$/.test(key) || Object.hasOwn(result, key)) throw new Error('COMPACT_JOURNEY_CONFIGURATION_INVALID')
    result[key] = line.slice(at + 1)
  }
  return result
}
const serialize = values => Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
export function bindCompactKnowledgeBusiness(configuration, identities) {
  const keys = ['portfolioId', 'tenantId', 'businessId']
  if (!identities || Object.keys(identities).length !== 3 || keys.some(k => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(identities[k]))) throw new Error('COMPACT_JOURNEY_SCOPE_REQUIRED')
  const scope = { portfolioId: identities.portfolioId, tenantId: identities.tenantId, businessId: identities.businessId, workspaceId: '', agentId: '', visibility: 'private' }
  const app = parse(configuration.app), native = parse(configuration.knowledge)
  const principals = JSON.parse(native.MSP_PIPELINE_PRINCIPALS)
  if (principals.length !== 2 || !principals.some(p => p.role === 'source') || !principals.some(p => p.role === 'worker')) throw new Error('COMPACT_JOURNEY_CONFIGURATION_INVALID')
  native.GENESIS_WORKER_SCOPE = JSON.stringify(scope)
  native.MSP_PIPELINE_PRINCIPALS = JSON.stringify(principals.map(p => ({ ...p, scope })))
  native.GENESIS_WORKER_BENCHMARK_FIXTURE = '/opt/ki17/fixtures/genesisrag17-corpus-v1.json'
  for (const [key, value] of Object.entries(native)) if (key.startsWith('MSP_') || key.startsWith('GKS_')) app[key] = value
  Object.assign(app, { ZURI_KNOWLEDGE_ENABLED: '1', ZURI_KNOWLEDGE_STORAGE_ENABLED: '0',
    ZURI_KNOWLEDGE_BINDINGS: JSON.stringify([{ scope, policy: { allowEmbedding: true, allowPublication: true } }]),
    ZURI_MSP_COMMAND: '/opt/ki17/node/bin/node', ZURI_MSP_ARGS: JSON.stringify(['apps/msp-server/bin/msp-server.mjs']), ZURI_MSP_CWD: '/opt/ki17/msp' })
  return { ...configuration, scope, app: serialize(app), knowledge: serialize(native) }
}
