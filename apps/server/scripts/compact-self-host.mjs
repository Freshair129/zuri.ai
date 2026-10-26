#!/usr/bin/env node
// @spec ADR-115 — explicit TEST-only schema commands; no application/production activation.
// @tested tests/node/compact-executor.test.mjs, tests/postgres/compact-fresh-install.test.js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CompactError } from './lib/compact/manifest.mjs'
import { planCompactInstall, validateCompactTarget } from './lib/compact/target.mjs'
import { inspectCompactInstall, executeCompactInstall, readCompactPrivateFile } from './lib/compact/executor.mjs'
import { createCompactDockerDriver } from './lib/compact/docker.mjs'
export async function runCompactSelfHost(argv, { driver = createCompactDockerDriver() } = {}) {
  const [verb, ...rest] = argv, flags = new Set(['--package', '--target', '--plan']), args = Object.create(null)
  if (!['inspect', 'plan', 'install', 'status', 'stop'].includes(verb)) throw new CompactError('COMPACT_ARGUMENTS_INVALID')
  for (let i = 0; i < rest.length; i += 2) {
    if (!flags.has(rest[i]) || args[rest[i]] !== undefined || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new CompactError('COMPACT_ARGUMENTS_INVALID')
    args[rest[i]] = rest[i + 1]
  }
  if (!args['--package'] || !args['--target'] || args['--plan'] && verb !== 'install') throw new CompactError('COMPACT_ARGUMENTS_INVALID')
  let target, plan
  try {
    target = validateCompactTarget(JSON.parse(await readCompactPrivateFile(args['--target'])))
    if (args['--plan']) plan = JSON.parse(await readCompactPrivateFile(args['--plan']))
  } catch (e) { if (e instanceof CompactError) throw e; throw new CompactError('COMPACT_PRIVATE_FILE_INVALID') }
  if (verb === 'install') return executeCompactInstall({ packageDirectory: args['--package'], target, plan, driver })
  const { loaded, observed } = await inspectCompactInstall({ packageDirectory: args['--package'], target, driver, verifyCredentials: verb === 'plan' })
  if (verb === 'stop') return driver.stop({ manifest: loaded.manifest, target })
  if (verb === 'status' && !observed.container?.running) return { status: observed.container ? 'STOPPED_UNVERIFIED' : 'NOT_INSTALLED', project: target.project, targetId: target.targetId }
  const computed = planCompactInstall({ manifest: loaded.manifest, target, observed })
  if (verb === 'plan') return computed
  if (verb === 'inspect') return { status: 'INSPECTED', plan: computed }
  return { status: computed.action === 'INSPECT_INSTALLED' ? 'INSTALLED' : 'NOT_INSTALLED', project: target.project, targetId: target.targetId }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCompactSelfHost(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + '\n'), error => { process.stderr.write((error instanceof CompactError ? error.code : 'COMPACT_COMMAND_FAILED') + '\n'); process.exitCode = 1 })
}
