import prisma from '../src/lib/db.js'
import { listOperatorGrants } from '../src/modules/identity/operator-bootstrap.js'

// @req FR-107 — read-only CLI over the OPERATOR PlatformGrant store: lists
// grants (ACTIVE by default) so an operator can find a grant's id before
// revoking it with revoke-operator-grant.mjs. No credential material is ever
// read or printed — this is the grant row plus the holder's Person identity
// only.
// @spec FR-075, SEC-008
// @tested tests/unit/list-operator-grants-cli.test.js

const OPTIONS = new Set(['--status'])
const ALLOWED_STATUS = new Set(['ACTIVE', 'REVOKED', 'ALL'])

export function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!OPTIONS.has(token) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error('OPERATOR_LIST_CLI_USAGE — usage: list-operator-grants.mjs [--status ACTIVE|REVOKED|ALL]')
    }
    parsed[token.slice(2)] = argv[index + 1]
    index += 1
  }
  if (parsed.status && !ALLOWED_STATUS.has(parsed.status)) {
    throw new Error('OPERATOR_LIST_CLI_USAGE — usage: list-operator-grants.mjs [--status ACTIVE|REVOKED|ALL]')
  }
  return parsed
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const db = dependencies.db ?? prisma
  const log = dependencies.log ?? console.log
  const args = parseArgs(argv)

  const grants = await listOperatorGrants({ status: args.status ?? 'ACTIVE', db })
  log(JSON.stringify(grants, null, 2))
  return grants
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? 'OPERATOR_LIST_CLI_FAILED'}\n`)
    process.exitCode = 1
  })
}
