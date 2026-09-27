# ki17 release overlay — ship a new main SHA with the /opt/ki17 tree production
# already runs, without rebuilding MSP/GKS/GenesisBlock from sibling checkouts.
#
#   BASE      the plain `runner` image built from the checked-out SHA
#             (docker build --target runner -t zuri-ai-web:main-<sha8> apps/server)
#   KI17_FROM the runner-ki17 / overlay image production currently runs; its
#             /opt/ki17 (Node 24, MSP, GKS, pins receipt) is copied verbatim
#
# Build context: apps/server at the SAME checkout as BASE, so the three app files
# below are the ones that SHA ships (the same three `runner-ki17` copies from its
# builder stage). Use scripts/build-ki17-overlay-release.mjs rather than running this
# by hand; it refuses a dirty tree, a missing base and a missing KI17_FROM, and names
# the tag release-<sha8>-ki17-overlay.
#
# Why this exists: the stdio tuple production runs (MSP 68e6169d / GKS ecf1e4de)
# is the one deploy/ki17/pins.json pins, but a host whose sibling checkouts have
# moved cannot rebuild it, and rebuilding /opt/ki17 for every web release costs a
# full npm ci of MSP and GKS. The runtime tree does not change between web releases,
# so it is carried forward from the image that is already proven in production.
ARG BASE
ARG KI17_FROM
FROM ${KI17_FROM} AS ki17src

FROM ${BASE}
USER root
COPY --from=ki17src --chown=node:node /opt/ki17 /opt/ki17
COPY --chown=node:node scripts/ki17-smoke.mjs ./scripts/
COPY --chown=node:node src/modules/agent/msp-stdio-transport.js src/modules/agent/msp-child-environment.mjs ./src/modules/agent/
# The reference the carried tree is checked against: the stdio manifest of THIS
# checkout, plus the checker. Both are removed again in the same layer.
COPY deploy/ki17/pins.json /tmp/ki17-overlay-check/pins.json
COPY deploy/ki17/overlay/check-ki17-from.mjs /tmp/ki17-overlay-check/
RUN set -eu; \
    node /tmp/ki17-overlay-check/check-ki17-from.mjs /tmp/ki17-overlay-check/pins.json /opt/ki17/pins/resolved.json; \
    rm -rf /tmp/ki17-overlay-check
RUN set -eu; \
    mkdir -p /var/lib/zuri-ki17/state; \
    chown -R node:node /var/lib/zuri-ki17; \
    test -x /opt/ki17/node/bin/node || { echo "KI17_NODE_BINARY_MISSING: KI17_FROM carries no /opt/ki17/node" >&2; exit 1; }; \
    test -f /opt/ki17/msp/apps/msp-server/bin/msp-server.mjs || { echo "KI17_MSP_ENTRYPOINT_MISSING" >&2; exit 1; }; \
    test -f /opt/ki17/gks/apps/gks-server/bin/gks-server.mjs || { echo "KI17_GKS_ENTRYPOINT_MISSING" >&2; exit 1; }; \
    test -s /opt/ki17/pins/resolved.json || { echo "KI17_PIN_RECEIPT_MISSING: KI17_FROM carries no pin receipt" >&2; exit 1; }; \
    node -e "const r=require('/opt/ki17/pins/resolved.json'); if (r.profile === 'gks-http') { console.error('KI17_OVERLAY_PROFILE_REFUSED: KI17_FROM was built from the gks-http canary manifest; production web releases carry the stdio tuple'); process.exit(1) }"; \
    test -f /app/scripts/ki17-smoke.mjs || { echo "KI17_SMOKE_SCRIPT_MISSING" >&2; exit 1; }; \
    test -f /app/src/modules/agent/msp-stdio-transport.js || { echo "KI17_SMOKE_IMPORT_MISSING: msp-stdio-transport.js" >&2; exit 1; }; \
    test -f /app/src/modules/agent/msp-child-environment.mjs || { echo "KI17_MSP_ENVIRONMENT_HELPER_MISSING" >&2; exit 1; }
USER node
