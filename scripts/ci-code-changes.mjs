import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const documentation = /^(docs\/|\.brain\/|AGENTS\.md$|CLAUDE\.md$|README\.md$)/

export function hasCodeChanges(text) {
  const paths = String(text).split(/\r?\n/).filter(Boolean)
  return paths.length === 0 || paths.some(file => !documentation.test(file))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Consume the complete pipe before returning; early exit would break pipefail callers.
  console.log(`code=${hasCodeChanges(readFileSync(0, 'utf8'))}`)
}
