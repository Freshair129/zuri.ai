const { test } = require('@playwright/test')

// @req NFR-008 — the suite must fail for the reason under test, not for how
// long Next.js took to compile a route it had never served.
// @tested tests/unit/e2e-warmup.test.js
//
// Next.js compiles a route in dev on its first request. `webServer.url` warms
// exactly one route (`/overview`); every other first navigation pays the compile
// cost inside a test, where `toHaveURL` allows 10s. Under load that is not
// enough, and the suite goes flaky on whichever route happened to be first —
// three different specs in one run, all with the same "Timed out waiting for
// toHaveURL" shape, none of them related to the change under test.
//
// The retry that used to hide this is now a build failure (--fail-on-flaky), so
// the config's own note applies: "If cold-compile flakes reappear, the fix is a
// warm-up step, not re-hiding them behind a silent retry."
//
// The list is literal rather than derived from `@/config/domains`: this file is
// CommonJS and that module pulls in ESM-only lucide-react. `tests/unit/e2e-warmup.test.js`
// compares the two, so the registry stays the source of truth and a new
// sub-domain fails there instead of becoming the next flake.
const ROUTES = [
  '/', '/login', '/businesses', '/overview', '/profile', '/workspaces',
  // @req FR-166 — Commerce has pages now: the dashboard and the orders console.
  '/commerce', '/commerce/orders', '/customer', '/customer/conversations',
  '/market',
  '/growth', '/growth/strategy', '/growth/campaigns', '/growth/campaigns/new', '/growth/campaigns/warmup',
  '/growth/content', '/growth/content/new', '/growth/content/briefs/warmup', '/growth/content/assets/warmup',
  '/growth/operations',
  '/operations',
  '/people', '/people/directory',
  '/projects', '/work', '/execution', '/timeline', '/dependencies', '/milestones', '/files', '/repositories',
  // A Project's own sub-routes are separate route files and none of them was
  // warmed, so whichever spec reached one first paid the compile inside a 10s
  // expect — the exact shape this file's header describes. The suite navigates
  // to seven of them; all are listed because the cost is one request each and
  // the next spec to add one should not have to rediscover this. The id is a
  // placeholder: `failOnStatusCode: false` below means the route module still
  // compiles when it resolves to nothing.
  '/projects/warmup/roadmap', '/projects/warmup/milestones', '/projects/warmup/dependencies',
  '/projects/warmup/files', '/projects/warmup/structure', '/projects/warmup/import',
  '/projects/warmup/inventory', '/projects/warmup/team', '/projects/warmup/board',
  '/projects/warmup/all-work', '/projects/warmup/timeline', '/projects/warmup/repositories',
  '/projects/warmup', '/projects/warmup/execution/DELIVERY', '/projects/new',
  '/assets', '/assets/receiving', '/assets/register', '/assets/scanner',
  // @req FR-146, FR-149, FR-151 — both LINE OA Studio pages exist now. This
  // comment used to say the slot had no page and `failOnStatusCode: false`
  // tolerated its 404; that stopped being true when the console landed.
  '/line-oa',
  '/line-oa/rich-menus',
  // main 2a1b6a81 gave LINE OA Studio a seven-entry sidebar without listing the
  // routes here; tests/unit/e2e-warmup.test.js compares this list to the registry.
  // main c41502b9 added the eighth, Integrations & AI, the same way.
  '/line-oa/projects', '/line-oa/design-studio', '/line-oa/live-crm', '/line-oa/edge-connection',
  '/line-oa/integrations', '/line-oa/templates', '/line-oa/team', '/line-oa/settings',
  // @req FR-154 — the Inventory dashboard.
  '/inventory',
  // @req FR-167 — the reserved Warehouse slot under SCM. It has no page yet, so
  // this request 404s and `failOnStatusCode: false` below tolerates it, exactly
  // as it does for the `operations` slot above.
  '/warehouse',
  // @req FR-161 — the CRM sales tasks page.
  '/customer/sales-tasks',
  // @req FR-164 — the Procurement dashboard and the purchase-orders console.
  '/procurement', '/procurement/purchase-orders',
  // Route handlers compile on first request too, and a spec that POSTs to a
  // cold one pays that cost inside its own expect. `marketing-content.spec.js`
  // opens a second browser context and immediately POSTs here to create a
  // reviewer; on CI that POST failed twice with `read ECONNRESET` — the dev
  // server dropping the socket while compiling — and passed on retry, which
  // `--fail-on-flaky` correctly refuses to call green. This route exports only
  // POST, so the warm-up's GET compiles the module and takes a 405 back;
  // `failOnStatusCode: false` below is what makes that fine.
  '/api/auth/signup',
  '/settings', '/platform/product-readiness', '/platform/product-readiness/crm',
  '/platform/users', '/platform/integrations', '/platform/customer-import-reviews', '/platform/sot-pipeline', '/audit', '/backup',
]

module.exports = { ROUTES }

test('warm every route the suite navigates to', async ({ request }) => {
  test.setTimeout(300000)
  const unique = [...new Set(ROUTES)]
  // Sequential on purpose: the dev server compiles one route at a time anyway,
  // and firing 25 parallel cold requests at it is slower and noisier than this.
  for (const route of unique) {
    await request.get(route, { timeout: 120000, failOnStatusCode: false })
  }
  console.log(`warmup: compiled ${unique.length} route(s)`)
})
