// parseArgs unit tests for scripts/eval-catalog-v4.ts (Wave-4 C). The script guards its main()
// invocation behind an entry-point check (`isMainModule`) precisely so this import is safe: it
// pulls in only the module's top-level function/const declarations, never runs main().
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs } from '../../scripts/eval-catalog-v4.js';

describe('eval-catalog-v4 parseArgs (Wave-4 C)', () => {
  it('bare invocation defaults to mode v4, gate ON, no alpha', () => {
    assert.deepEqual(parseArgs([]), { mode: 'v4', gate: true, genOfferSelf: false, alpha: null });
  });

  it('--no-gate disables the gate but leaves mode at the default v4', () => {
    assert.deepEqual(parseArgs(['--no-gate']), { mode: 'v4', gate: false, genOfferSelf: false, alpha: null });
  });

  it('--mode baseline-substring (existing form) still works', () => {
    assert.equal(parseArgs(['--mode', 'baseline-substring']).mode, 'baseline-substring');
    assert.equal(parseArgs(['--mode=baseline-substring']).mode, 'baseline-substring');
  });

  it('--baseline substring is accepted as an alias of --mode baseline-substring', () => {
    assert.equal(parseArgs(['--baseline', 'substring']).mode, 'baseline-substring');
  });

  it('--baseline=substring (single-token form) is also accepted', () => {
    assert.equal(parseArgs(['--baseline=substring']).mode, 'baseline-substring');
  });

  it('--baseline with an unrecognized value does not change the mode', () => {
    assert.equal(parseArgs(['--baseline', 'bogus']).mode, 'v4');
  });

  it('--gen-offer-self sets genOfferSelf', () => {
    assert.equal(parseArgs(['--gen-offer-self']).genOfferSelf, true);
  });

  it('--alpha <n> parses a numeric alpha', () => {
    assert.equal(parseArgs(['--alpha', '0.2']).alpha, 0.2);
  });

  it('--alpha=<n> (single-token form) also parses', () => {
    assert.equal(parseArgs(['--alpha=0.5']).alpha, 0.5);
  });

  it('--alpha 0 parses as 0, not null (falsy-but-present)', () => {
    assert.equal(parseArgs(['--alpha', '0']).alpha, 0);
  });

  it('combines --baseline substring, --no-gate and --alpha in one invocation', () => {
    assert.deepEqual(parseArgs(['--baseline', 'substring', '--no-gate', '--alpha', '0.2']), {
      mode: 'baseline-substring', gate: false, genOfferSelf: false, alpha: 0.2,
    });
  });
});
