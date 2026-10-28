// @spec ADR-115 — finalize only run-created TEST probe resources, even after a refusal.
// @tested tests/node/compact-profile.test.mjs, tests/integration/compact-profile-recovery.test.js
import { lstat, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { completeCompactFixtureCleanup } from './compact-postgres-target.mjs'

async function removeInertModelDirectory(root) {
  const physical = await realpath(root), temporary = await realpath(os.tmpdir())
  if ((await lstat(root)).isSymbolicLink() || path.dirname(physical) !== temporary ||
      !path.basename(physical).startsWith('compact inert model ') || path.relative(physical, path.resolve(root)) !== '') {
    throw new Error('COMPACT_PROFILE_PROBE_TEMP_REFUSED')
  }
  await rm(physical, { recursive: true })
}

export async function cleanupCompactProfileFixture({ resources, modelDirectory, removeContainer, removeResource }) {
  const actions = [...resources.containers].reverse().map(id => async () => { await removeContainer(id); resources.containers.delete(id) })
  for (const [kind, ids] of [['volume', resources.volumes], ['network', resources.networks]]) {
    for (const id of ids) actions.push(async () => { await removeResource(kind, id); ids.delete(id) })
  }
  if (modelDirectory) actions.push(() => removeInertModelDirectory(modelDirectory))
  // Callbacks retain their inspect-before-delete ownership checks. A refusal
  // cannot authorize deletion, nor prevent attempts for independent owned items.
  await completeCompactFixtureCleanup(actions)
}
