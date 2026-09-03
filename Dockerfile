# syntax=docker/dockerfile:1.7
# zuri-ai — production image for the one Next.js app (UI + API + LINE webhook seam).
#
# Stages (ADR-058):
#   base    → Node 22 on Debian slim + OpenSSL (Prisma's query engine needs it)
#   deps    → deterministic `npm ci`, then BOTH Prisma clients generated for Linux
#   builder → `next build` with standalone output (NEXT_OUTPUT=standalone, next.config.js)
#   tools   → deps + source, no build: the Prisma CLI and repo scripts for one-shot jobs
#             (`prisma db push` against the bundled Postgres, `bootstrap-operator.mjs`)
#   runner  → the shipped image: standalone server, static assets, non-root, health-checked
#
# Nothing secret is baked in: no .env is copied (.dockerignore), every credential
# arrives through the environment at run time (docker-compose.yml → env_file).
# Node 22 matches .github/workflows/governance.yml; Prisma 5.22 does not list Node 24.

ARG NODE_VERSION=22

# ---------------------------------------------------------------- base
FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------- deps
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts/generate-prisma-clients.mjs scripts/gen-postgres-schema.mjs ./scripts/
# --ignore-scripts: the repo's own postinstall is run explicitly on the next line so
# the SQLite and Postgres clients are generated for THIS platform (linux-openssl-3.0.x),
# and no third-party install hook runs inside the image.
RUN npm ci --ignore-scripts \
 && node scripts/generate-prisma-clients.mjs

# ---------------------------------------------------------------- builder
FROM deps AS builder
COPY . .
ENV NODE_ENV=production
ENV NEXT_OUTPUT=standalone
# `next build` is allowed to run without a database URL: src/lib/db.js exempts the
# build phase (NEXT_PHASE=phase-production-build) from the production Postgres gate.
RUN npm run build

# ---------------------------------------------------------------- tools
# One-shot jobs that need the Prisma CLI or the repo's scripts, never the web server.
FROM deps AS tools
COPY . .
ENV NODE_ENV=production
CMD ["node", "node_modules/prisma/build/index.js", "db", "push", "--schema", "prisma/schema.postgres.prisma", "--skip-generate"]

# ---------------------------------------------------------------- runner
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Supabase's CA bundle is public and tracked in git; shipping it lets
# ZURI_LINE_DB_CA_FILE / ZURI_CUSTOMER_REVIEW_DB_CA_FILE point at a path that exists
# inside the container (docker-compose.yml sets both).
COPY --from=builder --chown=node:node /app/certs ./certs
# src/modules/integration/application/sot-plan.js reads contracts/sot-pipeline-plan.v1.json
# from process.cwd() at request time, so the tracer cannot see it — ship the folder.
COPY --from=builder --chown=node:node /app/contracts ./contracts
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
# FR-142 — `GET /api/health` runs one trivial query against the configured database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
