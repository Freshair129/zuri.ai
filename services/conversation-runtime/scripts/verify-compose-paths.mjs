import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// @req FR-149 — the Conversation Runtime image resolves against the monorepo root.
// @spec ADR-106 D5, SDD-108 — Compose build paths stay independent of apps/server.
// @tested .github/workflows/governance.yml
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const serviceRoot = path.resolve(scriptDirectory, '..')
const repositoryRoot = path.resolve(serviceRoot, '../..')
const serverProjectDirectory = path.resolve(repositoryRoot, 'apps/server')

function assertFile(file, label) {
  if (!existsSync(file)) throw new Error(`${label} does not exist: ${file}`)
}

function buildBlock(source, serviceName) {
  const lines = source.split(/\r?\n/)
  const start = lines.findIndex(line => line === `  ${serviceName}:`)
  if (start < 0) throw new Error(`Compose service missing: ${serviceName}`)
  let end = start + 1
  while (end < lines.length && !/^  [A-Za-z0-9_-]+:\s*$/.test(lines[end])) end += 1
  const service = lines.slice(start + 1, end)
  const buildStart = service.findIndex(line => line === '    build:')
  if (buildStart < 0) throw new Error(`Compose build missing: ${serviceName}`)
  const context = service.slice(buildStart + 1).find(line => /^      context:\s*/.test(line))?.match(/^      context:\s*(.+?)\s*$/)?.[1]
  const dockerfile = service.slice(buildStart + 1).find(line => /^      dockerfile:\s*/.test(line))?.match(/^      dockerfile:\s*(.+?)\s*$/)?.[1]
  if (!context || !dockerfile) throw new Error(`Compose build paths missing: ${serviceName}`)
  return { context, dockerfile }
}

function resolveBuild({ context, dockerfile }, projectDirectory, label) {
  const resolvedContext = path.resolve(projectDirectory, context)
  const resolvedDockerfile = path.resolve(resolvedContext, dockerfile)
  assertFile(resolvedDockerfile, `${label} Dockerfile`)
  return { context: resolvedContext, dockerfile: resolvedDockerfile }
}

const baseCompose = readFileSync(path.join(serverProjectDirectory, 'docker-compose.yml'), 'utf8')
const runtimeCompose = readFileSync(path.join(serverProjectDirectory, 'docker-compose.conversation-runtime.yml'), 'utf8')
const smokeComposePath = path.join(serviceRoot, 'docker-compose.smoke.yml')
const smokeCompose = readFileSync(smokeComposePath, 'utf8')

const baseBuild = resolveBuild(buildBlock(baseCompose, 'web'), serverProjectDirectory, 'base web')
const runtimeBuild = resolveBuild(buildBlock(runtimeCompose, 'conversation-runtime'), serverProjectDirectory, 'runtime overlay')
const smokeBuild = resolveBuild(buildBlock(smokeCompose, 'conversation-runtime'), path.dirname(smokeComposePath), 'runtime smoke')
const smokeCoreBuild = resolveBuild(buildBlock(smokeCompose, 'smoke-core'), path.dirname(smokeComposePath), 'smoke core')
const expectedSmokeCoreDockerfile = path.join(serviceRoot, 'scripts/Dockerfile.smoke-core')

if (baseBuild.context !== serverProjectDirectory) throw new Error('Base Compose project-directory no longer resolves web context to apps/server')
if (runtimeBuild.context !== repositoryRoot) throw new Error('Runtime overlay must resolve its build context to repository root')
if (runtimeBuild.dockerfile !== path.join(repositoryRoot, 'services/conversation-runtime/Dockerfile')) {
  throw new Error('Runtime overlay Dockerfile must resolve from the repository-root context')
}
if (smokeBuild.context !== repositoryRoot || smokeBuild.dockerfile !== runtimeBuild.dockerfile) {
  throw new Error('Disposable smoke Compose must build the same service image from repository root')
}
if (smokeCoreBuild.context !== repositoryRoot || smokeCoreBuild.dockerfile !== expectedSmokeCoreDockerfile) {
  throw new Error('Disposable smoke Core must build its isolated fixture from repository root')
}

const runtimeDockerfile = readFileSync(runtimeBuild.dockerfile, 'utf8')
for (const line of runtimeDockerfile.split(/\r?\n/)) {
  const copy = line.match(/^\s*COPY\s+([^\s]+)\s+/)
  if (!copy || copy[1].startsWith('--')) continue
  assertFile(path.resolve(repositoryRoot, copy[1]), `Dockerfile COPY source ${copy[1]}`)
}
const smokeCoreDockerfile = readFileSync(smokeCoreBuild.dockerfile, 'utf8')
for (const line of smokeCoreDockerfile.split(/\r?\n/)) {
  const copy = line.match(/^\s*COPY\s+([^\s]+)\s+/)
  if (!copy || copy[1].startsWith('--')) continue
  assertFile(path.resolve(repositoryRoot, copy[1]), `Smoke Core Dockerfile COPY source ${copy[1]}`)
}

let composeResolvedPaths = null
if (process.argv.includes('--compose')) {
  const config = JSON.parse(execFileSync('docker', ['compose', '--project-directory', 'apps/server',
    '--profile', 'conversation-runtime',
    '-f', 'apps/server/docker-compose.yml', '-f', 'apps/server/docker-compose.conversation-runtime.yml',
    'config', '--format', 'json'], { cwd: repositoryRoot, env: process.env, encoding: 'utf8' }))
  const web = config.services?.web?.build
  const runtime = config.services?.['conversation-runtime']?.build
  const webContext = web && path.resolve(repositoryRoot, web.context)
  const runtimeContext = runtime && path.resolve(repositoryRoot, runtime.context)
  const runtimeDockerfilePath = runtimeContext && path.resolve(runtimeContext, runtime.dockerfile)
  if (webContext !== serverProjectDirectory || runtimeContext !== repositoryRoot
    || runtimeDockerfilePath !== path.join(repositoryRoot, 'services/conversation-runtime/Dockerfile')) {
    throw new Error(`Docker Compose resolved unexpected build paths: ${JSON.stringify({ webContext, runtimeContext, runtimeDockerfilePath })}`)
  }
  composeResolvedPaths = { webContext, runtimeContext, runtimeDockerfile: runtimeDockerfilePath }
}

process.stdout.write(`${JSON.stringify({
  composeCommand: 'docker compose --project-directory apps/server -f apps/server/docker-compose.yml -f apps/server/docker-compose.conversation-runtime.yml build conversation-runtime',
  baseCompose: baseBuild,
  runtimeOverlay: runtimeBuild,
  disposableSmoke: smokeBuild,
  disposableSmokeCore: smokeCoreBuild,
  composeResolvedPaths,
  dockerfileCopySourcesExist: true,
}, null, 2)}\n`)
