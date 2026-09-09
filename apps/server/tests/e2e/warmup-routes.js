const { readdirSync } = require('node:fs')
const path = require('node:path')

// @req NFR-008 — the suite must fail for the reason under test, not for how
// long Next.js took to compile a module it had never served.
// @tested tests/unit/e2e-warmup.test.js
//
// Two lists feed the e2e warm-up, and they answer different questions.
//
// `ROUTES` is the hand-written list of URLs the suite navigates to. It stays
// for the notes attached to its entries — each records which spec flaked, in
// what shape, and why that entry closes it — and because it is the seam
// `tests/unit/e2e-warmup.test.js` holds against the domain registry.
//
// `discoverRoutes()` is the list nobody maintains. On 2026-09-07 the hand
// list warmed 80 URLs against 88 pages and 199 route handlers in `src/app`,
// and every e2e flake in three consecutive CI runs of the same commit
// (34106105030 and its reruns) was the first request to a handler module the
// list did not name: `/api/projects/[id]/tree` behind fr040's WBS tree — the
// very first spec after warm-up — the Inventory catalogue POSTs behind
// fr154, `/api/growth/campaigns/[id]` behind the campaign-closure case,
// `/api/scope` and `/api/crm/conversations` behind fr091. Each was added by
// hand after it flaked — four such commits landed that day — and the next
// route to be added would have been the next one to flake. The filesystem
// already knows every module, so the list is derived from it: a route is
// warm from the commit that adds it, not from the commit after it flakes.
//
// How a path on disk becomes a URL, mirroring the App Router's own rules:
//   `(group)`                    → dropped, a route group is not a URL segment
//   `[id]`, `[...rest]`, `[[...rest]]` → `warmup`, a placeholder the module
//                                  still compiles for (it resolves to nothing,
//                                  and the warm-up never fails on status)
//   `@slot`, `_private`          → skipped with everything under them; neither
//                                  is reachable by path
//
// Why discovered handlers are warmed with OPTIONS, not GET. Next auto-
// implements OPTIONS for any route module that does not export it
// (node_modules/next/dist/server/future/route-modules/app-route/helpers/
// auto-implement-methods.js): it has to load — so compile — the module to
// build the `Allow` header, and it runs no userland function. Measured on
// 2026-09-07 against `next dev` in this tree: `OPTIONS
// /api/inventory/products/warmup` logged "Compiling /api/inventory/products/
// [id] … 819ms" and answered 204; the GET that followed answered in 40ms with
// no recompile. A GET would instead execute 113 read handlers anonymously —
// a 401 for most, but a few mint or record on GET, and the warm-up must never
// be the thing that wrote to the database. The hand-listed `/api/*` entries
// keep GET because that is what their notes were measured with; the unit test
// pins both choices.
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
  // @req FR-146, FR-149, FR-151 — LINE OA Studio's sub-navigation moved into
  // a left sidebar and grew from two pages to the full set the domain
  // registry (src/config/domains.js) now declares; tests/unit/e2e-warmup.test.js
  // fails the moment this list falls behind that registry again.
  '/line-oa',
  '/line-oa/projects',
  '/line-oa/design-studio',
  '/line-oa/rich-menus',
  '/line-oa/live-crm',
  '/line-oa/edge-connection',
  '/line-oa/integrations',
  '/line-oa/templates',
  '/line-oa/team',
  '/line-oa/settings',
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
  // Same shape, found the same way: fr091's "CRM Dashboard reconciles with the
  // list" reads both of these through `page.request.get` inside its own
  // assertion, and on CI the first one died with `read ECONNRESET` — the dev
  // server dropping the socket while it compiled the handler — then passed on
  // retry, which `--fail-on-flaky` refuses to call green (run 34101244617).
  // Both export GET, so the warm-up's GET compiles them for real.
  '/api/scope', '/api/crm/conversations',
  // Same class as /api/auth/signup just above: marketing-campaigns.spec.js
  // and marketing-content.spec.js each POST to one of these on their very
  // first navigation of the run, paying a cold route-handler compile inside
  // the fixed 10s expect (or the 60s test timeout on a bad day) and flaking
  // on CI while never reproducing locally. Warming the pages under
  // /growth/campaigns and /growth/content above compiles the page
  // components, not these separate API route-handler modules.
  '/api/growth/campaigns',
  '/api/growth/content',
  '/api/growth/content/briefs/warmup',
  '/api/growth/content/references',
  '/settings', '/platform/product-readiness', '/platform/product-readiness/crm',
  '/platform/users', '/platform/integrations', '/platform/customer-import-reviews', '/platform/sot-pipeline', '/audit', '/backup',
]

const APP_DIR = path.resolve(__dirname, '..', '..', 'src', 'app')
const PLACEHOLDER = 'warmup'
const PAGE_FILES = new Set(['page.js', 'page.jsx', 'page.ts', 'page.tsx'])
const HANDLER_FILES = new Set(['route.js', 'route.ts'])

/** A directory name as the App Router would put it in a URL, or null for none. */
function toUrlSegment(name) {
  if (name.startsWith('(') && name.endsWith(')')) return null
  if (name.startsWith('[')) return PLACEHOLDER
  return name
}

/**
 * Every page and route-handler module under `appDir`, as the URL that makes
 * `next dev` compile it. Sorted, so the warm-up order is stable between runs.
 *
 * @param {string} [appDir]
 * @returns {{ pages: string[], handlers: string[] }}
 */
function discoverRoutes(appDir = APP_DIR) {
  const pages = new Set()
  const handlers = new Set()
  const walk = (absolute, segments) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('@') || entry.name.startsWith('_')) continue
        const segment = toUrlSegment(entry.name)
        walk(path.join(absolute, entry.name), segment === null ? segments : [...segments, segment])
      } else if (PAGE_FILES.has(entry.name)) {
        pages.add(`/${segments.join('/')}`)
      } else if (HANDLER_FILES.has(entry.name)) {
        handlers.add(`/${segments.join('/')}`)
      }
    }
  }
  walk(appDir, [])
  return { pages: [...pages].sort(), handlers: [...handlers].sort() }
}

/**
 * The requests the warm-up sends, in order: the hand list first (GET, as its
 * notes were measured), then every discovered page not already listed (GET),
 * then every discovered handler not already listed (OPTIONS). One entry per
 * URL.
 *
 * @param {string} [appDir]
 * @returns {Array<{ url: string, method: 'GET' | 'OPTIONS' }>}
 */
function warmupPlan(appDir = APP_DIR) {
  const seen = new Set()
  const plan = []
  const add = (url, method) => {
    if (seen.has(url)) return
    seen.add(url)
    plan.push({ url, method })
  }
  for (const url of ROUTES) add(url, 'GET')
  const { pages, handlers } = discoverRoutes(appDir)
  for (const url of pages) add(url, 'GET')
  for (const url of handlers) add(url, 'OPTIONS')
  return plan
}

module.exports = { ROUTES, discoverRoutes, warmupPlan, toUrlSegment, PLACEHOLDER, APP_DIR }
