import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { workspaceRoot } from './workspace-path.mjs'

export const DEFAULT_MODEL_SOURCE = 'apps/server/prisma/schema.prisma'

export function readDomainModelSource(appRoot, declaredSource) {
  const root = workspaceRoot(appRoot)
  const source = declaredSource || (root === appRoot ? 'prisma/schema.prisma' : DEFAULT_MODEL_SOURCE)
  if (path.isAbsolute(source) || source.includes('\\') || !/^[\w./-]+\.(?:prisma|sql)$/.test(source)) {
    throw new Error(`Invalid model_source: ${source}`)
  }
  const file = path.resolve(root, source)
  if (!file.startsWith(root + path.sep) || !existsSync(file) || !realpathSync(file).startsWith(realpathSync(root) + path.sep)) {
    throw new Error(`Missing or outside-workspace model_source: ${source}`)
  }
  const body = readFileSync(file, 'utf8')
  let models
  if (source.endsWith('.prisma')) {
    models = [...body.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1])
  } else {
    const sql = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\r\n]*/g, '')
    models = [...sql.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"?[\w]+"?)\.)?"?([a-z][\w]*)"?\s*\(/gi)]
      .map((match) => match[1].split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(''))
  }
  if (!models.length) throw new Error(`No models found in model_source: ${source}`)
  return { source, models: new Set(models) }
}
