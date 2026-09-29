#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { queryImpact, runDocumentQuery } from './document-query.mjs'

const usage = 'node tools/impact.mjs <ZAI:ID|ID>... [--root <repo-root>] [--graph <file>] [--json]'

function formatEdges(title, edges) {
  const lines = [`  ${title} (${edges.length})`]
  for (const edge of edges) {
    const other = edge.direction === 'outbound' ? edge.to : edge.from
    lines.push(`    ${edge.type} ${edge.direction} ${other.id}${edge.via ? ` via ${edge.via}` : ''}${edge.status ? ` [${edge.status}]` : ''}`)
  }
  return lines
}

function formatText(reports) {
  return reports.map(report => {
    const { target } = report
    if (!target.declarationVerified) return `${target.namespace} namespace (${target.namespaceDisposition})\n  No current ZAI graph evidence queried.`
    const lines = [`${target.namespace}:${target.id} (${target.family})`, ...formatEdges('Evidence', report.evidence),
      ...formatEdges('Dependencies', report.dependencies), ...formatEdges('Other typed relations', report.typedRelations),
      ...formatEdges('Navigation only: relates', report.navigationOnly), ...formatEdges('Weak references', report.weakReferences),
      `  Review set (${report.reviewSet.length}): ${report.reviewSet.map(node => node.id).join(', ') || '—'}`,
      `  ${report.note}`]
    return lines.join('\n')
  }).join('\n\n')
}

function main() {
  return runDocumentQuery({ args: process.argv.slice(2), toolPath: import.meta.url, usage, query: queryImpact, formatText })
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main()
