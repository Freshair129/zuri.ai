import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { workspacePath, workspaceRoot } from '../../scripts/workspace-path.mjs'

test('dual-root lookup is stable for the lifetime of a process', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'workspace-path-'))
  try {
    const appRoot = path.join(root, 'apps', 'server')
    mkdirSync(appRoot, { recursive: true })
    writeFileSync(path.join(root, 'monorepo.json'), '{}')

    assert.equal(workspaceRoot(appRoot), root)
    assert.equal(workspacePath(appRoot, 'docs', 'README.md'), path.join(root, 'docs', 'README.md'))
    assert.equal(workspacePath(appRoot, 'src', 'index.js'), path.join(appRoot, 'src', 'index.js'))

    rmSync(path.join(root, 'monorepo.json'))
    assert.equal(workspaceRoot(appRoot), root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('flat application roots keep their application-local mapping', () => {
  const appRoot = mkdtempSync(path.join(os.tmpdir(), 'workspace-path-flat-'))
  try {
    assert.equal(workspaceRoot(appRoot), appRoot)
    assert.equal(workspacePath(appRoot, 'docs', 'README.md'), path.join(appRoot, 'docs', 'README.md'))
  } finally {
    rmSync(appRoot, { recursive: true, force: true })
  }
})
