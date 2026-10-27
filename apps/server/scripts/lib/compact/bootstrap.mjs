// @req FR-107 — private first-operator wrapping without a second authority.
// @spec ADR-115 — installed TEST targets only; configuration is not qualification.
// @tested tests/node/compact-bootstrap.test.mjs, tests/e2e/compact-core.spec.js
import path from 'node:path'
import { open, lstat, realpath } from 'node:fs/promises'
import { CompactError } from './manifest.mjs'
import { inspectCompactInstall, readCompactCredentials } from './executor.mjs'
import { planCompactInstall, exactKeys, assertCompactJson } from './target.mjs'
import { stableJson, digest } from './files.mjs'

const fail = code => { throw new CompactError(code) }
function operatorInput(value) {
  assertCompactJson(value)
  if (!exactKeys(value, ['email', 'displayName']) || typeof value.email !== 'string' || !/^[^\s@]{1,128}@[^\s@]{1,128}$/.test(value.email) || typeof value.displayName !== 'string' || !value.displayName.trim() || value.displayName.length > 128 || /[\x00-\x1f]/.test(value.displayName)) fail('COMPACT_OPERATOR_INVALID')
  return { email: value.email, displayName: value.displayName.trim() }
}
async function reservePrivateOutput(filename, packageRoot) {
  try {
    if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw 0
    const absolute = path.resolve(filename), root = path.parse(absolute).root
    let cursor = root
    for (const part of path.relative(root, path.dirname(absolute)).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part)
      const info = await lstat(cursor)
      if (!info.isDirectory() || info.isSymbolicLink()) throw 0
    }
    const parent = await realpath(path.dirname(absolute)), relative = path.relative(packageRoot, path.join(parent, path.basename(absolute)))
    if (!relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw 0
    // Exclusive creation also refuses existing credentials, links and previous output.
    return await open(absolute, 'wx', 0o600)
  } catch { fail('COMPACT_PRIVATE_OUTPUT_INVALID') }
}
export async function bootstrapCompactOperator({ packageDirectory, target, privateOutput, operator, driver }) {
  let output
  try {
    const identity = operatorInput(operator)
    const { loaded, target: selected, observed } = await inspectCompactInstall({ packageDirectory, target, driver, verifyCredentials: true })
    const plan = planCompactInstall({ manifest: loaded.manifest, target: selected, observed })
    if (plan.action !== 'INSPECT_INSTALLED') fail('COMPACT_INSTALLATION_REQUIRED')
    output = await reservePrivateOutput(privateOutput, loaded.root)
    const credentials = await readCompactCredentials(selected, { packageDirectory: loaded.root })
    const current = await driver.inspect({ manifest: loaded.manifest, target: selected })
    if (digest(stableJson(current)) !== plan.observationSha256) fail('COMPACT_OBSERVATION_CHANGED')
    let result
    try { result = await driver.bootstrap({ manifest: loaded.manifest, target: selected, observed: current, credentials, operator: identity }) }
    catch (error) { fail(error?.code === 'COMPACT_BOOTSTRAP_REFUSED' ? error.code : 'COMPACT_BOOTSTRAP_FAILED') }
    if (!exactKeys(result, ['personId', 'personCode', 'displayName', 'grantId', 'initialPassword']) || ['personId', 'personCode', 'grantId'].some(k => typeof result[k] !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(result[k])) || typeof result.displayName !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(result.initialPassword)) fail('COMPACT_BOOTSTRAP_RESULT_INVALID')
    await output.writeFile(stableJson(result)); await output.sync()
    return { status: 'BOOTSTRAPPED', targetId: selected.targetId, personId: result.personId, grantId: result.grantId }
  } catch (error) {
    if (error instanceof CompactError) throw error
    fail('COMPACT_BOOTSTRAP_FAILED')
  } finally { await output?.close() }
}
export function inspectCompactCapabilities({ manifest, target, observed, configuration = {} }) {
  assertCompactJson(configuration)
  const plan = planCompactInstall({ manifest, target, observed })
  const envelope = configuration.ZURI_SECRET_STORE === 'envelope' && typeof configuration.ZURI_SECRET_KEK === 'string' && /^[a-f0-9]{64}$/i.test(configuration.ZURI_SECRET_KEK) && /^[1-9]\d{0,5}$/.test(String(configuration.ZURI_SECRET_KEK_VERSION ?? '1'))
  return Object.freeze({ status: 'INSPECTED', targetId: target.targetId,
    database: plan.action === 'INSPECT_INSTALLED' ? 'INSTALLED' : 'NOT_INSTALLED', core: 'NOT_QUALIFIED',
    secretStore: envelope ? 'CONFIGURED_NOT_QUALIFIED' : 'UNAVAILABLE', storage: 'UNAVAILABLE',
    line: manifest.profiles.includes('line') ? 'NOT_QUALIFIED' : 'NOT_SELECTED',
    knowledge: manifest.profiles.includes('knowledge') ? 'NOT_QUALIFIED' : 'NOT_SELECTED' })
}
