// @spec ADR-115 — exact core artifact inspection; no qualification/release authority.
// @tested tests/node/compact-qualification.test.mjs, tests/e2e/compact-core.spec.js
import { CompactError } from './manifest.mjs'
import path from 'node:path'
import { constants } from 'node:fs'
import { copyFile, mkdir, lstat, realpath } from 'node:fs/promises'
import { inspectCompactInstall, loadCompactPackage } from './executor.mjs'
import { planCompactInstall, exactKeys } from './target.mjs'
import { bytes, json, digest, stableJson, listFiles, destination as compactDestination } from './files.mjs'

export async function readCompactCoreCiInput({ packageDirectory, expectedRevision }) {
  const loaded = await loadCompactPackage(packageDirectory)
  if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{40}$/.test(expectedRevision) || loaded.manifest.sourceRevision !== expectedRevision) throw new CompactError('COMPACT_SOURCE_REVISION_MISMATCH')
  if (loaded.manifest.profiles.length !== 1 || loaded.manifest.profiles[0] !== 'core') throw new CompactError('COMPACT_PROFILE_QUALIFICATION_REQUIRED')
  if ((await json(loaded.root, 'transport.json')).kind !== 'oci') throw new CompactError('COMPACT_CI_OCI_REQUIRED')
  return { status: 'ARTIFACT_VERIFIED_NOT_QUALIFIED', images: loaded.manifest.images, manifestSha256: digest(stableJson(loaded.manifest)), packageInventorySha256: digest(await bytes(loaded.root, 'SHA256SUMS', 32 * 1024 * 1024)) }
}

export async function inspectCompactQualificationCandidate({ packageDirectory, target, driver }) {
  try {
    const { loaded, target: selected, observed } = await inspectCompactInstall({ packageDirectory, target, driver })
    if (loaded.manifest.profiles.length !== 1 || loaded.manifest.profiles[0] !== 'core') throw new CompactError('COMPACT_PROFILE_QUALIFICATION_REQUIRED')
    const images = await driver.inspectCandidateImages({ manifest: loaded.manifest, target: selected })
    if (!exactKeys(images, ['web', 'tools']) || ['web', 'tools'].some(k => !exactKeys(images[k], ['reference', 'id', 'platform', 'sourceRevision']) || images[k].reference !== loaded.manifest.images[k] || images[k].id !== observed.images[k]?.id || images[k].platform !== loaded.manifest.platform || images[k].sourceRevision !== loaded.manifest.sourceRevision)) throw new CompactError('COMPACT_IMAGE_SOURCE_MISMATCH')
    const plan = planCompactInstall({ manifest: loaded.manifest, target: selected, observed })
    return { status: 'ARTIFACT_INSPECTED_NOT_QUALIFIED', sourceRevision: loaded.manifest.sourceRevision, targetId: selected.targetId, project: selected.project,
      manifestSha256: digest(stableJson(loaded.manifest)), packageInventorySha256: digest(await bytes(loaded.root, 'SHA256SUMS', 32 * 1024 * 1024)), hostCliSha256: loaded.manifest.files['compact-self-host.mjs'], baselineSha256: loaded.manifest.schemaBaseline.sha256,
      installation: plan.action === 'INSPECT_INSTALLED' ? 'INSTALLED' : 'NOT_INSTALLED', images }
  } catch (error) {
    if (error instanceof CompactError) throw error
    throw new CompactError('COMPACT_CANDIDATE_INSPECTION_FAILED')
  }
}

export async function retainCompactQualificationPackage({ packageDirectory, destination }) {
  try {
    const loaded = await loadCompactPackage(packageDirectory)
    if (typeof destination !== 'string' || !path.isAbsolute(destination)) throw new CompactError('COMPACT_RETENTION_DESTINATION_INVALID')
    const out = path.resolve(destination), parent = path.dirname(out), info = await lstat(parent)
    if (!info.isDirectory() || info.isSymbolicLink() || path.relative(await realpath(parent), parent) !== '') throw new CompactError('COMPACT_RETENTION_DESTINATION_INVALID')
    const relative = path.relative(loaded.root, out)
    if (!relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new CompactError('COMPACT_RETENTION_DESTINATION_INVALID')
    await mkdir(out) // Exclusive directory reservation, never merge into existing output.
    for (const file of await listFiles(loaded.root)) await copyFile(path.join(loaded.root, file), await compactDestination(out, file), constants.COPYFILE_EXCL)
    const copy = await loadCompactPackage(out)
    if (stableJson(copy.manifest) !== stableJson(loaded.manifest)) throw new CompactError('COMPACT_PAYLOAD_HASH_MISMATCH')
    const packageInventorySha256 = digest(await bytes(copy.root, 'SHA256SUMS', 32 * 1024 * 1024))
    if (packageInventorySha256 !== digest(await bytes(loaded.root, 'SHA256SUMS', 32 * 1024 * 1024))) throw new CompactError('COMPACT_PAYLOAD_HASH_MISMATCH')
    return { status: 'ARTIFACT_COPIED_NOT_QUALIFIED', manifestSha256: digest(stableJson(copy.manifest)), packageInventorySha256 }
  } catch (error) {
    if (error instanceof CompactError) throw error
    throw new CompactError('COMPACT_RETENTION_DESTINATION_INVALID')
  }
}
