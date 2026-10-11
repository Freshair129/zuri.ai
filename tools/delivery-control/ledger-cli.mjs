import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLedger, openLedger } from './ledger.mjs';

const ALLOWED_OPERATIONS = new Set([
  'create', 'open', 'admit', 'transition', 'bindCanonicalPr', 'park',
  'pendingOutbox', 'applyOutboxEvent', 'status', 'history', 'health',
]);
const ALLOWED_KEYS = new Set(['operation', 'stateRoot', 'ledgerId', 'expectedLedgerId', 'expectedPrefixAnchor', 'input']);

function parseInput(bytes) {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('CLI input must be one JSON object.');
  }
  for (const key of Object.keys(value)) if (!ALLOWED_KEYS.has(key)) throw new Error(`Unknown CLI input field: ${key}`);
  if (!ALLOWED_OPERATIONS.has(value.operation)) throw new Error('operation must be a supported ledger operation.');
  if (typeof value.stateRoot !== 'string' || !value.stateRoot.trim()) throw new Error('stateRoot is required.');
  return value;
}

async function execute(input) {
  if (input.operation === 'create') {
    const result = await createLedger({ stateRoot: input.stateRoot, ledgerId: input.ledgerId });
    if (result.ledger) result.ledger.close();
    return { ok: result.ok, code: result.code, anchor: result.anchor ?? null, durableWritePerformed: result.durableWritePerformed, details: result.details ?? undefined, reason: result.reason ?? undefined, persistence: result.persistence ?? undefined, path: result.path ?? undefined };
  }
  if (typeof input.expectedLedgerId !== 'string' || !input.expectedLedgerId.trim() || !input.expectedPrefixAnchor) {
    return { ok: false, code: 'CALLER_INPUT_REQUIRED', message: 'Reopen requires expectedLedgerId and expectedPrefixAnchor.' , durableWritePerformed: false };
  }
  const opened = await openLedger({
    stateRoot: input.stateRoot,
    ledgerId: input.ledgerId,
    expectedLedgerId: input.expectedLedgerId,
    expectedPrefixAnchor: input.expectedPrefixAnchor,
  });
  if (!opened.ok) return opened;
  const ledger = opened.ledger;
  try {
    if (input.operation === 'open') return { ok: true, code: 'OPENED', anchor: opened.anchor, durableWritePerformed: false };
    const args = input.input ?? {};
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('input must be a JSON object.');
    if (input.operation === 'health') {
      return ledger.health({ ...args, expectedPrefixAnchor: args.expectedPrefixAnchor ?? input.expectedPrefixAnchor });
    }
    return ledger[input.operation](args);
  } finally {
    ledger.close();
  }
}

async function main() {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) {
    process.stderr.write('Usage: node tools/delivery-control/ledger-cli.mjs <request.json>\n');
    return 64;
  }
  try {
    const input = parseInput(fs.readFileSync(path.resolve(file)));
    const result = await execute(input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result?.ok ? 0 : 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, code: 'CLI_ERROR', message: String(error?.message ?? error), durableWritePerformed: false }, null, 2)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}