// FR-189 / ADR-075 Phase 5 exit evidence: summarise the edge's local GenesisRAG17 shadow and primary
// records — comparisons, mismatches, shadow errors, primary answers, v4 fallbacks — by Bangkok day.
//
// Reads only the count-only JSONL records this device wrote; it opens no store and starts no MSP.
//
// Usage: npm run genesisrag17:report -- [--root state/genesisrag17] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
import { readRecords, summarizeRecords } from '../src/rag/genesisrag17/record-store.js';
import { RECORD_ROOT_ENV } from '../src/rag/genesisrag17/settings.js';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const since = flag('since');
const until = flag('until');
for (const [name, value] of [['since', since], ['until', until]] as const) {
  if (value !== undefined && !DAY.test(value)) {
    console.error(`--${name} must be YYYY-MM-DD`);
    process.exit(2);
  }
}
const root = flag('root') || process.env[RECORD_ROOT_ENV]?.trim() || 'state/genesisrag17';

console.log(JSON.stringify({ root, since: since ?? null, until: until ?? null, ...summarizeRecords(readRecords(root, { since, until })) }, null, 2));
