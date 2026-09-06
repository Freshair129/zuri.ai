import prisma from '../src/lib/db.js'
import { mintApiAccessKey, revokeApiAccessKey } from '../src/modules/identity/api-access-auth.js'

// @req FR-106 — the operator command that mints/revokes an Enterprise API
// access key. Prints the raw secret exactly once, to stdout only — never
// logged, never written to a file this script controls. The integrator's own
// secret storage is the caller's responsibility from that point on. The
// service requires an authorized viewer, so this script passes the
// installation-operator capability the person at the machine already holds
// (the ADR-016 local premise, same as FR-105's reading of FR-075); Tenant
// owners mint through the authenticated route instead.
// @spec SEC-006, ADR-047
// @tested tests/unit/mint-api-access-key-cli.test.js

const MINT_OPTIONS = new Set(['--label', '--tenant'])
const REVOKE_OPTIONS = new Set(['--id', '--reason'])

// The person at the machine — see the module note. Never exported.
const OPERATOR_VIEWER = { isOperator: true, principal: null }

export function parseArgs(argv) {
  const [operation, ...rest] = argv
  if (!['mint', 'revoke'].includes(operation)) {
    throw new Error('API_ACCESS_KEY_CLI_OPERATION_INVALID — usage: mint --label <name> --tenant <tenantId> | revoke --id <keyId> [--reason <text>]')
  }
  const allowed = operation === 'mint' ? MINT_OPTIONS : REVOKE_OPTIONS
  const parsed = { operation }
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!allowed.has(token) || !rest[index + 1] || rest[index + 1].startsWith('--')) {
      throw new Error(`API_ACCESS_KEY_CLI_OPTION_FORBIDDEN — unexpected ${token}`)
    }
    parsed[token.slice(2)] = rest[index + 1]
    index += 1
  }
  if (operation === 'mint' && (!parsed.label || !parsed.tenant)) {
    throw new Error('API_ACCESS_KEY_CLI_MINT_REQUIRES_LABEL_AND_TENANT')
  }
  if (operation === 'revoke' && !parsed.id) {
    throw new Error('API_ACCESS_KEY_CLI_REVOKE_REQUIRES_ID')
  }
  return parsed
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const db = dependencies.db ?? prisma
  const log = dependencies.log ?? console.log
  const args = parseArgs(argv)

  if (args.operation === 'mint') {
    const minted = await mintApiAccessKey({ label: args.label, tenantId: args.tenant, viewer: OPERATOR_VIEWER, db })
    log(JSON.stringify({
      id: minted.id,
      label: minted.label,
      tenantId: minted.tenantId,
      key: minted.key,
      warning: 'This is the only time the raw key is shown. Store it in the integrator\'s own secret storage now.',
    }))
    return minted
  }

  const revoked = await revokeApiAccessKey(args.id, { reason: args.reason ?? 'REVOKED_VIA_CLI', viewer: OPERATOR_VIEWER, db })
  log(JSON.stringify(revoked))
  return revoked
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message?.startsWith('API_ACCESS_KEY_') ? error.message : 'API_ACCESS_KEY_CLI_FAILED'}\n`)
    process.exitCode = 1
  })
}
