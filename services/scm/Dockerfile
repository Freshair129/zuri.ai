# SCM service image. Built from the repository root with
#   docker build -f services/scm/Dockerfile .
# Dockerfile.dockerignore limits the context to this package: no apps/server source,
# Next build, Prisma client or .git can reach the image, and nothing is mounted at
# runtime. src/kernel/** is the committed generated mirror (scripts/sync-kernel.mjs),
# so the image never needs apps/server to build.
# Store: SCM_STORE=sqlite (node:sqlite, Node 22.13+, dev/test) or SCM_STORE=postgres
# with SCM_PG_URL (the `pg` driver in a worker thread). Dev dependencies (the
# disposable test PostgreSQL) are never installed here.
#
# Environment (config.js validates all of it before the process listens):
#   SCM_ENV      fails closed. This image sets NODE_ENV=production, so an unset
#                SCM_ENV means production: core auth only (SCM_AUTH_MODE=core with
#                SCM_API_TOKEN, SCM_CORE_TOKEN, SCM_CORE_URL = https or a
#                single-label service name), no self-migration. Outside this image
#                an unset SCM_ENV refuses to start. Set it explicitly only to run
#                the image as `test` in a disposable rehearsal.
#   SCM_CORE_SCOPE_CACHE_TTL_MS  success-only scope cache, default 15000, max 60000,
#                0 = off (a revoked session can act for up to this long).
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /opt/scm
COPY services/scm/package.json services/scm/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY services/scm/src ./src
COPY services/scm/contracts ./contracts
USER node
EXPOSE 3084
ENV SCM_HOST=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SCM_PORT||3084)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/main.js"]
