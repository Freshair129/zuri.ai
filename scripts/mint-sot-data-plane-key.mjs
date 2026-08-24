import prisma from '../src/lib/db.js'
import { mintSotDataPlaneKey, revokeSotDataPlaneKey } from '../src/modules/identity/sot-data-plane-auth.js'

// @req FR-102 — the one-off operator command that mints/revokes a SoT
// data-plane key. Prints the raw secret exactly once, to stdout only — never
// logged, never written to a file this script controls. The connector's own
// secret storage is the caller's responsibility from that point on.
// @spec SEC-019
// @tested tests/unit/mint-sot-data-plane-key-cli.test.js

const MINT_OPTIONS = new Set(['--label', '--tenant'])
const REVOKE_OPTIONS = new Set(['--id', '--reason'])

export function parseArgs(argv) {
  const [operation, ...rest] = argv
  if (!['mint', 'revoke'].includes(operation)) {
    throw new Error('SOT_DATA_PLANE_CLI_OPERATION_INVALID — usage: mint --label <name> --tenant <tenantId> | revoke --id <keyId> [--reason <text>]')
  }
  const allowed = operation === 'mint' ? MINT_OPTIONS : REVOKE_OPTIONS
  const parsed = { operation }
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!allowed.has(token) || !rest[index + 1] || rest[index + 1].startsWith('--')) {
      throw new Error(`SOT_DATA_PLANE_CLI_OPTION_FORBIDDEN — unexpected ${token}`)
    }
    parsed[token.slice(2)] = rest[index + 1]
    index += 1
  }
  if (operation === 'mint' && (!parsed.label || !parsed.tenant)) {
    throw new Error('SOT_DATA_PLANE_CLI_MINT_REQUIRES_LABEL_AND_TENANT')
  }
  if (operation === 'revoke' && !parsed.id) {
    throw new Error('SOT_DATA_PLANE_CLI_REVOKE_REQUIRES_ID')
  }
  return parsed
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const db = dependencies.db ?? prisma
  const log = dependencies.log ?? console.log
  const args = parseArgs(argv)

  if (args.operation === 'mint') {
    const minted = await mintSotDataPlaneKey({ label: args.label, tenantId: args.tenant, db })
    log(JSON.stringify({
      id: minted.id,
      label: minted.label,
      tenantId: minted.tenantId,
      key: minted.key,
      warning: 'This is the only time the raw key is shown. Store it in the connector\'s own secret storage now.',
    }))
    return minted
  }

  const revoked = await revokeSotDataPlaneKey(args.id, { reason: args.reason ?? 'REVOKED_VIA_CLI', db })
  log(JSON.stringify({ id: args.id, revoked }))
  return { id: args.id, revoked }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message?.startsWith('SOT_DATA_PLANE_') ? error.message : 'SOT_DATA_PLANE_CLI_FAILED'}\n`)
    process.exitCode = 1
  })
}
