#!/usr/bin/env node
// ADR-075 Phase 3, prerequisite P-3 — the pin gate for the `ki17` build stages.
//
// The design (docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md §8 P-3, gate G-4) requires
// that the MSP, GKS and GenesisBlock sources baked into the images are the exact
// commits the Phase 2 acceptance ran against. This script is the check: it reads
// deploy/ki17/pins.json and, for every build context it is handed, resolves that
// context's actual commit and refuses to continue when it is not the pinned one.
//
// It runs inside the image build (`RUN node verify-ki17-pins.mjs ...`) so the pin
// cannot be skipped by forgetting a CI step, and it can also be run on the host
// against plain checkouts before a build.
//
// How a context's commit is resolved, in order:
//
//   1. `<context>/.git` — a real git directory (or a worktree's `gitdir:` pointer
//      file). This is *verified* provenance: the commit is read from git's own
//      refs, so a context at the wrong revision cannot claim otherwise.
//   2. `<context>/.ki17-pin` — a single 40-hex line. This is *operator-attested*
//      provenance, for contexts that carry no git metadata (a `git archive`
//      export, or BuildKit's git-URL form of --build-context, neither of which
//      ships `.git`). It is honoured, and every report says so, because a file an
//      operator wrote is only as good as the command that wrote it:
//        git -C <repo> rev-parse <sha> > <export-dir>/.ki17-pin
//
// A context with neither fails. Nothing here ever guesses, and nothing passes by
// default: an unreadable provenance is a failed build, which is the whole point.
//
// Node built-ins only — this runs before any npm install in the build.

import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const SHA_PATTERN = /^[0-9a-f]{40}$/

class PinError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.code = code
  }
}

function usage() {
  return [
    'Usage:',
    '  node verify-ki17-pins.mjs --manifest <pins.json> --context <name>=<dir> [--context ...] [--out <file>]',
    '',
    '  --manifest  the pin manifest (apps/server/deploy/ki17/pins.json)',
    '  --context   a build context to verify, named as it appears in the manifest',
    "              under repositories.<name>.buildContext (e.g. msp=/ctx/msp)",
    '  --out       optional path for a JSON receipt of what was resolved',
  ].join('\n')
}

export function parseArguments(argv) {
  const options = { manifest: null, contexts: [], out: null }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--manifest') { options.manifest = value; index += 1; continue }
    if (flag === '--out') { options.out = value; index += 1; continue }
    if (flag === '--context') {
      if (typeof value !== 'string' || !value.includes('=')) throw new PinError('KI17_PIN_ARGS_INVALID', `--context expects <name>=<dir>, got ${value ?? '(nothing)'}`)
      const separator = value.indexOf('=')
      options.contexts.push({ name: value.slice(0, separator), dir: value.slice(separator + 1) })
      index += 1
      continue
    }
    throw new PinError('KI17_PIN_ARGS_INVALID', `unknown argument ${flag}\n\n${usage()}`)
  }
  if (!options.manifest) throw new PinError('KI17_PIN_ARGS_INVALID', `--manifest is required\n\n${usage()}`)
  if (!options.contexts.length) throw new PinError('KI17_PIN_ARGS_INVALID', `at least one --context is required\n\n${usage()}`)
  return options
}

/** Follow a `.git` file's `gitdir:` pointer (worktrees and submodules use one). */
function resolveGitDir(contextDir) {
  const dotGit = path.join(contextDir, '.git')
  if (!existsSync(dotGit)) return null
  if (statSync(dotGit).isDirectory()) return dotGit
  const pointer = readFileSync(dotGit, 'utf8').trim()
  const match = /^gitdir:\s*(.+)$/.exec(pointer)
  if (!match) return null
  const target = match[1].trim()
  return path.isAbsolute(target) ? target : path.resolve(contextDir, target)
}

/** A worktree's gitdir keeps refs in the main repository, named by `commondir`. */
function commonGitDir(gitDir) {
  const commonFile = path.join(gitDir, 'commondir')
  if (!existsSync(commonFile)) return gitDir
  const target = readFileSync(commonFile, 'utf8').trim()
  return path.isAbsolute(target) ? target : path.resolve(gitDir, target)
}

function readRef(gitDir, ref) {
  for (const dir of new Set([gitDir, commonGitDir(gitDir)])) {
    const loose = path.join(dir, ...ref.split('/'))
    if (existsSync(loose) && statSync(loose).isFile()) {
      const value = readFileSync(loose, 'utf8').trim()
      if (SHA_PATTERN.test(value)) return value
      const indirect = /^ref:\s*(.+)$/.exec(value)
      if (indirect) return readRef(gitDir, indirect[1].trim())
    }
    const packed = path.join(dir, 'packed-refs')
    if (existsSync(packed)) {
      for (const line of readFileSync(packed, 'utf8').split('\n')) {
        if (!line || line.startsWith('#') || line.startsWith('^')) continue
        const [sha, name] = line.trim().split(/\s+/)
        if (name === ref && SHA_PATTERN.test(sha)) return sha
      }
    }
  }
  return null
}

export function resolveContextCommit(contextDir) {
  const gitDir = resolveGitDir(contextDir)
  if (gitDir && existsSync(path.join(gitDir, 'HEAD'))) {
    const head = readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim()
    if (SHA_PATTERN.test(head)) return { commit: head, provenance: 'git', detail: `${gitDir} (detached HEAD)` }
    const symbolic = /^ref:\s*(.+)$/.exec(head)
    if (symbolic) {
      const commit = readRef(gitDir, symbolic[1].trim())
      if (commit) return { commit, provenance: 'git', detail: `${gitDir} -> ${symbolic[1].trim()}` }
    }
  }
  const pinFile = path.join(contextDir, '.ki17-pin')
  if (existsSync(pinFile)) {
    const commit = readFileSync(pinFile, 'utf8').trim().toLowerCase()
    if (!SHA_PATTERN.test(commit)) throw new PinError('KI17_PIN_FILE_INVALID', `${pinFile} must hold one 40-character commit sha, found ${JSON.stringify(commit.slice(0, 80))}`)
    return { commit, provenance: 'attested', detail: pinFile }
  }
  throw new PinError('KI17_PIN_PROVENANCE_MISSING', [
    `build context ${contextDir} carries neither a .git directory nor a .ki17-pin file,`,
    'so the build cannot tell which commit it is about to bake into the image.',
    'Supply the context as a checkout at the pinned commit, or export it and attest the commit:',
    '  git -C <repo> archive <sha> | tar -x -C <export-dir>',
    '  git -C <repo> rev-parse <sha> > <export-dir>/.ki17-pin',
  ].join('\n  '))
}

export function verifyPins({ manifest, contexts, readManifest = (file) => JSON.parse(readFileSync(file, 'utf8')), resolve = resolveContextCommit, exists = existsSync }) {
  const pins = readManifest(manifest)
  const repositories = pins?.repositories
  if (!repositories || typeof repositories !== 'object') throw new PinError('KI17_PIN_MANIFEST_INVALID', `${manifest} has no "repositories" object`)

  const results = []
  const failures = []
  for (const { name, dir } of contexts) {
    const pin = repositories[name]
    if (!pin) {
      failures.push(`${name}: the manifest declares no repository by that name (have: ${Object.keys(repositories).join(', ')})`)
      continue
    }
    if (!SHA_PATTERN.test(String(pin.commit ?? ''))) {
      failures.push(`${name}: manifest commit ${JSON.stringify(pin.commit)} is not a 40-character sha`)
      continue
    }
    let resolved
    try {
      resolved = resolve(dir)
    } catch (error) {
      failures.push(`${name}: ${error.message}`)
      continue
    }
    if (resolved.commit !== pin.commit) {
      failures.push([
        `${name}: build context is NOT at the pinned commit.`,
        `    expected ${pin.commit} (${pins.cycle ?? 'pinned cycle'})`,
        `    actual   ${resolved.commit} (${resolved.provenance}: ${resolved.detail})`,
        `    repository ${pin.repository ?? name}`,
      ].join('\n'))
      continue
    }
    const missing = (pin.entrypoints ?? []).filter((relative) => !exists(path.join(dir, ...relative.split('/'))))
    if (missing.length) {
      failures.push(`${name}: at the pinned commit the context is missing ${missing.join(', ')} — the context is probably a partial copy`)
      continue
    }
    results.push({
      name,
      repository: pin.repository ?? null,
      commit: resolved.commit,
      provenance: resolved.provenance,
      contextDir: dir,
      entrypoints: pin.entrypoints ?? [],
      pendingArtifacts: (pin.pendingArtifacts ?? []).map((artifact) => artifact.path),
    })
  }

  if (failures.length) throw new PinError('KI17_PIN_MISMATCH', `\n  ${failures.join('\n  ')}\n`)
  return { manifest, cycle: pins.cycle ?? null, runtime: pins.runtime ?? null, verifiedAt: new Date().toISOString(), contexts: results }
}

function main(argv) {
  const options = parseArguments(argv)
  const receipt = verifyPins(options)
  for (const context of receipt.contexts) {
    const note = context.provenance === 'git' ? 'verified from git' : 'operator-attested via .ki17-pin'
    process.stdout.write(`ki17 pin ok  ${context.name.padEnd(13)} ${context.commit}  (${note})\n`)
    for (const pending of context.pendingArtifacts) {
      process.stdout.write(`ki17 pin note ${context.name.padEnd(12)} pending artifact at this pin: ${pending}\n`)
    }
  }
  if (options.out) {
    mkdirSync(path.dirname(options.out), { recursive: true })
    writeFileSync(options.out, `${JSON.stringify(receipt, null, 2)}\n`)
    process.stdout.write(`ki17 pin receipt written to ${options.out}\n`)
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
if (invokedDirectly) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`\n${error.message}\n\n`)
    process.exit(1)
  }
}
