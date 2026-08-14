#!/usr/bin/env node

import { readFile as nodeReadFile } from 'node:fs/promises'
import pg from 'pg'
import { createLineBindingActivationService } from '../src/modules/agent/line-binding-activation.js'
import { parseLineCanaryReceipt } from '../src/modules/agent/line-activation-contract.js'

// @req FR-055 — provide a dry-run-default operator command for one controlled LINE binding.
// @spec NFR-013, BR-014, SDD-028, SEC-012 — dedicated DB role, environment-only secrets and redacted output.
// @tested tests/unit/line-binding-activation-cli.test.js

const allowedOptions = new Set(['--input', '--canary-plan', '--golden-report', '--isolation-report'])

export function parseArgs(argv) {
  const [operation, ...rest] = argv
  if (!['activate', 'rollback'].includes(operation)) throw new Error('LINE_ACTIVATION_CLI_OPERATION_INVALID')
  const parsed = { operation, apply: false }
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (token === '--apply') {
      parsed.apply = true
      continue
    }
    if (!allowedOptions.has(token) || !rest[index + 1] || rest[index + 1].startsWith('--')) {
      throw new Error('LINE_ACTIVATION_CLI_OPTION_FORBIDDEN')
    }
    parsed[token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = rest[index + 1]
    index += 1
  }
  for (const field of ['input', 'canaryPlan', 'goldenReport', 'isolationReport']) {
    if (!parsed[field]) throw new Error('LINE_ACTIVATION_CLI_ARTIFACT_REQUIRED')
  }
  return parsed
}

export function validateOperatorDatabaseUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('LINE_ACTIVATION_DATABASE_URL_INVALID') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.username !== 'zuri_line_activation_login') {
    throw new Error('LINE_ACTIVATION_DATABASE_ROLE_FORBIDDEN')
  }
  return value
}

function activationSecrets(env) {
  const values = {
    destination: env.ZURI_LINE_BINDING_DESTINATION,
    bearer: env.ZURI_LINE_BINDING_BEARER,
    pepper: env.ZURI_LINE_BINDING_PEPPER,
  }
  if (!values.destination || !values.bearer || !values.pepper) throw new Error('LINE_ACTIVATION_SECRETS_REQUIRED')
  return values
}

function projectOperatorResult(result) {
  if (!result || typeof result !== 'object') throw new Error('LINE_ACTIVATION_RESULT_INVALID')
  if (result.dryRun === true) {
    return { dryRun: true, preview: parseLineCanaryReceipt(result.preview) }
  }
  if (result.dryRun === false) {
    return { dryRun: false, receipt: parseLineCanaryReceipt(result.receipt) }
  }
  throw new Error('LINE_ACTIVATION_RESULT_INVALID')
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const env = dependencies.env ?? process.env
  if (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('LINE_ACTIVATION_PRIVILEGED_CREDENTIAL_FORBIDDEN')
  }
  const args = parseArgs(argv)
  const databaseUrl = validateOperatorDatabaseUrl(env.ZURI_LINE_ACTIVATION_DB_URL)
  const readFile = dependencies.readFile ?? nodeReadFile
  const input = JSON.parse(await readFile(args.input, 'utf8'))
  if (args.apply && input.mode !== 'APPLY') throw new Error('LINE_ACTIVATION_APPLY_CONTRACT_REQUIRED')
  if (!args.apply && input.mode === 'APPLY') throw new Error('LINE_ACTIVATION_APPLY_FLAG_REQUIRED')

  const createPool = dependencies.createPool ?? ((options) => new pg.Pool(options))
  const pool = createPool({ connectionString: databaseUrl, max: 1, ssl: { rejectUnauthorized: true } })
  const createService = dependencies.createService ?? createLineBindingActivationService
  const service = createService({ connect: () => pool.connect() })
  try {
    const request = {
      input,
      evidencePaths: {
        canaryPlan: args.canaryPlan,
        goldenReport: args.goldenReport,
        isolationReport: args.isolationReport,
      },
      ...(args.operation === 'activate' && args.apply ? { secrets: activationSecrets(env) } : {}),
    }
    const result = await service[args.operation](request)
    const projected = projectOperatorResult(result)
    const serialized = JSON.stringify(projected)
    ;(dependencies.log ?? console.log)(serialized)
    return projected
  } finally {
    await pool.end?.()
  }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message?.startsWith('LINE_') ? error.message : 'LINE_ACTIVATION_FAILED'}\n`)
    process.exitCode = 1
  })
}
