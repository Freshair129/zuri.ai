#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { queryTestsFor, runDocumentQuery } from './document-query.mjs'

const usage = 'node tools/tests-for.mjs <ZAI:ID|ID>... [--root <repo-root>] [--graph <file>] [--json]'

function formatText(reports) {
  return reports.map(report => {
    const { target } = report
    if (!target.declarationVerified) return `${target.namespace} namespace (${target.namespaceDisposition})\n  No current ZAI verification evidence queried.`
    const lines = [`${target.namespace}:${target.id} (${target.family})`]
    if (report.requirements.length) lines.push(`  Requirements: ${report.requirements.join(', ')}`)
    for (const binding of report.bindings) {
      lines.push(`  ${binding.exists ? 'BOUND' : 'MISSING'} ${binding.path || binding.testNode} → ${binding.requirement}${binding.app ? ` [${binding.app}]` : ''}`)
    }
    if (!report.bindings.length) lines.push('  No current graph test bindings.')
    for (const group of report.commands) lines.push(`  Run (${group.app}/${group.runner}): ${group.command}`)
    lines.push(`  ${report.note}`)
    return lines.join('\n')
  }).join('\n\n')
}

function main() {
  return runDocumentQuery({ args: process.argv.slice(2), toolPath: import.meta.url, usage, query: queryTestsFor, formatText })
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main()
