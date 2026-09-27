#!/usr/bin/env node
// Build (and, only behind --deploy, roll out) a production web release as a ki17
// overlay: the checked-out SHA's plain `runner` image plus the /opt/ki17 tree of the
// image production runs today. deploy/ki17/README.md "Cutting a release with the
// overlay" is the operator procedure; deploy/ki17/overlay/Dockerfile is the image.
//
// What it does, in order:
//   1. refuses a dirty working tree (the tag names a SHA, so the SHA must be the build)
//   2. reads ONE non-secret variable, ZURI_WEB_IMAGE, from apps/server/.env — the
//      image production runs, which becomes KI17_FROM and the rollback target
//   3. docker build --target runner -t zuri-ai-web:main-<sha8>        (apps/server)
//   4. docker build -f deploy/ki17/overlay/Dockerfile
//        --build-arg BASE=zuri-ai-web:main-<sha8> --build-arg KI17_FROM=<current>
//        -t zuri-ai-web-ki17:release-<sha8>-ki17-overlay                (apps/server)
//   5. prints the switch / recreate / verify / rollback commands. It runs them only
//      with --deploy: back up .env, switch ZURI_WEB_IMAGE, recreate web + line-worker
//      and force-recreate genesis-worker (RCA 2026-09-22 worker namespace), wait for
//      web health, run ki17-smoke; on any failure restore .env and recreate again.
//
// It never prints a value from .env other than ZURI_WEB_IMAGE, and never passes a
// secret on a command line.
//
// Usage (from apps/server, on the production host's primary checkout):
//   node scripts/build-ki17-overlay-release.mjs [--ki17-from <image>] [--skip-runner-build] [--deploy]

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHA_PATTERN = /^[0-9a-f]{40}$/
export const ENV_VAR = 'ZURI_WEB_IMAGE'
export const OVERLAY_DOCKERFILE = 'deploy/ki17/overlay/Dockerfile'
export const SMOKE_COMMAND = ['docker', 'compose', 'exec', '-T', 'web', 'node', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/ki17-smoke.mjs']
export const RECREATE_COMMANDS = [
  ['docker', 'compose', 'up', '-d', '--no-build', 'web', 'line-worker'],
  // RCA 2026-09-22: genesis-worker lives in web's network namespace; a web recreate
  // without this leaves the worker listening in a dead namespace.
  ['docker', 'compose', 'up', '-d', '--no-build', '--force-recreate', 'genesis-worker'],
]

export class OverlayError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.code = code
  }
}

/** The two tags one release produces, both named by the first 8 hex of the SHA. */
export function releaseNames(sha) {
  const commit = String(sha ?? '').trim().toLowerCase()
  if (!SHA_PATTERN.test(commit)) throw new OverlayError('KI17_OVERLAY_SHA_INVALID', `expected a 40-character commit, got ${JSON.stringify(sha)}`)
  const short = commit.slice(0, 8)
  return {
    commit,
    short,
    baseTag: `zuri-ai-web:main-${short}`,
    releaseTag: `zuri-ai-web-ki17:release-${short}-ki17-overlay`,
  }
}

function unquote(value) {
  const trimmed = value.trim()
  const quoted = /^(['"])(.*)\1$/.exec(trimmed)
  return quoted ? quoted[2] : trimmed.replace(/\s+#.*$/, '')
}

/**
 * The value of ONE variable in dotenv text, or null. Only the named line is looked
 * at; the last assignment wins, as in Compose.
 */
export function readEnvVar(text, name) {
  let value = null
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=(.*)$`)
  for (const line of String(text).split(/\r?\n/)) {
    const match = pattern.exec(line)
    if (match) value = unquote(match[1])
  }
  return value === '' ? null : value
}

/** Replace every assignment of `name` (or append one), keeping the file's EOL. */
export function replaceEnvVar(text, name, value) {
  if (!/^[A-Za-z0-9._:/@-]+$/.test(value)) throw new OverlayError('KI17_OVERLAY_IMAGE_INVALID', `refusing to write ${name}=${JSON.stringify(value)}`)
  const eol = String(text).includes('\r\n') ? '\r\n' : '\n'
  const pattern = new RegExp(`^(\\s*(?:export\\s+)?${name}\\s*=).*$`)
  let replaced = false
  const lines = String(text).split(/\r?\n/).map((line) => {
    if (!pattern.test(line)) return line
    replaced = true
    return `${name}=${value}`
  })
  if (!replaced) {
    if (lines.length && lines[lines.length - 1] === '') lines.splice(lines.length - 1, 0, `${name}=${value}`)
    else lines.push(`${name}=${value}`)
  }
  return lines.join(eol)
}

/** Every refusal the build makes before it spends a docker build. */
export function assertReleasable({ dirty, currentImage, ki17From, ki17FromExists, releaseTag, explicitKi17From = false }) {
  if (dirty) throw new OverlayError('KI17_OVERLAY_DIRTY_TREE', 'the working tree has uncommitted or untracked changes; the release tag names a commit, so the build must be exactly that commit. Commit, stash or clean first.')
  if (!ki17From) throw new OverlayError('KI17_OVERLAY_NO_CURRENT_IMAGE', `${ENV_VAR} is not set in apps/server/.env and no --ki17-from was given, so there is no running /opt/ki17 to carry forward`)
  if (!ki17FromExists) throw new OverlayError('KI17_OVERLAY_KI17_FROM_MISSING', `image ${ki17From} is not present locally; KI17_FROM must be the ki17 image production runs`)
  if (ki17From === releaseTag && !explicitKi17From) throw new OverlayError('KI17_OVERLAY_ALREADY_CURRENT', `${ENV_VAR} already names ${releaseTag}; nothing to release, and it would be its own rollback target`)
  if (!currentImage) return
  if (!/(^|\/)zuri-ai-web(-ki17)?:/.test(currentImage)) throw new OverlayError('KI17_OVERLAY_CURRENT_IMAGE_UNEXPECTED', `${ENV_VAR}=${currentImage} is not a zuri-ai-web image; refusing to guess`)
}

/** The build commands, as argv arrays (run from apps/server). */
export function buildCommands({ baseTag, releaseTag, ki17From }) {
  return {
    runner: ['docker', 'build', '--target', 'runner', '-t', baseTag, '.'],
    overlay: ['docker', 'build', '-f', OVERLAY_DOCKERFILE, '--build-arg', `BASE=${baseTag}`, '--build-arg', `KI17_FROM=${ki17From}`, '-t', releaseTag, '.'],
  }
}

/** The operator commands to switch, verify and roll back, as printable text. */
export function deployPlan({ releaseTag, previousImage }) {
  const show = (argv) => argv.join(' ')
  return [
    '# 1. back up .env, then set the one variable (values other than it are untouched):',
    `Copy-Item .env .env.bak-ki17-overlay-<timestamp>`,
    `#    ${ENV_VAR}=${releaseTag}`,
    '# 2. recreate web + line-worker, then force-recreate genesis-worker (RCA 2026-09-22):',
    ...RECREATE_COMMANDS.map(show),
    '# 3. verify: web healthy, then both ki17 relay hops:',
    'docker inspect --format "{{.State.Health.Status}}" (docker compose ps -q web)',
    show(SMOKE_COMMAND),
    '# ROLLBACK: restore the backup (or set the previous image) and recreate the same way:',
    `#    ${ENV_VAR}=${previousImage}`,
    ...RECREATE_COMMANDS.map(show),
    show(SMOKE_COMMAND),
  ].join('\n')
}

/**
 * The --deploy sequence. Every side effect goes through `ops`, so the rollback
 * logic is testable without Docker. Returns { ok, rolledBack, failure }.
 */
export async function deployRelease({ releaseTag, previousImage, ops }) {
  const envText = ops.readEnv()
  const backup = ops.backupEnv()
  ops.log(`ki17 overlay: .env backed up to ${backup}`)
  ops.writeEnv(replaceEnvVar(envText, ENV_VAR, releaseTag))
  ops.log(`ki17 overlay: ${ENV_VAR} ${previousImage} -> ${releaseTag}`)

  const rollout = async () => {
    for (const argv of RECREATE_COMMANDS) {
      if (ops.run(argv) !== 0) return `${argv.join(' ')} failed`
    }
    if (!(await ops.waitHealthy())) return 'web did not become healthy'
    if (ops.run(SMOKE_COMMAND) !== 0) return 'ki17-smoke failed'
    return null
  }

  const failure = await rollout()
  if (!failure) return { ok: true, rolledBack: false, failure: null }

  ops.log(`ki17 overlay: DEPLOY FAILED (${failure}); restoring .env and ${previousImage}`)
  ops.restoreEnv(backup)
  const rollbackFailure = await rollout()
  if (rollbackFailure) ops.log(`ki17 overlay: ROLLBACK ALSO FAILED (${rollbackFailure}); production needs an operator now`)
  else ops.log(`ki17 overlay: rolled back to ${previousImage}; health and smoke pass`)
  return { ok: false, rolledBack: !rollbackFailure, failure, rollbackFailure }
}

export function parseArguments(argv) {
  const options = { ki17From: null, skipRunnerBuild: false, deploy: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--deploy') { options.deploy = true; continue }
    if (flag === '--skip-runner-build') { options.skipRunnerBuild = true; continue }
    if (flag === '--ki17-from') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new OverlayError('KI17_OVERLAY_ARGS_INVALID', '--ki17-from expects an image reference')
      options.ki17From = value
      index += 1
      continue
    }
    throw new OverlayError('KI17_OVERLAY_ARGS_INVALID', `unknown argument ${flag}; usage: build-ki17-overlay-release.mjs [--ki17-from <image>] [--skip-runner-build] [--deploy]`)
  }
  return options
}

// ------------------------------------------------------------------ host wiring

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(serverRoot, '.env')

function capture(argv) {
  const result = spawnSync(argv[0], argv.slice(1), { cwd: serverRoot, encoding: 'utf8' })
  return { status: result.status ?? 1, stdout: (result.stdout ?? '').trim() }
}

function run(argv) {
  process.stdout.write(`\n$ ${argv.join(' ')}\n`)
  return spawnSync(argv[0], argv.slice(1), { cwd: serverRoot, stdio: 'inherit' }).status ?? 1
}

const imageExists = (image) => capture(['docker', 'image', 'inspect', '--format', '{{.Id}}', image]).status === 0

async function waitHealthy({ timeoutMs = 180_000, intervalMs = 5_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const id = capture(['docker', 'compose', 'ps', '-q', 'web']).stdout
    if (id) {
      const status = capture(['docker', 'inspect', '--format', '{{.State.Health.Status}}', id]).stdout
      if (status === 'healthy') return true
      if (status === 'unhealthy') return false
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

async function main(argv) {
  const options = parseArguments(argv)
  const head = capture(['git', 'rev-parse', 'HEAD'])
  if (head.status !== 0) throw new OverlayError('KI17_OVERLAY_NOT_A_CHECKOUT', 'git rev-parse HEAD failed')
  const names = releaseNames(head.stdout)
  const dirty = capture(['git', 'status', '--porcelain']).stdout.length > 0
  const currentImage = existsSync(envPath) ? readEnvVar(readFileSync(envPath, 'utf8'), ENV_VAR) : null
  const ki17From = options.ki17From ?? currentImage

  assertReleasable({
    dirty,
    currentImage,
    ki17From,
    ki17FromExists: Boolean(ki17From) && imageExists(ki17From),
    releaseTag: names.releaseTag,
    explicitKi17From: Boolean(options.ki17From),
  })
  process.stdout.write(`ki17 overlay: commit ${names.commit}\nki17 overlay: KI17_FROM ${ki17From}\n`)

  const commands = buildCommands({ ...names, ki17From })
  if (options.skipRunnerBuild) {
    if (!imageExists(names.baseTag)) throw new OverlayError('KI17_OVERLAY_BASE_MISSING', `--skip-runner-build was given but ${names.baseTag} does not exist`)
  } else if (run(commands.runner) !== 0) {
    throw new OverlayError('KI17_OVERLAY_RUNNER_BUILD_FAILED', `docker build --target runner for ${names.short} failed`)
  }
  if (!imageExists(names.baseTag)) throw new OverlayError('KI17_OVERLAY_BASE_MISSING', `${names.baseTag} is not present after the runner build`)
  if (run(commands.overlay) !== 0) throw new OverlayError('KI17_OVERLAY_BUILD_FAILED', `the overlay build for ${names.releaseTag} failed`)
  process.stdout.write(`\nki17 overlay: built ${names.releaseTag}\n`)

  const previousImage = currentImage ?? ki17From
  if (!options.deploy) {
    process.stdout.write(`\nNothing was deployed. To release it (from apps/server):\n\n${deployPlan({ releaseTag: names.releaseTag, previousImage })}\n`)
    return 0
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')
  const result = await deployRelease({
    releaseTag: names.releaseTag,
    previousImage,
    ops: {
      readEnv: () => readFileSync(envPath, 'utf8'),
      writeEnv: (text) => writeFileSync(envPath, text),
      backupEnv: () => {
        const backup = `${envPath}.bak-ki17-overlay-${stamp}`
        copyFileSync(envPath, backup)
        return path.basename(backup)
      },
      restoreEnv: (backup) => copyFileSync(path.join(serverRoot, backup), envPath),
      run,
      waitHealthy,
      log: (line) => process.stdout.write(`${line}\n`),
    },
  })
  if (result.ok) process.stdout.write(`\nki17 overlay: ${names.releaseTag} is live; health and ki17-smoke pass. Rollback target: ${previousImage}\n`)
  return result.ok ? 0 : 1
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    process.stderr.write(`\n${error.message}\n\n`)
    process.exit(1)
  })
}
