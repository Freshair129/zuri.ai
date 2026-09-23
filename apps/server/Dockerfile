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
# ADR-075 Phase 3 (P-3) adds the optional `ki17` family. Those stages are inert for
# every build that does not name them — `docker compose build web` still builds
# `runner` exactly as before, and needs none of their build contexts:
#
#   ki17-node    → a Node 24.18.x linux-x64 runtime, SHA-256-verified against the
#                  official SHASUMS256.txt. Used ONLY by the MSP/GKS/worker child
#                  processes; Next.js stays on Node 22 (Prisma 5.22 does not list 24)
#   ki17-pins    → the pin gate: every supplied build context's HEAD must equal
#                  deploy/ki17/pins.json, or the build stops here
#   ki17         → /opt/ki17/{node,msp,gks} — MSP and GKS at their pins with
#                  `npm ci` run INSIDE Linux, so better-sqlite3 gets a Linux binding
#   ki17-venv    → /opt/ki17/venv — Python 3.12 from the worker's requirements.txt
#   ki17-fixtures→ /opt/ki17/fixtures — the SmartGift benchmark fixture (P-6)
#   runner-ki17  → the web image for the knowledge deployment: `runner` plus
#                  /opt/ki17/{node,msp,gks} and the P-5 operator smoke script
#   gks-http     → dedicated pinned GKS HTTP service image; no MSP or Tier 1 app
#   genesis-worker → the Tier 4 sidecar: the above plus the GenesisBlock worker,
#                  its linux-x64-gnu addon and the Python venv
#   ki17-acceptance→ TEST ONLY (gate G-3). genesis-worker's /opt/ki17 plus this
#                  app's source and devDependencies, so `npm run test:genesisrag17`
#                  runs against the Linux binaries this design ships. Never
#                  referenced by docker-compose.yml, by CI, or by any shipped image
#
# Nothing secret is baked in: no .env is copied (.dockerignore), every credential
# arrives through the environment at run time (docker-compose.yml → env_file).
# Node 22 matches .github/workflows/governance.yml; Prisma 5.22 does not list Node 24.

ARG NODE_VERSION=22
# ADR-075 Phase 3 / C9, C10: the runtime the Phase 2 acceptance ran MSP, GKS and the
# worker on. `engines` in the worker package is `>=24.18`. Bumping this is a change to
# what G-2/G-3 certified, so it belongs in pins.json and in an acceptance re-run.
ARG KI17_NODE_VERSION=24.18.0
ARG KI17_PYTHON_IMAGE=python:3.12-slim-bookworm

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
# The supervisor and everything it imports. Listed file by file on purpose — the runtime
# image ships only what the worker actually needs — and that makes a new local import a
# *runtime* crash rather than a build error: `worker-cadence.mjs` was split out of the
# supervisor for testability, this line was not updated, and the deployed container died
# with ERR_MODULE_NOT_FOUND on every restart while the build, the tests and CI all stayed
# green. tests/unit/server-line-worker-cadence.test.js now fails if an import listed in
# the supervisor is missing here.
COPY --from=builder --chown=node:node /app/scripts/server-line-worker.mjs /app/scripts/worker-cadence.mjs ./scripts/
# FR-230 — the single-shot nightly retention sweep worker (invoked via
# `docker compose exec web node scripts/server-retention-sweep-worker.mjs` by
# the host scheduler, not by an always-on container) and the testable core it
# imports. Same reasoning as the line-worker pair above: listed file by file,
# and tests/unit/server-retention-sweep-worker-script.test.js fails if an
# import the script names is missing from this line.
COPY --from=builder --chown=node:node /app/scripts/server-retention-sweep-worker.mjs /app/scripts/retention-sweep-worker-run.mjs ./scripts/
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

# =============================================================================
# ki17 — ADR-075 Phase 3 (P-3). docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md
#
# EVERY STAGE BELOW IS OPT-IN. `runner` above is untouched and still the image the
# live `web` service builds; BuildKit prunes any stage the requested --target does
# not depend on, so `docker compose build web` neither needs nor loads the msp,
# gks or genesisblock build contexts. `runner` is no longer the LAST stage in this
# file, so a bare `docker build .` with no --target would now build the last stage,
# `ki17-acceptance`: always pass --target. Nothing in this repository does a bare
# build (docker-compose.yml and .github/workflows/docker-image.yml both name
# `target: runner`).
#
#   docker buildx build --target runner-ki17 -t zuri-ai-web-ki17:<tag> \
#     --build-context msp=<Memory-and-Soul-Passport checkout at the pin> \
#     --build-context gks=<Genesis-Knowledge-System checkout at the pin> \
#     apps/server
#
#   docker buildx build --target genesis-worker -t zuri-ai-genesis-worker:<tag> \
#     --build-context msp=... --build-context gks=... \
#     --build-context genesisblock=<GenesisBlock checkout at the pin> \
#     apps/server
#
#   docker buildx build --target ki17-acceptance -t ki17-acceptance:<tag> \
#     --build-context msp=... --build-context gks=... \
#     --build-context genesisblock=... --build-context ki17-tests=apps/server/tests \
#     apps/server
#
# See deploy/ki17/README.md for the full operator recipe.
# =============================================================================

# The three source repositories arrive as BuildKit additional build contexts, which
# override a stage of the same name. Declaring them as empty `scratch` stages means
# the Dockerfile parses and `--target runner` builds with no contexts at all; a ki17
# target built WITHOUT them fails at the pin gate below rather than baking nothing.
FROM scratch AS msp
FROM scratch AS gks
FROM scratch AS genesisblock
# G-3 only. `.dockerignore` excludes `tests/` from the main context, and it must keep
# doing so — every shipped image is smaller for it, and widening the main context
# would change what `runner` builds from. The acceptance suite therefore arrives as a
# fourth named context (`--build-context ki17-tests=apps/server/tests`), which carries
# its own ignore rules and touches no production build path.
FROM scratch AS ki17-tests

# ---------------------------------------------------------------- ki17-node
# C9/C10: Node 24.18.x for the MSP, GKS and worker children only. The tarball's
# SHA-256 is checked against nodejs.org's own SHASUMS256.txt before anything is
# extracted — an unverified runtime is not a runtime this deployment will run.
FROM base AS ki17-node
ARG KI17_NODE_VERSION
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl xz-utils \
 && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    arch="$(dpkg --print-architecture)"; \
    if [ "$arch" != "amd64" ]; then \
      echo "KI17_ARCH_UNSUPPORTED: the pinned worker addon is x86_64-unknown-linux-gnu, this builder is $arch" >&2; exit 1; \
    fi; \
    tarball="node-v${KI17_NODE_VERSION}-linux-x64.tar.xz"; \
    dist="https://nodejs.org/dist/v${KI17_NODE_VERSION}"; \
    cd /tmp; \
    curl -fsSL --retry 3 -o "$tarball" "$dist/$tarball"; \
    curl -fsSL --retry 3 -o SHASUMS256.txt "$dist/SHASUMS256.txt"; \
    awk -v want="$tarball" '$2 == want { print; found = 1 } END { exit found ? 0 : 1 }' SHASUMS256.txt > SHASUMS256.wanted \
      || { echo "KI17_NODE_SHASUM_ABSENT: $tarball is not listed in $dist/SHASUMS256.txt" >&2; exit 1; }; \
    sha256sum -c SHASUMS256.wanted \
      || { echo "KI17_NODE_SHASUM_MISMATCH: $tarball does not match the official SHASUMS256.txt digest" >&2; exit 1; }; \
    mkdir -p /opt/ki17/node; \
    tar -xJf "$tarball" -C /opt/ki17/node --strip-components=1; \
    rm -f "$tarball" SHASUMS256.txt SHASUMS256.wanted
# Entrypoint assertion 1 of 5 (the runtime every ZURI_MSP_COMMAND / MSP_GKS_COMMAND /
# GENESIS_WORKER_MSP_COMMAND in §7 names).
RUN set -eu; \
    test -x /opt/ki17/node/bin/node || { echo "KI17_NODE_BINARY_MISSING: /opt/ki17/node/bin/node" >&2; exit 1; }; \
    test -x /opt/ki17/node/bin/npm  || { echo "KI17_NPM_BINARY_MISSING: /opt/ki17/node/bin/npm" >&2; exit 1; }; \
    actual="$(/opt/ki17/node/bin/node -v)"; \
    test "$actual" = "v${KI17_NODE_VERSION}" || { echo "KI17_NODE_VERSION_MISMATCH: extracted $actual, expected v${KI17_NODE_VERSION}" >&2; exit 1; }

# ---------------------------------------------------------------- ki17-pins
# Gate G-4. Runs before anything is installed, so a context at the wrong revision
# costs one COPY rather than a full build. The receipt it writes travels into both
# shipped images, so `docker run ... cat /opt/ki17/pins/resolved.json` answers
# "which four commits is this image?" without archaeology (§10 step 7).
FROM base AS ki17-pins
COPY deploy/ki17/pins.json deploy/ki17/verify-ki17-pins.mjs /opt/ki17/pins/
COPY --from=msp / /ki17-ctx/msp/
COPY --from=gks / /ki17-ctx/gks/
COPY --from=genesisblock / /ki17-ctx/genesisblock/
RUN node /opt/ki17/pins/verify-ki17-pins.mjs \
      --manifest /opt/ki17/pins/pins.json \
      --context msp=/ki17-ctx/msp \
      --context gks=/ki17-ctx/gks \
      --context genesisblock=/ki17-ctx/genesisblock \
      --out /opt/ki17/pins/resolved.json \
 && rm -rf /ki17-ctx

# ---------------------------------------------------------------- ki17
# /opt/ki17/{node,msp,gks}: what BOTH shipped images share. `npm ci` runs here, on
# Linux, with the Node 24 runtime on PATH, so better-sqlite3 resolves a Linux
# binding for this ABI (C8). A Windows node_modules must never reach this image,
# so any that arrived in a context is deleted before the install rather than after.
FROM ki17-node AS ki17
ENV PATH=/opt/ki17/node/bin:$PATH
# better-sqlite3 falls back to compiling from source when no prebuild matches the
# ABI; without these that fallback fails and the image silently ships no binding.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
# First, so the pin gate is what fails when a context is wrong.
COPY --from=ki17-pins /opt/ki17/pins /opt/ki17/pins
COPY --from=msp / /opt/ki17/msp/
COPY --from=gks / /opt/ki17/gks/
RUN set -eu; \
    rm -rf /opt/ki17/msp/.git /opt/ki17/gks/.git; \
    find /opt/ki17/msp /opt/ki17/gks -mindepth 1 -maxdepth 6 -type d -name node_modules -prune -exec rm -rf {} +
RUN cd /opt/ki17/msp && npm ci --omit=dev
RUN cd /opt/ki17/gks && npm ci --omit=dev
# C8: both repositories moved to better-sqlite3 ^13 for the Node 24 addon abort
# (GKS PR #9). Proving the binding loads HERE is the difference between a build
# failure and a container that dies on its first pipeline call.
RUN set -eu; \
    for root in /opt/ki17/msp /opt/ki17/gks; do \
      cd "$root"; \
      node -e "const D=require('better-sqlite3');const db=new D(':memory:');db.exec('create table t(a)');db.close();console.log('better-sqlite3 ok in '+process.cwd()+' (NODE_MODULE_VERSION '+process.versions.modules+')')" \
        || { echo "KI17_BETTER_SQLITE3_UNUSABLE: $root has no working Linux binding for Node $(node -v)" >&2; exit 1; }; \
    done
# Entrypoint assertions 2 and 3 of 5 (ZURI_MSP_ARGS and MSP_GKS_ARGS in §7 name these).
RUN set -eu; \
    test -f /opt/ki17/msp/apps/msp-server/bin/msp-server.mjs || { echo "KI17_MSP_ENTRYPOINT_MISSING: /opt/ki17/msp/apps/msp-server/bin/msp-server.mjs" >&2; exit 1; }; \
    test -f /opt/ki17/gks/apps/gks-server/bin/gks-server.mjs || { echo "KI17_GKS_ENTRYPOINT_MISSING: /opt/ki17/gks/apps/gks-server/bin/gks-server.mjs" >&2; exit 1; }; \
    test -f /opt/ki17/gks/apps/gks-server/bin/gks-http-server.mjs || { echo "KI17_GKS_HTTP_ENTRYPOINT_MISSING: /opt/ki17/gks/apps/gks-server/bin/gks-http-server.mjs" >&2; exit 1; }; \
    test -f /opt/ki17/gks/deploy/docker/entrypoint.mjs || { echo "KI17_GKS_SECRET_ENTRYPOINT_MISSING: /opt/ki17/gks/deploy/docker/entrypoint.mjs" >&2; exit 1; }; \
    test -s /opt/ki17/pins/resolved.json || { echo "KI17_PIN_RECEIPT_MISSING: /opt/ki17/pins/resolved.json" >&2; exit 1; }

# ---------------------------------------------------------------- ki17-venv
# C9: Python 3.12 with the versions pinned in the worker's requirements.txt, read
# from the GenesisBlock context so the pin is the only place a version lives.
FROM ${KI17_PYTHON_IMAGE} AS ki17-venv
COPY --from=ki17-pins /opt/ki17/pins /opt/ki17/pins
COPY --from=genesisblock genesisrag17-worker/requirements.txt /tmp/ki17-requirements.txt
RUN set -eu; \
    test -s /tmp/ki17-requirements.txt || { echo "KI17_REQUIREMENTS_MISSING: genesisrag17-worker/requirements.txt is absent from the genesisblock build context" >&2; exit 1; }; \
    python3 -m venv /opt/ki17/venv; \
    /opt/ki17/venv/bin/pip install --no-cache-dir --upgrade pip; \
    /opt/ki17/venv/bin/pip install --no-cache-dir -r /tmp/ki17-requirements.txt
# Entrypoint assertion 4 of 5 (GENESISRAG17_PYTHON in §7 names this exact binary).
RUN set -eu; \
    test -x /opt/ki17/venv/bin/python || { echo "KI17_VENV_PYTHON_MISSING: /opt/ki17/venv/bin/python" >&2; exit 1; }; \
    /opt/ki17/venv/bin/python -c "import sys, numpy, onnxruntime, tokenizers; print('ki17 venv', sys.version.split()[0], 'numpy', numpy.__version__, 'onnxruntime', onnxruntime.__version__, 'tokenizers', tokenizers.__version__); sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)" \
      || { echo "KI17_VENV_INVALID: the venv is not Python 3.12 with the pinned embedding dependencies" >&2; exit 1; }

# ---------------------------------------------------------------- ki17-fixtures
# P-6. The Phase 2 SmartGift fixture, baked rather than mounted so the image and
# the benchmark it was accepted against cannot drift apart.
FROM base AS ki17-fixtures
COPY tests/fixtures/genesisrag17-smartgift-corpus-v1.json tests/fixtures/genesisrag17-corpus-v1.json /opt/ki17/fixtures/
COPY tests/fixtures/genesisrag17/smartgift-catalog /opt/ki17/fixtures/smartgift-catalog
COPY deploy/ki17/build-smartgift-benchmark.mjs /opt/ki17/tools/
# The corpus keeps its queries per record (benchmarks[].queries) because the Phase 2
# acceptance re-boots the worker once per record; a container boots once. Read the
# header of build-smartgift-benchmark.mjs before touching this.
RUN node /opt/ki17/tools/build-smartgift-benchmark.mjs \
      --corpus /opt/ki17/fixtures/genesisrag17-smartgift-corpus-v1.json \
      --out /opt/ki17/fixtures/genesisrag17-smartgift-benchmark-v1.json
RUN set -eu; \
    test -s /opt/ki17/fixtures/genesisrag17-smartgift-benchmark-v1.json || { echo "KI17_FIXTURE_MISSING: derived SmartGift benchmark" >&2; exit 1; }; \
    test -s /opt/ki17/fixtures/genesisrag17-smartgift-corpus-v1.json || { echo "KI17_FIXTURE_MISSING: SmartGift acceptance corpus" >&2; exit 1; }; \
    test -s /opt/ki17/fixtures/smartgift-catalog/products.json || { echo "KI17_FIXTURE_MISSING: smartgift-catalog raw fixture" >&2; exit 1; }

# ---------------------------------------------------------------- runner-ki17
# The web image for the knowledge deployment: `runner` plus /opt/ki17/{node,msp,gks}
# and the P-5 smoke script. Rollback R3 is "point ZURI_WEB_IMAGE back at the plain
# `runner` tag", and that works because nothing else differs.
FROM runner AS runner-ki17
USER root
COPY --from=ki17 --chown=node:node /opt/ki17 /opt/ki17
# P-5. The runtime image copies scripts FILE BY FILE, so a local import that is not
# listed here is a container that starts and dies (scripts/server-line-worker.mjs,
# 2026-09-08). ki17-smoke.mjs imports exactly one repository file — the MSP stdio
# transport — and tests/unit/ki17-build-stage.test.js fails if that stops being true.
COPY --from=builder --chown=node:node /app/scripts/ki17-smoke.mjs ./scripts/
COPY --from=builder --chown=node:node /app/src/modules/agent/msp-stdio-transport.js ./src/modules/agent/
COPY --from=builder --chown=node:node /app/src/modules/agent/msp-child-environment.mjs ./src/modules/agent/
# The ki17-state volume mounts here (§6). Creating it owned by `node` means the
# named volume is seeded with the right ownership instead of root's.
RUN mkdir -p /var/lib/zuri-ki17/state && chown -R node:node /var/lib/zuri-ki17
USER node
RUN set -eu; \
    test -x /opt/ki17/node/bin/node || { echo "KI17_NODE_BINARY_MISSING" >&2; exit 1; }; \
    test -f /opt/ki17/msp/apps/msp-server/bin/msp-server.mjs || { echo "KI17_MSP_ENTRYPOINT_MISSING" >&2; exit 1; }; \
    test -f /opt/ki17/gks/apps/gks-server/bin/gks-server.mjs || { echo "KI17_GKS_ENTRYPOINT_MISSING" >&2; exit 1; }; \
    test -f /opt/ki17/gks/apps/gks-server/bin/gks-http-server.mjs || { echo "KI17_GKS_HTTP_ENTRYPOINT_MISSING" >&2; exit 1; }; \
    test -f /app/scripts/ki17-smoke.mjs || { echo "KI17_SMOKE_SCRIPT_MISSING" >&2; exit 1; }; \
    test -f /app/src/modules/agent/msp-stdio-transport.js || { echo "KI17_SMOKE_IMPORT_MISSING: msp-stdio-transport.js" >&2; exit 1; }; \
    test -f /app/src/modules/agent/msp-child-environment.mjs || { echo "KI17_MSP_ENVIRONMENT_HELPER_MISSING" >&2; exit 1; }

# ---------------------------------------------------------------- gks-http
# D10: a separate, least-scope GKS service for the opt-in private HTTP overlay.
# The Node 24 runtime and GKS tree come from the same pin-checked Linux install used
# by runner-ki17; this image contains neither MSP nor the Tier 1 application.
FROM base AS gks-http
ENV NODE_ENV=production \
    PATH=/opt/ki17/node/bin:$PATH \
    GKS_DB_PATH=/var/lib/zuri-ki17/state/gks.sqlite \
    GKS_HTTP_HOST=0.0.0.0 \
    GKS_HTTP_PORT=8787 \
    GKS_MSP_AUTH_REQUIRED=1 \
    GKS_MSP_RELAY_CREDENTIAL_FILE=/run/secrets/gks_msp_relay_credential \
    GKS_PIPELINE_RELAY_CREDENTIAL_FILE=/run/secrets/gks_pipeline_relay_credential
COPY --from=ki17 --chown=node:node /opt/ki17/node /opt/ki17/node
COPY --from=ki17 --chown=node:node /opt/ki17/gks /opt/ki17/gks
RUN mkdir -p /var/lib/zuri-ki17/state \
 && chown -R node:node /var/lib/zuri-ki17
USER node
WORKDIR /opt/ki17/gks
RUN set -eu; \
    test -x /opt/ki17/node/bin/node || { echo "KI17_NODE_BINARY_MISSING" >&2; exit 1; }; \
    test -f /opt/ki17/gks/apps/gks-server/bin/gks-http-server.mjs || { echo "KI17_GKS_HTTP_ENTRYPOINT_MISSING" >&2; exit 1; }; \
    test -f /opt/ki17/gks/deploy/docker/entrypoint.mjs || { echo "KI17_GKS_SECRET_ENTRYPOINT_MISSING" >&2; exit 1; }; \
    /opt/ki17/node/bin/node -e "require('/opt/ki17/gks/node_modules/better-sqlite3')(':memory:').close()"
EXPOSE 8787
CMD ["/opt/ki17/node/bin/node", "/opt/ki17/gks/deploy/docker/entrypoint.mjs", "/opt/ki17/node/bin/node", "/opt/ki17/gks/apps/gks-server/bin/gks-http-server.mjs"]

# ---------------------------------------------------------------- genesis-worker
# The Tier 4 sidecar (§5). It carries no Next.js build and no zuri-ai secret: it runs
# one process, `/opt/ki17/node/bin/node genesisrag17-worker/src/cli.mjs`, bound to
# loopback inside web's network namespace, and loads only .env.knowledge.
FROM ${KI17_PYTHON_IMAGE} AS genesis-worker
ENV NODE_ENV=production
ENV PATH=/opt/ki17/node/bin:$PATH
ENV GENESISRAG17_PYTHON=/opt/ki17/venv/bin/python
WORKDIR /opt/ki17/genesisblock/genesisrag17-worker
# libstdc++6 and ldd: the napi addon is a Rust cdylib, and GenesisBlock's loader
# (index.js) shells out to `which ldd` to tell glibc from musl before requiring it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 1000 node \
 && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash node
COPY --from=ki17 --chown=node:node /opt/ki17/node /opt/ki17/node
COPY --from=ki17 --chown=node:node /opt/ki17/msp /opt/ki17/msp
COPY --from=ki17 --chown=node:node /opt/ki17/gks /opt/ki17/gks
COPY --from=ki17 --chown=node:node /opt/ki17/pins /opt/ki17/pins
COPY --from=ki17-venv --chown=node:node /opt/ki17/venv /opt/ki17/venv
COPY --from=ki17-fixtures --chown=node:node /opt/ki17/fixtures /opt/ki17/fixtures
COPY --from=builder --chown=node:node /app/scripts/ki17-worker-msp-launcher.mjs /opt/ki17/tools/
COPY --from=builder --chown=node:node /app/src/modules/agent/msp-child-environment.mjs /opt/ki17/src/modules/agent/
# The worker resolves the native binding as `require('../../index.js')`, so the napi
# loader, its types and the package manifest all sit at the GenesisBlock package root.
COPY --from=genesisblock --chown=node:node index.js index.d.ts package.json /opt/ki17/genesisblock/
COPY --from=genesisblock --chown=node:node genesisrag17-worker /opt/ki17/genesisblock/genesisrag17-worker
# P-2 DEPENDENCY. The addon is built by the sibling GenesisBlock pull request
# (branch feat/genesisrag17-worker-linux-x64) from the SAME pinned commit. The whole
# publish folder is copied so the failure below is this assertion, with a message
# that names the cause, rather than an anonymous COPY-not-found.
COPY --from=genesisblock --chown=node:node npm/linux-x64-gnu /opt/ki17/genesisblock/npm/linux-x64-gnu
RUN set -eu; \
    addon=/opt/ki17/genesisblock/npm/linux-x64-gnu/index.linux-x64-gnu.node; \
    if [ ! -f "$addon" ]; then \
      echo "KI17_GENESISBLOCK_LINUX_ADDON_MISSING: $addon is absent from the genesisblock build context." >&2; \
      echo "  ADR-075 Phase 3 P-2: the x86_64-unknown-linux-gnu napi build of the pinned GenesisBlock" >&2; \
      echo "  commit is produced by the sibling GenesisBlock pull request (feat/genesisrag17-worker-linux-x64)." >&2; \
      echo "  Every acceptance so far ran on Windows (C11); gate G-3 re-runs it on this addon." >&2; \
      exit 1; \
    fi; \
    cp "$addon" /opt/ki17/genesisblock/index.linux-x64-gnu.node; \
    chown node:node /opt/ki17/genesisblock/index.linux-x64-gnu.node
# §6: ki17-genesis-store and the read-only ki17-model volume mount at these paths.
RUN mkdir -p /var/lib/zuri-ki17/state /var/lib/zuri-ki17/genesis /opt/ki17/model \
 && chown -R node:node /var/lib/zuri-ki17 /opt/ki17/model
USER node
# Entrypoint assertions 1-5 of 5, in one place, for the image that actually runs them.
RUN set -eu; \
    test -x /opt/ki17/node/bin/node || { echo "KI17_NODE_BINARY_MISSING: /opt/ki17/node/bin/node" >&2; exit 1; }; \
    test -f /opt/ki17/genesisblock/genesisrag17-worker/src/cli.mjs || { echo "KI17_WORKER_ENTRYPOINT_MISSING: genesisrag17-worker/src/cli.mjs" >&2; exit 1; }; \
    test -f /opt/ki17/genesisblock/genesisrag17-worker/src/embedder.py || { echo "KI17_WORKER_EMBEDDER_MISSING: genesisrag17-worker/src/embedder.py" >&2; exit 1; }; \
    test -f /opt/ki17/genesisblock/index.js || { echo "KI17_GENESISBLOCK_LOADER_MISSING: index.js" >&2; exit 1; }; \
    test -f /opt/ki17/genesisblock/index.linux-x64-gnu.node || { echo "KI17_GENESISBLOCK_LINUX_ADDON_MISSING: index.linux-x64-gnu.node" >&2; exit 1; }; \
    test -x /opt/ki17/venv/bin/python || { echo "KI17_VENV_PYTHON_MISSING: /opt/ki17/venv/bin/python" >&2; exit 1; }; \
    test -f /opt/ki17/msp/apps/msp-server/bin/msp-server.mjs || { echo "KI17_MSP_ENTRYPOINT_MISSING" >&2; exit 1; }; \
    test -f /opt/ki17/tools/ki17-worker-msp-launcher.mjs || { echo "KI17_WORKER_MSP_LAUNCHER_MISSING" >&2; exit 1; }; \
    test -f /opt/ki17/src/modules/agent/msp-child-environment.mjs || { echo "KI17_MSP_ENVIRONMENT_HELPER_MISSING" >&2; exit 1; }; \
    test -f /opt/ki17/gks/apps/gks-server/bin/gks-server.mjs || { echo "KI17_GKS_ENTRYPOINT_MISSING" >&2; exit 1; }; \
    test -s /opt/ki17/fixtures/genesisrag17-smartgift-benchmark-v1.json || { echo "KI17_FIXTURE_MISSING: SmartGift benchmark" >&2; exit 1; }; \
    test -x /usr/bin/which || { echo "KI17_WHICH_MISSING: GenesisBlock's addon loader shells out to \`which ldd\`" >&2; exit 1; }
# C6: the worker binds 127.0.0.1 only and publishes nothing. No EXPOSE, on purpose —
# the port lives inside web's namespace and must not look publishable.
# The Compose healthcheck is a bare TCP connect (§10 health checks): no token, no query.
CMD ["/opt/ki17/node/bin/node", "/opt/ki17/genesisblock/genesisrag17-worker/src/cli.mjs"]

# ---------------------------------------------------------------- ki17-acceptance
# GATE G-3 ONLY — a test image, never a shipped one. docker-compose.yml, CI and the
# `runner` / `runner-ki17` / `genesis-worker` targets do not reference it, and nothing
# it adds can reach them: it is a leaf of the stage graph.
#
# G-3 requires the Phase 2 acceptance to pass "inside the images this design ships",
# so this stage IS the shipped sidecar (`genesis-worker`: /opt/ki17/{node,msp,gks,
# genesisblock,venv,fixtures} at the pinned commits, the linux-x64-gnu addon and the
# Python 3.12 venv) with exactly one thing added — the Tier 1 test runner. That is this
# app's own Node 22, the version `runner` ships and `deps` installed against, plus its
# devDependencies, source and `tests/` tree, none of which the standalone build carries.
#
# Two Node runtimes therefore live here on purpose, matching the deployed topology:
# Node 22 runs vitest and the zuri-ai Tier 1 code, /opt/ki17/node/bin/node (24.18.x)
# runs MSP, GKS and the GenesisBlock worker. PATH is reset so a bare `node` is Node 22;
# the children are addressed by the absolute KI17_NODE path (tests/acceptance/harness.js).
FROM genesis-worker AS ki17-acceptance
USER root
# genesis-worker puts /opt/ki17/node/bin first so its CMD resolves Node 24. The test
# runner must not: reset PATH to the image default and name the ki17 runtime explicitly.
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Not `production`: src/lib/db.js refuses a SQLite URL there, `npm` would drop
# devDependencies, and this is a test run.
ENV NODE_ENV=test
ENV NEXT_TELEMETRY_DISABLED=1
# The Node 22 runtime, from the same node:22-bookworm-slim `base` the web image uses.
# Debian bookworm underneath both, so /usr/local/lib/node_modules (npm) and
# /usr/local/lib/python3.12 (the venv's interpreter) coexist without colliding.
COPY --from=base /usr/local/bin/node /usr/local/bin/node
COPY --from=base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN set -eu; \
    ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm; \
    ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx; \
    apt-get update; \
    apt-get install -y --no-install-recommends openssl ca-certificates; \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
# node_modules and BOTH generated Prisma clients come from `deps` — the same layer the
# shipped image builds from, so the acceptance runs against the dependency tree
# production resolved, and the file still contains exactly one `npm ci` per app.
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `.dockerignore` excludes tests/ from the main context and keeps doing so; the suite
# arrives as its own named context instead. See the `FROM scratch AS ki17-tests` note.
COPY --from=ki17-tests . ./tests
# KI17_MODEL_DIR is a mount point: the ~490MB embedding model is bind-mounted read-only
# at run time, never baked into a layer. The worker re-verifies its five SHA-256 values
# at every start, so a wrong revision fails the run rather than quietly degrading it.
RUN mkdir -p /model
ENV KI17_NODE=/opt/ki17/node/bin/node \
    KI17_MSP_ROOT=/opt/ki17/msp \
    KI17_GKS_ROOT=/opt/ki17/gks \
    KI17_GENESIS_ROOT=/opt/ki17/genesisblock \
    KI17_MODEL_DIR=/model
RUN set -eu; \
    case "$(node -v)" in v22.*) ;; *) echo "KI17_ACCEPTANCE_RUNNER_NODE_UNEXPECTED: $(node -v)" >&2; exit 1;; esac; \
    case "$("$KI17_NODE" -v)" in v24.18.*) ;; *) echo "KI17_ACCEPTANCE_CHILD_NODE_UNEXPECTED: $("$KI17_NODE" -v)" >&2; exit 1;; esac; \
    test -f /app/tests/acceptance/genesisrag17-e2e.test.js || { echo "KI17_ACCEPTANCE_SUITE_MISSING: pass --build-context ki17-tests=apps/server/tests" >&2; exit 1; }; \
    test -f /app/tests/acceptance/genesisrag17-smartgift.test.js || { echo "KI17_ACCEPTANCE_SUITE_MISSING: genesisrag17-smartgift.test.js" >&2; exit 1; }; \
    test -f /app/vitest.ki17.config.js || { echo "KI17_ACCEPTANCE_CONFIG_MISSING" >&2; exit 1; }; \
    test -d /app/node_modules/vitest || { echo "KI17_ACCEPTANCE_DEVDEPS_MISSING: vitest" >&2; exit 1; }
CMD ["npm", "run", "test:genesisrag17"]
