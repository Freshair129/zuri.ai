// @spec ADR-115 — private synthetic idle-cohort TEST inputs; no application authority.
// @tested tests/node/compact-profile.test.mjs, tests/integration/compact-knowledge-cohort.test.js
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { validateCompactTarget } from '../../scripts/lib/compact/target.mjs'
import { assertCompactFixtureOwnership } from './compact-postgres-target.mjs'

export function compactKnowledgeCohortConfiguration({ target, root, webPort }) {
  const t = validateCompactTarget(target)
  if (typeof root !== 'string' || !path.isAbsolute(root) || /[\r\n']/.test(root) || !Number.isInteger(webPort) || webPort < 1 || webPort > 65535 || webPort === t.database.port ||
      Object.values(t.secretFiles).some(file => path.dirname(file) !== root)) throw new Error('COMPACT_COHORT_CONFIGURATION_INVALID')
  const secret = () => randomBytes(32).toString('hex'), source = secret(), worker = secret(), token = secret(), relay = secret()
  const scope = { portfolioId: randomUUID(), tenantId: randomUUID(), businessId: randomUUID(), workspaceId: '', agentId: '', visibility: 'private' }
  const env = values => Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
  const app = env({ ZURI_SESSION_SECRET: secret(), ZURI_SECRET_STORE: 'envelope', ZURI_SECRET_KEK: secret(), ZURI_SECRET_KEK_VERSION: '1', ZURI_KNOWLEDGE_ENABLED: '0', ZURI_KNOWLEDGE_STORAGE_ENABLED: '0' })
  const knowledge = env({
    GENESIS_WORKER_DB_PATH: '/var/lib/zuri-ki17/genesis', GENESIS_WORKER_MODEL_DIR: '/opt/ki17/model', GENESIS_WORKER_SCOPE: JSON.stringify(scope),
    GENESIS_WORKER_CREDENTIAL: worker, GENESIS_WORKER_QUERY_TOKEN: token,
    GENESIS_WORKER_BENCHMARK_FIXTURE: '/opt/ki17/fixtures/genesisrag17-smartgift-benchmark-v1.json', GENESIS_WORKER_PORT: '19417',
    GENESIS_WORKER_MSP_COMMAND: '/opt/ki17/node/bin/node', GENESIS_WORKER_MSP_ARGS: JSON.stringify(['/opt/ki17/tools/ki17-worker-msp-launcher.mjs']), GENESIS_WORKER_MSP_CWD: '/opt/ki17',
    MSP_DB_PATH: '/var/lib/zuri-ki17/state/msp.sqlite', GKS_DB_PATH: '/var/lib/zuri-ki17/state/gks.sqlite', MSP_GKS_TRANSPORT: 'stdio',
    MSP_GKS_COMMAND: '/opt/ki17/node/bin/node', MSP_GKS_ARGS: JSON.stringify(['apps/gks-server/bin/gks-server.mjs']), MSP_GKS_CWD: '/opt/ki17/gks',
    MSP_GKS_PIPELINE_CREDENTIAL: relay, GKS_PIPELINE_RELAY_CREDENTIAL: relay,
    MSP_PIPELINE_PRINCIPALS: JSON.stringify([{ credential: source, principalId: 'compact-test-source', role: 'source', scope }, { credential: worker, principalId: 'compact-test-worker', role: 'worker', scope }]),
    MSP_PIPELINE_WORKER_URL: 'http://127.0.0.1:19417', MSP_PIPELINE_WORKER_TOKEN: token,
  })
  const storage = env({ MINIO_ROOT_USER: secret(), MINIO_ROOT_PASSWORD: secret() })
  const files = { app: path.join(root, 'private app.env'), knowledge: path.join(root, 'private knowledge.env'), storage: path.join(root, 'private storage.env') }
  const selectors = { COMPACT_PROJECT_NAME: t.project, COMPACT_TARGET_ID: t.targetId, COMPACT_WEB_PORT: webPort, COMPACT_PUBLIC_BASE_URL: `https://127.0.0.1:${webPort}`,
    COMPACT_APP_ENV_FILE: files.app, COMPACT_KNOWLEDGE_ENV_FILE: files.knowledge, COMPACT_STORAGE_ADMIN_ENV_FILE: files.storage,
    COMPACT_DATABASE_ENV_FILE: t.secretFiles.bootstrapEnvironment, COMPACT_DATABASE_RUNTIME_ENV_FILE: t.secretFiles.runtimeEnvironment,
    COMPACT_DATABASE_CONTAINER: t.database.container, COMPACT_DATABASE_PORT: t.database.port, COMPACT_DATABASE_VOLUME: t.volumes.database, COMPACT_OBJECTS_VOLUME: t.volumes.objects, COMPACT_PRIVATE_NETWORK: t.network }
  return { app, knowledge, storage, files, scope, selectors }
}

export function assertCompactKnowledgeCohortContainer({ container, role, target, manifest, expectedImageId }) {
  const t = validateCompactTarget(target), key = role === 'web' ? 'web' : role === 'genesis-worker' ? 'genesisWorker' : null
  if (!key || !/^sha256:[a-f0-9]{64}$/.test(expectedImageId) || !container || !/^[a-f0-9]{64}$/.test(container.Id) || container.Image !== expectedImageId || container.Name !== `/${t.project}-${role}-1` || container.Config?.Image !== manifest.images[key]) throw new Error('COMPACT_COHORT_CONTAINER_REFUSED')
  assertCompactFixtureOwnership('container', container, t)
}

export function assertCompactKnowledgeProjectInventory({ ids, database, target, manifest }) {
  const t = validateCompactTarget(target)
  if (!Array.isArray(ids) || ids.length !== 1 || !database || !/^[a-f0-9]{64}$/.test(database.Id) || ids[0] !== database.Id ||
      database.Name !== '/' + t.database.container || database.Config?.Image !== manifest.images.postgres ||
      database.Config?.Labels?.['com.docker.compose.project'] !== t.project || database.Config?.Labels?.['com.docker.compose.service'] !== 'db') throw new Error('COMPACT_COHORT_PROJECT_REFUSED')
  assertCompactFixtureOwnership('container', database, t)
}

export function assertCompactKnowledgeNegativeProbe({ container, probeName, target, manifest, expectedImageId }) {
  const t = validateCompactTarget(target), prefix = `${t.project}-missing-token-`
  if (typeof probeName !== 'string' || !probeName.startsWith(prefix) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(probeName.slice(prefix.length)) ||
      !/^sha256:[a-f0-9]{64}$/.test(expectedImageId) || !container || !/^[a-f0-9]{64}$/.test(container.Id) || container.Name !== '/' + probeName || container.Config?.Image !== manifest.images.genesisWorker || container.Image !== expectedImageId ||
      container.HostConfig?.NetworkMode !== 'none' || container.HostConfig.Privileged !== false || container.HostConfig.Binds?.length ||
      !Array.isArray(container.Mounts) || container.Mounts.some(m => m.Type !== 'tmpfs' || m.Destination !== '/tmp')) throw new Error('COMPACT_COHORT_PROBE_REFUSED')
  assertCompactFixtureOwnership('container', container, t)
}
