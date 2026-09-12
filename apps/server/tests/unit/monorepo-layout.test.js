import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { workspacePath, workspaceRoot } from '../../scripts/workspace-path.mjs'

// The third case here drove `monorepo-graph.mjs` end to end — rescan, scoped
// identity, rejection of a removed declaration and of stale output. It is gone
// with the script (ADR-081 D4), which the ADR argues at length rather than
// deleting quietly. What replaced its coverage is not another test but a
// change of kind: `doc-graph.mjs` scans `apps/edge` live, so Edge content is
// proven by being read, not by being re-verified against a six-day-old manifest.

describe('monorepo relocation', () => {
  it('separates canonical docs from app sources without changing flat fixture roots', () => {
    const app = process.cwd()
    expect(workspacePath(app, 'docs/PRD-SDD-v1.0.md')).toBe(path.join(workspaceRoot(app), 'docs/PRD-SDD-v1.0.md'))
    expect(workspacePath(app, 'src/app')).toBe(path.join(app, 'src/app'))
    expect(workspaceRoot(os.tmpdir())).toBe(os.tmpdir())
  })

  it('ships the canonical readiness projection unchanged inside the app build context', () => {
    const read = p => JSON.parse(fs.readFileSync(p, 'utf8'))
    const canonical = read(workspacePath(process.cwd(), 'docs/.domain-state.json'))
    const shipped = read(path.join(process.cwd(), 'runtime/domain-state.json'))
    expect(shipped).toEqual(canonical)
  })

})
