# SCM service image. Built from the repository root with
#   docker build -f services/scm/Dockerfile .
# Dockerfile.dockerignore limits the context to this package: no apps/server source,
# Next build, Prisma client or .git can reach the image, and nothing is mounted at
# runtime. src/kernel/** is the committed generated mirror (scripts/sync-kernel.mjs),
# so the image never needs apps/server to build.
# node:sqlite is stable enough on Node 22.13+ for the dev/test store; PostgreSQL is
# an outstanding adapter gate.
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
