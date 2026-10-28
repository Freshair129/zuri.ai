// @spec ADR-115 — scoped TEST configuration and certificate-verified loopback HTTP.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { targetFixture } from './compact-task2-fixtures.mjs'
import { compactKnowledgeCohortConfiguration } from '../helpers/compact-knowledge-cohort.mjs'
const env = text => Object.fromEntries(text.trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)] }))

test('journey corpus comes from the explicit package commit, never ambient checkout or web image', async () => {
  const { readCompactJourneyCorpus } = await import('../helpers/compact-knowledge-journey.mjs')
  const sourceRevision = 'a'.repeat(40), bytes = Buffer.from(JSON.stringify({ fixtureVersion: 'ki17-corpus-v1', text: 'Synthetic.', queries: [{ query: 'Synthetic?' }] }))
  const calls = [], result = readCompactJourneyCorpus({ sourceRevision, read: args => { calls.push(args); return bytes } })
  assert.deepEqual(calls, [['show', `${sourceRevision}:apps/server/tests/fixtures/genesisrag17-corpus-v1.json`]])
  assert.equal(result.fixture.text, 'Synthetic.'); assert.match(result.sha256, /^[a-f0-9]{64}$/)
  assert.throws(() => readCompactJourneyCorpus({ sourceRevision: 'HEAD', read: () => { throw new Error('MUST_NOT_READ') } }), /COMPACT_JOURNEY_CORPUS_REVISION_REQUIRED/)
})

test('Business journey binding preserves private keys and binds both principals to explicit real IDs', async () => {
  const { bindCompactKnowledgeBusiness } = await import('../helpers/compact-knowledge-journey.mjs')
  const target = targetFixture(), config = compactKnowledgeCohortConfiguration({ target, root: path.dirname(target.secretFiles.bootstrapEnvironment), webPort: 39123 })
  const beforeApp = config.app, beforeNative = config.knowledge, ids = { portfolioId: randomUUID(), tenantId: randomUUID(), businessId: randomUUID() }
  const bound = bindCompactKnowledgeBusiness(config, ids), app = env(bound.app), native = env(bound.knowledge)
  assert.equal(config.app === beforeApp && config.knowledge === beforeNative, true)
  assert.equal(app.ZURI_SESSION_SECRET === env(beforeApp).ZURI_SESSION_SECRET, true)
  assert.equal(app.ZURI_SECRET_KEK === env(beforeApp).ZURI_SECRET_KEK, true)
  assert.equal(app.ZURI_KNOWLEDGE_ENABLED, '1'); assert.equal(app.ZURI_KNOWLEDGE_STORAGE_ENABLED, '0')
  assert.equal(Object.keys(app).some(key => key.startsWith('GENESIS_') || /^(?:ZURI_LINE_|ZURI_MSP_THREAD_|MSP_THREAD_|OLLAMA_)/.test(key)), false)
  assert.deepEqual(JSON.parse(app.ZURI_KNOWLEDGE_BINDINGS)[0].scope, { ...ids, workspaceId: '', agentId: '', visibility: 'private' })
  assert.equal(JSON.parse(native.MSP_PIPELINE_PRINCIPALS).every(p => JSON.stringify(p.scope) === JSON.stringify(bound.scope)), true)
  assert.equal(app.MSP_PIPELINE_PRINCIPALS === native.MSP_PIPELINE_PRINCIPALS, true)
  assert.equal(native.GENESIS_WORKER_QUERY_TOKEN === env(beforeNative).GENESIS_WORKER_QUERY_TOKEN, true)
  assert.equal(native.GENESIS_WORKER_BENCHMARK_FIXTURE, '/opt/ki17/fixtures/genesisrag17-corpus-v1.json')
})

test('Business journey refuses absent/incomplete identities instead of selecting another scope', async () => {
  const { bindCompactKnowledgeBusiness } = await import('../helpers/compact-knowledge-journey.mjs')
  const target = targetFixture(), config = compactKnowledgeCohortConfiguration({ target, root: path.dirname(target.secretFiles.bootstrapEnvironment), webPort: 39123 })
  for (const ids of [undefined, {}, { portfolioId: randomUUID(), tenantId: randomUUID() }, { portfolioId: randomUUID(), tenantId: randomUUID(), businessId: 'foreign' }]) assert.throws(() => bindCompactKnowledgeBusiness(config, ids))
})

test('journey HTTPS client refuses non-loopback, non-TLS and missing trust before connecting', async () => {
  const { compactJourneyHttpsClient } = await import('../helpers/compact-journey-https.mjs')
  for (const [baseURL, ca] of [['http://127.0.0.1:3000', 'CERT'], ['https://example.com', 'CERT'], ['https://127.0.0.1:3000/path', 'CERT'], ['https://127.0.0.1:3000', undefined]]) assert.throws(() => compactJourneyHttpsClient({ baseURL, ca }))
})
