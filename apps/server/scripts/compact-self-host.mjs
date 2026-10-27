#!/usr/bin/env node
// @spec ADR-115 — explicit TEST-only schema/private bootstrap commands; no production activation.
// @tested tests/node/compact-executor.test.mjs, tests/postgres/compact-fresh-install.test.js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CompactError } from './lib/compact/manifest.mjs'
import { planCompactInstall, validateCompactTarget } from './lib/compact/target.mjs'
import { inspectCompactInstall, executeCompactInstall, readCompactPrivateFile } from './lib/compact/executor.mjs'
import { createCompactDockerDriver } from './lib/compact/docker.mjs'
import { bootstrapCompactOperator, inspectCompactCapabilities } from './lib/compact/bootstrap.mjs'
export async function runCompactSelfHost(argv, { driver = createCompactDockerDriver() } = {}) {
  const [verb, ...rest] = argv, options = { inspect: [], plan: [], install: ['--plan'], status: [], stop: [], bootstrap: ['--operator', '--private-output'], diagnostics: ['--configuration'] }
  if (!Object.hasOwn(options, verb)) throw new CompactError('COMPACT_ARGUMENTS_INVALID')
  const flags = new Set(['--package', '--target', ...options[verb]]), args = Object.create(null)
  for (let i = 0; i < rest.length; i += 2) {
    if (!flags.has(rest[i]) || args[rest[i]] !== undefined || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new CompactError('COMPACT_ARGUMENTS_INVALID')
    args[rest[i]] = rest[i + 1]
  }
  if (!args['--package'] || !args['--target'] || verb === 'bootstrap' && (!args['--operator'] || !args['--private-output'])) throw new CompactError('COMPACT_ARGUMENTS_INVALID')
  let target, plan, operator
  try {
    target = validateCompactTarget(JSON.parse(await readCompactPrivateFile(args['--target'])))
    if (args['--plan']) plan = JSON.parse(await readCompactPrivateFile(args['--plan']))
    if (args['--operator']) operator = JSON.parse(await readCompactPrivateFile(args['--operator']))
  } catch (e) { if (e instanceof CompactError) throw e; throw new CompactError('COMPACT_PRIVATE_FILE_INVALID') }
  if (verb === 'install') return executeCompactInstall({ packageDirectory: args['--package'], target, plan, driver })
  if (verb === 'bootstrap') return bootstrapCompactOperator({ packageDirectory: args['--package'], target, operator, privateOutput: args['--private-output'], driver })
  const { loaded, observed } = await inspectCompactInstall({ packageDirectory: args['--package'], target, driver, verifyCredentials: verb === 'plan' })
  if (verb === 'diagnostics') {
    const configuration = Object.create(null)
    if (args['--configuration']) for (const line of (await readCompactPrivateFile(args['--configuration'])).toString('utf8').split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith('#')) continue
      const match = /^([A-Z][A-Z0-9_]*)=([^\x00\r\n]*)$/.exec(line)
      if (!match || Object.hasOwn(configuration, match[1])) throw new CompactError('COMPACT_PRIVATE_FILE_INVALID')
      configuration[match[1]] = match[2]
    }
    return inspectCompactCapabilities({ manifest: loaded.manifest, target, observed, configuration })
  }
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
