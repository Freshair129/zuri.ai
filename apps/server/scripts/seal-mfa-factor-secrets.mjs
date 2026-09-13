#!/usr/bin/env node
// @req FR-094, FR-095 — the operator command that seals MFA factor secrets at rest.
// @spec SEC-029, SDD-096, ADR-088 D4
// @tested tests/unit/identity/seal-mfa-factor-secrets-cli.test.js
//
// Brings every `MfaFactor.secret` to the current seal: plaintext base32 rows
// written before SEC-029, and rows sealed under a key version being rotated out.
// Run it after the deployment that carries SEC-029 (or a key rotation) is live,
// with the same ZURI_MFA_SECRET_KEY* environment as the web container.
//
//   node scripts/seal-mfa-factor-secrets.mjs            # report only; exit 1 while work remains
//   node scripts/seal-mfa-factor-secrets.mjs --write    # reseal; exit 1 if any row could not be
//
// Read-only by default, like every other backfill here: a migration you have not
// read the report of is one you cannot review. The report names factor and Person
// ids and states only — no secret, sealed or not, is ever printed.

import { pathToFileURL } from 'node:url'
import { resealMfaFactorSecrets } from '../src/modules/identity/mfa-secret-reseal.js'

export function parseArgs(argv) {
  const unknown = argv.filter(arg => arg !== '--write')
  if (unknown.length) throw new Error(`MFA_SECRET_SEAL_CLI_OPTION_FORBIDDEN — unexpected ${unknown[0]} (usage: [--write])`)
  return { write: argv.includes('--write') }
}

/** Exit code for a report: 0 only when nothing is left for a human or a rerun to do. */
export function exitCodeFor(report) {
  if (report.unreadable.length || report.changedConcurrently.length) return 1
  return report.write ? 0 : (report.pending.length ? 1 : 0)
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const log = dependencies.log ?? console.log
  const { write } = parseArgs(argv)
  const report = await resealMfaFactorSecrets({ write, db: dependencies.db, env: dependencies.env })
  log(JSON.stringify(report, null, 2))
  return { report, exitCode: exitCodeFor(report) }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .then(({ exitCode }) => { process.exitCode = exitCode })
    .catch((error) => {
      console.error(error?.code ?? error?.message ?? 'MFA_SECRET_SEAL_FAILED')
      process.exitCode = 1
    })
}
