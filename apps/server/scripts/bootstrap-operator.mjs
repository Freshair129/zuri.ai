import prisma from '../src/lib/db.js'
import { bootstrapOperator } from '../src/modules/identity/operator-bootstrap.js'

// @req FR-107 — the one-off command that creates the installation's FIRST
// operator: Person + credential + ACTIVE OPERATOR PlatformGrant, in one
// transaction. Prints the initial password exactly once, to stdout only —
// never logged, never written anywhere this script controls. Refuses to run
// while any ACTIVE OPERATOR grant exists; later grants are issued by an
// operator, not by this script. --grant-only issues just the grant + audit to
// an existing Person (their credential, if any, is never touched) — for the
// empty-operator-set installation whose first operator already set a password
// through the FR-104 reset flow.
// @spec FR-075, SEC-008, SEC-014
// @tested tests/unit/bootstrap-operator-cli.test.js

const OPTIONS = new Set(['--email', '--name'])
const FLAGS = new Map([['--grant-only', 'grantOnly']])

export function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (FLAGS.has(token)) {
      parsed[FLAGS.get(token)] = true
      continue
    }
    if (!OPTIONS.has(token) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error('OPERATOR_BOOTSTRAP_CLI_USAGE — usage: bootstrap-operator.mjs --email <email> --name <display name> | --email <email> --grant-only')
    }
    parsed[token.slice(2)] = argv[index + 1]
    index += 1
  }
  if (!parsed.email || (!parsed.name && !parsed.grantOnly)) {
    throw new Error('OPERATOR_BOOTSTRAP_CLI_REQUIRES_EMAIL_AND_NAME')
  }
  return parsed
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const db = dependencies.db ?? prisma
  const log = dependencies.log ?? console.log
  const args = parseArgs(argv)

  const bootstrapped = await bootstrapOperator({ email: args.email, displayName: args.name, grantOnly: args.grantOnly === true, db })
  const output = {
    personId: bootstrapped.personId,
    personCode: bootstrapped.personCode,
    displayName: bootstrapped.displayName,
    grantId: bootstrapped.grantId,
  }
  if ('initialPassword' in bootstrapped) {
    // Shown exactly once. Change it after first login; nothing but its scrypt
    // hash is stored, so this line is the only copy that will ever exist.
    // Absent entirely in --grant-only mode: no credential was touched.
    output.initialPassword = bootstrapped.initialPassword
  }
  log(JSON.stringify(output, null, 2))
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? 'OPERATOR_BOOTSTRAP_CLI_FAILED'}\n`)
    process.exitCode = 1
  })
}
