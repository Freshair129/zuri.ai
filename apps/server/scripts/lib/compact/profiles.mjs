// @spec ADR-115 — fail-closed prerequisites, never AI qualification or runtime grants.
// @tested tests/node/compact-profile.test.mjs
import pins from '../../../deploy/ki17/pins.json' with { type: 'json' }
import path from 'node:path'
import { CompactError } from './manifest.mjs'
import { assertCompactJson, compactOwnerLabels, validateCompactTarget } from './target.mjs'

// GenesisBlock 5156f412, genesisrag17-worker/src/worker.mjs is the authority for
// these five offline model bytes. A new tuple/model requires explicit review.
export const COMPACT_KI17_MODEL = Object.freeze({
  repository: 'intfloat/multilingual-e5-small', revision: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
  files: Object.freeze({
    'onnx/model.onnx': Object.freeze({ size: 470268510, sha256: 'ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665' }),
    'tokenizer.json': Object.freeze({ size: 17082730, sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39' }),
    'tokenizer_config.json': Object.freeze({ size: 443, sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b' }),
    'special_tokens_map.json': Object.freeze({ size: 167, sha256: 'd05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7' }),
    'config.json': Object.freeze({ size: 655, sha256: '69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959' }),
  }),
})
export function assertCompactKnowledgeProfile(manifest, packagedPins) {
  if (!manifest.profiles.includes('knowledge')) return
  const invalid = () => { throw new CompactError('COMPACT_KNOWLEDGE_PROFILE_INVALID') }
  if (pins.profile !== 'stdio' || ['msp', 'gks', 'genesisblock'].some(k => manifest.componentPins[k] !== pins.repositories[k].commit) || manifest.modelArtifacts.length !== 1) invalid()
  if (packagedPins !== undefined && (packagedPins?.profile !== 'stdio' || ['msp', 'gks', 'genesisblock'].some(k => packagedPins.repositories?.[k]?.commit !== pins.repositories[k].commit) || ['node', 'nodePlatform', 'python', 'modelRepository', 'modelRevision', 'workerPort'].some(k => packagedPins.runtime?.[k] !== pins.runtime[k]))) invalid()
  const model = manifest.modelArtifacts[0], expected = COMPACT_KI17_MODEL
  if (pins.runtime.modelRepository !== expected.repository || pins.runtime.modelRevision !== expected.revision || model.repository !== expected.repository || model.revision !== expected.revision || Object.keys(model.files).length !== Object.keys(expected.files).length) invalid()
  for (const [file, descriptor] of Object.entries(expected.files)) {
    const name = `models/${model.id}/${file}`
    if (model.files[name] !== descriptor.sha256 || manifest.files[name] !== descriptor.sha256) invalid()
  }
}
export function compactEnvelopeConfigured(configuration) {
  return configuration.ZURI_SECRET_STORE === 'envelope' && typeof configuration.ZURI_SECRET_KEK === 'string' && /^[a-f0-9]{64}$/i.test(configuration.ZURI_SECRET_KEK) && /^[1-9]\d{0,5}$/.test(String(configuration.ZURI_SECRET_KEK_VERSION ?? '1'))
}
export function inspectCompactProfilePrerequisites({ manifest, databaseInstalled, configuration = {} }) {
  assertCompactJson(manifest); assertCompactJson(configuration)
  const envelope = compactEnvelopeConfigured(configuration)
  const assess = (name, checks, remainingGates) => !manifest.profiles.includes(name) ? { status: 'NOT_SELECTED' } : {
    status: 'NOT_QUALIFIED', prerequisites: checks.some(([, valid]) => !valid) ? 'UNAVAILABLE' : 'CONFIGURATION_PRESENT',
    missing: checks.filter(([, valid]) => !valid).map(([code]) => code), remainingGates,
  }
  let pinnedModel = false
  try { assertCompactKnowledgeProfile(manifest); pinnedModel = manifest.profiles.includes('knowledge') } catch { /* Report a fixed prerequisite, never raw config. */ }
  return {
    binding: structuredClone({ sourceRevision: manifest.sourceRevision, images: manifest.images, componentPins: manifest.componentPins, models: manifest.modelArtifacts }),
    line: assess('line', [['DATABASE_INSTALLATION', databaseInstalled === true], ['ENVELOPE_KEY', envelope], ['LINE_WORKER_TOKEN', typeof configuration.ZURI_LINE_WORKER_TOKEN === 'string' && configuration.ZURI_LINE_WORKER_TOKEN.length >= 32]], ['BOOTSTRAP_AND_CURRENT_AUTHORITY', 'WORKER_COHORT', 'RESTART_REPLAY', 'LIVE_LINE_UAT']),
    knowledge: assess('knowledge', [['DATABASE_INSTALLATION', databaseInstalled === true], ['ENVELOPE_KEY', envelope], ['KNOWLEDGE_ENABLED', configuration.ZURI_KNOWLEDGE_ENABLED === '1'], ['KNOWLEDGE_STORAGE_ENABLED', configuration.ZURI_KNOWLEDGE_STORAGE_ENABLED === '1'], ['PINNED_MODEL_CONTRACT', pinnedModel]], ['MODEL_BYTES_AND_IMAGE_CONTENTS', 'BOOTSTRAP_AND_CURRENT_AUTHORITY', 'WORKER_COHORT', 'EXACT_IMAGE_KI17', 'OBJECT_AND_DATABASE_RESTORE', 'SOURCE_WITHDRAWAL_AND_SERVING_AUTHORIZATION', 'NATIVE_STAGE9_RECOVERY']),
  }
}
export function inspectCompactCohort({ manifest, target, containers = [], volumes = [], modelDirectory }) {
  const t = validateCompactTarget(target), missing = new Set(), labels = compactOwnerLabels(t)
  const owned = resource => resource && Object.entries(labels).every(([k, v]) => resource.labels?.[k] === v)
  const service = (name, image) => {
    const matches = containers.filter(c => c.service === name)
    if (matches.length !== 1) { missing.add('WORKER_COHORT_UNAVAILABLE'); return null }
    const c = matches[0]
    if (!owned(c)) missing.add('COHORT_OWNER_MISMATCH')
    if (!c.running || !c.safeConfiguration || c.reference !== image) missing.add('WORKER_COHORT_UNAVAILABLE')
    return c
  }
  const web = service('web', manifest.images.web)
  if (web && web.network !== t.network) missing.add('WORKER_COHORT_UNAVAILABLE')
  if (manifest.profiles.includes('line')) {
    const line = service('line-worker', manifest.images.lineWorker)
    if (line && line.network !== t.network) missing.add('WORKER_COHORT_UNAVAILABLE')
  }
  if (manifest.profiles.includes('knowledge')) {
    const worker = service('genesis-worker', manifest.images.genesisWorker)
    if (worker && (!web || worker.networkMode !== `container:${web.id}`)) missing.add('STALE_WORKER_NAMESPACE')
    const mounted = (container, name, destination) => container?.mounts?.some(v => v.type === 'volume' && v.name === `${t.project}-${name}` && v.destination === destination && v.readOnly === false)
    for (const name of ['genesis', 'knowledge-state']) {
      const matches = volumes.filter(v => v.name === `${t.project}-${name}`)
      if (matches.length !== 1 || !owned(matches[0]) || matches[0].driver !== 'local') missing.add('KNOWLEDGE_STATE_UNAVAILABLE')
    }
    if (!mounted(web, 'knowledge-state', '/var/lib/zuri-ki17/state') || !mounted(worker, 'knowledge-state', '/var/lib/zuri-ki17/state') || !mounted(worker, 'genesis', '/var/lib/zuri-ki17/genesis')) missing.add('KNOWLEDGE_STATE_MOUNT_UNAVAILABLE')
    const sameModelRoot = source => {
      if (typeof source !== 'string' || typeof modelDirectory !== 'string') return false
      if (!/^[a-z]:[\\/]/i.test(modelDirectory)) return source === modelDirectory
      // Docker Desktop's Linux daemon reports its translated drive bind path.
      const translated = /^\/(?:run\/desktop\/mnt\/host|host_mnt)\/([a-z])\/(.*)$/i.exec(source)
      const actual = translated ? `${translated[1]}:/${translated[2]}` : source
      return path.win32.normalize(actual).toLowerCase() === path.win32.normalize(modelDirectory).toLowerCase()
    }
    if (!modelDirectory || !worker?.mounts?.some(v => v.type === 'bind' && sameModelRoot(v.source) && v.destination === '/opt/ki17/model' && v.readOnly === true)) missing.add('PINNED_MODEL_MOUNT_UNAVAILABLE')
  }
  return { status: missing.size ? 'UNAVAILABLE' : 'COHORT_PRESENT_NOT_QUALIFIED', missing: [...missing].sort() }
}
