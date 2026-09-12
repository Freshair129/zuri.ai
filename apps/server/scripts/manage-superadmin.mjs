// @req FR-200 — explicit local grant/revoke for existing, unambiguous identities.
// @spec ADR-082, SEC-008, SEC-027
// @tested tests/integration/superadmin-access.test.js, tests/unit/manage-superadmin-cli.test.js
import { pathToFileURL } from 'node:url'
import prisma from '../src/lib/db.js'
import { grantSuperadmin, revokeSuperadmin } from '../src/modules/identity/superadmin-grant.js'

export function parseArgs(argv) {
  const [action, ...rest] = argv
  if (!['grant', 'revoke'].includes(action)) throw new Error('SUPERADMIN_ACTION_MUST_BE_GRANT_OR_REVOKE')
  const options = { action }
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]
    if (!['--email', '--actor-email', '--reason', '--expires-at'].includes(key)
      || !rest[i + 1] || rest[i + 1].startsWith('--') || options[key.slice(2)] !== undefined) {
      throw new Error('SUPERADMIN_CLI_INVALID_ARGUMENT')
    }
    options[key.slice(2)] = rest[i + 1].trim()
  }
  if (!options.email || !options['actor-email'] || !options.reason || (action === 'grant' && !options['expires-at'])) {
    throw new Error('SUPERADMIN_CLI_REQUIRES_EMAIL_ACTOR_REASON_AND_GRANT_EXPIRY')
  }
  return options
}

async function exactPerson(email, db) {
  // Do not select the first case-insensitive match: ambiguous identities deny.
  const rows = await db.person.findMany({ select: { id: true, email: true } })
  const matches = rows.filter((row) => row.email?.trim().toLowerCase() === email.toLowerCase())
  if (matches.length !== 1) throw new Error('SUPERADMIN_EMAIL_MISSING_OR_AMBIGUOUS')
  return matches[0].id
}

export async function main(argv = process.argv.slice(2), { db = prisma, log = console.log } = {}) {
  const options = parseArgs(argv)
  const personId = await exactPerson(options.email, db)
  const actorId = await exactPerson(options['actor-email'], db)
  const input = { personId, actorId, reason: options.reason, db, expiresAt: options['expires-at'] }
  const result = await (options.action === 'grant' ? grantSuperadmin(input) : revokeSuperadmin(input))
  log(JSON.stringify(result))
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Prisma diagnostics may contain connection details; emit only our codes.
    console.error(/^SUPERADMIN_[A-Z0-9_]+$/.test(error.message) ? error.message : 'SUPERADMIN_OPERATION_FAILED')
    process.exitCode = 1
  }).finally(() => prisma.$disconnect())
}
