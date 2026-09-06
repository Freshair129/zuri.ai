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
  '/commerce', '/customer', '/customer/conversations',
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
  // @req FR-154 — the Inventory dashboard.
  '/inventory',
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
