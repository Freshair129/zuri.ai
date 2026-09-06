import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { hasCodeChanges } from '../../../../scripts/ci-code-changes.mjs'
import { workspaceRoot } from '../../scripts/workspace-path.mjs'

describe('CI change classification', () => {
  it('skips only the explicit root documentation allowlist', () => {
    expect(hasCodeChanges('docs/a.md\n.brain/rca/example.md\nAGENTS.md\nCLAUDE.md\nREADME.md\n')).toBe(false)
    for (const file of ['apps/server/src/a.js', 'apps/edge/docs/a.md', 'unknown.md', 'README.md.js', 'scripts/new.mjs']) {
      expect(hasCodeChanges(file)).toBe(true)
    }
    expect(hasCodeChanges('')).toBe(true)
  })

  it('consumes a large mixed diff and reports code through the real CLI', () => {
    const paths = ['apps/server/src/first.js', ...Array.from({ length: 20000 }, (_, i) => `docs/synthetic-${i}.md`)]
    const run = spawnSync(process.execPath, [path.join(workspaceRoot(process.cwd()), 'scripts/ci-code-changes.mjs')], { input: paths.join('\n'), encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout.trim()).toBe('code=true')
  })
})
