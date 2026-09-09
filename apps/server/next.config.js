/** @type {import('next').NextConfig} */

// ADR-058 — the Docker image (Dockerfile, builder stage) builds with
// NEXT_OUTPUT=standalone so the runner ships `.next/standalone` + static assets
// instead of the whole node_modules tree. Local `npm run build` / `next start`
// stay exactly as before: standalone output is opt-in, never the default.
const standalone = process.env.NEXT_OUTPUT === 'standalone'

const nextConfig = {
  reactStrictMode: true,
  ...(standalone ? { output: 'standalone' } : {}),
  // @req NFR-008 — `next dev`'s on-demand-entries cache disposes a compiled
  // route after 60s of inactivity (Next's own default: maxInactiveAge, plus a
  // 5-route pagesBufferLength — see node_modules/next/dist/*/server/config-shared.js).
  // `tests/e2e/warmup.setup.js` compiles every route once, up front, on the
  // premise that "no test is the one that pays for a cold compile" — but a
  // route not revisited within that 60s window quietly falls back out of the
  // compiled cache and pays the cold-compile cost again at whatever moment a
  // test finally does touch it. In the full suite `/audit` is warmed only
  // once, anonymously, before any other spec runs, and is not visited again
  // (authenticated) until `navigation-reachability.spec.js`'s Platform search
  // case — minutes later, with dozens of other routes compiled in between —
  // so the default cache silently discards it before that test ever runs.
  // Extending the retention here keeps every route warm for the life of a
  // suite run (or an ordinary local dev session); it only affects `next dev`
  // and has no effect on `next build`/`next start`.
  onDemandEntries: {
    maxInactiveAge: 60 * 60 * 1000,
    // The app has 88 page routes today (tests/e2e/warmup-routes.js derives the
    // real count from src/app); this comfortably covers all of them
    // plus headroom, so nothing gets evicted purely for exceeding the buffer.
    pagesBufferLength: 200,
  },
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ['@zuri/prisma-postgres'],
    ...(standalone
      ? {
          // Both generated Prisma clients carry a native query engine the file
          // tracer cannot always follow (the Postgres one is an external package
          // resolved at run time). Copy them explicitly into the standalone tree.
          outputFileTracingIncludes: {
            '/**': ['./node_modules/.prisma/client/**', './node_modules/@zuri/prisma-postgres/**'],
          },
        }
      : {}),
  },
}

module.exports = nextConfig
