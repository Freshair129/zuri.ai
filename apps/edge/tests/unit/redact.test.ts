import { describe, it } from 'node:test';
import assert from 'node:assert';
import { redactString, isRawLineId } from '../../src/safety/redact.js';

// @tested NFR-001 — the CLI never prints a token value, raw PII or a hidden group id.
// @tested SEC-004 — secrets and credentials are redacted rather than logged.
// @tested SDD-008 — redaction, validation and error mapping.

describe('Redaction utility', () => {
  it('redacts bearer tokens, secrets, and passwords from a message', () => {
    const msg = 'auth failed: Bearer abc123.def-456 secret=topsecretvalue password="p@ss"';
    const redacted = redactString(msg);
    assert.ok(!redacted.includes('abc123.def-456'));
    assert.ok(!redacted.includes('topsecretvalue'));
    assert.ok(!redacted.includes('p@ss'));
    assert.ok(redacted.includes('[REDACTED]'));
  });

  it('identifies a raw LINE group ID', () => {
    assert.strictEqual(isRawLineId('C1234567890abcdef1234567890abcdef'), true);
  });

  it('identifies a raw LINE user ID', () => {
    assert.strictEqual(isRawLineId('U1234567890abcdef1234567890abcdef'), true);
  });

  it('does not flag an owner-configured alias as a raw LINE ID', () => {
    assert.strictEqual(isRawLineId('leadership'), false);
    assert.strictEqual(isRawLineId('sales-team-th'), false);
  });
});
