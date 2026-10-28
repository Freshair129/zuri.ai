// @spec ADR-115 — actual owned Docker namespace/state probe, not AI or LINE acceptance.
import { beforeAll, afterAll, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { targetFixture } from '../node/compact-task2-fixtures.mjs'
import { manifest } from '../node/compact-fixtures.mjs'
import { createCompactDockerDriver, runCompactDocker } from '../../scripts/lib/compact/docker.mjs'
import { compactOwnerLabels, compactIpv4Range } from '../../scripts/lib/compact/target.mjs'
import { inspectCompactCohort } from '../../scripts/lib/compact/profiles.mjs'
import { cleanupCompactProfileFixture } from '../helpers/compact-profile-target.mjs'

// A pinned cached Node tools image executes tiny inert processes only. No MSP,
// GKS, model, app server, credentials, live sender or existing runtime is used.
const image = 'zuri-compact-task3-tools-b04ee0ddee2c@sha256:a539acaad1c2c753a44a108396baeb1577144313eb9db89c2742ed93fc2c55fa'
const t = targetFixture(), runId = randomUUID(), m = manifest(), resources = { containers: new Set(), volumes: new Set(), networks: new Set() }
t.project = `zuri-compact-${runId.slice(0, 13)}`; t.targetId = runId; t.dockerContext = process.platform === 'win32' ? 'desktop-linux' : 'default'; t.network = `${t.project}-private`
t.database.container = `${t.project}-db`; t.volumes = { database: `${t.project}-database`, objects: `${t.project}-objects` }
m.profiles.push('knowledge', 'line'); m.capabilities.knowledge = m.capabilities.line = 'NOT_QUALIFIED'
m.images.web = m.images.genesisWorker = m.images.lineWorker = image
m.componentPins = { msp: 'a'.repeat(40), gks: 'b'.repeat(40), genesisblock: 'c'.repeat(40) }
m.modelArtifacts = [{ id: 'inert-fixture', repository: 'test/inert', revision: 'd'.repeat(40), files: { 'models/inert-fixture/inert.txt': 'e'.repeat(64) } }]
m.files['pins/ki17.json'] = m.files['models/inert-fixture/inert.txt'] = 'e'.repeat(64)
const labels = compactOwnerLabels(t), labelArgs = Object.entries(labels).flatMap(([k, v]) => ['--label', `${k}=${v}`]), driver = createCompactDockerDriver()
let modelDirectory, web, worker, initialState
async function docker(args) {
  const result = await runCompactDocker(['--context', t.dockerContext, ...args], { timeoutMs: 60000 })
  if (result.status !== 0) throw new Error('COMPACT_PROFILE_PROBE_DOCKER_FAILED')
  return result.stdout.trim()
}
async function owned(kind, id) {
  const raw = JSON.parse(await docker([kind, 'inspect', id]))[0], actual = kind === 'container' ? raw.Config.Labels : raw.Labels
  if (!Object.entries(labels).every(([k, v]) => actual?.[k] === v)) throw new Error('COMPACT_PROFILE_PROBE_FOREIGN_RESOURCE')
  return raw
}
async function create(service, network, mounts = [], command = 'setInterval(()=>{},1000)') {
  const id = await docker(['container', 'create', '--pull', 'never', '--name', `${t.project}-${service}`, ...labelArgs, '--label', `com.docker.compose.project=${t.project}`, '--label', `com.docker.compose.service=${service}`, '--network', network, '--log-driver', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', 'node', ...mounts.flatMap(v => ['--mount', v]), image, '-e', command])
  resources.containers.add(id); await owned('container', id); await docker(['container', 'start', id]); return id
}
const stateMount = () => `type=volume,source=${t.project}-knowledge-state,target=/var/lib/zuri-ki17/state`
const genesisMounts = () => [stateMount(), `type=volume,source=${t.project}-genesis,target=/var/lib/zuri-ki17/genesis`, `type=bind,source=${modelDirectory},target=/opt/ki17/model,readonly`]
const inspect = async () => inspectCompactCohort({ manifest: m, target: t, ...await driver.inspectCohort({ manifest: m, target: t, modelDirectory }) })
async function removeContainer(id) { await owned('container', id); await docker(['container', 'rm', '--force', id]); resources.containers.delete(id) }
beforeAll(async () => {
  modelDirectory = await mkdtemp(path.join(os.tmpdir(), 'compact inert model ')); await writeFile(path.join(modelDirectory, 'inert.txt'), 'INERT FIXTURE, NOT A MODEL')
  const ids = (await docker(['network', 'ls', '--quiet'])).split(/\r?\n/).filter(Boolean)
  const ranges = (await docker(['network', 'inspect', '--format', '{{json .IPAM.Config}}', ...ids])).split(/\r?\n/).flatMap(row => JSON.parse(row) || []).map(item => compactIpv4Range(item.Subnet)).filter(Boolean)
  for (const item of Object.values(os.networkInterfaces()).flat()) if (item?.family === 'IPv4' && item.cidr) {
    const [address, prefix] = item.cidr.split('/'), host = address.split('.').reduce((n, v) => n * 256 + Number(v), 0), size = 2 ** (32 - Number(prefix)), first = Math.floor(host / size) * size
    ranges.push({ first, last: first + size - 1 })
  }
  t.networkSubnet = ''
  for (let i = 64; i < 255; i++) { const cidr = `10.252.${i}.0/28`, range = compactIpv4Range(cidr); if (!ranges.some(r => range.first <= r.last && range.last >= r.first)) { t.networkSubnet = cidr; break } }
  if (!t.networkSubnet) throw new Error('COMPACT_PROFILE_PROBE_SUBNET_UNAVAILABLE')
  const network = await docker(['network', 'create', '--driver', 'bridge', '--subnet', t.networkSubnet, ...labelArgs, t.network]); resources.networks.add(network); await owned('network', network)
  for (const name of ['genesis', 'knowledge-state']) { const id = await docker(['volume', 'create', ...labelArgs, `${t.project}-${name}`]); resources.volumes.add(id); await owned('volume', id) }
  web = await create('web', t.network, [stateMount()])
  worker = await create('genesis-worker', `container:${web}`, genesisMounts(), 'require("node:fs").writeFileSync("/var/lib/zuri-ki17/genesis/probe","NATIVE_FIXTURE");setInterval(()=>{},1000)')
  await create('line-worker', t.network)
  initialState = await docker(['container', 'exec', worker, 'node', '-e', 'process.stdout.write(require("node:fs").readFileSync("/var/lib/zuri-ki17/genesis/probe","utf8"))'])
}, 120000)
afterAll(async () => {
  await cleanupCompactProfileFixture({ resources, modelDirectory, removeContainer,
    removeResource: async (kind, id) => { await owned(kind, id); await docker([kind, 'rm', id]) },
  })
})
it('observes an owned inert cohort with immutable model mount without qualifying AI', async () => {
  expect(await inspect()).toEqual({ status: 'COHORT_PRESENT_NOT_QUALIFIED', missing: [] })
})
it('detects stale network namespace and rebinds only the owned disposable worker, preserving native state', async () => {
  const previous = web
  await removeContainer(web); web = await create('web', t.network, [stateMount()])
  expect(web).not.toBe(previous)
  expect((await inspect()).missing).toContain('STALE_WORKER_NAMESPACE')
  await removeContainer(worker); worker = await create('genesis-worker', `container:${web}`, genesisMounts())
  expect(await inspect()).toEqual({ status: 'COHORT_PRESENT_NOT_QUALIFIED', missing: [] })
  expect(await docker(['container', 'exec', worker, 'node', '-e', 'process.stdout.write(require("node:fs").readFileSync("/var/lib/zuri-ki17/genesis/probe","utf8"))'])).toBe(initialState)
})
it('reports native-state loss after removing only a run-created synthetic volume', async () => {
  await removeContainer(worker)
  const name = `${t.project}-genesis`; await owned('volume', name); await docker(['volume', 'rm', name]); resources.volumes.delete(name)
  const result = await inspect()
  expect(result.status).toBe('UNAVAILABLE'); expect(result.missing).toContain('KNOWLEDGE_STATE_UNAVAILABLE')
})
