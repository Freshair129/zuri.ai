// Contract for who a console-initiated push may reach.
//
// The command console took a recipient from the request body and pushed to it, reaching the
// group path by casting past `private` — so an arbitrary group id pasted into a request was a
// message sent to that group as the OA. `docs/LINE-REPLY-OWNERSHIP-DECISION.md` claimed "a send
// cannot reach an unintended recipient" as a control carried over from the retired BR-003; these
// tests are what make that claim true rather than aspirational.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolvePushTarget } from '../../src/line-poc/targets.js';

// @tested FR-008 — a push resolves against a configured alias; an unconfigured group id is refused.

const ALIASES = { leadership: 'C1234567890abcdef1234567890abcdef', team: 'Cfedcba0987654321fedcba0987654321' };
const USER = 'U1234567890abcdef1234567890abcdef';

describe('resolving a push target', () => {
  it('reaches a configured group by its alias', () => {
    assert.deepEqual(resolvePushTarget('leadership', ALIASES), {
      kind: 'group', id: ALIASES.leadership, alias: 'leadership',
    });
  });

  it('reaches a configured group by the id it points at, which is what the console sends', () => {
    assert.deepEqual(resolvePushTarget(ALIASES.team, ALIASES), {
      kind: 'group', id: ALIASES.team, alias: 'team',
    });
  });

  it('reaches a user by the id that arrived on a signed event', () => {
    assert.deepEqual(resolvePushTarget(USER, ALIASES), { kind: 'user', id: USER });
  });

  // The defect itself: a group id the owner never configured, pasted into a request body.
  it('refuses a group id that is not configured, however well-formed it looks', () => {
    assert.strictEqual(resolvePushTarget('Cffffffffffffffffffffffffffffffff', ALIASES), null);
  });

  it('refuses anything that is neither a user id nor a configured group', () => {
    for (const bad of ['', '   ', 'Rroom0000000000000000000000000000', 'not-an-id', 'U-too-short']) {
      assert.strictEqual(resolvePushTarget(bad, ALIASES), null, `accepted ${JSON.stringify(bad)}`);
    }
  });

  it('trims what it is given, so a stray space from a form field is not a refusal', () => {
    assert.deepEqual(resolvePushTarget('   leadership   ', ALIASES), {
      kind: 'group', id: ALIASES.leadership, alias: 'leadership',
    });
  });

  it('refuses everything when no groups are configured, rather than falling back', () => {
    assert.strictEqual(resolvePushTarget('leadership', {}), null);
    assert.strictEqual(resolvePushTarget(ALIASES.leadership, {}), null);
    // A user is still reachable: that id did not come from the caller's imagination.
    assert.deepEqual(resolvePushTarget(USER, {}), { kind: 'user', id: USER });
  });

  it('tolerates a missing alias map instead of throwing on a half-configured device', () => {
    assert.strictEqual(resolvePushTarget('leadership', undefined as never), null);
  });
});
