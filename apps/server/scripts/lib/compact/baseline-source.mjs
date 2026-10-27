// @spec ADR-115 — bind a generated schema baseline to the selected committed source tree.
// @tested tests/node/compact-baseline.test.mjs
import { execFileSync } from 'node:child_process'
import { CompactError } from './manifest.mjs'

// Package metadata is source-bound here; the installed Prisma executable is a separate runtime input.
const BASELINE_SOURCE_PATHS = Object.freeze([
  'package.json',
  'package-lock.json',
  'prisma/schema.prisma',
  'scripts/compact-baseline.mjs',
  'scripts/lib/compact',
  'supabase/migrations'
])

export function assertCompactBaselineSourceIntegrity({ root, sourceRevision } = {}) {
  if (typeof root !== 'string' || !/^[a-f0-9]{40}$/.test(sourceRevision)) throw new CompactError('COMPACT_SOURCE_REVISION_MISMATCH')
  const git = args => execFileSync('git', ['--no-optional-locks', ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trimEnd()

  try {
    if (git(['rev-parse', '--verify', 'HEAD^{commit}']) !== sourceRevision) throw new CompactError('COMPACT_SOURCE_REVISION_MISMATCH')
    try {
      git(['diff', '--quiet', 'HEAD', '--', ...BASELINE_SOURCE_PATHS])
    } catch {
      throw new CompactError('COMPACT_SOURCE_REVISION_MISMATCH')
    }
    if (git(['ls-files', '--others', '--exclude-standard', '--', ...BASELINE_SOURCE_PATHS])) throw new CompactError('COMPACT_SOURCE_REVISION_MISMATCH')
  } catch (error) {
    if (error instanceof CompactError) throw error
    throw new CompactError('COMPACT_SOURCE_REVISION_MISMATCH')
  }
}
