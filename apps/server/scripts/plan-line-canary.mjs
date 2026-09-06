#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createCanaryPreflightPlan } from '../src/modules/agent/canary-preflight.js'

// @req FR-054 — generate a local dry-run canary plan from operator-supplied evidence metadata.
// @spec BR-013, SDD-027, SEC-011 — this command has no activation or LINE-send capability.
// @tested tests/unit/line-canary-preflight.test.js

const args = process.argv.slice(2)
const valueAfter = (flag) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

if (args.includes('--help')) {
  console.log('Usage: node scripts/plan-line-canary.mjs --input <evidence.json> [--output <plan.json>]')
  console.log('Produces a DRY_RUN plan only. It does not update a binding or call LINE.')
  process.exit(0)
}

const inputPath = valueAfter('--input')
if (!inputPath) throw new Error('CANARY_PREFLIGHT_INPUT_REQUIRED')

const input = JSON.parse(readFileSync(resolve(inputPath), 'utf8'))
const plan = createCanaryPreflightPlan(input)
const serialized = `${JSON.stringify(plan, null, 2)}\n`
const outputPath = valueAfter('--output')

if (outputPath) {
  writeFileSync(resolve(outputPath), serialized, { encoding: 'utf8', flag: 'wx' })
  console.log(`Wrote DRY_RUN canary plan to ${outputPath}`)
} else {
  process.stdout.write(serialized)
}
