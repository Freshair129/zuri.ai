// Contract for the config surface's authentication.
//
// This exists because the surface had none. `GET /api/config` returned the LINE channel token and
// the device token to any caller, and `POST /api/command/dispatch` sent a message as the OA to any
// recipient named in the body — and for a period both were published to the public internet by a
// Tailscale Funnel configured for the whole port instead of the one path LINE posts to. The
// properties pinned here are the ones that make reaching the port insufficient.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateAdminKey,
  hashAdminKey,
  keyMatches,
  createAdminSessions,
  readCookie,
  sessionCookie,
  isAuthorized,
  SESSION_COOKIE,
  ADMIN_KEY_PREFIX,
} from '../../src/history/admin-auth.js';

// @tested BR-009 — the operator key gates the configuration surface, and an unset key closes it.

const req = (headers: Record<string, string> = {}) => ({ headers }) as never;

describe('admin key', () => {
  it('mints a key with enough entropy to be worth hashing rather than rate-limiting', () => {
    const key = generateAdminKey();
    assert.ok(key.startsWith(`${ADMIN_KEY_PREFIX}_`));
    // 24 random bytes in base64url.
    assert.ok(key.length - ADMIN_KEY_PREFIX.length - 1 >= 32, key);
    assert.notStrictEqual(generateAdminKey(), key);
  });

  it('never stores the key in a form that can be presented back', () => {
    const key = generateAdminKey();
    const hash = hashAdminKey(key);
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.ok(!hash.includes(key.slice(5)));
  });

  it('accepts the right key and rejects a wrong one, tolerating surrounding whitespace', () => {
    const key = generateAdminKey();
    const hash = hashAdminKey(key);
    assert.ok(keyMatches(key, hash));
    assert.ok(keyMatches(`  ${key}\n`, hash));
    assert.ok(!keyMatches(`${key}x`, hash));
    assert.ok(!keyMatches(generateAdminKey(), hash));
  });

  it('refuses an empty candidate and an unset hash rather than treating either as a match', () => {
    const hash = hashAdminKey(generateAdminKey());
    assert.ok(!keyMatches('', hash));
    assert.ok(!keyMatches('   ', hash));
    assert.ok(!keyMatches('anything', ''));
    assert.ok(!keyMatches('anything', '   '));
  });
});

describe('admin sessions', () => {
  it('issues a token that verifies, and refuses one it never issued', () => {
    const s = createAdminSessions();
    const token = s.issue();
    assert.ok(s.verify(token));
    assert.ok(!s.verify('made-up'));
    assert.ok(!s.verify(undefined));
  });

  it('expires on an absolute clock, so a session nobody logs out of still ends', () => {
    const s = createAdminSessions(1000);
    const token = s.issue(0);
    assert.ok(s.verify(token, 999));
    assert.ok(!s.verify(token, 1000));
    // Repeated use does not extend it.
    const t2 = createAdminSessions(1000);
    const b = t2.issue(0);
    t2.verify(b, 500);
    assert.ok(!t2.verify(b, 1000), 'use must not slide the window');
  });

  it('forgets an expired token instead of accumulating it', () => {
    const s = createAdminSessions(1000);
    s.issue(0);
    assert.strictEqual(s.size(0), 1);
    s.issue(2000);
    assert.strictEqual(s.size(2000), 1, 'the expired token was swept, not kept alongside the new one');
  });

  it('revokes on request, so signing out actually signs out', () => {
    const s = createAdminSessions();
    const token = s.issue();
    s.revoke(token);
    assert.ok(!s.verify(token));
  });
});

describe('cookie handling', () => {
  it('finds its own cookie among others and ignores a prefix collision', () => {
    const header = `other=1; ${SESSION_COOKIE}_not=nope; ${SESSION_COOKIE}=wanted; trailing=2`;
    assert.strictEqual(readCookie(header, SESSION_COOKIE), 'wanted');
  });

  it('returns nothing for an absent header or an absent cookie', () => {
    assert.strictEqual(readCookie(undefined, SESSION_COOKIE), undefined);
    assert.strictEqual(readCookie('a=1; b=2', SESSION_COOKIE), undefined);
    assert.strictEqual(readCookie(`${SESSION_COOKIE}=`, SESSION_COOKIE), undefined);
  });

  it('sets the cookie so script cannot read it and another site cannot send it', () => {
    const header = sessionCookie('abc', 3600_000);
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Strict/);
    assert.match(header, /Path=\//);
    assert.match(header, /Max-Age=3600\b/);
  });
});

describe('authorization', () => {
  const key = generateAdminKey();
  const keyHash = hashAdminKey(key);

  it('admits a valid session cookie', () => {
    const sessions = createAdminSessions();
    const token = sessions.issue();
    assert.ok(isAuthorized(req({ cookie: `${SESSION_COOKIE}=${token}` }), { keyHash, sessions }));
  });

  it('admits the key as a bearer, so the surface is drivable without a cookie jar', () => {
    const sessions = createAdminSessions();
    assert.ok(isAuthorized(req({ authorization: `Bearer ${key}` }), { keyHash, sessions }));
    assert.ok(!isAuthorized(req({ authorization: `Bearer ${generateAdminKey()}` }), { keyHash, sessions }));
  });

  it('refuses a request carrying nothing', () => {
    const sessions = createAdminSessions();
    assert.ok(!isAuthorized(req(), { keyHash, sessions }));
  });

  // The failure mode this guards is the one that has bitten real products: an appliance shipped
  // before anyone set a password, where "no password configured" reads as "no password required".
  it('stays closed when no key is configured, rather than open', () => {
    const sessions = createAdminSessions();
    const token = sessions.issue();
    assert.ok(!isAuthorized(req({ cookie: `${SESSION_COOKIE}=${token}` }), { keyHash: '', sessions }));
    assert.ok(!isAuthorized(req({ authorization: 'Bearer anything' }), { keyHash: '   ', sessions }));
  });

  it('does not accept a session issued by a different device', () => {
    const mine = createAdminSessions();
    const theirs = createAdminSessions();
    const token = theirs.issue();
    assert.ok(!isAuthorized(req({ cookie: `${SESSION_COOKIE}=${token}` }), { keyHash, sessions: mine }));
  });
});
