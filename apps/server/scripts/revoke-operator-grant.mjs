import prisma from '../src/lib/db.js'
import { revokeOperatorGrant } from '../src/modules/identity/operator-bootstrap.js'

// @req FR-107 — the operator command that revokes an ACTIVE OPERATOR
// PlatformGrant. Once this commits, the session port's next resolution for
// that Person reads `platformGrant: false` — nothing is snapshotted
// (NFR-019 discipline). Refuses to revoke the LAST standing ACTIVE OPERATOR
// grant (it would lock the installation out, with no bootstrap left to run)
// unless --allow-last is explicitly passed. No credential material is ever
// read, written, or printed; only the grant row's lifecycle fields change.
// @spec FR-075, SEC-008, SEC-014
// @tested tests/unit/revoke-operator-grant-cli.test.js

const OPTIONS = new Set(['--id', '--reason'])
const FLAGS = new Map([['--allow-last', 'allowLast']])

export function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (FLAGS.has(token)) {
      parsed[FLAGS.get(token)] = true
      continue
    }
    if (!OPTIONS.has(token) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error('OPERATOR_REVOKE_CLI_USAGE — usage: revoke-operator-grant.mjs --id <grantId> [--reason <text>] [--allow-last]')
    }
    parsed[token.slice(2)] = argv[index + 1]
    index += 1
  }
  if (!parsed.id) {
    throw new Error('OPERATOR_REVOKE_CLI_REQUIRES_ID')
  }
  return parsed
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const db = dependencies.db ?? prisma
  const log = dependencies.log ?? console.log
  const args = parseArgs(argv)

  const result = await revokeOperatorGrant(args.id, {
    reason: args.reason ?? 'REVOKED_VIA_CLI',
    allowLast: args.allowLast === true,
    db,
  })

  log(JSON.stringify(result, null, 2))
  return result
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? 'OPERATOR_REVOKE_CLI_FAILED'}\n`)
    process.exitCode = 1
  })
}
