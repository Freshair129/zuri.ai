import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { workspacePath, workspaceRoot } from '../../scripts/workspace-path.mjs'

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

  it('rescans content, preserves scoped identities, rejects removed declarations and stale output', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-monorepo-graph-'))
    const write = (name, text) => {
      const file = path.join(root, name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text))
    }
    try {
      write('monorepo.json', {})
      for (const name of ['workspace-path.mjs', 'monorepo-graph.mjs', 'doc-links.mjs']) {
        write(`apps/server/scripts/${name}`, fs.readFileSync(path.join(process.cwd(), 'scripts', name), 'utf8'))
      }
      write('apps/server/contracts/doc-link-metadata.schema.json', fs.readFileSync(path.join(process.cwd(), 'contracts/doc-link-metadata.schema.json'), 'utf8'))
      fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(root, 'apps/server/node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
      write('docs/.doc-graph.json', { nodes: [{ id: 'req:AC-001', type: 'requirement' }], edges: [] })
      const doc = 'docs/REQUIREMENTS.md'
      const code = 'src/example.ts'
      write(`apps/edge/${doc}`, '# Requirements\nAC-001: synthetic acceptance criterion\n')
      write(`apps/edge/${code}`, '// @req AC-001\nexport const example = true\n')
      write('apps/edge/docs/.doc-graph.json', {
        nodes: [
          { id: `doc:${doc}`, type: 'document', path: doc },
          { id: 'req:AC-001', type: 'requirement', path: `${doc}#AC-001` },
          { id: `code:${code}`, type: 'code_file', path: code },
        ],
        edges: [
          { from: `doc:${doc}`, to: 'req:AC-001', type: 'defines' },
          { from: `code:${code}`, to: 'req:AC-001', type: 'implements' },
        ],
      })
      write('docs/migrations/monorepo/source-manifest.json', { server_commit: 'synthetic', edge_commit: 'synthetic', edge: [doc, code].map(source_path => ({ source_path, target_path: `apps/edge/${source_path}` })) })
      const run = (...args) => spawnSync(process.execPath, [path.join(root, 'apps/server/scripts/monorepo-graph.mjs'), ...args], { encoding: 'utf8' })
      expect(run().status).toBe(0)
      const graph = JSON.parse(fs.readFileSync(path.join(root, 'docs/.monorepo-graph.json'), 'utf8'))
      expect(graph.nodes.map(n => n.id)).toContain('edge::req:AC-001')
      expect(graph.nodes.map(n => n.id)).toContain('req:AC-001')
      expect(run('--check').status).toBe(0)
      write(`apps/edge/${code}`, '// @req AC-001\nexport const example = false\n')
      expect(run('--check').status).toBe(1)
      write(`apps/edge/${doc}`, '# Empty document\n')
      expect(run().stderr).toContain('Missing requirement declaration')
    } finally {
      // Exact mkdtemp allocation; no user checkout or runtime path is removed.
      fs.rmSync(path.join(root, 'apps/server/node_modules'), { recursive: true, force: true })
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
