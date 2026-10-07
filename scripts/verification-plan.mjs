#!/usr/bin/env node
// @spec docs/architecture/VERIFICATION-POLICY.md
// @tested tools/tests/verification-plan.test.mjs
// Shadow planning only: no returned field may authorize a job omission.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ISOLATED_SERVICES, relatedEligibility, scopeOutputs } from './ci-change-scope.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PILOT = 'conversation-runtime'
const PILOT_ROOT = `services/${PILOT}`
const DOCUMENTS = [`docs/services/${PILOT}/SERVICE.md`, `docs/services/${PILOT}/TESTING.md`]
const MAP = 'docs/architecture/SERVICE-MAP.md'
const EVENTS = ['pull_request', 'push', 'schedule', 'workflow_dispatch', 'local']

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function relativeFile(value) {
  assert(typeof value === 'string' && value.length > 0 && !value.includes('\\')
    && !/[\x00-\x1f:]/.test(value) && !path.posix.isAbsolute(value)
    && !value.split('/').some(part => !part || part === '.' || part === '..'), 'INVALID_REPOSITORY_PATH')
  return value
}

function containedFile(root, relative) {
  const file = path.join(root, relativeFile(relative))
  assert(existsSync(file) && statSync(file).isFile(), `MISSING_FILE:${relative}`)
  const location = path.relative(realpathSync(root), realpathSync(file))
  assert(location !== '..' && !location.startsWith(`..${path.sep}`) && !path.isAbsolute(location), `PATH_ESCAPE:${relative}`)
  return file
}

export function loadPilot(root) {
  const value = JSON.parse(readFileSync(containedFile(root, `${PILOT_ROOT}/verification.json`), 'utf8'))
  const keys = ['schemaVersion', 'id', 'root', 'mode', 'documents', 'domainRefs', 'contract', 'tasks', 'additionalCoreTests']
  assert(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'INVALID_METADATA_KEYS')
  assert(value.schemaVersion === 2 && value.id === PILOT && value.root === PILOT_ROOT && value.mode === 'shadow', 'INVALID_PILOT_IDENTITY')
  assert(JSON.stringify(value.documents) === JSON.stringify(DOCUMENTS), 'INVALID_PILOT_DOCUMENTS')
  assert(Array.isArray(value.domainRefs) && value.domainRefs.length > 0
    && new Set(value.domainRefs).size === value.domainRefs.length
    && value.domainRefs.every(ref => /^docs\/domains\/[a-z-]+\/CHARTER\.md$/.test(ref)), 'INVALID_DOMAIN_REFERENCES')
  assert(value.contract === `${PILOT_ROOT}/contracts/v1/operation.schema.json`, 'INVALID_CONTRACT_REFERENCE')
  assert(value.tasks && Object.keys(value.tasks).sort().join(',') === 'build,test'
    && value.tasks.test === 'test' && value.tasks.build === 'build', 'INVALID_TASK_REFERENCES')
  assert(Array.isArray(value.additionalCoreTests) && value.additionalCoreTests.length > 0
    && new Set(value.additionalCoreTests).size === value.additionalCoreTests.length
    && value.additionalCoreTests.every(file => typeof file === 'string'
      && /^apps\/server\/tests\/(unit|integration)\/[A-Za-z0-9._/-]+\.test\.js$/.test(file)), 'INVALID_ADDITIONAL_CORE_TESTS')
  for (const ref of [...value.documents, ...value.domainRefs, value.contract, ...value.additionalCoreTests]) containedFile(root, ref)
  const pkg = JSON.parse(readFileSync(containedFile(root, `${PILOT_ROOT}/package.json`), 'utf8'))
  for (const task of Object.values(value.tasks)) assert(typeof pkg.scripts?.[task] === 'string' && pkg.scripts[task].trim(), `MISSING_PACKAGE_SCRIPT:${task}`)
  return value
}

export function consumerInventory(root, metadata = loadPilot(root), sourceRevision = null) {
  const discovered = scopeOutputs(`${PILOT_ROOT}/src/context.js`, path.join(root, 'apps/server'))
    .contracts.split(' ').filter(Boolean)
  const additional = metadata.additionalCoreTests.map(file => file.slice('apps/server/'.length)).sort()
  const selected = [...new Set([...discovered, ...additional])].sort()
  const files = selected.map(file => {
    const relative = `apps/server/${file}`
    return { path: relative, sha256: createHash('sha256').update(readFileSync(containedFile(root, relative))).digest('hex') }
  })
  return { discovered, additional, selected, sourceRevision, files, completeness: 'known-bounded-set' }
}

function changedDigest(root, files) {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(`${file}\0`)
    if (existsSync(path.join(root, file))) {
      hash.update('FILE\0')
      hash.update(readFileSync(containedFile(root, file)))
    } else hash.update('DELETED\0')
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function createVerificationPlan(root, { changed, deleted = [], event = 'local', revisions = {} }) {
  assert(EVENTS.includes(event), 'INVALID_EVENT')
  assert(Array.isArray(changed), 'INVALID_CHANGED_PATHS')
  const files = [...new Set(changed.map(relativeFile))].sort()
  assert(files.length > 0, 'EMPTY_CHANGE_SET')
  assert(Array.isArray(deleted), 'INVALID_DELETED_PATHS')
  const deletions = [...new Set(deleted.map(relativeFile))].sort()
  assert(deletions.every(file => files.includes(file)), 'DELETION_OUTSIDE_CHANGE_SET')
  const metadata = loadPilot(root)
  const activeScope = scopeOutputs(files.join('\n'), path.join(root, 'apps/server'))
  const prLike = event === 'pull_request' || event === 'local'
  const isolated = prLike && activeScope.server === 'false'
  const scheduled = event === 'schedule'
  const active = {
    governance: !scheduled,
    serverBuild: !scheduled && !isolated,
    serverTests: scheduled ? 'not-scheduled' : isolated ? 'existing-contract-selection'
      : prLike ? 'existing-related-or-full-selection' : 'full',
    serviceJobs: scheduled ? [] : [...ISOLATED_SERVICES],
    e2e: scheduled || event === 'workflow_dispatch',
    coreContractTests: isolated ? activeScope.contracts.split(' ').filter(Boolean) : [],
    relatedEligibility: relatedEligibility(files.join('\n'), file => existsSync(path.join(root, file))),
  }
  let reason = prLike ? null : 'event retains existing full/scheduled policy'
  let runtimeChanged = false
  for (const file of files) {
    if (metadata.documents.includes(file)) {
      if (deletions.includes(file) || !existsSync(path.join(root, file))) reason ||= `deleted document:${file}`
      continue
    }
    if (file.startsWith(`${PILOT_ROOT}/contracts/`)) {
      reason ||= `contract requires wider qualification:${file}`
      continue
    }
    if (!file.startsWith(`${PILOT_ROOT}/src/`) && !file.startsWith(`${PILOT_ROOT}/test/`)) {
      reason ||= `outside bounded pilot:${file}`
      continue
    }
    runtimeChanged = true
    if (deletions.includes(file) || !existsSync(path.join(root, file))) reason ||= `deleted or renamed input:${file}`
  }
  if (!runtimeChanged) reason ||= 'no Runtime implementation/test input changed'
  // Keep active discovery and add explicit semantic consumers only to shadow evidence.
  const inventory = consumerInventory(root, metadata, revisions.testedHead ?? null)
  if (!inventory.discovered.length) reason ||= 'no Core contract evidence discovered'
  const candidate = reason ? { ...active, eligible: false, reason } : {
    governance: true,
    serverBuild: false,
    serverTests: 'existing-contract-selection',
    serviceJobs: [PILOT],
    e2e: false,
    coreContractTests: inventory.selected,
    eligible: true,
    reason: 'Runtime inputs plus explicitly declared service explanation only',
  }
  return {
    schemaVersion: 2, mode: 'shadow', omissionsAllowed: false, event, revisions,
    changed: files, deleted: deletions, changedInputDigest: changedDigest(root, files),
    metadataDigest: createHash('sha256').update(JSON.stringify(metadata)).digest('hex'),
    active, candidate, consumerInventory: inventory,
    limitation: 'No jobs are skipped or executed. Consumer completeness and paired full-run evidence remain required.',
  }
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true })
  assert(result.status === 0, `GIT_READ_FAILED:${args[0]}`)
  return result.stdout.trimEnd()
}

function commit(root, revision) {
  assert(typeof revision === 'string' && revision.length > 0 && !revision.startsWith('-') && !/[\x00-\x1f]/.test(revision), 'INVALID_REVISION')
  const sha = git(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`])
  assert(/^[a-f0-9]{40,64}$/.test(sha), 'INVALID_COMMIT')
  return sha
}

export function collectChanges(root, { base, head = 'HEAD', event = 'local' }) {
  assert(EVENTS.includes(event), 'INVALID_EVENT')
  const baseSha = commit(root, base)
  const headSha = commit(root, head)
  const testedHead = commit(root, 'HEAD')
  const comparisonBase = event === 'local' ? git(root, ['merge-base', baseSha, headSha]) : baseSha
  const deleted = new Set()
  const diff = (...revisions) => {
    const entries = git(root, ['diff', '--name-status', '--no-renames', '-z', ...revisions]).split('\0').filter(Boolean)
    assert(entries.length % 2 === 0, 'INVALID_GIT_DIFF')
    const files = []
    for (let i = 0; i < entries.length; i += 2) {
      assert(/^[AMDUTXB]$/.test(entries[i]), 'INVALID_GIT_STATUS')
      files.push(entries[i + 1])
      if (entries[i] === 'D') deleted.add(entries[i + 1])
    }
    return files
  }
  // Include the actual merge/checkout tree too, not only the PR author's head.
  const changed = [...diff(comparisonBase, headSha), ...diff(comparisonBase, testedHead)]
  if (event === 'local') {
    // Opposing index/worktree edits must not cancel a pending input.
    changed.push(...diff('--cached', 'HEAD'), ...diff())
    changed.push(...git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'))
  } else {
    assert(git(root, ['status', '--porcelain', '--untracked-files=no']) === '', 'DIRTY_HOSTED_CHECKOUT')
  }
  return { changed: [...new Set(changed.filter(Boolean))].sort(), deleted: [...deleted].sort(), event,
    revisions: { base: baseSha, comparisonBase, head: headSha, testedHead, workingTreeIncluded: event === 'local' } }
}

export function renderServiceMap(root) {
  const metadata = loadPilot(root)
  const rows = ['server', ...ISOLATED_SERVICES].map(id => {
    const projectRoot = id === 'server' ? 'apps/server' : `services/${id}`
    const pkg = JSON.parse(readFileSync(containedFile(root, `${projectRoot}/package.json`), 'utf8'))
    const service = `docs/services/${id}/SERVICE.md`
    const testing = `docs/services/${id}/TESTING.md`
    containedFile(root, service); containedFile(root, testing)
    return `| ${id} | \`${projectRoot}\` | [Ownership / contracts](../services/${id}/SERVICE.md) | [Testing](../services/${id}/TESTING.md) | ${['test', 'build'].filter(key => pkg.scripts?.[key]).join(', ')} | ${id === metadata.id ? 'shadow pilot; active gates unchanged' : 'existing conservative selection'} |`
  })
  return ['---', 'status: active', 'superseded_by: null', 'version: "0.1.0"', 'doc_type: generated-view', '---', '',
    '# Service verification map', '', '> Generated by `npm run docs:services`. Edit service sources or pilot metadata, not this view.', '',
    'The active selector supplies the project inventory. Domain ownership and wire contracts remain in the linked sources.', '',
    '| Project | Execution root | Authority | Verification | Package scripts | Selection |',
    '|---|---|---|---|---|---|', ...rows, '',
    '[Verification policy](VERIFICATION-POLICY.md) · [Service index](../services/README.md)', '',
    'Presence here proves a package/document relationship, not successful tests, complete extraction or deployment.', ''].join('\n')
}

export function main(args, root = ROOT) {
  if (args.length === 1 && ['--map', '--check-map'].includes(args[0])) {
    const output = renderServiceMap(root)
    const target = path.join(root, MAP)
    if (args[0] === '--check-map') assert(readFileSync(containedFile(root, MAP), 'utf8') === output, 'STALE_SERVICE_MAP')
    else {
      const parent = path.relative(realpathSync(root), realpathSync(path.dirname(target)))
      assert(parent !== '..' && !parent.startsWith(`..${path.sep}`) && !path.isAbsolute(parent), `PATH_ESCAPE:${MAP}`)
      if (existsSync(target)) containedFile(root, MAP)
      writeFileSync(target, output)
    }
    return
  }
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]
    assert(['--base', '--head', '--event'].includes(key) && args[i + 1] && !Object.hasOwn(options, key.slice(2)), 'INVALID_ARGUMENTS')
    options[key.slice(2)] = args[i + 1]
  }
  assert(options.base, 'usage: verification-plan.mjs --base <commit> [--head <commit>] [--event local|pull_request|push|schedule|workflow_dispatch]')
  process.stdout.write(`${JSON.stringify(createVerificationPlan(root, collectChanges(root, options)), null, 2)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`verification-plan: ${error.message}\n`)
    process.exitCode = 1
  }
}
