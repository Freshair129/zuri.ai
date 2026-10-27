// @spec ADR-115 — exact cached TEST provider, owned network/volume/containers and ephemeral scoped users.
// @tested tests/storage/compact-business-objects.test.js
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import os from 'node:os'
import { compactIpv4Range } from '../../scripts/lib/compact/target.mjs'
import { runCompactDocker } from '../../scripts/lib/compact/docker.mjs'
import { completeCompactFixtureCleanup, compactFixtureDockerContext, assertCompactFixtureLocalEndpoint } from './compact-postgres-target.mjs'

export const BUSINESS_STORAGE_TEST_IMAGE = 'sha256:ca499c729f62921367079f685d29e03e262b2d1be31e0af9fa6f6b564dc8850f'
export function businessStorageObservation({ evidence = {}, completedCases = new Set(), cleanup = 'FAIL' }) {
  const sources = { uploadRead: 'upload', authorizedFileAsset: 'upload', foreignRefRefused: 'upload', distinctCatalog: 'catalog', credentialIsolation: 'catalog', noOverwrite: 'catalog', exactErase: 'catalog', extractionRead: 'extraction', failedMetadataCleanup: 'metadataFailure', versionPinnedAfterReplacement: 'versions', exactErasePreservesOtherVersion: 'versions', metadataOnlyRestoreRefused: 'objectLoss', immutableVersionRequired: 'unversionedRefusal' }
  const checks = Object.fromEntries(Object.entries(sources).map(([check, source]) => [check, completedCases.has(source)]))
  return { ...evidence, status: Object.values(checks).every(Boolean) && cleanup === 'PASS' ? 'PASS' : 'FAIL', cleanup, checks,
    limitations: ['Injected TEST extractor; no live model qualification', 'No production provider/license or complete restore qualification'] }
}
export async function startCompactBusinessStorage({ image = BUSINESS_STORAGE_TEST_IMAGE, command = ['server', '/data', '--address', ':9000', '--quiet'] } = {}) {
  assert(typeof image === 'string' && /^(?:[A-Za-z0-9._:/-]+@)?sha256:[a-f0-9]{64}$/.test(image), 'COMPACT_BUSINESS_STORAGE_PIN_REQUIRED')
  assert(Array.isArray(command) && command.length > 0 && command.length <= 32 && command.every(s => typeof s === 'string' && /^[A-Za-z0-9_./:=+@-]{1,256}$/.test(s) && !/password|secret|token|credential|access.?key|api.?key/i.test(s)), 'COMPACT_BUSINESS_STORAGE_COMMAND_INVALID')
  const runId = randomUUID(), name = `zuri-compact-storage-${runId.slice(0, 13)}`, network = `${name}-net`, volume = `${name}-data`
  const context = compactFixtureDockerContext()
  const run = async (args, options) => {
    const result = await runCompactDocker(['--context', context, ...args], options)
    if (result.status !== 0) throw new Error('COMPACT_BUSINESS_STORAGE_TOOL_FAILED')
    return result.stdout.trim()
  }
  const host = JSON.parse(await run(['context', 'inspect', context]))[0].Endpoints.docker.Host
  assertCompactFixtureLocalEndpoint(host)
  const selectedImage = JSON.parse(await run(['image', 'inspect', image]))[0]
  assert.equal(selectedImage.Os + '/' + selectedImage.Architecture, 'linux/amd64')
  assert(/^sha256:[a-f0-9]{64}$/.test(selectedImage.Id))
  if (image.includes('@')) assert(selectedImage.RepoDigests?.includes(image), 'COMPACT_BUSINESS_STORAGE_IMAGE_MISMATCH')
  else assert.equal(selectedImage.Id, image)
  const labels = ['--label', `com.zuri-ai.compact.target=${runId}`, '--label', `com.zuri-ai.compact.project=${name}`, '--label', 'com.zuri-ai.compact.environment=TEST']
  const allocated = [], ids = (await run(['network', 'ls', '-q'])).split(/\s+/).filter(Boolean)
  if (ids.length) for (const info of JSON.parse(await run(['network', 'inspect', ...ids]))) for (const entry of info.IPAM.Config || []) { const range = compactIpv4Range(entry.Subnet); if (range) allocated.push(range) }
  for (const item of Object.values(os.networkInterfaces()).flat()) {
    if (item?.family !== 'IPv4' || !item.cidr) continue
    const [address, prefix] = item.cidr.split('/'), size = 2 ** (32 - Number(prefix)), hostNumber = address.split('.').reduce((n, part) => n * 256 + Number(part), 0), first = Math.floor(hostNumber / size) * size
    allocated.push({ first, last: first + size - 1 })
  }
  let subnet
  for (let octet = 64; octet < 255; octet++) { const candidate = `10.252.${octet}.0/28`, range = compactIpv4Range(candidate); if (!allocated.some(other => range.first <= other.last && other.first <= range.last)) { subnet = candidate; break } }
  assert(subnet, 'COMPACT_BUSINESS_STORAGE_NO_SUBNET')
  let networkId, volumeCreated = false, containerId
  const owned = async (type, id) => {
    const info = JSON.parse(await run([type, 'inspect', id]))[0], identity = type === 'container' ? info.Config.Labels : info.Labels
    assert.equal(identity['com.zuri-ai.compact.target'], runId); assert.equal(identity['com.zuri-ai.compact.environment'], 'TEST')
    assert.equal(identity['com.zuri-ai.compact.project'], name)
    if (type === 'container') { assert.equal(info.Id, containerId); assert.equal(info.Name, '/' + name); assert.equal(info.Image, selectedImage.Id) }
    if (type === 'network') { assert.equal(info.Id, networkId); assert.equal(info.Name, network) }
    if (type === 'volume') assert.equal(info.Name, volume)
    return info
  }
  const close = async () => {
    await completeCompactFixtureCleanup([
      async () => { if (containerId) { await owned('container', containerId); await run(['container', 'rm', '--force', containerId]); containerId = null } },
      async () => { if (volumeCreated) { await owned('volume', volume); await run(['volume', 'rm', volume]); volumeCreated = false } },
      async () => { if (networkId) { await owned('network', networkId); await run(['network', 'rm', networkId]); networkId = null } },
    ])
  }
  const rootUser = randomBytes(16).toString('hex'), rootPassword = randomBytes(32).toString('hex')
  try {
    // Exact random names must be absent; never adopt or remove a foreign resource.
    for (const [type, resource] of [['container', name], ['volume', volume], ['network', network]]) {
      const result = await runCompactDocker(['--context', context, type, 'inspect', resource])
      assert(result.status !== 0 && /No such (?:container|object|volume|network)|network.+not found/i.test(result.stderr), 'COMPACT_BUSINESS_STORAGE_COLLISION')
    }
    networkId = await run(['network', 'create', '--subnet', subnet, ...labels, network])
    assert.equal(await run(['volume', 'create', ...labels, volume]), volume); volumeCreated = true
    containerId = await run(['container', 'create', '--pull', 'never', '--name', name, ...labels, '--network', network, '--log-driver', 'none', '--memory', '512m', '--cpus', '1', '--publish', '127.0.0.1::9000', '--mount', `type=volume,source=${volume},target=/data`, '--env', 'MINIO_ROOT_USER', '--env', 'MINIO_ROOT_PASSWORD', image, ...command], { environment: { MINIO_ROOT_USER: rootUser, MINIO_ROOT_PASSWORD: rootPassword } })
    await owned('container', containerId); await run(['container', 'start', containerId])
    const info = await owned('container', containerId), binding = info.NetworkSettings.Ports['9000/tcp'][0]
    assert.equal(binding.HostIp, '127.0.0.1'); const endpoint = `http://127.0.0.1:${binding.HostPort}`
    let ready = false
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`${endpoint}/minio/health/ready`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch {} await new Promise(resolve => setTimeout(resolve, 200)) }
    assert(ready, 'COMPACT_BUSINESS_STORAGE_NOT_READY')
    const env = { ZURI_ASSET_STORAGE_PROVIDER: 's3', ZURI_KNOWLEDGE_CATALOG_STORAGE_PROVIDER: 's3', ZURI_KNOWLEDGE_STORAGE_BUCKET: `${name}-knowledge` }
    const buckets = {}, principals = []
    for (const [purpose, prefix, bucketKey] of [['asset', 'ZURI_ASSET_STORAGE', 'ZURI_ASSET_EVIDENCE_BUCKET'], ['catalog', 'ZURI_KNOWLEDGE_CATALOG_STORAGE', 'ZURI_KNOWLEDGE_CATALOG_BUCKET']]) {
      const bucket = `${name}-${purpose}`, user = randomBytes(16).toString('hex'), password = randomBytes(32).toString('hex')
      buckets[purpose] = bucket
      const policy = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:PutObject', 's3:GetObject', 's3:GetObjectVersion', 's3:DeleteObject', 's3:DeleteObjectVersion'], Resource: [`arn:aws:s3:::${bucket}/${purpose === 'asset' ? 'asset-evidence' : 'business-catalog'}/*`] }] }
      const script = 'set -eu; umask 077; cat > /tmp/policy.json; mc mb fixture/"$TEST_BUCKET" >/dev/null; mc version enable fixture/"$TEST_BUCKET" >/dev/null; mc admin user add fixture "$TEST_USER" "$TEST_PASSWORD" >/dev/null; mc admin policy create fixture bounded-"$TEST_USER" /tmp/policy.json >/dev/null; mc admin policy attach fixture bounded-"$TEST_USER" --user "$TEST_USER" >/dev/null'
      await run(['run', '--rm', '--interactive', '--pull', 'never', '--name', `${name}-${purpose}-setup`, ...labels, '--network', `container:${containerId}`, '--log-driver', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--env', 'MC_HOST_fixture', '--env', 'MC_CONFIG_DIR=/tmp/mc', '--env', 'TEST_BUCKET', '--env', 'TEST_USER', '--env', 'TEST_PASSWORD', '--entrypoint', '/bin/sh', image, '-c', script], { input: JSON.stringify(policy), environment: { MC_HOST_fixture: `http://${rootUser}:${rootPassword}@127.0.0.1:9000`, TEST_BUCKET: bucket, TEST_USER: user, TEST_PASSWORD: password } })
      Object.assign(env, { [bucketKey]: bucket, [`${prefix}_ENDPOINT`]: endpoint, [`${prefix}_ACCESS_KEY`]: user, [`${prefix}_SECRET_KEY`]: password })
      principals.push({ purpose, actions: policy.Statement[0].Action, namespace: policy.Statement[0].Resource })
    }
    return { env, buckets, endpoint,
      async suspendVersioningForTest(purpose) {
        assert(['asset', 'catalog'].includes(purpose)); await owned('container', containerId)
        await run(['run', '--rm', '--pull', 'never', '--name', `${name}-suspend`, ...labels, '--network', `container:${containerId}`, '--log-driver', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--env', 'MC_HOST_fixture', '--env', 'MC_CONFIG_DIR=/tmp/mc', '--env', 'TEST_BUCKET', '--entrypoint', '/bin/sh', image, '-c', 'set -eu; mc version suspend fixture/"$TEST_BUCKET" >/dev/null'], { environment: { MC_HOST_fixture: `http://${rootUser}:${rootPassword}@127.0.0.1:9000`, TEST_BUCKET: buckets[purpose] } })
      },
      async replaceForVersionTest({ bucket, key, content }) {
        assert(Object.values(buckets).includes(bucket)); assert(/^(asset-evidence|business-catalog)\/[A-Za-z0-9_/-]+\.json$/.test(key))
        await owned('container', containerId)
        await run(['run', '--rm', '--interactive', '--pull', 'never', '--name', `${name}-replace`, ...labels, '--network', `container:${containerId}`, '--log-driver', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--env', 'MC_HOST_fixture', '--env', 'MC_CONFIG_DIR=/tmp/mc', '--env', 'TEST_BUCKET', '--env', 'TEST_KEY', '--entrypoint', '/bin/sh', image, '-c', 'set -eu; mc pipe fixture/"$TEST_BUCKET"/"$TEST_KEY" >/dev/null'], { input: content, environment: { MC_HOST_fixture: `http://${rootUser}:${rootPassword}@127.0.0.1:9000`, TEST_BUCKET: bucket, TEST_KEY: key } })
      },
      evidence: { environment: 'TEST', image: selectedImage.Id, reference: image, command: [...command], runId, containerId, volume, networkId, principals, license: 'Existing cached TEST fixture; no production provider/license approval' }, close }
  } catch (error) { try { await close() } catch { error.cleanupFailed = true }; throw error }
}
