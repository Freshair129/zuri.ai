import path from 'node:path'
import { existsSync } from 'node:fs'

const rootByAppPath = new Map()

// Explicit dual roots: app runtime paths stay app-local; canonical governance stays at root.
// A flat fixture checkout keeps its original behavior (used by governance CLI regression tests).
export function workspaceRoot(appRoot) {
  if (rootByAppPath.has(appRoot)) return rootByAppPath.get(appRoot)
  const candidate = path.resolve(appRoot, '../..')
  const root = path.basename(appRoot) === 'server' && path.basename(path.dirname(appRoot)) === 'apps'
    && existsSync(path.join(candidate, 'monorepo.json')) ? candidate : appRoot
  rootByAppPath.set(appRoot, root)
  return root
}

export function workspacePath(appRoot, ...parts) {
  const relative = path.join(...parts)
  const first = relative.split(/[\\/]/)[0]
  const shared = ['docs', '.brain', '.github', 'AGENTS.md', 'CLAUDE.md', 'apps', 'services', 'plugins', 'artifacts', 'reference', 'reports', 'import-data'].includes(first)
  return path.join(shared ? workspaceRoot(appRoot) : appRoot, relative)
}

export function canonicalRelative(appRoot, file) {
  const shared = workspaceRoot(appRoot)
  const relative = path.relative(shared, file).split(path.sep).join('/')
  return shared !== appRoot && relative.startsWith('apps/server/')
    ? relative.slice('apps/server/'.length) : relative
}
