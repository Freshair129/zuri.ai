#!/usr/bin/env node
// Runs inside the overlay build (deploy/ki17/overlay/Dockerfile). The overlay carries
// KI17_FROM's /opt/ki17 forward verbatim, so it must be the stdio production tuple
// that deploy/ki17/pins.json pins — not merely "not labelled gks-http". A receipt
// written before manifests carried a `profile` has no label at all, so the check is
// by commit: every repository the manifest verifies in the build must appear in the
// receipt at exactly the pinned commit. Missing, extra-profile or different → fail.
//
//   node check-ki17-from.mjs <stdio-pins.json> <resolved.json>
//
// Node built-ins only; runs on the runner image's own Node.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function checkKi17FromReceipt(receipt, manifest) {
  const failures = []
  if (manifest?.profile !== 'stdio') failures.push(`the reference manifest must be the stdio manifest, got profile ${JSON.stringify(manifest?.profile ?? null)}`)
  if (receipt?.profile != null && receipt.profile !== 'stdio') failures.push(`KI17_FROM receipt profile is ${JSON.stringify(receipt.profile)}, not "stdio"`)
  const contexts = Array.isArray(receipt?.contexts) ? receipt.contexts : []
  if (!contexts.length) failures.push('KI17_FROM receipt lists no verified contexts')
  const pinned = Object.entries(manifest?.repositories ?? {}).filter(([, pin]) => pin.verifiedInBuild)
  if (!pinned.length) failures.push('the reference manifest pins no repository verified in the build')
  for (const [name, pin] of pinned) {
    const found = contexts.find((context) => context?.name === name)
    if (!found) failures.push(`${name}: absent from the KI17_FROM receipt (expected ${pin.commit})`)
    else if (found.commit !== pin.commit) failures.push(`${name}: KI17_FROM carries ${found.commit ?? '(no commit)'}, the stdio manifest pins ${pin.commit}`)
  }
  return failures
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const [manifestFile, receiptFile] = process.argv.slice(2)
  let failures
  try {
    failures = checkKi17FromReceipt(JSON.parse(readFileSync(receiptFile, 'utf8')), JSON.parse(readFileSync(manifestFile, 'utf8')))
  } catch (error) {
    failures = [`cannot read ${manifestFile} / ${receiptFile}: ${error.message}`]
  }
  if (failures.length) {
    process.stderr.write(`KI17_OVERLAY_TUPLE_MISMATCH: KI17_FROM's /opt/ki17 is not the stdio production tuple\n  ${failures.join('\n  ')}\n`)
    process.exit(1)
  }
  process.stdout.write('ki17 overlay: KI17_FROM carries the stdio production tuple\n')
}
