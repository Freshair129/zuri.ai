# syntax=docker/dockerfile:1.7
# @spec ADR-075 — keep the worker runtime pinned while applying a bounded helper overlay.
# @tested tests/unit/ki17-embedder-only-overlay.test.js
# Main-dev qualification only. This recipe does not alter the app image, default
# KI17 pin receipt, model, worker entrypoint, environment, or Compose configuration.
FROM base-image

USER root
ARG BASE_IMAGE=zuri-ai-main-dev-genesis-worker@sha256:9bee2c31dc0efee6f2564eab273f9c815961a1635c08a29805849524974163e7
ARG CONFIGURATION_COMMIT
ARG HELPER_SOURCE_COMMIT
ARG HELPER_SOURCE_SHA256

COPY --from=helper-source /embedder.py /tmp/e5-helper-overlay/embedder.py
COPY --from=helper-source /overlay-receipt.json /tmp/e5-helper-overlay/overlay-receipt.json
COPY deploy/ki17/overlay/check-embedder-overlay.mjs /tmp/e5-helper-overlay/check-embedder-overlay.mjs

RUN set -eu; \
    test "$BASE_IMAGE" = "zuri-ai-main-dev-genesis-worker@sha256:9bee2c31dc0efee6f2564eab273f9c815961a1635c08a29805849524974163e7" || { echo "KI17_EMBEDDER_BASE_IMAGE_MISMATCH" >&2; exit 1; }; \
    node /tmp/e5-helper-overlay/check-embedder-overlay.mjs \
      --phase before \
      --receipt /tmp/e5-helper-overlay/overlay-receipt.json \
      --pins /opt/ki17/pins/pins.json \
      --resolved /opt/ki17/pins/resolved.json \
      --current-helper /opt/ki17/genesisblock/genesisrag17-worker/src/embedder.py \
      --candidate-helper /tmp/e5-helper-overlay/embedder.py \
      --expected-source-commit "$HELPER_SOURCE_COMMIT" \
      --expected-source-sha256 "$HELPER_SOURCE_SHA256"; \
    install -o node -g node -m 0644 /tmp/e5-helper-overlay/embedder.py /opt/ki17/genesisblock/genesisrag17-worker/src/embedder.py; \
    install -o node -g node -m 0644 /tmp/e5-helper-overlay/overlay-receipt.json /opt/ki17/pins/e5-embedder-overlay.json; \
    node /tmp/e5-helper-overlay/check-embedder-overlay.mjs \
      --phase after \
      --receipt /opt/ki17/pins/e5-embedder-overlay.json \
      --pins /opt/ki17/pins/pins.json \
      --resolved /opt/ki17/pins/resolved.json \
      --current-helper /opt/ki17/genesisblock/genesisrag17-worker/src/embedder.py \
      --expected-source-commit "$HELPER_SOURCE_COMMIT" \
      --expected-source-sha256 "$HELPER_SOURCE_SHA256"; \
    rm -rf /tmp/e5-helper-overlay

LABEL org.zuri.ki17.overlay-profile="main-dev-e5-batch32" \
      org.zuri.ki17.overlay.base-image-ref=${BASE_IMAGE} \
      org.zuri.ki17.overlay.helper-source-revision=${HELPER_SOURCE_COMMIT} \
      org.zuri.ki17.overlay.helper-source-sha256=${HELPER_SOURCE_SHA256} \
      org.zuri.ki17.overlay.configuration-revision=${CONFIGURATION_COMMIT}

# The inherited worker user, workdir, environment and CMD remain the runtime contract.
USER node
