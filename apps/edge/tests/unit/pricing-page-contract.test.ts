import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

/**
 * The calculator page is a client of the pricing service, not a second implementation of it.
 *
 * This file is the guard that keeps it that way. The page was once "ported line for line" from
 * the engine — and a port is a copy: it lost the factory-to-warehouse cost, then held it in the
 * wrong currency, and each fix had to be made twice. These assertions fail the moment a pricing
 * rule reappears in the browser.
 */
const page = fs.readFileSync('public/pricing.html', 'utf8');

describe('calculator page — thin client contract', () => {
  it('prices through the service and nothing else', () => {
    assert.ok(page.includes("apiFetch('/api/pricing/quote/adhoc'"), 'quotes must come from the service');
    assert.ok(page.includes('/api/pricing/catalog'), 'the rail must read the role-gated catalog endpoint');
    assert.ok(!/fetch\(\s*['"`]https?:\/\//.test(page), 'the page must stay same-origin');
  });

  it('carries no freight rate card, markup band or profit floor of its own', () => {
    // Field *names* from the service's response are fine to read (`rate.thbPerCbm`); what must
    // never come back is a rate card, a band or a floor declared here.
    for (const gone of [
      'GZ_TRUCK', 'YW_TRUCK', 'GZ_SEA',
      'MARKUP_BANDS', 'DEFAULT_MARKUP_BANDS',
      'SEA_THRESHOLD', 'DENSITY_SWITCH', 'MIN_CBM',
      'function landedFor', 'function freightFor', 'function resolveMode',
      'function logoCostThb', 'function leadTimeFor', 'function modeForDeadline',
      'roundUpTo', 'smallOrderFactorFor',
    ]) {
      assert.ok(!page.includes(gone), `pricing rule "${gone}" is back in the browser`);
    }
  });

  it('keeps no quantity ladder, discount factors or floor amounts as literals', () => {
    // The published ladder (1.00/0.90/0.85/0.80/0.77/0.75/0.73) and the floors (5,000/3,000 THB)
    // are policy. If they are in the page, the page is deciding prices again.
    assert.ok(!/factors\s*:\s*\[/.test(page), 'ladder factors must come from the service');
    assert.ok(!/maxQty\s*:\s*20\s*,\s*thb\s*:\s*5000/.test(page), 'profit floors must come from the service');
    assert.ok(!/0\.90\s*,\s*0\.85\s*,\s*0\.80/.test(page), 'the discount ladder must come from the service');
  });

  it('still owns what is genuinely the page: warnings read off the quote, and form defaults', () => {
    assert.ok(page.includes('function warningsFor'), 'derived warnings stay in the page');
    assert.ok(page.includes('function positionsForCode'), 'the screening-positions form default stays in the page');
  });

  it('never puts the owner key anywhere durable or shared', () => {
    assert.ok(page.includes('sessionStorage'), 'the key is held for the session only');
    assert.ok(!page.includes('localStorage.setItem'), 'the key must not outlive the session');
    assert.ok(!/[?&]key=/.test(page), 'the key must never travel in a URL');
  });
});
