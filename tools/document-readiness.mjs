#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { queryReadiness, runDocumentQuery } from './document-query.mjs'

const usage = 'node tools/document-readiness.mjs <ZAI:ID|ID>... [--root <repo-root>] [--graph <file>] [--json]'

function formatText(reports) {
  return reports.map(report => {
    const { target } = report
    if (!target.declarationVerified) return `${target.namespace} namespace (${target.namespaceDisposition})\n  Completeness not assessed as current ZAI evidence.`
    const completeness = Object.entries(report.completeness).map(([key, value]) => `${key}=${value}`).join(' · ')
    const lines = [`${target.namespace}:${target.id} (${target.family})`, `  Completeness: ${completeness}`]
    for (const requirement of report.requirements) {
      lines.push(`  ${requirement.id}: code=${requirement.codeBindings.length}, tests=${requirement.testBindings.length}, graph=${requirement.graphNode ? requirement.graphStatus : 'missing'}`)
    }
    lines.push(`  ${report.note}`)
    return lines.join('\n')
  }).join('\n\n')
}

function main() {
  return runDocumentQuery({ args: process.argv.slice(2), toolPath: import.meta.url, usage, query: queryReadiness, formatText })
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main()
