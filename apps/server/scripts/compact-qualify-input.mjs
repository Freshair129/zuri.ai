// @spec ADR-115 — verify CI input before image load; no Docker or target mutation.
// @tested tests/node/compact-qualification.test.mjs, tests/node/compact-workflow.test.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CompactError } from './lib/compact/manifest.mjs'
import { readCompactCoreCiInput } from './lib/compact/qualify.mjs'
import { stableJson } from './lib/compact/files.mjs'

export async function runCompactQualifyInput(argv) {
  const args = Object.create(null)
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--package', '--expected-revision'].includes(argv[i]) || args[argv[i]] !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new CompactError('COMPACT_ARGUMENTS_INVALID')
    args[argv[i]] = argv[i + 1]
  }
  if (!args['--package'] || !args['--expected-revision']) throw new CompactError('COMPACT_ARGUMENTS_INVALID')
  return (await readCompactCoreCiInput({ packageDirectory: args['--package'], expectedRevision: args['--expected-revision'] })).images
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCompactQualifyInput(process.argv.slice(2)).then(images => process.stdout.write(stableJson(images)), error => { process.stderr.write((error instanceof CompactError ? error.code : 'COMPACT_CI_INPUT_FAILED') + '\n'); process.exitCode = 1 })
}
