/** @type {import('next').NextConfig} */

// ADR-058 — the Docker image (Dockerfile, builder stage) builds with
// NEXT_OUTPUT=standalone so the runner ships `.next/standalone` + static assets
// instead of the whole node_modules tree. Local `npm run build` / `next start`
// stay exactly as before: standalone output is opt-in, never the default.
const standalone = process.env.NEXT_OUTPUT === 'standalone'

const nextConfig = {
  reactStrictMode: true,
  ...(standalone ? { output: 'standalone' } : {}),
  experimental: {
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
