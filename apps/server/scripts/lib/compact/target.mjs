// @spec ADR-115 — TEST-only local fresh targets; pure decisions grant no production authority.
// @tested tests/node/compact-target.test.mjs, tests/node/compact-executor.test.mjs
import path from 'node:path'
import { CompactError, validateCompactManifest } from './manifest.mjs'
import { digest, stableJson } from './files.mjs'

const fail = (code = 'COMPACT_TARGET_INVALID') => { throw new CompactError(code) }
export function assertCompactJson(value, depth = 0, seen = new Set()) {
  if (depth > 32) fail()
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object' || seen.has(value) || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(value))) fail()
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !('value' in d) || (!d.enumerable && !(Array.isArray(value) && key === 'length'))) fail()
    assertCompactJson(d.value, depth + 1, seen)
  }
  seen.delete(value)
}
export const exactKeys = (v, keys) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
export function immutable(value) { if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value) }; return value }
export function compactOwnerLabels(t) { return { 'com.zuri-ai.compact.target': t.targetId, 'com.zuri-ai.compact.project': t.project, 'com.zuri-ai.compact.environment': t.environment } }
const id = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const privatePath = v => typeof v === 'string' && v.length <= 2048 && !/[\x00\r\n]/.test(v) && (path.posix.isAbsolute(v) || path.win32.isAbsolute(v))
export function compactIpv4Range(value) {
  if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(value)) return null
  const [ip, prefixText] = value.split('/'), parts = ip.split('.').map(Number), prefix = Number(prefixText)
  if (parts.some(v => v > 255) || prefix > 32 || prefix < 0) return null
  const number = parts.reduce((n, v) => n * 256 + v, 0), size = 2 ** (32 - prefix)
  if (number % size !== 0) return null
  return { first: number, last: number + size - 1, prefix }
}
export function validateCompactTarget(value) {
  assertCompactJson(value)
  const t = value
  if (!t || ['schemaVersion', 'environment', 'targetId', 'project', 'dockerContext', 'network', 'networkSubnet'].some(k => typeof t[k] !== 'string')) fail()
  if (!exactKeys(t, ['schemaVersion', 'environment', 'targetId', 'project', 'dockerContext', 'network', 'networkSubnet', 'database', 'volumes', 'secretFiles']) || t.schemaVersion !== 'compact-target.v1' || t.environment !== 'TEST' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(t.targetId) || !/^zuri-compact-[a-z0-9][a-z0-9-]{1,32}$/.test(t.project) || /(?:^|-)(?:prod|production|uat|main|dev)(?:-|$)/.test(t.project) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(t.dockerContext) || t.network !== `${t.project}-private`) fail()
  const subnet = compactIpv4Range(t.networkSubnet), octets = typeof t.networkSubnet === 'string' ? t.networkSubnet.split('.').map(Number) : []
  if (!subnet || subnet.prefix < 24 || subnet.prefix > 28 || !(octets[0] === 10 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168)) fail()
  if (!exactKeys(t.database, ['container', 'host', 'port', 'name', 'bootstrapRole', 'runtimeRole']) || ['container', 'host', 'name', 'bootstrapRole', 'runtimeRole'].some(k => typeof t.database[k] !== 'string') || t.database.container !== `${t.project}-db` || t.database.host !== '127.0.0.1' || !Number.isInteger(t.database.port) || t.database.port < 1024 || t.database.port > 65535 || !/^compact_[a-z0-9_]{1,40}$/.test(t.database.name) || t.database.bootstrapRole !== 'compact_bootstrap' || t.database.runtimeRole !== 'zuri_web_login') fail()
  if (!exactKeys(t.volumes, ['database', 'objects']) || Object.entries(t.volumes).some(([key, name]) => name !== `${t.project}-${key}`)) fail()
  if (!exactKeys(t.secretFiles, ['bootstrapEnvironment', 'runtimeEnvironment']) || Object.values(t.secretFiles).some(p => !privatePath(p)) || t.secretFiles.bootstrapEnvironment.toLowerCase() === t.secretFiles.runtimeEnvironment.toLowerCase()) fail()
  return immutable(structuredClone(t))
}
function owned(resource, t) {
  return resource?.labels && typeof resource.labels === 'object' && Object.entries(compactOwnerLabels(t)).every(([k, v]) => resource.labels[k] === v)
}
export function assertCompactResources(t, m, o) {
  assertCompactJson(o)
  if (!exactKeys(o, ['daemon', 'images', 'volumes', 'network', 'container', 'database']) || !exactKeys(o.daemon, ['id', 'context', 'endpoint']) || typeof o.daemon.id !== 'string' || !o.daemon.id || o.daemon.context !== t.dockerContext || typeof o.daemon.endpoint !== 'string' || !/^(?:npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+|unix:\/\/\/[^\x00\r\n?#]+)$/.test(o.daemon.endpoint)) fail('COMPACT_OBSERVATION_INVALID')
  if (!exactKeys(o.images, Object.keys(m.images)) || Object.entries(m.images).some(([key, reference]) => !exactKeys(o.images[key], ['reference', 'id', 'platform']) || o.images[key].reference !== reference || !/^sha256:[a-f0-9]{64}$/.test(o.images[key].id) || o.images[key].platform !== m.platform)) fail('COMPACT_IMAGES_UNAVAILABLE')
  if (!exactKeys(o.volumes, Object.keys(t.volumes))) fail('COMPACT_OBSERVATION_INVALID')
  for (const [key, v] of Object.entries(o.volumes)) if (v !== null && (!exactKeys(v, ['name', 'driver', 'labels', 'created']) || v.name !== t.volumes[key] || v.driver !== 'local' || !owned(v, t) || typeof v.created !== 'string')) fail('COMPACT_FOREIGN_RESOURCE')
  if (o.network !== null && (!exactKeys(o.network, ['id', 'name', 'driver', 'labels', 'subnet']) || !id(o.network.id) || o.network.name !== t.network || o.network.driver !== 'bridge' || o.network.subnet !== t.networkSubnet || !owned(o.network, t))) fail('COMPACT_FOREIGN_RESOURCE')
  const c = o.container
  if (c !== null && (!exactKeys(c, ['id', 'name', 'reference', 'imageId', 'running', 'labels', 'mounts', 'network', 'host', 'port', 'created', 'safeConfiguration']) || c.safeConfiguration !== true || !id(c.id) || c.name !== t.database.container || c.reference !== m.images.postgres || c.imageId !== o.images.postgres.id || typeof c.running !== 'boolean' || typeof c.created !== 'string' || !owned(c, t) || c.network !== t.network || c.host !== t.database.host || c.port !== t.database.port || !Array.isArray(c.mounts) || c.mounts.length !== 1 || !exactKeys(c.mounts[0], ['type', 'name', 'destination']) || c.mounts[0].type !== 'volume' || c.mounts[0].name !== t.volumes.database || c.mounts[0].destination !== '/var/lib/postgresql/data')) fail('COMPACT_FOREIGN_RESOURCE')
}
export function planCompactInstall({ manifest, target, observed } = {}) {
  const m = validateCompactManifest(manifest), t = validateCompactTarget(target), o = observed
  assertCompactResources(t, m, o)
  let action
  if (!o.container) {
    if (Object.values(o.volumes).some(Boolean) || o.network || o.database) fail('COMPACT_UNPROVEN_EXISTING_TARGET')
    action = 'CREATE_AND_INITIALIZE'
  } else {
    if (!o.container.running || !o.network || Object.values(o.volumes).some(v => !v)) fail('COMPACT_TARGET_UNAVAILABLE')
    const db = o.database
    if (!exactKeys(db, ['systemIdentifier', 'oid', 'name', 'user', 'objectCount', 'runtimeRoles', 'installation', 'catalogSha256']) || !/^[0-9]{10,24}$/.test(db.systemIdentifier) || !Number.isInteger(db.oid) || db.oid < 1 || db.name !== t.database.name || db.user !== t.database.bootstrapRole || !Number.isSafeInteger(db.objectCount) || db.objectCount < 0 || !Array.isArray(db.runtimeRoles) || !id(db.catalogSha256)) fail('COMPACT_DATABASE_UNVERIFIED')
    if (db.installation === null) {
      if (db.objectCount !== 0 || db.runtimeRoles.length) fail('COMPACT_DATABASE_NOT_EMPTY')
      action = 'INITIALIZE'
    } else {
      const state = db.installation
      if (!exactKeys(state, ['targetId', 'manifestSha256', 'baselineSha256', 'releaseId', 'sourceRevision', 'systemIdentifier', 'databaseOid', 'catalogSha256']) || state.targetId !== t.targetId || state.manifestSha256 !== digest(stableJson(m)) || state.baselineSha256 !== m.schemaBaseline.sha256 || state.sourceRevision !== m.sourceRevision || state.releaseId !== m.releaseId || state.systemIdentifier !== db.systemIdentifier || state.databaseOid !== db.oid || !id(state.catalogSha256)) fail('COMPACT_FOREIGN_INSTALLATION')
      if (state.catalogSha256 !== db.catalogSha256) fail('COMPACT_SCHEMA_DRIFT')
      const roles = db.runtimeRoles
      if (roles.length !== 2 || roles.some(r => !exactKeys(r, ['name', 'login', 'inherit', 'inheritsRuntime', 'privilegedMembership', 'superuser', 'bypass', 'createDb', 'createRole', 'replication', 'owner']) || !['zuri_app_runtime', t.database.runtimeRole].includes(r.name) || [r.login, r.inherit, r.inheritsRuntime].some(v => v !== (r.name === t.database.runtimeRole)) || [r.superuser, r.bypass, r.createDb, r.createRole, r.replication, r.owner, r.privilegedMembership].some(v => v !== false)) || new Set(roles.map(r => r.name)).size !== 2) fail('COMPACT_RUNTIME_ROLE_INVALID')
      action = 'INSPECT_INSTALLED'
    }
  }
  return immutable({ schemaVersion: 'compact-install-plan.v1', environment: t.environment, targetId: t.targetId, project: t.project, action, releaseId: m.releaseId, network: { name: t.network, subnet: t.networkSubnet }, database: { host: t.database.host, port: t.database.port, name: t.database.name }, volumes: { ...t.volumes }, images: { ...m.images }, privateFileReferences: Object.keys(t.secretFiles), manifestSha256: digest(stableJson(m)), baselineSha256: m.schemaBaseline.sha256, targetSha256: digest(stableJson(t)), observationSha256: digest(stableJson(o)) })
}
